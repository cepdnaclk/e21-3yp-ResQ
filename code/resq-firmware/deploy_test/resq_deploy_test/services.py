from __future__ import annotations

import json
import shutil
import socket
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class RegistrationBackend:
    def __init__(self, host: str, port: int, mqtt_host: str, mqtt_port: int):
        self.host = host
        self.port = port
        self.mqtt_host = mqtt_host
        self.mqtt_port = mqtt_port
        self.registrations: list[dict[str, object]] = []
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self) -> None:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                if self.path != "/api/devices/register":
                    self.send_error(404)
                    return
                length = int(self.headers.get("Content-Length", "0"))
                try:
                    payload = json.loads(self.rfile.read(length) or b"{}")
                except json.JSONDecodeError:
                    self.send_error(400)
                    return
                owner.registrations.append(payload)
                mac = str(payload.get("device_mac", "unknown")).replace(":", "")[-6:]
                response = json.dumps({
                    "device_id": f"resq-{mac.lower()}",
                    "mqtt_host": owner.mqtt_host,
                    "mqtt_port": owner.mqtt_port,
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response)))
                self.end_headers()
                self.wfile.write(response)

            def log_message(self, _format: str, *_args: object) -> None:
                return

        self.server = ThreadingHTTPServer(("0.0.0.0", self.port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.thread:
            self.thread.join(timeout=2)


class MosquittoBroker:
    def __init__(self, mqtt_port: int, ws_port: int, executable: str = "", reuse: bool = False):
        self.mqtt_port = mqtt_port
        self.ws_port = ws_port
        self.executable = executable
        self.reuse = reuse
        self.process: subprocess.Popen[str] | None = None
        self.tempdir: tempfile.TemporaryDirectory[str] | None = None

    def _available(self) -> bool:
        with socket.socket() as sock:
            sock.settimeout(0.5)
            return sock.connect_ex(("127.0.0.1", self.mqtt_port)) == 0

    def start(self) -> None:
        if self.reuse:
            if not self._available():
                raise RuntimeError("configured MQTT broker is not reachable")
            return
        executable = self.executable or shutil.which("mosquitto") or ""
        if not executable:
            for candidate in (
                Path(r"C:\Program Files\mosquitto\mosquitto.exe"),
                Path(r"C:\Program Files (x86)\mosquitto\mosquitto.exe"),
            ):
                if candidate.exists():
                    executable = str(candidate)
                    break
        if not executable:
            raise RuntimeError("Mosquitto executable not found")
        self.tempdir = tempfile.TemporaryDirectory(prefix="resq-deploy-mqtt-")
        config = Path(self.tempdir.name) / "mosquitto.conf"
        config.write_text(
            f"allow_anonymous true\nlistener {self.mqtt_port}\n"
            f"listener {self.ws_port}\nprotocol websockets\n",
            encoding="utf-8",
        )
        self.process = subprocess.Popen(
            [executable, "-c", str(config), "-v"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        for _ in range(50):
            if self._available():
                return
            import time
            time.sleep(0.1)
        raise RuntimeError("Mosquitto did not become ready")

    def stop(self) -> None:
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process = None

    def close(self) -> None:
        self.stop()
        if self.tempdir:
            self.tempdir.cleanup()
            self.tempdir = None
