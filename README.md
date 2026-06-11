# ResQ

**ResQ** is a smart CPR training system designed to make CPR practice more measurable, objective, and useful for both trainees and instructors.

The project combines a sensor-enabled CPR manikin prototype with a local-first software platform that gives real-time feedback during CPR practice and supports after-session review. ResQ is built for training and education, not for clinical diagnosis, treatment, or real patient care.

---

## Project Idea

In many CPR training sessions, learners depend mainly on instructor observation to understand whether their compressions are deep enough, fast enough, properly released, and consistently performed. This can be difficult when one instructor supervises multiple trainees or when learners need repeated feedback to improve their technique.

ResQ addresses this problem by turning a CPR manikin into a feedback-enabled training station. The system measures important CPR performance indicators during practice and presents them in a simple dashboard so trainees can correct mistakes and instructors can review performance more objectively.

The main idea is to provide a low-cost, locally buildable CPR training solution that supports practical learning environments such as university labs, skills labs, training centres, and outreach training sessions.

---

## Vision

Our vision is to create an affordable CPR training platform that helps improve the quality of CPR practice through real-time, objective feedback.

ResQ aims to support:

- Better trainee self-correction during practice
- Easier instructor supervision
- More consistent CPR performance assessment
- Local-first training without depending on internet access
- Session records for review, improvement tracking, and academic evaluation
- A prototype that can be improved toward future pilot testing with medical education partners

The long-term direction is to make ResQ useful not only as a final-year project prototype, but also as a practical foundation for future CPR training research, validation, and product development.

---

## What ResQ Measures

ResQ focuses on the core CPR performance areas that are important during training:

- Compression depth
- Compression rate
- Compression count
- Chest recoil or full release
- Pauses and interruptions
- Hand placement or placement drift
- Overall session quality
- Instructor review and feedback

These measurements are intended to help learners understand their CPR technique in a clearer and more objective way.

---

## System Overview

At a high level, ResQ has three major parts:

### 1. Sensor-Enabled Manikin Prototype

The manikin prototype is designed to detect CPR compression behaviour using embedded sensing. The current concept includes a chest overlay or retrofit module that can be placed on or integrated with a training manikin.

### 2. Local Hub Application

The Local Hub is the instructor-side application. It supports local training sessions, live feedback, session control, and after-session review. The system is designed to work on a local network so CPR training can continue even without internet access.

### 3. Dashboards for Feedback and Review

The dashboard provides live CPR feedback during practice and session summaries after the session ends. The instructor can monitor trainee performance, review session results, and use the data for discussion or evaluation.

---

## Project Scope

### In Scope

ResQ currently focuses on:

- Building a working CPR training prototype
- Measuring key CPR practice metrics from a manikin
- Showing live feedback during a training session
- Supporting instructor-led session start and end workflow
- Saving and reviewing session summaries
- Supporting local-first operation
- Preparing the system for testing, demonstration, and academic evaluation
- Designing the solution to be affordable and locally buildable

### Out of Scope

ResQ is not intended to be:

- A certified medical device
- A patient monitoring system
- A clinical decision-making system
- A replacement for certified CPR instructors
- A final commercial product at the current prototype stage

The current project focuses on building and validating a functional educational prototype.

---

## Current Project Status

ResQ is currently in the active implementation and integration stage.

### Completed or Mostly Defined

- Project concept and problem definition
- Core CPR training feedback goals
- Local-first system direction
- Main software and firmware architecture direction
- Dashboard role direction for instructor and trainee views
- Manikin sensing concept using pressure/depth-related measurements
- Safety and educational-use boundaries
- Initial documentation and system requirements

### In Progress

- Firmware development for the sensor-enabled manikin
- Local Hub application development
- Instructor dashboard workflow
- Live training session flow
- Calibration and readiness workflow
- Sensor hardware integration
- Manikin chest overlay / prototype refinement
- Session summary and export workflow
- End-to-end testing between firmware, Local Hub, and dashboard

### Planned Next

- Complete stable calibration workflow
- Improve live feedback accuracy and reliability
- Finalize hardware prototype assembly
- Validate sensor readings through repeated trials
- Improve dashboard usability for demonstrations
- Prepare final project evaluation and demonstration
- Explore optional cloud sync and long-term session history after the local system is stable

---

## Intended Users

ResQ is mainly designed for:

- CPR trainees
- Medical and nursing students
- First-aid learners
- Instructors and trainers
- Academic evaluators
- Training centres or institutions interested in objective CPR practice feedback

---

## Educational Value

ResQ helps turn CPR training from only observation-based feedback into a more data-supported learning experience.

For trainees, it gives clearer feedback on what they are doing well and what they need to improve.

For instructors, it supports more consistent supervision, easier review, and better documentation of training sessions.

For the project team, it provides a complete engineering challenge involving hardware prototyping, embedded systems, local networking, real-time dashboards, software architecture, data handling, and user-centred design.

---

## Safety and Ethics

ResQ is strictly a CPR training and education tool.

- It must not be used for real patient care.
- It must not be treated as a certified medical device.
- CPR feedback rules should be reviewed with qualified medical educators.
- Trainee data should be handled responsibly.
- Sensitive information should not be stored in public repositories.
- The system should be evaluated carefully before being used in any formal training workflow.

---

## Project Direction

The immediate goal is to complete a stable prototype that can demonstrate the full training flow:

```text
Prepare manikin
Start local training session
Perform CPR practice
Show live feedback
End session
Review performance summary
Use results for learning and improvement
```

After the local prototype becomes stable, the project can be extended with better hardware refinement, improved scoring, pilot validation, optional cloud-based history, and broader training analytics.

---

## License

License to be decided.

Until a license is finalized, assume:

```text
All rights reserved.
```

---

## Contact

For questions, collaboration, feedback, or issue reporting, contact the ResQ project team or open an issue in this repository.
