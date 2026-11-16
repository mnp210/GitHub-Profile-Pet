// tests/unit/githubGraphQL.test.ts
// Sprint 2.4A - Unit tests for GitHub GraphQL client, Contribution Snapshot parsing, date validation, and token redaction

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRIBUTION_SNAPSHOT_QUERY,
  validateAndNormalizeDateRange,
  parseAndValidateContributionResponse,
  InvalidDateRangeError,
  GitHubIdentityMismatchError,
  InvalidContributionDataError,
  type RawContributionSnapshotResponse,
} from '../../src/lib/github/contributionSnapshot.ts';
import {
  redactSensitiveData,
  GitHubGraphQLError,
  GitHubUnauthorizedError,
  GitHubForbiddenError,
  GitHubRateLimitError,
  GitHubServerError,
  GitHubTimeoutError,
  GitHubNetworkError,
} from '../../src/lib/github/graphqlClient.ts';

describe('GitHub GraphQL Client & Contribution Snapshot Unit Suite', () => {
  describe('1. Query Structure Validation', () => {
    test('CONTRIBUTION_SNAPSHOT_QUERY contains all required viewer and contribution fields', () => {
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('query ContributionSnapshot($from: DateTime!, $to: DateTime!)'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('viewer {'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('id'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('databaseId'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('login'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('contributionsCollection(from: $from, to: $to) {'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('totalCommitContributions'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('totalIssueContributions'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('totalPullRequestContributions'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('totalPullRequestReviewContributions'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('restrictedContributionsCount'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('contributionCalendar {'));
      assert.ok(CONTRIBUTION_SNAPSHOT_QUERY.includes('totalContributions'));
    });
  });

  describe('2. Date Range Normalization & Boundary Enforcement', () => {
    test('normalizes omitted parameters to current UTC calendar day', () => {
      const range = validateAndNormalizeDateRange();
      assert.ok(range.from.endsWith('T00:00:00.000Z'));
      assert.ok(range.to.endsWith('T23:59:59.999Z'));
      assert.ok(new Date(range.from) <= new Date(range.to));
    });

    test('normalizes explicit ISO strings to UTC ISO strings', () => {
      const from = '2026-11-01T10:00:00Z';
      const to = '2026-11-15T18:30:00Z';
      const range = validateAndNormalizeDateRange(from, to);
      assert.equal(range.from, '2026-11-01T10:00:00.000Z');
      assert.equal(range.to, '2026-11-15T18:30:00.000Z');
    });

    test('rejects invalid start date string', () => {
      assert.throws(
        () => validateAndNormalizeDateRange('not-a-date', '2026-11-15T00:00:00Z'),
        (err: unknown) => err instanceof InvalidDateRangeError && (err as Error).message.includes('Invalid start date')
      );
    });

    test('rejects invalid end date string', () => {
      assert.throws(
        () => validateAndNormalizeDateRange('2026-11-01T00:00:00Z', 'invalid-end'),
        (err: unknown) => err instanceof InvalidDateRangeError && (err as Error).message.includes('Invalid end date')
      );
    });

    test('rejects start date after end date', () => {
      assert.throws(
        () => validateAndNormalizeDateRange('2026-11-15T00:00:00Z', '2026-11-01T00:00:00Z'),
        (err: unknown) => err instanceof InvalidDateRangeError && (err as Error).message.includes('cannot be after')
      );
    });

    test('rejects date range exceeding maximum allowable span (> 366 days)', () => {
      assert.throws(
        () => validateAndNormalizeDateRange('2024-01-01T00:00:00Z', '2025-02-01T00:00:00Z'),
        (err: unknown) => err instanceof InvalidDateRangeError && (err as Error).message.includes('exceeds the maximum allowed range')
      );
    });
  });

  describe('3. Contribution Response Parsing & Identity Validation', () => {
    const validRawPayload: RawContributionSnapshotResponse = {
      viewer: {
        id: 'MDQ6VXNlcjU4MzIzMQ==',
        databaseId: 583231,
        login: 'octocat',
        contributionsCollection: {
          totalCommitContributions: 14,
          totalIssueContributions: 3,
          totalPullRequestContributions: 5,
          totalPullRequestReviewContributions: 2,
          restrictedContributionsCount: 8,
          contributionCalendar: {
            totalContributions: 24,
          },
        },
      },
    };

    test('successfully parses and validates authentic payload with correct identity', () => {
      const res = parseAndValidateContributionResponse(validRawPayload, '583231');
      assert.equal(res.githubUserId, '583231');
      assert.equal(res.username, 'octocat');
      assert.equal(res.contributions.commits, 14);
      assert.equal(res.contributions.issues, 3);
      assert.equal(res.contributions.pullRequests, 5);
      assert.equal(res.contributions.pullRequestReviews, 2);
      assert.equal(res.contributions.restricted, 8);
      assert.equal(res.contributions.total, 24);
    });

    test('rejects identity mismatch between viewer.databaseId and expected stored account', () => {
      assert.throws(
        () => parseAndValidateContributionResponse(validRawPayload, '999999'),
        (err: unknown) => err instanceof GitHubIdentityMismatchError && (err as Error).message.includes('Identity mismatch')
      );
    });

    test('rejects missing or malformed viewer node', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assert.throws(() => parseAndValidateContributionResponse({} as any, '583231'), InvalidContributionDataError);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assert.throws(() => parseAndValidateContributionResponse({ viewer: null } as any, '583231'), InvalidContributionDataError);
    });

    test('rejects missing or non-integer databaseId', () => {
      const badIdPayload: RawContributionSnapshotResponse = {
        viewer: {
          id: 'MDQ6VXNlcjU4MzIzMQ==',
          databaseId: null,
          login: 'octocat',
          contributionsCollection: validRawPayload.viewer!.contributionsCollection,
        },
      };
      assert.throws(() => parseAndValidateContributionResponse(badIdPayload, '583231'), InvalidContributionDataError);
    });

    test('rejects negative contribution numbers', () => {
      const negativePayload: RawContributionSnapshotResponse = {
        viewer: {
          id: 'MDQ6VXNlcjU4MzIzMQ==',
          databaseId: 583231,
          login: 'octocat',
          contributionsCollection: {
            totalCommitContributions: -1,
            totalIssueContributions: 0,
            totalPullRequestContributions: 0,
            totalPullRequestReviewContributions: 0,
            restrictedContributionsCount: 0,
            contributionCalendar: {
              totalContributions: 0,
            },
          },
        },
      };
      assert.throws(
        () => parseAndValidateContributionResponse(negativePayload, '583231'),
        (err: unknown) => err instanceof InvalidContributionDataError && (err as Error).message.includes('expected non-negative integer')
      );
    });

    test('rejects non-integer floating point contribution numbers', () => {
      const floatPayload: RawContributionSnapshotResponse = {
        viewer: {
          id: 'MDQ6VXNlcjU4MzIzMQ==',
          databaseId: 583231,
          login: 'octocat',
          contributionsCollection: {
            totalCommitContributions: 5.5,
            totalIssueContributions: 0,
            totalPullRequestContributions: 0,
            totalPullRequestReviewContributions: 0,
            restrictedContributionsCount: 0,
            contributionCalendar: {
              totalContributions: 0,
            },
          },
        },
      };
      assert.throws(
        () => parseAndValidateContributionResponse(floatPayload, '583231'),
        (err: unknown) => err instanceof InvalidContributionDataError && (err as Error).message.includes('expected non-negative integer')
      );
    });

    test('preserves public vs restricted count separation and correctly sets mixed_restricted visibility', () => {
      const res = parseAndValidateContributionResponse(validRawPayload, '583231');
      assert.equal(res.contributions.restricted, 8);
      // Restricted count is kept in its own field and not summed into public commit/issue/PR counts
      const publicSum = res.contributions.commits + res.contributions.issues + res.contributions.pullRequests + res.contributions.pullRequestReviews;
      assert.equal(publicSum, 24);
      assert.equal(res.contributions.publicTotal, 24);
      assert.equal(res.hasRestrictedContributions, true);
      assert.equal(res.visibility, 'mixed_restricted');
      assert.notEqual(res.contributions.commits, 14 + 8, 'Restricted must not be mixed into commits');
    });

    test('correctly sets public visibility when restricted contributions are zero', () => {
      const purePublicPayload: RawContributionSnapshotResponse = {
        viewer: {
          id: 'MDQ6VXNlcjU4MzIzMQ==',
          databaseId: 583231,
          login: 'octocat',
          contributionsCollection: {
            totalCommitContributions: 10,
            totalIssueContributions: 2,
            totalPullRequestContributions: 3,
            totalPullRequestReviewContributions: 1,
            restrictedContributionsCount: 0,
            contributionCalendar: {
              totalContributions: 16,
            },
          },
        },
      };

      const res = parseAndValidateContributionResponse(purePublicPayload, '583231');
      assert.equal(res.contributions.restricted, 0);
      assert.equal(res.contributions.publicTotal, 16);
      assert.equal(res.contributions.total, 16);
      assert.equal(res.hasRestrictedContributions, false);
      assert.equal(res.visibility, 'public');
    });
  });

  describe('4. Token Redaction & Sensitive Data Protection', () => {
    test('redacts explicit access token from error string', () => {
      const plainToken = 'ghu_secretAccessToken1234567890abcdef';
      const rawError = `Upstream failed with token ${plainToken} in Authorization: Bearer ${plainToken}`;
      const redacted = redactSensitiveData(rawError, plainToken);

      assert.ok(!redacted.includes(plainToken));
      assert.ok(redacted.includes('[REDACTED_TOKEN]') || redacted.includes('[REDACTED_GITHUB_TOKEN]'));
    });

    test('redacts general GitHub App token patterns (ghu_, gho_, ghp_)', () => {
      const message = 'Failed: ghu_12345678901234567890, gho_abcdefghijklmnopqrstuvwxyz, ghp_98765432109876543210';
      const redacted = redactSensitiveData(message);

      assert.ok(!redacted.includes('ghu_12345678901234567890'));
      assert.ok(!redacted.includes('gho_abcdefghijklmnopqrstuvwxyz'));
      assert.ok(!redacted.includes('ghp_98765432109876543210'));
      assert.ok(redacted.includes('[REDACTED_GITHUB_TOKEN]'));
    });

    test('redacts Authorization: Bearer headers from text', () => {
      const headerText = 'Header was Authorization: Bearer someSecretTokenValue123';
      const redacted = redactSensitiveData(headerText);

      assert.ok(!redacted.includes('someSecretTokenValue123'));
      assert.ok(redacted.includes('Bearer [REDACTED_BEARER]'));
    });
  });

  describe('5. Error Classes Hierarchy & Properties', () => {
    test('GitHubGraphQLError formats summary from multiple error objects', () => {
      const err = new GitHubGraphQLError([
        { message: 'Field "foo" not found' },
        { message: 'Type mismatch on variable $from' },
      ]);
      assert.ok(err.message.includes('Field "foo" not found; Type mismatch on variable $from'));
      assert.equal(err.errors.length, 2);
    });

    test('GitHubRateLimitError preserves reset timestamp and retry-after', () => {
      const reset = new Date(Date.now() + 3600 * 1000);
      const err = new GitHubRateLimitError('Rate limited', reset, 60);
      assert.equal(err.resetAt, reset);
      assert.equal(err.retryAfterSeconds, 60);
    });

    test('GitHubServerError preserves status code', () => {
      const err = new GitHubServerError(503, 'GitHub unavailable');
      assert.equal(err.status, 503);
      assert.ok(err.message.includes('503'));
    });

    test('GitHubTimeoutError reports timeout in ms', () => {
      const err = new GitHubTimeoutError(10000);
      assert.ok(err.message.includes('10000ms'));
    });

    test('All error classes have distinct names', () => {
      assert.equal(new GitHubUnauthorizedError().name, 'GitHubUnauthorizedError');
      assert.equal(new GitHubForbiddenError().name, 'GitHubForbiddenError');
      assert.equal(new GitHubRateLimitError().name, 'GitHubRateLimitError');
      assert.equal(new GitHubServerError(500).name, 'GitHubServerError');
      assert.equal(new GitHubTimeoutError(1000).name, 'GitHubTimeoutError');
      assert.equal(new GitHubNetworkError().name, 'GitHubNetworkError');
    });
  });
});
