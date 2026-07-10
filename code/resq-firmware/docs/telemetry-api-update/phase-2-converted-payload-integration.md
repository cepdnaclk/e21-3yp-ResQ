# Phase 2 converted payload integration

Phase 2 propagates the Phase 1 `sensor_conversion` output into existing
firmware snapshots and MQTT payloads without changing topics, cadence, session
state behavior, scoring, or sampling intervals.

## Flow

Raw sensor acquisition stays owned by the existing runtime paths:

- session sensor task reads HX710 pressure channels and Hall once per sample
- calibration manager records its current calibration sample once
- idle debug performs one controlled direct pressure transaction and one Hall read

Each owning path builds a `sensor_raw_sample_t`, builds a
`sensor_conversion_profile_t` from the current calibration profile, calls
`sensor_conversion_convert(...)` once, and stores or serializes the converted
values. Conversion formulas remain only in `components/sensor_conversion`.

## Acquisition validity

The HX710 shared-SCK API currently waits until all three DOUT pins are ready and
then clocks all channels in one synchronized transaction:

```c
esp_err_t hx710_read_3_shared_sck(..., int32_t *out0, int32_t *out1, int32_t *out2);
```

That API returns one aggregate `esp_err_t`, so it cannot tell callers that only
one channel timed out while the others were usable. Phase 2 therefore keeps the
conservative aggregate read-valid mapping for HX710 read failures. The exact
future driver change needed for independent read validity is a result-returning
shared-SCK API that reports `raw[3]`, `read_valid[3]`, and the same transaction's
failure reason without issuing extra reads.

Saturation is separate from read failure. Saturation bits are derived per channel
and passed to the converter; a saturated channel invalidates only its converted
kPa value.

## Session Telemetry

Active-session telemetry on `resq/{device_id}/telemetry` preserves existing
fields and adds/continues the converted fields:

- `depth_mm`
- `depth_source: "HALL"`
- `pressure_0_kpa`, `pressure_0_kpa_valid`
- `pressure_1_kpa`, `pressure_1_kpa_valid`
- `pressure_2_kpa`, `pressure_2_kpa_valid`
- `pressure_kpa_valid`
- `hall_mm_valid`
- `pressure_saturation_mask`
- `pressure_balance_reliable`

Invalid numeric values are serialized as `0.0`, never NaN or infinity.
`pressure_kpa_valid` is current aggregate pressure sample validity.
`hall_mm_valid` is current Hall sample validity.

## Calibration 4001

Calibration progress events remain on `resq/{device_id}/events/calibration`
with `event_id = 4001`. Existing fields are preserved and converted fields are
included:

- profile availability: `pressure_kpa_valid`, `hall_mm_valid`
- current sample validity: `sample_pressure_kpa_valid`, `sample_hall_mm_valid`
- per-channel current sample values and validity
- `hall_mm`, `hall_progress`
- `full_depth_mm`

`pressure_valid` and `hall_valid` remain the raw calibration-path validity
fields. Profile validity is intentionally separate from current sample validity.

## Calibration 4002

Calibration result events keep `event_id = 4002` and include evidence fields for
accepted calibration profiles:

- `full_depth_mm`
- `hall_baseline_raw`
- `hall_range_raw`
- `hall_full_press_raw`
- `hall_full_press_mm`
- `pressure_0_baseline_raw`
- `pressure_1_baseline_raw`
- `pressure_2_baseline_raw`
- `pressure_0_kpa_per_count`
- `pressure_1_kpa_per_count`
- `pressure_2_kpa_per_count`
- `pressure_kpa_valid`
- `hall_mm_valid`

For failed or cancelled results, available evidence is serialized safely, but
profile validity is not claimed as true unless the result is accepted.

## Debug

Idle/non-session debug uses source `DIRECT_SENSOR_SNAPSHOT`. It performs the
existing direct read once, converts once, and serializes raw and converted
fields.

Active-session debug uses source `SESSION_METRICS`. It copies the latest
`cpr_metrics_snapshot_t` and serializes that snapshot. It does not call HX710 or
Hall read functions and does not acquire sensor-driver locks for a new sample.

## Pressure Balance Reliability

The current hand-placement/balance algorithm uses raw pressure channels 1 and 2.
Its formula is unchanged. `pressure_balance_reliable` is true only when the
current pressure read succeeded, channels 1 and 2 are not saturated, and the
calibration mode has not degraded to Hall-only pressure behavior.

## Backward Compatibility

Existing MQTT topics, event IDs, reply IDs, state names, telemetry cadence, QoS,
retention behavior, session lifecycle behavior, and legacy fields are preserved.
No manual telemetry command handling or `SENSOR_STREAM` behavior was added in
this phase.

## Known Limitations

Independent per-channel HX710 read failure cannot be represented until the
shared-SCK driver returns per-channel readiness/read status from the same
transaction. Until then, a shared-SCK timeout marks all pressure channels read
invalid for that sample, while saturation remains independently propagated.
