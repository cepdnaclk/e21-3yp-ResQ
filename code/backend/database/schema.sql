-- USERS TABLE (Instructor / Trainee)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE,
    role VARCHAR(20) CHECK (role IN ('instructor', 'trainee')) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DEVICES TABLE (Manikins / ESP32)
CREATE TABLE devices (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    location VARCHAR(100),
    status VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SESSIONS TABLE (One CPR attempt)
CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    device_id VARCHAR(50) REFERENCES devices(id),

    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,

    session_status VARCHAR(20) DEFAULT 'active',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- COMPRESSIONS TABLE (Core time-series CPR data)
CREATE TABLE compressions (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES sessions(id),
    timestamp TIMESTAMP NOT NULL,

    depth_mm FLOAT NOT NULL,
    rate_cpm FLOAT NOT NULL,
    recoil_complete BOOLEAN NOT NULL,
    pause_duration_ms INT DEFAULT 0
);

-- METRICS SUMMARY TABLE (After-session analytics)
CREATE TABLE metrics_summary (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES sessions(id),

    avg_depth FLOAT,
    avg_rate FLOAT,
    recoil_percentage FLOAT,
    total_pauses INT,
    longest_pause_ms INT,

    score FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);