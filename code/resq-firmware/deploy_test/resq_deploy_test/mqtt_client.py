from __future__ import annotations

import json
import time
import uuid
from typing import Any

from .evidence import EvidenceStore


class MqttMonitor:
    def __init__(self, host: str, port: int, evidence: EvidenceStore):
        try:
            import paho.mqtt.client as mqtt
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("paho-mqtt is required") from exc
        self._mqtt = mqtt
        self.host = host
        self.port = port
        self.evidence = evidence
        self.connected = False
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"resq-deploy-{uuid.uuid4().hex[:8]}")
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def _on_connect(self, client: Any, _userdata: Any, _flags: Any, reason_code: Any, _properties: Any) -> None:
        self.connected = int(reason_code) == 0
        if self.connected:
            client.subscribe("resq/#")

    def _on_disconnect(self, _client: Any, _userdata: Any, _flags: Any, _reason_code: Any, _properties: Any) -> None:
        self.connected = False

    def _on_message(self, _client: Any, _userdata: Any, message: Any) -> None:
        self.evidence.add(message.topic, message.payload)

    def start(self, timeout: float = 10) -> None:
        self.client.connect(self.host, self.port, keepalive=15)
        self.client.loop_start()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not self.connected:
            time.sleep(0.1)
        if not self.connected:
            raise RuntimeError("MQTT monitor failed to connect")

    def publish(self, device_id: str, suffix: str, payload: dict[str, Any] | str) -> str:
        if isinstance(payload, dict):
            payload = json.dumps(payload)
        topic = f"resq/{device_id}/{suffix}"
        result = self.client.publish(topic, payload)
        result.wait_for_publish(timeout=5)
        return topic

    def command(self, device_id: str, suffix: str, **payload: Any) -> str:
        request_id = str(payload.pop("request_id", uuid.uuid4().hex))
        payload["request_id"] = request_id
        self.publish(device_id, suffix, payload)
        return request_id

    def close(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()
