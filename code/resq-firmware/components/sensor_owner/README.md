# Sensor Owner

`sensor_owner` is a small runtime arbitration primitive for hardware acquisition
lifecycles.

Owners:

- `SENSOR_OWNER_MANUAL_STREAM`
- `SENSOR_OWNER_CALIBRATION`
- `SENSOR_OWNER_SESSION`

The component stores a mutex-protected enum. Acquisition succeeds only when the
current owner is `SENSOR_OWNER_NONE`; failed acquisition does not overwrite the
owner. Release is owner-only; wrong-owner and repeated release return
`ESP_ERR_INVALID_STATE`. Owner reads return an `esp_err_t`, so lock contention
can never be mistaken for a free owner. Initialization is idempotent and does
not clear an active owner; tests use the explicit reset helper.

The owner represents lifecycle exclusivity. It does not hold a mutex while HX710
or Hall sensors are being read, nor while telemetry/debug JSON is built or
published.
