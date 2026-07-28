# Phase 7G-1 hardware environment

## Repository checkpoint

- Branch: `integration/firmware-localhub-traffic-scaling`
- Starting HEAD: `f2e3998bec8b1cda66584ebc639f228fbd780ca7`
- Starting worktree: clean
- Test date: 2026-07-28
- Test start: approximately 18:45 +05:30 (first timestamp retained by the
  clean Unity build; serial detection occurred earlier in the same session)
- ESP-IDF: `v6.0-dirty`

## Confirmed target

- Confirmed serial port: `COM4`
- Windows device: `Silicon Labs CP210x USB to UART Bridge (COM4)`
- PnP instance: `USB\VID_10C4&PID_EA60\0001`
- PnP status: `OK`
- Identification method: Windows serial/PnP enumeration followed by a
  non-flashing `esptool.py --port COM4 chip_id`
- Chip: ESP32-C3, QFN32, revision v0.4
- Features reported by ROM: Wi-Fi, Bluetooth 5 LE, single core at 160 MHz
- Flash: embedded 4 MB XMC
- Crystal: 40 MHz
- Exact development-board and module marking: not identifiable from the USB
  descriptor and not physically inspected
- USB interface: external CP210x USB-to-UART bridge, not the native USB
  Serial/JTAG console
- Power: host USB through the connected development board; external sensor-rail
  voltage was not measured

Only `COM4` appeared in `[System.IO.Ports.SerialPort]::GetPortNames()`. No
Bluetooth or modem port was selected. The process scan did not identify a
running `idf.py`, `esptool`, or serial monitor that owned `COM4`; unrelated
processes whose command lines contained generic matching words were not
terminated.

## Connected sensor evidence

- Hall sensor: physically readable on ADC GPIO0. The retained run produced 100
  successful raw samples, approximately 2383–2439.
- HX710 topology expected by this HEAD: one shared SCK on GPIO6 and three DOUT
  lines: pressure reference GPIO1, pressure 1 GPIO3, and pressure 2 GPIO10.
- Pressure reference and pressure 1 produced captured raw bit patterns during
  the diagnostics.
- Pressure 2 on GPIO10 repeatedly returned zero and remained LOW after the
  completed 25-pulse transaction. The firmware correctly classified it
  `STUCK_LOW`.
- The exact third HX710 module's wiring, supply, ground continuity, and sensor
  attachment were not independently measured. The evidence therefore does not
  establish whether the failure is the module, wiring, power, or the attached
  pressure sensor.

The checkpoint text mentions GPIO19, but the locked source at this HEAD maps
HX710 shared SCK to GPIO6. The Unity image uses UART0 on GPIO20/GPIO21 and has
the native USB Serial/JTAG console disabled. No unexplained USB reset was
observed.

## Network environment

The Unity stage does not use live Wi-Fi, LocalHub, or MQTT. The Wi-Fi SSID,
device-visible broker address, and device-visible LocalHub address were not
observable without proceeding to production firmware and are intentionally not
invented. No credential, password, token, private key, or device MAC address is
recorded.

Production validation and LocalHub startup were not begun because the physical
Unity suite failed its mandatory sensor gate.

## Unity clean build

- Target: `esp32c3`
- Result: success
- Application: `resq_firmware_unity`
- App version: `localhub-v0.1.1-102-gf2e3998`
- Binary size: `0x65de0` bytes (build size report: 417,134-byte total image;
  flashed image: 417,248 bytes)
- Smallest app partition: `0x1e0000`
- Free app partition: `0x17a220` bytes (79%)
- Bootloader: `0x5250` bytes, 36% free
- Compiler warnings: none observed
- Generated configuration: no tracked configuration file changed; ignored
  build output and `sdkconfig.old` were not selected as evidence
- Boot warning: the physical chip reports 4 MB flash while the Unity image
  header is configured for 2 MB; the image and partition fit, but the mismatch
  is retained as a P2 configuration finding
