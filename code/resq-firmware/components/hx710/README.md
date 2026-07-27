# HX710 shared-clock driver

The HX710 component is the canonical owner of the pressure array's shared
clock. In `SENSOR` mode, `hx710_sck_acquire_for_sensor_mode()` detaches the
native USB pad, preloads GPIO19 LOW, configures it as an output with both pulls
disabled, and verifies the LOW level. Production startup and hardware tests
perform this acquisition once. Normal transactions never reset or remux the
pin. Every transaction restores and verifies LOW before returning. HX710 APIs
reject `USB` mode before touching GPIO19.

Configured channels are:

| Channel | DOUT | Valid-mask bit |
|---|---:|---:|
| `pressure_ref` | GPIO1 | `HX710_VALID_CHANNEL_0` |
| `pressure_1` | GPIO3 | `HX710_VALID_CHANNEL_1` |
| `pressure_2` | GPIO10 | `HX710_VALID_CHANNEL_2` |

Because all three converters physically receive every GPIO19 edge,
`hx710_read_single()` fails closed with `ESP_ERR_NOT_SUPPORTED`; selecting one
DOUT in software is not electrical isolation. The legacy `hx710_read()` API
remains only for source compatibility and returns its error sentinel.

`hx710_read_group_shared_sck()` keeps SCK LOW until all three DOUTs are LOW,
then performs one synchronized 24-bit read plus the 25th selection pulse. A
150 ms readiness timeout produces no clock pulses. After the read, every DOUT
must return HIGH and the next LOW transition must occur no earlier than the
minimum derived from the configured 10 Hz pressure rate with 20% tolerance.
Stuck-HIGH, stuck-LOW, invalid post-read, and impossible-cadence masks are
reported separately.

Raw outputs become valid only after the whole group passes protocol and cadence
validation. Compatibility wrappers leave the caller's previous raw values
unchanged on any failure and clear the validity mask. No partial group value is
published as a valid measurement.

`hx710_sck_release_for_usb_mode()` is separate from transaction cleanup. The
state-machine mode request calls it only after confirming that no sensor owner
is active, then persists the reboot-only USB mode request. Native USB regains
GPIO18/GPIO19 on the following reboot.

Hardware diagnostics acquire `SENSOR_OWNER_DIAGNOSTIC`; production calibration,
session acquisition, and manual sensor streaming retain their existing owners.
The mock I/O seam in `hx710_test.h` exists for component tests and must not be
used by production code.
