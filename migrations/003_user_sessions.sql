-- Migration: 003_user_sessions.sql
-- Description: Server-managed persistent user sessions with cryptographic token hashing

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Fast lookup for active sessions by token hash
CREATE INDEX idx_user_sessions_lookup ON user_sessions(session_token_hash) WHERE revoked_at IS NULL;

-- Fast index for user session management and cascading
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
