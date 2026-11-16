-- Rollback: 004_account_cleanup_trigger.down.sql
-- Description: Drop account cleanup trigger and function

DROP TRIGGER IF EXISTS trg_delete_user_github_account ON users;
DROP FUNCTION IF EXISTS purge_orphaned_github_account();
