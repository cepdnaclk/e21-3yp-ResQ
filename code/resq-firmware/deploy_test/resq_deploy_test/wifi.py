from __future__ import annotations

import re
import tempfile
import time
from html import escape
from pathlib import Path

from .process import CommandRunner


class WindowsWifi:
    def __init__(self, runner: CommandRunner):
        self.runner = runner

    def profiles(self) -> set[str]:
        result = self.runner.run(["netsh", "wlan", "show", "profiles"])
        return {
            match.group(1).strip()
            for line in result.stdout.splitlines()
            if (match := re.search(r"All User Profile\s*:\s*(.+)$", line))
        }

    def visible_ssids(self) -> set[str]:
        result = self.runner.run(["netsh", "wlan", "show", "networks", "mode=bssid"])
        return {
            match.group(1).strip()
            for line in result.stdout.splitlines()
            if (match := re.search(r"^\s*SSID\s+\d+\s*:\s*(.+)$", line))
        }

    def current_ssid(self) -> str:
        result = self.runner.run(["netsh", "wlan", "show", "interfaces"])
        for line in result.stdout.splitlines():
            match = re.search(r"^\s*SSID\s*:\s*(.+)$", line)
            if match and "BSSID" not in line:
                return match.group(1).strip()
        return ""

    def connect(self, profile: str, *, ssid: str | None = None, timeout: float = 30) -> None:
        command = ["netsh", "wlan", "connect", f"name={profile}"]
        if ssid:
            command.append(f"ssid={ssid}")
        self.runner.run(command)
        deadline = time.monotonic() + timeout
        expected = ssid or profile
        while time.monotonic() < deadline:
            if self.current_ssid() == expected:
                return
            time.sleep(1)
        raise TimeoutError(f"Windows did not connect to WLAN {expected}")

    def ensure_softap_profile(self, ssid: str, password: str) -> None:
        if ssid in self.profiles():
            return
        xml = f"""<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>{escape(ssid)}</name>
  <SSIDConfig><SSID><name>{escape(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>manual</connectionMode>
  <MSM><security>
    <authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{escape(password)}</keyMaterial></sharedKey>
  </security></MSM>
</WLANProfile>
"""
        with tempfile.TemporaryDirectory(prefix="resq-wlan-") as directory:
            profile = Path(directory) / "resq-softap.xml"
            profile.write_text(xml, encoding="utf-8")
            self.runner.run(["netsh", "wlan", "add", "profile", f"filename={profile}", "user=current"])
