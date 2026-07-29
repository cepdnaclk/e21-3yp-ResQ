# Phase 7 Session Pressure Watchdog Recovery

Date: 2026-07-29

Device: ESP32-C3 QFN32 revision 0.4, MAC `<redacted-device-mac>`

Port: COM4

Firmware branch at start: `integration/firmware-localhub-traffic-scaling`

Starting HEAD: `c7cc8c8`

## Root cause

`session_pressure_task` ran at priority 6 and was created without explicit
affinity. This ESP32-C3 build is unicore, so the task ran on CPU0.

The HX710 ready-wait path called `vTaskDelay(pdMS_TO_TICKS(1))`. With
`CONFIG_FREERTOS_HZ=100`, that conversion is zero ticks. It therefore did not
block the priority-6 task. The outer session-pressure acquisition loop also had
no blocking wait after successful, timeout, invalid-response, or ownership
contention outcomes. A ready priority-6 task consequently prevented CPU0's
priority-0 idle task from running, and the task watchdog reported
`session_pressur` every five seconds.

## Correction

- Pressure sampling interval: 20 ms.
- Scheduler interval: 2 ticks at 100 Hz, clamped to at least 1 tick.
- Every acquisition result reaches `session_pressure_cycle_block_ticks()`.
- Overdue schedules discard missed periods and schedule from the current tick,
  preventing unlimited catch-up execution.
- `ulTaskNotifyTake(pdTRUE, block_ticks)` performs the real blocking wait.
- A session-stop notification interrupts that wait promptly.
- The stop bit is checked before every subsequent sensor read.
- Existing task-handle and sensor-owner cleanup remains authoritative.

No watchdog configuration, idle-task monitoring, HX710 validation, calibration
threshold, or CPR threshold was weakened.

## Follow-on session-start stack fault

The first corrected physical session exposed a separate pre-existing
session-start fault after the watchdog starvation was removed. The main task
had a 3,584-byte stack and synchronously read committed calibration metadata
from NVS while publishing retained `SESSION_ACTIVE` status. The decoded
backtrace passed through `config_store_get_snapshot()`,
`load_calibration_locked()`, `nvs_get_blob()`, and `esp_flash_read()`. The
hardware stack guard recorded the stack pointer 28 bytes below its lower bound.

The production main-task stack was set to 6,144 bytes. Unity already uses an
8,192-byte main-task stack. No flash-size setting was changed.

## Deterministic tests

The existing session-pressure Unity test now verifies:

- the pressure interval converts to a non-zero tick count;
- success, timeout, invalid-response, and owner-contention outcomes all produce
  a positive blocking interval;
- an overdue schedule discards missed slots and blocks for one full interval;
- a stop request prevents another pressure sample;
- a task notification interrupts the blocking wait promptly;
- duplicate pressure/hall task starts are rejected;
- sensor ownership can be acquired, released, and observed as `NONE`;
- repeated-session task guards remain clear after cleanup.

## Build and Unity results

- Production full-clean build: passed.
- Final configuration-triggered production rebuild: passed.
- Final image: `0x11b7d0` bytes, 41% of the app partition free.
- `idf.py size`: 1,161,046-byte image, 121,432-byte DRAM use (37.79%).
- Unity full-clean build: passed.
- Physical Unity suite: **246 passed, 0 failed, 0 ignored**.
- HX710 valid ratio: 20/20.
- Repeated synchronized reads: 10/10.

The requested historical gate was 241/241. The current dirty test tree already
contained five additional test cases before this correction; this change added
assertions to an existing case rather than adding another case. No unrelated
tests were removed to force the historical count.

## Physical results

Before correction, an 18-second capture contained three task-watchdog events,
spaced approximately five seconds apart, naming `session_pressur`.

After the pressure-loop and main-stack corrections:

| Run | Duration | Start/stop result |
| --- | ---: | --- |
| Long session | 610.053 s | Passed |
| Repeated cycle 1 | 65.101 s | Passed |
| Repeated cycle 2 | 65.120 s | Passed |
| Repeated cycle 3 | 65.118 s | Passed |

Clean active-session evidence totals:

- watchdog events: 0;
- Guru Meditation events: 0;
- panic events: 0;
- reset events: 0;
- session starts: 4;
- session stops: 4;
- transitions back to `READY_FOR_SESSION`: 4;
- fresh `SESSION_PRESSURE_AVAILABLE` events: 4;
- transient `SESSION_PRESSURE_RECOVERED` events: 115;
- terminal pressure-degraded events: 0.

Metrics continued updating throughout physical compressions. Every stop returned
to `READY_FOR_SESSION`, and each following start created a fresh pressure task.
This demonstrates prompt task exit, released sensor ownership, no sampling task
leak, and no duplicate task across repeated sessions.

## Evidence

- `watchdog-before-fix-com4.log`: failing watchdog capture.
- `unity-full-after-fix.log`: complete physical Unity output.
- `unity-full-after-fix.xml`: physical Unity JUnit record.
- `session-repro-after-fix.log`: controlled stack-fault reproduction and
  post-stack-correction short run.
- `physical-session-after-fix.log`: clean long session and three repeated
  cycles.
- `physical-session-after-fix-summary.json`: exact machine-recorded durations.
- `mqtt-session-after-fix.log`: MQTT commands, status, heartbeat, and telemetry.
