// src/lib/github/contributionSnapshot.ts
// Strongly-typed GitHub ContributionsCollection query, date range normalization, and identity verification

import { getGitHubGraphQLClient, type GraphQLRequestOptions } from './graphqlClient.ts';
import { getValidAccessToken } from './tokenManager.ts';
import { UserRepository } from '../db/repositories/userRepository.ts';

export const CONTRIBUTION_SNAPSHOT_QUERY = `
query ContributionSnapshot($from: DateTime!, $to: DateTime!) {
  viewer {
    id
    databaseId
    login
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
      }
    }
  }
}
`.trim();

export interface GitHubContributionSnapshot {
  githubUserId: string;
  username: string;
  period: {
    from: string; // ISO 8601 UTC
    to: string;   // ISO 8601 UTC
  };
  contributions: {
    commits: number;
    issues: number;
    pullRequests: number;
    pullRequestReviews: number;
    restricted: number;
    total: number;       // Raw calendar total reported by GitHub (includes restricted when shared)
    publicTotal: number; // Guaranteed public-only total: commits + issues + PRs + reviews
  };
  retrievedAt: string; // ISO 8601 UTC
  visibility: 'public' | 'mixed_restricted';
  hasRestrictedContributions: boolean;
}

export interface RawContributionSnapshotResponse {
  viewer: {
    id: string;
    databaseId: number | null;
    login: string;
    contributionsCollection: {
      totalCommitContributions: number;
      totalIssueContributions: number;
      totalPullRequestContributions: number;
      totalPullRequestReviewContributions: number;
      restrictedContributionsCount: number;
      contributionCalendar: {
        totalContributions: number;
      };
    } | null;
  } | null;
}

export class InvalidDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDateRangeError';
  }
}

export class GitHubIdentityMismatchError extends Error {
  constructor(message = 'GitHub authenticated viewer identity does not match stored account.') {
    super(message);
    this.name = 'GitHubIdentityMismatchError';
  }
}

export class InvalidContributionDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidContributionDataError';
  }
}

export class UserNotFoundError extends Error {
  constructor(message = 'User not found.') {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

const MAX_QUERY_RANGE_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Validates, normalizes, and bounds date ranges into deterministic UTC ISO-8601 strings.
 * Defaults to current UTC calendar day if parameters are omitted.
 */
export function validateAndNormalizeDateRange(
  fromStr?: string | null,
  toStr?: string | null
): { from: string; to: string } {
  const now = new Date();

  let fromDate: Date;
  let toDate: Date;

  if (!fromStr && !toStr) {
    // Default to current UTC calendar day: 00:00:00.000Z to 23:59:59.999Z
    fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  } else if (fromStr && !toStr) {
    fromDate = new Date(fromStr);
    toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  } else if (!fromStr && toStr) {
    toDate = new Date(toStr);
    fromDate = new Date(toDate.getTime() - 30 * MS_PER_DAY);
  } else {
    fromDate = new Date(fromStr as string);
    toDate = new Date(toStr as string);
  }

  if (isNaN(fromDate.getTime())) {
    throw new InvalidDateRangeError(`Invalid start date ("from"): "${fromStr}". Expected valid ISO-8601 date string.`);
  }

  if (isNaN(toDate.getTime())) {
    throw new InvalidDateRangeError(`Invalid end date ("to"): "${toStr}". Expected valid ISO-8601 date string.`);
  }

  if (fromDate.getTime() > toDate.getTime()) {
    throw new InvalidDateRangeError(
      `Start date ("from": ${fromDate.toISOString()}) cannot be after end date ("to": ${toDate.toISOString()}).`
    );
  }

  const durationDays = (toDate.getTime() - fromDate.getTime()) / MS_PER_DAY;
  if (durationDays > MAX_QUERY_RANGE_DAYS) {
    throw new InvalidDateRangeError(
      `Date range span of ${Math.round(durationDays)} days exceeds the maximum allowed range of ${MAX_QUERY_RANGE_DAYS} days.`
    );
  }

  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

/**
 * Validates the raw GraphQL payload from GitHub and extracts strongly-typed contribution fields.
 */
export function parseAndValidateContributionResponse(
  data: RawContributionSnapshotResponse,
  expectedGitHubUserId: string
): {
  githubUserId: string;
  username: string;
  contributions: GitHubContributionSnapshot['contributions'];
  visibility: GitHubContributionSnapshot['visibility'];
  hasRestrictedContributions: boolean;
} {
  if (!data || !data.viewer) {
    throw new InvalidContributionDataError('Malformed GraphQL response: missing viewer node.');
  }

  const { viewer } = data;

  if (typeof viewer.databaseId !== 'number' || !Number.isInteger(viewer.databaseId)) {
    throw new InvalidContributionDataError('Malformed viewer node: missing or non-integer databaseId.');
  }

  if (String(viewer.databaseId) !== expectedGitHubUserId) {
    throw new GitHubIdentityMismatchError(
      `Identity mismatch: GraphQL viewer.databaseId (${viewer.databaseId}) does not match stored account (${expectedGitHubUserId}).`
    );
  }

  if (!viewer.login || typeof viewer.login !== 'string') {
    throw new InvalidContributionDataError('Malformed viewer node: missing or invalid login.');
  }

  const cc = viewer.contributionsCollection;
  if (!cc) {
    throw new InvalidContributionDataError('Missing contributionsCollection in viewer response.');
  }

  const numericFields: Array<[string, number]> = [
    ['totalCommitContributions', cc.totalCommitContributions],
    ['totalIssueContributions', cc.totalIssueContributions],
    ['totalPullRequestContributions', cc.totalPullRequestContributions],
    ['totalPullRequestReviewContributions', cc.totalPullRequestReviewContributions],
    ['restrictedContributionsCount', cc.restrictedContributionsCount],
  ];

  for (const [name, val] of numericFields) {
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      throw new InvalidContributionDataError(
        `Invalid contribution count for "${name}": expected non-negative integer, got ${val}.`
      );
    }
  }

  if (!cc.contributionCalendar || typeof cc.contributionCalendar.totalContributions !== 'number') {
    throw new InvalidContributionDataError('Missing or invalid contributionCalendar.totalContributions.');
  }

  const total = cc.contributionCalendar.totalContributions;
  if (!Number.isInteger(total) || total < 0) {
    throw new InvalidContributionDataError(`Invalid calendar totalContributions: expected non-negative integer, got ${total}.`);
  }

  const publicTotal =
    cc.totalCommitContributions +
    cc.totalIssueContributions +
    cc.totalPullRequestContributions +
    cc.totalPullRequestReviewContributions;

  const hasRestricted = cc.restrictedContributionsCount > 0;
  const visibility: GitHubContributionSnapshot['visibility'] = hasRestricted
    ? 'mixed_restricted'
    : 'public';

  return {
    githubUserId: String(viewer.databaseId),
    username: viewer.login,
    contributions: {
      commits: cc.totalCommitContributions,
      issues: cc.totalIssueContributions,
      pullRequests: cc.totalPullRequestContributions,
      pullRequestReviews: cc.totalPullRequestReviewContributions,
      restricted: cc.restrictedContributionsCount,
      total,
      publicTotal,
    },
    visibility,
    hasRestrictedContributions: hasRestricted,
  };
}

export interface FetchContributionSnapshotParams {
  userId: string;
  from?: string | null;
  to?: string | null;
  requestOptions?: GraphQLRequestOptions;
}

/**
 * High-level service function to retrieve a validated contribution snapshot for a user.
 * Read-only: Does NOT award XP, modify pet vitals, or insert ledger rows.
 */
export async function fetchContributionSnapshot(
  params: FetchContributionSnapshotParams
): Promise<GitHubContributionSnapshot> {
  const userDetails = await UserRepository.findByUserId(params.userId);
  if (!userDetails) {
    throw new UserNotFoundError(`Trainer account for user ID "${params.userId}" does not exist.`);
  }

  const { account } = userDetails;
  const dateRange = validateAndNormalizeDateRange(params.from, params.to);

  // Retrieve valid access token (refreshes transparently if expired, serialized per account)
  const accessToken = await getValidAccessToken(account);

  // Record request initiation timestamp immediately before dispatching upstream network request.
  // This guarantees that slow or delayed requests cannot masquerade as newer observations merely
  // because their HTTP response completed later.
  const requestInitiatedAt = new Date().toISOString();

  // Query GitHub GraphQL API
  const client = getGitHubGraphQLClient();
  const rawData = await client.execute<RawContributionSnapshotResponse>(
    CONTRIBUTION_SNAPSHOT_QUERY,
    {
      from: dateRange.from,
      to: dateRange.to,
    },
    accessToken,
    params.requestOptions
  );

  // Validate identity, visibility, and payload structure
  const validated = parseAndValidateContributionResponse(rawData, account.github_user_id);

  // Safely handle username change if user renamed their GitHub handle
  if (validated.username.toLowerCase() !== account.username.toLowerCase()) {
    UserRepository.updateHandleIfChanged(params.userId, validated.username).catch((err) => {
      console.warn(`[ContributionSync] Failed to update handle after rename: ${(err as Error).message}`);
    });
  }

  return {
    githubUserId: validated.githubUserId,
    username: validated.username,
    period: {
      from: dateRange.from,
      to: dateRange.to,
    },
    contributions: validated.contributions,
    retrievedAt: requestInitiatedAt,
    visibility: validated.visibility,
    hasRestrictedContributions: validated.hasRestrictedContributions,
  };
}
