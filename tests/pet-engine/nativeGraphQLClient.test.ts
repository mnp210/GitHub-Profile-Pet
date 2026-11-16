// tests/pet-engine/nativeGraphQLClient.test.ts
// Comprehensive unit tests for isolated NativeGitHubGraphQLClient and bounded retry logic

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeGitHubGraphQLClient,
  GitHubGraphQLError,
  GitHubUnauthorizedError,
  GitHubForbiddenError,
  GitHubRateLimitError,
  GitHubServerError,
  GitHubTimeoutError,
  GitHubNetworkError,
  redactSensitiveData,
  calculateBackoffWithJitter,
  classifyNativeGitHubError,
  executeWithRetry,
  parseStrictHeaderInteger,
  setFetchImplementation,
  resetFetchImplementation,
} from '../../src/features/pet-engine/contribution/nativeGraphQLClient.ts';

const SAMPLE_TOKEN = 'ghp_secretTokenVal1234567890abcdef';
const SAMPLE_QUERY = 'query TestQuery { user { login } }';

describe('Native GitHub GraphQL Client & Bounded Retry Suite', () => {
  beforeEach(() => {
    resetFetchImplementation();
  });

  afterEach(() => {
    resetFetchImplementation();
  });

  describe('Token & Credential Redaction', () => {
    it('redacts explicit access tokens passed into redactSensitiveData', () => {
      const sensitive = `Error fetching data with token ${SAMPLE_TOKEN} at endpoint`;
      const sanitized = redactSensitiveData(sensitive, SAMPLE_TOKEN);
      assert.ok(!sanitized.includes(SAMPLE_TOKEN));
      assert.ok(sanitized.includes('[REDACTED_TOKEN]'));
    });

    it('redacts GitHub pattern tokens (ghp_, gho_, ghu_, ghs_, ghr_)', () => {
      const input = 'Tokens: ghp_11112222333344445555, gho_AAAABBBBCCCCDDDDEEEE, and ghu_99998888777766665555';
      const sanitized = redactSensitiveData(input);
      assert.ok(!sanitized.includes('ghp_'));
      assert.ok(!sanitized.includes('gho_'));
      assert.ok(!sanitized.includes('ghu_'));
      assert.strictEqual((sanitized.match(/\[REDACTED_GITHUB_TOKEN\]/g) || []).length, 3);
    });

    it('redacts Bearer Authorization headers', () => {
      const input = 'Failed request headers: Authorization: Bearer abc123xyzSecretToken==; Content-Type: json';
      const sanitized = redactSensitiveData(input);
      assert.ok(!sanitized.includes('abc123xyzSecretToken'));
      assert.ok(sanitized.includes('Bearer [REDACTED_BEARER]'));
    });
  });

  describe('Error Classification for Retry Decisions', () => {
    it('classifies 401 Unauthorized as non-retryable', () => {
      const res = classifyNativeGitHubError(new GitHubUnauthorizedError());
      assert.strictEqual(res.retryable, false);
      assert.strictEqual(res.category, 'AUTHENTICATION');
    });

    it('classifies 403 Forbidden as non-retryable', () => {
      const res = classifyNativeGitHubError(new GitHubForbiddenError());
      assert.strictEqual(res.retryable, false);
      assert.strictEqual(res.category, 'PERMISSION');
    });

    it('classifies 5xx Server Error as retryable UPSTREAM_5XX', () => {
      const res = classifyNativeGitHubError(new GitHubServerError(503));
      assert.strictEqual(res.retryable, true);
      assert.strictEqual(res.category, 'UPSTREAM_5XX');
    });

    it('classifies Timeout as retryable TIMEOUT', () => {
      const res = classifyNativeGitHubError(new GitHubTimeoutError(5000));
      assert.strictEqual(res.retryable, true);
      assert.strictEqual(res.category, 'TIMEOUT');
    });

    it('classifies Network Error as retryable NETWORK', () => {
      const res = classifyNativeGitHubError(new GitHubNetworkError());
      assert.strictEqual(res.retryable, true);
      assert.strictEqual(res.category, 'NETWORK');
    });

    it('classifies primary rate limit as non-retryable within immediate request cycle', () => {
      const res = classifyNativeGitHubError(new GitHubRateLimitError('Primary rate limit', null, null, 'primary'));
      assert.strictEqual(res.retryable, false);
      assert.strictEqual(res.category, 'RATE_LIMIT');
    });

    it('classifies secondary rate limit with Retry-After as retryable', () => {
      const res = classifyNativeGitHubError(new GitHubRateLimitError('Secondary rate limit', null, 2, 'secondary'));
      assert.strictEqual(res.retryable, true);
      assert.strictEqual(res.rateLimit?.retryAfterSeconds, 2);
    });

    it('classifies standard GraphQL semantic errors as non-retryable', () => {
      const res = classifyNativeGitHubError(new GitHubGraphQLError([{ message: 'Could not resolve to a User' }]));
      assert.strictEqual(res.retryable, false);
      assert.strictEqual(res.category, 'GRAPHQL');
    });
  });

  describe('Backoff & Jitter Calculation', () => {
    it('produces delay bounded by min(maxDelay, initialDelay * factor^(attempt - 1))', () => {
      const config = {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffFactor: 2,
        maxTotalDurationMs: 5000,
        maxRetryAfterBudgetSeconds: 2,
      };

      for (let i = 0; i < 50; i++) {
        const d1 = calculateBackoffWithJitter(1, config);
        assert.ok(d1 >= 0 && d1 <= 100);

        const d2 = calculateBackoffWithJitter(2, config);
        assert.ok(d2 >= 0 && d2 <= 200);

        const d3 = calculateBackoffWithJitter(3, config);
        assert.ok(d3 >= 0 && d3 <= 400);

        const dLarge = calculateBackoffWithJitter(10, config);
        assert.ok(dLarge >= 0 && dLarge <= 1000);
      }
    });
  });

  describe('executeWithRetry Execution Flow', () => {
    it('succeeds immediately on first attempt without sleeping', async () => {
      let attempts = 0;
      let slept = 0;
      const res = await executeWithRetry(
        async (attempt) => {
          attempts = attempt;
          return 'success_val';
        },
        {
          sleepFn: async (ms) => {
            slept += ms;
          },
        }
      );

      assert.strictEqual(res, 'success_val');
      assert.strictEqual(attempts, 1);
      assert.strictEqual(slept, 0);
    });

    it('retries transient 503 errors and succeeds on attempt 2', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const res = await executeWithRetry(
        async (attempt) => {
          attempts = attempt;
          if (attempt === 1) {
            throw new GitHubServerError(503, 'Upstream overloaded');
          }
          return 'recovered';
        },
        {
          sleepFn: async (ms) => {
            delays.push(ms);
          },
        }
      );

      assert.strictEqual(res, 'recovered');
      assert.strictEqual(attempts, 2);
      assert.strictEqual(delays.length, 1);
      assert.ok(delays[0] >= 0);
    });

    it('fails fast on 401 Unauthorized without retrying', async () => {
      let attempts = 0;
      let slept = false;

      await assert.rejects(
        async () => {
          await executeWithRetry(
            async (attempt) => {
              attempts = attempt;
              throw new GitHubUnauthorizedError('Bad token');
            },
            {
              sleepFn: async () => {
                slept = true;
              },
            }
          );
        },
        (err) => err instanceof GitHubUnauthorizedError
      );

      assert.strictEqual(attempts, 1);
      assert.strictEqual(slept, false);
    });

    it('fails fast on 403 Forbidden without retrying', async () => {
      let attempts = 0;
      let slept = false;

      await assert.rejects(
        async () => {
          await executeWithRetry(
            async (attempt) => {
              attempts = attempt;
              throw new GitHubForbiddenError('Forbidden');
            },
            {
              sleepFn: async () => {
                slept = true;
              },
            }
          );
        },
        (err) => err instanceof GitHubForbiddenError
      );

      assert.strictEqual(attempts, 1);
      assert.strictEqual(slept, false);
    });

    it('exhausts maxAttempts and throws the final error', async () => {
      let attempts = 0;
      const delays: number[] = [];

      await assert.rejects(
        async () => {
          await executeWithRetry(
            async (attempt) => {
              attempts = attempt;
              throw new GitHubServerError(500, 'Internal error');
            },
            {
              config: { maxAttempts: 3 },
              sleepFn: async (ms) => {
                delays.push(ms);
              },
            }
          );
        },
        (err) => err instanceof GitHubServerError && (err as GitHubServerError).status === 500
      );

      assert.strictEqual(attempts, 3);
      assert.strictEqual(delays.length, 2); // slept between 1->2 and 2->3
    });

    it('aborts when total elapsed time exceeds maxTotalDurationMs', async () => {
      let nowTime = 1000;
      let attempts = 0;

      await assert.rejects(
        async () => {
          await executeWithRetry(
            async (attempt) => {
              attempts = attempt;
              nowTime += 6000; // Jump time ahead past 10s budget
              throw new GitHubServerError(502, 'Bad gateway');
            },
            {
              config: { maxTotalDurationMs: 5000 },
              nowFn: () => nowTime,
              sleepFn: async () => {},
            }
          );
        },
        (err) => err instanceof GitHubServerError
      );

      assert.strictEqual(attempts, 1); // Could not retry because remaining budget was negative
    });
  });

  describe('NativeGitHubGraphQLClient HTTP & Payload Handling', () => {
    it('executes successful GraphQL query with correct headers and payload', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: Record<string, unknown> = {};

      setFetchImplementation(async (url, init) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method ?? '';
        capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
        capturedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            data: { user: { login: 'mnp210' } },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'x-ratelimit-remaining': '999',
            },
          }
        );
      });

      const client = new NativeGitHubGraphQLClient();
      const result = await client.execute<{ user: { login: string } }>(
        SAMPLE_QUERY,
        { login: 'mnp210' },
        SAMPLE_TOKEN
      );

      assert.strictEqual(capturedUrl, 'https://api.github.com/graphql');
      assert.strictEqual(capturedMethod, 'POST');
      assert.strictEqual(capturedHeaders['authorization'], `Bearer ${SAMPLE_TOKEN}`);
      assert.strictEqual(capturedHeaders['content-type'], 'application/json');
      assert.strictEqual(capturedHeaders['user-agent'], 'GitHub-Profile-Pet');
      assert.strictEqual(capturedBody.query, SAMPLE_QUERY);
      assert.deepStrictEqual(result, { user: { login: 'mnp210' } });
    });

    it('rejects partial data when payload contains GraphQL errors', async () => {
      setFetchImplementation(async () => {
        return new Response(
          JSON.stringify({
            data: { user: { login: 'mnp210' } },
            errors: [{ message: 'Field totalContributions has an error' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const client = new NativeGitHubGraphQLClient();
      await assert.rejects(
        async () => {
          await client.execute(SAMPLE_QUERY, {}, SAMPLE_TOKEN, {
            retryPolicy: { maxAttempts: 1 },
          });
        },
        (err) =>
          err instanceof GitHubGraphQLError &&
          err.errors[0].message.includes('Field totalContributions has an error')
      );
    });

    it('throws GitHubUnauthorizedError on HTTP 401', async () => {
      setFetchImplementation(async () => {
        return new Response('Unauthorized', { status: 401 });
      });

      const client = new NativeGitHubGraphQLClient();
      await assert.rejects(
        async () => {
          await client.execute(SAMPLE_QUERY, {}, SAMPLE_TOKEN);
        },
        (err) => err instanceof GitHubUnauthorizedError
      );
    });

    it('throws GitHubForbiddenError on HTTP 403', async () => {
      setFetchImplementation(async () => {
        return new Response('Resource protected', { status: 403 });
      });

      const client = new NativeGitHubGraphQLClient();
      await assert.rejects(
        async () => {
          await client.execute(SAMPLE_QUERY, {}, SAMPLE_TOKEN);
        },
        (err) => err instanceof GitHubForbiddenError
      );
    });

    it('throws GitHubRateLimitError on HTTP 429', async () => {
      setFetchImplementation(async () => {
        return new Response('Rate limit reached', {
          status: 429,
          headers: {
            'retry-after': '60',
          },
        });
      });

      const client = new NativeGitHubGraphQLClient();
      await assert.rejects(
        async () => {
          await client.execute(SAMPLE_QUERY, {}, SAMPLE_TOKEN, {
            retryPolicy: { maxAttempts: 1 },
          });
        },
        (err) => err instanceof GitHubRateLimitError && err.retryAfterSeconds === 60
      );
    });

    it('throws GitHubServerError on HTTP 500', async () => {
      setFetchImplementation(async () => {
        return new Response('Internal error', { status: 500 });
      });

      const client = new NativeGitHubGraphQLClient();
      await assert.rejects(
        async () => {
          await client.execute(SAMPLE_QUERY, {}, SAMPLE_TOKEN, {
            retryPolicy: { maxAttempts: 1 },
          });
        },
        (err) => err instanceof GitHubServerError && err.status === 500
      );
    });
  });

  describe('Strict Header Parsing & Rate-Limit Telemetry', () => {
    it('parseStrictHeaderInteger strictly validates numeric integer tokens', () => {
      assert.equal(parseStrictHeaderInteger('5000'), 5000);
      assert.equal(parseStrictHeaderInteger('0'), 0);
      assert.equal(parseStrictHeaderInteger('  1234  '), 1234);
      assert.equal(parseStrictHeaderInteger('5000abc'), null);
      assert.equal(parseStrictHeaderInteger('abc5000'), null);
      assert.equal(parseStrictHeaderInteger('12.34'), null);
      assert.equal(parseStrictHeaderInteger('-10'), null);
      assert.equal(parseStrictHeaderInteger('+10'), null);
      assert.equal(parseStrictHeaderInteger(''), null);
      assert.equal(parseStrictHeaderInteger('   '), null);
      assert.equal(parseStrictHeaderInteger(null), null);
    });

    it('captures raw and strictly parsed rate-limit headers in onResponseHeaders', async () => {
      let capturedLimit: number | null = 1;
      let capturedRawLimit: string | null = '';
      let capturedRemaining: number | null = 0;
      let capturedResource: string | null = '';

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: { user: { login: 'octocat' } } }), {
          status: 200,
          headers: {
            'x-ratelimit-limit': '5000abc',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-used': '1',
            'x-ratelimit-reset': '1794841239',
            'x-ratelimit-resource': 'graphql',
          },
        });
      });

      const client = new NativeGitHubGraphQLClient();
      await client.execute(SAMPLE_QUERY, {}, SAMPLE_TOKEN, {
        onResponseHeaders: (h) => {
          capturedLimit = h.limit;
          capturedRawLimit = h.raw?.limit ?? null;
          capturedRemaining = h.remaining;
          capturedResource = h.resource;
        },
      });

      assert.equal(capturedLimit, null); // rejected because '5000abc' is partially numeric
      assert.equal(capturedRawLimit, '5000abc'); // raw string preserved for diagnostic discrepancy reporting
      assert.equal(capturedRemaining, 4999);
      assert.equal(capturedResource, 'graphql');
    });
  });
});
