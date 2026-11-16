-- Migration: 004_account_cleanup_trigger.sql
-- Description: Bidirectional integrity trigger guaranteeing github_accounts cleanup when users is deleted

CREATE OR REPLACE FUNCTION purge_orphaned_github_account()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM github_accounts WHERE id = OLD.github_account_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_user_github_account ON users;

CREATE TRIGGER trg_delete_user_github_account
AFTER DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION purge_orphaned_github_account();
