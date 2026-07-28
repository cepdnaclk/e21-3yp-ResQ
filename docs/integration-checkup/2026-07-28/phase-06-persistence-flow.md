# Phase 6 validated persistence flow

The Phase 5 starting path persisted every canonical message before family-specific
validation. Phase 6 now establishes this order:

```text
receive
→ strict topic and JSON parsing
→ canonical envelope
→ topic-authoritative identity validation
→ state ordering validation where applicable
→ telemetry classification
→ session schema and binding validation
→ approved persistence
→ registry/session mutation
→ live publication
```

| Topic family | Validation before persistence | Destination | Full payload stored? | Retention | Rejection behaviour |
| --- | --- | --- | --- | --- | --- |
| Status | Topic, JSON object, identity, boot/sequence, readiness disposition | Firmware event repository | Yes, pending Phase 6E diagnostics minimization | Existing local firmware-event policy | No persistence, registry mutation, session reconciliation, or SSE |
| Heartbeat | Topic, JSON object, identity, boot/sequence, readiness disposition | Firmware event repository | Yes, pending Phase 6E diagnostics minimization | Existing local firmware-event policy | No persistence or liveness/domain effect |
| Session telemetry | Topic, JSON object, identity, `SESSION_ACTIVE` discriminator, explicit session ID, metric schema/ranges, active session/device binding, telemetry sequence | Approved firmware event plus session runtime checkpoint | Normalized metric object only; original MQTT object is not passed to persistence | Existing runtime checkpoint policy | No persistence, scoring, counters, registry metric, or SSE |
| Sensor stream | Topic, JSON object, identity, `SENSOR_STREAM` discriminator, typed sensor snapshot parsing | Dedicated latest sensor snapshot | Typed known fields | Latest/bounded service snapshot | No session persistence, aggregation, timeline, summary, or session SSE |
| Debug | Topic, JSON object, identity | Firmware debug snapshot | Raw JSON remains in protected diagnostics storage pending Phase 6E | Existing bounded query surface | No session aggregation or session SSE |
| General event | Topic, JSON object, identity, boot/sequence, readiness disposition | Firmware event repository | Yes for critical command/session evidence | Existing local firmware-event policy | No durable event, side effect, registry mutation, or SSE |
| Calibration event | Topic, JSON object, identity, boot/sequence, typed calibration/readiness disposition | Firmware/calibration evidence repositories | Calibration evidence retains the existing raw evidence field pending Phase 6E | Existing calibration evidence policy | No durable result/evidence, readiness mutation, or session SSE |
| Error event | Topic, JSON object, identity, boot/sequence, readiness disposition | Firmware event repository | Yes for bounded error investigation pending Phase 6E | Existing local firmware-event policy | No durable event, registry mutation, or SSE |

Rejected high-rate telemetry is not written to the normal firmware event or session
stores. Rejection diagnostics are in-memory bounded reason counters and
rate-limited structured logs containing device ID and reason only, never the full
packet.
