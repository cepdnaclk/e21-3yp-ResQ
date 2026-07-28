# Phase 6 API and SSE payload comparison

## Boundary changes

Normal manikin and session live models now expose only typed operational fields.
`LiveMetricPayload` no longer contains `debugRaw`, and the shared desktop type no
longer contains `debugRaw` or `rawPayload`. Firmware payload JSON remains private
to persistence and is excluded from JSON serialization even on the protected
firmware diagnostics bundle.

The existing diagnostics boundary is:

```text
GET /api/devices/{deviceId}/firmware/diagnostics
```

It requires the Instructor role; Admin is allowed by the existing role hierarchy,
while Trainee is rejected. Diagnostic history endpoints have hard maximum limits,
and their typed records no longer serialize full request, reply, event,
calibration, or debug payload JSON.

Normal SSE sends one initial snapshot to each new connection, removes failed
emitters, and now suppresses unchanged instructor/session update objects before
serialization.

## Measurements

Final controlled measurements are recorded in Phase 6G. “Before” is the
representative Phase 3/Phase 5 fixture shape containing transport/raw fields;
“After” is the Phase 6 bounded DTO shape.

| Endpoint/event | Before bytes | After bytes | Reduction | Removed fields | Replacement |
| --- | ---: | ---: | ---: | --- | --- |
| `GET /api/hub/health` | Pending 6G | Pending 6G | Pending | None expected | Typed health fields |
| `GET /api/manikins/live` | Pending 6G | Pending 6G | Pending | `debugRaw`, raw metric payload | Canonical live summary |
| `GET /api/manikins/live/{deviceId}` | Pending 6G | Pending 6G | Pending | `debugRaw`, raw metric payload | Canonical live summary |
| `GET /api/sessions` | Pending 6G | Pending 6G | Pending | Transport/raw fields | Session summaries |
| `GET /api/sessions/{sessionId}` | Pending 6G | Pending 6G | Pending | Transport/raw fields | Session detail |
| `GET /api/sessions/live/{sessionId}` | Pending 6G | Pending 6G | Pending | `debugRaw`, `rawPayload` | Canonical metric |
| Initial manikin SSE | Pending 6G | Pending 6G | Pending | `debugRaw`, raw metric payload | Bounded live snapshot |
| Manikin SSE update | Pending 6G | Pending 6G | Pending | Unchanged duplicate events | Meaningful update only |
| Session SSE update | Pending 6G | Pending 6G | Pending | `debugRaw`, `rawPayload`, duplicates | Canonical meaningful update |
| Protected diagnostics | Pending 6G | Pending 6G | Pending | Serialized `payloadJson` fields | Typed bounded diagnostics |
