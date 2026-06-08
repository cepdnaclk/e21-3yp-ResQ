from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class Message:
    topic: str
    payload: dict[str, Any] | str
    received_at: float


class EvidenceStore:
    def __init__(self, mqtt_log: Path | None = None):
        self.messages: list[Message] = []
        self.mqtt_log = mqtt_log
        self._condition = threading.Condition()

    def add(self, topic: str, raw_payload: bytes | str) -> Message:
        text = raw_payload.decode("utf-8", errors="replace") if isinstance(raw_payload, bytes) else raw_payload
        try:
            payload: dict[str, Any] | str = json.loads(text)
        except json.JSONDecodeError:
            payload = text
        message = Message(topic, payload, time.time())
        with self._condition:
            self.messages.append(message)
            self._condition.notify_all()
        if self.mqtt_log:
            self.mqtt_log.parent.mkdir(parents=True, exist_ok=True)
            with self.mqtt_log.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"topic": topic, "payload": payload, "received_at": message.received_at}) + "\n")
        return message

    def wait_for(self, predicate: Callable[[Message], bool], timeout: float, *, after: float = 0) -> Message | None:
        deadline = time.monotonic() + timeout
        with self._condition:
            while True:
                for message in self.messages:
                    if message.received_at >= after and predicate(message):
                        return message
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(remaining)


def is_json_message(message: Message, suffix: str, required_fields: set[str]) -> bool:
    return (
        message.topic.endswith(suffix)
        and isinstance(message.payload, dict)
        and required_fields.issubset(message.payload)
    )


def command_reply(reply_id: str, statuses: set[str] | None = None) -> Callable[[Message], bool]:
    statuses = statuses or {"ACK", "NACK"}

    def matches(message: Message) -> bool:
        return (
            isinstance(message.payload, dict)
            and message.payload.get("reply_id") == reply_id
            and message.payload.get("status") in statuses
        )

    return matches
