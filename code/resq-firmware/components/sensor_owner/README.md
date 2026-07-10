# Sensor Owner

`sensor_owner` is a small runtime arbitration primitive for hardware acquisition
lifecycles.

Owners:

- `SENSOR_OWNER_MANUAL_STREAM`
- `SENSOR_OWNER_CALIBRATION`
- `SENSOR_OWNER_SESSION`

The component stores a mutex-protected enum. Acquisition succeeds only when the
current owner is `SENSOR_OWNER_NONE`; failed acquisition does not overwrite the
owner. Release is owner-only and repeated release is safe.

The owner represents lifecycle exclusivity. It does not hold a mutex while HX710
or Hall sensors are being read, nor while telemetry/debug JSON is built or
published.
