CREATE TABLE IF NOT EXISTS authorized_students (
  id BIGSERIAL PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_authorized_students_email_lower
  ON authorized_students (LOWER(email));

CREATE TABLE IF NOT EXISTS manikins (
  manikin_id VARCHAR(50) PRIMARY KEY,
  manikin_name VARCHAR(255) NOT NULL,
  connection_status VARCHAR(20) NOT NULL DEFAULT 'offline',
  battery_level INTEGER NOT NULL DEFAULT 100 CHECK (battery_level BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manikin_telemetry_samples (
  id BIGSERIAL PRIMARY KEY,
  manikin_id VARCHAR(50) NOT NULL REFERENCES manikins(manikin_id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  depth_mm INTEGER NOT NULL,
  rate_cpm INTEGER NOT NULL,
  recoil_ok BOOLEAN NOT NULL,
  pauses INTEGER NOT NULL DEFAULT 0,
  battery_level INTEGER NOT NULL CHECK (battery_level BETWEEN 0 AND 100),
  connection_status VARCHAR(20) NOT NULL,
  flags TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_telemetry_manikin_recorded_at
  ON manikin_telemetry_samples (manikin_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS training_sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  manikin_id VARCHAR(50) NOT NULL REFERENCES manikins(manikin_id),
  trainee_id VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'ended'))
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_status_started
  ON training_sessions (status, started_at DESC);

CREATE TABLE IF NOT EXISTS session_summaries (
  session_id VARCHAR(64) PRIMARY KEY REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  manikin_id VARCHAR(50) NOT NULL REFERENCES manikins(manikin_id),
  trainee_id VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_depth_mm INTEGER NOT NULL DEFAULT 0,
  avg_rate_cpm INTEGER NOT NULL DEFAULT 0,
  recoil_ok_pct INTEGER NOT NULL DEFAULT 0,
  compliance_pct INTEGER,
  hand_placement_pct INTEGER,
  pauses_detected INTEGER,
  longest_pause_sec NUMERIC(4,1)
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_ended
  ON session_summaries (ended_at DESC);
