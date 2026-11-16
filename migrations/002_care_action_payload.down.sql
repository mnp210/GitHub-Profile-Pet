-- Rollback Migration: 002_care_action_payload.down.sql
-- Description: Reverts response_payload column from care_action_idempotency

ALTER TABLE care_action_idempotency
DROP COLUMN IF EXISTS response_payload;
