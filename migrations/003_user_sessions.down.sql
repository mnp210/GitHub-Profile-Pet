-- Rollback: 003_user_sessions.down.sql
-- Description: Drop user_sessions table and indexes

DROP TABLE IF EXISTS user_sessions CASCADE;
