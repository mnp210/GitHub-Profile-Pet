-- Rollback: 005_token_refresh_concurrency.down.sql
-- Description: Removes token_refresh_locked_at, token_refresh_owner, and token_version columns from github_accounts

ALTER TABLE github_accounts
DROP COLUMN IF EXISTS token_refresh_locked_at,
DROP COLUMN IF EXISTS token_refresh_owner,
DROP COLUMN IF EXISTS token_version;
