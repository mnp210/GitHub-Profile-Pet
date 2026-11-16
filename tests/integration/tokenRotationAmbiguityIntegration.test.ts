// tests/integration/tokenRotationAmbiguityIntegration.test.ts
// Sprint 2.4A.3 - PostgreSQL 16+ Integration Suite for External Token Rotation Ambiguity & Refresh Recovery

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
} from '../../src/lib/security/crypto.ts';
import {
  setGitHubAuthClient,
  resetGitHubAuthClient,
} from '../../src/lib/auth/githubAuth.ts';
import {
  getValidAccessToken,
  GitHubReauthorizationRequiredError,
} from '../../src/lib/github/tokenManager.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

describe('External Token Rotation Ambiguity & Refresh Recovery Integration Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('[Ambiguity Tests] No active database on 5432. Starting local PostgreSQL 16...');
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
        console.warn('[Ambiguity Tests] Failed to initialize embedded postgres:', (err as Error).message);
      }
    }

    if (!health.ok) {
      console.warn(`[Ambiguity Tests] Skipping: Database unavailable at ${maskConnectionString(TEST_DB_URL)}`);
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
      console.log('[Ambiguity Tests Cleanup] Stopping local PostgreSQL 16...');
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

  test('1. Process pause after successful upstream rotation: Worker B refuses to replay RT1', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const initialRefreshToken = 'ghr_rot_initial_token_1';
    const trainer = await UserRepository.createTrainer({
      githubUserId: 'pause_user_1',
      username: 'pause_trainer_1',
      primaryHandle: 'pause_trainer_1',
      encryptedAccessToken: encryptToken('ghu_expired_pause_1'),
      encryptedRefreshToken: encryptToken(initialRefreshToken),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    const ownerA = 'worker-A-pause';

    // 1. Worker A acquires lease
    await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerA, 30);

    // 2. Worker A marks generation 1 dispatched
    await UserRepository.markRefreshDispatched(trainer.account.id, ownerA, 1);

    // 3. Worker A submits RT1 to GitHub and receives RT2
    // 4. Worker A pauses before persisting to PostgreSQL
    // 5. Simulate lease expiry (locked_at set to 35 seconds ago)
    await pool.query(
      `UPDATE github_accounts
      SET token_refresh_locked_at = NOW() - INTERVAL '35 seconds'
      WHERE id = $1;`,
      [trainer.account.id]
    );

    // 6. Worker B arrives and calls getValidAccessToken
    let workerBSubmittedUpstream = false;
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        workerBSubmittedUpstream = true;
        throw new Error('Worker B MUST NOT submit RT1!');
      },
    });

    await assert.rejects(
      async () => {
        await getValidAccessToken(trainer.account);
      },
      (err: unknown) => {
        const error = err as GitHubReauthorizationRequiredError;
        assert.equal(error.name, 'GitHubReauthorizationRequiredError');
        assert.ok(
          error.message.includes('dispatched') || error.message.includes('reauthorization required'),
          'Expected error explaining unconfirmed dispatched token'
        );
        return true;
      }
    );

    assert.equal(workerBSubmittedUpstream, false, 'Worker B must NEVER submit RT1 over the wire');

    // Verify account is now transitioned to ambiguous state
    const currentAcc = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(currentAcc?.token_refresh_status, 'ambiguous');
    assert.equal(currentAcc?.token_refresh_locked_at, null);
  });

  test('2. Lease expiry while refresh outcome is ambiguous: blocks automatic retry', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'lease_exp_user',
      username: 'lease_exp_trainer',
      primaryHandle: 'lease_exp_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_lexp'),
      encryptedRefreshToken: encryptToken('ghr_lexp_rt1'),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    // Simulate an expired lease with dispatched status from an unconfirmed worker
    const ownerStale = 'worker-stale-ambiguous';
    await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerStale, 30);
    await UserRepository.markRefreshDispatched(trainer.account.id, ownerStale, 1);
    await pool.query(
      `UPDATE github_accounts
      SET token_refresh_locked_at = NOW() - INTERVAL '60 seconds'
      WHERE id = $1;`,
      [trainer.account.id]
    );

    let upstreamCalled = false;
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        upstreamCalled = true;
        return {
          accessToken: 'should-not-be-reached',
          refreshToken: 'should-not-be-reached',
          expiresIn: 28800,
          tokenType: 'bearer',
          scope: '',
        };
      },
    });

    await assert.rejects(
      async () => {
        await getValidAccessToken(trainer.account);
      },
      GitHubReauthorizationRequiredError
    );

    assert.equal(upstreamCalled, false, 'Upstream must not be called when lease expired with ambiguous dispatched generation');
  });

  test('3. Lost HTTP response after provider-side rotation: fails closed without replay', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'lost_http_user',
      username: 'lost_http_trainer',
      primaryHandle: 'lost_http_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_lost_http'),
      encryptedRefreshToken: encryptToken('ghr_lost_http_rt1'),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    // Mock upstream network timeout / dropped connection
    let callCount = 0;
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        callCount++;
        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      },
    });

    // First attempt times out
    await assert.rejects(
      async () => {
        await getValidAccessToken(trainer.account);
      },
      (err: unknown) => {
        const error = err as GitHubReauthorizationRequiredError;
        assert.equal(error.name, 'GitHubReauthorizationRequiredError');
        assert.ok(error.message.includes('Reauthorization required'));
        return true;
      }
    );

    assert.equal(callCount, 1);

    // Verify account is now in ambiguous status
    const accountAfter = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(accountAfter?.token_refresh_status, 'ambiguous');

    // Immediate second attempt: must FAIL CLOSED without contacting upstream again
    await assert.rejects(
      async () => {
        await getValidAccessToken(accountAfter!);
      },
      GitHubReauthorizationRequiredError
    );

    assert.equal(callCount, 1, 'Upstream must NEVER be replayed after ambiguous network drop');
  });

  test('4. Database failure after provider-side success: fails closed and preserves account state', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'db_fail_user',
      username: 'db_fail_trainer',
      primaryHandle: 'db_fail_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_db_fail'),
      encryptedRefreshToken: encryptToken('ghr_db_fail_rt1'),
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
        return {
          accessToken: 'ghu_NEW_TOKEN_AFTER_UPSTREAM_SUCCESS',
          refreshToken: 'ghr_NEW_ROTATED_REFRESH_TOKEN',
          expiresIn: 28800,
          tokenType: 'bearer',
          scope: '',
        };
      },
    });

    // Spy / intercept updateTokens to simulate PostgreSQL persistence failure
    const originalUpdateTokens = UserRepository.updateTokens;
    UserRepository.updateTokens = async () => {
      throw new Error('Simulated PostgreSQL connection failure during persistence');
    };

    try {
      await assert.rejects(
        async () => {
          await getValidAccessToken(trainer.account);
        },
        (err: unknown) => {
          const error = err as GitHubReauthorizationRequiredError;
          assert.equal(error.name, 'GitHubReauthorizationRequiredError');
          assert.ok(error.message.includes('database persistence failed'));
          return true;
        }
      );
    } finally {
      UserRepository.updateTokens = originalUpdateTokens;
    }

    assert.equal(refreshCallCount, 1);

    // Verify account is marked ambiguous, NOT deleted, and user profile / pet remains intact
    const accountCheck = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(accountCheck?.token_refresh_status, 'ambiguous');

    const userDetails = await UserRepository.findByUserId(trainer.user.id);
    assert.ok(userDetails, 'User details must be preserved');
    assert.equal(userDetails.user.primary_handle, 'db_fail_trainer');
    assert.equal(userDetails.pet.species, trainer.pet.species);
  });

  test('5. A second worker attempting refresh during ambiguous state: rejected immediately', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'ambig_user_5',
      username: 'ambig_trainer_5',
      primaryHandle: 'ambig_trainer_5',
      encryptedAccessToken: encryptToken('ghu_expired_5'),
      encryptedRefreshToken: encryptToken('ghr_rt_5'),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    // Mark account ambiguous directly in DB
    await pool.query(
      `UPDATE github_accounts
      SET token_refresh_status = 'ambiguous',
          token_refresh_locked_at = NULL,
          token_refresh_owner = NULL
      WHERE id = $1;`,
      [trainer.account.id]
    );

    let upstreamCalled = false;
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        upstreamCalled = true;
        throw new Error('Must not be called');
      },
    });

    // Worker 2 attempts refresh
    await assert.rejects(
      async () => {
        await getValidAccessToken(trainer.account);
      },
      GitHubReauthorizationRequiredError
    );

    assert.equal(upstreamCalled, false, 'No upstream calls allowed while account is ambiguous');
  });

  test('6. Recovery after a fresh token generation has been persisted: recovers without reauthorizing', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const freshAccessToken = 'ghu_GEN_2_PERSISTED_TOKEN';
    const trainer = await UserRepository.createTrainer({
      githubUserId: 'recovery_gen2_user',
      username: 'recovery_gen2_trainer',
      primaryHandle: 'recovery_gen2_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_gen1'),
      encryptedRefreshToken: encryptToken('ghr_refresh_gen1'),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    // Simulate Worker B acquiring lease and successfully persisting Generation 2 while Worker A was in-flight
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken() {
        // While Worker A is waiting, Worker B overtakes and commits generation 2
        const ownerB = 'worker-B-concurrent-commit';
        await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerB, 0);
        await UserRepository.updateTokens(
          trainer.account.id,
          encryptToken(freshAccessToken),
          encryptToken('ghr_refresh_gen2'),
          new Date(Date.now() + 8 * 3600 * 1000),
          new Date(Date.now() + 30 * 24 * 3600 * 1000),
          ownerB
        );

        // Worker A returns its own token, which will be fenced out
        return {
          accessToken: 'ghu_STALE_LOSER_TOKEN',
          refreshToken: 'ghr_stale_loser_rt',
          expiresIn: 28800,
          tokenType: 'bearer',
          scope: '',
        };
      },
    });

    const token = await getValidAccessToken(trainer.account);
    assert.equal(token, freshAccessToken, 'Worker A must safely recover and return the persisted Gen 2 token');

    const acc = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(acc?.token_version, 2, 'Generation must be 2');
    assert.equal(acc?.token_refresh_status, 'idle', 'Status must be idle after successful persistence');
  });

  test('7. Safe reauthorization-required behavior: OAuth callback clears ambiguous state', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'reauth_flow_user',
      username: 'reauth_flow_trainer',
      primaryHandle: 'reauth_flow_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_reauth'),
      encryptedRefreshToken: encryptToken('ghr_tainted_token'),
      tokenExpiresAt: new Date(Date.now() - 1000),
    });

    // Account is in ambiguous state
    await pool.query(
      `UPDATE github_accounts
      SET token_refresh_status = 'ambiguous',
          token_refresh_dispatched_version = 1
      WHERE id = $1;`,
      [trainer.account.id]
    );

    // Verify it fails closed before reauth
    await assert.rejects(
      async () => {
        await getValidAccessToken(trainer.account);
      },
      GitHubReauthorizationRequiredError
    );

    // User initiates GitHub OAuth login: callback calls UserRepository.updateTokens with fresh tokens
    const freshReauthAccessToken = 'ghu_BRAND_NEW_OAUTH_ACCESS_TOKEN';
    const freshReauthRefreshToken = 'ghr_BRAND_NEW_OAUTH_REFRESH_TOKEN';

    const reauthSuccess = await UserRepository.updateTokens(
      trainer.account.id,
      encryptToken(freshReauthAccessToken),
      encryptToken(freshReauthRefreshToken),
      new Date(Date.now() + 8 * 3600 * 1000),
      new Date(Date.now() + 30 * 24 * 3600 * 1000)
    );
    assert.equal(reauthSuccess, true, 'OAuth callback update must succeed');

    // Verify database state is restored
    const reauthedAccount = await UserRepository.findGitHubAccountById(trainer.account.id);
    assert.equal(reauthedAccount?.token_refresh_status, 'idle', 'Status must return to idle');
    assert.equal(reauthedAccount?.token_refresh_dispatched_at, null);
    assert.equal(reauthedAccount?.token_refresh_dispatched_version, null);
    assert.equal(reauthedAccount?.token_version, 2);

    // Now getValidAccessToken succeeds immediately
    const validToken = await getValidAccessToken(reauthedAccount!);
    assert.equal(validToken, freshReauthAccessToken);
  });

  test('8. Pre-dispatch crash safety: Un-dispatched lease expiry can be safely re-attempted', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const initialRefreshToken = 'ghr_undispatched_token_1';
    const freshAccessToken = 'ghu_UNDISPATCHED_RECOVERED_TOKEN';

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'undispatched_user',
      username: 'undispatched_trainer',
      primaryHandle: 'undispatched_trainer',
      encryptedAccessToken: encryptToken('ghu_expired_undispatched'),
      encryptedRefreshToken: encryptToken(initialRefreshToken),
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    const ownerA = 'worker-A-crashed-pre-dispatch';

    // Worker A acquired lease, but died BEFORE calling markRefreshDispatched
    await UserRepository.acquireTokenRefreshLease(trainer.account.id, ownerA, 30);
    // Lease expires
    await pool.query(
      `UPDATE github_accounts
      SET token_refresh_locked_at = NOW() - INTERVAL '35 seconds'
      WHERE id = $1;`,
      [trainer.account.id]
    );

    // Worker B arrives: since status is still 'idle' and token_refresh_dispatched_version is null,
    // Worker B knows the token was NEVER sent to GitHub. Worker B can safely dispatch refresh!
    let workerBDispatched = false;
    setGitHubAuthClient({
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken(token: string) {
        workerBDispatched = true;
        assert.equal(token, initialRefreshToken);
        return {
          accessToken: freshAccessToken,
          refreshToken: 'ghr_rotated_undispatched',
          expiresIn: 28800,
          tokenType: 'bearer',
          scope: '',
        };
      },
    });

    const token = await getValidAccessToken(trainer.account);
    assert.equal(token, freshAccessToken);
    assert.equal(workerBDispatched, true, 'Worker B must safely execute refresh because Worker A never dispatched');
  });
});
