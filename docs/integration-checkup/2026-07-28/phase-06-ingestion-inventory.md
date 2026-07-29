# Phase 6 MQTT ingestion inventory

## Scope and checkpoint

This inventory was taken from `integration/firmware-localhub-traffic-scaling` at Phase 5
HEAD `ba976ece05421cde9b9a0261e71dc4c59f24d9ec`. The existing Graphify graph was
used only to locate candidate paths; the statements below were verified against
the current Java and TypeScript source.

## Current callback flow

| Step | Current owner | Phase 5 starting behaviour |
| --- | --- | --- |
| MQTT callback | `MqttSubscriberService.messageArrived` | Passes topic and bytes to `handleMessage`. |
| Topic parsing | `MqttSubscriberService.parseTopic` | Accepts canonical and legacy namespaces and returns a device ID plus string message type. |
| JSON parsing | `MqttSubscriberService.parsePayload` | Parses a `JsonNode`; also accepts a limited non-strict JSON form. |
| Persistence | `persistCanonicalMessage` | Persists canonical traffic before family-specific identity, ordering, schema, or session validation. |
| Registry mutation | family switch in `handleMessage` | Mutates readiness/registry after persistence; validation depth varies by branch. |
| Session aggregation | telemetry/event branches | Validates some telemetry binding, then records metrics or applies event side effects. |
| SSE/API publication | `LiveStreamService` and controllers | Publishes registry/session objects after mutation. |

Starting order:

```text
MQTT callback
→ topic parsing
→ JSON parsing
→ canonical persistence
→ family-specific validation and registry mutation
→ session aggregation
→ SSE/API publication
```

## Pre-validation effects found

| Branch | Effect before complete validation | Risk |
| --- | --- | --- |
| Every canonical topic | `persistCanonicalMessage` runs before the family switch. | Identity mismatches, stale packets, and invalid telemetry can be durably recorded. |
| Canonical telemetry | Generic firmware-event persistence occurs before telemetry normalization and session binding. | Rejected high-rate telemetry remains in the normal firmware event store. |
| Sensor stream | Registry and diagnostic snapshot mutate without uniform payload identity validation. | A conflicting payload identity is not rejected consistently. |
| Debug | Registry and ordinary instructor/session publication occur without uniform identity validation. | Diagnostic data can leak into normal live surfaces. |
| Calibration event | Generic persistence precedes readiness ordering; a second calibration evidence persistence path runs later. | Rejected ordering can leave a durable generic record. |
| Error/general event | Generic persistence precedes ordering and event-side-effect validation. | A stale or conflicting event can remain stored even when domain mutation is blocked. |

## Canonical ingestion boundary introduced in Phase 6A

`CanonicalMqttIngestion` now produces an immutable `MqttIngestionEnvelope` with:

```text
canonicalDeviceId
topicFamily
canonicalTopic
legacyTopicUsed
telemetryMode
firmwareTimestampMs
backendReceivedAt
bootId
stateSequence
sessionId
normalizedPayload
validationResult
```

The boundary strictly characterizes the accepted topic shapes, converts legacy and
canonical namespaces to the same canonical topic, preserves `ts_ms` as firmware
monotonic metadata, stamps backend receipt time from an injectable clock, and
classifies status, heartbeat, telemetry, debug, general event, calibration event,
and error event traffic.

Phase 6A intentionally does not switch production behaviour to the new validation
order. Phase 6B and Phase 6C will use the envelope to enforce identity, ordering,
classification, binding, and validation before persistence or mutation.

## Characterization coverage

`CanonicalMqttIngestionTest` covers canonical and legacy topics, all topic families,
optional payload identity, firmware and backend timestamps, boot/sequence fields,
session and sensor-stream classification, calibration/error classification, and
malformed topic/JSON rejection.
