-- Migration: 002_care_action_payload.sql
-- Description: Adds response_payload JSONB column to care_action_idempotency for exact retry serialization

ALTER TABLE care_action_idempotency
ADD COLUMN IF NOT EXISTS response_payload JSONB;
