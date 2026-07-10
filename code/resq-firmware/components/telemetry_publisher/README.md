# Telemetry Publisher

This component owns two telemetry paths:

- active CPR session telemetry from `cpr_metrics_snapshot_t`
- manual diagnostics streaming from `cmd/telemetry`

Manual diagnostics streaming publishes payloads with
`"telemetry_mode":"SENSOR_STREAM"` on the normal telemetry topic. It is not
session telemetry and must not include session scoring fields.

Manual stream task startup acquires `SENSOR_OWNER_MANUAL_STREAM` through the
`sensor_owner` component. Manual STOP only stops this manual stream task; it does
not stop CPR metrics, CPR session acquisition, active session telemetry,
heartbeat, or status publishing.

The stream uses one `hx710_read_3_shared_sck` transaction and one Hall read per
interval, then calls `sensor_conversion_convert` once. The current HX710 API has
aggregate read success only, so per-channel read validity is conservative while
per-channel saturation validity remains independent.
