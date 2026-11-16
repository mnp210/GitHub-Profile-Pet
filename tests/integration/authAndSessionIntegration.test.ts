// tests/integration/authAndSessionIntegration.test.ts
// Real PostgreSQL 16+ Integration Suite for Persistent Sessions, GitHub OAuth Lifecycle, and Account Security

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';

const require = createRequire(import.meta.url);
import { getPool, closePool, checkDatabaseHealth, maskConnectionString } from '../../src/lib/db/pool.ts';
import { migrateUp, migrateDown } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';
import { SessionRepository } from '../../src/lib/db/repositories/sessionRepository.ts';
import {
  generateRandomToken,
  hashSessionToken,
  decryptToken,
} from '../../src/lib/security/crypto.ts';
import {
  formatSessionCookie,
  formatOAuthStateCookie,
  SESSION_COOKIE_NAME,
} from '../../src/lib/auth/sessionContext.ts';
import {
  setGitHubAuthClient,
  resetGitHubAuthClient,
  type GitHubAuthClient,
} from '../../src/lib/auth/githubAuth.ts';
import { GET as handleCallback } from '../../src/app/api/auth/callback/route.ts';
import { GET as handleMe } from '../../src/app/api/auth/me/route.ts';
import { GET as handleSession } from '../../src/app/api/auth/session/route.ts';
import { POST as handleLogout } from '../../src/app/api/auth/logout/route.ts';
import { POST as handleDisconnect } from '../../src/app/api/auth/disconnect/route.ts';
import { DELETE as handleAccountDelete } from '../../src/app/api/auth/account/route.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

describe('GitHub Authentication & Persistent Sessions Integration Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('[Auth Tests] No active database on 5432. Starting local PostgreSQL 16...');
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
        console.warn('[Auth Tests] Failed to boot embedded PostgreSQL:', (err as Error).message);
      }
    }

    isDbAvailable = health.ok;
    if (!isDbAvailable) {
      console.warn('[Auth Tests BLOCKED / SKIPPED]: No database at ' + maskConnectionString(TEST_DB_URL));
      return;
    }

    pool = getPool();
    // Ensure all migrations up to 003 are applied
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
      console.log('[Auth Tests Cleanup] Stopping local PostgreSQL 16...');
      await embeddedInstance.stop();
    }
  });

  test('1. Migration 003 up and down lifecycle for user_sessions', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    // Rollback migrations until migration 003 is reverted
    let lastReverted: string | null = null;
    while (true) {
      const down = await migrateDown();
      lastReverted = down.reverted;
      if (!down.reverted || down.reverted === '003_user_sessions.sql') break;
    }
    assert.equal(lastReverted, '003_user_sessions.sql');

    // Verify user_sessions table was dropped
    const tableCheck1 = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'user_sessions';`
    );
    assert.equal(tableCheck1.rows.length, 0, 'user_sessions table should be dropped after down-migration');

    // Re-apply migration 003
    const upResult = await migrateUp();
    assert.ok(upResult.applied.includes('003_user_sessions.sql'), 'Migration 003 should re-apply cleanly');

    // Verify table and indexes exist
    const tableCheck2 = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'user_sessions';`
    );
    assert.equal(tableCheck2.rows.length, 1, 'user_sessions table should exist after up-migration');
  });

  test('2. Session creation, token hashing, and active session retrieval', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_auth_session_user_1',
      username: 'session_trainer_1',
      primaryHandle: 'session_trainer_1',
    });
    const userId = trainer.user.id;

    const rawToken = generateRandomToken(32);
    const expectedHash = hashSessionToken(rawToken);

    // Create session
    const session = await SessionRepository.createSession({
      userId,
      rawToken,
      ttlSeconds: 3600,
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 TestRunner',
    });

    assert.ok(session.id);
    assert.equal(session.session_token_hash, expectedHash);
    assert.equal(session.user_id, userId);

    // Verify row in database holds only hash, NEVER raw token
    const dbRow = await pool.query<{ session_token_hash: string }>(
      'SELECT session_token_hash FROM user_sessions WHERE id = $1;',
      [session.id]
    );
    assert.equal(dbRow.rows[0].session_token_hash, expectedHash);
    assert.notEqual(dbRow.rows[0].session_token_hash, rawToken);

    // Retrieve via findActiveSession
    const active = await SessionRepository.findActiveSession(rawToken);
    assert.ok(active);
    assert.equal(active.user.id, userId);
    assert.equal(active.account.username, 'session_trainer_1');
    assert.equal(active.pet.name, 'Shadow Claw');

    // Querying with wrong token returns null
    const invalid = await SessionRepository.findActiveSession('completely_wrong_token_123');
    assert.equal(invalid, null);
  });

  test('3. Session touch throttled activity tracking', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_auth_touch_user',
      username: 'touch_trainer',
      primaryHandle: 'touch_trainer',
    });

    const rawToken = generateRandomToken(32);
    const session = await SessionRepository.createSession({
      userId: trainer.user.id,
      rawToken,
    });

    // Manually backdate last_active_at by 15 minutes
    await pool.query(
      `UPDATE user_sessions SET last_active_at = NOW() - INTERVAL '15 minutes' WHERE id = $1;`,
      [session.id]
    );

    // Touch session
    await SessionRepository.touchSession(session.id);

    const updated = await pool.query<{ last_active_at: Date }>(
      'SELECT last_active_at FROM user_sessions WHERE id = $1;',
      [session.id]
    );
    const diffMs = Date.now() - new Date(updated.rows[0].last_active_at).getTime();
    assert.ok(diffMs < 5000, 'last_active_at should be updated to current time');
  });

  test('4. Session revocation (Logout) invalidates session immediately', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_auth_revoke_user',
      username: 'revoke_trainer',
      primaryHandle: 'revoke_trainer',
    });

    const rawToken = generateRandomToken(32);
    await SessionRepository.createSession({
      userId: trainer.user.id,
      rawToken,
    });

    // Before revocation: active
    const before = await SessionRepository.findActiveSession(rawToken);
    assert.ok(before);

    // Revoke
    const revoked = await SessionRepository.revokeSession(rawToken);
    assert.equal(revoked, true);

    // After revocation: null
    const after = await SessionRepository.findActiveSession(rawToken);
    assert.equal(after, null, 'Revoked session must not be active');
  });

  test('5. Session expiration: expired sessions return null', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_auth_expired_user',
      username: 'expired_trainer',
      primaryHandle: 'expired_trainer',
    });

    const rawToken = generateRandomToken(32);
    const session = await SessionRepository.createSession({
      userId: trainer.user.id,
      rawToken,
    });

    // Backdate expires_at into the past
    await pool.query(
      `UPDATE user_sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1;`,
      [session.id]
    );

    const active = await SessionRepository.findActiveSession(rawToken);
    assert.equal(active, null, 'Expired session must return null');
  });

  test('6. Multiple concurrent sessions and revokeAllUserSessions', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_auth_multi_user',
      username: 'multi_trainer',
      primaryHandle: 'multi_trainer',
    });
    const userId = trainer.user.id;

    const desktopToken = generateRandomToken(32);
    const mobileToken = generateRandomToken(32);

    await SessionRepository.createSession({ userId, rawToken: desktopToken });
    await SessionRepository.createSession({ userId, rawToken: mobileToken });

    assert.ok(await SessionRepository.findActiveSession(desktopToken));
    assert.ok(await SessionRepository.findActiveSession(mobileToken));

    // Revoke desktop only
    await SessionRepository.revokeSession(desktopToken);
    assert.equal(await SessionRepository.findActiveSession(desktopToken), null);
    assert.ok(await SessionRepository.findActiveSession(mobileToken), 'Mobile session must remain active');

    // Revoke all
    const revokedCount = await SessionRepository.revokeAllUserSessions(userId);
    assert.ok(revokedCount >= 1);
    assert.equal(await SessionRepository.findActiveSession(mobileToken), null);
  });

  test('7. Cascading Account Deletion automatically destroys all user sessions', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_auth_del_cascade',
      username: 'del_cascade_trainer',
      primaryHandle: 'del_cascade_trainer',
    });
    const userId = trainer.user.id;

    const rawToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId, rawToken });

    assert.ok(await SessionRepository.findActiveSession(rawToken));

    // Delete user account cascade
    const deleted = await UserRepository.deleteAccountCascade(userId);
    assert.equal(deleted, true);

    // Verify session row is purged by foreign key cascade
    const sessionRows = await pool.query('SELECT * FROM user_sessions WHERE user_id = $1;', [userId]);
    assert.equal(sessionRows.rows.length, 0, 'All session rows must be cascaded on account deletion');
  });

  test('8. End-to-End OAuth Callback: New user registration with token encryption', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const mockAccessToken = 'ghu_mock_access_token_octonew_123';
    const mockRefreshToken = 'ghr_mock_refresh_token_octonew_456';

    const mockGitHubClient: GitHubAuthClient = {
      async exchangeCode(code, redirectUri) {
        void code;
        void redirectUri;
        return {
          accessToken: mockAccessToken,
          refreshToken: mockRefreshToken,
          expiresIn: 28800, // 8 hours
          refreshTokenExpiresIn: 15811200, // 6 months
          tokenType: 'bearer',
          scope: '',
        };
      },
      async fetchUser(accessToken) {
        void accessToken;
        return {
          id: 99887766,
          login: 'octonew_dev',
          name: 'Octo Developer',
          avatar_url: 'https://avatars.githubusercontent.com/u/99887766',
        };
      },
      async revokeGrant(token) {
        void token;
        return { success: true, status: 204 };
      },
    };

    setGitHubAuthClient(mockGitHubClient);

    const state = generateRandomToken(32);
    const callbackReq = new Request(
      `http://localhost:3000/api/auth/callback?code=mock_code_123&state=${state}`,
      {
        headers: {
          'cookie': formatOAuthStateCookie(state),
        },
      }
    );

    const response = await handleCallback(callbackReq);
    assert.equal(response.status, 302);

    // Verify Set-Cookie header contains pet_session
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie?.includes(SESSION_COOKIE_NAME));

    // Verify user created in PostgreSQL
    const trainer = await UserRepository.findByGitHubUserId('99887766');
    assert.ok(trainer);
    assert.equal(trainer.user.primary_handle, 'octonew_dev');
    assert.equal(trainer.pet.name, 'Shadow Claw');

    // Verify tokens are stored encrypted at rest
    assert.ok(trainer.account.encrypted_access_token?.startsWith('v1:'));
    assert.ok(trainer.account.encrypted_refresh_token?.startsWith('v1:'));
    assert.notEqual(trainer.account.encrypted_access_token, mockAccessToken);

    // Verify decryption restores exact original tokens
    const decryptedAccess = decryptToken(trainer.account.encrypted_access_token!);
    const decryptedRefresh = decryptToken(trainer.account.encrypted_refresh_token!);
    assert.equal(decryptedAccess, mockAccessToken);
    assert.equal(decryptedRefresh, mockRefreshToken);
  });

  test('9. End-to-End OAuth Callback: Existing user handle rename with stable identity', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    // User logs in again, but GitHub username has changed to octonew_renamed
    const mockGitHubClient: GitHubAuthClient = {
      async exchangeCode(code, redirectUri) {
        void code;
        void redirectUri;
        return {
          accessToken: 'ghu_new_refreshed_access_token',
          refreshToken: 'ghr_new_refreshed_refresh_token',
          expiresIn: 28800,
          tokenType: 'bearer',
          scope: '',
        };
      },
      async fetchUser(accessToken) {
        void accessToken;
        return {
          id: 99887766, // Identical numeric ID
          login: 'octonew_renamed', // Renamed login handle
          name: 'Octo Developer Renamed',
          avatar_url: 'https://avatars.githubusercontent.com/u/99887766',
        };
      },
      async revokeGrant(token) {
        void token;
        return { success: true, status: 204 };
      },
    };

    setGitHubAuthClient(mockGitHubClient);

    const state = generateRandomToken(32);
    const callbackReq = new Request(
      `http://localhost:3000/api/auth/callback?code=rename_code_456&state=${state}`,
      {
        headers: {
          'cookie': formatOAuthStateCookie(state),
        },
      }
    );

    const response = await handleCallback(callbackReq);
    assert.equal(response.status, 302);

    // Verify trainer handle was updated without duplicate user creation
    const trainer = await UserRepository.findByGitHubUserId('99887766');
    assert.ok(trainer);
    assert.equal(trainer.user.primary_handle, 'octonew_renamed');
    assert.equal(trainer.account.username, 'octonew_renamed');

    // Decrypt refreshed access token
    assert.equal(decryptToken(trainer.account.encrypted_access_token!), 'ghu_new_refreshed_access_token');
  });

  test('10. API Route Contract: /api/auth/me, /api/auth/session, and /api/auth/logout', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_api_route_test_user',
      username: 'api_test_trainer',
      primaryHandle: 'api_test_trainer',
    });

    const rawToken = generateRandomToken(32);
    await SessionRepository.createSession({
      userId: trainer.user.id,
      rawToken,
    });

    const cookieHeader = formatSessionCookie(rawToken);

    // 1. /api/auth/me with session cookie
    const meReq = new Request('http://localhost:3000/api/auth/me', {
      headers: { cookie: cookieHeader },
    });
    const meRes = await handleMe(meReq);
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.authenticated, true);
    assert.equal(meData.user.primaryHandle, 'api_test_trainer');
    assert.equal(meData.pet.name, 'Shadow Claw');

    // 2. /api/auth/session
    const sessionReq = new Request('http://localhost:3000/api/auth/session', {
      headers: { cookie: cookieHeader },
    });
    const sessionRes = await handleSession(sessionReq);
    assert.equal(sessionRes.status, 200);
    const sessionData = await sessionRes.json();
    assert.equal(sessionData.authenticated, true);
    assert.equal(sessionData.session.handle, 'api_test_trainer');

    // 3. /api/auth/logout
    const logoutReq = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        'host': 'localhost:3000',
        'origin': 'http://localhost:3000',
        'cookie': cookieHeader,
      },
    });
    const logoutRes = await handleLogout(logoutReq);
    assert.equal(logoutRes.status, 200);
    const logoutData = await logoutRes.json();
    assert.equal(logoutData.success, true);

    // 4. Subsequent /api/auth/me must return 401
    const meAfterLogout = await handleMe(meReq);
    assert.equal(meAfterLogout.status, 401);
  });

  test('11. Account Disconnect and Full Account Deletion API with Upstream Revocation', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    let upstreamRevocationAttempted = false;
    const mockGitHubClient: GitHubAuthClient = {
      async exchangeCode() {
        throw new Error('Not implemented');
      },
      async fetchUser() {
        throw new Error('Not implemented');
      },
      async revokeGrant(token) {
        if (token === 'ghu_active_token_to_revoke') {
          upstreamRevocationAttempted = true;
          return { success: true, status: 204 };
        }
        return { success: false, status: 400 };
      },
    };
    setGitHubAuthClient(mockGitHubClient);

    const { encryptToken } = await import('../../src/lib/security/crypto.ts');
    const encToken = encryptToken('ghu_active_token_to_revoke');

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_auth_lifecycle_final',
      username: 'lifecycle_trainer',
      primaryHandle: 'lifecycle_trainer',
      encryptedAccessToken: encToken,
    });

    const rawToken = generateRandomToken(32);
    await SessionRepository.createSession({
      userId: trainer.user.id,
      rawToken,
    });
    const cookieHeader = formatSessionCookie(rawToken);

    // 1. Disconnect
    const disconnectReq = new Request('http://localhost:3000/api/auth/disconnect', {
      method: 'POST',
      headers: {
        'host': 'localhost:3000',
        'origin': 'http://localhost:3000',
        'cookie': cookieHeader,
      },
    });
    const disconnectRes = await handleDisconnect(disconnectReq);
    assert.equal(disconnectRes.status, 200);

    const disconnectedAccount = await UserRepository.findByGitHubUserId('gh_auth_lifecycle_final');
    assert.equal(disconnectedAccount?.account.is_disconnected, true);
    assert.equal(disconnectedAccount?.account.encrypted_access_token, null);

    // 2. Re-attach encrypted token for delete test
    await UserRepository.updateTokens(disconnectedAccount!.account.id, encToken);

    // 3. Full Account Deletion
    const deleteReq = new Request('http://localhost:3000/api/auth/account', {
      method: 'DELETE',
      headers: {
        'host': 'localhost:3000',
        'origin': 'http://localhost:3000',
        'cookie': cookieHeader,
      },
    });
    const deleteRes = await handleAccountDelete(deleteReq);
    assert.equal(deleteRes.status, 200);
    const deleteData = await deleteRes.json();
    assert.equal(deleteData.success, true);
    assert.equal(deleteData.upstreamRevoked, true);
    assert.equal(upstreamRevocationAttempted, true);

    // Verify completely deleted
    const checkDeleted = await UserRepository.findByGitHubUserId('gh_auth_lifecycle_final');
    assert.equal(checkDeleted, null);
  });
});
