from __future__ import annotations

from .config import RouterConfig
from .process import CommandRunner


class RouterHooks:
    def __init__(self, config: RouterConfig, runner: CommandRunner, *, wifi_ssid: str, router_host: str):
        self.config = config
        self.runner = runner
        self.environment = {
            "RESQ_WIFI_SSID": wifi_ssid,
            "RESQ_ROUTER_HOST": router_host,
        }

    def _run(self, command: list[str], name: str) -> None:
        if not command:
            raise RuntimeError(f"router {name} hook is not configured")
        self.runner.run(
            command,
            timeout=self.config.timeout_seconds,
            env=self.environment,
        )

    def disable(self) -> None:
        self._run(self.config.disable_command, "disable")

    def enable(self) -> None:
        self._run(self.config.enable_command, "enable")

    def healthcheck(self) -> None:
        self._run(self.config.healthcheck_command, "healthcheck")
