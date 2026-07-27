# HX710 shared-clock driver

The HX710 component is the canonical owner of the pressure array's shared
clock. In `SENSOR` mode, `hx710_sck_acquire_for_sensor_mode()` detaches the
native USB pad under the retained legacy protection sequence, preloads the
board-configured shared SCK LOW, configures it as an output with both pulls
disabled, and verifies the LOW level. The active ResQ mapping uses GPIO6.
Production startup and hardware tests perform this acquisition once. Normal
transactions never reset or remux the pin. Every transaction restores and
verifies LOW before returning. HX710 APIs reject `USB` mode before touching
sensor GPIO.

Configured channels are:

| Channel | DOUT | Valid-mask bit |
|---|---:|---:|
| `pressure_ref` | GPIO1 | `HX710_VALID_CHANNEL_0` |
| `pressure_1` | GPIO3 | `HX710_VALID_CHANNEL_1` |
| `pressure_2` | GPIO10 | `HX710_VALID_CHANNEL_2` |

Because all three converters physically receive every shared-SCK edge,
`hx710_read_single()` fails closed with `ESP_ERR_NOT_SUPPORTED`; selecting one
DOUT in software is not electrical isolation. The legacy `hx710_read()` API
remains only for source compatibility and returns its error sentinel.

`hx710_read_group_shared_sck()` keeps SCK LOW until all three DOUTs are LOW,
then performs one synchronized 24-bit read plus the 25th selection pulse. A
150 ms readiness timeout produces no clock pulses. After the read, every DOUT
must return HIGH and shared SCK must be restored and verified LOW. The current
sample is then returned immediately. Production reads do not wait for or
validate the timing of the following conversion; the next call performs the
next readiness wait.

The result includes a non-blocking, best-effort next-ready observation for
diagnostics. `observed_next_ready_mask`,
`early_next_ready_warning_mask`, and `first_next_ready_low_us` never affect
`error` or `valid_mask` and are not pressure-read failure flags. The hardware
diagnostic test may observe DOUT for the configured minimum conversion
interval and print every timing warning without holding the production mutex.
Normal production emits only a DEBUG message for an immediately observed
transition.

`captured_raw_mask` distinguishes a completed 24-bit capture from a fully valid
group. Raw outputs become decision-valid only after the current transaction
passes readiness, clocking, trailing-pulse, immediate post-read HIGH, and SCK
cleanup validation. Compatibility wrappers leave the caller's previous raw
values unchanged on any failure and clear the validity mask. No
captured-but-invalid group value is published as a valid measurement.

`hx710_sck_release_for_usb_mode()` is separate from transaction cleanup. The
state-machine mode request calls it only after confirming that no sensor owner
is active, then persists the reboot-only USB mode request. Native USB regains
GPIO18/GPIO19 on the following reboot.

Hardware diagnostics acquire `SENSOR_OWNER_DIAGNOSTIC`; production calibration,
session acquisition, and manual sensor streaming retain their existing owners.
The mock I/O seam in `hx710_test.h` exists for component tests and must not be
used by production code.
