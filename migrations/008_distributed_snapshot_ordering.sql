-- Migration: 008_distributed_snapshot_ordering.sql
-- Description: Adds next_snapshot_sequence to users and latest_request_sequence to daily_sync_states for clock-skew proof distributed request ordering

ALTER TABLE users
ADD COLUMN IF NOT EXISTS next_snapshot_sequence BIGINT NOT NULL DEFAULT 0;

ALTER TABLE daily_sync_states
ADD COLUMN IF NOT EXISTS latest_request_sequence BIGINT NOT NULL DEFAULT 0;
