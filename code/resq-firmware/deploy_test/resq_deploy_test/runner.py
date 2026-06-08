from __future__ import annotations

import hashlib
import platform
import re
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Callable

from .config import DeployConfig
from .evidence import EvidenceStore, command_reply, is_json_message
from .mqtt_client import MqttMonitor
from .process import CommandRunner
from .provisioning import ProvisioningClient
from .report import QualificationReport
from .router import RouterHooks
from .serial_capture import SerialCapture
from .services import MosquittoBroker, RegistrationBackend
from .wifi import WindowsWifi


class QualificationStop(RuntimeError):
    pass


class QualificationRunner:
    def __init__(self, config: DeployConfig, *, input_fn: Callable[[str], str] = input):
        self.config = config
        self.input_fn = input_fn
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        configured = Path(config.qualification.evidence_dir)
        root = configured if configured.is_absolute() else config.firmware_root / configured
        self.output_dir = root / stamp
        self.output_dir.mkdir(parents=True, exist_ok=True)
        password = config.network.wifi_password
        self.commands = CommandRunner(self.output_dir / "commands.log", [password, config.device.softap_password])
        self.report = QualificationReport(self.output_dir, {
            "host": platform.platform(),
            "python": sys.version,
            "target": config.device.target,
            "serial_port": config.device.serial_port,
        })
        self.evidence = EvidenceStore(self.output_dir / "mqtt.jsonl")
        self.wifi = WindowsWifi(self.commands)
        self.router = RouterHooks(
            config.router,
            self.commands,
            wifi_ssid=config.network.wifi_ssid,
            router_host=config.network.host_ip,
        )
        self.serial: SerialCapture | None = None
        self.backend: RegistrationBackend | None = None
        self.broker: MosquittoBroker | None = None
        self.mqtt: MqttMonitor | None = None
        self.device_id = ""
        self.original_wlan = ""
        self.router_touched = False
        self.wlan_touched = False

    def _record(self, phase: str, name: str, operation: Callable[[], str | None], *, required: bool = True) -> bool:
        started = time.monotonic()
        try:
            detail = operation() or "completed"
            self.report.add(phase, name, "PASS", detail, required=required, duration=time.monotonic() - started)
            print(f"[PASS] {phase}: {name}")
            return True
        except Exception as exc:
            self.report.add(phase, name, "FAIL", str(exc), required=required, duration=time.monotonic() - started)
            print(f"[FAIL] {phase}: {name}: {exc}")
            return False

    def _guided(self, phase: str, name: str, instruction: str, evidence: str = "") -> bool:
        if not self.config.qualification.interactive:
            self.report.add(phase, name, "SKIP", "interactive qualification disabled", required=True)
            return False
        print(f"\nACTION: {instruction}")
        answer = self.input_fn("Result [y=pass / n=fail / s=skip]: ").strip().lower()
        detail = evidence or instruction
        if answer == "y":
            self.report.add(phase, name, "PASS", detail)
            return True
        if answer == "s":
            self.report.add(phase, name, "SKIP", detail)
            return False
        self.report.add(phase, name, "FAIL", detail)
        return False

    def _idf(self, *args: str, timeout: float = 600) -> str:
        result = self.commands.run(["idf.py", *args], cwd=self.config.firmware_root, timeout=timeout)
        return result.stdout + result.stderr

    def _metadata(self) -> str:
        idf = self.commands.run(["idf.py", "--version"]).stdout.strip()
        if not re.search(r"\bv6\.0(?:\D|$)", idf):
            raise RuntimeError(f"ESP-IDF v6.0 required, found {idf}")
        revision = self.commands.run(["git", "rev-parse", "HEAD"], cwd=self.config.firmware_root).stdout.strip()
        dirty = bool(self.commands.run(["git", "status", "--porcelain"], cwd=self.config.firmware_root).stdout.strip())
        self.report.metadata.update({"esp_idf": idf, "git_revision": revision, "git_dirty": dirty})
        return f"{idf}; git={revision}; dirty={dirty}"

    def _preflight(self) -> str:
        if platform.system() != "Windows":
            raise RuntimeError("netsh provisioning requires Windows")
        for executable in ("idf.py", "git", "netsh"):
            if not shutil.which(executable):
                raise RuntimeError(f"{executable} is not on PATH")
        if self.config.network.lan_profile not in self.wifi.profiles():
            raise RuntimeError(f"missing WLAN profile {self.config.network.lan_profile}")
        if self.config.qualification.run_recovery:
            if not self.config.router.disable_command or not self.config.router.enable_command:
                raise RuntimeError("router disable and enable command arrays are required for recovery tests")
        return "tools, WLAN profile, secrets, and router hook configuration are present"

    def _build_and_flash(self) -> str:
        self._idf("fullclean")
        self._idf("set-target", self.config.device.target)
        self._idf("build")
        self._idf("-p", self.config.device.serial_port, "erase-flash", timeout=180)
        self._idf("-p", self.config.device.serial_port, "flash", timeout=300)
        hashes: dict[str, str] = {}
        for image in sorted((self.config.firmware_root / "build").glob("*.bin")):
            hashes[image.name] = hashlib.sha256(image.read_bytes()).hexdigest()
        if not hashes:
            raise RuntimeError("build produced no top-level .bin images")
        self.report.metadata["firmware_sha256"] = hashes
        return f"clean-flashed {len(hashes)} images"

    def _start_serial(self) -> str:
        self.serial = SerialCapture(
            self.config.device.serial_port,
            self.config.device.baud_rate,
            self.output_dir / "serial.log",
        )
        self.serial.start()
        if not self.serial.wait_for("PROVISIONING", self.config.timing.boot_timeout_seconds):
            raise RuntimeError("serial output did not reach PROVISIONING after clean flash")
        return "serial capture active and clean device entered PROVISIONING"

    def _start_services(self) -> str:
        service = self.config.services
        self.broker = MosquittoBroker(service.mqtt_port, service.mqtt_ws_port, service.mosquitto_path, service.reuse_broker)
        self.broker.start()
        self.backend = RegistrationBackend(
            self.config.network.host_ip,
            service.backend_port,
            self.config.network.host_ip,
            service.mqtt_port,
        )
        self.backend.start()
        self.mqtt = MqttMonitor(self.config.network.host_ip, service.mqtt_port, self.evidence)
        self.mqtt.start()
        return f"backend={self.backend.base_url}; MQTT={self.config.network.host_ip}:{service.mqtt_port}"

    def _find_softap(self) -> str:
        deadline = time.monotonic() + self.config.timing.provision_timeout_seconds
        while time.monotonic() < deadline:
            matches = sorted(ssid for ssid in self.wifi.visible_ssids() if ssid.startswith(self.config.device.softap_ssid_prefix))
            if matches:
                return matches[0]
            time.sleep(2)
        raise RuntimeError(f"no visible SSID beginning {self.config.device.softap_ssid_prefix}")

    def _provision(self) -> str:
        self.original_wlan = self.wifi.current_ssid()
        softap = self._find_softap()
        self.wifi.ensure_softap_profile(softap, self.config.device.softap_password)
        self.wlan_touched = True
        self.wifi.connect(softap, ssid=softap)
        client = ProvisioningClient(self.config.device.provision_url)
        status = client.wait_until_ready(self.config.timing.provision_timeout_seconds)
        if status.get("saved_config") is True:
            raise RuntimeError("clean-flashed device unexpectedly reports saved configuration")
        client.provision(
            self.config.network.wifi_ssid,
            self.config.network.wifi_password,
            f"http://{self.config.network.host_ip}:{self.config.services.backend_port}",
        )
        self.wifi.connect(self.config.network.lan_profile, ssid=self.config.network.wifi_ssid)
        deadline = time.monotonic() + self.config.timing.provision_timeout_seconds
        while time.monotonic() < deadline:
            if self.backend and self.backend.registrations:
                registration = self.backend.registrations[-1]
                mac = str(registration.get("device_mac", "")).replace(":", "")[-6:].lower()
                self.device_id = f"resq-{mac}"
                return f"provisioned {softap}; registered device_id={self.device_id}"
            time.sleep(0.2)
        raise RuntimeError("firmware did not register with backend")

    def _wait_json(self, suffix: str, fields: set[str], timeout: float | None = None, *, after: float = 0):
        message = self.evidence.wait_for(
            lambda item: item.received_at >= after and is_json_message(item, suffix, fields),
            timeout or self.config.timing.command_timeout_seconds,
            after=after,
        )
        if not message:
            raise RuntimeError(f"no valid MQTT {suffix} payload with fields {sorted(fields)}")
        return message

    def _protocol(self) -> str:
        status = self._wait_json("/status", {"device_id", "state", "session_active", "calibrated", "ip", "ts_ms"})
        heartbeat = self._wait_json(
            "/heartbeat",
            {"device_id", "state", "wifi_connected", "mqtt_connected", "backend_registered", "sensor_running", "uptime_ms"},
        )
        assert isinstance(status.payload, dict) and isinstance(heartbeat.payload, dict)
        if status.payload["device_id"] != self.device_id or heartbeat.payload["device_id"] != self.device_id:
            raise RuntimeError("status/heartbeat device_id does not match registration")
        if not self.mqtt:
            raise RuntimeError("MQTT monitor unavailable")

        debug_id = self.mqtt.command(self.device_id, "cmd/debug")
        debug = self.evidence.wait_for(
            lambda item: item.topic.endswith("/debug") and isinstance(item.payload, dict)
            and {"pressure_0_raw", "pressure_1_raw", "pressure_2_raw", "hall_raw", "ts_ms"}.issubset(item.payload),
            self.config.timing.command_timeout_seconds,
        )
        reply = self.evidence.wait_for(command_reply(debug_id), self.config.timing.command_timeout_seconds)
        if not debug or not reply:
            raise RuntimeError("debug command did not produce ACK and sensor snapshot")

        unknown_id = self.mqtt.command(self.device_id, "cmd/not-a-command")
        if not self.evidence.wait_for(command_reply(unknown_id, {"NACK"}), self.config.timing.command_timeout_seconds):
            raise RuntimeError("unknown command did not produce NACK")
        for suffix in ("cmd/system/retry", "cmd/system/reset", "cmd/system/flush-config"):
            request_id = self.mqtt.command(self.device_id, suffix)
            if not self.evidence.wait_for(command_reply(request_id, {"NACK"}), self.config.timing.command_timeout_seconds):
                raise RuntimeError(f"{suffix} did not reject use outside ERROR")
        self.mqtt.publish(self.device_id, "cmd/debug", "{broken-json")
        return "status, heartbeat, debug, request IDs, invalid-state system commands, unknown command, and malformed JSON exercised"

    def _debug_snapshot(self) -> dict[str, object]:
        assert self.mqtt
        after = time.time()
        request_id = self.mqtt.command(self.device_id, "cmd/debug")
        message = self.evidence.wait_for(
            lambda item: (
                item.received_at >= after
                and item.topic.endswith("/debug")
                and isinstance(item.payload, dict)
                and {"pressure_0_raw", "pressure_1_raw", "pressure_2_raw", "hall_raw", "ts_ms"}.issubset(item.payload)
            ),
            self.config.timing.command_timeout_seconds,
            after=after,
        )
        reply = self.evidence.wait_for(command_reply(request_id, {"ACK"}), self.config.timing.command_timeout_seconds, after=after)
        if not message or not reply or not isinstance(message.payload, dict):
            raise RuntimeError("fresh debug sensor snapshot was not ACKed")
        for key in ("pressure_0_raw", "pressure_1_raw", "pressure_2_raw"):
            if message.payload[key] == -999999:
                raise RuntimeError(f"{key} returned HX710 timeout sentinel")
        return message.payload

    def _hardware(self) -> str:
        self._guided("hardware", "status LEDs", "Confirm GPIO7 state LED and GPIO6 activity LED match the current PAIRED_IDLE pattern.")
        baseline = self._debug_snapshot()
        checks = (
            ("pressure_0_raw", "Apply pressure only to pressure sensor/bladder 0 and hold it."),
            ("pressure_1_raw", "Apply pressure only to pressure sensor/bladder 1 and hold it."),
            ("pressure_2_raw", "Apply pressure only to pressure sensor/bladder 2 and hold it."),
            ("hall_raw", "Move and hold the chest/hall mechanism away from its rest position."),
        )
        for field, instruction in checks:
            if not self._guided("hardware", f"stimulate {field}", instruction):
                continue
            stimulated = self._debug_snapshot()
            if stimulated[field] == baseline[field]:
                self.report.add("hardware", f"{field} changed", "FAIL", f"value remained {baseline[field]}")
            else:
                self.report.add("hardware", f"{field} changed", "PASS", f"{baseline[field]} -> {stimulated[field]}")
        self._guided("hardware", "button debounce", "Short-press BUTTON_1 (GPIO4) and BUTTON_2 (GPIO5); confirm no global reset or turn-off occurs.")
        return "guided LEDs/buttons and objective sensor snapshot changes recorded"

    def _calibration(self) -> str:
        if not self.config.qualification.run_calibration:
            self.report.add("calibration", "physical calibration", "SKIP", "disabled by configuration", required=True)
            return "calibration skipped"
        assert self.mqtt
        cal = self.config.calibration
        request_id = self.mqtt.command(
            self.device_id,
            "cmd/calibration/start",
            hall_delta=cal.hall_delta,
            ref_pressure=cal.ref_pressure,
            bladder_1_pressure=cal.bladder_1_pressure,
            bladder_2_pressure=cal.bladder_2_pressure,
            profile_id=cal.profile_id,
        )
        self._guided("calibration", "guided calibration actions", "Follow serial/MQTT calibration prompts: leave sensors at rest, apply reference pressure, then perform the requested full compression.")
        result = self.evidence.wait_for(
            lambda item: item.topic.endswith("/events/calibration")
            and isinstance(item.payload, dict)
            and item.payload.get("reply_id") == request_id
            and item.payload.get("status") in {"ACK", "NACK"},
            self.config.timing.calibration_timeout_seconds,
        )
        if not result:
            raise RuntimeError("calibration did not publish a terminal ACK/NACK")
        if isinstance(result.payload, dict) and result.payload.get("status") != "ACK":
            raise RuntimeError(f"calibration failed: {result.payload}")
        ready = self.evidence.wait_for(
            lambda item: item.topic.endswith("/status") and isinstance(item.payload, dict)
            and item.payload.get("state") == "READY_FOR_SESSION" and item.payload.get("calibrated") is True,
            self.config.timing.command_timeout_seconds,
        )
        if not ready:
            raise RuntimeError("successful calibration did not enter READY_FOR_SESSION")
        return "physical calibration ACKed and READY_FOR_SESSION published"

    def _session(self) -> str:
        if not self.config.qualification.run_session:
            self.report.add("session", "active CPR session", "SKIP", "disabled by configuration", required=True)
            return "session skipped"
        assert self.mqtt
        session_id = f"deploy-{uuid.uuid4().hex[:10]}"
        request_id = self.mqtt.command(self.device_id, "cmd/session/start", session_id=session_id, profile_id=self.config.calibration.profile_id)
        start = self.evidence.wait_for(command_reply(request_id, {"ACK"}), self.config.timing.command_timeout_seconds)
        if not start:
            raise RuntimeError("session start was not ACKed")
        self._guided("session", "compression telemetry", "Perform at least 15 compressions and confirm the buzzer/metronome is audible.")
        telemetry = self.evidence.wait_for(
            lambda item: is_json_message(item, "/telemetry", {
                "session_id", "depth_progress", "rate_cpm", "compression_count",
                "recoil_ok_count", "hand_placement", "pressure_balance_pct", "flags", "ts_ms",
            }) and isinstance(item.payload, dict) and item.payload.get("session_id") == session_id,
            self.config.timing.command_timeout_seconds,
        )
        if not telemetry:
            raise RuntimeError("session telemetry was not observed")
        mismatch_id = self.mqtt.command(self.device_id, "cmd/session/stop", session_id="wrong-session")
        if not self.evidence.wait_for(command_reply(mismatch_id, {"NACK"}), self.config.timing.command_timeout_seconds):
            raise RuntimeError("mismatched session stop did not NACK")
        stop_id = self.mqtt.command(self.device_id, "cmd/session/stop", session_id=session_id)
        if not self.evidence.wait_for(command_reply(stop_id, {"ACK"}), self.config.timing.command_timeout_seconds):
            raise RuntimeError("session stop was not ACKed")
        return "start, telemetry, metronome, mismatch rejection, and clean stop verified"

    def _router_hook(self, action: str) -> None:
        getattr(self.router, action)()
        self.router_touched = True

    def _start_recovery_session(self, label: str) -> str:
        assert self.mqtt
        session_id = f"{label}-{uuid.uuid4().hex[:8]}"
        request_id = self.mqtt.command(
            self.device_id,
            "cmd/session/start",
            session_id=session_id,
            profile_id=self.config.calibration.profile_id,
        )
        if not self.evidence.wait_for(command_reply(request_id, {"ACK"}), self.config.timing.command_timeout_seconds):
            raise RuntimeError(f"could not start {label} recovery session")
        return session_id

    def _wait_terminal_interruption(self, session_id: str, after: float) -> None:
        predicate = lambda item: (
            item.received_at >= after
            and item.topic.endswith("/events")
            and isinstance(item.payload, dict)
            and item.payload.get("session_id") == session_id
            and item.payload.get("result") == "INTERRUPTED"
            and item.payload.get("state") == "SESSION_INTERRUPTED"
        )
        first = self.evidence.wait_for(predicate, self.config.timing.recovery_timeout_seconds, after=after)
        if not first:
            raise RuntimeError(f"no terminal interruption was published for {session_id}")
        time.sleep(2)
        count = sum(1 for item in self.evidence.messages if predicate(item))
        if count != 1:
            raise RuntimeError(f"terminal interruption for {session_id} published {count} times")

    def _recovery(self) -> str:
        if not self.config.qualification.run_recovery:
            self.report.add("recovery", "broker and Wi-Fi recovery", "SKIP", "disabled by configuration", required=True)
            return "recovery skipped"
        assert self.broker
        if self.config.services.reuse_broker:
            raise RuntimeError("MQTT outage tests require a harness-owned broker")
        short_mqtt_after = time.time()
        self.broker.stop()
        time.sleep(self.config.timing.short_outage_seconds)
        self.broker.start()
        heartbeat = self._wait_json(
            "/heartbeat",
            {"mqtt_connected"},
            self.config.timing.recovery_timeout_seconds,
            after=short_mqtt_after,
        )
        if not isinstance(heartbeat.payload, dict) or heartbeat.payload.get("mqtt_connected") is not True:
            raise RuntimeError("post-outage heartbeat does not report MQTT connected")

        mqtt_session = self._start_recovery_session("mqtt-outage")
        mqtt_after = time.time()
        self.broker.stop()
        time.sleep(self.config.timing.long_outage_seconds)
        self.broker.start()
        self._wait_terminal_interruption(mqtt_session, mqtt_after)

        short_wifi_after = time.time()
        self._router_hook("disable")
        time.sleep(self.config.timing.short_outage_seconds)
        self._router_hook("enable")
        if self.config.router.healthcheck_command:
            self._router_hook("healthcheck")
        heartbeat = self._wait_json(
            "/heartbeat",
            {"wifi_connected", "mqtt_connected"},
            self.config.timing.recovery_timeout_seconds,
            after=short_wifi_after,
        )
        if (
            not isinstance(heartbeat.payload, dict)
            or heartbeat.payload.get("wifi_connected") is not True
            or heartbeat.payload.get("mqtt_connected") is not True
        ):
            raise RuntimeError("post-outage heartbeat does not report Wi-Fi and MQTT connected")

        wifi_session = self._start_recovery_session("wifi-outage")
        wifi_after = time.time()
        self._router_hook("disable")
        time.sleep(self.config.timing.long_outage_seconds)
        self._router_hook("enable")
        if self.config.router.healthcheck_command:
            self._router_hook("healthcheck")
        self._wait_terminal_interruption(wifi_session, wifi_after)
        return "short reconnects and long terminal interruptions verified for MQTT and Wi-Fi"

    def _destructive(self) -> str:
        if not self.config.qualification.run_destructive:
            self.report.add("destructive", "turn-off and factory reset", "SKIP", "disabled by configuration", required=True)
            return "destructive checks skipped"
        if not self.serial:
            raise RuntimeError("serial capture is unavailable for destructive checks")

        turn_off_after = time.time()
        if self._guided("destructive", "turn off", "Long-press BUTTON_1 (GPIO4) for at least 3 seconds; confirm TURN_OFF indication and outputs become inactive."):
            line = self.serial.wait_for("TURN_OFF", 15, after=turn_off_after)
            if not line:
                raise RuntimeError("operator observed turn-off but serial never entered TURN_OFF")
            self.report.add("destructive", "TURN_OFF serial evidence", "PASS", line)

        reboot_after = time.time()
        if self._guided("destructive", "power-cycle persistence", "Power-cycle the device; confirm it reconnects without provisioning and retains calibration."):
            status = self.evidence.wait_for(
                lambda item: (
                    item.received_at >= reboot_after
                    and item.topic.endswith("/status")
                    and isinstance(item.payload, dict)
                    and item.payload.get("calibrated") is True
                    and item.payload.get("state") in {"READY_FOR_SESSION", "PAIRED_IDLE"}
                ),
                self.config.timing.provision_timeout_seconds,
                after=reboot_after,
            )
            if not status:
                raise RuntimeError("power-cycle did not publish preserved configuration/calibration status")
            self.report.add("destructive", "power-cycle persistence evidence", "PASS", str(status.payload))

        reset_after = time.time()
        if self._guided("destructive", "factory reset", "Long-press BUTTON_2 (GPIO5) for at least 3 seconds; confirm reset and return to PROVISIONING."):
            reset_line = self.serial.wait_for("RESETTING", 15, after=reset_after)
            provisioning_line = self.serial.wait_for(
                "PROVISIONING",
                self.config.timing.boot_timeout_seconds,
                after=reset_after,
            )
            if not reset_line or not provisioning_line:
                raise RuntimeError("factory reset did not provide RESETTING -> PROVISIONING serial evidence")
            self.report.add(
                "destructive",
                "factory reset serial evidence",
                "PASS",
                f"{reset_line}; {provisioning_line}",
            )
        return "operator observations corroborated by TURN_OFF, persistence, and reset evidence"

    def _restore(self) -> None:
        try:
            if self.router_touched and self.config.router.enable_command:
                self._router_hook("enable")
        except Exception as exc:
            self.report.add("cleanup", "restore router", "FAIL", str(exc))
        try:
            if self.wlan_touched and self.config.network.lan_profile:
                self.wifi.connect(self.config.network.lan_profile, ssid=self.config.network.wifi_ssid)
        except Exception as exc:
            self.report.add("cleanup", "restore host WLAN", "FAIL", str(exc))

    def run(self) -> int:
        try:
            if not self._record("preflight", "toolchain metadata", self._metadata):
                raise QualificationStop()
            if not self._record("preflight", "host and configuration", self._preflight):
                raise QualificationStop()
            if not self._record("deployment", "clean build and flash", self._build_and_flash):
                raise QualificationStop()
            if not self._record("deployment", "serial boot evidence", self._start_serial):
                raise QualificationStop()
            if not self._record("services", "backend, broker, MQTT monitor", self._start_services):
                raise QualificationStop()
            if not self._record("provisioning", "SoftAP provisioning and registration", self._provision):
                raise QualificationStop()
            self._record("protocol", "MQTT contracts", self._protocol)
            self._record("hardware", "guided hardware checks", self._hardware)
            self._record("calibration", "calibration lifecycle", self._calibration)
            self._record("session", "active-session lifecycle", self._session)
            self._record("recovery", "connectivity recovery", self._recovery)
            self._record("destructive", "terminal device actions", self._destructive)
        except QualificationStop:
            pass
        except KeyboardInterrupt:
            self.report.add("runner", "operator abort", "FAIL", "qualification interrupted by operator")
        finally:
            self._restore()
            if self.mqtt:
                self.mqtt.close()
            if self.backend:
                self.backend.close()
            if self.broker:
                self.broker.close()
            if self.serial:
                self.serial.close()
        return self._finish()

    def _finish(self) -> int:
        paths = self.report.write()
        print(f"\nOutcome: {self.report.outcome}")
        for kind, path in paths.items():
            print(f"{kind}: {path}")
        return 0 if self.report.outcome == "PASS" else 1
