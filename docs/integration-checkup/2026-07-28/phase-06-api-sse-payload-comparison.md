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

## Controlled measurements

Measurements used one simulated `M01`, an active session for live endpoints, and
the completed session for summary/detail endpoints. Byte counts are compact UTF-8
response bodies. Field counts are top-level fields (or fields in the first array
item). Every ordinary response was HTTP 200 and contained no `debugRaw`,
`rawPayload`, or serialized `payloadJson`.

Only two exact Phase 3 byte baselines exist: health (277 bytes) and the then-idle
one-device live list (1,138 bytes). A populated Phase 6 active-session response is
not semantically comparable to an idle Phase 3 response, so the table does not
present that difference as a reduction. Missing baselines are reported as `n/a`
rather than reconstructed.

| Endpoint/event | Before bytes | After bytes | Reduction | Removed fields | Replacement |
| --- | ---: | ---: | ---: | --- | --- |
| `GET /api/hub/health` | 277 | 277 | 0 (0%) | None | Nine typed health fields |
| `GET /api/manikins/live` | 1,138 (Phase 3 idle) | 1,736 (Phase 6 active) | n/a: different state | `debugRaw`, raw metric payload | 52-field bounded live summary |
| `GET /api/manikins/live/{deviceId}` | n/a | 1,734 | n/a | `debugRaw`, raw metric payload | 52-field bounded live summary |
| `GET /api/sessions` | 2 (Phase 3 empty) | 886 (one completed session) | n/a: empty vs populated | Transport/raw fields | 11-field session summary |
| `GET /api/sessions/{sessionId}` | n/a | 884 | n/a | Transport/raw fields | 11-field session detail |
| `GET /api/sessions/live/{sessionId}` | n/a | 1,320 | n/a | `debugRaw`, `rawPayload` | 36-field bounded active view |
| Initial manikin SSE | n/a | 1,759 | n/a | `debugRaw`, raw metric payload | Bounded live snapshot |
| Manikin SSE update | n/a | 1,763 | n/a | Unchanged duplicate events | Meaningful bounded update |
| Session SSE update | n/a | 1,344 | n/a | `debugRaw`, `rawPayload`, duplicates | Canonical meaningful update |
| Protected diagnostics | n/a | 23,001 | n/a | Serialized `payloadJson` fields | Seven bounded typed sections with capped histories |

The two sampled manikin SSE events averaged 1,761 bytes. The initial and updated
session events were 1,310 and 1,344 bytes, averaging 1,327 bytes. The explicit
unchanged-update test observed zero duplicate SSE emissions, and reconnect tests
observed exactly one initial snapshot per connection with failed emitters removed.

The diagnostics request returned HTTP 200 for Admin/Instructor and HTTP 403 for a
Trainee. Its larger size is intentional bounded diagnostic history (20 commands,
50 events, and 20 debug snapshots maximum), not an arbitrary/raw transport map.
