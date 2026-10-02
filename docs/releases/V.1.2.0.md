# ResQ Local Hub V.1.2.0

This release is built from `main`. Application and installer versions are `1.2.0`.

## Changes since V1.1.0

- Includes the ResQ Coach session review, performance and trend analysis, and instructor assistant work merged into main.
- Fixes manual firmware sensor-stream scheduling after an overrun so the task yields instead of repeatedly missing its delay.
- Raises the minimum manual sensor-stream interval to 100 ms and logs slow sensor reads and stream overruns.
- Aligns Local Hub validation and calibration requests with the firmware 100 ms minimum.
- Cancels the tablet-access copy notification timer when its panel unmounts.
- Aligns desktop package, Rust package, and installer version metadata and records Rust dependency versions in Cargo.lock.

## Windows installation

Use either the x64 EXE installer or the x64 MSI installer. The application bundles the Java runtime, backend API, Mosquitto broker, and LAN student dashboard. The Windows package does not flash or update manikin firmware.

Build requirements: Node.js/npm, Rust MSVC, Microsoft C++ Build Tools and Windows SDK, and Java 17 JDK with jlink. Frontend dependency versions are recorded in pnpm-lock.yaml; Maven uses the repository wrapper.

The downloadable build manifest records verification results and limitations. Physical manikin and second-device LAN qualification must be performed separately.
