from __future__ import annotations

from resq_deploy_test.provisioning import ProvisioningClient, ProvisioningError


class FakeClient(ProvisioningClient):
    def __init__(self) -> None:
        super().__init__("http://device")
        self.calls: list[tuple[str, object]] = []

    def _json(self, path, payload=None, timeout=5):
        self.calls.append((path, payload))
        if path == "/provision":
            return {"ok": True, "ack_id": "abc123"}
        return {"ok": True}


def test_two_phase_provisioning_contract() -> None:
    client = FakeClient()
    client.provision("ssid", "password", "http://backend")
    assert client.calls == [
        ("/provision", {
            "wifi_ssid": "ssid",
            "wifi_pass": "password",
            "backend_base_url": "http://backend",
        }),
        ("/provision/ack", {"ack_id": "abc123"}),
    ]
