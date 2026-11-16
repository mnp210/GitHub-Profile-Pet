// src/features/pet-engine/contribution/contributionProvider.ts
// Native fetch-based GitHub GraphQL provider for public profile contribution snapshots

import {
  getNativeGraphQLClient,
  redactSensitiveData,
  GitHubGraphQLError,
  type GitHubGraphQLClient,
  type GraphQLRequestOptions,
} from './nativeGraphQLClient.ts';
import {
  InvalidContributionDataError,
  OrganizationAccountError,
  UserNotFoundError,
  type GitHubContributionSnapshot,
  type RawGraphQLContributionResponse,
} from './types.ts';

export const USER_CONTRIBUTION_SNAPSHOT_QUERY = `
query UserContributionSnapshot(
  $login: String!
  $from: DateTime!
  $to: DateTime!
) {
  user(login: $login) {
    id
    databaseId
    login
    contributionsCollection(from: $from, to: $to) {
      startedAt
      endedAt
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
  rateLimit {
    cost
    remaining
    resetAt
  }
}
`.trim();

export const CHECK_REPOSITORY_OWNER_TYPE_QUERY = `
query CheckRepositoryOwnerType($login: String!) {
  repositoryOwner(login: $login) {
    __typename
    id
    login
  }
}
`.trim();

/**
 * Parses and validates raw GraphQL response data into a strict GitHubContributionSnapshot.
 * Validates numeric fields, detects organizations vs personal users, excludes restricted
 * contributions from the public category sum, and prevents incomplete data acceptance.
 */
export function parseAndValidateContributionResponse(
  raw: RawGraphQLContributionResponse,
  targetLogin: string,
  fromIso: string,
  toIso: string,
  latencyMs: number = 0
): GitHubContributionSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new InvalidContributionDataError('Raw GraphQL payload is not a valid object.');
  }

  // 1. Account type discrimination
  if (!raw.user) {
    if (raw.repositoryOwner?.__typename === 'Organization') {
      throw new OrganizationAccountError(
        `Configured account "${targetLogin}" is an Organization. Profile Pet requires an individual personal user account.`
      );
    }
    throw new UserNotFoundError(`GitHub user "${targetLogin}" was not found.`);
  }

  const user = raw.user;

  // 2. Validate user identity fields
  if (typeof user.login !== 'string' || user.login.trim().length === 0) {
    throw new InvalidContributionDataError(`Missing or invalid login field in user response for "${targetLogin}".`);
  }

  if (typeof user.databaseId !== 'number' || !Number.isInteger(user.databaseId) || user.databaseId <= 0) {
    throw new InvalidContributionDataError(
      `Invalid or missing numeric databaseId for user "${user.login}": expected positive integer.`
    );
  }

  // 3. Validate contributionsCollection existence
  if (!user.contributionsCollection || typeof user.contributionsCollection !== 'object') {
    throw new InvalidContributionDataError(
      `contributionsCollection is null or missing for user "${user.login}".`
    );
  }

  const coll = user.contributionsCollection;

  // 4. Validate category integer counts
  const validateNonNegativeInteger = (val: unknown, fieldName: string): number => {
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      throw new InvalidContributionDataError(
        `Field "${fieldName}" for user "${user.login}" must be a non-negative integer, received: ${String(val)}.`
      );
    }
    return val;
  };

  const commits = validateNonNegativeInteger(coll.totalCommitContributions, 'totalCommitContributions');
  const issues = validateNonNegativeInteger(coll.totalIssueContributions, 'totalIssueContributions');
  const pullRequests = validateNonNegativeInteger(coll.totalPullRequestContributions, 'totalPullRequestContributions');
  const pullRequestReviews = validateNonNegativeInteger(coll.totalPullRequestReviewContributions, 'totalPullRequestReviewContributions');
  const restricted = validateNonNegativeInteger(coll.restrictedContributionsCount, 'restrictedContributionsCount');

  if (!coll.contributionCalendar || typeof coll.contributionCalendar !== 'object') {
    throw new InvalidContributionDataError(
      `contributionCalendar is null or missing for user "${user.login}".`
    );
  }

  const calendarReportedTotal = validateNonNegativeInteger(
    coll.contributionCalendar.totalContributions,
    'contributionCalendar.totalContributions'
  );

  // 5. Calculate public category total strictly from the four approved categories
  // Restricted contributions are explicitly EXCLUDED in Mode A public synchronization
  const publicCategoryTotal = commits + issues + pullRequests + pullRequestReviews;

  // 6. Parse rate limit info if available
  let rateLimitInfo: GitHubContributionSnapshot['rateLimit'];
  if (raw.rateLimit && typeof raw.rateLimit === 'object') {
    const cost = typeof raw.rateLimit.cost === 'number' ? raw.rateLimit.cost : 1;
    const remaining = typeof raw.rateLimit.remaining === 'number' ? raw.rateLimit.remaining : 0;
    const resetAt = typeof raw.rateLimit.resetAt === 'string' ? raw.rateLimit.resetAt : '';
    rateLimitInfo = { cost, remaining, resetAt };
  }

  return {
    ownerDatabaseId: user.databaseId,
    ownerLogin: user.login,
    isPersonalAccount: true,
    fromIso,
    toIso,
    retrievedAtIso: new Date().toISOString(),
    counts: {
      commits,
      issues,
      pullRequests,
      pullRequestReviews,
      restricted,
      publicCategoryTotal,
      calendarReportedTotal,
    },
    rateLimit: rateLimitInfo,
    authenticationMode: 'mode_a_public',
    providerLatencyMs: Math.max(0, latencyMs),
  };
}

export class GitHubContributionProvider {
  private client: GitHubGraphQLClient;

  constructor(client?: GitHubGraphQLClient) {
    this.client = client ?? getNativeGraphQLClient();
  }

  /**
   * Fetches public contribution snapshot for a specific GitHub personal user within [from, to] UTC range.
   */
  public async fetchUserContributionSnapshot(
    login: string,
    from: string | Date,
    to: string | Date,
    token: string,
    options?: GraphQLRequestOptions
  ): Promise<GitHubContributionSnapshot> {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new InvalidContributionDataError('GitHub token must be provided.');
    }

    if (!login || typeof login !== 'string' || login.trim().length === 0) {
      throw new InvalidContributionDataError('Target GitHub login must be a non-empty string.');
    }

    const fromIso = typeof from === 'string' ? from : from.toISOString();
    const toIso = typeof to === 'string' ? to : to.toISOString();

    const normalizedLogin = login.trim();
    const startMs = Date.now();

    try {
      const rawData = await this.client.execute<RawGraphQLContributionResponse>(
        USER_CONTRIBUTION_SNAPSHOT_QUERY,
        {
          login: normalizedLogin,
          from: fromIso,
          to: toIso,
        },
        token,
        options
      );

      const latencyMs = Date.now() - startMs;
      return parseAndValidateContributionResponse(rawData, normalizedLogin, fromIso, toIso, latencyMs);
    } catch (err: unknown) {
      // If error is a GraphQL execution error indicating user could not be resolved,
      // probe repositoryOwner to accurately distinguish organization vs non-existent user.
      if (err instanceof GitHubGraphQLError) {
        const isUserNotFound = err.errors.some(
          (e) =>
            e.type === 'NOT_FOUND' ||
            e.message.toLowerCase().includes('could not resolve to a user')
        );

        if (isUserNotFound) {
          try {
            const ownerCheck = await this.client.execute<{
              repositoryOwner: { __typename: 'User' | 'Organization'; id: string; login: string } | null;
            }>(
              CHECK_REPOSITORY_OWNER_TYPE_QUERY,
              { login: normalizedLogin },
              token,
              options
            );

            if (ownerCheck.repositoryOwner?.__typename === 'Organization') {
              throw new OrganizationAccountError(
                `Configured account "${normalizedLogin}" is an Organization. Profile Pet requires an individual personal user account.`
              );
            }
            throw new UserNotFoundError(`GitHub user "${normalizedLogin}" was not found.`);
          } catch (innerErr) {
            if (innerErr instanceof OrganizationAccountError || innerErr instanceof UserNotFoundError) {
              throw innerErr;
            }
            // If check fails for other reasons, throw original UserNotFoundError
            throw new UserNotFoundError(`GitHub user "${normalizedLogin}" was not found.`);
          }
        }
      }

      const errorObj = err as Error;
      // Guarantee token is redacted in any error thrown or rethrown
      const sanitizedMessage = redactSensitiveData(errorObj.message, token);
      errorObj.message = sanitizedMessage;
      throw errorObj;
    }
  }
}
