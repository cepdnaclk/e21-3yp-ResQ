from __future__ import annotations

from resq_deploy_test.evidence import EvidenceStore, command_reply, is_json_message


def test_json_evidence_and_command_reply_matching() -> None:
    store = EvidenceStore()
    status = store.add("resq/dev/status", '{"device_id":"dev","state":"PAIRED_IDLE"}')
    reply = store.add("resq/dev/events", '{"reply_id":"abc","status":"NACK"}')
    assert is_json_message(status, "/status", {"device_id", "state"})
    assert command_reply("abc", {"NACK"})(reply)
    assert store.wait_for(command_reply("abc"), 0.01) == reply


def test_invalid_json_is_preserved_as_text() -> None:
    message = EvidenceStore().add("resq/dev/events", "{broken")
    assert message.payload == "{broken"
