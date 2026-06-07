# Cloud Architecture Decision

ResQ LocalHub remains the live CPR training brain. All live MQTT telemetry, firmware command control, calibration, pairing, session start/stop, and SSE live dashboard behavior stay local and must not depend on cloud availability.

Cloud is reserved for post-session review, history, analytics, backup/sync, and future course or user management. It must never block local training or change the offline-first training workflow.

Phase 1 of the cloud work only adds a local sync queue or outbox inside the LocalHub backend. When a completed session summary is safely stored in local SQLite, LocalHub records a pending sync item for later store-and-forward processing.

Future phases may add shared cloud DTOs, a cloud API, PostgreSQL, a sync worker, a cloud dashboard, AWS deployment, and security hardening. Those phases are intentionally out of scope for this slice.

Cloud sync must always be non-blocking. If the queue write fails, LocalHub still completes the local session end flow and preserves the session summary for local review and export.
