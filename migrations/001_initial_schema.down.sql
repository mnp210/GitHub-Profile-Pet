-- Migration Rollback: 001_initial_schema.down.sql
-- Description: Reversible rollback for 001_initial_schema.sql

DROP TABLE IF EXISTS care_action_idempotency CASCADE;
DROP TABLE IF EXISTS daily_sync_states CASCADE;
DROP TABLE IF EXISTS activity_reward_ledger CASCADE;
DROP TABLE IF EXISTS pet_states CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS github_accounts CASCADE;
