#!/usr/bin/env python3
"""
ResQ Firmware Minimal LocalHub Test Harness

Purpose
-------
This script runs a minimal test environment for the current ResQ firmware slice:

    PROVISIONING
    -> WIFI_CONNECTING
    -> BACKEND_REGISTERING
    -> MQTT_CONNECTING
    -> PAIRED_IDLE

It starts:
1. A minimal HTTP backend registration server.
2. A local Mosquitto MQTT broker, or reuses an existing broker.
3. An MQTT monitor/client that watches firmware status, heartbeat, events,
   telemetry, debug, and command messages.
4. An interactive command console to send test commands to the ESP device.

What this script DOES test now
------------------------------
- Firmware can receive provisioning details from its SoftAP page.
- Firmware can connect to Wi-Fi.
- Firmware can POST backend registration request.
- Backend can return a backend-assigned device_id.
- Firmware can connect to MQTT.
- Firmware publishes status / heartbeat / events.
- Firmware subscribes to cmd/# because commands are received/logged.

What this script does NOT test yet
----------------------------------
- Real calibration logic.
- CPR session metrics.
- Sensor processing correctness.
- Final LocalHub dashboard behavior.
- Cloud sync.

Requirements
------------
Python:
    pip install paho-mqtt

System:
    Mosquitto broker installed and available in PATH, or provide --mosquitto-path.

Windows default Mosquitto path normally:
    C:\\Program Files\\mosquitto\\mosquitto.exe

Example
-------
Terminal 1:
    python resq_firmware_state_test_harness.py ^
      --wifi-ssid "YOUR_WIFI" ^
      --wifi-pass "YOUR_PASSWORD" ^
      --host-ip 192.168.8.100 ^
      --topic-style short

Then connect phone/laptop to ESP provisioning AP and open:
    http://192.168.4.1

Enter these values:
    wifi_ssid     = YOUR_WIFI
    wifi_pass     = YOUR_PASSWORD
    register_url  = http://192.168.8.100:18080/api/devices/register
    mqtt_host     = 192.168.8.100
    mqtt_port     = 1883

Topic styles
------------
Your recent firmware planning used:
    short:      resq/{deviceId}/status

The SRS/MQTT guide canonical style uses:
    canonical:  resq/manikins/{deviceId}/status

This harness supports both. For your current fix-components test, use:
    --topic-style short

"""

from __future__ import annotations

import argparse
import datetime as _dt
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
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Optional dependency: paho-mqtt
# ---------------------------------------------------------------------------

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALL_RESQ_STATES = [
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
]

CONNECTION_SLICE_STATES = [
    "PROVISIONING",
    "WIFI_CONNECTING",
    "BACKEND_REGISTERING",
    "MQTT_CONNECTING",
    "PAIRED_IDLE",
]

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
# Utility functions
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def now_ms() -> int:
    return int(time.time() * 1000)


def log(section: str, message: str) -> None:
    print(f"[{now_iso()}] [{section:<8}] {message}", flush=True)


def safe_json_loads(raw: bytes | str) -> Tuple[Optional[dict], Optional[str]]:
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", errors="replace")
    else:
        text = raw

    if not text.strip():
        return {}, None

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data, None
        return None, "JSON body is not an object"
    except Exception as exc:
        return None, f"Invalid JSON: {exc}; raw={text!r}"


def local_ip_guess() -> str:
    """
    Best-effort LAN IP detection.

    This does not send any packet to the internet. It opens a UDP socket only
    to let the OS select the active outbound interface.
    """
    candidates = []

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
        for _, _, ips in socket.gethostbyname_ex(host):
            candidates.extend(ips)
    except Exception:
        pass

    for ip in candidates:
        if ip and not ip.startswith("127.") and "." in ip:
            return ip

    return "127.0.0.1"


def port_is_open(host: str, port: int, timeout: float = 0.25) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def normalize_mac(value: str) -> str:
    raw = "".join(ch for ch in value.upper() if ch.isalnum())
    if len(raw) == 12:
        return ":".join(raw[i : i + 2] for i in range(0, 12, 2))
    return value


def device_id_from_mac(mac: str) -> str:
    """
    Backend-assigned deterministic test ID.

    Example:
        CC:DB:A7:12:34:56 -> resq-node-123456
    """
    compact = "".join(ch for ch in mac.upper() if ch.isalnum())
    if len(compact) >= 6:
        return f"resq-node-{compact[-6:].lower()}"

    digest = hashlib.sha1((mac or str(time.time())).encode()).hexdigest()[:6]
    return f"resq-node-{digest}"


def get_field(data: dict, *names: str, default: Any = "") -> Any:
    for name in names:
        if name in data and data[name] not in (None, ""):
            return data[name]
    return default


# ---------------------------------------------------------------------------
# Shared runtime context
# ---------------------------------------------------------------------------

@dataclass
class DeviceRecord:
    device_id: str
    device_mac: str = ""
    register_count: int = 0
    first_seen_ms: int = field(default_factory=now_ms)
    last_seen_ms: int = field(default_factory=now_ms)
    last_ip: str = ""
    last_state: str = ""
    observed_states: List[str] = field(default_factory=list)
    heartbeat_count: int = 0
    status_count: int = 0
    event_count: int = 0
    telemetry_count: int = 0
    debug_count: int = 0
    command_result_count: int = 0
    identity_seen: bool = False


@dataclass
class HarnessContext:
    host_ip: str
    backend_port: int
    mqtt_port: int
    mqtt_ws_port: int
    topic_style: str
    devices: Dict[str, DeviceRecord] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)
    mqtt_client: Any = None

    def backend_register_url(self) -> str:
        return f"http://{self.host_ip}:{self.backend_port}/api/devices/register"

    def topic_prefix(self, device_id: str, style: Optional[str] = None) -> str:
        style = style or self.topic_style
        if style == "canonical":
            return f"resq/manikins/{device_id}"
        return f"resq/{device_id}"

    def topic(self, device_id: str, suffix: str, style: Optional[str] = None) -> str:
        return f"{self.topic_prefix(device_id, style)}/{suffix.lstrip('/')}"

    def upsert_device(self, device_id: str, device_mac: str = "") -> DeviceRecord:
        with self.lock:
            record = self.devices.get(device_id)
            if record is None:
                record = DeviceRecord(device_id=device_id, device_mac=device_mac)
                self.devices[device_id] = record
            if device_mac:
                record.device_mac = normalize_mac(device_mac)
            record.last_seen_ms = now_ms()
            return record

    def get_devices_snapshot(self) -> List[DeviceRecord]:
        with self.lock:
            return list(self.devices.values())


# ---------------------------------------------------------------------------
# Minimal backend server
# ---------------------------------------------------------------------------

class ResQBackendHandler(http.server.BaseHTTPRequestHandler):
    server_version = "ResQMinimalBackend/0.1"

    def _ctx(self) -> HarnessContext:
        return self.server.ctx  # type: ignore[attr-defined]

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

    def _read_body_json(self) -> Tuple[Optional[dict], Optional[str], str]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length > 0 else b""
        data, err = safe_json_loads(body)
        return data, err, body.decode("utf-8", errors="replace")

    def log_message(self, fmt: str, *args: Any) -> None:
        log("HTTP", fmt % args)

    def do_OPTIONS(self) -> None:
        self._send_json(200, {"ok": True})

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in {"/", "/api", "/api/test"}:
            self._send_json(
                200,
                {
                    "ok": True,
                    "service": "resq-minimal-backend",
                    "time": now_iso(),
                    "register_url": self._ctx().backend_register_url(),
                    "mqtt_host": self._ctx().host_ip,
                    "mqtt_port": self._ctx().mqtt_port,
                    "topic_style": self._ctx().topic_style,
                    "register_paths": sorted(REGISTER_PATHS),
                },
            )
            return

        if path in {"/health", "/api/hub/health"}:
            self._send_json(
                200,
                {
                    "ok": True,
                    "status": "UP",
                    "service": "resq-minimal-backend",
                    "time": now_iso(),
                    "mqtt": {
                        "host": self._ctx().host_ip,
                        "port": self._ctx().mqtt_port,
                    },
                    "devices": len(self._ctx().devices),
                },
            )
            return

        if path in {"/api/devices", "/api/manikins", "/api/test/devices"}:
            devices = []
            for d in self._ctx().get_devices_snapshot():
                devices.append(
                    {
                        "device_id": d.device_id,
                        "device_mac": d.device_mac,
                        "register_count": d.register_count,
                        "last_state": d.last_state,
                        "observed_states": d.observed_states,
                        "heartbeat_count": d.heartbeat_count,
                        "status_count": d.status_count,
                        "event_count": d.event_count,
                        "telemetry_count": d.telemetry_count,
                        "debug_count": d.debug_count,
                        "identity_seen": d.identity_seen,
                    }
                )
            self._send_json(200, {"ok": True, "devices": devices})
            return

        self._send_json(404, {"ok": False, "error": f"Not found: {path}"})

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in REGISTER_PATHS or path.endswith("/register"):
            self._handle_register(path)
            return

        if path == "/api/test/command":
            self._handle_publish_command()
            return

        self._send_json(404, {"ok": False, "error": f"Not found: {path}"})

    def _handle_register(self, path: str) -> None:
        data, err, raw = self._read_body_json()
        if err:
            self._send_json(400, {"ok": False, "error": err})
            return

        data = data or {}

        device_mac = normalize_mac(str(get_field(data, "device_mac", "mac", "mac_address", default="")).strip())
        incoming_device_id = str(get_field(data, "device_id", "deviceId", default="")).strip()

        if not device_mac and not incoming_device_id:
            self._send_json(
                400,
                {
                    "ok": False,
                    "error": "registration requires device_mac or existing device_id",
                    "received": data,
                },
            )
            return

        assigned_id = incoming_device_id or device_id_from_mac(device_mac)
        record = self._ctx().upsert_device(assigned_id, device_mac)
        record.register_count += 1
        record.last_ip = self.client_address[0]

        log(
            "REG",
            f"registered path={path} mac={device_mac or '-'} assigned_device_id={assigned_id} "
            f"from={self.client_address[0]} body={raw}",
        )

        # Important:
        # Latest firmware requirement: backend registration must return device_id.
        # No manikin_id is returned here.
        response = {
            "ok": True,
            "status": "registered",
            "device_id": assigned_id,
            "mqtt_host": self._ctx().host_ip,
            "mqtt_port": self._ctx().mqtt_port,
            "ts_ms": now_ms(),
        }

        self._send_json(200, response)

    def _handle_publish_command(self) -> None:
        data, err, _raw = self._read_body_json()
        if err:
            self._send_json(400, {"ok": False, "error": err})
            return

        data = data or {}
        device_id = str(data.get("device_id", "")).strip()
        suffix = str(data.get("suffix", "")).strip().lstrip("/")
        payload = data.get("payload", {})

        if not device_id or not suffix:
            self._send_json(400, {"ok": False, "error": "device_id and suffix are required"})
            return

        if self._ctx().mqtt_client is None:
            self._send_json(500, {"ok": False, "error": "MQTT client not ready"})
            return

        topic = self._ctx().topic(device_id, suffix)
        text = json.dumps(payload)
        result = self._ctx().mqtt_client.publish(topic, text, qos=1, retain=False)
        self._send_json(
            200,
            {
                "ok": True,
                "topic": topic,
                "payload": payload,
                "mqtt_result": getattr(result, "rc", None),
            },
        )


class BackendServer:
    def __init__(self, ctx: HarnessContext) -> None:
        self.ctx = ctx
        self.httpd: Optional[http.server.ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None

    def start(self) -> None:
        server_address = ("0.0.0.0", self.ctx.backend_port)
        self.httpd = http.server.ThreadingHTTPServer(server_address, ResQBackendHandler)
        self.httpd.ctx = self.ctx  # type: ignore[attr-defined]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        log("HTTP", f"backend listening on http://0.0.0.0:{self.ctx.backend_port}")
        log("HTTP", f"registration URL for ESP: {self.ctx.backend_register_url()}")

    def stop(self) -> None:
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            log("HTTP", "backend stopped")


# ---------------------------------------------------------------------------
# Mosquitto broker process manager
# ---------------------------------------------------------------------------

class BrokerProcess:
    def __init__(self, mqtt_port: int, ws_port: int, mosquitto_path: Optional[str]) -> None:
        self.mqtt_port = mqtt_port
        self.ws_port = ws_port
        self.mosquitto_path = mosquitto_path
        self.process: Optional[subprocess.Popen[str]] = None
        self.tempdir: Optional[tempfile.TemporaryDirectory[str]] = None
        self.config_path: Optional[Path] = None
        self.started_by_harness = False

    def _find_mosquitto(self) -> Optional[str]:
        if self.mosquitto_path:
            return self.mosquitto_path

        found = shutil.which("mosquitto")
        if found:
            return found

        candidates = [
            r"C:\Program Files\mosquitto\mosquitto.exe",
            r"C:\Program Files (x86)\mosquitto\mosquitto.exe",
        ]

        for candidate in candidates:
            if Path(candidate).exists():
                return candidate

        return None

    def start_or_reuse(self) -> None:
        if port_is_open("127.0.0.1", self.mqtt_port):
            log("MQTT", f"broker already reachable on localhost:{self.mqtt_port}; reusing it")
            return

        exe = self._find_mosquitto()
        if not exe:
            raise RuntimeError(
                "Mosquitto broker was not found. Install Mosquitto or pass --mosquitto-path."
            )

        self.tempdir = tempfile.TemporaryDirectory(prefix="resq_mosquitto_")
        base = Path(self.tempdir.name)
        data_dir = base / "data"
        log_dir = base / "log"
        data_dir.mkdir(parents=True, exist_ok=True)
        log_dir.mkdir(parents=True, exist_ok=True)

        self.config_path = base / "mosquitto.conf"
        self.config_path.write_text(
            "\n".join(
                [
                    "persistence true",
                    f"persistence_location {data_dir.as_posix()}/",
                    "log_dest stdout",
                    "",
                    f"listener {self.mqtt_port} 0.0.0.0",
                    "protocol mqtt",
                    "allow_anonymous true",
                    "",
                    # WebSocket listener is useful later for dashboards.
                    # Some Mosquitto builds may not support websockets; if the broker
                    # fails to start, rerun with --no-ws.
                    f"listener {self.ws_port} 0.0.0.0",
                    "protocol websockets",
                    "allow_anonymous true",
                    "",
                ]
            ),
            encoding="utf-8",
        )

        cmd = [exe, "-c", str(self.config_path), "-v"]
        log("MQTT", "starting broker: " + " ".join(f'"{x}"' if " " in x else x for x in cmd))
        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self.started_by_harness = True

        threading.Thread(target=self._pipe_logs, daemon=True).start()

        # Wait for broker to accept TCP connections.
        deadline = time.time() + 10
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"Mosquitto exited early with code {self.process.returncode}")
            if port_is_open("127.0.0.1", self.mqtt_port):
                log("MQTT", f"broker ready on port {self.mqtt_port}")
                return
            time.sleep(0.2)

        raise RuntimeError("Mosquitto broker did not become ready within 10 seconds")

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
# MQTT monitor and command publisher
# ---------------------------------------------------------------------------

class MqttMonitor:
    def __init__(self, ctx: HarnessContext) -> None:
        if mqtt is None:
            raise RuntimeError(
                "Missing Python package paho-mqtt. Install it with: pip install paho-mqtt"
            )

        self.ctx = ctx
        client_id = f"resq-test-harness-{os.getpid()}"
        self.client = mqtt.Client(client_id=client_id)
        self.ctx.mqtt_client = self.client
        self.connected = threading.Event()

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def start(self) -> None:
        self.client.connect(self.ctx.host_ip, self.ctx.mqtt_port, keepalive=30)
        self.client.loop_start()
        if not self.connected.wait(timeout=10):
            raise RuntimeError("MQTT monitor could not connect to broker")

    def stop(self) -> None:
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass

    def _subscriptions(self) -> List[str]:
        subs = []

        if self.ctx.topic_style in {"short", "both"}:
            subs.extend(
                [
                    "resq/+/status",
                    "resq/+/heartbeat",
                    "resq/+/telemetry",
                    "resq/+/debug",
                    "resq/+/events",
                    "resq/+/cmd/#",
                ]
            )

        if self.ctx.topic_style in {"canonical", "both"}:
            subs.extend(
                [
                    "resq/manikins/+/status",
                    "resq/manikins/+/heartbeat",
                    "resq/manikins/+/telemetry",
                    "resq/manikins/+/debug",
                    "resq/manikins/+/events",
                    "resq/manikins/+/cmd/#",
                ]
            )

        return subs

    def _on_connect(self, client: Any, userdata: Any, flags: dict, rc: int) -> None:
        if rc == 0:
            log("MQTT", "monitor connected")
            for topic in self._subscriptions():
                client.subscribe(topic, qos=0)
                log("MQTT", f"subscribed {topic}")
            self.connected.set()
        else:
            log("MQTT", f"monitor connection failed rc={rc}")

    def _on_disconnect(self, client: Any, userdata: Any, rc: int) -> None:
        log("MQTT", f"monitor disconnected rc={rc}")

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        topic = msg.topic
        payload_text = msg.payload.decode("utf-8", errors="replace")

        data, _err = safe_json_loads(payload_text)
        pretty = payload_text
        if data is not None:
            pretty = json.dumps(data, separators=(",", ":"))

        log("RX", f"{topic} {pretty}")
        self._update_device_from_message(topic, data or {})

    def _parse_topic(self, topic: str) -> Tuple[Optional[str], Optional[str]]:
        parts = topic.split("/")

        # short: resq/{deviceId}/{suffix...}
        if len(parts) >= 3 and parts[0] == "resq" and parts[1] != "manikins":
            return parts[1], "/".join(parts[2:])

        # canonical: resq/manikins/{deviceId}/{suffix...}
        if len(parts) >= 4 and parts[0] == "resq" and parts[1] == "manikins":
            return parts[2], "/".join(parts[3:])

        return None, None

    def _update_device_from_message(self, topic: str, data: Dict[str, Any]) -> None:
        topic_device_id, suffix = self._parse_topic(topic)

        device_id = str(
            get_field(data, "device_id", "deviceId", default=topic_device_id or "")
        ).strip()

        if not device_id:
            return

        record = self.ctx.upsert_device(
            device_id,
            str(get_field(data, "device_mac", "mac", "mac_address", default="")).strip(),
        )

        if suffix == "status":
            record.status_count += 1
            state = str(get_field(data, "state", default="")).strip()
            if state:
                record.last_state = state
                if state not in record.observed_states:
                    record.observed_states.append(state)
                if state not in ALL_RESQ_STATES:
                    log("WARN", f"unknown firmware state received: {state}")
                else:
                    log("STATE", f"{device_id} -> {state}")

        elif suffix == "heartbeat":
            record.heartbeat_count += 1

        elif suffix == "events":
            record.event_count += 1
            event_type = str(get_field(data, "event_type", "eventType", default="")).strip()
            if event_type == "device_identity":
                record.identity_seen = True
            if event_type == "command_result":
                record.command_result_count += 1

        elif suffix == "telemetry":
            record.telemetry_count += 1

        elif suffix == "debug":
            record.debug_count += 1

    def publish_command(
        self,
        device_id: str,
        suffix: str,
        payload: Dict[str, Any],
        qos: int = 1,
        retain: bool = False,
    ) -> None:
        topic = self.ctx.topic(device_id, suffix)
        text = json.dumps(payload, separators=(",", ":"))
        result = self.client.publish(topic, text, qos=qos, retain=retain)
        log("TX", f"{topic} {text} rc={getattr(result, 'rc', None)}")


# ---------------------------------------------------------------------------
# Interactive command console
# ---------------------------------------------------------------------------

class CommandConsole:
    def __init__(self, ctx: HarnessContext, mqtt_monitor: MqttMonitor) -> None:
        self.ctx = ctx
        self.mqtt = mqtt_monitor
        self.stop_event = threading.Event()

    def start(self) -> None:
        thread = threading.Thread(target=self._run, daemon=True)
        thread.start()

    def stop(self) -> None:
        self.stop_event.set()

    def _print_help(self) -> None:
        print(
            """
Interactive commands
--------------------
help
    Show this help.

devices
    Show discovered/registered devices and state validation summary.

values
    Print the exact values to enter in the ESP provisioning page.

ping <deviceId>
    Publish cmd/diag/ping.

diag <deviceId>
    Publish cmd/diag/request.

status <deviceId>
    Publish cmd/status/request. Use only if your firmware supports it.

heartbeat <deviceId>
    Publish cmd/heartbeat/request. Use only if your firmware supports it.

debug <deviceId>
    Publish cmd/debug/request. Use only if your firmware supports it.

config <deviceId>
    Publish a safe cmd/config/update test payload.

start <deviceId> [sessionId]
    Publish cmd/session/start. Use only after your firmware command handler is ready.

stop <deviceId> [sessionId]
    Publish cmd/session/stop.

reset <deviceId>
    Publish cmd/device/reset. WARNING: device may reboot.

unpair <deviceId>
    Publish cmd/device/unpair. WARNING: device may clear config.

quit
    Stop the harness.
""".strip()
        )

    def _run(self) -> None:
        self._print_help()
        while not self.stop_event.is_set():
            try:
                line = input("resq-test> ").strip()
            except EOFError:
                self.stop_event.set()
                break
            except KeyboardInterrupt:
                self.stop_event.set()
                break

            if not line:
                continue

            parts = line.split()
            cmd = parts[0].lower()

            try:
                if cmd in {"q", "quit", "exit"}:
                    self.stop_event.set()
                    break
                if cmd in {"h", "help", "?"}:
                    self._print_help()
                elif cmd == "devices":
                    self._print_devices()
                elif cmd == "values":
                    print_provisioning_values(self.ctx)
                elif cmd in {"ping", "diag", "status", "heartbeat", "debug", "config", "start", "stop", "reset", "unpair"}:
                    self._handle_command(cmd, parts[1:])
                else:
                    log("CMD", f"unknown command: {cmd}")
            except Exception as exc:
                log("ERR", f"command failed: {exc}")

    def _print_devices(self) -> None:
        devices = self.ctx.get_devices_snapshot()
        if not devices:
            log("INFO", "no devices seen yet")
            return

        for d in devices:
            expected = ["PAIRED_IDLE"]
            ok_idle = "PAIRED_IDLE" in d.observed_states or d.last_state == "PAIRED_IDLE"

            print()
            print(f"Device:              {d.device_id}")
            print(f"MAC:                 {d.device_mac or '-'}")
            print(f"Register count:      {d.register_count}")
            print(f"Last state:          {d.last_state or '-'}")
            print(f"Observed states:     {', '.join(d.observed_states) or '-'}")
            print(f"Status count:        {d.status_count}")
            print(f"Heartbeat count:     {d.heartbeat_count}")
            print(f"Event count:         {d.event_count}")
            print(f"Telemetry count:     {d.telemetry_count}")
            print(f"Debug count:         {d.debug_count}")
            print(f"Identity seen:       {d.identity_seen}")
            print(f"Connection slice OK: {'YES' if ok_idle else 'NOT YET'}")

    def _handle_command(self, cmd: str, args: List[str]) -> None:
        if not args:
            raise ValueError(f"{cmd} requires deviceId")

        device_id = args[0]

        if cmd == "ping":
            payload = {
                "command_id": f"ping-{now_ms()}",
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/diag/ping", payload)

        elif cmd == "diag":
            payload = {
                "command_id": f"diag-{now_ms()}",
                "include_raw": False,
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/diag/request", payload)

        elif cmd == "status":
            payload = {
                "command_id": f"status-{now_ms()}",
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/status/request", payload)

        elif cmd == "heartbeat":
            payload = {
                "command_id": f"heartbeat-{now_ms()}",
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/heartbeat/request", payload)

        elif cmd == "debug":
            payload = {
                "command_id": f"debug-{now_ms()}",
                "enabled": True,
                "duration_ms": 10000,
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/debug/request", payload)

        elif cmd == "config":
            payload = {
                "command_id": f"config-{now_ms()}",
                "debug_raw_enabled": False,
                "heartbeat_interval_ms": 5000,
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/config/update", payload)

        elif cmd == "start":
            session_id = args[1] if len(args) >= 2 else f"S-TEST-{now_ms()}"
            payload = {
                "command_id": f"start-{now_ms()}",
                "session_id": session_id,
                "sessionId": session_id,
                "trainee_id": "T-TEST-001",
                "profile_id": "adult-basic-test",
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/session/start", payload)

        elif cmd == "stop":
            session_id = args[1] if len(args) >= 2 else ""
            payload = {
                "command_id": f"stop-{now_ms()}",
                "session_id": session_id,
                "sessionId": session_id,
                "reason": "manual_test_stop",
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/session/stop", payload)

        elif cmd == "reset":
            payload = {
                "command_id": f"reset-{now_ms()}",
                "reason": "manual_test_reset",
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/device/reset", payload)

        elif cmd == "unpair":
            payload = {
                "command_id": f"unpair-{now_ms()}",
                "reason": "manual_test_unpair",
                "clear_network_config": True,
                "issued_at_ms": now_ms(),
            }
            self.mqtt.publish_command(device_id, "cmd/device/unpair", payload)


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

def print_provisioning_values(ctx: HarnessContext) -> None:
    print()
    print("=" * 78)
    print("VALUES TO ENTER ON ESP PROVISIONING PAGE")
    print("=" * 78)
    print(f"wifi_ssid     = <your Wi-Fi SSID passed by --wifi-ssid>")
    print(f"wifi_pass     = <your Wi-Fi password passed by --wifi-pass>")
    print(f"register_url  = {ctx.backend_register_url()}")
    print(f"mqtt_host     = {ctx.host_ip}")
    print(f"mqtt_port     = {ctx.mqtt_port}")
    print()
    print("If you launch this script with --wifi-ssid and --wifi-pass, the")
    print("actual values will also be printed below.")
    print("=" * 78)
    print()


def print_provisioning_values_with_wifi(ctx: HarnessContext, wifi_ssid: str, wifi_pass: str) -> None:
    print()
    print("=" * 78)
    print("COPY THESE INTO THE ESP PROVISIONING PAGE")
    print("=" * 78)
    print(f"wifi_ssid     = {wifi_ssid}")
    print(f"wifi_pass     = {wifi_pass}")
    print(f"register_url  = {ctx.backend_register_url()}")
    print(f"mqtt_host     = {ctx.host_ip}")
    print(f"mqtt_port     = {ctx.mqtt_port}")
    print("=" * 78)
    print()
    print("Expected device path:")
    print("  1. Submit provisioning form")
    print("  2. Browser sends /provision and /provision/ack")
    print("  3. ESP connects Wi-Fi")
    print("  4. ESP POSTs backend registration")
    print("  5. Backend returns device_id")
    print("  6. ESP connects MQTT")
    print("  7. ESP publishes status/heartbeat/events")
    print("  8. ESP lands in PAIRED_IDLE")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a minimal backend + MQTT broker + command monitor for ResQ firmware state testing."
    )

    parser.add_argument("--host-ip", default="", help="LAN IP address of this PC. Default: auto-detect.")
    parser.add_argument("--backend-port", type=int, default=DEFAULT_BACKEND_PORT)
    parser.add_argument("--mqtt-port", type=int, default=DEFAULT_MQTT_PORT)
    parser.add_argument("--mqtt-ws-port", type=int, default=DEFAULT_MQTT_WS_PORT)
    parser.add_argument("--mosquitto-path", default="", help="Path to mosquitto executable if not in PATH.")

    parser.add_argument(
        "--topic-style",
        choices=["short", "canonical", "both"],
        default="short",
        help="short=resq/{deviceId}/..., canonical=resq/manikins/{deviceId}/..., both=subscribe to both.",
    )

    parser.add_argument("--wifi-ssid", default="", help="Wi-Fi SSID to print for provisioning.")
    parser.add_argument("--wifi-pass", default="", help="Wi-Fi password to print for provisioning.")

    parser.add_argument(
        "--no-broker",
        action="store_true",
        help="Do not start Mosquitto; assume an MQTT broker is already running.",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if mqtt is None:
        print()
        print("Missing dependency: paho-mqtt")
        print("Install it with:")
        print("    pip install paho-mqtt")
        print()
        return 2

    host_ip = args.host_ip.strip() or local_ip_guess()

    ctx = HarnessContext(
        host_ip=host_ip,
        backend_port=args.backend_port,
        mqtt_port=args.mqtt_port,
        mqtt_ws_port=args.mqtt_ws_port,
        topic_style=args.topic_style,
    )

    backend = BackendServer(ctx)
    broker = BrokerProcess(args.mqtt_port, args.mqtt_ws_port, args.mosquitto_path or None)
    monitor: Optional[MqttMonitor] = None
    console: Optional[CommandConsole] = None

    stop_event = threading.Event()

    def handle_signal(signum: int, frame: Any) -> None:
        stop_event.set()

    try:
        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)
    except Exception:
        pass

    try:
        print()
        print("ResQ Firmware Minimal LocalHub Test Harness")
        print("-------------------------------------------")
        print(f"Host IP:       {ctx.host_ip}")
        print(f"Backend:       http://{ctx.host_ip}:{ctx.backend_port}")
        print(f"Register URL:  {ctx.backend_register_url()}")
        print(f"MQTT:          {ctx.host_ip}:{ctx.mqtt_port}")
        print(f"Topic style:   {ctx.topic_style}")
        print()

        if args.wifi_ssid or args.wifi_pass:
            print_provisioning_values_with_wifi(ctx, args.wifi_ssid, args.wifi_pass)
        else:
            print_provisioning_values(ctx)

        if not args.no_broker:
            broker.start_or_reuse()
        else:
            log("MQTT", "skipping broker start because --no-broker was provided")

        backend.start()

        monitor = MqttMonitor(ctx)
        monitor.start()

        console = CommandConsole(ctx, monitor)
        console.start()

        log("INFO", "harness is running. Use the ESP provisioning page now.")
        log("INFO", "type 'devices' in the console to view validation summary.")
        log("INFO", "type 'quit' to stop.")

        while not stop_event.is_set():
            if console and console.stop_event.is_set():
                break
            time.sleep(0.25)

        return 0

    except Exception as exc:
        log("FATAL", str(exc))
        return 1

    finally:
        if console:
            console.stop()
        if monitor:
            monitor.stop()
        backend.stop()
        if not args.no_broker:
            broker.stop()
        log("INFO", "harness stopped")


if __name__ == "__main__":
    raise SystemExit(main())
