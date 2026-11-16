-- Rollback: 009_contribution_reward_accounting.down.sql
-- Description: Removes contribution_increment_slices and latest_payload_hash column

ALTER TABLE daily_sync_states
DROP COLUMN IF EXISTS latest_payload_hash;

DROP TABLE IF EXISTS contribution_increment_slices;
