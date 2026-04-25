CREATE TABLE IF NOT EXISTS authorized_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  full_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_authorized_students_email_lower
  ON authorized_students (LOWER(email));

CREATE TABLE IF NOT EXISTS manikins (
  manikin_id TEXT PRIMARY KEY,
  manikin_name TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'offline',
  battery_level INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS manikin_telemetry_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manikin_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  depth_mm INTEGER NOT NULL,
  rate_cpm INTEGER NOT NULL,
  recoil_ok INTEGER NOT NULL,
  pauses INTEGER NOT NULL DEFAULT 0,
  battery_level INTEGER NOT NULL,
  connection_status TEXT NOT NULL,
  flags TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (manikin_id) REFERENCES manikins(manikin_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telemetry_manikin_recorded_at
  ON manikin_telemetry_samples (manikin_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS training_sessions (
  session_id TEXT PRIMARY KEY,
  manikin_id TEXT NOT NULL,
  trainee_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
  FOREIGN KEY (manikin_id) REFERENCES manikins(manikin_id)
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_status_started
  ON training_sessions (status, started_at DESC);

CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY,
  manikin_id TEXT NOT NULL,
  trainee_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_depth_mm INTEGER NOT NULL DEFAULT 0,
  avg_rate_cpm INTEGER NOT NULL DEFAULT 0,
  recoil_ok_pct INTEGER NOT NULL DEFAULT 0,
  compliance_pct INTEGER,
  hand_placement_pct INTEGER,
  pauses_detected INTEGER,
  longest_pause_sec REAL,
  FOREIGN KEY (session_id) REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (manikin_id) REFERENCES manikins(manikin_id)
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_ended
  ON session_summaries (ended_at DESC);
