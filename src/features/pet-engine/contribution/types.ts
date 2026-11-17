// src/features/pet-engine/contribution/types.ts
// Domain types and error definitions for GitHub GraphQL contribution provider and immutable identity verification

export interface ContributionCategoryCounts {
  commits: number;
  issues: number;
  pullRequests: number;
  pullRequestReviews: number;
  restricted: number;
  publicCategoryTotal: number;
  calendarReportedTotal: number;
}

export interface RateLimitHeaders {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  reset: number | null;
  resource: string | null;
  raw?: {
    limit: string | null;
    remaining: string | null;
    used: string | null;
    reset: string | null;
    resource: string | null;
  };
}

export interface RateLimitConsistencyCheck {
  isConsistent: boolean;
  discrepancies: string[];
}

export interface RateLimitInfo {
  limit: number | null;
  cost: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: string | null;
  headers?: RateLimitHeaders | null;
  consistency?: RateLimitConsistencyCheck;
}

export interface GitHubContributionSnapshot {
  ownerDatabaseId: number;
  ownerLogin: string;
  isPersonalAccount: boolean;
  fromIso: string;
  toIso: string;
  retrievedAtIso: string;
  counts: ContributionCategoryCounts;
  rateLimit?: RateLimitInfo;
  authenticationMode: 'mode_a_public';
  providerLatencyMs: number;
}

export interface RawGraphQLContributionCollection {
  startedAt?: string;
  endedAt?: string;
  totalCommitContributions: number;
  totalIssueContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  restrictedContributionsCount: number;
  contributionCalendar: {
    totalContributions: number;
  };
}

export interface RawGraphQLContributionResponse {
  user: {
    id: string;
    databaseId: number | null;
    login: string;
    contributionsCollection: RawGraphQLContributionCollection | null;
  } | null;
  repositoryOwner?: {
    __typename: 'User' | 'Organization';
    id: string;
    login: string;
  } | null;
  rateLimit?: {
    limit?: number | null;
    cost?: number | null;
    remaining?: number | null;
    used?: number | null;
    resetAt?: string | null;
  } | null;
}

export interface RawGraphQL2DayContributionResponse {
  repositoryOwner: {
    __typename: string;
    id: string;
    login: string;
  } | null;
  user: {
    id: string;
    databaseId: number | null;
    login: string;
    yesterday: RawGraphQLContributionCollection | null;
    today: RawGraphQLContributionCollection | null;
  } | null;
  rateLimit?: {
    limit?: number | null;
    cost?: number | null;
    remaining?: number | null;
    used?: number | null;
    resetAt?: string | null;
  } | null;
}

export interface TwoDayUtcWindows {
  yesterday: {
    date: string;     // YYYY-MM-DD
    fromIso: string;  // YYYY-MM-DDT00:00:00.000Z
    toIso: string;    // YYYY-MM-DDT23:59:59.999Z
  };
  today: {
    date: string;     // YYYY-MM-DD
    fromIso: string;  // YYYY-MM-DDT00:00:00.000Z
    toIso: string;    // YYYY-MM-DDT23:59:59.999Z
  };
}

export interface GitHub2DayContributionSnapshot {
  ownerDatabaseId: number;
  ownerLogin: string;
  isPersonalAccount: boolean;
  retrievedAtIso: string;
  yesterday: GitHubContributionSnapshot;
  today: GitHubContributionSnapshot;
  snapshots: [GitHubContributionSnapshot, GitHubContributionSnapshot];
  rateLimit?: RateLimitInfo;
  authenticationMode: 'mode_a_public';
  providerLatencyMs: number;
}

// ---------------------------------------------------------------------------
// Typed Error Classes
// ---------------------------------------------------------------------------

export class GitHubProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubProviderError';
  }
}

export class OrganizationAccountError extends GitHubProviderError {
  constructor(message = 'The specified GitHub account is an organization. Profile Pet requires a personal user account.') {
    super(message);
    this.name = 'OrganizationAccountError';
  }
}

export class UserNotFoundError extends GitHubProviderError {
  constructor(message = 'The specified GitHub user was not found.') {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

export class IdentityMismatchError extends GitHubProviderError {
  constructor(message = 'Queried GitHub databaseId does not match the established ledger ownerDatabaseId.') {
    super(message);
    this.name = 'IdentityMismatchError';
  }
}

export class MissingOwnerConfigurationError extends GitHubProviderError {
  constructor(message = 'Target owner login could not be resolved from environment or configuration.') {
    super(message);
    this.name = 'MissingOwnerConfigurationError';
  }
}

export class InvalidContributionDataError extends GitHubProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidContributionDataError';
  }
}
