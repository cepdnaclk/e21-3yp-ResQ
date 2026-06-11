CREATE TABLE cloud_session_summaries (
    cloud_session_id UUID PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    local_hub_id TEXT NOT NULL,
    local_session_id TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    device_id TEXT NULL,
    manikin_id TEXT NULL,
    trainee_id TEXT NULL,
    instructor_id TEXT NULL,
    session_status TEXT NULL,
    started_at TIMESTAMP WITH TIME ZONE NULL,
    ended_at TIMESTAMP WITH TIME ZONE NULL,
    duration_ms BIGINT NULL,
    total_compressions INTEGER NULL,
    valid_compressions INTEGER NULL,
    avg_depth_mm DOUBLE PRECISION NULL,
    avg_rate_cpm DOUBLE PRECISION NULL,
    recoil_ok_pct DOUBLE PRECISION NULL,
    pause_count INTEGER NULL,
    score DOUBLE PRECISION NULL,
    source TEXT NULL,
    payload_json JSONB NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_cloud_session_summaries_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX idx_cloud_session_summaries_local_identity
    ON cloud_session_summaries (local_hub_id, local_session_id);
CREATE INDEX idx_cloud_session_summaries_device_id
    ON cloud_session_summaries (device_id);
CREATE INDEX idx_cloud_session_summaries_trainee_id
    ON cloud_session_summaries (trainee_id);
CREATE INDEX idx_cloud_session_summaries_received_at
    ON cloud_session_summaries (received_at);
