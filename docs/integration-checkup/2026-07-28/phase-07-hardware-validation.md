# Phase 7G-1 — Physical firmware and Unity runtime validation

## Hardware result

**BLOCKED — HARDWARE/POWER/SENSOR SETUP INCOMPLETE**

The ESP32-C3 and Hall sensor are reachable, but the pressure 2 HX710 path on
GPIO10 is persistently stuck LOW after a completed read. The mandatory physical
Unity gate therefore failed, and the checkpoint stopped before production
firmware or LocalHub validation as required.

## Repository checkpoint

- Branch: `integration/firmware-localhub-traffic-scaling`
- Starting HEAD: `f2e3998bec8b1cda66584ebc639f228fbd780ca7`
- Ending HEAD: the evidence commit containing this report; the authoritative
  hash is recorded by the final `git rev-parse HEAD` and final response
- Starting worktree: clean
- Intended ending worktree: clean after the evidence commit
- Source changes: none
- Calibration/CPR threshold changes: none

## Hardware

- Target: physically confirmed ESP32-C3 QFN32, chip revision v0.4, embedded
  4 MB XMC flash
- Serial interface: CP210x USB-to-UART on `COM4`
- Power: host USB; external sensor-rail voltage not measured
- Hall sensor: present and physically readable on GPIO0
- HX710: expected three-channel topology on shared GPIO6 SCK; reference GPIO1
  and pressure 1 GPIO3 produce captured bit patterns, while pressure 2 GPIO10
  remains stuck LOW
- Network: not entered; SSID and device-visible service addresses were not
  observed or recorded

See `phase-07-hardware-environment.md` for the complete environment record.

## Unity result

- Clean build: PASS
- Erase and flash on confirmed `COM4`: PASS; written data hash verified
- Tests discovered: 241
- Tests executed: 241
- Tests passed: 236
- Tests failed: 5
- Tests skipped/ignored: 0
- Expected reset count: 1 scripted RTS/power-on reset at capture start
- Unexpected reset count after application start: 0
- Watchdog/WDT errors: 0
- Stack-protection/stack-overflow faults: 0
- Heap-corruption faults: 0
- Panic/Guru Meditation/brownout: 0
- Runtime `assert failed` faults: 0
- Unity failure assertions: 5
- GPIO/SCK ownership failures: 0; owner was `HX710`, idle SCK was LOW, and both
  hardware diagnostics restored SCK LOW
- Sensor-driver/hardware test failures: 5, sharing one HX710 invalid-response
  condition
- MQTT-related test failures: 0

The retained evidence run booted with the NVS I/O mode left as USB by the prior
full-suite run. Earlier tests exercise the I/O-mode store; by the time the
physical sensor tests executed, the runner explicitly reported
`HX710_DIAG,MODE,SENSOR`. The native USB console was disabled and UART0 remained
the monitor path.

## Exact failures

1. `test_read_pressure_sensor_raw_values`: no valid HX710 reads in 100 attempts.
2. `test_read_all_sensor_raw_values`: Hall reads remained valid, but there were
   no valid synchronized HX710 reads in 100 attempts.
3. `test_hx710_minimum_valid_read_ratio`: 0 successful group reads out of 20;
   minimum required was 15.
4. `test_hx710_shared_sck_and_dout_diagnostics`: synchronized group read
   returned `ESP_ERR_INVALID_RESPONSE` (264).
5. `test_hx710_repeated_synchronized_group_reads`: 0 successful reads after
   3 warmups and 20 measured attempts; minimum required was 10.

## First-failure trace

The first failing assertion is
`test_raw_sensor_outputs.c:118`. The test accumulates the group `valid_mask`
over 100 physical reads and rejects a run with zero valid channel samples.

The physical diagnostic then narrows the cause:

```text
pressure_ref GPIO1: captured raw data
pressure_1   GPIO3: captured raw data
pressure_2  GPIO10: raw=0, STUCK_LOW
captured_mask=0x07
valid_mask=0x00
stuck_low_mask=0x04
post_invalid_mask=0x04
error=ESP_ERR_INVALID_RESPONSE
pulses=25
cleanup=ESP_OK
```

In `components/hx710/hx710.c`, a completed 25-pulse read must start the next
conversion and each DOUT must return HIGH. GPIO10 stays LOW, so the driver sets
`stuck_low_mask` and `post_read_invalid_mask`, returns
`ESP_ERR_INVALID_RESPONSE`, does not publish the captured raw values, and
forces shared SCK LOW during cleanup. This is the intended fail-closed behavior,
not evidence for a firmware relaxation or threshold change.

Before rerunning this checkpoint, inspect the pressure 2 HX710 path: module
power and ground, GPIO10 DOUT continuity/pin assignment, shared GPIO6 SCK
continuity, the sensor/module connection, and the module itself. A swap test
between the pressure 1 and pressure 2 module/DOUT paths can distinguish a module
fault from a GPIO10 wiring fault without changing firmware.

## Production runtime

| Area | Result |
| --- | --- |
| Production clean build | BLOCKED — not run after Unity failure |
| Production erase/flash | BLOCKED — not run |
| Boot/state sequence | BLOCKED — not observed |
| Backend registration | BLOCKED — not observed |
| MQTT status/heartbeat | BLOCKED — not observed |
| Command correlation | BLOCKED — not tested |
| Duplicate command behavior | BLOCKED — not tested |
| Sensor stream | BLOCKED — not tested |
| Physical calibration | BLOCKED — not tested |
| Physical CPR session | BLOCKED — not tested |
| Broker restart recovery | BLOCKED — not tested |
| Backend restart recovery | BLOCKED — not tested |
| Wi-Fi interruption recovery | BLOCKED — not tested |

The production, broker, and backend log files explicitly record that these
stages were not run. No production success is claimed.

## Test matrix

| Test | Expected | Actual | Evidence | Result |
| --- | --- | --- | --- | --- |
| Serial identification | One confirmed ESP32-C3 | CP210x `COM4`; ESP32-C3 rev v0.4 confirmed by ROM | Environment report | PASS |
| Unity clean build | Build and size succeed | 79% app partition free; no compiler warning observed | Environment report | PASS |
| Unity flash | Verified flash on confirmed port | Erase, write, and hash verification succeeded | Flash command transcript summarized in environment | PASS |
| Full physical Unity suite | 241/241 pass | 236 pass, 5 fail, 0 ignored | `phase-07-unity-runtime.log` | FAIL |
| Hall raw acquisition | Valid physical samples | 100 successful samples, approximately 2383–2439 | Unity log | PASS |
| HX710 shared SCK ownership | Owned in SENSOR mode and LOW after reads/failures | Owner `HX710`; idle and both cleanup checks LOW | Unity log | PASS |
| HX710 synchronized reads | Valid three-channel reads | GPIO10 pressure_2 stuck LOW; 0 valid groups | Unity log | FAIL |
| USB/SCK conflict | No native USB console ownership conflict or resets | UART console used; native USB console disabled; no unexplained reset | Unity log and sdkconfig | PASS |
| Production runtime | Begin only after Unity passes | Correctly not begun | Production placeholder log | BLOCKED |
| LocalHub/MQTT/calibration/session/recovery | Validate with production firmware | Correctly not begun | Broker/backend placeholder logs | BLOCKED |

## Runtime error classification

- Expected test-path output: the earlier unit tests deliberately emit error
  manager, bootstrap, NVS, MQTT, timeout, GPIO, and FSM error lines while
  exercising negative paths; each corresponding test ends in `PASS`.
- Recoverable warning: ESP-IDF reports a 4 MB physical flash with a 2 MB image
  header. The image fits and boot continues, but configuration should be
  reconciled separately.
- P1: all five physical failures trace to pressure 2 / GPIO10 remaining LOW
  after the read transaction, blocking safe group acquisition and every later
  production validation step.
- No P0 was found.
- No independent watchdog, stack, heap, panic, brownout, uncontrolled reset,
  USB ownership, or SCK-cleanup defect was observed.

## Findings

| ID | Priority | Area | Finding | Evidence | Resolution |
| --- | --- | --- | --- | --- | --- |
| H7G1-01 | P1 | HX710 hardware/setup | pressure_2 on GPIO10 remains LOW after completed transactions; all group samples are rejected | Unity log lines containing `stuck_low_mask=0x04`, 5 Unity failures | Inspect module power/ground, DOUT/SCK wiring, attached sensor, and swap-test module/path; rerun full Unity suite before production |
| H7G1-02 | P2 | Flash configuration | 4 MB flash is detected but Unity image header declares 2 MB | Unity boot warning | Reconcile target flash-size configuration in a separate focused change; not the cause of the HX710 failures |
