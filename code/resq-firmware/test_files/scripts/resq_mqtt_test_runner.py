#!/usr/bin/env python3
"""
ResQ firmware MQTT/functional test runner.

This runner exercises the current ResQ MQTT contract against a live ESP32-C3
device when one is present. Hardware-dependent or intentionally unavailable
checks are reported as SKIP/WARN with an explicit reason instead of being
counted as passing evidence.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import warnings
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple


mqtt = None


SECRET_KEYS = {"wifi_password", "auth_token", "token", "password"}
VALID_STATUSES = {"PASS", "FAIL", "WARN", "SKIP"}
DEFAULT_DEVICE = "resq-node-01"
DEFAULT_EVIDENCE_DIR = "test_files/evidence"
DEFAULT_PROFILE = "adult-basic-v1"


TEST_CASES: List[Dict[str, str]] = [
    {
        "id": "TC-001",
        "name": "MQTT broker reachable",
        "purpose": "Verify the test runner can connect to the configured MQTT broker.",
        "expected": "MQTT connection succeeds.",
    },
    {
        "id": "TC-002",
        "name": "Device publishes status or heartbeat",
        "purpose": "Verify the target device is visible on the broker.",
        "expected": "A status or heartbeat message appears within the timeout.",
    },
    {
        "id": "TC-003",
        "name": "Topic namespace correctness",
        "purpose": "Check observed device topics use the canonical ResQ namespace.",
        "expected": "Observed target-device topics start with resq/manikins/<device_id>/.",
    },
    {
        "id": "TC-010",
        "name": "Status payload shape",
        "purpose": "Validate the minimum status schema used by local hub integrations.",
        "expected": "Status includes device_id/deviceId, state, session_active/sessionActive, and session_id/sessionId.",
    },
    {
        "id": "TC-011",
        "name": "Status retained check",
        "purpose": "Verify a reconnecting observer can obtain the latest status quickly.",
        "expected": "A retained status arrives quickly, or live status appears later as WARN.",
    },
    {
        "id": "TC-020",
        "name": "Periodic heartbeat exists",
        "purpose": "Verify the firmware publishes low-rate heartbeat health updates.",
        "expected": "At least two heartbeat messages arrive within a reasonable time.",
    },
    {
        "id": "TC-021",
        "name": "Heartbeat payload shape",
        "purpose": "Validate the heartbeat health/readiness schema.",
        "expected": "Heartbeat includes required health fields; readiness and sensor health extensions are allowed.",
    },
    {
        "id": "TC-022",
        "name": "Heartbeat is low-rate health, not telemetry",
        "purpose": "Confirm heartbeat is not being used as the live metric stream.",
        "expected": "Heartbeat does not carry continuous compression metrics as its primary payload.",
    },
    {
        "id": "TC-030",
        "name": "cmd/diag/ping",
        "purpose": "Verify the diagnostic ping command returns an event response.",
        "expected": "A command_result or diagnostic event is published on events.",
    },
    {
        "id": "TC-031",
        "name": "cmd/diag/request",
        "purpose": "Verify diagnostic report requests produce a diagnostic event.",
        "expected": "A diagnostic_report event appears; command_result-only ACK is WARN.",
    },
    {
        "id": "TC-032",
        "name": "cmd/diag/health support",
        "purpose": "Check whether the health diagnostic command is implemented and subscribed.",
        "expected": "If supported and subscribed, command returns a response; unsupported commands are SKIP.",
    },
    {
        "id": "TC-040",
        "name": "calibration/start",
        "purpose": "Verify calibration start command behavior without assuming calibration can complete.",
        "expected": "ACK/status CALIBRATING, or NACK/WARN for valid current-state constraints.",
    },
    {
        "id": "TC-041",
        "name": "calibration/capture-normal",
        "purpose": "Verify normal calibration capture command response.",
        "expected": "A command_result ACK/NACK response appears.",
    },
    {
        "id": "TC-042",
        "name": "calibration/capture-full-depth",
        "purpose": "Verify full-depth calibration capture when a user can perform the action.",
        "expected": "Interactive mode only; command_result ACK/NACK response appears.",
    },
    {
        "id": "TC-043",
        "name": "calibration/validate",
        "purpose": "Verify calibration validation emits command/report evidence.",
        "expected": "A calibration_report with result and readyForSession, or command_result-only WARN.",
    },
    {
        "id": "TC-044",
        "name": "calibration/cancel",
        "purpose": "Verify calibration cancel returns the firmware to a safe state.",
        "expected": "A command_result and/or status transition appears.",
    },
    {
        "id": "TC-045",
        "name": "calibration commands during active session",
        "purpose": "Verify active sessions reject calibration start.",
        "expected": "Interactive/session-enabled mode only; calibration/start is rejected while active.",
    },
    {
        "id": "TC-050",
        "name": "session/start without known readiness",
        "purpose": "Validate session start behavior against current calibration readiness.",
        "expected": "NACK when calibration is not ready, or ACK/session active when readiness allows it.",
    },
    {
        "id": "TC-051",
        "name": "session/stop",
        "purpose": "Verify stop command behavior for active or inactive sessions.",
        "expected": "ACK/status IDLE or READY, or NACK/WARN when no session is active.",
    },
    {
        "id": "TC-052",
        "name": "profile mismatch",
        "purpose": "Verify a ready calibration profile is not accepted for a mismatched session profile.",
        "expected": "NACK for mismatched profile when adult-basic-v1 readiness is established.",
    },
    {
        "id": "TC-060",
        "name": "Telemetry only during active session",
        "purpose": "Verify telemetry is not continuously published while idle.",
        "expected": "No continuous telemetry appears while session_active is false.",
    },
    {
        "id": "TC-061",
        "name": "Metric-first telemetry shape",
        "purpose": "Verify active-session telemetry is metric-first instead of raw-heavy.",
        "expected": "Telemetry includes depthMm, rateCpm, recoilOk, pauseS, compressionCount, handPlacement, and flags.",
    },
    {
        "id": "TC-062",
        "name": "debugRaw policy",
        "purpose": "Verify raw readings stay inside debugRaw when present.",
        "expected": "Raw values appear only under debugRaw; debugRawEnabled controls debugRaw presence.",
    },
    {
        "id": "TC-063",
        "name": "Telemetry non-retained check",
        "purpose": "Verify reconnecting observers do not receive stale retained telemetry.",
        "expected": "Old retained telemetry does not arrive immediately.",
    },
    {
        "id": "TC-070",
        "name": "Events topic receives command_result",
        "purpose": "Verify a simple command publishes command_result on events.",
        "expected": "cmd/diag/ping produces command_result on events.",
    },
    {
        "id": "TC-071",
        "name": "Calibration report event shape",
        "purpose": "Inspect calibration_report event shape when validation produces one.",
        "expected": "event_type, device_id, profileId, result, and readyForSession exist.",
    },
    {
        "id": "TC-072",
        "name": "Compression feedback event",
        "purpose": "Verify compression feedback events during an interactive active session.",
        "expected": "Interactive mode only; compression_feedback or equivalent event appears.",
    },
    {
        "id": "TC-080",
        "name": "config/debug update",
        "purpose": "Verify debugRaw config update command produces an explicit response.",
        "expected": "ACK/NACK command_result with a clear reason when rejected.",
    },
    {
        "id": "TC-090",
        "name": "device/reset",
        "purpose": "Verify reset command behavior only when explicitly allowed.",
        "expected": "Interactive destructive mode only; reset event/status or disconnect/reboot occurs.",
    },
    {
        "id": "TC-091",
        "name": "device/unpair",
        "purpose": "Verify unpair command behavior only when explicitly allowed.",
        "expected": "Interactive destructive mode only; unpair/reset/provisioning behavior occurs.",
    },
]

TEST_META = {item["id"]: item for item in TEST_CASES}


@dataclass
class MqttMessage:
    timestamp: str
    topic: str
    payload_raw: str
    payload_json: Optional[Any] = None
    retained: bool = False
    qos: int = 0


@dataclass
class TestResult:
    test_id: str
    name: str
    purpose: str
    command_topic: Optional[str] = None
    command_payload: Optional[Any] = None
    expected_behavior: str = ""
    actual_behavior: str = ""
    status: str = "SKIP"
    matched_messages: List[MqttMessage] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    started_at: str = ""
    ended_at: str = ""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_json_payload(raw: str) -> Optional[Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int) and not isinstance(value, bool):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def redact_any(value: Any) -> Any:
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for key, item in value.items():
            if str(key).lower() in SECRET_KEYS:
                out[key] = "***REDACTED***"
            else:
                out[key] = redact_any(item)
        return out
    if isinstance(value, list):
        return [redact_any(item) for item in value]
    return value


def redact_raw_payload(raw: str, parsed: Optional[Any]) -> str:
    if parsed is not None:
        return json.dumps(redact_any(parsed), separators=(",", ":"))
    redacted = raw
    for key in SECRET_KEYS:
        pattern = re.compile(rf'("{re.escape(key)}"\s*:\s*")[^"]*(")', re.IGNORECASE)
        redacted = pattern.sub(r"\1***REDACTED***\2", redacted)
    return redacted


def markdown_escape(value: Any) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", "<br>")


def load_mqtt_module() -> Any:
    global mqtt
    if mqtt is None:
        try:
            import paho.mqtt.client as paho_mqtt
        except ImportError as exc:
            raise RuntimeError("Missing dependency: paho-mqtt. Install with: pip install paho-mqtt") from exc
        mqtt = paho_mqtt
    return mqtt


def make_mqtt_client(client_id: str) -> Any:
    module = load_mqtt_module()
    if hasattr(module, "CallbackAPIVersion"):
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=DeprecationWarning, message=".*Callback API version 1.*")
                return module.Client(
                    callback_api_version=module.CallbackAPIVersion.VERSION1,
                    client_id=client_id,
                )
        except TypeError:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=DeprecationWarning, message=".*Callback API version 1.*")
                return module.Client(module.CallbackAPIVersion.VERSION1, client_id=client_id)
    return module.Client(client_id=client_id)


def boolean_optional_action() -> Any:
    if hasattr(argparse, "BooleanOptionalAction"):
        return argparse.BooleanOptionalAction
    return "store_true"


class ResQMqttTester:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.repo_root = Path(__file__).resolve().parents[2]
        self.payload_dir = self.repo_root / "test_files" / "payloads"
        self.evidence_dir = Path(args.evidence_dir)
        if not self.evidence_dir.is_absolute():
            self.evidence_dir = self.repo_root / self.evidence_dir

        self.report_md_path = self.evidence_dir / "resq_mqtt_test_report.md"
        self.report_json_path = self.evidence_dir / "resq_mqtt_test_report.json"
        self.messages_jsonl_path = self.evidence_dir / "resq_mqtt_messages.jsonl"

        self.base_topic = f"resq/manikins/{args.device}"
        self.status_topic = f"{self.base_topic}/status"
        self.heartbeat_topic = f"{self.base_topic}/heartbeat"
        self.telemetry_topic = f"{self.base_topic}/telemetry"
        self.events_topic = f"{self.base_topic}/events"

        self.client = None
        self.connected_event = threading.Event()
        self.disconnected_event = threading.Event()
        self.connect_rc: Optional[int] = None
        self.connect_error: Optional[str] = None
        self.broker_available = False
        self.device_present = False

        self.lock = threading.Lock()
        self.messages: List[MqttMessage] = []
        self.results: List[TestResult] = []
        self.calibration_validate_ran = False

    def prepare_evidence_dir(self) -> None:
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self.messages_jsonl_path.write_text("", encoding="utf-8")

    def topic(self, suffix: str) -> str:
        return f"{self.base_topic}/{suffix}"

    def command_name(self, suffix: str) -> str:
        return suffix[4:] if suffix.startswith("cmd/") else suffix

    def start_result(self, test_id: str) -> TestResult:
        meta = TEST_META[test_id]
        return TestResult(
            test_id=test_id,
            name=meta["name"],
            purpose=meta["purpose"],
            expected_behavior=meta["expected"],
            started_at=now_iso(),
        )

    def finish(
        self,
        result: TestResult,
        status: str,
        actual: str,
        matched: Optional[Iterable[MqttMessage]] = None,
        notes: Optional[Iterable[str]] = None,
    ) -> TestResult:
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid test status: {status}")
        result.status = status
        result.actual_behavior = actual
        result.ended_at = now_iso()
        if matched:
            result.matched_messages = list(matched)
        if notes:
            result.notes.extend(str(note) for note in notes)
        return result

    def skip(self, test_id: str, reason: str, notes: Optional[Iterable[str]] = None) -> TestResult:
        return self.finish(self.start_result(test_id), "SKIP", reason, notes=notes)

    def append_missing_skips(self, reason: str) -> None:
        completed = {result.test_id for result in self.results}
        for test in TEST_CASES:
            if test["id"] not in completed:
                self.results.append(self.skip(test["id"], reason))

    def on_connect(self, client: Any, userdata: Any, flags: Dict[str, Any], rc: int) -> None:
        del userdata, flags
        self.connect_rc = int(rc)
        if int(rc) == 0:
            topics = [
                (self.status_topic, 1),
                (self.heartbeat_topic, 1),
                (self.telemetry_topic, 1),
                (self.events_topic, 1),
            ]
            if self.args.debug:
                topics.append((f"{self.base_topic}/#", 1))
            for topic, qos in topics:
                client.subscribe(topic, qos=qos)
        self.connected_event.set()

    def on_disconnect(self, client: Any, userdata: Any, rc: int) -> None:
        del client, userdata
        try:
            self.connect_rc = int(rc)
        except (TypeError, ValueError):
            pass
        self.disconnected_event.set()

    def on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        del client, userdata
        self.record_message(
            topic=str(msg.topic),
            payload_raw=msg.payload.decode("utf-8", errors="replace"),
            retained=bool(getattr(msg, "retain", False)),
            qos=int(getattr(msg, "qos", 0)),
        )

    def record_message(self, topic: str, payload_raw: str, retained: bool = False, qos: int = 0) -> MqttMessage:
        parsed = parse_json_payload(payload_raw)
        message = MqttMessage(
            timestamp=now_iso(),
            topic=topic,
            payload_raw=payload_raw,
            payload_json=parsed,
            retained=retained,
            qos=qos,
        )
        line = {
            "timestamp": message.timestamp,
            "topic": message.topic,
            "payload_raw": message.payload_raw,
            "payload_json": message.payload_json,
            "retained": message.retained,
            "qos": message.qos,
        }
        with self.lock:
            self.messages.append(message)
            with self.messages_jsonl_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(line, separators=(",", ":")) + "\n")
        return message

    def connect(self) -> Tuple[bool, str]:
        try:
            self.client = make_mqtt_client(f"resq-test-runner-{int(time.time())}")
            self.client.on_connect = self.on_connect
            self.client.on_disconnect = self.on_disconnect
            self.client.on_message = self.on_message
            self.client.connect(self.args.broker, int(self.args.port), keepalive=30)
            self.client.loop_start()
        except Exception as exc:  # MQTT/socket errors vary by platform and paho version.
            self.connect_error = str(exc)
            return False, str(exc)

        if not self.connected_event.wait(timeout=min(max(self.args.timeout, 1.0), 10.0)):
            return False, "Timed out waiting for MQTT CONNACK"
        if self.connect_rc != 0:
            return False, f"MQTT CONNACK rc={self.connect_rc}"
        return True, "Connected and subscribed to ResQ topics"

    def disconnect(self) -> None:
        if self.client is None:
            return
        try:
            self.client.disconnect()
            self.client.loop_stop()
        except Exception:
            pass

    def message_count(self) -> int:
        with self.lock:
            return len(self.messages)

    def snapshot(self, since: int = 0) -> List[MqttMessage]:
        with self.lock:
            return list(self.messages[since:])

    def wait_for(
        self,
        predicate: Callable[[MqttMessage], bool],
        timeout: Optional[float] = None,
        since: int = 0,
    ) -> Optional[MqttMessage]:
        deadline = time.monotonic() + (self.args.timeout if timeout is None else timeout)
        while time.monotonic() <= deadline:
            for message in self.snapshot(since):
                if predicate(message):
                    return message
            time.sleep(0.1)
        return None

    def wait_collect(
        self,
        predicate: Callable[[MqttMessage], bool],
        count: int,
        timeout: Optional[float] = None,
        since: int = 0,
    ) -> List[MqttMessage]:
        deadline = time.monotonic() + (self.args.timeout if timeout is None else timeout)
        found_ids: set[int] = set()
        found: List[MqttMessage] = []
        while time.monotonic() <= deadline:
            for message in self.snapshot(since):
                message_id = id(message)
                if message_id not in found_ids and predicate(message):
                    found.append(message)
                    found_ids.add(message_id)
                    if len(found) >= count:
                        return found
            time.sleep(0.1)
        return found

    def payload(self, message: Optional[MqttMessage]) -> Dict[str, Any]:
        if message is None or not isinstance(message.payload_json, dict):
            return {}
        return message.payload_json

    def _payload_contains_manikin(self, payload: Dict[str, Any]) -> bool:
        if not isinstance(payload, dict):
            return False
        return ("manikin_id" in payload) or ("manikinId" in payload)

    def is_topic(self, suffix: str) -> Callable[[MqttMessage], bool]:
        expected = self.topic(suffix)
        return lambda message: message.topic == expected

    def is_status(self, message: MqttMessage) -> bool:
        return message.topic == self.status_topic

    def is_heartbeat(self, message: MqttMessage) -> bool:
        return message.topic == self.heartbeat_topic

    def is_telemetry(self, message: MqttMessage) -> bool:
        return message.topic == self.telemetry_topic

    def is_event_type(self, event_type: str) -> Callable[[MqttMessage], bool]:
        def predicate(message: MqttMessage) -> bool:
            payload = self.payload(message)
            return message.topic == self.events_topic and payload.get("event_type") == event_type

        return predicate

    def is_command_result(self, command: str) -> Callable[[MqttMessage], bool]:
        def predicate(message: MqttMessage) -> bool:
            payload = self.payload(message)
            return (
                message.topic == self.events_topic
                and payload.get("event_type") == "command_result"
                and payload.get("command") == command
            )

        return predicate

    def publish_json(self, suffix: str, payload: Dict[str, Any]) -> str:
        if self.client is None:
            raise RuntimeError("MQTT client is not connected")
        topic = self.topic(suffix)
        body = json.dumps(payload, separators=(",", ":"))
        info = self.client.publish(topic, payload=body, qos=1)
        try:
            info.wait_for_publish(timeout=3.0)
        except TypeError:
            info.wait_for_publish()
        return topic

    def load_payload_file(self, filename: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
        path = self.payload_dir / filename
        if not path.exists():
            return fallback
        return json.loads(path.read_text(encoding="utf-8-sig"))

    def latest_message(self, predicate: Callable[[MqttMessage], bool]) -> Optional[MqttMessage]:
        for message in reversed(self.snapshot(0)):
            if predicate(message):
                return message
        return None

    def status_or_heartbeat_session_active(self) -> Optional[bool]:
        for message in reversed(self.snapshot(0)):
            if not (self.is_status(message) or self.is_heartbeat(message)):
                continue
            payload = self.payload(message)
            for key in ("session_active", "sessionActive"):
                if isinstance(payload.get(key), bool):
                    return bool(payload[key])
        return None

    def calibration_ready_info(self) -> Tuple[Optional[bool], Optional[str], str]:
        for message in reversed(self.snapshot(0)):
            if not (self.is_heartbeat(message) or self.is_status(message) or message.topic == self.events_topic):
                continue
            payload = self.payload(message)
            ready = payload.get("calibrationReady")
            if ready is None:
                ready = payload.get("readyForSession")
            if isinstance(ready, bool):
                profile = payload.get("profileId") or payload.get("profile_id")
                return ready, str(profile) if profile else None, message.topic
        return None, None, "no readiness payload observed"

    def wait_for_command_or_status(
        self,
        command: str,
        status_predicate: Optional[Callable[[Dict[str, Any]], bool]],
        since: int,
        timeout: Optional[float] = None,
    ) -> Tuple[Optional[MqttMessage], Optional[MqttMessage]]:
        command_result: Optional[MqttMessage] = None
        status_message: Optional[MqttMessage] = None
        deadline = time.monotonic() + (self.args.timeout if timeout is None else timeout)
        while time.monotonic() <= deadline:
            for message in self.snapshot(since):
                if command_result is None and self.is_command_result(command)(message):
                    command_result = message
                if (
                    status_message is None
                    and status_predicate is not None
                    and self.is_status(message)
                    and status_predicate(self.payload(message))
                ):
                    status_message = message
                if command_result is not None or status_message is not None:
                    return command_result, status_message
            time.sleep(0.1)
        return command_result, status_message

    def collect_with_temp_client(self, topic: str, timeout: float) -> Tuple[bool, List[MqttMessage], str]:
        messages: List[MqttMessage] = []
        connected = threading.Event()
        error = ""
        try:
            client = make_mqtt_client(f"resq-test-probe-{int(time.time() * 1000)}")

            def on_connect(client_obj: Any, userdata: Any, flags: Dict[str, Any], rc: int) -> None:
                del userdata, flags
                if int(rc) == 0:
                    client_obj.subscribe(topic, qos=1)
                connected.set()

            def on_message(client_obj: Any, userdata: Any, msg: Any) -> None:
                del client_obj, userdata
                messages.append(
                    self.record_message(
                        topic=str(msg.topic),
                        payload_raw=msg.payload.decode("utf-8", errors="replace"),
                        retained=bool(getattr(msg, "retain", False)),
                        qos=int(getattr(msg, "qos", 0)),
                    )
                )

            client.on_connect = on_connect
            client.on_message = on_message
            client.connect(self.args.broker, int(self.args.port), keepalive=30)
            client.loop_start()
            if not connected.wait(timeout=min(timeout, 5.0)):
                error = "Timed out connecting temporary MQTT client"
            else:
                time.sleep(timeout)
            client.disconnect()
            client.loop_stop()
        except Exception as exc:
            error = str(exc)
        return error == "", messages, error

    def detect_diag_health_support(self) -> Dict[str, Any]:
        files = [
            self.repo_root / "components" / "runtime" / "command_handler.c",
            self.repo_root / "components" / "messaging" / "mqtt_manager.c",
            self.repo_root / "components" / "protocol" / "include" / "resq_protocol.h",
            self.repo_root / "docs" / "resq-firmware-current-status-report.md",
        ]
        combined: Dict[str, str] = {}
        for path in files:
            if path.exists():
                combined[str(path.relative_to(self.repo_root))] = path.read_text(encoding="utf-8", errors="ignore")

        handler_text = combined.get("components/runtime/command_handler.c", "")
        protocol_text = combined.get("components/protocol/include/resq_protocol.h", "")
        mqtt_text = combined.get("components/messaging/mqtt_manager.c", "")
        docs_text = combined.get("docs/resq-firmware-current-status-report.md", "")

        handler_exists = "handle_diag_health" in handler_text or "cmd/diag/health" in handler_text
        protocol_declares = "RESQ_SUFFIX_CMD_DIAG_HEALTH" in protocol_text or "cmd/diag/health" in protocol_text
        subscribed = bool(
            re.search(r"mqtt_subscribe_suffix\s*\([^;]*RESQ_SUFFIX_CMD_DIAG_HEALTH", mqtt_text, re.DOTALL)
            or re.search(r"mqtt_subscribe_suffix\s*\([^;]*cmd/diag/health", mqtt_text, re.DOTALL)
        )
        docs_missing_subscription = "cmd/diag/health" in docs_text and "subscription" in docs_text.lower()
        return {
            "source_checked": sorted(combined.keys()),
            "handler_exists": handler_exists,
            "protocol_declares": protocol_declares,
            "subscribed": subscribed,
            "docs_missing_subscription": docs_missing_subscription,
        }

    def tc001_broker_reachable(self) -> TestResult:
        result = self.start_result("TC-001")
        ok, message = self.connect()
        self.broker_available = ok
        status = "PASS" if ok else "FAIL"
        notes = [self.connect_error] if self.connect_error else []
        return self.finish(result, status, message, notes=notes)

    def tc002_device_presence(self) -> TestResult:
        result = self.start_result("TC-002")
        message = self.wait_for(lambda item: self.is_status(item) or self.is_heartbeat(item), timeout=self.args.timeout)
        self.device_present = message is not None
        if message is None:
            return self.finish(result, "FAIL", "No status or heartbeat message was observed within the timeout")
        return self.finish(result, "PASS", f"Observed {message.topic}", matched=[message])

    def tc003_topic_namespace(self) -> TestResult:
        result = self.start_result("TC-003")
        messages = self.snapshot(0)
        device_related = [
            item
            for item in messages
            if self.args.device in item.topic or item.topic.startswith("resq/manikins/")
        ]
        outside = [item for item in device_related if not item.topic.startswith(f"{self.base_topic}/")]
        if outside:
            topics = sorted({item.topic for item in outside})
            return self.finish(result, "FAIL", f"Observed topics outside canonical namespace: {topics}", outside)
        if not device_related:
            return self.finish(result, "SKIP", "No device-related topics were observed")
        topics = sorted({item.topic for item in device_related})
        return self.finish(result, "PASS", f"All observed device topics use canonical namespace: {topics}", device_related[:5])

    def tc010_status_payload_shape(self) -> TestResult:
        result = self.start_result("TC-010")
        message = self.latest_message(self.is_status) or self.wait_for(self.is_status, timeout=self.args.timeout)
        payload = self.payload(message)
        if not payload:
            return self.finish(result, "FAIL", "No JSON status payload was observed", matched=[message] if message else None)

        if self._payload_contains_manikin(payload):
            return self.finish(result, "FAIL", "Status payload contains deprecated manikin_id/manikinId field", matched=[message])

        aliases = [
            ("device_id", "deviceId"),
            ("state",),
            ("session_active", "sessionActive"),
            ("session_id", "sessionId"),
        ]
        missing = []
        naming_styles = set()
        for group in aliases:
            found = [key for key in group if key in payload]
            if not found:
                missing.append("/".join(group))
            for key in found:
                if "_" in key:
                    naming_styles.add("snake")
                elif key != "state":
                    naming_styles.add("camel")

        if missing:
            return self.finish(result, "FAIL", f"Status missing core fields: {missing}", matched=[message])
        if len(naming_styles) > 1:
            return self.finish(result, "WARN", "Status has mixed snake/camel naming but required aliases are usable", [message])
        return self.finish(result, "PASS", "Status payload contains required fields", [message])

    def tc011_status_retained(self) -> TestResult:
        result = self.start_result("TC-011")
        ok, quick_messages, error = self.collect_with_temp_client(self.status_topic, timeout=min(2.0, self.args.timeout))
        if not ok:
            return self.finish(result, "FAIL", f"Temporary MQTT client failed: {error}")
        retained = [item for item in quick_messages if item.retained]
        if retained:
            return self.finish(result, "PASS", "Retained status arrived quickly for a reconnecting client", retained)
        if quick_messages:
            return self.finish(result, "WARN", "Status arrived quickly but was not marked retained", quick_messages)

        remaining = max(0.0, self.args.timeout - min(2.0, self.args.timeout))
        if remaining > 0:
            ok, later_messages, error = self.collect_with_temp_client(self.status_topic, timeout=remaining)
            if not ok:
                return self.finish(result, "FAIL", f"Temporary MQTT client failed while waiting for live status: {error}")
            if later_messages:
                return self.finish(result, "WARN", "No retained status; live status arrived later", later_messages)
        return self.finish(result, "FAIL", "No retained or live status arrived for a reconnecting client")

    def tc020_periodic_heartbeat(self) -> TestResult:
        result = self.start_result("TC-020")
        since = 0
        timeout = max(self.args.timeout * 2.0, self.args.timeout + 1.0)
        heartbeats = self.wait_collect(self.is_heartbeat, count=2, timeout=timeout, since=since)
        if len(heartbeats) >= 2:
            intervals = []
            for left, right in zip(heartbeats, heartbeats[1:]):
                t1 = datetime.fromisoformat(left.timestamp)
                t2 = datetime.fromisoformat(right.timestamp)
                intervals.append(round((t2 - t1).total_seconds(), 2))
            return self.finish(result, "PASS", f"Observed {len(heartbeats)} heartbeats; intervals={intervals}s", heartbeats)
        if len(heartbeats) == 1:
            return self.finish(result, "WARN", "Only one heartbeat arrived within the heartbeat observation window", heartbeats)
        return self.finish(result, "FAIL", "No heartbeat messages arrived")

    def tc021_heartbeat_shape(self) -> TestResult:
        result = self.start_result("TC-021")
        message = self.latest_message(self.is_heartbeat) or self.wait_for(self.is_heartbeat, timeout=self.args.timeout)
        payload = self.payload(message)
        if not payload:
            return self.finish(result, "FAIL", "No JSON heartbeat payload was observed", matched=[message] if message else None)
        if self._payload_contains_manikin(payload):
            return self.finish(result, "FAIL", "Heartbeat payload contains deprecated manikin_id/manikinId field", [message])

        # New minimal heartbeat policy: accept a tiny liveliness object.
        # Preferred: { "ok": true } ; acceptable: { "alive": true, "state": "IDLE" }
        if "ok" not in payload and "alive" not in payload:
            return self.finish(result, "FAIL", "Heartbeat missing minimal liveness field (ok|alive)", [message])

        # Ensure top-level raw sensor fields are not present in heartbeat
        debug_fields = {"force1", "force2", "hallRaw", "hallFiltered", "currentDelta", "force1Raw", "force2Raw", "hall_raw"}
        top_debug = sorted(debug_fields.intersection(payload.keys()))
        if top_debug:
            return self.finish(result, "WARN", f"Heartbeat includes top-level debug/raw fields: {top_debug}", [message])

        return self.finish(result, "PASS", "Heartbeat is minimal liveness payload (ok/alive) and contains no top-level raw fields", [message])

    def tc022_heartbeat_not_telemetry(self) -> TestResult:
        result = self.start_result("TC-022")
        message = self.latest_message(self.is_heartbeat) or self.wait_for(self.is_heartbeat, timeout=self.args.timeout)
        payload = self.payload(message)
        if not payload:
            return self.finish(result, "FAIL", "No JSON heartbeat payload was observed", matched=[message] if message else None)

        metric_fields = {"depthMm", "rateCpm", "recoilOk", "pauseS", "handPlacement", "flags"}
        present = sorted(metric_fields.intersection(payload.keys()))
        if len(present) >= 4:
            return self.finish(result, "FAIL", f"Heartbeat appears to be carrying live telemetry fields: {present}", [message])
        if present:
            return self.finish(result, "WARN", f"Heartbeat includes some live metric fields: {present}", [message])
        debug_fields = {"force1", "force2", "hallRaw", "hallFiltered", "currentDelta"}
        top_debug = sorted(debug_fields.intersection(payload.keys()))
        if top_debug:
            return self.finish(result, "WARN", f"Heartbeat includes top-level debug/raw fields: {top_debug}", [message])
        return self.finish(
            result,
            "PASS",
            "Heartbeat is low-rate health/readiness; readiness and sensorHealth fields are accepted",
            [message],
        )

    def run_diag_command(self, test_id: str, suffix: str, payload: Dict[str, Any]) -> TestResult:
        result = self.start_result(test_id)
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        command = self.command_name(suffix)
        messages = self.wait_collect(
            lambda item: self.is_command_result(command)(item)
            or (item.topic == self.events_topic and self.payload(item).get("event_type", "").startswith("diagnostic")),
            count=1,
            timeout=self.args.timeout,
            since=since,
        )
        if messages:
            return self.finish(result, "PASS", f"Observed diagnostic response for {command}", messages)
        return self.finish(result, "FAIL", f"No events response observed for {command}")

    def tc030_diag_ping(self) -> TestResult:
        return self.run_diag_command("TC-030", "cmd/diag/ping", {"commandId": "PING-001"})

    def tc031_diag_request(self) -> TestResult:
        result = self.start_result("TC-031")
        suffix = "cmd/diag/request"
        payload = {"commandId": "DIAG-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        messages = self.wait_collect(
            lambda item: self.is_event_type("diagnostic_report")(item) or self.is_command_result("diag/request")(item),
            count=2,
            timeout=self.args.timeout,
            since=since,
        )
        diagnostic = [item for item in messages if self.is_event_type("diagnostic_report")(item)]
        command_result = [item for item in messages if self.is_command_result("diag/request")(item)]
        if diagnostic:
            return self.finish(result, "PASS", "Diagnostic report event was published", messages)
        if command_result:
            return self.finish(result, "WARN", "Only command_result ACK was observed; no diagnostic_report event", command_result)
        return self.finish(result, "FAIL", "No diagnostic response observed")

    def tc032_diag_health(self) -> TestResult:
        result = self.start_result("TC-032")
        support = self.detect_diag_health_support()
        notes = [
            f"source_checked={support['source_checked']}",
            f"handler_exists={support['handler_exists']}",
            f"protocol_declares={support['protocol_declares']}",
            f"subscribed={support['subscribed']}",
        ]
        if support["handler_exists"] and not support["subscribed"]:
            return self.finish(
                result,
                "FAIL",
                "cmd/diag/health handler exists, but MQTT subscription was not found",
                notes=notes,
            )
        if not support["handler_exists"] and not support["protocol_declares"]:
            return self.finish(result, "SKIP", "cmd/diag/health is not implemented in inspected firmware sources", notes=notes)

        suffix = "cmd/diag/health"
        payload = {"commandId": "HEALTH-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        messages = self.wait_collect(
            lambda item: self.is_command_result("diag/health")(item)
            or (
                item.topic == self.events_topic
                and isinstance(self.payload(item), dict)
                and self.payload(item).get("event_type", "") in ("diagnostic_health", "health_report")
            ),
            count=1,
            timeout=self.args.timeout,
            since=since,
        )

        if not messages:
            return self.finish(result, "FAIL", "cmd/diag/health appears supported/subscribed but no response was observed", notes=notes)

        # Prefer an explicit diagnostic event on the events topic
        evt = next(
            (m for m in messages if m.topic == self.events_topic and isinstance(self.payload(m), dict) and self.payload(m).get("event_type") in ("diagnostic_health", "health_report")),
            None,
        )

        if evt:
            body = self.payload(evt)
            required = [
                "event_type",
                "device_id",
                "wifi_connected",
                "mqtt_connected",
                "ip",
                "session_active",
                "sensor_running",
                "session_id",
                "force1_ok",
                "force2_ok",
                "hall_ok",
                "compression_count",
                "calibrationReady",
                "calibrationState",
                "profileId",
                "lastCalibrationResult",
                "debugRawEnabled",
                "sensorMode",
                "uptimeMs",
            ]
            missing = [k for k in required if k not in body]
            if missing:
                return self.finish(result, "FAIL", f"Diagnostic health event missing fields: {missing}", [evt], notes=notes)
            return self.finish(result, "PASS", "Diagnostic health event observed on events topic", [evt], notes=notes)

        # If only a command_result ACK was observed, treat as WARN (event preferred)
        return self.finish(result, "WARN", "Only command_result ACK observed; diagnostic event not present", messages, notes=notes)

    def command_status_from(self, message: Optional[MqttMessage]) -> Tuple[str, str]:
        payload = self.payload(message)
        return str(payload.get("status", "")).upper(), str(payload.get("reason", ""))

    def is_current_state(self, payload: Dict[str, Any], fragments: Iterable[str]) -> bool:
        state = str(payload.get("state", "")).upper()
        return any(fragment.upper() in state for fragment in fragments)

    def tc040_calibration_start(self) -> TestResult:
        if self.args.skip_calibration:
            return self.skip("TC-040", "Calibration tests skipped by --skip-calibration")
        result = self.start_result("TC-040")
        suffix = "cmd/calibration/start"
        payload = self.load_payload_file("calibration-start.json", {"profileId": DEFAULT_PROFILE, "commandId": "CAL-START-001"})
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        command_result, status_message = self.wait_for_command_or_status(
            "calibration/start",
            lambda item: self.is_current_state(item, ["CALIBRAT"]),
            since,
        )
        matched = [item for item in (command_result, status_message) if item is not None]
        if status_message:
            return self.finish(result, "PASS", "Status moved to calibration state", matched)
        status, reason = self.command_status_from(command_result)
        if status == "ACK":
            return self.finish(result, "PASS", "calibration/start ACK was observed", matched)
        if status == "NACK":
            return self.finish(result, "WARN", f"calibration/start NACK observed: {reason or 'no reason provided'}", matched)
        return self.finish(result, "FAIL", "No calibration/start command_result or CALIBRATING status was observed")

    def tc041_calibration_capture_normal(self) -> TestResult:
        if self.args.skip_calibration:
            return self.skip("TC-041", "Calibration tests skipped by --skip-calibration")
        result = self.start_result("TC-041")
        suffix = "cmd/calibration/capture-normal"
        payload = self.load_payload_file(
            "calibration-capture-normal.json",
            {"profileId": DEFAULT_PROFILE, "commandId": "CAL-CAP-NORM-001", "windowMs": 3000},
        )
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        message = self.wait_for(self.is_command_result("calibration/capture-normal"), since=since)
        status, reason = self.command_status_from(message)
        if status == "ACK":
            return self.finish(result, "PASS", "calibration/capture-normal ACK was observed", [message])
        if status == "NACK":
            return self.finish(result, "WARN", f"calibration/capture-normal NACK observed: {reason or 'no reason provided'}", [message])
        return self.finish(result, "FAIL", "No calibration/capture-normal command_result was observed")

    def tc042_calibration_capture_full_depth(self) -> TestResult:
        if self.args.skip_calibration:
            return self.skip("TC-042", "Calibration tests skipped by --skip-calibration")
        if not self.args.interactive:
            return self.skip("TC-042", "Full-depth capture requires --interactive and physical compression input")
        input("TC-042: perform a full-depth compression, then press Enter to publish capture-full-depth...")
        result = self.start_result("TC-042")
        suffix = "cmd/calibration/capture-full-depth"
        payload = self.load_payload_file(
            "calibration-capture-full-depth.json",
            {"profileId": DEFAULT_PROFILE, "commandId": "CAL-CAP-FULL-001", "windowMs": 3000},
        )
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        message = self.wait_for(self.is_command_result("calibration/capture-full-depth"), since=since)
        status, reason = self.command_status_from(message)
        if status == "ACK":
            return self.finish(result, "PASS", "calibration/capture-full-depth ACK was observed", [message])
        if status == "NACK":
            return self.finish(result, "WARN", f"calibration/capture-full-depth NACK observed: {reason or 'no reason provided'}", [message])
        return self.finish(result, "FAIL", "No calibration/capture-full-depth command_result was observed")

    def tc043_calibration_validate(self) -> TestResult:
        if self.args.skip_calibration:
            return self.skip("TC-043", "Calibration tests skipped by --skip-calibration")
        self.calibration_validate_ran = True
        result = self.start_result("TC-043")
        suffix = "cmd/calibration/validate"
        payload = self.load_payload_file("calibration-validate.json", {"profileId": DEFAULT_PROFILE, "commandId": "CAL-VALID-001"})
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        messages = self.wait_collect(
            lambda item: self.is_command_result("calibration/validate")(item) or self.is_event_type("calibration_report")(item),
            count=2,
            timeout=self.args.timeout,
            since=since,
        )
        reports = [item for item in messages if self.is_event_type("calibration_report")(item)]
        command_results = [item for item in messages if self.is_command_result("calibration/validate")(item)]
        for report in reports:
            payload_json = self.payload(report)
            if "result" in payload_json and "readyForSession" in payload_json:
                return self.finish(result, "PASS", "calibration_report contains result and readyForSession", messages)
        if reports:
            return self.finish(result, "WARN", "calibration_report was observed but lacks result/readyForSession", messages)
        if command_results:
            return self.finish(result, "WARN", "Only calibration/validate command_result was observed", command_results)
        return self.finish(result, "FAIL", "No calibration/validate command_result or calibration_report was observed")

    def tc044_calibration_cancel(self) -> TestResult:
        if self.args.skip_calibration:
            return self.skip("TC-044", "Calibration tests skipped by --skip-calibration")
        result = self.start_result("TC-044")
        suffix = "cmd/calibration/cancel"
        payload = {"profileId": DEFAULT_PROFILE, "commandId": "CAL-CANCEL-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        command_result, status_message = self.wait_for_command_or_status(
            "calibration/cancel",
            lambda item: self.is_current_state(item, ["IDLE", "READY", "FAIL", "ONLINE"]),
            since,
        )
        matched = [item for item in (command_result, status_message) if item is not None]
        if matched:
            return self.finish(result, "PASS", "calibration/cancel response or safe status was observed", matched)
        return self.finish(result, "FAIL", "No calibration/cancel response was observed")

    def tc045_calibration_during_session(self) -> TestResult:
        if self.args.skip_calibration:
            return self.skip("TC-045", "Calibration tests skipped by --skip-calibration")
        if self.args.skip_session:
            return self.skip("TC-045", "Session-dependent tests skipped by --skip-session")
        if not self.args.interactive:
            return self.skip("TC-045", "Active-session calibration rejection requires --interactive")
        result = self.start_result("TC-045")
        session_started = self.start_session_for_test("TEST-S-CAL-ACTIVE")
        if not session_started:
            return self.finish(result, "SKIP", "Could not establish an active session before calibration rejection check")
        suffix = "cmd/calibration/start"
        payload = {"profileId": DEFAULT_PROFILE, "commandId": "CAL-ACTIVE-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        command_result, status_message = self.wait_for_command_or_status(
            "calibration/start",
            lambda item: self.is_current_state(item, ["CALIBRAT"]),
            since,
        )
        self.stop_session_for_test("TEST-S-CAL-ACTIVE")
        matched = [item for item in (command_result, status_message) if item is not None]
        status, reason = self.command_status_from(command_result)
        if status == "NACK":
            return self.finish(result, "PASS", f"calibration/start rejected while active: {reason}", matched)
        if status_message or status == "ACK":
            return self.finish(result, "FAIL", "calibration/start was accepted or calibration status appeared during active session", matched)
        return self.finish(result, "FAIL", "No calibration/start rejection response was observed during active session")

    def start_session_for_test(self, session_id: str, profile_id: str = DEFAULT_PROFILE) -> bool:
        suffix = "cmd/session/start"
        payload = {"sessionId": session_id, "profileId": profile_id, "commandId": f"START-{session_id}"}
        since = self.message_count()
        self.publish_json(suffix, payload)
        command_result, status_message = self.wait_for_command_or_status(
            "session/start",
            lambda item: self.is_current_state(item, ["SESSION", "ACTIVE"]) or bool(item.get("session_active") or item.get("sessionActive")),
            since,
            timeout=self.args.timeout,
        )
        status, _reason = self.command_status_from(command_result)
        return status == "ACK" or status_message is not None

    def stop_session_for_test(self, session_id: str = "TEST-S-001") -> None:
        try:
            since = self.message_count()
            self.publish_json("cmd/session/stop", {"sessionId": session_id, "commandId": f"STOP-{session_id}"})
            self.wait_for(self.is_command_result("session/stop"), timeout=min(self.args.timeout, 5.0), since=since)
        except Exception:
            pass

    def tc050_session_start(self) -> TestResult:
        if self.args.skip_session:
            return self.skip("TC-050", "Session tests skipped by --skip-session")
        result = self.start_result("TC-050")
        suffix = "cmd/session/start"
        payload = {"sessionId": "TEST-S-001", "profileId": DEFAULT_PROFILE, "commandId": "START-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        ready, profile, ready_source = self.calibration_ready_info()
        since = self.message_count()
        self.publish_json(suffix, payload)
        messages = self.wait_collect(
            lambda item: self.is_command_result("session/start")(item)
            or self.is_event_type("calibration_bypassed")(item)
            or (self.is_status(item) and (self.is_current_state(self.payload(item), ["SESSION", "ACTIVE"]) or bool(self.payload(item).get("session_active") or self.payload(item).get("sessionActive")))),
            count=2,
            timeout=self.args.timeout,
            since=since,
        )
        command_results = [item for item in messages if self.is_command_result("session/start")(item)]
        bypass_events = [item for item in messages if self.is_event_type("calibration_bypassed")(item)]
        active_status = [
            item for item in messages
            if self.is_status(item)
            and (self.is_current_state(self.payload(item), ["SESSION", "ACTIVE"]) or bool(self.payload(item).get("session_active") or self.payload(item).get("sessionActive")))
        ]
        status, reason = self.command_status_from(command_results[0] if command_results else None)
        if status == "ACK" or active_status:
            if ready is True:
                return self.finish(result, "PASS", f"Session accepted with calibration readiness from {ready_source}", messages)
            if bypass_events:
                return self.finish(result, "WARN", "Session accepted with calibration_bypassed event; firmware config may not require calibration", messages)
            return self.finish(result, "FAIL", f"Session accepted while calibration readiness was {ready} profile={profile}", messages)
        if status == "NACK":
            reason_lower = reason.lower()
            if ready is not True and any(token in reason_lower for token in ("calibration", "ready", "readiness", "profile")):
                return self.finish(result, "PASS", f"Session rejected because calibration/profile is not ready: {reason}", command_results)
            if "already active" in reason_lower:
                return self.finish(result, "WARN", f"Session start rejected because a session was already active: {reason}", command_results)
            return self.finish(result, "FAIL", f"Unexpected session/start NACK: {reason}", command_results)
        return self.finish(result, "FAIL", "No session/start command_result or active status was observed")

    def tc051_session_stop(self) -> TestResult:
        if self.args.skip_session:
            return self.skip("TC-051", "Session tests skipped by --skip-session")
        result = self.start_result("TC-051")
        suffix = "cmd/session/stop"
        payload = {"sessionId": "TEST-S-001", "commandId": "STOP-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        command_result, status_message = self.wait_for_command_or_status(
            "session/stop",
            lambda item: self.is_current_state(item, ["IDLE", "READY", "ONLINE"]) or not bool(item.get("session_active") or item.get("sessionActive")),
            since,
        )
        matched = [item for item in (command_result, status_message) if item is not None]
        status, reason = self.command_status_from(command_result)
        if status == "ACK" or status_message:
            return self.finish(result, "PASS", "session/stop ACK or idle/ready status was observed", matched)
        if status == "NACK" and "no active" in reason.lower():
            return self.finish(result, "WARN", f"session/stop NACK because no active session exists: {reason}", matched)
        if status == "NACK":
            return self.finish(result, "FAIL", f"Unexpected session/stop NACK: {reason}", matched)
        return self.finish(result, "FAIL", "No session/stop command_result or idle/ready status was observed")

    def tc052_profile_mismatch(self) -> TestResult:
        if self.args.skip_session:
            return self.skip("TC-052", "Session tests skipped by --skip-session")
        result = self.start_result("TC-052")
        ready, profile, source = self.calibration_ready_info()
        if ready is not True or profile != DEFAULT_PROFILE:
            return self.finish(
                result,
                "SKIP",
                f"Readiness for {DEFAULT_PROFILE} was not established (ready={ready}, profile={profile}, source={source})",
            )
        suffix = "cmd/session/start"
        payload = {"sessionId": "TEST-S-MISMATCH", "profileId": "mismatch-profile", "commandId": "START-MISMATCH-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        command_result, status_message = self.wait_for_command_or_status(
            "session/start",
            lambda item: self.is_current_state(item, ["SESSION", "ACTIVE"]) or bool(item.get("session_active") or item.get("sessionActive")),
            since,
        )
        status, reason = self.command_status_from(command_result)
        matched = [item for item in (command_result, status_message) if item is not None]
        if status == "NACK":
            return self.finish(result, "PASS", f"Profile mismatch rejected: {reason}", matched)
        if status == "ACK" or status_message:
            self.stop_session_for_test("TEST-S-MISMATCH")
            return self.finish(result, "FAIL", "Profile mismatch was accepted", matched)
        return self.finish(result, "FAIL", "No response to profile mismatch session/start")

    def tc060_telemetry_idle_policy(self) -> TestResult:
        result = self.start_result("TC-060")
        active = self.status_or_heartbeat_session_active()
        if active is True:
            return self.finish(result, "SKIP", "Latest status/heartbeat says session is active; idle telemetry policy cannot be evaluated")
        since = self.message_count()
        telemetry = self.wait_collect(self.is_telemetry, count=2, timeout=self.args.timeout, since=since)
        if not telemetry:
            return self.finish(result, "PASS", "No telemetry appeared while latest state was idle/not active")
        if len(telemetry) == 1:
            return self.finish(result, "WARN", "One telemetry message appeared while idle; may be stale or transition-related", telemetry)
        return self.finish(result, "FAIL", "Continuous telemetry appeared while latest state was idle/not active", telemetry)

    def telemetry_shape_result(self, result: TestResult, message: MqttMessage, matched: List[MqttMessage]) -> TestResult:
        payload = self.payload(message)
        if self._payload_contains_manikin(payload):
            return self.finish(result, "FAIL", "Telemetry payload contains deprecated manikin_id/manikinId field", matched)
        expected = {"depthMm", "rateCpm", "recoilOk", "pauseS", "compressionCount", "handPlacement", "flags"}
        raw_fields = {"force1", "force2", "hallRaw", "hallFiltered", "currentDelta", "force1Raw", "force2Raw", "hall_raw"}
        present = expected.intersection(payload.keys())
        top_raw = raw_fields.intersection(payload.keys())
        if len(top_raw) >= 3 and len(present) < 3:
            return self.finish(result, "FAIL", f"Telemetry is mostly raw-only; top-level raw fields={sorted(top_raw)}", matched)
        if expected.issubset(payload.keys()):
            return self.finish(result, "PASS", "Telemetry uses the expected metric-first shape", matched)
        if present:
            missing = sorted(expected.difference(payload.keys()))
            return self.finish(result, "WARN", f"Telemetry is metric-oriented but missing fields: {missing}", matched)
        return self.finish(result, "FAIL", f"Telemetry lacks metric-first fields; observed keys={sorted(payload.keys())}", matched)

    def tc061_metric_first_telemetry(self) -> TestResult:
        if self.args.skip_session:
            return self.skip("TC-061", "Session tests skipped by --skip-session")
        result = self.start_result("TC-061")
        session_id = "TEST-S-TEL"
        started = self.start_session_for_test(session_id)
        if not started:
            return self.finish(result, "SKIP", "Could not start active session; calibration/readiness may be required")
        since = self.message_count()
        telemetry = self.wait_collect(self.is_telemetry, count=1, timeout=self.args.timeout, since=since)
        self.stop_session_for_test(session_id)
        if not telemetry:
            return self.finish(result, "WARN", "Active session started, but no telemetry arrived within timeout; physical compressions may be required")
        return self.telemetry_shape_result(result, telemetry[0], telemetry)

    def tc062_debug_raw_policy(self) -> TestResult:
        result = self.start_result("TC-062")
        telemetry = [item for item in self.snapshot(0) if self.is_telemetry(item) and isinstance(item.payload_json, dict)]
        if not telemetry:
            return self.finish(result, "SKIP", "No telemetry payload was observed for debugRaw policy inspection")

        raw_fields = {"force1", "force2", "hallRaw", "hallFiltered", "currentDelta", "force1Raw", "force2Raw", "hall_raw"}
        top_raw_messages = [item for item in telemetry if raw_fields.intersection(self.payload(item).keys())]
        debug_raw_messages = [item for item in telemetry if isinstance(self.payload(item).get("debugRaw"), dict)]
        if top_raw_messages:
            return self.finish(result, "FAIL", "Raw values appeared as top-level telemetry fields", top_raw_messages[:3])
        if debug_raw_messages:
            heartbeat = self.latest_message(self.is_heartbeat)
            heartbeat_payload = self.payload(heartbeat)
            if heartbeat_payload.get("debugRawEnabled") is False:
                return self.finish(result, "WARN", "debugRaw appeared while latest heartbeat says debugRawEnabled=false", debug_raw_messages[:3])
            return self.finish(result, "PASS", "Raw values appeared only inside debugRaw", debug_raw_messages[:3])
        return self.finish(result, "PASS", "No raw/debug fields were present in observed telemetry", telemetry[:3])

    def tc063_telemetry_non_retained(self) -> TestResult:
        result = self.start_result("TC-063")
        ok, messages, error = self.collect_with_temp_client(self.telemetry_topic, timeout=min(2.0, self.args.timeout))
        if not ok:
            return self.finish(result, "FAIL", f"Temporary MQTT client failed: {error}")
        retained = [item for item in messages if item.retained]
        if retained:
            return self.finish(result, "FAIL", "Retained telemetry arrived for a reconnecting client", retained)
        if messages:
            return self.finish(result, "PASS", "Only live non-retained telemetry arrived for reconnecting client", messages)
        return self.finish(result, "PASS", "No retained telemetry arrived immediately")

    def tc070_command_result_event(self) -> TestResult:
        result = self.start_result("TC-070")
        suffix = "cmd/diag/ping"
        payload = {"commandId": "PING-EVENT-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        message = self.wait_for(self.is_command_result("diag/ping"), since=since)
        if message:
            return self.finish(result, "PASS", "command_result was published on events", [message])
        return self.finish(result, "FAIL", "No command_result event was observed after diag/ping")

    def tc071_calibration_report_shape(self) -> TestResult:
        if self.args.skip_calibration:
            return self.skip("TC-071", "Calibration report inspection skipped by --skip-calibration")
        result = self.start_result("TC-071")
        reports = [item for item in self.snapshot(0) if self.is_event_type("calibration_report")(item)]
        if not self.calibration_validate_ran:
            return self.finish(result, "SKIP", "calibration/validate did not run, so no calibration_report was expected")
        if not reports:
            return self.finish(result, "WARN", "calibration/validate ran but no calibration_report event was observed")
        report = reports[-1]
        payload = self.payload(report)
        required = ["event_type", "device_id", "profileId", "result", "readyForSession"]
        missing = [key for key in required if key not in payload]
        if missing:
            return self.finish(result, "FAIL", f"calibration_report missing fields: {missing}", [report])
        extra_count = max(0, len(payload.keys()) - len(required))
        if extra_count == 0:
            return self.finish(result, "PASS", "calibration_report contains required minimal fields", [report])
        return self.finish(result, "PASS", f"calibration_report contains required fields plus {extra_count} extra fields", [report])

    def tc072_compression_feedback_event(self) -> TestResult:
        if not self.args.interactive:
            return self.skip("TC-072", "Compression feedback requires --interactive and physical compressions")
        if self.args.skip_session:
            return self.skip("TC-072", "Session-dependent tests skipped by --skip-session")
        result = self.start_result("TC-072")
        session_id = "TEST-S-FEEDBACK"
        if not self.start_session_for_test(session_id):
            return self.finish(result, "SKIP", "Could not start active session for compression feedback")
        input("TC-072: perform several compressions, then press Enter to observe feedback events...")
        since = self.message_count()
        feedback = self.wait_collect(
            lambda item: item.topic == self.events_topic and "compression" in str(self.payload(item).get("event_type", "")).lower(),
            count=1,
            timeout=self.args.timeout,
            since=since,
        )
        telemetry = [item for item in self.snapshot(since) if self.is_telemetry(item)]
        self.stop_session_for_test(session_id)
        if feedback:
            return self.finish(result, "PASS", "Compression feedback event was observed", feedback)
        if telemetry:
            return self.finish(result, "WARN", "No compression feedback event; telemetry feedback was observed instead", telemetry[:3])
        return self.finish(result, "FAIL", "No compression feedback event or telemetry feedback was observed")

    def tc080_config_debug_update(self) -> TestResult:
        result = self.start_result("TC-080")
        suffix = "cmd/config/update"
        payload = self.load_payload_file("config-debug.json", {"debugRawEnabled": True})
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        message = self.wait_for(self.is_command_result("config/update"), since=since)
        status, reason = self.command_status_from(message)
        if status == "ACK":
            return self.finish(result, "PASS", "config/update ACK was observed; debugRaw setting may have changed", [message])
        if status == "NACK" and reason:
            return self.finish(result, "PASS", f"config/update NACK with clear reason: {reason}", [message])
        if status == "NACK":
            return self.finish(result, "WARN", "config/update NACK was observed without a clear reason", [message])
        return self.finish(result, "FAIL", "No config/update command_result was observed")

    def destructive_allowed(self) -> bool:
        return bool(self.args.interactive and not self.args.skip_destructive)

    def tc090_device_reset(self) -> TestResult:
        if not self.destructive_allowed():
            return self.skip("TC-090", "Destructive reset skipped by default; use --interactive --no-skip-destructive to run")
        confirm = input("TC-090 will reset the device. Type RESET to continue: ")
        if confirm != "RESET":
            return self.skip("TC-090", "User did not confirm reset")
        result = self.start_result("TC-090")
        suffix = "cmd/device/reset"
        payload = {"commandId": "RESET-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        messages = self.wait_collect(
            lambda item: self.is_command_result("device/reset")(item)
            or (self.is_status(item) and self.is_current_state(self.payload(item), ["RESET"]))
            or self.disconnected_event.is_set(),
            count=1,
            timeout=self.args.timeout,
            since=since,
        )
        if messages or self.disconnected_event.is_set():
            return self.finish(result, "PASS", "Reset command response, reset status, or disconnect was observed", messages)
        return self.finish(result, "SKIP", "Reset was confirmed but no reset evidence was observed")

    def tc091_device_unpair(self) -> TestResult:
        if not self.destructive_allowed():
            return self.skip("TC-091", "Destructive unpair skipped by default; use --interactive --no-skip-destructive to run")
        confirm = input("TC-091 will unpair/clear device config. Type UNPAIR to continue: ")
        if confirm != "UNPAIR":
            return self.skip("TC-091", "User did not confirm unpair")
        result = self.start_result("TC-091")
        suffix = "cmd/device/unpair"
        payload = {"commandId": "UNPAIR-001"}
        result.command_topic = self.topic(suffix)
        result.command_payload = payload
        since = self.message_count()
        self.publish_json(suffix, payload)
        messages = self.wait_collect(
            lambda item: self.is_command_result("device/unpair")(item)
            or (self.is_status(item) and self.is_current_state(self.payload(item), ["RESET", "PROVISION"]))
            or self.disconnected_event.is_set(),
            count=1,
            timeout=self.args.timeout,
            since=since,
        )
        if messages or self.disconnected_event.is_set():
            return self.finish(result, "PASS", "Unpair command response, provisioning/reset status, or disconnect was observed", messages)
        return self.finish(result, "SKIP", "Unpair was confirmed but no unpair/provisioning evidence was observed")

    def message_to_report_dict(self, message: MqttMessage) -> Dict[str, Any]:
        redacted_json = redact_any(message.payload_json)
        return {
            "timestamp": message.timestamp,
            "topic": message.topic,
            "payload_raw": redact_raw_payload(message.payload_raw, message.payload_json),
            "payload_json": redacted_json,
            "retained": message.retained,
            "qos": message.qos,
        }

    def result_to_dict(self, result: TestResult) -> Dict[str, Any]:
        return {
            "test_id": result.test_id,
            "name": result.name,
            "purpose": result.purpose,
            "command_topic": result.command_topic,
            "command_payload": redact_any(result.command_payload),
            "expected_behavior": result.expected_behavior,
            "actual_behavior": result.actual_behavior,
            "status": result.status,
            "matched_messages": [self.message_to_report_dict(message) for message in result.matched_messages if message is not None],
            "notes": result.notes,
            "started_at": result.started_at,
            "ended_at": result.ended_at,
        }

    def summary(self) -> Dict[str, int]:
        counts = Counter(result.status for result in self.results)
        return {status: counts.get(status, 0) for status in ["PASS", "WARN", "FAIL", "SKIP"]}

    def observed_topics(self) -> List[str]:
        return sorted({message.topic for message in self.snapshot(0)})

    def payload_shape_summary(self) -> Dict[str, Any]:
        shapes: Dict[str, Any] = {}
        per_topic: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for message in self.snapshot(0):
            if isinstance(message.payload_json, dict):
                per_topic[message.topic].append(message.payload_json)
        for topic, payloads in per_topic.items():
            keys: Dict[str, set[str]] = defaultdict(set)
            nested: Dict[str, List[str]] = defaultdict(list)
            for payload in payloads:
                for key, value in payload.items():
                    keys[key].add(type_name(value))
                    if isinstance(value, dict):
                        nested[key].extend(str(nested_key) for nested_key in value.keys())
            shapes[topic] = {
                "messageCount": len(payloads),
                "topLevelFields": {key: sorted(types) for key, types in sorted(keys.items())},
                "nestedObjectFields": {key: sorted(set(values)) for key, values in sorted(nested.items())},
            }
        return shapes

    def conclusions_and_actions(self) -> Tuple[List[str], List[str]]:
        conclusions: List[str] = []
        actions: List[str] = []
        by_id = {result.test_id: result for result in self.results}

        if by_id["TC-001"].status == "FAIL":
            conclusions.append("MQTT broker was not reachable, so device behavior could not be evaluated.")
            actions.append("Start Mosquitto with test_files/scripts/mosquitto-resq.conf or correct --broker/--port.")
            return conclusions, actions

        if by_id["TC-002"].status == "FAIL":
            conclusions.append("Broker is reachable, but the target device did not publish status or heartbeat.")
            actions.append("Check ESP32-C3 power, Wi-Fi provisioning, MQTT host/port config, and device id.")

        for result in self.results:
            if result.test_id == "TC-032" and result.status == "FAIL":
                conclusions.append("cmd/diag/health appears implemented in the handler but unavailable through MQTT subscription.")
                actions.append("Subscribe to cmd/diag/health in firmware MQTT setup, or remove/document the unsupported handler.")
            if result.test_id in {"TC-030", "TC-031", "TC-070"} and result.status == "FAIL":
                actions.append("Verify command subscriptions and event_publisher command_result integration.")
            if result.test_id in {"TC-040", "TC-041", "TC-043", "TC-044"} and result.status == "FAIL":
                actions.append("Review calibration command handling and command_result publication paths.")
            if result.test_id in {"TC-050", "TC-052"} and result.status == "FAIL":
                actions.append("Review session readiness/profile gating for unsafe or inconsistent session acceptance.")
            if result.test_id in {"TC-060", "TC-061", "TC-062", "TC-063"} and result.status == "FAIL":
                actions.append("Review telemetry publish gating, retained flag, and metric-first/debugRaw policy.")
            if result.test_id == "TC-021" and result.status in {"FAIL", "WARN"}:
                actions.append("Align heartbeat payload with required health fields while keeping readiness/sensorHealth extensions allowed.")

        if not conclusions:
            conclusions.append("The run produced structured evidence for all MQTT test cases; see detailed results for WARN/SKIP context.")
        if not actions:
            actions.append("Address any WARN/SKIP preconditions, then rerun with --interactive for hardware-dependent coverage.")

        deduped_actions = list(dict.fromkeys(actions))
        return conclusions, deduped_actions

    def write_reports(self) -> None:
        generated_at = now_iso()
        summary = self.summary()
        observed_topics = self.observed_topics()
        payload_shapes = self.payload_shape_summary()
        conclusions, actions = self.conclusions_and_actions()

        report = {
            "generatedAt": generated_at,
            "broker": self.args.broker,
            "port": int(self.args.port),
            "device": self.args.device,
            "baseTopic": self.base_topic,
            "interactive": bool(self.args.interactive),
            "skipDestructive": bool(self.args.skip_destructive),
            "skipSession": bool(self.args.skip_session),
            "skipCalibration": bool(self.args.skip_calibration),
            "summary": summary,
            "results": [self.result_to_dict(result) for result in self.results],
            "observedTopics": observed_topics,
            "observedPayloadShapes": payload_shapes,
            "conclusions": conclusions,
            "recommendedNextActions": actions,
        }
        self.report_json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

        lines: List[str] = []
        lines.append("# ResQ MQTT Test Report")
        lines.append("")
        lines.append("## Test run metadata")
        lines.append("")
        lines.append(f"- Date/time: `{generated_at}`")
        lines.append(f"- Broker: `{self.args.broker}`")
        lines.append(f"- Port: `{int(self.args.port)}`")
        lines.append(f"- Device: `{self.args.device}`")
        lines.append(f"- Base topic: `{self.base_topic}`")
        lines.append(f"- Interactive mode: `{bool(self.args.interactive)}`")
        lines.append(f"- Destructive tests skipped: `{bool(self.args.skip_destructive)}`")
        lines.append(f"- Session tests skipped: `{bool(self.args.skip_session)}`")
        lines.append(f"- Calibration tests skipped: `{bool(self.args.skip_calibration)}`")
        lines.append("")
        lines.append("## Summary")
        lines.append("")
        lines.append("| Status | Count |")
        lines.append("|---|---:|")
        for status in ["PASS", "WARN", "FAIL", "SKIP"]:
            lines.append(f"| {status} | {summary[status]} |")
        lines.append("")
        lines.append("## Detailed results")
        lines.append("")
        lines.append("| Test | Status | Name | Command | Actual |")
        lines.append("|---|---|---|---|---|")
        for result in self.results:
            lines.append(
                "| "
                f"{result.test_id} | {result.status} | {markdown_escape(result.name)} | "
                f"{markdown_escape(result.command_topic or '')} | {markdown_escape(result.actual_behavior)} |"
            )
        lines.append("")
        lines.append("## Per-test details")
        for result in self.results:
            lines.append("")
            lines.append(f"### {result.test_id}: {result.name}")
            lines.append("")
            lines.append(f"- Status: `{result.status}`")
            lines.append(f"- Purpose: {result.purpose}")
            lines.append(f"- Expected: {result.expected_behavior}")
            if result.command_topic:
                lines.append(f"- Command topic: `{result.command_topic}`")
                lines.append(f"- Command payload: `{json.dumps(redact_any(result.command_payload), separators=(',', ':'))}`")
            lines.append(f"- Actual: {result.actual_behavior}")
            lines.append(f"- Started: `{result.started_at}`")
            lines.append(f"- Ended: `{result.ended_at}`")
            if result.notes:
                lines.append(f"- Notes: {'; '.join(markdown_escape(note) for note in result.notes)}")
            if result.matched_messages:
                lines.append("- Matched messages:")
                for message in result.matched_messages[:5]:
                    payload = redact_raw_payload(message.payload_raw, message.payload_json)
                    lines.append(
                        f"  - `{message.timestamp}` `{message.topic}` retained={message.retained} payload=`{markdown_escape(payload)}`"
                    )
                if len(result.matched_messages) > 5:
                    lines.append(f"  - ... {len(result.matched_messages) - 5} more matched messages")
        lines.append("")
        lines.append("## Observed topic list")
        lines.append("")
        if observed_topics:
            for topic in observed_topics:
                lines.append(f"- `{topic}`")
        else:
            lines.append("- No MQTT messages were observed.")
        lines.append("")
        lines.append("## Observed payload shape summary")
        lines.append("")
        if payload_shapes:
            for topic, shape in payload_shapes.items():
                fields = ", ".join(f"{key}:{'/'.join(types)}" for key, types in shape["topLevelFields"].items())
                lines.append(f"- `{topic}` ({shape['messageCount']} JSON messages): {fields}")
        else:
            lines.append("- No JSON payloads were observed.")
        lines.append("")
        lines.append("## Firmware behavior conclusions")
        lines.append("")
        for item in conclusions:
            lines.append(f"- {item}")
        lines.append("")
        lines.append("## Recommended next actions")
        lines.append("")
        for item in actions:
            lines.append(f"- {item}")
        lines.append("")
        self.report_md_path.write_text("\n".join(lines), encoding="utf-8")

    def run(self) -> int:
        self.prepare_evidence_dir()
        try:
            self.results.append(self.tc001_broker_reachable())
            if not self.broker_available:
                self.append_missing_skips("Broker connection failed; MQTT behavior tests were not run")
                return self.complete()

            self.results.append(self.tc002_device_presence())
            if not self.device_present:
                self.append_missing_skips("Device presence was not established; behavior tests were not run")
                return self.complete()

            for method in [
                self.tc003_topic_namespace,
                self.tc010_status_payload_shape,
                self.tc011_status_retained,
                self.tc020_periodic_heartbeat,
                self.tc021_heartbeat_shape,
                self.tc022_heartbeat_not_telemetry,
                self.tc030_diag_ping,
                self.tc031_diag_request,
                self.tc032_diag_health,
                self.tc040_calibration_start,
                self.tc041_calibration_capture_normal,
                self.tc042_calibration_capture_full_depth,
                self.tc043_calibration_validate,
                self.tc044_calibration_cancel,
                self.tc045_calibration_during_session,
                self.tc050_session_start,
                self.tc051_session_stop,
                self.tc052_profile_mismatch,
                self.tc060_telemetry_idle_policy,
                self.tc061_metric_first_telemetry,
                self.tc062_debug_raw_policy,
                self.tc063_telemetry_non_retained,
                self.tc070_command_result_event,
                self.tc071_calibration_report_shape,
                self.tc072_compression_feedback_event,
                self.tc080_config_debug_update,
                self.tc090_device_reset,
                self.tc091_device_unpair,
            ]:
                self.results.append(method())
        finally:
            self.disconnect()
        return self.complete()

    def complete(self) -> int:
        self.write_reports()
        summary = self.summary()
        print(f"Wrote Markdown report: {self.report_md_path}")
        print(f"Wrote JSON report: {self.report_json_path}")
        print(f"Wrote MQTT message log: {self.messages_jsonl_path}")
        print(f"Summary: PASS={summary['PASS']} WARN={summary['WARN']} FAIL={summary['FAIL']} SKIP={summary['SKIP']}")
        return 1 if summary["FAIL"] else 0


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ResQ firmware MQTT/functional tests.")
    parser.add_argument("--broker", default="localhost", help="MQTT broker hostname or IP (default: localhost)")
    parser.add_argument("--port", default=1883, type=int, help="MQTT broker port (default: 1883)")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help=f"ResQ device id (default: {DEFAULT_DEVICE})")
    parser.add_argument("--timeout", default=10.0, type=float, help="Per-test MQTT wait timeout in seconds (default: 10)")
    parser.add_argument("--evidence-dir", default=DEFAULT_EVIDENCE_DIR, help=f"Evidence output directory (default: {DEFAULT_EVIDENCE_DIR})")
    parser.add_argument("--interactive", action="store_true", help="Enable hardware/user-assisted tests")
    parser.add_argument(
        "--skip-destructive",
        default=True,
        action=boolean_optional_action(),
        help="Skip destructive reset/unpair tests (default: true; use --no-skip-destructive with --interactive to run)",
    )
    parser.add_argument(
        "--skip-session",
        default=False,
        action=boolean_optional_action(),
        help="Skip session command tests (default: false)",
    )
    parser.add_argument(
        "--skip-calibration",
        default=False,
        action=boolean_optional_action(),
        help="Skip calibration command tests (default: false)",
    )
    parser.add_argument("--debug", action="store_true", help="Also subscribe to resq/manikins/<device_id>/#")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    tester = ResQMqttTester(args)
    try:
        return tester.run()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
