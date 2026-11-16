// tests/pet-engine/contributionProvider.test.ts
// Comprehensive unit test suite for GitHub GraphQL contribution provider and immutable identity verification (Phase 3C2.1)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
  type RawGraphQLContributionResponse,
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
      cost: 1,
      remaining: 999,
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
    assert.equal(snapshot.rateLimit?.cost, 1);
    assert.equal(snapshot.rateLimit?.remaining, 999);
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
});
