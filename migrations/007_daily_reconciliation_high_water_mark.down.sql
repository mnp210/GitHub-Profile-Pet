-- Rollback: 007_daily_reconciliation_high_water_mark.down.sql
-- Description: Removes latest_observed_contributions and latest_observed_at columns from daily_sync_states

ALTER TABLE daily_sync_states
DROP CONSTRAINT IF EXISTS chk_latest_observed_non_negative;

ALTER TABLE daily_sync_states
DROP COLUMN IF EXISTS latest_observed_contributions,
DROP COLUMN IF EXISTS latest_observed_at;
