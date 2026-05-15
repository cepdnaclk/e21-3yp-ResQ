#!/usr/bin/env python3
"""
ResQ Firmware Full MQTT/State Test Suite
========================================

Purpose
-------
This script creates a local test environment and runs automated checks against
ResQ firmware over HTTP registration + MQTT.

It is designed for the current ResQ firmware architecture:

    BOOT -> CONFIG_CHECK -> PROVISIONING -> WIFI_CONNECTING
    -> BACKEND_REGISTERING -> MQTT_CONNECTING -> PAIRED_IDLE
    -> CALIBRATING -> READY_FOR_SESSION / CALIBRATION_FAIL

It checks:
- mock backend registration
- MQTT connectivity
- firmware status/heartbeat/event publishing
- debug command/reply
- invalid calibration payload handling
- automatic calibration start handling
- calibration progress/result topics
- optional calibration cancel handling
- optional session start readiness gate
- topic namespace hygiene
- final pass/warn/fail report

Requirements
------------
Python:
    pip install paho-mqtt
Optional QR generation:
    pip install qrcode[pil]

System:
    Mosquitto installed, or pass --no-broker if broker already runs.

Windows examples
----------------
PowerShell Terminal 1:
    python .\resq_firmware_state_test.py `
      --wifi-ssid "Dialog 4G 7A5" `
      --wifi-pass "YOUR_PASSWORD" `
      --host-ip 192.168.8.187 `
      --topic-style short `
      --run-calibration `
      --cancel-calibration

Then provision the ESP from its AP page using printed values/QR.

Notes
-----
This test suite cannot physically guarantee sensor values. Calibration success
or failure depends on real sensor readings and manual pressure/compression.
The suite verifies that the firmware moves through the expected state/topic
flow and highlights missing MQTT responses, wrong topics, invalid state names,
timeouts, and rejected commands.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.server
import json
import os
import queue
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

try:
    import paho.mqtt.client as mqtt
except ImportError:  # pragma: no cover
    mqtt = None

try:
    import qrcode
except Exception:  # pragma: no cover
    qrcode = None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALL_RESQ_STATES = {
    "BOOT",
    "CONFIG_CHECK",
    "PROVISIONING",
    "FLUSH_CONFIG",
    "WIFI_CONNECTING",
    "BACKEND_REGISTERING",
    "MQTT_CONNECTING",
    "PAIRED_IDLE",
    "CALIBRATING",
    "CALIBRATION_FAIL",
    "READY_FOR_SESSION",
    "SESSION_ACTIVE",
    "SESSION_INTERRUPTED",
    "ERROR",
    "RESETTING",
    "TURN_OFF",
}

EXPECTED_BOOT_TO_IDLE = [
    "PROVISIONING",
    "WIFI_CONNECTING",
    "BACKEND_REGISTERING",
    "MQTT_CONNECTING",
    "PAIRED_IDLE",
]

CALIBRATION_PROGRESS_STEPS = {
    "CALIBRATION_STARTED",
    "WAITING_REF_PRESSURE",
    "REF_PRESSURE_MATCHED",
    "WAITING_BLADDER_1_PRESSURE",
    "BLADDER_1_PRESSURE_MATCHED",
    "WAITING_BLADDER_2_PRESSURE",
    "BLADDER_2_PRESSURE_MATCHED",
    "HALL_BASELINE_CAPTURED",
    "WAITING_FULL_PRESS",
    "FULL_PRESS_CAPTURED",
    "CALIBRATION_SAVED",
    "CALIBRATION_FAILED",
}

REGISTER_PATHS = {
    "/register",
    "/api/register",
    "/api/devices/register",
    "/api/device/register",
    "/api/manikins/register",
    "/api/firmware/register",
    "/api/v1/devices/register",
    "/api/v1/manikins/register",
}

DEFAULT_BACKEND_PORT = 18080
DEFAULT_MQTT_PORT = 1883
DEFAULT_MQTT_WS_PORT = 9001


# ---------------------------------------------------------------------------
# Basic helpers
# ---------------------------------------------------------------------------

def now_ms() -> int:
    return int(time.time() * 1000)


def now_iso() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def log(section: str, message: str) -> None:
    print(f"[{now_iso()}] [{section:<8}] {message}", flush=True)


def safe_json_loads(raw: bytes | str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
    if not text.strip():
        return {}, None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed, None
        return None, "JSON payload is not an object"
    except Exception as exc:
        return None, f"Invalid JSON: {exc}; raw={text!r}"


def local_ip_guess() -> str:
    candidates: List[str] = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.2)
        sock.connect(("8.8.8.8", 80))
        candidates.append(sock.getsockname()[0])
        sock.close()
    except Exception:
        pass

    try:
        host = socket.gethostname()
        _, _, ips = socket.gethostbyname_ex(host)
        candidates.extend(ips)
    except Exception:
        pass

    for ip in candidates:
        if ip and "." in ip and not ip.startswith("127."):
            return ip
    return "127.0.0.1"


def port_is_open(host: str, port: int, timeout: float = 0.25) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def normalize_mac(value: str) -> str:
    compact = "".join(ch for ch in value.upper() if ch.isalnum())
    if len(compact) == 12:
        return ":".join(compact[i : i + 2] for i in range(0, 12, 2))
    return value


def device_id_from_mac(mac: str) -> str:
    compact = "".join(ch for ch in mac.upper() if ch.isalnum())
    if len(compact) >= 6:
        return f"resq-node-{compact[-6:].lower()}"
    digest = hashlib.sha1((mac or str(time.time())).encode()).hexdigest()[:6]
    return f"resq-node-{digest}"


def get_field(data: Dict[str, Any], *names: str, default: Any = "") -> Any:
    for name in names:
        value = data.get(name)
        if value not in (None, ""):
            return value
    return default


def create_mqtt_client(client_id: str) -> Any:
    if mqtt is None:
        raise RuntimeError("Missing paho-mqtt. Install with: pip install paho-mqtt")
    try:
        return mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    except Exception:
        return mqtt.Client(client_id=client_id)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class MqttMessage:
    topic: str
    payload_text: str
    payload_json: Dict[str, Any]
    ts_ms: int = field(default_factory=now_ms)


@dataclass
class DeviceRecord:
    device_id: str
    device_mac: str = ""
    register_count: int = 0
    first_seen_ms: int = field(default_factory=now_ms)
    last_seen_ms: int = field(default_factory=now_ms)
    last_state: str = ""
    observed_states: List[str] = field(default_factory=list)
    status_count: int = 0
    heartbeat_count: int = 0
    event_count: int = 0
    calibration_progress_count: int = 0
    calibration_result_count: int = 0
    error_count: int = 0
    debug_count: int = 0
    telemetry_count: int = 0
    raw_topics: List[str] = field(default_factory=list)


@dataclass
class TestResult:
    name: str
    status: str  # PASS / WARN / FAIL / SKIP
    message: str
    details: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "message": self.message,
            "details": self.details,
        }


@dataclass
class HarnessContext:
    host_ip: str
    backend_port: int
    mqtt_port: int
    mqtt_ws_port: int
    topic_style: str
    devices: Dict[str, DeviceRecord] = field(default_factory=dict)
    devices_lock: threading.Lock = field(default_factory=threading.Lock)
    mqtt_client: Any = None

    def backend_register_url(self) -> str:
        return f"http://{self.host_ip}:{self.backend_port}/api/devices/register"

    def topic_prefix(self, device_id: str, style: Optional[str] = None) -> str:
        selected = style or self.topic_style
        if selected == "canonical":
            return f"resq/manikins/{device_id}"
        return f"resq/{device_id}"

    def topic(self, device_id: str, suffix: str, style: Optional[str] = None) -> str:
        return f"{self.topic_prefix(device_id, style)}/{suffix.lstrip('/')}"

    def upsert_device(self, device_id: str, device_mac: str = "") -> DeviceRecord:
        with self.devices_lock:
            record = self.devices.get(device_id)
            if record is None:
                record = DeviceRecord(device_id=device_id)
                self.devices[device_id] = record
            if device_mac:
                record.device_mac = normalize_mac(device_mac)
            record.last_seen_ms = now_ms()
            return record

    def snapshot_devices(self) -> List[DeviceRecord]:
        with self.devices_lock:
            return list(self.devices.values())


# ---------------------------------------------------------------------------
# Message store
# ---------------------------------------------------------------------------

class MessageStore:
    def __init__(self) -> None:
        self._messages: List[MqttMessage] = []
        self._cv = threading.Condition()

    def add(self, message: MqttMessage) -> None:
        with self._cv:
            self._messages.append(message)
            self._cv.notify_all()

    def snapshot(self) -> List[MqttMessage]:
        with self._cv:
            return list(self._messages)

    def wait_for(
        self,
        predicate: Callable[[MqttMessage], bool],
        timeout: float,
        after_ms: Optional[int] = None,
    ) -> Optional[MqttMessage]:
        deadline = time.time() + timeout
        with self._cv:
            while True:
                for msg in self._messages:
                    if after_ms is not None and msg.ts_ms < after_ms:
                        continue
                    if predicate(msg):
                        return msg
                remaining = deadline - time.time()
                if remaining <= 0:
                    return None
                self._cv.wait(timeout=min(0.25, remaining))

    def find_all(
        self,
        predicate: Callable[[MqttMessage], bool],
        after_ms: Optional[int] = None,
    ) -> List[MqttMessage]:
        with self._cv:
            out: List[MqttMessage] = []
            for msg in self._messages:
                if after_ms is not None and msg.ts_ms < after_ms:
                    continue
                if predicate(msg):
                    out.append(msg)
            return out


# ---------------------------------------------------------------------------
# Backend server
# ---------------------------------------------------------------------------

class ResQBackendHandler(http.server.BaseHTTPRequestHandler):
    server_version = "ResQTestBackend/1.0"

    def _ctx(self) -> HarnessContext:
        return self.server.ctx  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:
        log("HTTP", fmt % args)

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        encoded = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(encoded)

    def _read_json(self) -> Tuple[Optional[Dict[str, Any]], Optional[str], str]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b""
        parsed, err = safe_json_loads(raw)
        return parsed, err, raw.decode("utf-8", errors="replace")

    def do_OPTIONS(self) -> None:
        self._send_json(200, {"ok": True})

    def do_GET(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path in {"/", "/health", "/api/hub/health"}:
            self._send_json(
                200,
                {
                    "ok": True,
                    "service": "resq-firmware-test-backend",
                    "time": now_iso(),
                    "register_url": self._ctx().backend_register_url(),
                    "mqtt_host": self._ctx().host_ip,
                    "mqtt_port": self._ctx().mqtt_port,
                    "devices": len(self._ctx().devices),
                },
            )
            return

        if path in {"/api/devices", "/api/test/devices"}:
            self._send_json(
                200,
                {
                    "ok": True,
                    "devices": [d.__dict__ for d in self._ctx().snapshot_devices()],
                },
            )
            return

        self._send_json(404, {"ok": False, "error": f"not found: {path}"})

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path in REGISTER_PATHS or path.endswith("/register"):
            self._handle_register(path)
            return
        self._send_json(404, {"ok": False, "error": f"not found: {path}"})

    def _handle_register(self, path: str) -> None:
        data, err, raw = self._read_json()
        if err:
            self._send_json(400, {"ok": False, "error": err})
            return

        data = data or {}
        device_mac = normalize_mac(str(get_field(data, "device_mac", "mac", "mac_address", default="")).strip())
        incoming_device_id = str(get_field(data, "device_id", "deviceId", default="")).strip()
        if not device_mac and not incoming_device_id:
            self._send_json(
                400,
                {"ok": False, "error": "device_mac or device_id required", "received": data},
            )
            return

        device_id = incoming_device_id or device_id_from_mac(device_mac)
        record = self._ctx().upsert_device(device_id, device_mac)
        record.register_count += 1
        log("REG", f"path={path} assigned_device_id={device_id} body={raw}")

        self._send_json(
            200,
            {
                "ok": True,
                "status": "registered",
                "device_id": device_id,
                "mqtt_host": self._ctx().host_ip,
                "mqtt_port": self._ctx().mqtt_port,
                "ts_ms": now_ms(),
            },
        )


class BackendServer:
    def __init__(self, ctx: HarnessContext) -> None:
        self.ctx = ctx
        self.httpd: Optional[http.server.ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self.httpd = http.server.ThreadingHTTPServer(("0.0.0.0", self.ctx.backend_port), ResQBackendHandler)
        self.httpd.ctx = self.ctx  # type: ignore[attr-defined]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        log("HTTP", f"backend listening on http://0.0.0.0:{self.ctx.backend_port}")

    def stop(self) -> None:
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            log("HTTP", "backend stopped")


# ---------------------------------------------------------------------------
# Mosquitto broker manager
# ---------------------------------------------------------------------------

class BrokerProcess:
    def __init__(self, mqtt_port: int, ws_port: int, mosquitto_path: str = "") -> None:
        self.mqtt_port = mqtt_port
        self.ws_port = ws_port
        self.mosquitto_path = mosquitto_path
        self.process: Optional[subprocess.Popen[str]] = None
        self.tempdir: Optional[tempfile.TemporaryDirectory[str]] = None

    def _find_mosquitto(self) -> Optional[str]:
        if self.mosquitto_path:
            return self.mosquitto_path
        found = shutil.which("mosquitto")
        if found:
            return found
        for candidate in [
            r"C:\Program Files\mosquitto\mosquitto.exe",
            r"C:\Program Files (x86)\mosquitto\mosquitto.exe",
        ]:
            if Path(candidate).exists():
                return candidate
        return None

    def start_or_reuse(self, host_ip: str) -> None:
        if port_is_open("127.0.0.1", self.mqtt_port) and port_is_open(host_ip, self.mqtt_port):
            log("MQTT", f"broker already reachable on localhost and {host_ip}:{self.mqtt_port}; reusing")
            return

        exe = self._find_mosquitto()
        if not exe:
            raise RuntimeError("Mosquitto not found. Install Mosquitto or pass --mosquitto-path / --no-broker.")

        self.tempdir = tempfile.TemporaryDirectory(prefix="resq_mosquitto_test_")
        base = Path(self.tempdir.name)
        data_dir = base / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        conf_path = base / "mosquitto.conf"
        conf_path.write_text(
            "\n".join(
                [
                    "persistence true",
                    f"persistence_location {data_dir.as_posix()}/",
                    "log_dest stdout",
                    f"listener {self.mqtt_port} 0.0.0.0",
                    "protocol mqtt",
                    "allow_anonymous true",
                    f"listener {self.ws_port} 0.0.0.0",
                    "protocol websockets",
                    "allow_anonymous true",
                    "",
                ]
            ),
            encoding="utf-8",
        )

        cmd = [exe, "-c", str(conf_path), "-v"]
        log("MQTT", "starting broker: " + " ".join(f'\"{x}\"' if " " in x else x for x in cmd))
        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self._pipe_logs, daemon=True).start()

        deadline = time.time() + 10
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"Mosquitto exited early with code {self.process.returncode}")
            if port_is_open("127.0.0.1", self.mqtt_port):
                log("MQTT", f"broker ready on port {self.mqtt_port}")
                return
            time.sleep(0.2)
        raise RuntimeError("Mosquitto did not become ready within 10 seconds")

    def _pipe_logs(self) -> None:
        if not self.process or not self.process.stdout:
            return
        for line in self.process.stdout:
            line = line.rstrip()
            if line:
                log("BROKER", line)

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            log("MQTT", "stopping broker")
            try:
                self.process.terminate()
                self.process.wait(timeout=5)
            except Exception:
                self.process.kill()
        if self.tempdir:
            self.tempdir.cleanup()


# ---------------------------------------------------------------------------
# MQTT monitor
# ---------------------------------------------------------------------------

class MqttMonitor:
    def __init__(self, ctx: HarnessContext, store: MessageStore, monitor_host: str) -> None:
        self.ctx = ctx
        self.store = store
        self.monitor_host = monitor_host
        self.client = create_mqtt_client(f"resq-full-test-{os.getpid()}")
        self.ctx.mqtt_client = self.client
        self.connected = threading.Event()
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def start(self) -> None:
        self.client.connect(self.monitor_host, self.ctx.mqtt_port, keepalive=30)
        self.client.loop_start()
        if not self.connected.wait(timeout=10):
            raise RuntimeError("MQTT monitor could not connect")

    def stop(self) -> None:
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass

    def _subscriptions(self) -> List[str]:
        subs: List[str] = []
        # Subscribe broadly so nested topics such as events/calibration/progress are not missed.
        if self.ctx.topic_style in {"short", "both"}:
            subs.append("resq/+/+#")  # invalid in MQTT, kept out below by fallback
            subs.append("resq/#")
        if self.ctx.topic_style in {"canonical", "both"}:
            subs.append("resq/manikins/#")
        # Deduplicate and remove accidental invalid filters.
        valid = []
        for s in subs:
            if "+#" in s:
                continue
            if s not in valid:
                valid.append(s)
        return valid

    def _on_connect(self, client: Any, userdata: Any, flags: Any, *args: Any) -> None:
        rc = 0
        if args:
            try:
                rc = int(args[0])
            except Exception:
                rc = 0
        if rc == 0:
            log("MQTT", "monitor connected")
            for sub in self._subscriptions():
                client.subscribe(sub, qos=0)
                log("MQTT", f"subscribed {sub}")
            self.connected.set()
        else:
            log("MQTT", f"monitor connection failed rc={rc}")

    def _on_disconnect(self, client: Any, userdata: Any, *args: Any) -> None:
        log("MQTT", "monitor disconnected")

    def _parse_topic(self, topic: str) -> Tuple[Optional[str], str]:
        parts = topic.split("/")
        if len(parts) >= 3 and parts[0] == "resq" and parts[1] != "manikins":
            return parts[1], "/".join(parts[2:])
        if len(parts) >= 4 and parts[0] == "resq" and parts[1] == "manikins":
            return parts[2], "/".join(parts[3:])
        return None, ""

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        payload_text = msg.payload.decode("utf-8", errors="replace")
        data, err = safe_json_loads(payload_text)
        if err:
            data = {}
        message = MqttMessage(topic=msg.topic, payload_text=payload_text, payload_json=data or {})
        self.store.add(message)
        self._update_device_record(message)
        compact = json.dumps(message.payload_json, separators=(",", ":")) if message.payload_json else payload_text
        log("RX", f"{msg.topic} {compact}")

    def _update_device_record(self, message: MqttMessage) -> None:
        topic_device, suffix = self._parse_topic(message.topic)
        data = message.payload_json
        device_id = str(get_field(data, "device_id", "deviceId", default=topic_device or "")).strip()
        if not device_id:
            return
        record = self.ctx.upsert_device(device_id, str(get_field(data, "device_mac", "mac", default="")))
        if message.topic not in record.raw_topics:
            record.raw_topics.append(message.topic)
        if suffix == "status":
            record.status_count += 1
            state = str(get_field(data, "state", default="")).strip()
            if state:
                record.last_state = state
                if state not in record.observed_states:
                    record.observed_states.append(state)
                if state in ALL_RESQ_STATES:
                    log("STATE", f"{device_id} -> {state}")
                else:
                    log("WARN", f"unknown state from {device_id}: {state}")
        elif suffix == "heartbeat":
            record.heartbeat_count += 1
        elif suffix == "debug":
            record.debug_count += 1
        elif suffix == "telemetry":
            record.telemetry_count += 1
        elif suffix.startswith("events/calibration/progress"):
            record.calibration_progress_count += 1
        elif suffix.startswith("events/calibration/result"):
            record.calibration_result_count += 1
        elif suffix.startswith("events/error"):
            record.error_count += 1
        elif suffix.startswith("events"):
            record.event_count += 1

    def publish_command(self, device_id: str, suffix: str, payload: Dict[str, Any]) -> str:
        topic = self.ctx.topic(device_id, suffix)
        text = json.dumps(payload, separators=(",", ":"))
        result = self.client.publish(topic, text, qos=1, retain=False)
        log("TX", f"{topic} {text} rc={getattr(result, 'rc', None)}")
        return topic


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

class FirmwareTestRunner:
    def __init__(self, ctx: HarnessContext, monitor: MqttMonitor, store: MessageStore, args: argparse.Namespace) -> None:
        self.ctx = ctx
        self.monitor = monitor
        self.store = store
        self.args = args
        self.results: List[TestResult] = []
        self.device_id: Optional[str] = args.device_id or None

    def add(self, name: str, status: str, message: str, **details: Any) -> None:
        self.results.append(TestResult(name=name, status=status, message=message, details=details))
        marker = {"PASS": "✅", "WARN": "⚠️", "FAIL": "❌", "SKIP": "⏭️"}.get(status, "•")
        log("TEST", f"{marker} {name}: {status} - {message}")

    def run_all(self) -> List[TestResult]:
        self.test_preflight()
        self.test_device_discovery()
        if not self.device_id:
            self.write_report()
            return self.results

        self.test_boot_to_idle_visibility()
        self.test_topic_hygiene()
        self.test_status_and_heartbeat_schema()
        self.test_debug_command()

        if self.args.edge_tests:
            self.test_unknown_command_nack()
            self.test_invalid_json_command()
            self.test_calibration_cancel_while_idle()
            self.test_invalid_calibration_payload()
            self.test_calibration_zero_negative_payloads()
            self.test_session_start_gate()
        else:
            self.add("edge_cases", "SKIP", "Skipped command edge cases; pass --edge-tests to enable")

        if self.args.run_calibration:
            self.test_valid_calibration_flow()
        else:
            self.add("valid_calibration_flow", "SKIP", "Skipped; pass --run-calibration to test automatic calibration")

        if self.args.test_session_start and not self.args.edge_tests:
            self.test_session_start_gate()

        self.test_no_command_echo_misclassified()
        self.write_report()
        return self.results

    def test_preflight(self) -> None:
        broker_ok = port_is_open(self.args.mqtt_monitor_host or self.ctx.host_ip, self.ctx.mqtt_port) or port_is_open("127.0.0.1", self.ctx.mqtt_port)
        backend_ok = port_is_open("127.0.0.1", self.ctx.backend_port)
        if broker_ok and backend_ok:
            self.add("preflight_services", "PASS", "Backend and MQTT broker are reachable")
        else:
            self.add("preflight_services", "FAIL", "Backend or broker is not reachable", broker_ok=broker_ok, backend_ok=backend_ok)

    def test_device_discovery(self) -> None:
        if self.device_id:
            self.ctx.upsert_device(self.device_id)
            self.add("device_discovery", "PASS", f"Using device_id from --device-id: {self.device_id}")
            return

        deadline = time.time() + self.args.device_timeout
        while time.time() < deadline:
            devices = self.ctx.snapshot_devices()
            if devices:
                # Prefer a device that published status, then any registered device.
                devices.sort(key=lambda d: (d.status_count, d.register_count), reverse=True)
                self.device_id = devices[0].device_id
                self.add("device_discovery", "PASS", f"Discovered device: {self.device_id}")
                return
            time.sleep(0.5)

        self.add(
            "device_discovery",
            "FAIL",
            "No device registered or published MQTT messages before timeout. Provision ESP using printed values/QR.",
            timeout_s=self.args.device_timeout,
        )

    def _topic_device_suffix(self, topic: str) -> Tuple[Optional[str], str]:
        parts = topic.split("/")
        if len(parts) >= 3 and parts[0] == "resq" and parts[1] != "manikins":
            return parts[1], "/".join(parts[2:])
        if len(parts) >= 4 and parts[0] == "resq" and parts[1] == "manikins":
            return parts[2], "/".join(parts[3:])
        return None, ""

    def _topic_suffix(self, msg: MqttMessage) -> str:
        return self._topic_device_suffix(msg.topic)[1]

    def _is_command_topic(self, msg: MqttMessage) -> bool:
        return self._topic_suffix(msg).startswith("cmd/")

    def _device_topic_predicate(self, suffix: str, event_type: Optional[str] = None) -> Callable[[MqttMessage], bool]:
        def pred(msg: MqttMessage) -> bool:
            if not self.device_id:
                return False
            topic_device, topic_suffix = self._topic_device_suffix(msg.topic)
            if topic_device != self.device_id:
                return False
            # Never accept a command topic as a firmware reply. This prevents the monitor
            # from counting its own published command as the ESP response.
            if topic_suffix.startswith("cmd/"):
                return False
            if suffix and topic_suffix != suffix:
                return False
            if event_type:
                return str(msg.payload_json.get("event_type", "")) == event_type
            return True
        return pred

    def _wait_state(self, states: Iterable[str], timeout: float, after_ms: Optional[int] = None) -> Optional[MqttMessage]:
        wanted = set(states)
        return self.store.wait_for(
            lambda m: (
                bool(self.device_id)
                and self._topic_device_suffix(m.topic)[0] == self.device_id
                and self._topic_suffix(m) == "status"
                and str(m.payload_json.get("state", "")) in wanted
            ),
            timeout=timeout,
            after_ms=after_ms,
        )

    def test_boot_to_idle_visibility(self) -> None:
        if not self.device_id:
            return
        idle = self._wait_state({"PAIRED_IDLE", "READY_FOR_SESSION"}, timeout=self.args.idle_timeout)
        record = self.ctx.devices.get(self.device_id)
        if idle:
            self.add("boot_to_idle", "PASS", "Firmware reached PAIRED_IDLE or READY_FOR_SESSION", state=idle.payload_json.get("state"))
        elif record and record.observed_states:
            self.add("boot_to_idle", "WARN", "Device seen but idle state not observed before timeout", observed_states=record.observed_states)
        else:
            self.add("boot_to_idle", "FAIL", "No status state observed before timeout")

        if record:
            unknown = [s for s in record.observed_states if s not in ALL_RESQ_STATES]
            if unknown:
                self.add("known_state_names", "FAIL", "Firmware published unknown state names", unknown_states=unknown)
            else:
                self.add("known_state_names", "PASS", "All observed state names are recognized", observed_states=record.observed_states)

    def test_topic_hygiene(self) -> None:
        if not self.device_id:
            return
        msgs = self.store.snapshot()
        short_seen = any(m.topic.startswith(f"resq/{self.device_id}/") for m in msgs)
        canonical_seen = any(m.topic.startswith(f"resq/manikins/{self.device_id}/") for m in msgs)
        if self.ctx.topic_style == "short" and canonical_seen:
            self.add("topic_hygiene", "FAIL", "Canonical resq/manikins topic seen while topic-style is short")
        elif self.ctx.topic_style == "canonical" and short_seen:
            self.add("topic_hygiene", "FAIL", "Short resq/{deviceId} topic seen while topic-style is canonical")
        else:
            self.add("topic_hygiene", "PASS", "Topic namespace matches selected style", short_seen=short_seen, canonical_seen=canonical_seen)

    def test_status_and_heartbeat_schema(self) -> None:
        if not self.device_id:
            return
        msgs = self.store.snapshot()
        status_msgs = [
            m for m in msgs
            if self._topic_device_suffix(m.topic)[0] == self.device_id and self._topic_suffix(m) == "status"
        ]
        heartbeat_msgs = [
            m for m in msgs
            if self._topic_device_suffix(m.topic)[0] == self.device_id and self._topic_suffix(m) == "heartbeat"
        ]

        if not status_msgs:
            self.add("status_schema", "WARN", "No status payload observed yet")
        else:
            latest = status_msgs[-1].payload_json
            missing = [k for k in ["device_id", "state"] if k not in latest and k.replace("_", "") not in latest]
            state = str(latest.get("state", ""))
            if missing:
                self.add("status_schema", "WARN", "Latest status missing expected fields", missing=missing, payload=latest)
            elif state not in ALL_RESQ_STATES:
                self.add("status_schema", "FAIL", "Latest status has unknown state", state=state, payload=latest)
            else:
                self.add("status_schema", "PASS", "Latest status payload has recognized state", state=state)

        if not heartbeat_msgs:
            self.add("heartbeat_schema", "WARN", "No heartbeat observed yet")
        else:
            latest = heartbeat_msgs[-1].payload_json
            expected_any = [
                "device_id",
                "wifi_connected",
                "mqtt_connected",
                "session_active",
                "sensor_running",
                "calibrated",
            ]
            present = [k for k in expected_any if k in latest]
            if len(present) >= 3:
                self.add("heartbeat_schema", "PASS", "Heartbeat includes useful health fields", present=present, payload=latest)
            else:
                self.add("heartbeat_schema", "WARN", "Heartbeat observed but has few expected health fields", present=present, payload=latest)

    def test_no_command_echo_misclassified(self) -> None:
        if not self.device_id:
            return
        command_msgs = [
            m.topic for m in self.store.snapshot()
            if self._topic_device_suffix(m.topic)[0] == self.device_id and self._is_command_topic(m)
        ]
        if command_msgs:
            self.add("command_echo_filter", "PASS", "Command topics were observed but ignored as firmware replies", command_topics=command_msgs[-5:])
        else:
            self.add("command_echo_filter", "PASS", "No command echo topics were captured as replies")

    def test_unknown_command_nack(self) -> None:
        if not self.device_id:
            return
        start = now_ms()
        command_id = f"cmd-unknown-{start}"
        payload = {
            "command_id": command_id,
            "event_type": "unknown_command_test",
            "issued_at_ms": start,
        }
        self.monitor.publish_command(self.device_id, "cmd/unknown/test", payload)
        msg = self.store.wait_for(
            lambda m: self._is_device_msg(m)
            and self._topic_suffix(m) in {"events", "events/error", "events/calibration/result"}
            and (
                command_id in str(m.payload_json.get("command_id", ""))
                or "unknown" in str(get_field(m.payload_json, "reason", "message", "error_code", default="")).lower()
                or str(m.payload_json.get("status", "")).upper() == "NACK"
            ),
            timeout=self.args.command_timeout,
            after_ms=start,
        )
        if not msg:
            self.add("unknown_command_nack", "WARN", "No explicit NACK/error for unknown command")
            return
        status = str(msg.payload_json.get("status", "")).upper()
        text = str(get_field(msg.payload_json, "reason", "message", "error_code", default="")).lower()
        if status == "NACK" or "unknown" in text:
            self.add("unknown_command_nack", "PASS", "Unknown command was rejected safely", topic=msg.topic, payload=msg.payload_json)
        else:
            self.add("unknown_command_nack", "WARN", "Unknown command response was unclear", topic=msg.topic, payload=msg.payload_json)

    def test_invalid_json_command(self) -> None:
        if not self.device_id:
            return
        start = now_ms()
        topic = self.ctx.topic(self.device_id, "cmd/calibration/start")
        bad_payload = '{"command_id":"cmd-bad-json","event_type":"calibration_start",'
        result = self.monitor.client.publish(topic, bad_payload, qos=1, retain=False)
        log("TX", f"{topic} {bad_payload} rc={getattr(result, 'rc', None)}")
        msg = self.store.wait_for(
            lambda m: self._is_device_msg(m)
            and self._topic_suffix(m) in {"events/error", "events"}
            and (
                "json" in str(get_field(m.payload_json, "reason", "message", "error_code", default="")).lower()
                or str(m.payload_json.get("status", "")).upper() == "NACK"
            ),
            timeout=self.args.command_timeout,
            after_ms=start,
        )
        state_error = self._wait_state({"ERROR"}, timeout=1.0, after_ms=start)
        if state_error:
            self.add("invalid_json_command", "FAIL", "Invalid JSON pushed firmware to ERROR; should reject command safely")
        elif msg:
            self.add("invalid_json_command", "PASS", "Invalid JSON produced safe error/NACK", topic=msg.topic, payload=msg.payload_json)
        else:
            self.add("invalid_json_command", "WARN", "No explicit error observed for invalid JSON command")

    def test_calibration_cancel_while_idle(self) -> None:
        if not self.device_id:
            return
        start = now_ms()
        payload = {
            "command_id": f"cmd-cancel-idle-{start}",
            "event_type": "calibration_cancel",
            "issued_at_ms": start,
        }
        self.monitor.publish_command(self.device_id, "cmd/calibration/cancel", payload)
        msg = self.store.wait_for(
            lambda m: self._is_device_msg(m)
            and self._topic_suffix(m) in {"events", "events/calibration/result", "events/error", "status"}
            and (
                "cancel" in json.dumps(m.payload_json).lower()
                or str(m.payload_json.get("state", "")) in {"PAIRED_IDLE", "READY_FOR_SESSION"}
            ),
            timeout=self.args.command_timeout,
            after_ms=start,
        )
        if msg:
            self.add("calibration_cancel_while_idle", "PASS", "Cancel while idle was handled safely", topic=msg.topic, payload=msg.payload_json)
        else:
            self.add("calibration_cancel_while_idle", "WARN", "No response to cancel while idle; acceptable only if firmware intentionally ignores it")

    def test_calibration_zero_negative_payloads(self) -> None:
        if not self.device_id:
            return
        cases = [
            ("zero_hall_delta", {"hall_delta": 0, "ref_pressure": self.args.ref_pressure, "bladder_1_pressure": self.args.bladder_1_pressure, "bladder_2_pressure": self.args.bladder_2_pressure}),
            ("negative_ref_pressure", {"hall_delta": self.args.hall_delta, "ref_pressure": -1, "bladder_1_pressure": self.args.bladder_1_pressure, "bladder_2_pressure": self.args.bladder_2_pressure}),
            ("zero_bladder_1", {"hall_delta": self.args.hall_delta, "ref_pressure": self.args.ref_pressure, "bladder_1_pressure": 0, "bladder_2_pressure": self.args.bladder_2_pressure}),
            ("zero_bladder_2", {"hall_delta": self.args.hall_delta, "ref_pressure": self.args.ref_pressure, "bladder_1_pressure": self.args.bladder_1_pressure, "bladder_2_pressure": 0}),
            ("wrong_event_type", {"event_type": "not_calibration_start", "hall_delta": self.args.hall_delta, "ref_pressure": self.args.ref_pressure, "bladder_1_pressure": self.args.bladder_1_pressure, "bladder_2_pressure": self.args.bladder_2_pressure}),
        ]
        failures: List[Dict[str, Any]] = []
        passes = 0
        for name, fields in cases:
            start = now_ms()
            command_id = f"cmd-edge-{name}-{start}"
            payload = {
                "command_id": command_id,
                "event_type": "calibration_start",
                "issued_at_ms": start,
            }
            payload.update(fields)
            self.monitor.publish_command(self.device_id, "cmd/calibration/start", payload)
            msg = self.store.wait_for(
                lambda m, cid=command_id: self._is_device_msg(m)
                and self._topic_suffix(m) in {"events/error", "events", "events/calibration/result"}
                and (
                    cid in str(m.payload_json.get("command_id", ""))
                    or str(m.payload_json.get("status", "")).upper() == "NACK"
                    or "invalid" in str(get_field(m.payload_json, "reason", "message", "error_code", default="")).lower()
                ),
                timeout=self.args.command_timeout,
                after_ms=start,
            )
            state_error = self._wait_state({"ERROR"}, timeout=0.5, after_ms=start)
            if state_error:
                failures.append({"case": name, "reason": "firmware entered ERROR"})
            elif msg:
                status = str(msg.payload_json.get("status", "")).upper()
                text = json.dumps(msg.payload_json).lower()
                if status == "NACK" or "invalid" in text or "error" in self._topic_suffix(msg):
                    passes += 1
                else:
                    failures.append({"case": name, "reason": "unclear response", "payload": msg.payload_json})
            else:
                failures.append({"case": name, "reason": "no response"})
            time.sleep(0.2)
        if failures:
            self.add("calibration_payload_edge_cases", "WARN", "Some invalid calibration payload cases were not clearly rejected", passed=passes, failures=failures)
        else:
            self.add("calibration_payload_edge_cases", "PASS", "Invalid calibration payload edge cases were safely rejected", passed=passes)

    def test_debug_command(self) -> None:
        if not self.device_id:
            return
        start = now_ms()
        payload = {
            "command_id": f"cmd-debug-{start}",
            "event_type": "debug_req",
            "issued_at_ms": start,
        }
        self.monitor.publish_command(self.device_id, "cmd/debug", payload)
        msg = self.store.wait_for(self._device_topic_predicate("debug"), timeout=self.args.command_timeout, after_ms=start)
        if not msg:
            self.add("cmd_debug", "FAIL", "No debug payload received after cmd/debug", timeout_s=self.args.command_timeout)
            return
        required = {"pressure_0_raw", "pressure_1_raw", "pressure_2_raw", "hall_raw"}
        missing = sorted(k for k in required if k not in msg.payload_json)
        if missing:
            self.add("cmd_debug", "WARN", "Debug payload received but missing expected raw fields", missing=missing, payload=msg.payload_json)
        else:
            self.add("cmd_debug", "PASS", "Debug payload received with raw pressure/Hall fields", payload=msg.payload_json)

    def test_invalid_calibration_payload(self) -> None:
        if not self.device_id or self.args.skip_invalid_calibration:
            self.add("invalid_calibration_payload", "SKIP", "Skipped invalid calibration test")
            return
        start = now_ms()
        payload = {
            "command_id": f"cmd-invalid-cal-{start}",
            "event_type": "calibration_start",
            # Missing hall_delta/ref_pressure/bladder fields intentionally.
            "issued_at_ms": start,
        }
        self.monitor.publish_command(self.device_id, "cmd/calibration/start", payload)
        result_msg = self.store.wait_for(
            lambda m: self._matches_calibration_result_or_error(m, after_command="cmd-invalid-cal"),
            timeout=self.args.command_timeout,
            after_ms=start,
        )
        state_error = self._wait_state({"ERROR"}, timeout=1.0, after_ms=start)
        if state_error:
            self.add("invalid_calibration_payload", "FAIL", "Invalid payload moved firmware to ERROR; should NACK and stay idle")
            return
        if not result_msg:
            self.add("invalid_calibration_payload", "WARN", "No explicit NACK/error seen for invalid calibration payload")
            return
        payload_json = result_msg.payload_json
        status = str(get_field(payload_json, "status", default="")).upper()
        message = str(get_field(payload_json, "message", "reason", "error_code", default=""))
        if "NACK" in status or "invalid" in message.lower() or result_msg.topic.endswith("events/error"):
            self.add("invalid_calibration_payload", "PASS", "Invalid calibration payload produced NACK/error without ERROR state", topic=result_msg.topic, payload=payload_json)
        else:
            self.add("invalid_calibration_payload", "WARN", "Invalid payload response did not clearly indicate NACK", topic=result_msg.topic, payload=payload_json)

    def _matches_calibration_result_or_error(self, msg: MqttMessage, after_command: str = "") -> bool:
        if not self._is_device_msg(msg):
            return False
        suffix = self._topic_suffix(msg)
        if suffix in {"events/calibration/result", "events/error", "events"}:
            if after_command:
                command_id = str(msg.payload_json.get("command_id", ""))
                if command_id and after_command not in command_id:
                    # Still accept generic error if no command_id exists.
                    return suffix == "events/error" or str(msg.payload_json.get("event_type", "")).endswith("error")
            return True
        return False

    def test_valid_calibration_flow(self) -> None:
        if not self.device_id:
            return
        start = now_ms()
        command_id = f"cmd-cal-{start}"
        payload = {
            "command_id": command_id,
            "event_type": "calibration_start",
            "hall_delta": self.args.hall_delta,
            "ref_pressure": self.args.ref_pressure,
            "bladder_1_pressure": self.args.bladder_1_pressure,
            "bladder_2_pressure": self.args.bladder_2_pressure,
            "issued_at_ms": start,
        }
        self.monitor.publish_command(self.device_id, "cmd/calibration/start", payload)

        started = self.store.wait_for(
            lambda m: (
                self._is_device_msg(m)
                and (
                    str(m.payload_json.get("state", "")) == "CALIBRATING"
                    or str(m.payload_json.get("result", "")).upper() in {"STARTED", "PASS", "FAIL"}
                    or str(m.payload_json.get("step", "")) == "CALIBRATION_STARTED"
                )
            ),
            timeout=self.args.command_timeout,
            after_ms=start,
        )
        if not started:
            self.add("valid_calibration_start", "FAIL", "No CALIBRATING/status/progress/result observed after valid calibration command")
            return
        self.add("valid_calibration_start", "PASS", "Firmware acknowledged or entered calibration flow", topic=started.topic, payload=started.payload_json)

        if self.args.cancel_calibration:
            time.sleep(max(0.5, self.args.cancel_after))
            cancel_start = now_ms()
            cancel_payload = {
                "command_id": f"cmd-cancel-{cancel_start}",
                "event_type": "calibration_cancel",
                "issued_at_ms": cancel_start,
            }
            self.monitor.publish_command(self.device_id, "cmd/calibration/cancel", cancel_payload)
            cancel_seen = self.store.wait_for(
                lambda m: self._is_device_msg(m)
                and (
                    str(m.payload_json.get("result", "")).upper() == "CANCELLED"
                    or str(m.payload_json.get("message", "")).lower().find("cancel") >= 0
                    or str(m.payload_json.get("state", "")) == "PAIRED_IDLE"
                ),
                timeout=self.args.command_timeout,
                after_ms=cancel_start,
            )
            if cancel_seen:
                self.add("calibration_cancel", "PASS", "Calibration cancel response/status observed", topic=cancel_seen.topic, payload=cancel_seen.payload_json)
            else:
                self.add("calibration_cancel", "WARN", "No clear cancel response observed")
            return

        end_state = self._wait_state({"READY_FOR_SESSION", "CALIBRATION_FAIL"}, timeout=self.args.calibration_timeout, after_ms=start)
        progress = self.store.find_all(lambda m: self._is_device_msg(m) and self._topic_suffix(m) == "events/calibration/progress", after_ms=start)
        result = self.store.find_all(lambda m: self._is_device_msg(m) and self._topic_suffix(m) == "events/calibration/result", after_ms=start)
        progress_steps = [str(m.payload_json.get("step", "")) for m in progress if m.payload_json.get("step")]
        invalid_steps = sorted(set(s for s in progress_steps if s not in CALIBRATION_PROGRESS_STEPS))

        if invalid_steps:
            self.add("calibration_progress_steps", "FAIL", "Unknown calibration progress step names observed", invalid_steps=invalid_steps)
        elif progress:
            self.add("calibration_progress_steps", "PASS", "Calibration progress events observed with valid step names", steps=progress_steps)
        else:
            self.add("calibration_progress_steps", "WARN", "No calibration progress events observed")

        if end_state:
            final_state = str(end_state.payload_json.get("state", ""))
            status = "PASS" if final_state == "READY_FOR_SESSION" else "WARN"
            message = "Calibration finished successfully" if final_state == "READY_FOR_SESSION" else "Calibration ended in CALIBRATION_FAIL; check sensor/manual input"
            self.add("calibration_final_state", status, message, final_state=final_state, result_count=len(result))
        else:
            self.add("calibration_final_state", "WARN", "No READY_FOR_SESSION or CALIBRATION_FAIL before timeout; calibration may still be waiting for physical input", timeout_s=self.args.calibration_timeout, progress_steps=progress_steps)

    def _is_device_msg(self, msg: MqttMessage) -> bool:
        if not self.device_id:
            return False
        return self._topic_device_suffix(msg.topic)[0] == self.device_id and not self._is_command_topic(msg)

    def test_session_start_gate(self) -> None:
        if not self.device_id:
            return
        start = now_ms()
        payload = {
            "command_id": f"cmd-session-{start}",
            "event_type": "session_start",
            "session_id": f"S-TEST-{start}",
            "profile_id": "adult-basic-test",
            "trainee_id": "T-TEST-001",
            "issued_at_ms": start,
        }
        self.monitor.publish_command(self.device_id, "cmd/session/start", payload)
        msg = self.store.wait_for(
            lambda m: self._is_device_msg(m)
            and (
                str(m.payload_json.get("event_type", "")) == "command_result"
                or str(m.payload_json.get("state", "")) in {"SESSION_ACTIVE", "READY_FOR_SESSION", "PAIRED_IDLE"}
            ),
            timeout=self.args.command_timeout,
            after_ms=start,
        )
        if not msg:
            self.add("session_start_gate", "WARN", "No session start response observed; session handler may not be implemented yet")
            return
        reason = str(get_field(msg.payload_json, "reason", "message", default="")).lower()
        state = str(msg.payload_json.get("state", ""))
        if "calibration_not_ready" in reason:
            self.add("session_start_gate", "PASS", "Session start was blocked because calibration is not ready", payload=msg.payload_json)
        elif state == "SESSION_ACTIVE":
            self.add("session_start_gate", "PASS", "Session start accepted and SESSION_ACTIVE observed", payload=msg.payload_json)
        else:
            self.add("session_start_gate", "WARN", "Session start response observed but readiness behavior unclear", payload=msg.payload_json)

    def write_report(self) -> None:
        devices = [d.__dict__ for d in self.ctx.snapshot_devices()]
        summary = {
            "generated_at": now_iso(),
            "host_ip": self.ctx.host_ip,
            "backend_url": self.ctx.backend_register_url(),
            "mqtt": {"host": self.ctx.host_ip, "port": self.ctx.mqtt_port, "topic_style": self.ctx.topic_style},
            "selected_device_id": self.device_id,
            "results": [r.as_dict() for r in self.results],
            "devices": devices,
            "counts": {
                "pass": sum(1 for r in self.results if r.status == "PASS"),
                "warn": sum(1 for r in self.results if r.status == "WARN"),
                "fail": sum(1 for r in self.results if r.status == "FAIL"),
                "skip": sum(1 for r in self.results if r.status == "SKIP"),
            },
        }
        path = Path(self.args.report_json)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        self._print_report(summary)
        log("REPORT", f"JSON report saved: {path}")

    def _print_report(self, summary: Dict[str, Any]) -> None:
        print()
        print("=" * 84)
        print("ResQ Firmware Test Report")
        print("=" * 84)
        counts = summary["counts"]
        print(f"PASS={counts['pass']}  WARN={counts['warn']}  FAIL={counts['fail']}  SKIP={counts['skip']}")
        print(f"Selected device: {summary.get('selected_device_id') or '-'}")
        print()
        for result in self.results:
            print(f"[{result.status:<4}] {result.name}: {result.message}")
            if result.details:
                print(f"       details: {json.dumps(result.details, separators=(',', ':'))[:500]}")
        print("=" * 84)
        print()


# ---------------------------------------------------------------------------
# Provisioning display / QR
# ---------------------------------------------------------------------------

def provisioning_autofill_url(ctx: HarnessContext, wifi_ssid: str, wifi_pass: str, esp_base_url: str) -> str:
    params = {
        "wifi_ssid": wifi_ssid,
        "wifi_pass": wifi_pass,
        "register_url": ctx.backend_register_url(),
        "mqtt_host": ctx.host_ip,
        "mqtt_port": str(ctx.mqtt_port),
    }
    return esp_base_url.rstrip("/") + "/?" + urllib.parse.urlencode(params)


def print_provisioning(ctx: HarnessContext, wifi_ssid: str, wifi_pass: str) -> None:
    print()
    print("=" * 84)
    print("COPY THESE INTO ESP PROVISIONING PAGE")
    print("=" * 84)
    print(f"wifi_ssid     = {wifi_ssid or '<your Wi-Fi SSID>'}")
    print(f"wifi_pass     = {wifi_pass or '<your Wi-Fi password>'}")
    print(f"register_url  = {ctx.backend_register_url()}")
    print(f"mqtt_host     = {ctx.host_ip}")
    print(f"mqtt_port     = {ctx.mqtt_port}")
    print("=" * 84)
    print()


def maybe_generate_qr(url: str, output_path: str, open_qr: bool) -> None:
    if qrcode is None:
        log("QR", "qrcode not installed. Install with: pip install qrcode[pil]")
        log("QR", f"Provisioning URL: {url}")
        return
    img = qrcode.make(url)
    img.save(output_path)
    log("QR", f"Saved provisioning QR: {output_path}")
    log("QR", "WARNING: QR contains Wi-Fi password. Do not commit/share it.")
    if open_qr:
        try:
            if sys.platform.startswith("win"):
                os.startfile(output_path)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.run(["open", output_path], check=False)
            else:
                subprocess.run(["xdg-open", output_path], check=False)
        except Exception as exc:
            log("QR", f"Could not open QR: {exc}")


# ---------------------------------------------------------------------------
# CLI / main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Full ResQ firmware state/MQTT test suite")
    parser.add_argument("--host-ip", default="", help="LAN IP of this PC. Default: auto-detect")
    parser.add_argument("--backend-port", type=int, default=DEFAULT_BACKEND_PORT)
    parser.add_argument("--mqtt-port", type=int, default=DEFAULT_MQTT_PORT)
    parser.add_argument("--mqtt-ws-port", type=int, default=DEFAULT_MQTT_WS_PORT)
    parser.add_argument("--mosquitto-path", default="")
    parser.add_argument("--no-broker", action="store_true", help="Do not start Mosquitto; reuse existing broker")
    parser.add_argument("--mqtt-monitor-host", default="", help="Host for Python MQTT client. Default: host-ip, fallback localhost")
    parser.add_argument("--topic-style", choices=["short", "canonical", "both"], default="short")
    parser.add_argument("--device-id", default="", help="Known firmware device ID. If omitted, wait for registration/status")
    parser.add_argument("--wifi-ssid", default="")
    parser.add_argument("--wifi-pass", default="")
    parser.add_argument("--esp-provision-url", default="http://192.168.4.1/")
    parser.add_argument("--qr-output", default="resq_provisioning_qr.png")
    parser.add_argument("--open-qr", action="store_true")
    parser.add_argument("--device-timeout", type=float, default=90.0)
    parser.add_argument("--idle-timeout", type=float, default=90.0)
    parser.add_argument("--command-timeout", type=float, default=12.0)
    parser.add_argument("--calibration-timeout", type=float, default=180.0)
    parser.add_argument("--run-calibration", action="store_true", help="Send valid cmd/calibration/start")
    parser.add_argument("--cancel-calibration", action="store_true", help="Cancel calibration after --cancel-after seconds")
    parser.add_argument("--cancel-after", type=float, default=5.0)
    parser.add_argument("--skip-invalid-calibration", action="store_true")
    parser.add_argument("--test-session-start", action="store_true")
    parser.add_argument("--edge-tests", action="store_true", help="Run safe command edge-case tests: unknown command, invalid JSON, invalid calibration payloads, cancel while idle")
    parser.add_argument("--manual-checklist", action="store_true", help="Print manual hardware checklist before running tests")
    parser.add_argument("--hall-delta", type=int, default=13500)
    parser.add_argument("--ref-pressure", type=int, default=20100)
    parser.add_argument("--bladder-1-pressure", type=int, default=15000)
    parser.add_argument("--bladder-2-pressure", type=int, default=15000)
    parser.add_argument("--report-json", default="resq_firmware_test_report.json")
    return parser.parse_args()



def print_manual_hardware_checklist() -> None:
    print()
    print("=" * 84)
    print("Manual hardware checklist")
    print("=" * 84)
    print("1. Flash firmware and open ESP-IDF monitor in another terminal:")
    print("   idf.py -p COMx flash monitor")
    print("2. If device enters PROVISIONING, connect phone/PC to the ESP SoftAP and submit the printed values/QR.")
    print("3. Confirm on monitor that Wi-Fi, backend registration, and MQTT connect succeed.")
    print("4. During calibration, follow dashboard/test progress events:")
    print("   WAITING_REF_PRESSURE -> apply reference pressure")
    print("   WAITING_BLADDER_1_PRESSURE -> apply bladder 1 target")
    print("   WAITING_BLADDER_2_PRESSURE -> apply bladder 2 target")
    print("   WAITING_FULL_PRESS -> compress chest to full depth")
    print("5. Do not press reset/unpair buttons during automatic calibration unless testing recovery.")
    print("6. After READY_FOR_SESSION, run session start tests only if session runtime is implemented.")
    print("=" * 84)
    print()

def main() -> int:
    args = parse_args()
    if mqtt is None:
        print("Missing dependency: paho-mqtt")
        print("Install with: pip install paho-mqtt")
        return 2

    host_ip = args.host_ip.strip() or local_ip_guess()
    ctx = HarnessContext(
        host_ip=host_ip,
        backend_port=args.backend_port,
        mqtt_port=args.mqtt_port,
        mqtt_ws_port=args.mqtt_ws_port,
        topic_style=args.topic_style,
    )

    print()
    print("ResQ Firmware Full State/MQTT Test Suite")
    print("----------------------------------------")
    print(f"Host IP:       {ctx.host_ip}")
    print(f"Backend:       http://{ctx.host_ip}:{ctx.backend_port}")
    print(f"Register URL:  {ctx.backend_register_url()}")
    print(f"MQTT:          {ctx.host_ip}:{ctx.mqtt_port}")
    print(f"Topic style:   {ctx.topic_style}")
    print()

    print_provisioning(ctx, args.wifi_ssid, args.wifi_pass)
    if args.manual_checklist:
        print_manual_hardware_checklist()
    try:
        url = provisioning_autofill_url(ctx, args.wifi_ssid, args.wifi_pass, args.esp_provision_url)
        maybe_generate_qr(url, args.qr_output, args.open_qr)
    except Exception as exc:
        log("QR", f"QR generation skipped: {exc}")

    backend = BackendServer(ctx)
    broker = BrokerProcess(ctx.mqtt_port, ctx.mqtt_ws_port, args.mosquitto_path)
    store = MessageStore()
    monitor: Optional[MqttMonitor] = None
    stop_event = threading.Event()

    def _handle_signal(signum: int, frame: Any) -> None:
        stop_event.set()

    try:
        signal.signal(signal.SIGINT, _handle_signal)
        signal.signal(signal.SIGTERM, _handle_signal)
    except Exception:
        pass

    try:
        if not args.no_broker:
            broker.start_or_reuse(ctx.host_ip)
        else:
            log("MQTT", "--no-broker set; using existing broker")

        backend.start()

        monitor_host = args.mqtt_monitor_host.strip()
        if not monitor_host:
            if port_is_open(ctx.host_ip, ctx.mqtt_port):
                monitor_host = ctx.host_ip
            elif port_is_open("127.0.0.1", ctx.mqtt_port):
                monitor_host = "127.0.0.1"
                log("WARN", "Broker reachable on localhost but not LAN IP. ESP still needs broker reachable on LAN IP.")
            else:
                raise RuntimeError("MQTT broker not reachable from Python monitor")

        monitor = MqttMonitor(ctx, store, monitor_host)
        monitor.start()

        log("INFO", "Test suite running. Provision or reset the ESP now if device is not already connected.")
        runner = FirmwareTestRunner(ctx, monitor, store, args)
        runner.run_all()

        # Keep alive a little to catch late messages after report.
        if not stop_event.is_set():
            time.sleep(0.5)

        fail_count = sum(1 for r in runner.results if r.status == "FAIL")
        return 1 if fail_count else 0

    except Exception as exc:
        log("FATAL", str(exc))
        return 1
    finally:
        if monitor:
            monitor.stop()
        backend.stop()
        if not args.no_broker:
            broker.stop()
        log("INFO", "test suite stopped")


if __name__ == "__main__":
    raise SystemExit(main())
