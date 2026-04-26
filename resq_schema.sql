-- ResQ Database Schema (PostgreSQL)

-- =========================
-- 1. USERS TABLE
-- =========================
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    role TEXT CHECK (role IN ('instructor', 'trainee')) NOT NULL,
    email TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- 2. DEVICES TABLE (TORSOS)
-- =========================
CREATE TABLE devices (
    device_id SERIAL PRIMARY KEY,
    device_name TEXT NOT NULL,
    mac_address TEXT UNIQUE,
    mqtt_topic TEXT,
    location TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- 3. SESSIONS TABLE
-- =========================
CREATE TABLE sessions (
    session_id SERIAL PRIMARY KEY,
    trainee_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    instructor_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    device_id INTEGER REFERENCES devices(device_id) ON DELETE SET NULL,
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    notes TEXT
);

-- =========================
-- 4. COMPRESSION EVENTS
-- =========================
CREATE TABLE compression_events (
    event_id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(session_id) ON DELETE CASCADE,
    compression_no INTEGER NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    depth_mm FLOAT,
    rate_cpm FLOAT,
    recoil_ok BOOLEAN,
    recoil_mm FLOAT,
    hand_ok BOOLEAN
);

-- =========================
-- 5. PAUSE EVENTS
-- =========================
CREATE TABLE pause_events (
    pause_id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(session_id) ON DELETE CASCADE,
    pause_start TIMESTAMP NOT NULL,
    pause_end TIMESTAMP,
    duration_ms INTEGER,
    pause_type TEXT
);

-- =========================
-- 6. SESSION METRICS (SUMMARY)
-- =========================
CREATE TABLE session_metrics (
    session_id INTEGER PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
    avg_depth_mm FLOAT,
    avg_rate_cpm FLOAT,
    recoil_success_pct FLOAT,
    pause_count INTEGER,
    total_pause_s FLOAT,
    score FLOAT
);