ALTER TABLE cloud_users
    ADD COLUMN password_hash TEXT NULL;

ALTER TABLE cloud_users
    ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE NULL;

ALTER TABLE cloud_users
    ADD COLUMN password_updated_at TIMESTAMP WITH TIME ZONE NULL;
