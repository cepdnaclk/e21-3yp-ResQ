
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
