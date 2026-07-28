# Phase 5 command correlation matrix

All result payloads for executed MQTT commands contain `reply_id` equal to the incoming `request_id`. The temporary incoming `command_id` alias is normalized to the same reply ID.

| Command | Allowed states | ACK/NACK topic | reply_id | Duplicate behaviour | Test |
| ------- | -------------- | -------------- | -------- | ------------------- | ---- |
| `cmd/debug` | paired/ready, active session, calibration-fail, error when sensors can be acquired | `events`; snapshot on `debug` | required | replays cached ACK/result; does not reacquire sensors | simulator duplicate matrix; debug one-shot test |
| `cmd/telemetry` START | paired/ready with no session/calibration owner; interval 100–1000 ms | `events` | required | replays prior ACK/NACK; stream starts once | telemetry firmware tests; simulator duplicate matrix |
| `cmd/telemetry` STOP | any handled state; safe when already stopped | `events` | required | replays result; stop side effect runs once | telemetry firmware tests; simulator duplicate matrix |
| `cmd/calibration/start` | paired/ready or calibration-fail retry; not active session/error | `events/calibration` | required | replays start result; no second calibration transition/timer set | cache tests; simulator duplicate matrix |
| `cmd/calibration/cancel` | calibrating or calibration-fail | `events/calibration` | required | replays cancel result; cleanup/transition runs once | cache tests; simulator duplicate matrix |
| `cmd/session/start` | calibrated and ready with matching profile/connectivity | `events` | required | replays start result; counters/sensors/session transition run once | firmware cache tests; simulator duplicate matrix |
| `cmd/session/stop` | active session with matching session ID when supplied | `events` | required | replays stop summary/result; stop transition runs once | firmware cache tests; simulator duplicate matrix |
| `cmd/system/retry` | error/recovery handler | `events/error` | required | replays result; recovery transition runs once | simulator duplicate matrix; handler abstraction |
| `cmd/system/reset` | error/recovery handler | `events/error` | required | cached ACK prevents a second handler execution | simulator duplicate matrix; production build only (no real reset in test) |
| `cmd/system/flush-config` | error/recovery handler | `events/error` | required | cached ACK prevents a second destructive handler execution | simulator duplicate matrix; production build only |
| unknown `cmd/#` | none | state-appropriate `events*` NACK | required | NACK is cached/replayed | state-manager unknown-command paths |

## Cache rules

| Property | Production firmware | Simulator |
| --- | --- | --- |
| Key | full command topic + request ID | command suffix + request ID |
| Bound | 8 entries | 32 entries |
| Completed lifetime | 5 minutes | 5 minutes |
| Pending lifetime | 2 minutes, then recoverable | synchronous pending window |
| Duplicate pending | suppress | suppress |
| Duplicate complete | replay stored suffix and payload | replay captured correlated publication(s) |
| Same ID, different command | safely distinguished by command identity | safely distinguished by command identity |
| Boot/reset rule | volatile history clears at boot | history clears with process |

## Missing identifier behavior

Production firmware rejects an absent, malformed, empty, or overlong identifier before queueing, so no state transition occurs. It cannot send a truly correlated NACK when no correlation value exists; the rejection is logged. The simulator emits a stable `REQUEST_ID_REQUIRED` NACK with an empty `reply_id` to make protocol errors observable, and likewise performs no command handler execution.

## Coverage

- Correlated result paths: 9/9 supported command topics.
- Duplicate no-transition simulator cases: session start/stop, calibration start/cancel, sensor-stream start/stop, debug, retry, reset, and flush-config.
- Firmware cache tests cover pending suppression, complete response retrieval, full-cache behavior, lock failure, topic scoping, and missing-ID rejection.
