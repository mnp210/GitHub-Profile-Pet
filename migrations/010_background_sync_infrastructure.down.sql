-- Migration: 010_background_sync_infrastructure.down.sql
-- Description: Rollback script for Sprint 2.5 background sync infrastructure

DROP TABLE IF EXISTS sync_batch_runs;
DROP TABLE IF EXISTS sync_transaction_receipts;
DROP TABLE IF EXISTS sync_transaction_attempts;
DROP TABLE IF EXISTS sync_batch_coordination;
DROP INDEX IF EXISTS idx_users_sync_eligibility;
DROP INDEX IF EXISTS idx_users_sync_lock;

ALTER TABLE users
DROP COLUMN IF EXISTS last_sync_attempt_at,
DROP COLUMN IF EXISTS last_sync_success_at,
DROP COLUMN IF EXISTS next_sync_eligible_at,
DROP COLUMN IF EXISTS sync_lock_owner,
DROP COLUMN IF EXISTS sync_lock_expires_at;
