// tests/integration/authSecurityAudit.test.ts
// Sprint 2.3A - Authentication Security, CSRF Coverage, and Account Lifecycle Audit Suite

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';

const require = createRequire(import.meta.url);
import { getPool, closePool, checkDatabaseHealth } from '../../src/lib/db/pool.ts';
import { migrateUp } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';
import { SessionRepository } from '../../src/lib/db/repositories/sessionRepository.ts';
import { LedgerRepository } from '../../src/lib/db/repositories/ledgerRepository.ts';
import {
  generateRandomToken,
  encryptToken,
} from '../../src/lib/security/crypto.ts';
import {
  formatSessionCookie,
} from '../../src/lib/auth/sessionContext.ts';
import {
  setGitHubAuthClient,
  resetGitHubAuthClient,
  type GitHubAuthClient,
} from '../../src/lib/auth/githubAuth.ts';
import { POST as handlePetAction } from '../../src/app/api/pet/action/route.ts';
import { GET as handleMe } from '../../src/app/api/auth/me/route.ts';
import { POST as handleLogout } from '../../src/app/api/auth/logout/route.ts';
import { POST as handleDisconnect } from '../../src/app/api/auth/disconnect/route.ts';
import { DELETE as handleAccountDelete } from '../../src/app/api/auth/account/route.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

describe('Sprint 2.3A — Security & Account Lifecycle Audit Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      try {
        const EmbeddedPostgres = require('embedded-postgres').default;
        const testDataDir = path.resolve(process.cwd(), '.pgtest_data');

        embeddedInstance = new EmbeddedPostgres({
          databaseDir: testDataDir,
          port: 5432,
          user: 'test_user',
          password: 'test_password',
        });

        if (!fs.existsSync(testDataDir)) {
          await embeddedInstance?.initialise();
        }

        await embeddedInstance?.start();
        try {
          await embeddedInstance?.createDatabase('github_profile_pet_test');
        } catch {
          // Already exists
        }
        health = await checkDatabaseHealth();
      } catch (err) {
        console.warn('[Audit Tests] Failed to boot embedded PostgreSQL:', (err as Error).message);
      }
    }

    isDbAvailable = health.ok;
    if (!isDbAvailable) {
      console.warn('[Audit Tests BLOCKED / SKIPPED]: No database available');
      return;
    }

    pool = getPool();
    await migrateUp();

    // Clean test tables
    await pool.query(`
      TRUNCATE TABLE user_sessions, care_action_idempotency, activity_reward_ledger, daily_sync_states,
                     pet_states, user_profiles, users, github_accounts CASCADE;
    `);
  });

  after(async () => {
    resetGitHubAuthClient();
    if (isDbAvailable) {
      await closePool();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (embeddedInstance) {
      await embeddedInstance.stop();
    }
  });

  test('Area 1: Account deletion leaves strictly zero residual records across all 8 tables', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const testGithubUserId = 'gh_audit_del_target_123';
    const encToken = encryptToken('ghu_synthetic_access_token_for_audit');

    // 1. Create GitHub account, User, Profile, and Pet
    const trainer = await UserRepository.createTrainer({
      githubUserId: testGithubUserId,
      username: 'audit_target_user',
      primaryHandle: 'audit_target_user',
      encryptedAccessToken: encToken,
    });
    const userId = trainer.user.id;
    const accountId = trainer.account.id;

    // 2. Insert records into activity_reward_ledger
    await LedgerRepository.appendEntry({
      userId,
      canonicalActivityId: 'urn:audit:test:act1',
      activityType: 'care_action_train',
      xpAwarded: 30,
      satietyAwarded: 0,
      ruleVersion: 1,
    });

    // 3. Insert record into daily_sync_states
    await pool.query(
      `INSERT INTO daily_sync_states (
        user_id, sync_date, total_contributions_recorded, total_contributions_rewarded,
        total_contributions_forfeited, pending_contribution_increments, daily_activity_xp_awarded
      ) VALUES ($1, '2026-11-15', 5, 5, 0, 0, 60);`,
      [userId]
    );

    // 4. Insert record into care_action_idempotency
    await pool.query(
      `INSERT INTO care_action_idempotency (
        user_id, client_action_id, action_type, response_payload, executed_at
      ) VALUES ($1, 'audit-client-action-1', 'train', '{"success":true}', NOW());`,
      [userId]
    );

    // 5. Insert multiple active sessions into user_sessions
    const tok1 = generateRandomToken(32);
    const tok2 = generateRandomToken(32);
    await SessionRepository.createSession({ userId, rawToken: tok1 });
    await SessionRepository.createSession({ userId, rawToken: tok2 });

    // Verify all 8 tables contain the created records before deletion
    const [accPre, usrPre, profPre, petPre, sessPre, ledgPre, syncPre, idempPre] = await Promise.all([
      pool.query('SELECT count(*) FROM github_accounts WHERE id = $1;', [accountId]),
      pool.query('SELECT count(*) FROM users WHERE id = $1;', [userId]),
      pool.query('SELECT count(*) FROM user_profiles WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM pet_states WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM user_sessions WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM activity_reward_ledger WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM daily_sync_states WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM care_action_idempotency WHERE user_id = $1;', [userId]),
    ]);

    assert.equal(Number(accPre.rows[0].count), 1, 'github_accounts should have 1 record');
    assert.equal(Number(usrPre.rows[0].count), 1, 'users should have 1 record');
    assert.equal(Number(profPre.rows[0].count), 1, 'user_profiles should have 1 record');
    assert.equal(Number(petPre.rows[0].count), 1, 'pet_states should have 1 record');
    assert.equal(Number(sessPre.rows[0].count), 2, 'user_sessions should have 2 records');
    assert.equal(Number(ledgPre.rows[0].count), 1, 'activity_reward_ledger should have 1 record');
    assert.equal(Number(syncPre.rows[0].count), 1, 'daily_sync_states should have 1 record');
    assert.equal(Number(idempPre.rows[0].count), 1, 'care_action_idempotency should have 1 record');

    // 6. Execute account deletion
    const deleted = await UserRepository.deleteAccountCascade(userId);
    assert.equal(deleted, true);

    // 7. Independently query EVERY table to confirm strictly zero residual records
    const [accPost, usrPost, profPost, petPost, sessPost, ledgPost, syncPost, idempPost] = await Promise.all([
      pool.query('SELECT count(*) FROM github_accounts WHERE id = $1;', [accountId]),
      pool.query('SELECT count(*) FROM users WHERE id = $1;', [userId]),
      pool.query('SELECT count(*) FROM user_profiles WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM pet_states WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM user_sessions WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM activity_reward_ledger WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM daily_sync_states WHERE user_id = $1;', [userId]),
      pool.query('SELECT count(*) FROM care_action_idempotency WHERE user_id = $1;', [userId]),
    ]);

    assert.equal(Number(accPost.rows[0].count), 0, 'ZERO residual github_accounts records');
    assert.equal(Number(usrPost.rows[0].count), 0, 'ZERO residual users records');
    assert.equal(Number(profPost.rows[0].count), 0, 'ZERO residual user_profiles records');
    assert.equal(Number(petPost.rows[0].count), 0, 'ZERO residual pet_states records');
    assert.equal(Number(sessPost.rows[0].count), 0, 'ZERO residual user_sessions records');
    assert.equal(Number(ledgPost.rows[0].count), 0, 'ZERO residual activity_reward_ledger records');
    assert.equal(Number(syncPost.rows[0].count), 0, 'ZERO residual daily_sync_states records');
    assert.equal(Number(idempPost.rows[0].count), 0, 'ZERO residual care_action_idempotency records');
  });

  test('Area 1 (Trigger): Direct DELETE on users cascades and purges parent github_accounts', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_audit_direct_user_del',
      username: 'direct_user_del',
      primaryHandle: 'direct_user_del',
    });
    const userId = trainer.user.id;
    const accountId = trainer.account.id;

    // Directly delete user row
    await pool.query('DELETE FROM users WHERE id = $1;', [userId]);

    // Verify trigger purged the parent github_accounts row
    const accCheck = await pool.query('SELECT count(*) FROM github_accounts WHERE id = $1;', [accountId]);
    assert.equal(Number(accCheck.rows[0].count), 0, 'Parent github_accounts record must be purged by trigger');
  });

  test('Area 2: Disconnect with successful provider revocation', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    let revokedTokenReceived: string | null = null;
    const mockClient: GitHubAuthClient = {
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant(token) {
        revokedTokenReceived = token;
        return { success: true, status: 204 };
      },
    };
    setGitHubAuthClient(mockClient);

    const plainToken = 'ghu_disconnect_success_test_token_123';
    const encToken = encryptToken(plainToken);

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_audit_disconnect_success',
      username: 'disconnect_success_user',
      primaryHandle: 'disconnect_success_user',
      encryptedAccessToken: encToken,
    });
    const userId = trainer.user.id;

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    const req = new Request('http://localhost:3000/api/auth/disconnect', {
      method: 'POST',
      headers: {
        'host': 'localhost:3000',
        'origin': 'http://localhost:3000',
        'cookie': cookieHeader,
      },
    });

    const res = await handleDisconnect(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.upstreamRevoked, true);
    assert.equal(revokedTokenReceived, plainToken);

    // Verify DB state: is_disconnected = true, encrypted tokens set to NULL
    const account = await pool.query<{ is_disconnected: boolean; encrypted_access_token: string | null }>(
      'SELECT is_disconnected, encrypted_access_token FROM github_accounts WHERE id = $1;',
      [trainer.account.id]
    );
    assert.equal(account.rows[0].is_disconnected, true);
    assert.equal(account.rows[0].encrypted_access_token, null);

    // Verify User and Pet preserved intact
    const user = await UserRepository.findById(userId);
    assert.ok(user, 'User record must be preserved');
  });

  test('Area 2: Disconnect with provider revocation failure / timeout', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const mockClient: GitHubAuthClient = {
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() {
        return { success: false, status: 504, error: 'Upstream grant revocation timed out' };
      },
    };
    setGitHubAuthClient(mockClient);

    const plainToken = 'ghu_disconnect_fail_test_token_456';
    const encToken = encryptToken(plainToken);

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_audit_disconnect_fail',
      username: 'disconnect_fail_user',
      primaryHandle: 'disconnect_fail_user',
      encryptedAccessToken: encToken,
    });
    const userId = trainer.user.id;

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    const req = new Request('http://localhost:3000/api/auth/disconnect', {
      method: 'POST',
      headers: {
        'host': 'localhost:3000',
        'origin': 'http://localhost:3000',
        'cookie': cookieHeader,
      },
    });

    const res = await handleDisconnect(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.upstreamRevoked, false, 'Must NOT claim upstream revocation succeeded');
    assert.ok(data.upstreamError?.includes('timed out'));
    assert.ok(data.message?.includes('https://github.com/settings/applications'), 'Must include manual remediation link');

    // Verify local credentials still safely purged
    const account = await pool.query<{ is_disconnected: boolean; encrypted_access_token: string | null }>(
      'SELECT is_disconnected, encrypted_access_token FROM github_accounts WHERE id = $1;',
      [trainer.account.id]
    );
    assert.equal(account.rows[0].is_disconnected, true);
    assert.equal(account.rows[0].encrypted_access_token, null);
  });

  test('Area 3: CSRF verification on all 4 state-changing routes', async () => {
    const foreignOrigin = 'https://malicious-attacker.com';

    // Route 1: POST /api/pet/action
    const petReqBad = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: foreignOrigin },
      body: JSON.stringify({ action: 'pet', clientActionId: 'act-1' }),
    });
    const petResBad = await handlePetAction(petReqBad);
    assert.equal(petResBad.status, 403, 'POST /api/pet/action must reject foreign origin with 403');

    // Route 2: POST /api/auth/logout
    const logoutReqBad = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: foreignOrigin },
    });
    const logoutResBad = await handleLogout(logoutReqBad);
    assert.equal(logoutResBad.status, 403, 'POST /api/auth/logout must reject foreign origin with 403');

    // Route 3: POST /api/auth/disconnect
    const disconnReqBad = new Request('http://localhost:3000/api/auth/disconnect', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: foreignOrigin },
    });
    const disconnResBad = await handleDisconnect(disconnReqBad);
    assert.equal(disconnResBad.status, 403, 'POST /api/auth/disconnect must reject foreign origin with 403');

    // Route 4: DELETE /api/auth/account
    const deleteReqBad = new Request('http://localhost:3000/api/auth/account', {
      method: 'DELETE',
      headers: { host: 'localhost:3000', origin: foreignOrigin },
    });
    const deleteResBad = await handleAccountDelete(deleteReqBad);
    assert.equal(deleteResBad.status, 403, 'DELETE /api/auth/account must reject foreign origin with 403');

    // Read-only GET routes do NOT check Origin
    const meReq = new Request('http://localhost:3000/api/auth/me', {
      method: 'GET',
      headers: { origin: foreignOrigin },
    });
    const meRes = await handleMe(meReq);
    assert.notEqual(meRes.status, 403, 'GET /api/auth/me is read-only and must not return 403 CSRF error');
  });

  test('Area 4: Bearer authentication removed; Cookie-Only session enforcement', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_audit_bearer_user',
      username: 'bearer_test_user',
      primaryHandle: 'bearer_test_user',
    });

    const rawToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken });

    // Attempt to authenticate using Authorization: Bearer <rawToken> without Cookie
    const bearerReq = new Request('http://localhost:3000/api/auth/me', {
      headers: {
        'authorization': `Bearer ${rawToken}`,
      },
    });

    const bearerRes = await handleMe(bearerReq);
    assert.equal(bearerRes.status, 401, 'Bearer authorization header MUST be rejected (401)');

    // Authenticate with secure HttpOnly cookie
    const cookieReq = new Request('http://localhost:3000/api/auth/me', {
      headers: {
        'cookie': formatSessionCookie(rawToken),
      },
    });

    const cookieRes = await handleMe(cookieReq);
    assert.equal(cookieRes.status, 200, 'Cookie authorization must succeed (200)');
    const cookieData = await cookieRes.json();
    assert.equal(cookieData.authenticated, true);
    assert.equal(cookieData.user.primaryHandle, 'bearer_test_user');
  });
});
