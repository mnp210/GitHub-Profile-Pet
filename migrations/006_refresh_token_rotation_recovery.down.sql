-- Rollback: 006_refresh_token_rotation_recovery.down.sql
-- Description: Removes token_refresh_status, token_refresh_dispatched_at, and token_refresh_dispatched_version from github_accounts

ALTER TABLE github_accounts
DROP COLUMN IF EXISTS token_refresh_status,
DROP COLUMN IF EXISTS token_refresh_dispatched_at,
DROP COLUMN IF EXISTS token_refresh_dispatched_version;
