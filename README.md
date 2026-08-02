# ResQ – Smart CPR Training System

ResQ is a local-first CPR training platform that combines sensor-enabled manikins, ESP32-C3 firmware, MQTT communication, a Windows LocalHub desktop application, real-time feedback, and completed-session scoring.

> ResQ is intended for training and education. It is not a medical device and must not be used for patient care, diagnosis, treatment, or emergency decision-making.

## Project overview

Effective CPR practice benefits from immediate, objective feedback, but instrumented training systems can be difficult to access or deploy. ResQ adds sensing and connected feedback to CPR manikins so trainees and instructors can observe compression quality during a session and review the result afterward.

The ESP32-C3 firmware collects calibrated sensor measurements and sends them through a local Mosquitto broker. ResQ LocalHub manages devices, sessions, users, live dashboards, scoring, and history on the instructor's Windows PC. Core training remains available on the local network without an active internet connection.

## Main capabilities

- Compression-depth and compression-rate monitoring
- Chest-recoil feedback
- Hand-position and pressure-distribution feedback
- Manikin pairing, readiness checks, and sensor calibration
- Live instructor monitoring and trainee feedback
- Completed-session scoring, history, and review
- Local MQTT telemetry and command delivery
- Concurrent registration and monitoring of multiple manikins
- Local-first operation with SQLite persistence
- Windows desktop packaging through Tauri

## System architecture

```text
ResQ Manikin Sensors
        |
        v
ESP32-C3 Firmware
        | MQTT
        v
Mosquitto Broker
        |
        v
Spring Boot LocalHub Backend
        | REST / SSE
        v
React + TypeScript Frontend
        |
        v
Tauri Desktop Application
```

The firmware is built with ESP-IDF for the ESP32-C3. The local software stack uses Mosquitto and MQTT for device communication, a Java Spring Boot backend with SQLite storage, REST APIs and server-sent events (SSE), and a React/TypeScript interface built with Vite. Tauri and Rust package these parts as a Windows desktop application.

## Repository structure

```text
e21-3yp-ResQ/
|-- code/
|   |-- resq-firmware/                 ESP32-C3 production and Unity firmware
|   |-- resq-localhub/
|   |   |-- apps/localhub-desktop/     React, TypeScript, Vite, and Tauri app
|   |   |-- services/hub-api/          Spring Boot LocalHub backend
|   |   |-- infra/                     Local MQTT configuration
|   |   `-- scripts/                   Demo, validation, and support scripts
|   |-- resq-cloud/                    Cloud-side integration resources
|   `-- scripts/                       Repository utility scripts
|-- docs/                              Design, validation, scoring, and website sources
|-- casing_design/                     Mechanical enclosure design files
|-- pcb_design/                        PCB design files
|-- ResQ_User_Manual_v1.0.md           Version 1.0 user manual
`-- README.md
```

## ResQ LocalHub desktop application

The packaged Windows application brings together the Tauri desktop shell, React frontend, Spring Boot backend, Mosquitto broker, bundled Java runtime, release configuration, and local SQLite-backed data storage. End users should install a published release instead of manually assembling these runtime components.

## Installation

[Download ResQ Local Hub v1.0.0](https://github.com/cepdnaclk/e21-3yp-ResQ/releases/tag/v1.0.0)

The release provides:

- `ResQ.Local.Hub_1.0.0_x64-setup.exe` — NSIS Windows installer
- `ResQ.Local.Hub_1.0.0_x64_en-US.msi` — MSI Windows installer
- `SHA256SUMS.txt` — SHA-256 checksums for release verification

## Running from source

### LocalHub frontend and desktop app

Use Node.js, pnpm, Rust, and the Tauri prerequisites for Windows.

```powershell
cd code\resq-localhub\apps\localhub-desktop
pnpm.cmd install
pnpm.cmd tauri dev
```

Build only the web frontend:

```powershell
pnpm.cmd run build
```

Build the packaged Windows application after its release resources have been prepared:

```powershell
pnpm.cmd tauri build
```

### LocalHub backend

Use the included Maven wrapper with Java 17:

```powershell
cd code\resq-localhub\services\hub-api
.\mvnw.cmd package
```

### ESP32-C3 firmware

Run these commands in an ESP-IDF shell:

```powershell
cd code\resq-firmware
idf.py set-target esp32c3
idf.py build
```

See the [firmware developer guide](code/resq-firmware/README.md) for flashing, provisioning, calibration, and hardware details.

## Testing

### Frontend

The desktop frontend uses Vitest and React Testing Library.

```powershell
cd code\resq-localhub\apps\localhub-desktop
pnpm.cmd run typecheck
pnpm.cmd test
```

### Backend

The backend test suite uses Spring Boot Test, JUnit, Mockito, and JaCoCo through Maven.

```powershell
cd code\resq-localhub\services\hub-api
.\mvnw.cmd test
```

### Tauri/Rust

```powershell
cargo check --manifest-path code\resq-localhub\apps\localhub-desktop\src-tauri\Cargo.toml
```

### Firmware Unity tests

The firmware test project builds a separate ESP-IDF Unity image. Tests marked for hardware require the corresponding board and sensors.

```powershell
cd code\resq-firmware\test
idf.py set-target esp32c3
idf.py build
```

See the [firmware Unity test guide](code/resq-firmware/test/README.md) for execution and hardware-test commands.

## Documentation

| Resource | Description |
| --- | --- |
| [ResQ v1.0 user manual](ResQ_User_Manual_v1.0.md) | Installation, roles, device setup, calibration, sessions, and troubleshooting |
| [Firmware developer guide](code/resq-firmware/README.md) | Firmware architecture, build, flash, provisioning, calibration, and testing |
| [Firmware Unity test guide](code/resq-firmware/test/README.md) | Deterministic and physical firmware test workflow |
| [Firmware-to-LocalHub data flow](docs/integration-checkup/2026-07-28/phase-02-data-flow.md) | MQTT ingestion, persistence, session processing, and UI delivery |
| [CPR scoring method](docs/CPR_SCORING_METHOD.md) | Authoritative score inputs, targets, weights, and formulas |
| [MQTT security modes](code/resq-localhub/docs/mqtt-security.md) | Development and secured broker configurations |
| [Local demo runbook](code/resq-localhub/docs/local-demo-runbook.md) | Windows-first LocalHub demonstration workflow |
| [Calibration hardening report](docs/calibration-hardening-report.md) | Calibration reliability findings and verification |
| [Physical hardware validation](docs/integration-checkup/2026-07-28/phase-07-hardware-validation.md) | Retained firmware and hardware validation record |

## Project website

[View the ResQ project website](https://cepdnaclk.github.io/e21-3yp-ResQ/site/)

## Release information

Latest stable release: [v1.0.0](https://github.com/cepdnaclk/e21-3yp-ResQ/releases/tag/v1.0.0)

The existing tag and release are the authoritative v1.0.0 distribution. Release binaries are hosted on GitHub and are not stored in this repository.

## Team and institution

ResQ is a third-year engineering project from the Department of Computer Engineering, Faculty of Engineering, University of Peradeniya.

- E/21/148 — S. Ganathipan
- E/21/152 — V. Amirsha
- E/21/214 — K. Kartheepan
- E/21/220 — S. Kavishanthan

## Recognition

- First place, EXITO 2026 Inter-University Robotics and Innovation Challenge
- Third place, INNOVEXA 2026 Business Pitching Competition
- Accepted for oral presentation at the iPURSE 2026 International Research Symposium
- Selected among the Top 22 semifinalists in the NetX IoT Challenge 2026

These milestones are documented on the [project website](https://cepdnaclk.github.io/e21-3yp-ResQ/site/).

## License

This repository does not currently include an explicit software or hardware license. Use, modification, and redistribution are subject to permission from the project owners.
