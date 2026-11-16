-- Migration: 010_background_sync_infrastructure.sql
-- Description: Background contribution sync scheduling, batch fencing, coordination leases, audit tracking, exact receipts, and durable attempt identity

-- 1. Coordination table for global batch fencing
CREATE TABLE IF NOT EXISTS sync_batch_coordination (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active_batch_id UUID NOT NULL,
    active_generation BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed singleton coordination row
INSERT INTO sync_batch_coordination (id, active_batch_id, active_generation)
VALUES (1, '00000000-0000-0000-0000-000000000000', 1)
ON CONFLICT (id) DO NOTHING;

-- 2. Add scheduling and lease coordination columns to users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_sync_attempt_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_sync_success_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS next_sync_eligible_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sync_lock_owner VARCHAR(64) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sync_lock_expires_at TIMESTAMPTZ DEFAULT NULL;

-- Indexes supporting fast discovery and lease cleanup
CREATE INDEX IF NOT EXISTS idx_users_sync_eligibility 
ON users (is_suspended, next_sync_eligible_at, id);

CREATE INDEX IF NOT EXISTS idx_users_sync_lock 
ON users (sync_lock_expires_at) 
WHERE sync_lock_expires_at IS NOT NULL;

-- 3. Durable transaction-attempt identity tracking
CREATE TABLE IF NOT EXISTS sync_transaction_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_sequence BIGINT NOT NULL,
    batch_id UUID NOT NULL,
    sync_date DATE NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    backend_pid INTEGER NOT NULL,
    backend_start TIMESTAMPTZ NOT NULL,
    attempt_status VARCHAR(32) NOT NULL DEFAULT 'dispatched',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    CONSTRAINT uq_attempt_user_sequence UNIQUE (user_id, request_sequence),
    CONSTRAINT chk_attempt_status CHECK (
        attempt_status IN ('dispatched', 'committed', 'rolled_back', 'unknown')
    )
);

CREATE INDEX IF NOT EXISTS idx_attempts_unresolved 
ON sync_transaction_attempts (user_id, attempt_status) 
WHERE attempt_status IN ('dispatched', 'unknown');

CREATE INDEX IF NOT EXISTS idx_attempts_backend 
ON sync_transaction_attempts (backend_pid, backend_start);

-- 4. Exact durable transaction receipts
CREATE TABLE IF NOT EXISTS sync_transaction_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_sequence BIGINT NOT NULL,
    batch_id UUID NOT NULL,
    sync_date DATE NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_receipt_user_sequence UNIQUE (user_id, request_sequence),
    CONSTRAINT chk_receipt_outcome CHECK (outcome IN ('applied', 'no_change', 'stale'))
);

CREATE INDEX IF NOT EXISTS idx_receipts_user_date ON sync_transaction_receipts(user_id, sync_date);
CREATE INDEX IF NOT EXISTS idx_receipts_committed_at ON sync_transaction_receipts(committed_at DESC);

-- 5. Audit table for background sync batch runs
CREATE TABLE IF NOT EXISTS sync_batch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL UNIQUE,
    batch_generation BIGINT NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    accounts_discovered INTEGER NOT NULL DEFAULT 0,
    lease_acquisition_attempts INTEGER NOT NULL DEFAULT 0,
    accounts_attempted INTEGER NOT NULL DEFAULT 0,
    successful_syncs INTEGER NOT NULL DEFAULT 0,
    no_change_syncs INTEGER NOT NULL DEFAULT 0,
    failed_syncs INTEGER NOT NULL DEFAULT 0,
    commit_outcome_unknown INTEGER NOT NULL DEFAULT 0,
    skipped_contended INTEGER NOT NULL DEFAULT 0,
    lease_acquisition_errors INTEGER NOT NULL DEFAULT 0,
    deferred_limit INTEGER NOT NULL DEFAULT 0,
    rate_limited_accounts INTEGER NOT NULL DEFAULT 0,
    reauth_required_accounts INTEGER NOT NULL DEFAULT 0,
    timed_out_accounts INTEGER NOT NULL DEFAULT 0,
    fenced_stale_accounts INTEGER NOT NULL DEFAULT 0,
    pending_rewards_processed INTEGER NOT NULL DEFAULT 0,
    expired_slices_processed INTEGER NOT NULL DEFAULT 0,
    total_xp_awarded INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error_message TEXT,
    CONSTRAINT chk_sync_batch_status CHECK (
        status IN (
            'running', 
            'completed', 
            'partially_completed', 
            'deferred_contention', 
            'failed', 
            'interrupted'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_sync_batch_runs_started ON sync_batch_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_batch_runs_heartbeat ON sync_batch_runs (status, last_heartbeat_at);
