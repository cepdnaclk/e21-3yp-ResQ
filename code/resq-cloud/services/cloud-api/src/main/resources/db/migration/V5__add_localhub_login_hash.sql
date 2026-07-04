-- V5: Add localhub login hash to cloud_users (Phase 3A)
-- This allows cloud admins to set LocalHub offline passwords, which are synced to LocalHubs.
ALTER TABLE cloud_users ADD COLUMN local_login_hash TEXT NULL;
