# Telemetry Publisher

This component owns two telemetry paths:

- active CPR session telemetry from `cpr_metrics_snapshot_t`
- manual diagnostics streaming from `cmd/telemetry`

Manual diagnostics streaming publishes payloads with
`"telemetry_mode":"SENSOR_STREAM"` on the normal telemetry topic. It is not
session telemetry and must not include session scoring fields.

`SENSOR_STREAM` carries both raw and converted sensor fields. Raw fields
(`pressure_0_raw`, `pressure_1_raw`, `pressure_2_raw`, and `hall_raw`) reflect
the direct hardware acquisition for the interval, with independent
`*_raw_valid` flags. Converted fields (`*_kpa`, `hall_mm`, and
`hall_progress`) remain gated by calibration/profile validity. Before
calibration, valid raw readings are still published, but converted kPa/mm values
are emitted as `0.000` with validity flags false and
`pressure_profile_valid`/`hall_profile_valid` false. Saturation invalidates only
the affected converted pressure channel; the raw value and raw validity remain
visible.

Manual stream task startup acquires `SENSOR_OWNER_MANUAL_STREAM` through the
`sensor_owner` component. Manual STOP only stops this manual stream task; it does
not stop CPR metrics, CPR session acquisition, active session telemetry,
heartbeat, or status publishing.

The stream uses one `hx710_read_3_shared_sck_valid` transaction and one Hall
read per interval, then calls `sensor_conversion_convert` once. Pressure
acquisition is attempted in `CALIBRATION_PRESSURE_REQUIRED` and
`CALIBRATION_PRESSURE_OPTIONAL` modes even when pressure calibration is not yet
valid. `CALIBRATION_HALL_ONLY` and
`CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE` keep their Hall-only manual stream
semantics.
