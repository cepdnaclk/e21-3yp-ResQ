-- ResQ Local Hub initial schema
CREATE TABLE IF NOT EXISTS manikins (
  id TEXT PRIMARY KEY,
  mac TEXT UNIQUE NOT NULL,
  name TEXT,
  paired INTEGER DEFAULT 0,
  last_seen DATETIME
);

CREATE TABLE IF NOT EXISTS pairing_tokens (
  token TEXT PRIMARY KEY,
  manikin_id TEXT NOT NULL,
  expires_at DATETIME,
  FOREIGN KEY(manikin_id) REFERENCES manikins(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at DATETIME,
  ended_at DATETIME,
  instructor_id TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS session_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  metric_name TEXT,
  metric_value REAL,
  timestamp DATETIME,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  manikin_id TEXT,
  event_type TEXT,
  timestamp DATETIME,
  details TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(manikin_id) REFERENCES manikins(id)
);

CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  manikin_id TEXT,
  sample_data TEXT,
  timestamp DATETIME,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(manikin_id) REFERENCES manikins(id)
);

CREATE TABLE IF NOT EXISTS trainees (
  id TEXT PRIMARY KEY,
  name TEXT,
  pin TEXT
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  trainee_id TEXT,
  enrolled_at DATETIME,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(trainee_id) REFERENCES trainees(id)
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT,
  entity_id TEXT,
  action TEXT,
  payload TEXT,
  queued_at DATETIME
);