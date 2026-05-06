<<<<<<< HEAD
# ResQ

ResQ is a smart CPR training system designed to support real-time, objective CPR practice feedback using a sensor-enabled manikin prototype, a local-first dashboard, and a backend that can run locally or in the cloud.

This repository includes:

- A React/Vite frontend
- A Spring Boot backend
- Dual database support for local development and cloud deployment
- Prototype workflow documentation for the CPR manikin hardware, firmware, calibration, dashboard, and roadmap

---

## Project Goal

The goal of ResQ is to build a CPR training system that can provide useful feedback during practice sessions.

The system focuses on measuring and presenting:

- Compression count
- Compression rate
- Compression depth estimate
- Recoil quality
- Pause time
- Hand placement or placement drift
- Session-level score summary
- Instructor comments and review data

ResQ is intended for training and educational use only. It is not certified for clinical use or real patient care.

---

## Repository Structure

```text
frontend/
  React + Vite user interface

backend/
  Spring Boot API

backend/src/main/resources/schema-local.sql
  SQLite schema for local development

backend/src/main/resources/schema-cloud.sql
  PostgreSQL schema for cloud deployment

docs/
  Project documentation, calibration notes, test plans, and design notes
```

---

## Run Locally

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite development server will start the frontend.

The Vite dev server proxies `/api` requests to:

```text
http://localhost:8080
```

---

### Backend

```bash
cd backend
mvn spring-boot:run
```

By default, the backend uses the local profile and runs with SQLite.

---

## Database Profiles

### Local Profile

The local profile is intended for development and local testing.

```text
Database: SQLite
Default Spring profile: local
Database file: backend/data/resq-local.db
Schema file: backend/src/main/resources/schema-local.sql
```

---

### Cloud Profile

The cloud profile is intended for PostgreSQL deployment.

Set the active Spring profile:

```bash
SPRING_PROFILES_ACTIVE=cloud
```

Provide the following environment variables:

```bash
SPRING_DATASOURCE_URL=<your-postgresql-url>
SPRING_DATASOURCE_USERNAME=<your-username>
SPRING_DATASOURCE_PASSWORD=<your-password>
```

Cloud schema file:

```text
backend/src/main/resources/schema-cloud.sql
```

---

## API Endpoints

The backend exposes the same hub routes expected by the frontend UI.

```text
POST /api/auth/login
GET  /api/hub/health
GET  /api/mock/live
GET  /api/mock/session/active
POST /api/mock/session/start
POST /api/mock/session/end
GET  /api/mock/session/last-summary
```

These endpoints support authentication testing, hub health checks, live mock data, active session state, session start/end, and session summary retrieval.

---

# Getting Started: Prototype Workflow

This section describes the planned hardware, firmware, dashboard, calibration, and roadmap workflow for the CPR manikin prototype.

---

## 1. Hardware Prototype

Build the CPR manikin sensing stack using:

- A 2×2 TPU bladder array
- Sternum plate
- Chest-like cover or stitched overlay
- Pressure sensor or sensors with ADC
- Hall sensor and magnet for sternum movement tracking

The hardware prototype should be designed to give a realistic compression feel while still allowing sensor readings to be collected reliably.

---

## 2. Firmware

The firmware should read sensor values and calculate meaningful CPR training metrics.

Firmware responsibilities:

- Read pressure sensor data
- Read Hall sensor or depth-related sensor data
- Detect compression events
- Estimate compression depth in millimetres
- Calculate compression rate in compressions per minute
- Detect pause time
- Detect recoil or incomplete release
- Estimate placement drift such as left, right, up, or down
- Send data to the dashboard/backend

Main computed values:

```text
compression count
rate_cpm
depth_mm
pause_time
recoil_ok
placement_drift
```

---

## 3. Dashboard

The dashboard should support live monitoring and after-session review.

Planned dashboard features:

- Live graphs
- Real-time indicators
- Compression depth feedback
- Compression rate feedback
- Recoil feedback
- Pause detection
- Session save
- Score summary
- Instructor comments box
- Export or review of completed sessions

---

## Calibration

Calibration is important because raw sensor values are not automatically meaningful.

Required calibration steps:

### 1. Zero Calibration

Take a baseline reading when there is no load on the manikin.

This helps remove sensor offset and makes future readings relative to the resting state.

---

### 2. Depth Calibration

Use known displacement steps to map sensor readings to actual compression depth.

Example:

```text
0 mm
10 mm
20 mm
30 mm
40 mm
50 mm
60 mm
```

This helps convert Hall sensor or displacement-related readings into depth in millimetres.

---

### 3. Pressure Calibration

Calibrate each bladder or pressure channel.

This can be done using either:

- Absolute pressure values, or
- Relative ratio-based normalization between bladder readings

This is useful for placement detection and consistency between sessions.

---

### 4. Threshold Tuning

Tune CPR feedback thresholds for different training profiles.

Example profiles:

- Adult CPR profile
- Child CPR profile
- Beginner training profile
- Advanced training profile

Calibration notes should be documented under:

```text
/docs/calibration
```

---

## Roadmap

Planned next steps:

- [ ] Finalize mechanical stack with stable compressibility and durability
- [ ] Lock the sensor strategy: pressure + depth, or depth-only MVP
- [ ] Implement robust compression event detection using hysteresis and debounce
- [ ] Build instructor dashboard mock and convert it into a working prototype UI
- [ ] Add session logging
- [ ] Add CSV/PDF export
- [ ] Add validation with repeated trials
- [ ] Define a basic scoring rubric
- [ ] Improve calibration documentation
- [ ] Prepare for final demonstration and evaluation

---

## Safety and Ethics

- ResQ is for CPR training use only.
- ResQ is not certified for clinical use.
- ResQ must not be used for real patient care or clinical decision-making.
- Sensitive personal data should not be stored in public repositories.
- Feedback thresholds should reference accepted CPR training guidelines.
- CPR guideline citations should be added before final academic submission.

---

## License

To be decided.

Possible options:

- MIT
- Apache-2.0
- All rights reserved

Until the license is finalized, assume:

```text
All rights reserved.
```

---

## Contact

For questions, design suggestions, collaboration requests, or issue reporting, open an issue in this repository.