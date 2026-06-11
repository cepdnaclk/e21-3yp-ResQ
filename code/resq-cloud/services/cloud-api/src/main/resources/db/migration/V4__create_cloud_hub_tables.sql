-- V4: Hub API key authentication tables for LocalHub roster pull (Phase 1)
--
-- cloud_hub_api_keys:
--   Stores registered LocalHub instances with a BCrypt-hashed API key.
--   Only the hash is stored - plaintext key is never persisted.
--
-- cloud_hub_course_assignments:
--   Optional scoping of a hub to specific courses.
--   If a hub has NO rows here, the roster endpoint returns ALL active
--   courses/users/enrollments (acceptable for MVP/dev - see CloudRosterSyncService).
--   If a hub HAS rows here, only assigned active courses are returned.

CREATE TABLE cloud_hub_api_keys (
    hub_id          TEXT        NOT NULL PRIMARY KEY,
    hub_name        TEXT        NULL,
    key_hash        TEXT        NOT NULL,
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMP WITH TIME ZONE NULL
);

CREATE INDEX idx_cloud_hub_api_keys_active ON cloud_hub_api_keys (active);

CREATE TABLE cloud_hub_course_assignments (
    hub_id      TEXT    NOT NULL REFERENCES cloud_hub_api_keys(hub_id),
    course_id   UUID    NOT NULL REFERENCES cloud_courses(course_id),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (hub_id, course_id)
);

CREATE INDEX idx_cloud_hub_course_assignments_hub ON cloud_hub_course_assignments (hub_id, active);
