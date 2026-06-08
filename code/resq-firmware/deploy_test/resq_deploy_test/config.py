from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python < 3.11
    import tomli as tomllib


class ConfigError(ValueError):
    pass


def _table(data: dict[str, Any], name: str) -> dict[str, Any]:
    value = data.get(name, {})
    if not isinstance(value, dict):
        raise ConfigError(f"[{name}] must be a TOML table")
    return value


def _command(value: Any, name: str, *, required: bool = False) -> list[str]:
    if value in (None, []):
        if required:
            raise ConfigError(f"{name} must be a non-empty command array")
        return []
    if not isinstance(value, list) or not value or not all(isinstance(v, str) and v for v in value):
        raise ConfigError(f"{name} must be a non-empty array of strings; shell command strings are rejected")
    return list(value)


@dataclass(frozen=True)
class DeviceConfig:
    serial_port: str
    baud_rate: int = 115200
    target: str = "esp32c3"
    provision_url: str = "http://192.168.4.1"
    softap_ssid_prefix: str = "ResQ-"
    softap_password: str = "resq12345"


@dataclass(frozen=True)
class NetworkConfig:
    lan_profile: str
    wifi_ssid: str
    wifi_password_env: str
    host_ip: str

    @property
    def wifi_password(self) -> str:
        value = os.environ.get(self.wifi_password_env, "")
        if not value:
            raise ConfigError(f"environment variable {self.wifi_password_env} is not set")
        return value


@dataclass(frozen=True)
class ServiceConfig:
    backend_port: int = 18080
    mqtt_port: int = 1883
    mqtt_ws_port: int = 9001
    mosquitto_path: str = ""
    reuse_broker: bool = False


@dataclass(frozen=True)
class RouterConfig:
    disable_command: list[str] = field(default_factory=list)
    enable_command: list[str] = field(default_factory=list)
    healthcheck_command: list[str] = field(default_factory=list)
    timeout_seconds: float = 30.0


@dataclass(frozen=True)
class TimingConfig:
    boot_timeout_seconds: float = 45.0
    provision_timeout_seconds: float = 90.0
    command_timeout_seconds: float = 15.0
    calibration_timeout_seconds: float = 240.0
    short_outage_seconds: float = 5.0
    long_outage_seconds: float = 35.0
    recovery_timeout_seconds: float = 45.0


@dataclass(frozen=True)
class CalibrationConfig:
    hall_delta: int
    ref_pressure: int
    bladder_1_pressure: int
    bladder_2_pressure: int
    profile_id: str = "deploy-qualification"


@dataclass(frozen=True)
class QualificationConfig:
    interactive: bool = True
    run_calibration: bool = True
    run_session: bool = True
    run_recovery: bool = True
    run_destructive: bool = True
    evidence_dir: str = "deploy_test/evidence"


@dataclass(frozen=True)
class DeployConfig:
    firmware_root: Path
    device: DeviceConfig
    network: NetworkConfig
    services: ServiceConfig
    router: RouterConfig
    timing: TimingConfig
    calibration: CalibrationConfig
    qualification: QualificationConfig


def load_config(path: str | Path) -> DeployConfig:
    config_path = Path(path).resolve()
    with config_path.open("rb") as handle:
        raw = tomllib.load(handle)

    device = _table(raw, "device")
    network = _table(raw, "network")
    services = _table(raw, "services")
    router = _table(raw, "router")
    timing = _table(raw, "timing")
    calibration = _table(raw, "calibration")
    qualification = _table(raw, "qualification")

    serial_port = str(device.get("serial_port", "")).strip()
    lan_profile = str(network.get("lan_profile", "")).strip()
    wifi_ssid = str(network.get("wifi_ssid", "")).strip()
    host_ip = str(network.get("host_ip", "")).strip()
    password_env = str(network.get("wifi_password_env", "")).strip()
    if not all((serial_port, lan_profile, wifi_ssid, host_ip, password_env)):
        raise ConfigError("serial_port, lan_profile, wifi_ssid, wifi_password_env, and host_ip are required")

    target = str(device.get("target", "esp32c3"))
    if target != "esp32c3":
        raise ConfigError("deployment qualification only supports target esp32c3")

    firmware_root = config_path.parent.parent if config_path.parent.name == "deploy_test" else config_path.parent
    return DeployConfig(
        firmware_root=firmware_root,
        device=DeviceConfig(
            serial_port=serial_port,
            baud_rate=int(device.get("baud_rate", 115200)),
            target=target,
            provision_url=str(device.get("provision_url", "http://192.168.4.1")).rstrip("/"),
            softap_ssid_prefix=str(device.get("softap_ssid_prefix", "ResQ-")),
            softap_password=str(device.get("softap_password", "resq12345")),
        ),
        network=NetworkConfig(lan_profile, wifi_ssid, password_env, host_ip),
        services=ServiceConfig(
            backend_port=int(services.get("backend_port", 18080)),
            mqtt_port=int(services.get("mqtt_port", 1883)),
            mqtt_ws_port=int(services.get("mqtt_ws_port", 9001)),
            mosquitto_path=str(services.get("mosquitto_path", "")),
            reuse_broker=bool(services.get("reuse_broker", False)),
        ),
        router=RouterConfig(
            disable_command=_command(router.get("disable_command"), "router.disable_command"),
            enable_command=_command(router.get("enable_command"), "router.enable_command"),
            healthcheck_command=_command(router.get("healthcheck_command"), "router.healthcheck_command"),
            timeout_seconds=float(router.get("timeout_seconds", 30)),
        ),
        timing=TimingConfig(**{k: float(v) for k, v in timing.items()}),
        calibration=CalibrationConfig(
            hall_delta=int(calibration.get("hall_delta", 620)),
            ref_pressure=int(calibration.get("ref_pressure", 20100)),
            bladder_1_pressure=int(calibration.get("bladder_1_pressure", 15000)),
            bladder_2_pressure=int(calibration.get("bladder_2_pressure", 15000)),
            profile_id=str(calibration.get("profile_id", "deploy-qualification")),
        ),
        qualification=QualificationConfig(
            interactive=bool(qualification.get("interactive", True)),
            run_calibration=bool(qualification.get("run_calibration", True)),
            run_session=bool(qualification.get("run_session", True)),
            run_recovery=bool(qualification.get("run_recovery", True)),
            run_destructive=bool(qualification.get("run_destructive", True)),
            evidence_dir=str(qualification.get("evidence_dir", "deploy_test/evidence")),
        ),
    )
