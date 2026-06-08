from __future__ import annotations

import os
from pathlib import Path

import pytest

from resq_deploy_test.config import ConfigError, load_config


BASE = """
[device]
serial_port = "COM7"
target = "esp32c3"
[network]
lan_profile = "Lab"
wifi_ssid = "Lab"
wifi_password_env = "TEST_WIFI_PASSWORD"
host_ip = "192.168.1.10"
[router]
disable_command = ["hook", "off"]
enable_command = ["hook", "on"]
[calibration]
hall_delta = 100
ref_pressure = 200
bladder_1_pressure = 300
bladder_2_pressure = 400
"""


def write(tmp_path: Path, text: str = BASE) -> Path:
    path = tmp_path / "config.toml"
    path.write_text(text, encoding="utf-8")
    return path


def test_loads_config_and_secret_from_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_WIFI_PASSWORD", "secret")
    config = load_config(write(tmp_path))
    assert config.device.serial_port == "COM7"
    assert config.network.wifi_password == "secret"
    assert config.router.disable_command == ["hook", "off"]


def test_rejects_shell_command_string(tmp_path: Path) -> None:
    text = BASE.replace('disable_command = ["hook", "off"]', 'disable_command = "hook off"')
    with pytest.raises(ConfigError, match="array of strings"):
        load_config(write(tmp_path, text))


def test_rejects_non_c3_target(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="esp32c3"):
        load_config(write(tmp_path, BASE.replace('target = "esp32c3"', 'target = "esp32"')))


def test_missing_secret_is_reported_on_access(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TEST_WIFI_PASSWORD", raising=False)
    config = load_config(write(tmp_path))
    with pytest.raises(ConfigError, match="TEST_WIFI_PASSWORD"):
        _ = config.network.wifi_password
