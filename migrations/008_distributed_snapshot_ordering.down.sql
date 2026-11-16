-- Rollback: 008_distributed_snapshot_ordering.down.sql
-- Description: Removes latest_request_sequence from daily_sync_states and next_snapshot_sequence from users

ALTER TABLE daily_sync_states
DROP COLUMN IF EXISTS latest_request_sequence;

ALTER TABLE users
DROP COLUMN IF EXISTS next_snapshot_sequence;
