-- Migration: 006_refresh_token_rotation_recovery.sql
-- Description: Adds token_refresh_status, token_refresh_dispatched_at, and token_refresh_dispatched_version to github_accounts for fail-closed refresh rotation recovery and token replay prevention

ALTER TABLE github_accounts
ADD COLUMN IF NOT EXISTS token_refresh_status VARCHAR(32) NOT NULL DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS token_refresh_dispatched_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS token_refresh_dispatched_version INTEGER;
