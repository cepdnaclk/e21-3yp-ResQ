from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any


class ProvisioningError(RuntimeError):
    pass


class ProvisioningClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def _json(self, path: str, payload: dict[str, Any] | None = None, timeout: float = 5) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method="GET" if payload is None else "POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                parsed = json.loads(response.read().decode())
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
            raise ProvisioningError(f"{path} failed: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ProvisioningError(f"{path} returned non-object JSON")
        return parsed

    def wait_until_ready(self, timeout: float) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        last_error = ""
        while time.monotonic() < deadline:
            try:
                status = self._json("/status")
                if status.get("running") is True:
                    return status
            except ProvisioningError as exc:
                last_error = str(exc)
            time.sleep(1)
        raise ProvisioningError(f"provisioning endpoint not ready: {last_error}")

    def provision(self, wifi_ssid: str, wifi_password: str, backend_base_url: str) -> dict[str, Any]:
        received = self._json("/provision", {
            "wifi_ssid": wifi_ssid,
            "wifi_pass": wifi_password,
            "backend_base_url": backend_base_url,
        })
        ack_id = received.get("ack_id")
        if received.get("ok") is not True or not isinstance(ack_id, str) or not ack_id:
            raise ProvisioningError(f"invalid /provision response: {received}")
        acknowledged = self._json("/provision/ack", {"ack_id": ack_id})
        if acknowledged.get("ok") is not True:
            raise ProvisioningError(f"provisioning ACK rejected: {acknowledged}")
        return acknowledged
