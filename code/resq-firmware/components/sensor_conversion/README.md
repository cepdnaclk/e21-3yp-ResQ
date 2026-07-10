# Sensor conversion

`sensor_conversion` is the pure, reusable conversion component for ResQ raw
sensor samples. It performs no hardware reads, NVS access, MQTT publishing,
allocation, RTOS task creation, queueing, locking, or runtime-state inspection.
Later runtime, telemetry, calibration, and debug code should feed it explicit
raw samples plus an explicit conversion profile.

## Formulas

There are three pressure channels:

```text
pressure_kpa = abs(pressure_raw - pressure_baseline_raw) * pressure_kpa_per_count
```

Hall displacement is converted as:

```text
hall_delta_raw = (hall_raw - hall_baseline_raw) * hall_direction
hall_progress = clamp(hall_delta_raw / hall_range_raw, 0.0, 1.0)
hall_mm = hall_progress * full_depth_mm
```

`full_depth_mm` comes from the supplied profile. The project default may be
50.0 mm, but the conversion function does not hardcode it.

## Validity

`SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT` is `3`.

`required_pressure_mask` selects the pressure channels required for aggregate
pressure validity. Bits outside `0x07` are ignored. A zero mask is normalized to
the default `0x07`, meaning all three pressure channels are required.

A pressure channel profile is usable when its baseline is marked valid, its
coefficient is finite, and its coefficient is greater than zero. Overall
`pressure_profile_valid` means every required channel has a usable profile.

A converted pressure channel is valid when the raw read is valid, the channel
profile is usable, that channel saturation bit is clear, and the calculated kPa
is finite. One invalid channel does not invalidate other channel outputs.
Per-channel validity is reported in `pressure_kpa_channel_valid[]`.
`pressure_kpa_valid` and `sample_pressure_kpa_valid` are true only when all
channels selected by the normalized required mask are currently valid.

`pressure_saturation_mask` is copied from the raw sample after masking to the
three supported pressure bits. A set bit invalidates only that channel.

A Hall profile is usable when the Hall baseline is marked valid,
`hall_range_raw` is a positive magnitude, `hall_direction` is exactly `+1` or
`-1`, and `full_depth_mm` is finite and greater than zero. Signed persisted
range values should be normalized by the caller before building the profile.

A Hall sample is valid when the raw read is valid, the Hall profile is usable,
the delta is representable as `int32_t`, and progress and millimetres are
finite. Invalid numeric outputs are always `0` or `0.0f`, never NaN or infinity.
