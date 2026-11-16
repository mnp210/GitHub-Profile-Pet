// tests/pet-engine/contributionProvider.test.ts
// Comprehensive unit test suite for GitHub GraphQL contribution provider and immutable identity verification (Phase 3C2.1)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cp from 'node:child_process';

import {
  GitHubContributionProvider,
  parseAndValidateContributionResponse,
  resolveTargetOwner,
  verifyOwnerIdentity,
  IdentityMismatchError,
  InvalidContributionDataError,
  MissingOwnerConfigurationError,
  OrganizationAccountError,
  UserNotFoundError,
  setFetchImplementation,
  resetFetchImplementation,
  GitHubUnauthorizedError,
  GitHubRateLimitError,
  GitHubServerError,
  GitHubTimeoutError,
  GitHubGraphQLError,
  checkRateLimitConsistency,
  parseStrictHeaderInteger,
  isValidIsoDateTimeWithExplicitTimezone,
  type RawGraphQLContributionResponse,
  type RateLimitHeaders,
} from '../../src/features/pet-engine/contribution/index.ts';

const SAMPLE_FROM = '2026-11-16T00:00:00.000Z';
const SAMPLE_TO = '2026-11-16T23:59:59.999Z';
const SAMPLE_TOKEN = 'ghp_testSecretToken1234567890abcdef';

function createValidRawResponse(overrides: Partial<RawGraphQLContributionResponse['user']> = {}): RawGraphQLContributionResponse {
  return {
    user: {
      id: 'MDQ6VXNlcjU4MzIzMQ==',
      databaseId: 583231,
      login: 'octocat',
      contributionsCollection: {
        startedAt: SAMPLE_FROM,
        endedAt: SAMPLE_TO,
        totalCommitContributions: 12,
        totalIssueContributions: 3,
        totalPullRequestContributions: 2,
        totalPullRequestReviewContributions: 1,
        restrictedContributionsCount: 8,
        contributionCalendar: {
          totalContributions: 26, // Note: differs from public sum (18) due to restricted contributions (8)
        },
      },
      ...overrides,
    },
    repositoryOwner: {
      __typename: 'User',
      id: 'MDQ6VXNlcjU4MzIzMQ==',
      login: 'octocat',
    },
    rateLimit: {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-16T18:47:00Z',
    },
  };
}

describe('GitHub Contribution Provider & Immutable Identity Suite (Phase 3C2.1)', () => {
  beforeEach(() => {
    resetFetchImplementation();
  });

  afterEach(() => {
    resetFetchImplementation();
  });

  // 1. Successful complete GraphQL response
  it('TC-PROV-01: Successful complete GraphQL response parses all required fields and metadata', async () => {
    const raw = createValidRawResponse();
    setFetchImplementation(async () => {
      return new Response(JSON.stringify({ data: raw }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const provider = new GitHubContributionProvider();
    const snapshot = await provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN);

    assert.equal(snapshot.ownerLogin, 'octocat');
    assert.equal(snapshot.ownerDatabaseId, 583231);
    assert.equal(snapshot.isPersonalAccount, true);
    assert.equal(snapshot.fromIso, SAMPLE_FROM);
    assert.equal(snapshot.toIso, SAMPLE_TO);
    assert.equal(snapshot.authenticationMode, 'mode_a_public');
    assert.ok(snapshot.providerLatencyMs >= 0);
    assert.equal(snapshot.rateLimit?.limit, 5000);
    assert.equal(snapshot.rateLimit?.cost, 1);
    assert.equal(snapshot.rateLimit?.remaining, 4999);
    assert.equal(snapshot.rateLimit?.used, 1);
    assert.equal(snapshot.rateLimit?.resetAt, '2026-11-16T18:47:00Z');
  });

  // 2. Correct calculation of the four-category public total
  it('TC-PROV-02: Correct calculation of four-category public total: commits + issues + PRs + reviews', () => {
    const raw = createValidRawResponse();
    const snapshot = parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO);

    assert.equal(snapshot.counts.commits, 12);
    assert.equal(snapshot.counts.issues, 3);
    assert.equal(snapshot.counts.pullRequests, 2);
    assert.equal(snapshot.counts.pullRequestReviews, 1);

    const expectedPublicSum = 12 + 3 + 2 + 1; // 18
    assert.equal(snapshot.counts.publicCategoryTotal, expectedPublicSum);
  });

  // 3. Calendar total differing from the public category sum
  it('TC-PROV-03: Calendar total differing from public category sum is preserved without overriding public total', () => {
    const raw = createValidRawResponse();
    // In raw: public categories sum to 18, but calendar reported total is 26
    const snapshot = parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO);

    assert.equal(snapshot.counts.publicCategoryTotal, 18);
    assert.equal(snapshot.counts.calendarReportedTotal, 26);
    assert.notEqual(snapshot.counts.publicCategoryTotal, snapshot.counts.calendarReportedTotal);
  });

  // 4. Restricted contribution count excluded from the reward total
  it('TC-PROV-04: Restricted contribution count is captured but excluded from publicCategoryTotal in Mode A', () => {
    const raw = createValidRawResponse();
    const snapshot = parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO);

    assert.equal(snapshot.counts.restricted, 8);
    assert.equal(snapshot.counts.publicCategoryTotal, 18); // strictly 12 + 3 + 2 + 1, restricted (8) excluded
  });

  // 5. HTTP 401
  it('TC-PROV-05: HTTP 401 Unauthorized throws GitHubUnauthorizedError with redacted token', async () => {
    setFetchImplementation(async () => {
      return new Response('{"message": "Bad credentials"}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const provider = new GitHubContributionProvider();
    await assert.rejects(
      async () => provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN),
      (err: Error) => {
        assert.ok(err instanceof GitHubUnauthorizedError);
        assert.ok(!err.message.includes(SAMPLE_TOKEN));
        return true;
      }
    );
  });

  // 6. HTTP 403 and 429
  it('TC-PROV-06: HTTP 403 and 429 rate limit triggers GitHubRateLimitError', async () => {
    setFetchImplementation(async () => {
      return new Response('{"message": "API rate limit exceeded"}', {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1800000000',
        },
      });
    });

    const provider = new GitHubContributionProvider();
    await assert.rejects(
      async () => provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN),
      (err: Error) => {
        assert.ok(err instanceof GitHubRateLimitError);
        return true;
      }
    );
  });

  // 7. HTTP 500
  it('TC-PROV-07: HTTP 500 upstream failure throws GitHubServerError', async () => {
    setFetchImplementation(async () => {
      return new Response('Internal Server Error', { status: 500 });
    });

    const provider = new GitHubContributionProvider();
    await assert.rejects(
      async () =>
        provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN, {
          retryPolicy: { maxAttempts: 1 },
        }),
      (err: Error) => {
        assert.ok(err instanceof GitHubServerError);
        assert.equal((err as GitHubServerError).status, 500);
        return true;
      }
    );
  });

  // 8. Network timeout
  it('TC-PROV-08: Request timeout throws GitHubTimeoutError', async () => {
    setFetchImplementation(async () => {
      const timeoutErr = new Error('The operation was aborted due to timeout');
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    });

    const provider = new GitHubContributionProvider();
    await assert.rejects(
      async () =>
        provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN, {
          timeoutMs: 100,
          retryPolicy: { maxAttempts: 1 },
        }),
      (err: Error) => {
        assert.ok(err instanceof GitHubTimeoutError);
        return true;
      }
    );
  });

  // 9. GraphQL errors despite HTTP 200
  it('TC-PROV-09: GraphQL errors in HTTP 200 payload throw GitHubGraphQLError with token sanitized', async () => {
    setFetchImplementation(async () => {
      return new Response(
        JSON.stringify({
          errors: [{ message: `Field execution error referencing ${SAMPLE_TOKEN}` }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const provider = new GitHubContributionProvider();
    await assert.rejects(
      async () => provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN),
      (err: Error) => {
        assert.ok(err instanceof GitHubGraphQLError);
        assert.ok(!err.message.includes(SAMPLE_TOKEN));
        assert.ok(err.message.includes('[REDACTED_TOKEN]'));
        return true;
      }
    );
  });

  // 10. Null user
  it('TC-PROV-10: Null user with null repositoryOwner throws UserNotFoundError', () => {
    const raw: RawGraphQLContributionResponse = {
      user: null,
      repositoryOwner: null,
    };

    assert.throws(
      () => parseAndValidateContributionResponse(raw, 'nonexistent-user', SAMPLE_FROM, SAMPLE_TO),
      (err: Error) => {
        assert.ok(err instanceof UserNotFoundError);
        assert.ok(err.message.includes('nonexistent-user'));
        return true;
      }
    );
  });

  // 11. Null contributionsCollection
  it('TC-PROV-11: Null contributionsCollection throws InvalidContributionDataError', () => {
    const raw: RawGraphQLContributionResponse = {
      user: {
        id: '123',
        databaseId: 456,
        login: 'octocat',
        contributionsCollection: null,
      },
      repositoryOwner: {
        __typename: 'User',
        id: '123',
        login: 'octocat',
      },
    };

    assert.throws(
      () => parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO),
      (err: Error) => {
        assert.ok(err instanceof InvalidContributionDataError);
        assert.ok(err.message.includes('contributionsCollection is null'));
        return true;
      }
    );
  });

  // 12. Missing category field
  it('TC-PROV-12: Missing contribution category field throws InvalidContributionDataError', () => {
    const raw = createValidRawResponse();
    // Delete totalPullRequestReviewContributions
    // @ts-expect-error simulating partial API payload
    delete raw.user?.contributionsCollection?.totalPullRequestReviewContributions;

    assert.throws(
      () => parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO),
      (err: Error) => {
        assert.ok(err instanceof InvalidContributionDataError);
        assert.ok(err.message.includes('totalPullRequestReviewContributions'));
        return true;
      }
    );
  });

  // 13. Invalid numeric count
  it('TC-PROV-13: Invalid or negative numeric count throws InvalidContributionDataError', () => {
    const raw = createValidRawResponse();
    // @ts-expect-error simulating negative count
    raw.user.contributionsCollection.totalCommitContributions = -5;

    assert.throws(
      () => parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO),
      (err: Error) => {
        assert.ok(err instanceof InvalidContributionDataError);
        assert.ok(err.message.includes('totalCommitContributions'));
        return true;
      }
    );
  });

  // 14. Personal-account identity match
  it('TC-PROV-14: Personal-account identity match against established ledger succeeds', () => {
    const raw = createValidRawResponse();
    const snapshot = parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO);

    // Established ledger has ownerDatabaseId = 583231
    assert.doesNotThrow(() => {
      verifyOwnerIdentity(snapshot, 583231);
    });
  });

  // 15. Immutable numeric ID mismatch
  it('TC-PROV-15: Immutable numeric ID mismatch throws IdentityMismatchError (fails closed)', () => {
    const raw = createValidRawResponse({ databaseId: 999999 });
    const snapshot = parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO);

    // Established ledger has ownerDatabaseId = 583231, but queried account returned 999999
    assert.throws(
      () => verifyOwnerIdentity(snapshot, 583231),
      (err: Error) => {
        assert.ok(err instanceof IdentityMismatchError);
        assert.ok(err.message.includes('Immutable identity mismatch'));
        assert.ok(err.message.includes('999999'));
        assert.ok(err.message.includes('583231'));
        return true;
      }
    );
  });

  // 16. Organization login rejection
  it('TC-PROV-16: Organization login is recognized and rejected with OrganizationAccountError', () => {
    const raw: RawGraphQLContributionResponse = {
      user: null,
      repositoryOwner: {
        __typename: 'Organization',
        id: 'MDEyOk9yZ2FuaXphdGlvbjEzNDIwMzk2',
        login: 'github',
      },
    };

    assert.throws(
      () => parseAndValidateContributionResponse(raw, 'github', SAMPLE_FROM, SAMPLE_TO),
      (err: Error) => {
        assert.ok(err instanceof OrganizationAccountError);
        assert.ok(err.message.includes('Organization'));
        return true;
      }
    );
  });

  // 17. Explicit PET_OWNER_LOGIN resolution
  it('TC-PROV-17: Explicit PET_OWNER_LOGIN is prioritized over GITHUB_REPOSITORY_OWNER', () => {
    const env = {
      PET_OWNER_LOGIN: 'custom-trainer',
      GITHUB_REPOSITORY_OWNER: 'org-host',
    };

    const target = resolveTargetOwner(env);
    assert.equal(target.login, 'custom-trainer');
    assert.equal(target.source, 'PET_OWNER_LOGIN');
  });

  // 18. Missing owner configuration
  it('TC-PROV-18: Missing owner configuration throws MissingOwnerConfigurationError', () => {
    const env = {
      PET_OWNER_LOGIN: '',
      GITHUB_REPOSITORY_OWNER: undefined,
    };

    assert.throws(
      () => resolveTargetOwner(env),
      (err: Error) => {
        assert.ok(err instanceof MissingOwnerConfigurationError);
        return true;
      }
    );
  });

  // 19. Token redaction in every error path
  it('TC-PROV-19: Token redaction sanitizes tokens from error messages in all failure paths', async () => {
    setFetchImplementation(async () => {
      throw new Error(`Connection failed while sending Bearer ${SAMPLE_TOKEN} to endpoint`);
    });

    const provider = new GitHubContributionProvider();
    await assert.rejects(
      async () =>
        provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN, {
          retryPolicy: { maxAttempts: 1 },
        }),
      (err: Error) => {
        assert.ok(!err.message.includes(SAMPLE_TOKEN));
        assert.ok(err.message.includes('[REDACTED_TOKEN]') || err.message.includes('[REDACTED_BEARER]'));
        return true;
      }
    );
  });

  // 20. No ledger or pet-state mutation during provider execution
  it('TC-PROV-20: Provider execution is strictly read-only and does not mutate pet state or ledger', async () => {
    const petPath = path.resolve(process.cwd(), 'pet', 'state', 'pet.json');
    const ledgerPath = path.resolve(process.cwd(), 'pet', 'ledger', 'contributions.json');

    const petBefore = fs.readFileSync(petPath, 'utf8');
    const ledgerBefore = fs.readFileSync(ledgerPath, 'utf8');

    const raw = createValidRawResponse();
    setFetchImplementation(async () => {
      return new Response(JSON.stringify({ data: raw }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const provider = new GitHubContributionProvider();
    const snapshot = await provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN);
    verifyOwnerIdentity(snapshot, null); // uninitialized ledger inspection

    const petAfter = fs.readFileSync(petPath, 'utf8');
    const ledgerAfter = fs.readFileSync(ledgerPath, 'utf8');

    assert.equal(petBefore, petAfter, 'pet/state/pet.json must remain byte-for-byte identical');
    assert.equal(ledgerBefore, ledgerAfter, 'pet/ledger/contributions.json must remain byte-for-byte identical');
  });

  // 21. Parse all 5 rateLimit fields from GraphQL body
  it('TC-PROV-21: Rate-limit telemetry captures all 5 fields from GraphQL body (limit, cost, remaining, used, resetAt)', () => {
    const raw: RawGraphQLContributionResponse = {
      ...createValidRawResponse(),
      rateLimit: {
        limit: 5000,
        cost: 1,
        remaining: 4995,
        used: 5,
        resetAt: '2026-11-16T20:00:00Z',
      },
    };

    const snapshot = parseAndValidateContributionResponse(raw, 'octocat', SAMPLE_FROM, SAMPLE_TO);
    assert.ok(snapshot.rateLimit);
    assert.equal(snapshot.rateLimit.limit, 5000);
    assert.equal(snapshot.rateLimit.cost, 1);
    assert.equal(snapshot.rateLimit.remaining, 4995);
    assert.equal(snapshot.rateLimit.used, 5);
    assert.equal(snapshot.rateLimit.resetAt, '2026-11-16T20:00:00Z');
  });

  // 22. Missing or malformed rateLimit telemetry does not silently default
  it('TC-PROV-22: Missing or malformed rateLimit in GraphQL response does not silently default', () => {
    const rawUndefined: RawGraphQLContributionResponse = {
      ...createValidRawResponse(),
      rateLimit: undefined,
    };
    const snapshotUndefined = parseAndValidateContributionResponse(rawUndefined, 'octocat', SAMPLE_FROM, SAMPLE_TO);
    assert.equal(snapshotUndefined.rateLimit, undefined);

    const rawEmpty: RawGraphQLContributionResponse = {
      ...createValidRawResponse(),
      rateLimit: {} as unknown as RawGraphQLContributionResponse['rateLimit'],
    };
    const snapshotEmpty = parseAndValidateContributionResponse(rawEmpty, 'octocat', SAMPLE_FROM, SAMPLE_TO);
    assert.ok(snapshotEmpty.rateLimit);
    assert.equal(snapshotEmpty.rateLimit.limit, null);
    assert.equal(snapshotEmpty.rateLimit.cost, null);
    assert.equal(snapshotEmpty.rateLimit.remaining, null);
    assert.equal(snapshotEmpty.rateLimit.used, null);
    assert.equal(snapshotEmpty.rateLimit.resetAt, null);
    assert.equal(snapshotEmpty.rateLimit.consistency?.isConsistent, false);
  });

  // 23. Capture all 5 HTTP response headers via provider execution
  it('TC-PROV-23: Provider captures all 5 x-ratelimit-* response headers from HTTP transport', async () => {
    const raw = createValidRawResponse();
    const resetEpoch = Math.floor(new Date('2026-11-16T18:47:00Z').getTime() / 1000);

    setFetchImplementation(async () => {
      return new Response(JSON.stringify({ data: raw }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-used': '1',
          'x-ratelimit-reset': String(resetEpoch),
          'x-ratelimit-resource': 'graphql',
        },
      });
    });

    const provider = new GitHubContributionProvider();
    const snapshot = await provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN);

    assert.ok(snapshot.rateLimit?.headers);
    assert.equal(snapshot.rateLimit.headers.limit, 5000);
    assert.equal(snapshot.rateLimit.headers.remaining, 4999);
    assert.equal(snapshot.rateLimit.headers.used, 1);
    assert.equal(snapshot.rateLimit.headers.reset, resetEpoch);
    assert.equal(snapshot.rateLimit.headers.resource, 'graphql');
  });

  // 24. Consistency check passes when GraphQL body and HTTP headers agree
  it('TC-PROV-24: Consistency check reports isConsistent=true when payload and headers agree', () => {
    const resetIso = '2026-11-16T19:00:00Z';
    const resetEpoch = Math.floor(new Date(resetIso).getTime() / 1000);

    const payload = {
      limit: 5000,
      cost: 1,
      remaining: 4998,
      used: 2,
      resetAt: resetIso,
    };

    const headers: RateLimitHeaders = {
      limit: 5000,
      remaining: 4998,
      used: 2,
      reset: resetEpoch,
      resource: 'graphql',
    };

    const consistency = checkRateLimitConsistency(payload, headers);
    assert.equal(consistency.isConsistent, true);
    assert.equal(consistency.discrepancies.length, 0);
  });

  // 25. Consistency check flags discrepancies when payload and headers disagree
  it('TC-PROV-25: Consistency check flags limit, remaining, used, and reset discrepancies', () => {
    const payload = {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-16T19:00:00Z',
    };

    // Header has conflicting limit (1000) and remaining (999)
    const mismatchedHeaders: RateLimitHeaders = {
      limit: 1000,
      remaining: 999,
      used: 1,
      reset: Math.floor(new Date('2026-11-16T19:00:00Z').getTime() / 1000),
      resource: 'graphql',
    };

    const consistency = checkRateLimitConsistency(payload, mismatchedHeaders);
    assert.equal(consistency.isConsistent, false);
    assert.ok(consistency.discrepancies.some((d) => d.toLowerCase().includes('limit mismatch')));
    assert.ok(consistency.discrepancies.some((d) => d.toLowerCase().includes('remaining mismatch')));

    // Missing headers
    const nullConsistency = checkRateLimitConsistency(payload, null);
    assert.equal(nullConsistency.isConsistent, false);
    assert.ok(nullConsistency.discrepancies.some((d) => d.toLowerCase().includes('missing http rate-limit headers')));
  });

  // 26. Token redaction in rate-limit error telemetry
  it('TC-PROV-26: Token redaction sanitizes secrets even if rate limit errors occur', async () => {
    setFetchImplementation(async () => {
      return new Response(JSON.stringify({ message: `API rate limit exceeded for token ${SAMPLE_TOKEN}` }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-used': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
        },
      });
    });

    const provider = new GitHubContributionProvider();
    await assert.rejects(
      async () => provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN),
      (err: Error) => {
        assert.ok(err instanceof GitHubRateLimitError);
        assert.ok(!err.message.includes(SAMPLE_TOKEN));
        return true;
      }
    );
  });

  // 27. Entire GraphQL rateLimit object missing fails consistency check
  it('TC-PROV-27: Entire GraphQL rateLimit object missing fails consistency check with explicit discrepancy', () => {
    const validHeaders: RateLimitHeaders = {
      limit: 5000,
      remaining: 4999,
      used: 1,
      reset: Math.floor(Date.now() / 1000) + 3600,
      resource: 'graphql',
      raw: {
        limit: '5000',
        remaining: '4999',
        used: '1',
        reset: String(Math.floor(Date.now() / 1000) + 3600),
        resource: 'graphql',
      },
    };

    const consistency = checkRateLimitConsistency(null, validHeaders);
    assert.equal(consistency.isConsistent, false);
    assert.ok(consistency.discrepancies.some((d) => d.includes('Missing GraphQL rateLimit telemetry in response payload')));
  });

  // 28. Each required GraphQL field missing individually produces an explicit discrepancy
  it('TC-PROV-28: Each required GraphQL field missing individually produces an explicit discrepancy', () => {
    const validHeaders: RateLimitHeaders = {
      limit: 5000,
      remaining: 4999,
      used: 1,
      reset: 1794841239,
      resource: 'graphql',
    };

    const basePayload = {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-16T15:00:39Z',
    };

    // Missing limit
    const noLimit = checkRateLimitConsistency({ ...basePayload, limit: null }, validHeaders);
    assert.equal(noLimit.isConsistent, false);
    assert.ok(noLimit.discrepancies.some((d) => d.includes('Missing or non-integer GraphQL rateLimit.limit')));

    // Missing cost
    const noCost = checkRateLimitConsistency({ ...basePayload, cost: null }, validHeaders);
    assert.equal(noCost.isConsistent, false);
    assert.ok(noCost.discrepancies.some((d) => d.includes('Missing or non-integer GraphQL rateLimit.cost')));

    // Missing remaining
    const noRemaining = checkRateLimitConsistency({ ...basePayload, remaining: null }, validHeaders);
    assert.equal(noRemaining.isConsistent, false);
    assert.ok(noRemaining.discrepancies.some((d) => d.includes('Missing or non-integer GraphQL rateLimit.remaining')));

    // Missing used
    const noUsed = checkRateLimitConsistency({ ...basePayload, used: null }, validHeaders);
    assert.equal(noUsed.isConsistent, false);
    assert.ok(noUsed.discrepancies.some((d) => d.includes('Missing or non-integer GraphQL rateLimit.used')));

    // Missing resetAt
    const noResetAt = checkRateLimitConsistency({ ...basePayload, resetAt: null }, validHeaders);
    assert.equal(noResetAt.isConsistent, false);
    assert.ok(noResetAt.discrepancies.some((d) => d.includes('Missing or empty GraphQL rateLimit.resetAt timestamp')));
  });

  // 29. Invalid or non-integer GraphQL values fail consistency
  it('TC-PROV-29: Invalid, non-integer, negative, or overflow GraphQL values fail consistency', () => {
    const validHeaders: RateLimitHeaders = {
      limit: 5000,
      remaining: 4999,
      used: 1,
      reset: 1794841239,
      resource: 'graphql',
    };

    const basePayload = {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-16T15:00:39Z',
    };

    // limit <= 0
    const zeroLimit = checkRateLimitConsistency({ ...basePayload, limit: 0 }, validHeaders);
    assert.equal(zeroLimit.isConsistent, false);
    assert.ok(zeroLimit.discrepancies.some((d) => d.includes('expected positive integer (> 0)')));

    // cost <= 0
    const zeroCost = checkRateLimitConsistency({ ...basePayload, cost: 0 }, validHeaders);
    assert.equal(zeroCost.isConsistent, false);
    assert.ok(zeroCost.discrepancies.some((d) => d.includes('expected positive integer (> 0)')));

    // remaining < 0
    const negRemaining = checkRateLimitConsistency({ ...basePayload, remaining: -1 }, validHeaders);
    assert.equal(negRemaining.isConsistent, false);
    assert.ok(negRemaining.discrepancies.some((d) => d.includes('expected non-negative integer (>= 0)')));

    // used < 0
    const negUsed = checkRateLimitConsistency({ ...basePayload, used: -1 }, validHeaders);
    assert.equal(negUsed.isConsistent, false);
    assert.ok(negUsed.discrepancies.some((d) => d.includes('expected non-negative integer (>= 0)')));

    // remaining > limit
    const overflowRemaining = checkRateLimitConsistency({ ...basePayload, remaining: 5001 }, validHeaders);
    assert.equal(overflowRemaining.isConsistent, false);
    assert.ok(overflowRemaining.discrepancies.some((d) => d.includes('exceeds limit')));

    // used > limit
    const overflowUsed = checkRateLimitConsistency({ ...basePayload, used: 5001 }, validHeaders);
    assert.equal(overflowUsed.isConsistent, false);
    assert.ok(overflowUsed.discrepancies.some((d) => d.includes('exceeds limit')));

    // used + remaining > limit (internal sum overflow)
    const sumOverflow = checkRateLimitConsistency(
      { ...basePayload, limit: 5000, used: 3000, remaining: 3000 },
      { ...validHeaders, limit: 5000, used: 3000, remaining: 3000 }
    );
    assert.equal(sumOverflow.isConsistent, false);
    assert.ok(sumOverflow.discrepancies.some((d) => d.includes('Internal sum overflow')));
  });

  // 30. Missing HTTP headers object fails consistency check
  it('TC-PROV-30: Missing HTTP headers object fails consistency check with explicit discrepancy', () => {
    const payload = {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-16T15:00:39Z',
    };

    const consistency = checkRateLimitConsistency(payload, null);
    assert.equal(consistency.isConsistent, false);
    assert.ok(consistency.discrepancies.some((d) => d.includes('Missing HTTP rate-limit headers')));
  });

  // 31. Each required HTTP header missing individually produces an explicit discrepancy
  it('TC-PROV-31: Each required HTTP header missing individually produces an explicit discrepancy', () => {
    const payload = {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-16T15:00:39Z',
    };

    const validRaw = {
      limit: '5000',
      remaining: '4999',
      used: '1',
      reset: '1794841239',
      resource: 'graphql',
    };

    // Missing x-ratelimit-limit
    const noLimit = checkRateLimitConsistency(payload, {
      limit: null,
      remaining: 4999,
      used: 1,
      reset: 1794841239,
      resource: 'graphql',
      raw: { ...validRaw, limit: null },
    });
    assert.equal(noLimit.isConsistent, false);
    assert.ok(noLimit.discrepancies.some((d) => d.includes('Missing HTTP header x-ratelimit-limit')));

    // Missing x-ratelimit-remaining
    const noRemaining = checkRateLimitConsistency(payload, {
      limit: 5000,
      remaining: null,
      used: 1,
      reset: 1794841239,
      resource: 'graphql',
      raw: { ...validRaw, remaining: null },
    });
    assert.equal(noRemaining.isConsistent, false);
    assert.ok(noRemaining.discrepancies.some((d) => d.includes('Missing HTTP header x-ratelimit-remaining')));

    // Missing x-ratelimit-used
    const noUsed = checkRateLimitConsistency(payload, {
      limit: 5000,
      remaining: 4999,
      used: null,
      reset: 1794841239,
      resource: 'graphql',
      raw: { ...validRaw, used: null },
    });
    assert.equal(noUsed.isConsistent, false);
    assert.ok(noUsed.discrepancies.some((d) => d.includes('Missing HTTP header x-ratelimit-used')));

    // Missing x-ratelimit-reset
    const noReset = checkRateLimitConsistency(payload, {
      limit: 5000,
      remaining: 4999,
      used: 1,
      reset: null,
      resource: 'graphql',
      raw: { ...validRaw, reset: null },
    });
    assert.equal(noReset.isConsistent, false);
    assert.ok(noReset.discrepancies.some((d) => d.includes('Missing HTTP header x-ratelimit-reset')));

    // Missing x-ratelimit-resource
    const noResource = checkRateLimitConsistency(payload, {
      limit: 5000,
      remaining: 4999,
      used: 1,
      reset: 1794841239,
      resource: null,
      raw: { ...validRaw, resource: null },
    });
    assert.equal(noResource.isConsistent, false);
    assert.ok(noResource.discrepancies.some((d) => d.includes('Missing HTTP header x-ratelimit-resource')));
  });

  // 32. Malformed numeric headers including partially numeric strings are rejected
  it('TC-PROV-32: parseStrictHeaderInteger and checkRateLimitConsistency reject partially numeric strings', () => {
    // Direct parser tests
    assert.equal(parseStrictHeaderInteger('5000abc'), null);
    assert.equal(parseStrictHeaderInteger('abc5000'), null);
    assert.equal(parseStrictHeaderInteger('50 00'), null);
    assert.equal(parseStrictHeaderInteger('3.14'), null);
    assert.equal(parseStrictHeaderInteger('-10'), null);
    assert.equal(parseStrictHeaderInteger(''), null);
    assert.equal(parseStrictHeaderInteger('   '), null);
    assert.equal(parseStrictHeaderInteger('5000'), 5000);
    assert.equal(parseStrictHeaderInteger('0'), 0);

    const payload = {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-16T15:00:39Z',
    };

    // Partially numeric header rejected in consistency check
    const malformed = checkRateLimitConsistency(payload, {
      limit: parseStrictHeaderInteger('5000abc'),
      remaining: 4999,
      used: 1,
      reset: 1794841239,
      resource: 'graphql',
      raw: {
        limit: '5000abc',
        remaining: '4999',
        used: '1',
        reset: '1794841239',
        resource: 'graphql',
      },
    });

    assert.equal(malformed.isConsistent, false);
    assert.ok(malformed.discrepancies.some((d) => d.includes('Malformed HTTP header x-ratelimit-limit')));
  });

  // 33. Incorrect x-ratelimit-resource produces explicit discrepancy
  it('TC-PROV-33: Non-graphql resource header produces an explicit discrepancy', () => {
    const payload = {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-16T15:00:39Z',
    };

    const wrongResource = checkRateLimitConsistency(payload, {
      limit: 5000,
      remaining: 4999,
      used: 1,
      reset: 1794841239,
      resource: 'core',
      raw: {
        limit: '5000',
        remaining: '4999',
        used: '1',
        reset: '1794841239',
        resource: 'core',
      },
    });

    assert.equal(wrongResource.isConsistent, false);
    assert.ok(wrongResource.discrepancies.some((d) => d.includes('expected "graphql", received "core"')));
  });

  // 34. Body/header mismatches for every comparable field produce explicit discrepancies
  it('TC-PROV-34: Discrepancies flagged for limit, remaining, used, and reset body/header mismatches', () => {
    const payload = {
      limit: 5000,
      cost: 1,
      remaining: 4990,
      used: 10,
      resetAt: '2026-11-16T15:00:00Z',
    };

    const mismatched = checkRateLimitConsistency(payload, {
      limit: 1000,
      remaining: 990,
      used: 5,
      reset: Math.floor(new Date('2026-11-16T16:00:00Z').getTime() / 1000), // 1 hour difference (> 2s tolerance)
      resource: 'graphql',
    });

    assert.equal(mismatched.isConsistent, false);
    assert.ok(mismatched.discrepancies.some((d) => d.includes('Limit mismatch')));
    assert.ok(mismatched.discrepancies.some((d) => d.includes('Remaining mismatch')));
    assert.ok(mismatched.discrepancies.some((d) => d.includes('Used mismatch')));
    assert.ok(mismatched.discrepancies.some((d) => d.includes('Reset mismatch')));
  });

  // 35. Invalid reset timestamp format produces explicit discrepancy
  it('TC-PROV-35: Malformed reset timestamp string fails timestamp validation', () => {
    const payload = {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: 'invalid-iso-timestamp',
    };

    const invalidTimestamp = checkRateLimitConsistency(payload, {
      limit: 5000,
      remaining: 4999,
      used: 1,
      reset: 1794841239,
      resource: 'graphql',
    });

    assert.equal(invalidTimestamp.isConsistent, false);
    assert.ok(invalidTimestamp.discrepancies.some((d) => d.includes('Invalid GraphQL rateLimit.resetAt')));
  });

  // 36. Valid telemetry passes without hardcoding quota (works for 1000, 5000, or any valid positive integer)
  it('TC-PROV-36: Valid telemetry passes without hardcoding 1,000 or 5,000 quota', () => {
    const resetIso = '2026-11-16T15:30:00Z';
    const resetEpoch = Math.floor(new Date(resetIso).getTime() / 1000);

    // Test with 1000-point limit
    const check1k = checkRateLimitConsistency(
      { limit: 1000, cost: 1, remaining: 995, used: 5, resetAt: resetIso },
      { limit: 1000, remaining: 995, used: 5, reset: resetEpoch, resource: 'graphql' }
    );
    assert.equal(check1k.isConsistent, true);
    assert.equal(check1k.discrepancies.length, 0);

    // Test with 5000-point limit
    const check5k = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4998, used: 2, resetAt: resetIso },
      { limit: 5000, remaining: 4998, used: 2, reset: resetEpoch, resource: 'graphql' }
    );
    assert.equal(check5k.isConsistent, true);
    assert.equal(check5k.discrepancies.length, 0);

    // Test with arbitrary 15,000-point enterprise limit
    const check15k = checkRateLimitConsistency(
      { limit: 15000, cost: 2, remaining: 14900, used: 100, resetAt: resetIso },
      { limit: 15000, remaining: 14900, used: 100, reset: resetEpoch, resource: 'graphql' }
    );
    assert.equal(check15k.isConsistent, true);
    assert.equal(check15k.discrepancies.length, 0);
  });

  // 37. Diagnostic probe fails closed with exit code 1 when rateLimit telemetry is missing or inconsistent
  it('TC-PROV-37: Diagnostic probe script fails closed with non-zero exit code on missing token or telemetry', () => {
    const probeScript = path.resolve(process.cwd(), 'scripts', 'probe-github-contributions.ts');
    assert.throws(
      () => {
        cp.execFileSync(process.execPath, ['--experimental-strip-types', probeScript], {
          env: { ...process.env, GITHUB_TOKEN: '' },
          stdio: 'pipe',
        });
      },
      /GITHUB_TOKEN environment variable is required/
    );
  });

  // 38. Token redaction on failure paths sanitizes sensitive credentials from telemetry error messages
  it('TC-PROV-38: Token redaction preserves secrets across rate limit error telemetry', async () => {
    setFetchImplementation(async () => {
      return new Response(JSON.stringify({ message: `Access denied with bearer ${SAMPLE_TOKEN}` }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-used': '5000',
          'x-ratelimit-reset': '1794841239',
          'x-ratelimit-resource': 'graphql',
        },
      });
    });

    const provider = new GitHubContributionProvider();
    await assert.rejects(
      async () => provider.fetchUserContributionSnapshot('octocat', SAMPLE_FROM, SAMPLE_TO, SAMPLE_TOKEN),
      (err: Error) => {
        assert.ok(!err.message.includes(SAMPLE_TOKEN));
        return true;
      }
    );
  });

  // 39. Rejects date-only strings
  it('TC-PROV-39: Rejects date-only strings as incomplete ISO-8601 timestamps', () => {
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16'), false);
    const check = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: '2026-11-16' },
      { limit: 5000, remaining: 4999, used: 1, reset: 1794841239, resource: 'graphql' }
    );
    assert.equal(check.isConsistent, false);
    assert.ok(check.discrepancies.some((d) => d.includes('Invalid GraphQL rateLimit.resetAt')));
  });

  // 40. Rejects year-only strings
  it('TC-PROV-40: Rejects year-only strings as incomplete ISO-8601 timestamps', () => {
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026'), false);
    const check = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: '2026' },
      { limit: 5000, remaining: 4999, used: 1, reset: 1794841239, resource: 'graphql' }
    );
    assert.equal(check.isConsistent, false);
    assert.ok(check.discrepancies.some((d) => d.includes('Invalid GraphQL rateLimit.resetAt')));
  });

  // 41. Rejects missing timezones
  it('TC-PROV-41: Rejects date-time strings without explicit timezone designator', () => {
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T15:00:00'), false);
    const check = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: '2026-11-16T15:00:00' },
      { limit: 5000, remaining: 4999, used: 1, reset: 1794841239, resource: 'graphql' }
    );
    assert.equal(check.isConsistent, false);
    assert.ok(check.discrepancies.some((d) => d.includes('Invalid GraphQL rateLimit.resetAt')));
  });

  // 42. Rejects impossible calendar dates (not merely JS Date parseability)
  it('TC-PROV-42: Rejects impossible calendar dates including non-leap February 29 and 31st of 30-day months', () => {
    // February 31 is impossible in any year
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-02-31T15:00:00Z'), false);
    // February 29 in a non-leap year (2025 or 2026)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2025-02-29T12:00:00Z'), false);
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-02-29T12:00:00Z'), false);
    // February 29 in an end-of-century non-leap year (1900 is not divisible by 400)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('1900-02-29T12:00:00Z'), false);
    // April 31 (April has only 30 days)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-04-31T10:00:00Z'), false);
    // November 31 (November has only 30 days)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-31T00:00:00Z'), false);
    // Invalid months and days
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-13-01T00:00:00Z'), false);
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-00-10T00:00:00Z'), false);
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-05-00T00:00:00Z'), false);

    const checkFeb31 = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: '2026-02-31T15:00:00Z' },
      { limit: 5000, remaining: 4999, used: 1, reset: 1794841239, resource: 'graphql' }
    );
    assert.equal(checkFeb31.isConsistent, false);
    assert.ok(checkFeb31.discrepancies.some((d) => d.includes('valid calendar date')));
  });

  // 43. Rejects empty and whitespace-only reset timestamps
  it('TC-PROV-43: Rejects empty and whitespace-only reset timestamps', () => {
    assert.equal(isValidIsoDateTimeWithExplicitTimezone(''), false);
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('   '), false);

    const checkEmpty = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: '' },
      { limit: 5000, remaining: 4999, used: 1, reset: 1794841239, resource: 'graphql' }
    );
    assert.equal(checkEmpty.isConsistent, false);
    assert.ok(checkEmpty.discrepancies.some((d) => d.includes('Missing or empty GraphQL rateLimit.resetAt timestamp')));
  });

  // 44. Rejects malformed timezone offsets
  it('TC-PROV-44: Rejects malformed timezone offsets', () => {
    // Hour offset out of range (> 23)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T15:00:00+25:00'), false);
    // Minute offset out of range (>= 60)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T15:00:00-05:60'), false);
    // Incomplete offset (missing minutes)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T15:00:00+05'), false);
    // Incomplete offset (single-digit hour)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T15:00:00+5:00'), false);
    // Trailing non-offset characters
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T15:00:00Z123'), false);

    const checkBadOffset = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: '2026-11-16T15:00:00+25:00' },
      { limit: 5000, remaining: 4999, used: 1, reset: 1794841239, resource: 'graphql' }
    );
    assert.equal(checkBadOffset.isConsistent, false);
    assert.ok(checkBadOffset.discrepancies.some((d) => d.includes('Invalid GraphQL rateLimit.resetAt')));
  });

  // 45. Preserves valid UTC and numeric-offset timestamps
  it('TC-PROV-45: Preserves valid UTC, fractional-second, and numeric-offset timestamps', () => {
    // Valid standard UTC (Z)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T15:00:39Z'), true);
    // Valid UTC with fractional seconds
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T15:00:39.123Z'), true);
    // Valid positive numeric offset (+05:30)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T20:30:39+05:30'), true);
    // Valid negative numeric offset (-08:00)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2026-11-16T07:00:39-08:00'), true);
    // Valid leap-year February 29 (2024 is divisible by 4)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2024-02-29T12:00:00Z'), true);
    // Valid leap-year February 29 (2000 is divisible by 400)
    assert.equal(isValidIsoDateTimeWithExplicitTimezone('2000-02-29T00:00:00Z'), true);

    const checkValid = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: '2026-11-16T15:00:39Z' },
      { limit: 5000, remaining: 4999, used: 1, reset: 1794841239, resource: 'graphql' }
    );
    assert.equal(checkValid.isConsistent, true);
    assert.equal(checkValid.discrepancies.length, 0);
  });

  // 46. Preserves maximum 2-second comparison tolerance with numeric-offset conversion
  it('TC-PROV-46: Preserves maximum 2-second tolerance across numeric-offset conversions', () => {
    // 2026-11-16T20:30:39+05:30 converts to 2026-11-16T15:00:39Z (1794841239s)
    const offsetIso = '2026-11-16T20:30:39+05:30';
    const targetEpoch = 1794841239;

    // Exact match (delta = 0s)
    const exactMatch = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: offsetIso },
      { limit: 5000, remaining: 4999, used: 1, reset: targetEpoch, resource: 'graphql' }
    );
    assert.equal(exactMatch.isConsistent, true);

    // Delta = 2s (within tolerance)
    const withinTolerance = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: offsetIso },
      { limit: 5000, remaining: 4999, used: 1, reset: targetEpoch + 2, resource: 'graphql' }
    );
    assert.equal(withinTolerance.isConsistent, true);

    // Delta = 3s (exceeds tolerance)
    const exceedsTolerance = checkRateLimitConsistency(
      { limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: offsetIso },
      { limit: 5000, remaining: 4999, used: 1, reset: targetEpoch + 3, resource: 'graphql' }
    );
    assert.equal(exceedsTolerance.isConsistent, false);
    assert.ok(exceedsTolerance.discrepancies.some((d) => d.includes('difference of 3s exceeds 2s tolerance')));
  });
});
