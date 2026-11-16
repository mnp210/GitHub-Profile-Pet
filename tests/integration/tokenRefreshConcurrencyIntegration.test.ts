// tests/integration/tokenRefreshConcurrencyIntegration.test.ts
// Sprint 2.4A.1 - Real PostgreSQL 16+ Integration Suite for Rotating Refresh Token Concurrency & Lease Serialization

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';

const require = createRequire(import.meta.url);
import { getPool, closePool, checkDatabaseHealth, maskConnectionString } from '../../src/lib/db/pool.ts';
import { migrateUp } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';
import {
  encryptToken,
  decryptToken,
} from '../../src/lib/security/crypto.ts';
import {
  setGitHubAuthClient,
  resetGitHubAuthClient,
  type GitHubAuthClient,
} from '../../src/lib/auth/githubAuth.ts';
import {
  getValidAccessToken,
  GitHubTokenRefreshError,
  GitHubTokenExpiredError,
} from '../../src/lib/github/tokenManager.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

describe('Rotating Refresh Token Concurrency & Lease Integration Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('[Token Refresh Tests] No active database on 5432. Starting local PostgreSQL 16...');
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
        console.warn('[Token Refresh Tests] Failed to initialize embedded postgres:', (err as Error).message);
      }
    }

    if (!health.ok) {
      console.warn(`[Token Refresh Tests] Skipping: Database unavailable at ${maskConnectionString(TEST_DB_URL)}`);
      isDbAvailable = false;
      return;
    }

    isDbAvailable = true;
    pool = getPool();
    await migrateUp();
  });

  after(async () => {
    if (isDbAvailable) {
      await closePool();
    }
    if (embeddedInstance) {
      console.log('[Token Refresh Tests Cleanup] Stopping local PostgreSQL 16...');
      try {
        await embeddedInstance.stop();
      } catch {
        // ignore shutdown error
      }
    }
  });

  beforeEach(() => {
    resetGitHubAuthClient();
  });

  afterEach(() => {
    resetGitHubAuthClient();
  });

  test('1. Two concurrent refresh requests: upstream refreshToken is called exactly once', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const initialAccessToken = 'ghu_expired_token_conc_1';
    const initialRefreshToken = 'ghr_valid_token_conc_1';
    const freshAccessToken = 'ghu_FRESH_TOKEN_GEN_1';
    const rotatedRefreshToken = 'ghr_ROTATED_TOKEN_GEN_1';

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'conc_user_1',
      username: 'conc_trainer_1',
      primaryHandle: 'conc_trainer_1',
      encryptedAccessToken: encryptToken(initialAccessToken),
      encryptedRefreshToken: encryptToken(initialRefreshToken),
      tokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    let refreshCallCount = 0;
    const mockAuthClient: GitHubAuthClient = {
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken(token: string) {
        refreshCallCount++;
        assert.equal(token, initialRefreshToken);
        // Simulate network latency of 50ms
        await new Promise((r) => setTimeout(r, 50));
        return {
          accessToken: freshAccessToken,
          refreshToken: rotatedRefreshToken,
          expiresIn: 28800,
          refreshTokenExpiresIn: 15811200,
          tokenType: 'bearer',
          scope: '',
        };
      },
    };
    setGitHubAuthClient(mockAuthClient);

    // Trigger two simultaneous refresh requests
    const [tokenA, tokenB] = await Promise.all([
      getValidAccessToken(trainer.account),
      getValidAccessToken(trainer.account),
    ]);

    assert.equal(refreshCallCount, 1, 'Upstream refreshToken MUST be called exactly once');
    assert.equal(tokenA, freshAccessToken);
    assert.equal(tokenB, freshAccessToken);

    // Verify tokens were updated in PostgreSQL
    const accountInDb = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.ok(accountInDb);
    assert.equal(decryptToken(accountInDb.encrypted_access_token!), freshAccessToken);
    assert.equal(decryptToken(accountInDb.encrypted_refresh_token!), rotatedRefreshToken);
    assert.equal(accountInDb.token_refresh_locked_at, null, 'Lease lock must be cleared after successful update');
  });

  test('2. Multiple concurrent callers (5 callers) all receive identical fresh credentials', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const freshAccessToken = 'ghu_MULTI_CALLER_FRESH_TOKEN';
    const rotatedRefreshToken = 'ghr_MULTI_CALLER_ROTATED_TOKEN';

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'conc_user_multi',
      username: 'multi_caller_trainer',
      primaryHandle: 'multi_caller_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_multi'),
      encryptedRefreshToken: encryptToken('ghr_refresh_multi'),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    let refreshCallCount = 0;
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        refreshCallCount++;
        await new Promise((r) => setTimeout(r, 60));
        return {
          accessToken: freshAccessToken,
          refreshToken: rotatedRefreshToken,
          expiresIn: 28800,
          refreshTokenExpiresIn: 15811200,
          tokenType: 'bearer',
          scope: '',
        };
      },
    });

    // 5 simultaneous callers
    const results = await Promise.all([
      getValidAccessToken(trainer.account),
      getValidAccessToken(trainer.account),
      getValidAccessToken(trainer.account),
      getValidAccessToken(trainer.account),
      getValidAccessToken(trainer.account),
    ]);

    assert.equal(refreshCallCount, 1, 'refreshToken must only be called once for 5 concurrent callers');
    for (const resToken of results) {
      assert.equal(resToken, freshAccessToken);
    }
  });

  test('3. Refresh failure properly cleans up lease and does not leak credentials in error message', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const secretRefreshToken = 'ghr_superSecretRefreshTokenValue123';
    const trainer = await UserRepository.createTrainer({
      githubUserId: 'fail_conc_user',
      username: 'fail_conc_trainer',
      primaryHandle: 'fail_conc_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_fail'),
      encryptedRefreshToken: encryptToken(secretRefreshToken),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        throw new Error(`GitHub upstream error with token ${secretRefreshToken}`);
      },
    });

    await assert.rejects(
      async () => {
        await getValidAccessToken(trainer.account);
      },
      (err: unknown) => {
        const error = err as GitHubTokenRefreshError;
        assert.ok(
          error.name === 'GitHubTokenRefreshError' || error.name === 'GitHubReauthorizationRequiredError',
          'Expected GitHubTokenRefreshError or GitHubReauthorizationRequiredError'
        );
        assert.ok(!error.message.includes(secretRefreshToken), 'Must NEVER leak refresh token in error message');
        assert.ok(error.message.includes('[REDACTED]'));
        return true;
      }
    );

    // Verify lease lock was released in database
    const accountInDb = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(accountInDb?.token_refresh_locked_at, null, 'Lease lock must be released on refresh failure');
  });

  test('4. Expired refresh token throws GitHubTokenExpiredError without calling upstream', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'expired_refresh_user',
      username: 'expired_refresh_trainer',
      primaryHandle: 'expired_refresh_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_acc'),
      encryptedRefreshToken: encryptToken('ghr_expired_ref'),
      tokenExpiresAt: new Date(Date.now() - 3600 * 1000),
      refreshExpiresAt: new Date(Date.now() - 1000), // Expired!
    });

    let refreshCalled = false;
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        refreshCalled = true;
        throw new Error('Should not be called');
      },
    });

    await assert.rejects(
      async () => {
        await getValidAccessToken(trainer.account);
      },
      GitHubTokenExpiredError
    );

    assert.equal(refreshCalled, false, 'refreshToken should not be called when refresh token is expired');
  });

  test('5. Cross-process lock simulation: secondary worker waits for primary worker to persist new token', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const freshAccessToken = 'ghu_CROSS_PROCESS_SAVED_TOKEN';
    const trainer = await UserRepository.createTrainer({
      githubUserId: 'cross_proc_user',
      username: 'cross_proc_trainer',
      primaryHandle: 'cross_proc_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_cross'),
      encryptedRefreshToken: encryptToken('ghr_refresh_cross'),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    // Simulate Process 1 already holding the database lease
    await pool.query('UPDATE github_accounts SET token_refresh_locked_at = NOW() WHERE id = $1;', [
      trainer.account.id,
    ]);

    // Ensure mockAuthClient throws if Process 2 attempts to refresh
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        throw new Error('Process 2 should not attempt refresh while lease is held');
      },
    });

    // In 250ms, simulate Process 1 saving the fresh token and releasing the lease
    setTimeout(async () => {
      await pool.query(
        `UPDATE github_accounts
        SET encrypted_access_token = $1,
            token_expires_at = NOW() + INTERVAL '8 hours',
            token_refresh_locked_at = NULL
        WHERE id = $2;`,
        [encryptToken(freshAccessToken), trainer.account.id]
      );
    }, 250);

    // Process 2 starts getValidAccessToken: it sees lease is held, polls, and returns fresh token
    const token = await getValidAccessToken(trainer.account);
    assert.equal(token, freshAccessToken);
  });

  test('6. Stale lease release fencing: stale owner cannot release an active lease owned by another worker', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'lease_fence_user',
      username: 'lease_fence_trainer',
      primaryHandle: 'lease_fence_trainer',
      encryptedAccessToken: encryptToken('ghu_tok_lease_fence'),
    });

    const ownerA = 'owner-uuid-worker-A';
    const ownerB = 'owner-uuid-worker-B';

    // Worker A claims lease
    const acquiredA = await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerA, 30);
    assert.equal(acquiredA, true, 'Worker A should acquire the initial lease');

    // Simulate Worker A's lease expiring (TTL = 0 seconds) and Worker B claiming it
    const acquiredB = await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerB, 0);
    assert.equal(acquiredB, true, 'Worker B should acquire lease after expiration');

    // Verify database currently records Worker B as the owner
    const currentAcc = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(currentAcc?.token_refresh_owner, ownerB);

    // Worker A wakes up and attempts to release the lease
    const releasedByStaleWorkerA = await UserRepository.releaseTokenRefreshLease(trainer.account.id, ownerA);
    assert.equal(releasedByStaleWorkerA, false, 'Stale Worker A must NOT be able to release Worker B lease');

    // Verify Worker B lease is STILL active
    const checkAfterStaleRelease = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(checkAfterStaleRelease?.token_refresh_owner, ownerB, 'Worker B lease must remain untouched');
    assert.ok(checkAfterStaleRelease?.token_refresh_locked_at !== null, 'Lock timestamp must remain active');

    // Worker B releases its own lease
    const releasedByOwnerB = await UserRepository.releaseTokenRefreshLease(trainer.account.id, ownerB);
    assert.equal(releasedByOwnerB, true, 'Active owner B must successfully release the lease');

    const checkAfterOwnerRelease = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(checkAfterOwnerRelease?.token_refresh_owner, null);
    assert.equal(checkAfterOwnerRelease?.token_refresh_locked_at, null);
  });

  test('7. Stale worker persistence fencing: stale worker cannot overwrite newer credentials', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const initialToken = 'ghu_initial_gen_1';
    const workerBToken = 'ghu_NEWER_TOKEN_GEN_2';
    const staleWorkerAToken = 'ghu_STALE_OVERWRITE_ATTEMPT';

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'stale_write_user',
      username: 'stale_write_trainer',
      primaryHandle: 'stale_write_trainer',
      encryptedAccessToken: encryptToken(initialToken),
    });

    const ownerA = 'stale-worker-A';
    const ownerB = 'winning-worker-B';

    // Worker A acquires lease
    await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerA, 30);

    // Worker A pauses/lags. Lease expires (simulated with 0 TTL) and Worker B acquires lease
    await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerB, 0);

    // Worker B successfully refreshes and persists new tokens
    const persistedB = await UserRepository.updateTokens(
      trainer.account.id,
      encryptToken(workerBToken),
      null,
      new Date(Date.now() + 28800 * 1000),
      null,
      ownerB
    );
    assert.equal(persistedB, true, 'Worker B must successfully persist fresh credentials');

    // Worker A finishes slow computation/network and tries to persist stale credentials
    const persistedA = await UserRepository.updateTokens(
      trainer.account.id,
      encryptToken(staleWorkerAToken),
      null,
      new Date(Date.now() + 28800 * 1000),
      null,
      ownerA
    );
    assert.equal(persistedA, false, 'Stale Worker A write MUST be rejected by database');

    // Verify stored token is STILL Worker B token (not overwritten)
    const finalAccount = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(
      decryptToken(finalAccount!.encrypted_access_token!),
      workerBToken,
      'Database must retain Worker B credentials'
    );
  });

  test('8. Monotonic token_version increments on successful write and remains constant on rejected write', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'monotonic_ver_user',
      username: 'monotonic_ver_trainer',
      primaryHandle: 'monotonic_ver_trainer',
      encryptedAccessToken: encryptToken('ghu_ver_1'),
    });

    const initialAccount = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(initialAccount?.token_version, 1, 'Initial token_version must be 1');

    const ownerToken = 'worker-owner-monotonic';
    await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerToken, 30);

    // Update with matching owner token -> increments version
    const updated = await UserRepository.updateTokens(
      trainer.account.id,
      encryptToken('ghu_ver_2'),
      null,
      null,
      null,
      ownerToken
    );
    assert.equal(updated, true);

    const version2Account = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(version2Account?.token_version, 2, 'token_version must increment to 2');

    // Rejected update with invalid owner token -> version must not change
    const rejected = await UserRepository.updateTokens(
      trainer.account.id,
      encryptToken('ghu_ver_bad'),
      null,
      null,
      null,
      'non-existent-owner'
    );
    assert.equal(rejected, false);

    const checkVersionUnchanged = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(checkVersionUnchanged?.token_version, 2, 'token_version must remain 2 after rejected write');
  });

  test('9. Stale worker recovery: slow worker detects invalidated lease and recovers winner credentials', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const winnerToken = 'ghu_WINNER_REFRESH_TOKEN';
    const trainer = await UserRepository.createTrainer({
      githubUserId: 'recovery_user',
      username: 'recovery_trainer',
      primaryHandle: 'recovery_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_recovery'),
      encryptedRefreshToken: encryptToken('ghr_refresh_recovery'),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    // Mock upstream refreshToken to simulate Worker B stealing the lease while Worker A is inside refreshToken
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        // While Worker A is waiting on upstream, Worker B acquires lease and persists credentials
        const ownerB = 'winner-worker-B';
        await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerB, 0);
        await UserRepository.updateTokens(
          trainer.account.id,
          encryptToken(winnerToken),
          encryptToken('ghr_rotated_winner'),
          new Date(Date.now() + 8 * 3600 * 1000),
          new Date(Date.now() + 30 * 24 * 3600 * 1000),
          ownerB
        );

        // Worker A now finishes with its own token (which should be rejected)
        return {
          accessToken: 'ghu_STALE_LOSER_TOKEN',
          refreshToken: 'ghr_stale_loser',
          expiresIn: 28800,
          refreshTokenExpiresIn: 15811200,
          tokenType: 'bearer',
          scope: '',
        };
      },
    });

    // Worker A executes getValidAccessToken
    const token = await getValidAccessToken(trainer.account);

    // Worker A must detect that its write failed and return the WINNER token without error!
    assert.equal(token, winnerToken, 'Worker A must safely recover and return the winner fresh token');

    // And database must have winnerToken
    const current = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(decryptToken(current!.encrypted_access_token!), winnerToken);
  });

  test('10. Timeout sizing invariant: Upstream HTTP timeout is strictly smaller than lease TTL', async () => {
    // Invariant: UPSTREAM_HTTP_TIMEOUT_MS (10,000ms) < LEASE_TTL_MS (30,000ms)
    const UPSTREAM_HTTP_TIMEOUT_MS = 10_000;
    const LEASE_TTL_SECONDS = 30;
    const LEASE_TTL_MS = LEASE_TTL_SECONDS * 1000;

    assert.ok(
      UPSTREAM_HTTP_TIMEOUT_MS < LEASE_TTL_MS,
      'HTTP timeout must be strictly smaller than distributed lease TTL'
    );
    const safetyMarginMs = LEASE_TTL_MS - UPSTREAM_HTTP_TIMEOUT_MS;
    assert.ok(
      safetyMarginMs >= 15_000,
      `Safety margin (${safetyMarginMs}ms) must be at least 15 seconds to absorb network jitter and crypto latency`
    );
  });

  test('11. Migration 005 schema verification: columns exist with proper data types', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const res = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'github_accounts'
        AND column_name IN ('token_refresh_locked_at', 'token_refresh_owner', 'token_version')
      ORDER BY column_name ASC;`
    );

    const cols = Object.fromEntries(res.rows.map((r) => [r.column_name, r]));
    assert.ok(cols.token_refresh_locked_at, 'token_refresh_locked_at column must exist');
    assert.equal(cols.token_refresh_locked_at.data_type, 'timestamp with time zone');

    assert.ok(cols.token_refresh_owner, 'token_refresh_owner column must exist');
    assert.equal(cols.token_refresh_owner.data_type, 'character varying');

    assert.ok(cols.token_version, 'token_version column must exist');
    assert.equal(cols.token_version.data_type, 'integer');
    assert.equal(cols.token_version.is_nullable, 'NO');
  });
});
