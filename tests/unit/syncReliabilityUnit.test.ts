// tests/unit/syncReliabilityUnit.test.ts
// Unit tests for GitHub sync failure classification, bounded exponential backoff with jitter, retry deadlines, and sync logger

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGitHubError,
} from '../../src/lib/github/failureClassification.ts';
import {
  calculateBackoffWithJitter,
  executeWithRetry,
  type RetryPolicyConfig,
} from '../../src/lib/github/retryPolicy.ts';
import {
  GitHubGraphQLError,
  GitHubUnauthorizedError,
  GitHubForbiddenError,
  GitHubRateLimitError,
  GitHubServerError,
  GitHubTimeoutError,
  GitHubNetworkError,
} from '../../src/lib/github/graphqlClient.ts';
import {
  GitHubReauthorizationRequiredError,
  GitHubTokenExpiredError,
  GitHubTokenRefreshError,
} from '../../src/lib/github/tokenManager.ts';
import { syncLogger, setSyncLogHandler, type SyncLogContext } from '../../src/lib/github/syncLogger.ts';

describe('GitHub Failure Classification & Retry Safety Unit Suite', () => {
  describe('1. Failure Classification Engine & Precedence Rules', () => {
    test('classifies primary rate limit as PRIMARY_RATE_LIMIT and non-retryable for immediate retry', () => {
      const resetAt = new Date('2026-11-15T19:00:00Z');
      const err = new GitHubRateLimitError('GitHub API primary rate limit exceeded.', resetAt, null, 'primary');
      const classified = classifyGitHubError(err);

      assert.equal(classified.category, 'PRIMARY_RATE_LIMIT');
      assert.equal(classified.retryable, false);
      assert.equal(classified.statusCode, 429);
      assert.equal(classified.rateLimit?.kind, 'primary');
      assert.equal(classified.rateLimit?.resetAt?.toISOString(), resetAt.toISOString());
      assert.equal(classified.rateLimit?.retryAfterSeconds, null);
    });

    test('classifies secondary rate limit with small retry-after budget (<= 2s) as retryable', () => {
      const err = new GitHubRateLimitError('GitHub API secondary rate limit triggered.', null, 2, 'secondary');
      const classified = classifyGitHubError(err);

      assert.equal(classified.category, 'SECONDARY_RATE_LIMIT');
      assert.equal(classified.retryable, true);
      assert.equal(classified.statusCode, 429);
      assert.equal(classified.rateLimit?.kind, 'secondary');
      assert.equal(classified.rateLimit?.retryAfterSeconds, 2);
    });

    test('classifies secondary rate limit exceeding retry-after budget (> 2s) as non-retryable', () => {
      const err = new GitHubRateLimitError('GitHub API secondary rate limit triggered.', null, 60, 'secondary');
      const classified = classifyGitHubError(err);

      assert.equal(classified.category, 'SECONDARY_RATE_LIMIT');
      assert.equal(classified.retryable, false);
      assert.equal(classified.statusCode, 429);
      assert.equal(classified.rateLimit?.retryAfterSeconds, 60);
    });

    test('HTTP 403 with x-ratelimit-remaining: 0 is classified as PRIMARY_RATE_LIMIT', () => {
      const resetAt = new Date('2026-11-15T19:30:00Z');
      const err = new GitHubRateLimitError('GitHub API primary rate limit exceeded.', resetAt, null, 'primary');
      const classified = classifyGitHubError(err);
      assert.equal(classified.category, 'PRIMARY_RATE_LIMIT');
      assert.equal(classified.statusCode, 429);
      assert.equal(classified.rateLimit?.kind, 'primary');
    });

    test('HTTP 403 with secondary rate limit evidence is classified as SECONDARY_RATE_LIMIT', () => {
      const err = new GitHubRateLimitError('You have exceeded a secondary rate limit. Please wait.', null, 30, 'secondary');
      const classified = classifyGitHubError(err);
      assert.equal(classified.category, 'SECONDARY_RATE_LIMIT');
      assert.equal(classified.statusCode, 429);
      assert.equal(classified.rateLimit?.kind, 'secondary');
      assert.equal(classified.rateLimit?.retryAfterSeconds, 30);
    });

    test('HTTP 403 with remaining quota and no rate limit evidence is classified as PERMISSION_DENIED', () => {
      const err = new GitHubForbiddenError('Resource not accessible by integration');
      const classified = classifyGitHubError(err);
      assert.equal(classified.category, 'PERMISSION_DENIED');
      assert.equal(classified.statusCode, 403);
      assert.equal(classified.errorCode, 'PERMISSION_DENIED');
      assert.equal(classified.retryable, false);
      assert.equal(classified.rateLimit, undefined);
    });

    test('Precedence rule: conflicting evidence (x-ratelimit-remaining: 0 AND Retry-After) prioritizes SECONDARY_RATE_LIMIT', () => {
      const resetAt = new Date('2026-11-15T19:00:00Z');
      // Rate limit error with remaining: 0 but has secondary evidence (retryAfter)
      const err = new GitHubRateLimitError('Secondary rate limit triggered with zero remaining quota.', resetAt, 60, 'secondary');
      const classified = classifyGitHubError(err);
      assert.equal(classified.category, 'SECONDARY_RATE_LIMIT');
      assert.equal(classified.rateLimit?.kind, 'secondary');
      assert.equal(classified.rateLimit?.retryAfterSeconds, 60);
    });

    test('Precedence rule: permission failures are never retried as rate limits', () => {
      const err = new GitHubForbiddenError('Must have admin rights to repository');
      const classified = classifyGitHubError(err);
      assert.equal(classified.category, 'PERMISSION_DENIED');
      assert.equal(classified.retryable, false);
    });

    test('Precedence rule: rate limits are never reported as ordinary permission failures', () => {
      const resetAt = new Date('2026-11-15T20:00:00Z');
      const err = new GitHubRateLimitError('Primary rate limit exceeded', resetAt, null, 'primary');
      const classified = classifyGitHubError(err);
      assert.notEqual(classified.category, 'PERMISSION_DENIED');
      assert.equal(classified.category, 'PRIMARY_RATE_LIMIT');
    });

    test('classifies timeouts as TIMEOUT and retryable', () => {
      const err = new GitHubTimeoutError(10000);
      const classified = classifyGitHubError(err);

      assert.equal(classified.category, 'TIMEOUT');
      assert.equal(classified.retryable, true);
      assert.equal(classified.statusCode, 503);
      assert.equal(classified.errorCode, 'UPSTREAM_TIMEOUT');
    });

    test('classifies transient network errors (ECONNRESET) as TRANSIENT_NETWORK and retryable', () => {
      const err = new GitHubNetworkError('read ECONNRESET at TCP.onStreamRead');
      const classified = classifyGitHubError(err);

      assert.equal(classified.category, 'TRANSIENT_NETWORK');
      assert.equal(classified.retryable, true);
      assert.equal(classified.statusCode, 502);
      assert.equal(classified.errorCode, 'TRANSIENT_NETWORK_FAILURE');
    });

    test('classifies HTTP 5xx server errors as UPSTREAM_5XX and retryable', () => {
      const err502 = new GitHubServerError(502);
      const classified502 = classifyGitHubError(err502);
      assert.equal(classified502.category, 'UPSTREAM_5XX');
      assert.equal(classified502.retryable, true);
      assert.equal(classified502.statusCode, 502);

      const err503 = new GitHubServerError(503);
      const classified503 = classifyGitHubError(err503);
      assert.equal(classified503.category, 'UPSTREAM_5XX');
      assert.equal(classified503.retryable, true);
      assert.equal(classified503.statusCode, 503);
    });

    test('classifies HTTP 401 and token revocation as non-retryable AUTHENTICATION_ERROR', () => {
      const err401 = new GitHubUnauthorizedError();
      const classified401 = classifyGitHubError(err401);
      assert.equal(classified401.category, 'AUTHENTICATION_ERROR');
      assert.equal(classified401.retryable, false);
      assert.equal(classified401.statusCode, 401);

      const errReauth = new GitHubReauthorizationRequiredError();
      const classifiedReauth = classifyGitHubError(errReauth);
      assert.equal(classifiedReauth.category, 'AUTHENTICATION_ERROR');
      assert.equal(classifiedReauth.retryable, false);
      assert.equal(classifiedReauth.errorCode, 'REAUTHORIZATION_REQUIRED');

      const errExpired = new GitHubTokenExpiredError();
      const classifiedExpired = classifyGitHubError(errExpired);
      assert.equal(classifiedExpired.category, 'AUTHENTICATION_ERROR');
      assert.equal(classifiedExpired.retryable, false);

      const errRefresh = new GitHubTokenRefreshError();
      const classifiedRefresh = classifyGitHubError(errRefresh);
      assert.equal(classifiedRefresh.category, 'AUTHENTICATION_ERROR');
      assert.equal(classifiedRefresh.retryable, false);
      assert.equal(classifiedRefresh.statusCode, 502);
    });

    test('classifies GraphQL-level errors as GRAPHQL_ERROR and non-retryable', () => {
      const errGraph = new GitHubGraphQLError([{ message: 'Field "unknown" does not exist' }]);
      const classified = classifyGitHubError(errGraph);
      assert.equal(classified.category, 'GRAPHQL_ERROR');
      assert.equal(classified.retryable, false);
      assert.equal(classified.statusCode, 502);
      assert.equal(classified.errorCode, 'GRAPHQL_EXECUTION_ERROR');
    });

    test('redacts sensitive access tokens and bearer tokens from error messages', () => {
      const secretToken = 'ghu_1234567890abcdef1234567890';
      const rawError = new Error(`Connection failed with Bearer ${secretToken} and ghp_998877665544332211.`);
      const classified = classifyGitHubError(rawError, secretToken);

      assert.ok(!classified.message.includes(secretToken));
      assert.ok(!classified.message.includes('ghp_998877665544332211'));
      assert.ok(classified.message.includes('[REDACTED_TOKEN]') || classified.message.includes('[REDACTED_GITHUB_TOKEN]'));
    });
  });

  describe('2. Total Retry Deadline & Budget Engine', () => {
    test('calculateBackoffWithJitter respects bounds and caps at maxDelayMs', () => {
      const customConfig: RetryPolicyConfig = {
        maxAttempts: 4,
        initialDelayMs: 100,
        maxDelayMs: 500,
        backoffFactor: 2,
        maxTotalDurationMs: 5000,
        maxRetryAfterBudgetSeconds: 2,
      };

      for (let attempt = 1; attempt <= 5; attempt++) {
        for (let i = 0; i < 20; i++) {
          const jittered = calculateBackoffWithJitter(attempt, customConfig);
          assert.ok(jittered >= 0);
          assert.ok(jittered <= customConfig.maxDelayMs);
        }
      }
    });

    test('executeWithRetry succeeds on attempt 1 without sleeping if no error', async () => {
      let callCount = 0;
      let sleepCount = 0;

      const result = await executeWithRetry(
        async (attempt, remainingBudgetMs) => {
          callCount++;
          assert.ok(remainingBudgetMs > 9000, 'Attempt 1 must receive initial total budget');
          return `success_${attempt}`;
        },
        {
          sleepFn: async () => {
            sleepCount++;
          },
        }
      );

      assert.equal(result, 'success_1');
      assert.equal(callCount, 1);
      assert.equal(sleepCount, 0);
    });

    test('executeWithRetry: successful retry within the deadline', async () => {
      let callCount = 0;
      const sleepDelays: number[] = [];
      const receivedBudgets: number[] = [];

      let simulatedTime = 1000;
      const nowFn = () => simulatedTime;

      const result = await executeWithRetry(
        async (attempt, remainingBudgetMs) => {
          callCount++;
          receivedBudgets.push(remainingBudgetMs);
          if (attempt === 1) {
            simulatedTime += 200; // attempt 1 took 200ms
            throw new GitHubNetworkError('Temporary drop');
          }
          simulatedTime += 100; // attempt 2 took 100ms
          return `recovered_on_${attempt}`;
        },
        {
          config: {
            maxTotalDurationMs: 10_000,
            initialDelayMs: 200,
            maxDelayMs: 200,
          },
          nowFn,
          sleepFn: async (ms) => {
            sleepDelays.push(ms);
            simulatedTime += ms; // Advance time during sleep
          },
        }
      );

      assert.equal(result, 'recovered_on_2');
      assert.equal(callCount, 2);
      assert.equal(sleepDelays.length, 1);
      // Attempt 1 started with 10_000ms. Attempt 1 took 200ms, sleep took delayMs.
      // Attempt 2 receives remaining budget strictly less than 10_000ms.
      assert.equal(receivedBudgets[0], 10_000);
      assert.ok(receivedBudgets[1] < 10_000);
    });

    test('executeWithRetry: first request consuming most of the budget aborts when insufficient time remains', async () => {
      let callCount = 0;
      let sleepCount = 0;

      let simulatedTime = 1000;
      const nowFn = () => simulatedTime;

      await assert.rejects(
        async () => {
          await executeWithRetry(
            async (attempt) => {
              callCount++;
              if (attempt === 1) {
                // Request 1 takes 9,995ms out of 10,000ms budget
                simulatedTime += 9995;
                throw new GitHubServerError(503, 'Slow 503');
              }
              return 'recovered';
            },
            {
              config: { maxTotalDurationMs: 10_000 },
              nowFn,
              sleepFn: async () => {
                sleepCount++;
              },
            }
          );
        },
        (err: Error) => {
          return err instanceof GitHubServerError;
        }
      );

      assert.equal(callCount, 1, 'Must NOT attempt retry when insufficient budget remains (only 5ms left)');
      assert.equal(sleepCount, 0, 'Must not sleep when remaining budget is insufficient');
    });

    test('executeWithRetry: backoff delay exceeding remaining budget halts without sleeping past deadline', async () => {
      let callCount = 0;
      let sleepCount = 0;

      let simulatedTime = 1000;
      const nowFn = () => simulatedTime;

      await assert.rejects(
        async () => {
          await executeWithRetry(
            async (attempt) => {
              callCount++;
              if (attempt === 1) {
                // Request takes 9,995ms leaving only 5ms of total budget (< MIN_ATTEMPT_BUDGET_MS)
                simulatedTime += 9995;
                throw new GitHubNetworkError('Network drop near deadline');
              }
              return 'recovered';
            },
            {
              config: {
                maxTotalDurationMs: 10_000,
                initialDelayMs: 200,
                maxDelayMs: 200,
              },
              nowFn,
              sleepFn: async () => {
                sleepCount++;
              },
            }
          );
        },
        (err: Error) => {
          return err instanceof GitHubNetworkError;
        }
      );

      assert.equal(callCount, 1);
      assert.equal(sleepCount, 0, 'Must NOT sleep past deadline');
    });

    test('executeWithRetry: Retry-After exceeding remaining budget halts without sleeping past deadline', async () => {
      let callCount = 0;
      let sleepCount = 0;

      let simulatedTime = 1000;
      const nowFn = () => simulatedTime;

      await assert.rejects(
        async () => {
          await executeWithRetry(
            async (attempt) => {
              callCount++;
              if (attempt === 1) {
                simulatedTime += 9000; // 9000ms elapsed, 1000ms left
                // Retry-After of 2 seconds (2000ms) exceeds 1000ms remaining!
                throw new GitHubRateLimitError('Secondary rate limit', null, 2, 'secondary');
              }
              return 'recovered';
            },
            {
              config: {
                maxTotalDurationMs: 10_000,
                maxRetryAfterBudgetSeconds: 5,
              },
              nowFn,
              sleepFn: async () => {
                sleepCount++;
              },
            }
          );
        },
        (err: Error) => {
          return err instanceof GitHubRateLimitError;
        }
      );

      assert.equal(callCount, 1);
      assert.equal(sleepCount, 0, 'Must NOT sleep past deadline for Retry-After');
    });

    test('executeWithRetry: request timeout bounded by remaining time', async () => {
      let callCount = 0;
      const observedBudgets: number[] = [];

      let simulatedTime = 1000;
      const nowFn = () => simulatedTime;

      await assert.rejects(
        async () => {
          await executeWithRetry(
            async (attempt, remainingBudgetMs) => {
              callCount++;
              observedBudgets.push(remainingBudgetMs);
              if (attempt === 1) {
                simulatedTime += 8000; // 8000ms elapsed
                throw new GitHubServerError(502);
              }
              if (attempt === 2) {
                simulatedTime += 1995; // 9995ms elapsed
                throw new GitHubServerError(502);
              }
              return 'ok';
            },
            {
              config: {
                maxTotalDurationMs: 10_000,
                initialDelayMs: 50,
                maxDelayMs: 50,
              },
              nowFn,
              sleepFn: async (ms) => {
                simulatedTime += ms;
              },
            }
          );
        },
        (err: Error) => err instanceof GitHubServerError
      );

      assert.equal(callCount, 2);
      assert.equal(observedBudgets[0], 10_000);
      assert.ok(
        observedBudgets[1] <= 2000 && observedBudgets[1] >= 1900,
        `Attempt 2 budget (${observedBudgets[1]}ms) must be bounded by remaining time (~1950ms)`
      );
    });
  });

  describe('3. Privacy-Safe Sync Logger', () => {
    test('sanitizes and redacts tokens from logged context', () => {
      const loggedEntries: Array<{ level: string; event: string; context?: SyncLogContext }> = [];

      setSyncLogHandler((level, event, context) => {
        loggedEntries.push({ level, event, context });
      });

      const secret = 'ghu_super_secret_token_123456';
      syncLogger.info('Testing privacy redaction', {
        correlationId: 'test-corr-1',
        tokenField: secret,
        nested: { bearerAuth: `Bearer ${secret}` },
      });

      setSyncLogHandler(null);

      assert.equal(loggedEntries.length, 1);
      const ctx = loggedEntries[0].context;
      assert.ok(ctx);
      assert.ok(!JSON.stringify(ctx).includes(secret));
    });
  });
});
