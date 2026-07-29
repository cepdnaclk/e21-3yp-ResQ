# Phase 5 payload diff

Topic device identity remains authoritative and is not repeated in outgoing payloads. `ts_ms` remains firmware monotonic time; LocalHub continues to assign wall-clock `receivedAt`.

| Topic | Before fields | After fields | Compatibility fields retained | Removed fields | New source of removed data |
| ----- | ------------- | ------------ | ----------------------------- | -------------- | -------------------------- |
| `resq/{id}/status` | `state`, `session_active`, `session_id`, `calibrated`, `last_error_id`, `ip`, `ts_ms` | `state`, `session_active`, conditional `session_id`, `calibrated`, `last_error_id`, `boot_id`, `state_seq`, `ts_ms` | neutral `last_error_id` while LocalHub expects it | `ip`, empty `session_id`, device identity and diagnostics | heartbeat for liveness; debug for requested diagnostics |
| `resq/{id}/heartbeat` | state plus Wi-Fi/MQTT/backend flags, session fields, calibration, `uptime_ms`, `ts_ms` | `state`, `session_active`, `sensor_running`, `calibrated`, `uptime_ms`, `ts_ms` | `uptime_ms` temporarily mirrors canonical `ts_ms` | Wi-Fi/MQTT/backend detail, identity, session ID, counters, diagnostics | status for state; debug for diagnostics |
| `resq/{id}/telemetry` session | session/state, progress, booleans, rate, four counters, pause, hand, old pressure field, flags, timestamp | `session_id`, `state=SESSION_ACTIVE`, `depth_mm`, `depth_progress`, `depth_ok`, `rate_cpm`, four counters, `recoil_ok`, `pause_s`, hand, both pressure fields, derived flags, `ts_ms` | `state` and `pressure_balance_pct` remain for current LocalHub | raw acquisition, validity internals, calibration, network and firmware detail | explicit debug, SENSOR_STREAM, and calibration topics |
| `resq/{id}/telemetry` SENSOR_STREAM | converted sensor diagnostic fields plus repeated identity | `telemetry_mode=SENSOR_STREAM`, state, requested raw and converted channels with validity, saturation mask, interval, timestamp | current converted names and snake_case aliases | device identity, session metrics, acquisition/stability/profile internals | direct debug for one-shot raw snapshot |
| `resq/{id}/debug` | request-dependent raw snapshot with inconsistent correlation/identity | `reply_id`, `source=DIRECT_SENSOR_SNAPSHOT`, four raw readings, `ts_ms` | raw field names | duplicated device identity and periodic/idle debug | none; this is the explicit diagnostic source |
| `resq/{id}/events/calibration` | command/progress/final events | bounded command/progress/final events under calibration topic | current event/progress/reason/action IDs | repetition through normal telemetry | calibration topic only |
| `resq/{id}/events*` command result | some helpers could omit `reply_id` | every executed MQTT command result carries the original ID as `reply_id` | legacy incoming `command_id` accepted temporarily | generated/empty reply identifiers; local buttons posing as commands | local actions use a separate `source=LOCAL_BUTTON` event |

## Normalized metric invariants

- `flags` is produced only by `cpr_metrics_derive_flags()`.
- `depth_ok=false` cannot emit `DEPTH_OK`.
- `recoil_ok=false` cannot emit `RECOIL_OK`.
- pause and hand flags derive from the same normalized snapshot.
- `pressure_balance_score_pct` and deprecated `pressure_balance_pct` are identical and clamped to `0..100`.
- the center threshold is named once as `CPR_PRESSURE_CENTER_SCORE_THRESHOLD_PCT=88.0`.

## Compatibility exception

The locked candidate proposed `telemetry_mode=SESSION_ACTIVE`, but current LocalHub production accepts `telemetry_mode` only for `SENSOR_STREAM`. Phase 5 therefore retains `state=SESSION_ACTIVE` and omits session `telemetry_mode`. Migrating that discriminator and removing `state` is Phase 6 work.
