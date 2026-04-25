-- Runtime tables powering the instructor hub dashboard from PostgreSQL.

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
  flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);

CREATE TABLE IF NOT EXISTS training_sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  manikin_id VARCHAR(50) NOT NULL REFERENCES manikins(manikin_id),
  trainee_id VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'ended'))
);

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
  compliance_pct INTEGER NOT NULL DEFAULT 0,
  hand_placement_pct INTEGER,
  pauses_detected INTEGER,
  longest_pause_sec NUMERIC(4,1)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_manikin_recorded_at
  ON manikin_telemetry_samples (manikin_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_sessions_status_started
  ON training_sessions (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_summaries_ended
  ON session_summaries (ended_at DESC);

-- Seed starter manikins.
INSERT INTO manikins (manikin_id, manikin_name, connection_status, battery_level, is_active)
VALUES
  ('manikin-01', 'Manikin Alpha', 'online', 87, TRUE),
  ('manikin-02', 'Manikin Bravo', 'online', 64, TRUE),
  ('manikin-03', 'Manikin Charlie', 'online', 92, TRUE),
  ('manikin-04', 'Manikin Delta', 'degraded', 38, TRUE)
ON CONFLICT (manikin_id)
DO UPDATE SET
  manikin_name = EXCLUDED.manikin_name,
  connection_status = EXCLUDED.connection_status,
  battery_level = EXCLUDED.battery_level,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Seed recent telemetry (replace these with your hub ingestor pipeline).
INSERT INTO manikin_telemetry_samples (
  manikin_id,
  recorded_at,
  depth_mm,
  rate_cpm,
  recoil_ok,
  pauses,
  battery_level,
  connection_status,
  flags
)
VALUES
  ('manikin-01', NOW(), 52, 110, TRUE, 1, 87, 'online', ARRAY['On target']),
  ('manikin-02', NOW(), 47, 103, FALSE, 3, 64, 'online', ARRAY['Depth low', 'Recoil lag']),
  ('manikin-03', NOW(), 55, 114, TRUE, 0, 92, 'online', ARRAY['Stable']),
  ('manikin-04', NOW(), 49, 98, FALSE, 2, 38, 'degraded', ARRAY['Battery low']);
