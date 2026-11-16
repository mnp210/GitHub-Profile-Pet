-- Migration: 007_daily_reconciliation_high_water_mark.sql
-- Description: Adds latest_observed_contributions and latest_observed_at to daily_sync_states to distinguish latest observed count from monotonic high-water mark and ensure reliable snapshot ordering

ALTER TABLE daily_sync_states
ADD COLUMN IF NOT EXISTS latest_observed_contributions INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS latest_observed_at TIMESTAMPTZ DEFAULT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_latest_observed_non_negative'
    ) THEN
        ALTER TABLE daily_sync_states
        ADD CONSTRAINT chk_latest_observed_non_negative CHECK (latest_observed_contributions >= 0);
    END IF;
END $$;
