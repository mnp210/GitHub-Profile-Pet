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

export interface RateLimitInfo {
  cost: number;
  remaining: number;
  resetAt: string;
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

export interface RawGraphQLContributionResponse {
  user: {
    id: string;
    databaseId: number | null;
    login: string;
    contributionsCollection: {
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
    } | null;
  } | null;
  repositoryOwner?: {
    __typename: 'User' | 'Organization';
    id: string;
    login: string;
  } | null;
  rateLimit?: {
    cost: number;
    remaining: number;
    resetAt: string;
  } | null;
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
