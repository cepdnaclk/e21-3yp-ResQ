<<<<<<< HEAD
# ResQ Stack Migration

This repository now includes a React/Vite frontend and a Spring Boot backend with dual database support.

## Structure

- `frontend/` - React + Vite UI
- `backend/` - Spring Boot API
- `backend/src/main/resources/schema-local.sql` - SQLite schema for local development
- `backend/src/main/resources/schema-cloud.sql` - PostgreSQL schema for cloud deployment

## Run Locally

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
mvn spring-boot:run
```

The Vite dev server proxies `/api` requests to `http://localhost:8080`.

## Database Profiles

### Local

- Uses SQLite
- Default Spring profile: `local`
- Database file: `backend/data/resq-local.db`

### Cloud

- Uses PostgreSQL
- Set `SPRING_PROFILES_ACTIVE=cloud`
- Provide `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, and `SPRING_DATASOURCE_PASSWORD`

## API Endpoints

The backend exposes the same hub routes the UI expects:

- `POST /api/auth/login`
- `GET /api/hub/health`
- `GET /api/mock/live`
- `GET /api/mock/session/active`
- `POST /api/mock/session/start`
- `POST /api/mock/session/end`
- `GET /api/mock/session/last-summary`
=======

---

## Getting Started (Prototype Workflow)

### 1) Hardware Prototype
- Build 2×2 TPU bladder array
- Mount under a sternum plate + chest-like cover
- Add pressure sensor(s) + ADC
- Add depth sensor (Hall + magnet) aligned with sternum movement

### 2) Firmware
- Read sensors
- Compute:
  - compression count (events)
  - rate (cpm)
  - depth estimate (mm)
  - pause time
  - placement drift (left/right/up/down)

### 3) Dashboard
- Live graphs and indicators
- Session save + score summary
- Instructor comments box

---

## Calibration (Important)

To make readings meaningful:
- **Zero calibration** at rest (no load)
- Depth calibration using known displacement steps
- Pressure calibration per bladder (or relative ratio-based normalization)
- Threshold tuning for adult/child profiles

Calibration notes will be documented under `/docs/calibration`.

---

## Roadmap (Next Steps)

- [ ] Finalize mechanical stack (stable compressibility + durability)
- [ ] Lock sensor strategy (pressure + depth vs depth-only MVP)
- [ ] Implement robust compression event detection (hysteresis + debounce)
- [ ] Build instructor dashboard mock → working prototype UI
- [ ] Session logging + export (CSV/PDF)
- [ ] Validation with repeated trials + basic scoring rubric

---

## Safety & Ethics

- Training use only; not certified for clinical use.
- No storage of sensitive personal data in public repositories.
- Feedback thresholds should reference CPR training guidelines (with citations added later).

---

## License

To be decided (MIT / Apache-2.0 / etc.). For now, assume **all rights reserved** until we finalize.

---

## Contact

Open an issue in this repo for questions, design suggestions, or collaboration requests.

---
>>>>>>> 8bc440e65f392fe99a10912d9950e823c64ae2f2
