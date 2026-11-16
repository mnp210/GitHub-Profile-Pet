-- Migration: 009_contribution_reward_accounting.sql
-- Description: Durable contribution increment slices with explicit lifecycle states and payload conflict detection

CREATE TABLE IF NOT EXISTS contribution_increment_slices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sync_date DATE NOT NULL,
    canonical_slice_id VARCHAR(255) NOT NULL,
    slice_start INTEGER NOT NULL,
    slice_end INTEGER NOT NULL,
    increment_count INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    request_sequence BIGINT NOT NULL,
    payload_hash VARCHAR(64) DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT uq_user_slice_id UNIQUE (user_id, canonical_slice_id),
    CONSTRAINT chk_slice_bounds CHECK (slice_start >= 0 AND slice_end > slice_start),
    CONSTRAINT chk_increment_count CHECK (increment_count = (slice_end - slice_start)),
    CONSTRAINT chk_slice_status CHECK (status IN ('pending', 'rewarded', 'forfeited', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_slices_user_status_date ON contribution_increment_slices(user_id, status, sync_date ASC, slice_start ASC);
CREATE INDEX IF NOT EXISTS idx_slices_user_processed_at ON contribution_increment_slices(user_id, processed_at DESC);

ALTER TABLE daily_sync_states
ADD COLUMN IF NOT EXISTS latest_payload_hash VARCHAR(64) DEFAULT NULL;
