-- Migration: 005_token_refresh_concurrency.sql
-- Description: Adds token_refresh_locked_at, token_refresh_owner (fencing token), and token_version to github_accounts for distributed token refresh serialization and stale-worker fencing

ALTER TABLE github_accounts
ADD COLUMN IF NOT EXISTS token_refresh_locked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS token_refresh_owner VARCHAR(64),
ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
