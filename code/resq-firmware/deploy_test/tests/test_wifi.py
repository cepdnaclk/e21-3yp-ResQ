from __future__ import annotations

from resq_deploy_test.process import CommandResult
from resq_deploy_test.wifi import WindowsWifi


class FakeRunner:
    def run(self, command, **_kwargs):
        if command[-1] == "profiles":
            output = "    All User Profile     : ResQ-Lab\n    All User Profile     : ResQ-ABC123\n"
        elif command[-1] == "interfaces":
            output = "    SSID                   : ResQ-Lab\n    BSSID                 : aa:bb\n"
        else:
            output = ""
        return CommandResult(command, 0, output, "")


def test_parses_profiles_and_current_ssid() -> None:
    wifi = WindowsWifi(FakeRunner())
    assert wifi.profiles() == {"ResQ-Lab", "ResQ-ABC123"}
    assert wifi.current_ssid() == "ResQ-Lab"
