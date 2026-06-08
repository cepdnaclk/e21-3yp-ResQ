from __future__ import annotations

from resq_deploy_test.config import RouterConfig
from resq_deploy_test.router import RouterHooks


class FakeRunner:
    def __init__(self) -> None:
        self.calls = []

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))


def test_router_hook_uses_argument_array_timeout_and_environment() -> None:
    runner = FakeRunner()
    hooks = RouterHooks(
        RouterConfig(["hook", "off"], ["hook", "on"], ["hook", "status"], 12),
        runner,
        wifi_ssid="Lab",
        router_host="192.168.1.10",
    )
    hooks.disable()
    assert runner.calls == [(
        ["hook", "off"],
        {
            "timeout": 12,
            "env": {
                "RESQ_WIFI_SSID": "Lab",
                "RESQ_ROUTER_HOST": "192.168.1.10",
            },
        },
    )]
