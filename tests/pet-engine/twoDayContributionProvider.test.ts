// tests/pet-engine/twoDayContributionProvider.test.ts
// Comprehensive unit test suite for two-day aliased GitHub contribution snapshot provider (Phase 3C2.2.3.1-R2)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  GitHubContributionProvider,
  compute2DayUtcWindows,
  USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY,
  IdentityMismatchError,
  InvalidContributionDataError,
  OrganizationAccountError,
  UserNotFoundError,
  setFetchImplementation,
  resetFetchImplementation,
  GitHubUnauthorizedError,
  GitHubTimeoutError,
  GitHubGraphQLError,
  type RawGraphQL2DayContributionResponse,
  type RawGraphQLContributionCollection,
} from '../../src/features/pet-engine/contribution/index.ts';

const SAMPLE_TOKEN = 'ghp_testSecretToken1234567890abcdefTwoDay';
const FIXED_NOW = new Date('2026-11-17T12:30:45.000Z');
const EXPECTED_WINDOWS = compute2DayUtcWindows(FIXED_NOW);

function createValidRaw2DayResponse(
  overrides: {
    user?: Partial<NonNullable<RawGraphQL2DayContributionResponse['user']>> | null;
    yesterday?: Partial<RawGraphQLContributionCollection>;
    today?: Partial<RawGraphQLContributionCollection>;
    repositoryOwner?: Partial<NonNullable<RawGraphQL2DayContributionResponse['repositoryOwner']>> | null;
    rateLimit?: RawGraphQL2DayContributionResponse['rateLimit'];
  } = {}
): RawGraphQL2DayContributionResponse {
  const user =
    overrides.user === null
      ? null
      : {
          id: 'MDQ6VXNlcjU4MzIzMQ==',
          databaseId: 583231,
          login: 'mnp210',
          yesterday: {
            startedAt: EXPECTED_WINDOWS.yesterday.fromIso,
            endedAt: EXPECTED_WINDOWS.yesterday.toIso,
            totalCommitContributions: 7,
            totalIssueContributions: 2,
            totalPullRequestContributions: 1,
            totalPullRequestReviewContributions: 3,
            restrictedContributionsCount: 5,
            contributionCalendar: {
              totalContributions: 18,
            },
            ...overrides.yesterday,
          },
          today: {
            startedAt: EXPECTED_WINDOWS.today.fromIso,
            endedAt: EXPECTED_WINDOWS.today.toIso,
            totalCommitContributions: 4,
            totalIssueContributions: 1,
            totalPullRequestContributions: 2,
            totalPullRequestReviewContributions: 0,
            restrictedContributionsCount: 1,
            contributionCalendar: {
              totalContributions: 8,
            },
            ...overrides.today,
          },
          ...overrides.user,
        };

  const repositoryOwner =
    overrides.repositoryOwner === null
      ? null
      : {
          __typename: 'User',
          id: 'MDQ6VXNlcjU4MzIzMQ==',
          login: 'mnp210',
          ...overrides.repositoryOwner,
        };

  return {
    repositoryOwner,
    user,
    rateLimit: {
      limit: 5000,
      cost: 1,
      remaining: 4995,
      used: 5,
      resetAt: '2026-11-17T13:00:00Z',
      ...overrides.rateLimit,
    },
  };
}

function makeRateLimitHeaders(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4995',
    'x-ratelimit-used': '5',
    'x-ratelimit-reset': '1794920400',
    'x-ratelimit-resource': 'graphql',
    ...overrides,
  };
}

describe('Phase 3C2.2.3.1-R2: Two-Day Aliased GitHub Contribution Provider Suite', () => {
  beforeEach(() => {
    resetFetchImplementation();
  });

  afterEach(() => {
    resetFetchImplementation();
  });

  // 1. compute2DayUtcWindows logic
  describe('compute2DayUtcWindows', () => {
    it('TC-2DAY-WIN-01: Correctly derives yesterday and today UTC windows with millisecond boundaries', () => {
      const windows = compute2DayUtcWindows(FIXED_NOW);

      assert.equal(windows.yesterday.date, '2026-11-16');
      assert.equal(windows.yesterday.fromIso, '2026-11-16T00:00:00.000Z');
      assert.equal(windows.yesterday.toIso, '2026-11-16T23:59:59.999Z');

      assert.equal(windows.today.date, '2026-11-17');
      assert.equal(windows.today.fromIso, '2026-11-17T00:00:00.000Z');
      assert.equal(windows.today.toIso, '2026-11-17T23:59:59.999Z');
    });

    it('TC-2DAY-WIN-02: Month boundary transition (March 1 to February 28 on non-leap year)', () => {
      const marchFirst = new Date('2026-03-01T05:15:00.000Z');
      const windows = compute2DayUtcWindows(marchFirst);

      assert.equal(windows.yesterday.date, '2026-02-28');
      assert.equal(windows.yesterday.fromIso, '2026-02-28T00:00:00.000Z');
      assert.equal(windows.yesterday.toIso, '2026-02-28T23:59:59.999Z');

      assert.equal(windows.today.date, '2026-03-01');
      assert.equal(windows.today.fromIso, '2026-03-01T00:00:00.000Z');
      assert.equal(windows.today.toIso, '2026-03-01T23:59:59.999Z');
    });

    it('TC-2DAY-WIN-03: Leap year month boundary transition (March 1 to February 29 on leap year)', () => {
      const leapMarchFirst = new Date('2024-03-01T00:00:01.000Z');
      const windows = compute2DayUtcWindows(leapMarchFirst);

      assert.equal(windows.yesterday.date, '2024-02-29');
      assert.equal(windows.yesterday.fromIso, '2024-02-29T00:00:00.000Z');
      assert.equal(windows.yesterday.toIso, '2024-02-29T23:59:59.999Z');

      assert.equal(windows.today.date, '2024-03-01');
      assert.equal(windows.today.fromIso, '2024-03-01T00:00:00.000Z');
      assert.equal(windows.today.toIso, '2024-03-01T23:59:59.999Z');
    });

    it('TC-2DAY-WIN-04: Year boundary transition (January 1 to December 31 of prior year)', () => {
      const newYear = new Date('2027-01-01T00:00:00.000Z');
      const windows = compute2DayUtcWindows(newYear);

      assert.equal(windows.yesterday.date, '2026-12-31');
      assert.equal(windows.yesterday.fromIso, '2026-12-31T00:00:00.000Z');
      assert.equal(windows.yesterday.toIso, '2026-12-31T23:59:59.999Z');

      assert.equal(windows.today.date, '2027-01-01');
      assert.equal(windows.today.fromIso, '2027-01-01T00:00:00.000Z');
      assert.equal(windows.today.toIso, '2027-01-01T23:59:59.999Z');
    });

    it('TC-2DAY-WIN-05: Accepts numeric timestamp or default current time', () => {
      const epochMs = FIXED_NOW.getTime();
      const windowsFromEpoch = compute2DayUtcWindows(epochMs);
      const windowsFromDate = compute2DayUtcWindows(FIXED_NOW);

      assert.deepEqual(windowsFromEpoch, windowsFromDate);

      const defaultWindows = compute2DayUtcWindows();
      assert.ok(defaultWindows.yesterday.date);
      assert.ok(defaultWindows.today.date);
      assert.ok(defaultWindows.yesterday.fromIso.endsWith('00:00:00.000Z'));
      assert.ok(defaultWindows.today.toIso.endsWith('23:59:59.999Z'));
    });
  });

  // 2. Query shape and variables validation
  describe('Query Execution & Variable Transmission', () => {
    it('TC-2DAY-QRY-01: Dispatches exact aliased query selecting repositoryOwner, two-day collections, and rateLimit', async () => {
      let interceptedBody: string | null = null;

      setFetchImplementation(async (_url, init) => {
        interceptedBody = typeof init?.body === 'string' ? init.body : null;

        const raw = createValidRaw2DayResponse();
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
      });

      assert.ok(interceptedBody, 'Body must be intercepted');
      const parsedBody = JSON.parse(interceptedBody);

      assert.equal(parsedBody.query.trim(), USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY.trim());
      assert.ok(parsedBody.query.includes('repositoryOwner(login: $login)'));
      assert.ok(parsedBody.query.includes('__typename'));
      assert.deepEqual(parsedBody.variables, {
        login: 'mnp210',
        yesterdayFrom: EXPECTED_WINDOWS.yesterday.fromIso,
        yesterdayTo: EXPECTED_WINDOWS.yesterday.toIso,
        todayFrom: EXPECTED_WINDOWS.today.fromIso,
        todayTo: EXPECTED_WINDOWS.today.toIso,
      });

      assert.equal(snapshot.yesterday.fromIso, EXPECTED_WINDOWS.yesterday.fromIso);
      assert.equal(snapshot.yesterday.toIso, EXPECTED_WINDOWS.yesterday.toIso);
      assert.equal(snapshot.today.fromIso, EXPECTED_WINDOWS.today.fromIso);
      assert.equal(snapshot.today.toIso, EXPECTED_WINDOWS.today.toIso);
    });
  });

  // 3. Category aggregation & restricted contributions
  describe('Category Aggregation & Restricted Exclusion', () => {
    it('TC-2DAY-AGG-01: Correctly sums the four public categories and excludes restricted contributions', async () => {
      const raw = createValidRaw2DayResponse({
        yesterday: {
          totalCommitContributions: 10,
          totalIssueContributions: 3,
          totalPullRequestContributions: 2,
          totalPullRequestReviewContributions: 4,
          restrictedContributionsCount: 99, // Restricted MUST NOT be added
          contributionCalendar: {
            totalContributions: 118, // 10+3+2+4 + 99 = 118
          },
        },
        today: {
          totalCommitContributions: 0,
          totalIssueContributions: 1,
          totalPullRequestContributions: 0,
          totalPullRequestReviewContributions: 1,
          restrictedContributionsCount: 50,
          contributionCalendar: {
            totalContributions: 52,
          },
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
      });

      // Yesterday: 10 + 3 + 2 + 4 = 19
      assert.equal(snapshot.yesterday.counts.publicCategoryTotal, 19);
      assert.equal(snapshot.yesterday.counts.restricted, 99);
      assert.equal(snapshot.yesterday.counts.commits, 10);
      assert.equal(snapshot.yesterday.counts.issues, 3);
      assert.equal(snapshot.yesterday.counts.pullRequests, 2);
      assert.equal(snapshot.yesterday.counts.pullRequestReviews, 4);

      // Today: 0 + 1 + 0 + 1 = 2
      assert.equal(snapshot.today.counts.publicCategoryTotal, 2);
      assert.equal(snapshot.today.counts.restricted, 50);
      assert.equal(snapshot.today.counts.commits, 0);
      assert.equal(snapshot.today.counts.issues, 1);
      assert.equal(snapshot.today.counts.pullRequests, 0);
      assert.equal(snapshot.today.counts.pullRequestReviews, 1);
    });

    it('TC-2DAY-AGG-02: Handles zero contributions across all categories without error', async () => {
      const raw = createValidRaw2DayResponse({
        yesterday: {
          totalCommitContributions: 0,
          totalIssueContributions: 0,
          totalPullRequestContributions: 0,
          totalPullRequestReviewContributions: 0,
          restrictedContributionsCount: 0,
          contributionCalendar: { totalContributions: 0 },
        },
        today: {
          totalCommitContributions: 0,
          totalIssueContributions: 0,
          totalPullRequestContributions: 0,
          totalPullRequestReviewContributions: 0,
          restrictedContributionsCount: 0,
          contributionCalendar: { totalContributions: 0 },
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
      });

      assert.equal(snapshot.yesterday.counts.publicCategoryTotal, 0);
      assert.equal(snapshot.today.counts.publicCategoryTotal, 0);
    });
  });

  // 4. Identity verification & strict organization discrimination (Phase 3C2.2.3.1-R2)
  describe('Immutable Owner Identity & Organization Discrimination', () => {
    it('TC-2DAY-ID-01: Accepts valid personal user response with matching expectedOwnerDatabaseId', async () => {
      const raw = createValidRaw2DayResponse();
      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
        expectedOwnerDatabaseId: 583231,
      });

      assert.equal(snapshot.ownerDatabaseId, 583231);
      assert.equal(snapshot.ownerLogin, 'mnp210');
      assert.equal(snapshot.isPersonalAccount, true);
    });

    it('TC-2DAY-ID-02: Rejects mismatched expectedOwnerDatabaseId with IdentityMismatchError', async () => {
      const raw = createValidRaw2DayResponse();
      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
            expectedOwnerDatabaseId: 9999999, // Mismatched ID
          });
        },
        (err: Error) => {
          assert.ok(err instanceof IdentityMismatchError);
          assert.ok(err.message.includes('583231'));
          assert.ok(err.message.includes('9999999'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-03: Rejects user login mismatch with IdentityMismatchError', async () => {
      const raw = createValidRaw2DayResponse({
        user: { login: 'impostor-user' },
      });
      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof IdentityMismatchError);
          assert.ok(err.message.includes('impostor-user'));
          assert.ok(err.message.includes('mnp210'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-04: Rejects realistic organization response from primary query with OrganizationAccountError', async () => {
      const raw: RawGraphQL2DayContributionResponse = {
        repositoryOwner: {
          __typename: 'Organization',
          id: 'MDEyOk9yZ2FuaXphdGlvbjEzNDIwMzk2',
          login: 'github',
        },
        user: null,
        rateLimit: {
          limit: 5000,
          cost: 1,
          remaining: 4999,
          used: 1,
          resetAt: '2026-11-17T13:00:00Z',
        },
      };

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('github', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof OrganizationAccountError);
          assert.ok(err.message.includes('Organization'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-05: Rejects null repositoryOwner and null user with UserNotFoundError', async () => {
      const raw: RawGraphQL2DayContributionResponse = {
        repositoryOwner: null,
        user: null,
      };

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('nonexistent-user', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof UserNotFoundError);
          assert.ok(err.message.includes('nonexistent-user'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-06: Rejects missing or empty __typename on repositoryOwner with InvalidContributionDataError', async () => {
      const raw = createValidRaw2DayResponse({
        repositoryOwner: {
          __typename: '' as unknown as string,
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('Missing __typename'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-07: Rejects unknown __typename on repositoryOwner with InvalidContributionDataError', async () => {
      const raw = createValidRaw2DayResponse({
        repositoryOwner: {
          __typename: 'Bot' as unknown as string,
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('Unknown __typename'));
          assert.ok(err.message.includes('Bot'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-08: Rejects repositoryOwner login mismatch with IdentityMismatchError', async () => {
      const raw = createValidRaw2DayResponse({
        repositoryOwner: {
          login: 'other-owner',
        },
        user: {
          login: 'other-owner',
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof IdentityMismatchError);
          assert.ok(err.message.includes('Repository owner login "other-owner" does not match target login "mnp210"'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-09: Rejects owner and user login disagreement with IdentityMismatchError', async () => {
      const raw = createValidRaw2DayResponse({
        repositoryOwner: {
          login: 'mnp210',
        },
        user: {
          login: 'disagreeing-user',
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof IdentityMismatchError);
          assert.ok(err.message.includes('disagreeing-user'));
          assert.ok(err.message.includes('does not match'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-10: Rejects personal User owner with null user object with InvalidContributionDataError', async () => {
      const raw = createValidRaw2DayResponse({
        repositoryOwner: {
          __typename: 'User',
          id: 'MDQ6VXNlcjU4MzIzMQ==',
          login: 'mnp210',
        },
        user: null,
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('user contribution details object is null or missing'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-11: Rejects missing or non-positive databaseId with InvalidContributionDataError', async () => {
      // Test missing / null databaseId
      const rawNull = createValidRaw2DayResponse({
        user: { databaseId: null as unknown as number },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: rawNull }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('Invalid or missing numeric databaseId'));
          return true;
        }
      );

      // Test negative databaseId
      const rawNeg = createValidRaw2DayResponse({
        user: { databaseId: -5 },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: rawNeg }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('Invalid or missing numeric databaseId'));
          return true;
        }
      );
    });

    it('TC-2DAY-ID-12: Rejects organization with GraphQL error and partial data without secondary request', async () => {
      let callCount = 0;
      setFetchImplementation(async () => {
        callCount++;
        return new Response(
          JSON.stringify({
            data: {
              repositoryOwner: {
                __typename: 'Organization',
                id: 'MDEyOk9yZ2FuaXphdGlvbjEzNDIwMzk2',
                login: 'github',
              },
              user: null,
              rateLimit: {
                limit: 5000,
                cost: 1,
                remaining: 4999,
                used: 1,
                resetAt: '2026-11-17T13:00:00Z',
              },
            },
            errors: [
              {
                type: 'NOT_FOUND',
                path: ['user'],
                message: "Could not resolve to a User with the login of 'github'.",
              },
            ],
          }),
          {
            status: 200,
            headers: makeRateLimitHeaders(),
          }
        );
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('github', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof OrganizationAccountError);
          assert.ok(err.message.includes('Organization'));
          return true;
        }
      );

      // CRITICAL: Exactly 1 request dispatched; zero secondary requests
      assert.equal(callCount, 1, 'Organization discrimination must not issue secondary GraphQL requests');
    });
  });

  // 5. Network efficiency & single-request guarantee
  describe('Network Efficiency & Single-Request Guarantee', () => {
    it('TC-2DAY-REQ-01: Dispatches exactly one GraphQL request for successful snapshot', async () => {
      let callCount = 0;
      setFetchImplementation(async () => {
        callCount++;
        const raw = createValidRaw2DayResponse();
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
      });

      assert.ok(snapshot);
      assert.equal(callCount, 1, 'Successful snapshot must require exactly one GraphQL request');
    });

    it('TC-2DAY-REQ-02: Dispatches exactly one GraphQL request for organization detection', async () => {
      let callCount = 0;
      setFetchImplementation(async () => {
        callCount++;
        const raw = createValidRaw2DayResponse({
          repositoryOwner: {
            __typename: 'Organization',
            login: 'org-target',
          },
          user: null,
        });
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('org-target', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof OrganizationAccountError);
          return true;
        }
      );

      assert.equal(callCount, 1, 'Organization rejection must require exactly one GraphQL request');
    });
  });

  // 6. Missing alias or incomplete responses
  describe('Incomplete Responses & Null Collections', () => {
    it('TC-2DAY-INC-01: Rejects null yesterday collection with InvalidContributionDataError', async () => {
      const raw = createValidRaw2DayResponse();
      (raw.user as { yesterday: unknown }).yesterday = null;

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('yesterday'));
          assert.ok(err.message.includes('contributionsCollection'));
          return true;
        }
      );
    });

    it('TC-2DAY-INC-02: Rejects null today collection with InvalidContributionDataError', async () => {
      const raw = createValidRaw2DayResponse();
      (raw.user as { today: unknown }).today = null;

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('today'));
          assert.ok(err.message.includes('contributionsCollection'));
          return true;
        }
      );
    });

    it('TC-2DAY-INC-03: Rejects missing category breakdown field in yesterday', async () => {
      const raw = createValidRaw2DayResponse();
      delete (raw.user!.yesterday as { totalCommitContributions?: number }).totalCommitContributions;

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('totalCommitContributions'));
          assert.ok(err.message.includes('must be a non-negative integer'));
          return true;
        }
      );
    });

    it('TC-2DAY-INC-04: Rejects missing category breakdown field in today', async () => {
      const raw = createValidRaw2DayResponse();
      delete (raw.user!.today as { totalPullRequestReviewContributions?: number }).totalPullRequestReviewContributions;

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('totalPullRequestReviewContributions'));
          assert.ok(err.message.includes('must be a non-negative integer'));
          return true;
        }
      );
    });
  });

  // 7. Malformed response fields & negative/non-integer counts
  describe('Malformed Values & Invalid Counts', () => {
    it('TC-2DAY-MAL-01: Rejects negative contribution count with InvalidContributionDataError', async () => {
      const raw = createValidRaw2DayResponse({
        yesterday: { totalIssueContributions: -1 },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('must be a non-negative integer'));
          return true;
        }
      );
    });

    it('TC-2DAY-MAL-02: Rejects non-integer fractional count with InvalidContributionDataError', async () => {
      const raw = createValidRaw2DayResponse({
        today: { totalCommitContributions: 3.5 },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('must be a non-negative integer'));
          return true;
        }
      );
    });

    it('TC-2DAY-MAL-03: Rejects string/non-numeric contribution count with InvalidContributionDataError', async () => {
      const raw = createValidRaw2DayResponse();
      (raw.user!.yesterday as { totalPullRequestContributions: unknown }).totalPullRequestContributions = 'two';

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('must be a non-negative integer'));
          return true;
        }
      );
    });
  });

  // 8. Rate limit telemetry parsing & cost measurement
  describe('Rate Limit Telemetry & Actual Cost Measurement', () => {
    it('TC-2DAY-RL-01: Measures actual query cost from GraphQL rateLimit payload (cost: 2)', async () => {
      const raw = createValidRaw2DayResponse({
        rateLimit: {
          limit: 5000,
          cost: 2, // 2-point query cost
          remaining: 4998,
          used: 2,
          resetAt: '2026-11-17T13:00:00Z',
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders({
            'x-ratelimit-remaining': '4998',
            'x-ratelimit-used': '2',
          }),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
      });

      assert.ok(snapshot.rateLimit);
      assert.equal(snapshot.rateLimit.cost, 2);
      assert.equal(snapshot.rateLimit.remaining, 4998);
      assert.equal(snapshot.rateLimit.used, 2);
      assert.equal(snapshot.rateLimit.limit, 5000);
      assert.equal(snapshot.rateLimit.consistency?.isConsistent, true);
    });

    it('TC-2DAY-RL-02: Strict rate limit consistency enforcement rejects mismatched telemetry when requireStrictRateLimitConsistency is true', async () => {
      const raw = createValidRaw2DayResponse({
        rateLimit: {
          limit: 5000,
          cost: 1,
          remaining: 4995,
          used: 5,
          resetAt: '2026-11-17T13:00:00Z',
        },
      });

      // HTTP headers report limit: 1000 instead of 5000
      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders({
            'x-ratelimit-limit': '1000',
          }),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
            requireStrictRateLimitConsistency: true,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof InvalidContributionDataError);
          assert.ok(err.message.includes('Rate limit telemetry consistency validation failed'));
          assert.ok(err.message.includes('Limit mismatch'));
          return true;
        }
      );
    });

    it('TC-2DAY-RL-03: Lenient mode records telemetry discrepancies without throwing when requireStrictRateLimitConsistency is false', async () => {
      const raw = createValidRaw2DayResponse({
        rateLimit: {
          limit: 5000,
          cost: 1,
          remaining: 4995,
          used: 5,
          resetAt: '2026-11-17T13:00:00Z',
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders({
            'x-ratelimit-limit': '1000',
          }),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
        requireStrictRateLimitConsistency: false,
      });

      assert.ok(snapshot.rateLimit);
      assert.equal(snapshot.rateLimit.consistency?.isConsistent, false);
      assert.ok(snapshot.rateLimit.consistency?.discrepancies.some((d) => d.includes('Limit mismatch')));
    });
  });

  // 9. Timeout, retry & network error handling
  describe('Timeout, Retry & Error Handling', () => {
    it('TC-2DAY-NET-01: Bounded request timeout throws GitHubTimeoutError', async () => {
      setFetchImplementation(async () => {
        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
            timeoutMs: 50,
            retryPolicy: { maxAttempts: 1 },
          });
        },
        (err: Error) => {
          assert.ok(err instanceof GitHubTimeoutError);
          return true;
        }
      );
    });

    it('TC-2DAY-NET-02: Retries on 502 Bad Gateway and succeeds if subsequent attempt succeeds', async () => {
      let callCount = 0;
      setFetchImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('Bad Gateway', { status: 502 });
        }
        const raw = createValidRaw2DayResponse();
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
        retryPolicy: { maxAttempts: 3, initialDelayMs: 10, backoffFactor: 2 },
      });

      assert.equal(callCount, 2);
      assert.equal(snapshot.yesterday.counts.publicCategoryTotal, 13);
    });

    it('TC-2DAY-NET-03: HTTP 401 throws GitHubUnauthorizedError with token sanitized', async () => {
      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof GitHubUnauthorizedError);
          assert.ok(!err.message.includes(SAMPLE_TOKEN));
          return true;
        }
      );
    });

    it('TC-2DAY-NET-04: GraphQL error payload sanitizes token', async () => {
      setFetchImplementation(async () => {
        return new Response(
          JSON.stringify({
            errors: [{ message: `Something went wrong referencing token ${SAMPLE_TOKEN}` }],
          }),
          {
            status: 200,
            headers: makeRateLimitHeaders(),
          }
        );
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof GitHubGraphQLError);
          assert.ok(!err.message.includes(SAMPLE_TOKEN));
          assert.ok(err.message.includes('[REDACTED_TOKEN]'));
          return true;
        }
      );
    });
  });

  // 10. Read-only verification (zero mutation of pet state, ledger files, HWM, ordinals)
  describe('Read-Only Verification', () => {
    it('TC-2DAY-RO-01: Verifies that snapshot fetching produces zero filesystem mutations across pet state and ledgers', async () => {
      const stateDir = path.resolve('pet/state');
      const filesToWatch = [
        'pet_state.json',
        'pet_state_vitals.json',
        'pet_state_history.json',
        'contributions.json',
      ];

      // Read initial file states
      const initialContents: Record<string, string> = {};
      for (const fileName of filesToWatch) {
        const fullPath = path.join(stateDir, fileName);
        if (fs.existsSync(fullPath)) {
          initialContents[fileName] = fs.readFileSync(fullPath, 'utf8');
        }
      }

      // Execute provider
      const raw = createValidRaw2DayResponse();
      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      const snapshot = await provider.fetchUserContributionSnapshot2Day('mnp210', SAMPLE_TOKEN, {
        now: FIXED_NOW,
        expectedOwnerDatabaseId: 583231,
      });

      assert.ok(snapshot);

      // Verify each watched file has identical content
      for (const fileName of filesToWatch) {
        const fullPath = path.join(stateDir, fileName);
        if (fs.existsSync(fullPath)) {
          const afterContent = fs.readFileSync(fullPath, 'utf8');
          assert.equal(
            afterContent,
            initialContents[fileName],
            `File ${fileName} must not be modified by read-only contribution provider`
          );
        }
      }
    });
  });
});
