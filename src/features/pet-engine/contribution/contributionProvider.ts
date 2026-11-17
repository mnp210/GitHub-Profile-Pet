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
  IdentityMismatchError,
  OrganizationAccountError,
  UserNotFoundError,
  type GitHubContributionSnapshot,
  type GitHub2DayContributionSnapshot,
  type RawGraphQLContributionResponse,
  type RawGraphQL2DayContributionResponse,
  type TwoDayUtcWindows,
  type ContributionCategoryCounts,
  type RateLimitHeaders,
  type RateLimitConsistencyCheck,
  type RateLimitInfo,
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
    limit
    cost
    remaining
    used
    resetAt
  }
}
`.trim();

export const USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY = `
query UserContributionSnapshot2Day(
  $login: String!
  $yesterdayFrom: DateTime!
  $yesterdayTo: DateTime!
  $todayFrom: DateTime!
  $todayTo: DateTime!
) {
  repositoryOwner(login: $login) {
    __typename
    id
    login
  }
  user(login: $login) {
    id
    databaseId
    login
    yesterday: contributionsCollection(from: $yesterdayFrom, to: $yesterdayTo) {
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
    today: contributionsCollection(from: $todayFrom, to: $todayTo) {
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
    limit
    cost
    remaining
    used
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
 * Strict validation of an ISO-8601 date-time string with an explicit timezone (Z or ±HH:MM).
 * Validates calendar components (year, month, days in month with leap-year rule)
 * and time components (hour 0-23, minute 0-59, second 0-59).
 * Rejects date-only, year-only, missing timezones, impossible calendar dates, and malformed offsets.
 */
export function isValidIsoDateTimeWithExplicitTimezone(val: string): boolean {
  if (typeof val !== 'string' || val.trim().length === 0) {
    return false;
  }

  // Complete ISO-8601 date-time with explicit timezone (Z or ±HH:MM)
  // Rejects date-only, year-only, missing timezone, single-digit offset components, etc.
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(val.trim());
  if (!isoMatch) {
    return false;
  }

  const year = parseInt(isoMatch[1], 10);
  const month = parseInt(isoMatch[2], 10);
  const day = parseInt(isoMatch[3], 10);
  const hour = parseInt(isoMatch[4], 10);
  const minute = parseInt(isoMatch[5], 10);
  const second = parseInt(isoMatch[6], 10);

  // Validate month range [1, 12]
  if (month < 1 || month > 12) {
    return false;
  }

  // Calculate days in month with leap-year rule
  // A leap year is divisible by 4, except end-of-century years which must be divisible by 400
  let daysInMonth = 31;
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    daysInMonth = 30;
  } else if (month === 2) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    daysInMonth = isLeapYear ? 29 : 28;
  }

  // Validate day range [1, daysInMonth]
  if (day < 1 || day > daysInMonth) {
    return false;
  }

  // Validate time ranges
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return false;
  }

  // Final check: parseable as valid JavaScript Date timestamp
  const dateObj = new Date(val.trim());
  return !isNaN(dateObj.getTime());
}

/**
 * Cross-checks GraphQL body rateLimit telemetry against HTTP response headers.
 * Detects discrepancies, missing fields, malformed formats, and internal contradictions.
 * Does not assume or hardcode any expected quota (e.g. 1,000 or 5,000).
 */
export function checkRateLimitConsistency(
  payloadRateLimit?: RateLimitInfo | null,
  headers?: RateLimitHeaders | null
): RateLimitConsistencyCheck {
  const discrepancies: string[] = [];

  // 1. GraphQL body existence
  if (!payloadRateLimit) {
    discrepancies.push('Missing GraphQL rateLimit telemetry in response payload.');
  } else {
    // Validate GraphQL limit
    if (payloadRateLimit.limit === null || typeof payloadRateLimit.limit !== 'number' || !Number.isInteger(payloadRateLimit.limit)) {
      discrepancies.push('Missing or non-integer GraphQL rateLimit.limit.');
    } else if (payloadRateLimit.limit <= 0) {
      discrepancies.push(`Invalid GraphQL rateLimit.limit: expected positive integer (> 0), received ${payloadRateLimit.limit}.`);
    }

    // Validate GraphQL cost
    if (payloadRateLimit.cost === null || typeof payloadRateLimit.cost !== 'number' || !Number.isInteger(payloadRateLimit.cost)) {
      discrepancies.push('Missing or non-integer GraphQL rateLimit.cost.');
    } else if (payloadRateLimit.cost <= 0) {
      discrepancies.push(`Invalid GraphQL rateLimit.cost: expected positive integer (> 0), received ${payloadRateLimit.cost}.`);
    }

    // Validate GraphQL remaining
    if (payloadRateLimit.remaining === null || typeof payloadRateLimit.remaining !== 'number' || !Number.isInteger(payloadRateLimit.remaining)) {
      discrepancies.push('Missing or non-integer GraphQL rateLimit.remaining.');
    } else if (payloadRateLimit.remaining < 0) {
      discrepancies.push(`Invalid GraphQL rateLimit.remaining: expected non-negative integer (>= 0), received ${payloadRateLimit.remaining}.`);
    }

    // Validate GraphQL used
    if (payloadRateLimit.used === null || typeof payloadRateLimit.used !== 'number' || !Number.isInteger(payloadRateLimit.used)) {
      discrepancies.push('Missing or non-integer GraphQL rateLimit.used.');
    } else if (payloadRateLimit.used < 0) {
      discrepancies.push(`Invalid GraphQL rateLimit.used: expected non-negative integer (>= 0), received ${payloadRateLimit.used}.`);
    }

    // Validate GraphQL resetAt
    if (!payloadRateLimit.resetAt || typeof payloadRateLimit.resetAt !== 'string' || payloadRateLimit.resetAt.trim().length === 0) {
      discrepancies.push('Missing or empty GraphQL rateLimit.resetAt timestamp.');
    } else if (!isValidIsoDateTimeWithExplicitTimezone(payloadRateLimit.resetAt)) {
      discrepancies.push(
        `Invalid GraphQL rateLimit.resetAt: expected complete ISO-8601 date-time with explicit timezone (Z or ±HH:MM) and valid calendar date, received "${payloadRateLimit.resetAt}".`
      );
    }

    // Validate internal invariants for GraphQL body (remaining & used vs limit)
    if (payloadRateLimit.limit !== null && payloadRateLimit.limit > 0) {
      if (payloadRateLimit.remaining !== null && payloadRateLimit.remaining >= 0 && payloadRateLimit.remaining > payloadRateLimit.limit) {
        discrepancies.push(`GraphQL rateLimit.remaining (${payloadRateLimit.remaining}) exceeds limit (${payloadRateLimit.limit}).`);
      }
      if (payloadRateLimit.used !== null && payloadRateLimit.used >= 0 && payloadRateLimit.used > payloadRateLimit.limit) {
        discrepancies.push(`GraphQL rateLimit.used (${payloadRateLimit.used}) exceeds limit (${payloadRateLimit.limit}).`);
      }
      if (
        payloadRateLimit.used !== null &&
        payloadRateLimit.remaining !== null &&
        payloadRateLimit.used >= 0 &&
        payloadRateLimit.remaining >= 0 &&
        payloadRateLimit.used + payloadRateLimit.remaining > payloadRateLimit.limit
      ) {
        discrepancies.push(
          `Internal sum overflow: GraphQL body used (${payloadRateLimit.used}) + remaining (${payloadRateLimit.remaining}) = ${payloadRateLimit.used + payloadRateLimit.remaining}, which exceeds limit (${payloadRateLimit.limit}).`
        );
      }
    }
  }

  // 2. HTTP transport headers existence & validation
  if (!headers) {
    discrepancies.push('Missing HTTP rate-limit headers (x-ratelimit-*): cannot cross-verify telemetry without transport headers.');
  } else {
    // Validate x-ratelimit-limit
    if (headers.raw?.limit === null || (headers.raw === undefined && headers.limit === null)) {
      discrepancies.push('Missing HTTP header x-ratelimit-limit.');
    } else if (headers.limit === null) {
      discrepancies.push(`Malformed HTTP header x-ratelimit-limit: expected positive integer string, received "${headers.raw?.limit}".`);
    } else if (headers.limit <= 0) {
      discrepancies.push(`Invalid HTTP header x-ratelimit-limit: expected positive integer (> 0), received ${headers.limit}.`);
    }

    // Validate x-ratelimit-remaining
    if (headers.raw?.remaining === null || (headers.raw === undefined && headers.remaining === null)) {
      discrepancies.push('Missing HTTP header x-ratelimit-remaining.');
    } else if (headers.remaining === null) {
      discrepancies.push(`Malformed HTTP header x-ratelimit-remaining: expected non-negative integer string, received "${headers.raw?.remaining}".`);
    } else if (headers.remaining < 0) {
      discrepancies.push(`Invalid HTTP header x-ratelimit-remaining: expected non-negative integer (>= 0), received ${headers.remaining}.`);
    } else if (headers.limit !== null && headers.limit > 0 && headers.remaining > headers.limit) {
      discrepancies.push(`HTTP header x-ratelimit-remaining (${headers.remaining}) exceeds x-ratelimit-limit (${headers.limit}).`);
    }

    // Validate x-ratelimit-used
    if (headers.raw?.used === null || (headers.raw === undefined && headers.used === null)) {
      discrepancies.push('Missing HTTP header x-ratelimit-used.');
    } else if (headers.used === null) {
      discrepancies.push(`Malformed HTTP header x-ratelimit-used: expected non-negative integer string, received "${headers.raw?.used}".`);
    } else if (headers.used < 0) {
      discrepancies.push(`Invalid HTTP header x-ratelimit-used: expected non-negative integer (>= 0), received ${headers.used}.`);
    } else if (headers.limit !== null && headers.limit > 0 && headers.used > headers.limit) {
      discrepancies.push(`HTTP header x-ratelimit-used (${headers.used}) exceeds x-ratelimit-limit (${headers.limit}).`);
    }

    // Validate internal sum overflow for HTTP headers
    if (
      headers.limit !== null &&
      headers.limit > 0 &&
      headers.used !== null &&
      headers.remaining !== null &&
      headers.used >= 0 &&
      headers.remaining >= 0 &&
      headers.used + headers.remaining > headers.limit
    ) {
      discrepancies.push(
        `Internal sum overflow: HTTP headers used (${headers.used}) + remaining (${headers.remaining}) = ${headers.used + headers.remaining}, which exceeds limit (${headers.limit}).`
      );
    }

    // Validate x-ratelimit-reset
    if (headers.raw?.reset === null || (headers.raw === undefined && headers.reset === null)) {
      discrepancies.push('Missing HTTP header x-ratelimit-reset.');
    } else if (headers.reset === null) {
      discrepancies.push(`Malformed HTTP header x-ratelimit-reset: expected positive epoch seconds string, received "${headers.raw?.reset}".`);
    } else if (headers.reset <= 0) {
      discrepancies.push(`Invalid HTTP header x-ratelimit-reset: expected positive epoch seconds timestamp, received ${headers.reset}.`);
    }

    // Validate x-ratelimit-resource
    if (headers.resource === null || headers.resource === undefined) {
      discrepancies.push('Missing HTTP header x-ratelimit-resource.');
    } else if (headers.resource !== 'graphql') {
      discrepancies.push(`Invalid HTTP header x-ratelimit-resource: expected "graphql", received "${headers.resource}".`);
    }
  }

  // 3. Cross-Comparison between GraphQL body and HTTP transport headers
  if (payloadRateLimit && headers) {
    if (payloadRateLimit.limit !== null && headers.limit !== null && payloadRateLimit.limit !== headers.limit) {
      discrepancies.push(
        `Limit mismatch: GraphQL body reports ${payloadRateLimit.limit}, HTTP header x-ratelimit-limit reports ${headers.limit}`
      );
    }

    if (payloadRateLimit.remaining !== null && headers.remaining !== null && payloadRateLimit.remaining !== headers.remaining) {
      discrepancies.push(
        `Remaining mismatch: GraphQL body reports ${payloadRateLimit.remaining}, HTTP header x-ratelimit-remaining reports ${headers.remaining}`
      );
    }

    if (payloadRateLimit.used !== null && headers.used !== null && payloadRateLimit.used !== headers.used) {
      discrepancies.push(
        `Used mismatch: GraphQL body reports ${payloadRateLimit.used}, HTTP header x-ratelimit-used reports ${headers.used}`
      );
    }

    if (payloadRateLimit.resetAt && headers.reset !== null && headers.reset > 0) {
      if (isValidIsoDateTimeWithExplicitTimezone(payloadRateLimit.resetAt)) {
        const payloadResetMs = new Date(payloadRateLimit.resetAt).getTime();
        const payloadResetEpoch = Math.floor(payloadResetMs / 1000);
        // Maximum 2-second comparison tolerance rationale:
        // GraphQL body returns resetAt as an ISO-8601 string while HTTP transport returns x-ratelimit-reset as integer Unix epoch seconds.
        // Converting an ISO-8601 string to Unix epoch seconds truncates sub-second millisecond fractions.
        // In addition, response header generation and payload serialization within the upstream API can cross sub-second boundaries.
        // A maximum tolerance of <= 2 seconds accommodates sub-second truncation and serialization jitter while strictly preventing minute/hour drift.
        const delta = Math.abs(payloadResetEpoch - headers.reset);
        if (delta > 2) {
          discrepancies.push(
            `Reset mismatch: GraphQL body resetAt=${payloadRateLimit.resetAt} (${payloadResetEpoch}s), HTTP header x-ratelimit-reset=${headers.reset}s (difference of ${delta}s exceeds 2s tolerance)`
          );
        }
      }
    }
  }

  return {
    isConsistent: discrepancies.length === 0,
    discrepancies,
  };
}

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
  latencyMs: number = 0,
  responseHeaders?: RateLimitHeaders | null
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

  if (user.login.toLowerCase() !== targetLogin.toLowerCase()) {
    throw new IdentityMismatchError(
      `Queried GitHub login "${user.login}" does not match target login "${targetLogin}".`
    );
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
  let rateLimitInfo: RateLimitInfo | undefined;
  if (raw.rateLimit && typeof raw.rateLimit === 'object') {
    const rawRl = raw.rateLimit;
    const limit = typeof rawRl.limit === 'number' && Number.isInteger(rawRl.limit) ? rawRl.limit : null;
    const cost = typeof rawRl.cost === 'number' && Number.isInteger(rawRl.cost) ? rawRl.cost : null;
    const remaining = typeof rawRl.remaining === 'number' && Number.isInteger(rawRl.remaining) ? rawRl.remaining : null;
    const used = typeof rawRl.used === 'number' && Number.isInteger(rawRl.used) ? rawRl.used : null;
    const resetAt = typeof rawRl.resetAt === 'string' && rawRl.resetAt.trim().length > 0 ? rawRl.resetAt.trim() : null;

    const baseRateLimit: RateLimitInfo = {
      limit,
      cost,
      remaining,
      used,
      resetAt,
      headers: responseHeaders ?? null,
    };

    baseRateLimit.consistency = checkRateLimitConsistency(baseRateLimit, responseHeaders ?? null);
    rateLimitInfo = baseRateLimit;
  } else if (responseHeaders) {
    rateLimitInfo = {
      limit: null,
      cost: null,
      remaining: null,
      used: null,
      resetAt: null,
      headers: responseHeaders,
      consistency: checkRateLimitConsistency(null, responseHeaders),
    };
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

/**
 * Computes strict UTC date windows for yesterday and today.
 * Both windows start at 00:00:00.000Z and end at 23:59:59.999Z.
 * Handles month and leap-year boundaries deterministically using Date.UTC.
 */
export function compute2DayUtcWindows(now: number | Date = Date.now()): TwoDayUtcWindows {
  const dateObj = typeof now === 'number' ? new Date(now) : now;
  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth();
  const day = dateObj.getUTCDate();

  const todayUtc = new Date(Date.UTC(year, month, day));
  const yesterdayUtc = new Date(Date.UTC(year, month, day - 1));

  const todayDate = todayUtc.toISOString().slice(0, 10);
  const yesterdayDate = yesterdayUtc.toISOString().slice(0, 10);

  return {
    yesterday: {
      date: yesterdayDate,
      fromIso: `${yesterdayDate}T00:00:00.000Z`,
      toIso: `${yesterdayDate}T23:59:59.999Z`,
    },
    today: {
      date: todayDate,
      fromIso: `${todayDate}T00:00:00.000Z`,
      toIso: `${todayDate}T23:59:59.999Z`,
    },
  };
}

export interface Fetch2DayOptions extends GraphQLRequestOptions {
  now?: number | Date;
  yesterdayFrom?: string;
  yesterdayTo?: string;
  todayFrom?: string;
  todayTo?: string;
  expectedOwnerDatabaseId?: number;
  requireStrictRateLimitConsistency?: boolean;
}

function parseAliasedCategoryCounts(
  coll: unknown,
  userLogin: string,
  windowLabel: string
): ContributionCategoryCounts {
  if (!coll || typeof coll !== 'object') {
    throw new InvalidContributionDataError(
      `Missing or null "${windowLabel}" contributionsCollection in GraphQL response for user "${userLogin}".`
    );
  }

  const c = coll as Record<string, unknown>;

  const validateNonNegativeInteger = (val: unknown, fieldName: string): number => {
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      throw new InvalidContributionDataError(
        `Field "${fieldName}" in "${windowLabel}" for user "${userLogin}" must be a non-negative integer, received: ${String(val)}.`
      );
    }
    return val;
  };

  const commits = validateNonNegativeInteger(c.totalCommitContributions, 'totalCommitContributions');
  const issues = validateNonNegativeInteger(c.totalIssueContributions, 'totalIssueContributions');
  const pullRequests = validateNonNegativeInteger(c.totalPullRequestContributions, 'totalPullRequestContributions');
  const pullRequestReviews = validateNonNegativeInteger(
    c.totalPullRequestReviewContributions,
    'totalPullRequestReviewContributions'
  );
  const restricted = validateNonNegativeInteger(c.restrictedContributionsCount, 'restrictedContributionsCount');

  if (!c.contributionCalendar || typeof c.contributionCalendar !== 'object') {
    throw new InvalidContributionDataError(
      `contributionCalendar is null or missing in "${windowLabel}" for user "${userLogin}".`
    );
  }

  const cal = c.contributionCalendar as Record<string, unknown>;
  const calendarReportedTotal = validateNonNegativeInteger(
    cal.totalContributions,
    'contributionCalendar.totalContributions'
  );

  // Four eligible public categories: commits, issues, PRs, reviews
  // Restricted contributions are explicitly EXCLUDED from publicCategoryTotal
  const publicCategoryTotal = commits + issues + pullRequests + pullRequestReviews;

  return {
    commits,
    issues,
    pullRequests,
    pullRequestReviews,
    restricted,
    publicCategoryTotal,
    calendarReportedTotal,
  };
}

/**
 * Parses and validates raw 2-day GraphQL aliased response into a strict GitHub2DayContributionSnapshot.
 * Validates immutable identity, category totals, rate limit telemetry, and excludes restricted counts.
 * Query cost is captured directly from raw response telemetry without assuming or hardcoding 1 point.
 */
export function parseAndValidate2DayContributionResponse(
  raw: RawGraphQL2DayContributionResponse,
  targetLogin: string,
  windows: TwoDayUtcWindows,
  latencyMs: number = 0,
  responseHeaders?: RateLimitHeaders | null,
  options?: {
    expectedOwnerDatabaseId?: number;
    requireStrictRateLimitConsistency?: boolean;
  }
): GitHub2DayContributionSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new InvalidContributionDataError('Raw GraphQL payload is not a valid object.');
  }

  // 1. Account existence and repositoryOwner validation
  if (raw.repositoryOwner === null && raw.user === null) {
    throw new UserNotFoundError(`GitHub user "${targetLogin}" was not found.`);
  }

  if (raw.repositoryOwner === undefined || raw.repositoryOwner === null || typeof raw.repositoryOwner !== 'object') {
    throw new InvalidContributionDataError(
      `Missing or malformed repositoryOwner in GraphQL response for "${targetLogin}".`
    );
  }

  const repoOwner = raw.repositoryOwner;

  if (typeof repoOwner.__typename !== 'string' || repoOwner.__typename.trim().length === 0) {
    throw new InvalidContributionDataError(
      `Missing __typename on repositoryOwner in GraphQL response for "${targetLogin}".`
    );
  }

  if (repoOwner.__typename !== 'User' && repoOwner.__typename !== 'Organization') {
    throw new InvalidContributionDataError(
      `Unknown __typename on repositoryOwner for "${targetLogin}": received "${repoOwner.__typename}". Expected "User" or "Organization".`
    );
  }

  if (repoOwner.__typename === 'Organization') {
    throw new OrganizationAccountError(
      `Configured account "${targetLogin}" is an Organization. Profile Pet requires an individual personal user account.`
    );
  }

  if (typeof repoOwner.login !== 'string' || repoOwner.login.trim().length === 0) {
    throw new InvalidContributionDataError(
      `Missing or empty login on repositoryOwner in GraphQL response for "${targetLogin}".`
    );
  }

  if (repoOwner.login.toLowerCase() !== targetLogin.toLowerCase()) {
    throw new IdentityMismatchError(
      `Repository owner login "${repoOwner.login}" does not match target login "${targetLogin}".`
    );
  }

  // 2. Personal user validation
  if (!raw.user || typeof raw.user !== 'object') {
    throw new InvalidContributionDataError(
      `Repository owner for "${targetLogin}" is a User, but user contribution details object is null or missing.`
    );
  }

  const user = raw.user;

  if (typeof user.login !== 'string' || user.login.trim().length === 0) {
    throw new InvalidContributionDataError(
      `Missing or invalid login field in user response for "${targetLogin}".`
    );
  }

  if (user.login.toLowerCase() !== targetLogin.toLowerCase()) {
    throw new IdentityMismatchError(
      `Queried GitHub user login "${user.login}" does not match target login "${targetLogin}".`
    );
  }

  if (user.login.toLowerCase() !== repoOwner.login.toLowerCase()) {
    throw new IdentityMismatchError(
      `User login "${user.login}" does not match repositoryOwner login "${repoOwner.login}".`
    );
  }

  if (typeof user.databaseId !== 'number' || !Number.isInteger(user.databaseId) || user.databaseId <= 0) {
    throw new InvalidContributionDataError(
      `Invalid or missing numeric databaseId for user "${user.login}": expected positive integer.`
    );
  }

  if (options?.expectedOwnerDatabaseId !== undefined) {
    if (user.databaseId !== options.expectedOwnerDatabaseId) {
      throw new IdentityMismatchError(
        `Queried GitHub databaseId (${user.databaseId}) does not match expected ownerDatabaseId (${options.expectedOwnerDatabaseId}).`
      );
    }
  }

  // 3. Validate both aliased collections
  const yesterdayCounts = parseAliasedCategoryCounts(user.yesterday, user.login, 'yesterday');
  const todayCounts = parseAliasedCategoryCounts(user.today, user.login, 'today');

  // 4. Rate limit parsing & validation (cost measured directly from response, not assumed or hardcoded)
  let rateLimitInfo: RateLimitInfo | undefined;
  if (raw.rateLimit && typeof raw.rateLimit === 'object') {
    const rawRl = raw.rateLimit;
    const limit = typeof rawRl.limit === 'number' && Number.isInteger(rawRl.limit) ? rawRl.limit : null;
    const cost = typeof rawRl.cost === 'number' && Number.isInteger(rawRl.cost) ? rawRl.cost : null;
    const remaining = typeof rawRl.remaining === 'number' && Number.isInteger(rawRl.remaining) ? rawRl.remaining : null;
    const used = typeof rawRl.used === 'number' && Number.isInteger(rawRl.used) ? rawRl.used : null;
    const resetAt = typeof rawRl.resetAt === 'string' && rawRl.resetAt.trim().length > 0 ? rawRl.resetAt.trim() : null;

    const baseRateLimit: RateLimitInfo = {
      limit,
      cost,
      remaining,
      used,
      resetAt,
      headers: responseHeaders ?? null,
    };

    baseRateLimit.consistency = checkRateLimitConsistency(baseRateLimit, responseHeaders ?? null);
    if (options?.requireStrictRateLimitConsistency && !baseRateLimit.consistency.isConsistent) {
      throw new InvalidContributionDataError(
        `Rate limit telemetry consistency validation failed: ${baseRateLimit.consistency.discrepancies.join('; ')}`
      );
    }
    rateLimitInfo = baseRateLimit;
  } else if (responseHeaders) {
    const consistency = checkRateLimitConsistency(null, responseHeaders);
    if (options?.requireStrictRateLimitConsistency && !consistency.isConsistent) {
      throw new InvalidContributionDataError(
        `Rate limit telemetry consistency validation failed: ${consistency.discrepancies.join('; ')}`
      );
    }
    rateLimitInfo = {
      limit: null,
      cost: null,
      remaining: null,
      used: null,
      resetAt: null,
      headers: responseHeaders,
      consistency,
    };
  }

  const retrievedAtIso = new Date().toISOString();

  const yesterdaySnapshot: GitHubContributionSnapshot = {
    ownerDatabaseId: user.databaseId,
    ownerLogin: user.login,
    isPersonalAccount: true,
    fromIso: windows.yesterday.fromIso,
    toIso: windows.yesterday.toIso,
    retrievedAtIso,
    counts: yesterdayCounts,
    rateLimit: rateLimitInfo,
    authenticationMode: 'mode_a_public',
    providerLatencyMs: Math.max(0, latencyMs),
  };

  const todaySnapshot: GitHubContributionSnapshot = {
    ownerDatabaseId: user.databaseId,
    ownerLogin: user.login,
    isPersonalAccount: true,
    fromIso: windows.today.fromIso,
    toIso: windows.today.toIso,
    retrievedAtIso,
    counts: todayCounts,
    rateLimit: rateLimitInfo,
    authenticationMode: 'mode_a_public',
    providerLatencyMs: Math.max(0, latencyMs),
  };

  return {
    ownerDatabaseId: user.databaseId,
    ownerLogin: user.login,
    isPersonalAccount: true,
    retrievedAtIso,
    yesterday: yesterdaySnapshot,
    today: todaySnapshot,
    snapshots: [yesterdaySnapshot, todaySnapshot],
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

    let capturedHeaders: RateLimitHeaders | null = null;
    const wrappedOptions: GraphQLRequestOptions = {
      ...options,
      onResponseHeaders: (headers) => {
        capturedHeaders = headers;
        if (options?.onResponseHeaders) {
          try {
            options.onResponseHeaders(headers);
          } catch {
            // Callback failure must not prevent response handling
          }
        }
      },
    };

    try {
      const rawData = await this.client.execute<RawGraphQLContributionResponse>(
        USER_CONTRIBUTION_SNAPSHOT_QUERY,
        {
          login: normalizedLogin,
          from: fromIso,
          to: toIso,
        },
        token,
        wrappedOptions
      );

      const latencyMs = Date.now() - startMs;
      return parseAndValidateContributionResponse(
        rawData,
        normalizedLogin,
        fromIso,
        toIso,
        latencyMs,
        capturedHeaders
      );
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

  /**
   * Fetches the 2-day public contribution snapshot for a personal user using GraphQL aliases.
   * Queries strictly two UTC date windows: yesterday and today (00:00:00.000Z to 23:59:59.999Z).
   * Validates numeric identity, eligible categories, rate limit telemetry, and redacts secrets.
   */
  public async fetchUserContributionSnapshot2Day(
    login: string,
    token: string,
    options?: Fetch2DayOptions
  ): Promise<GitHub2DayContributionSnapshot> {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new InvalidContributionDataError('GitHub token must be provided.');
    }

    if (!login || typeof login !== 'string' || login.trim().length === 0) {
      throw new InvalidContributionDataError('Target GitHub login must be a non-empty string.');
    }

    const normalizedLogin = login.trim();
    const windows = compute2DayUtcWindows(options?.now ?? Date.now());

    const yesterdayFrom = options?.yesterdayFrom ?? windows.yesterday.fromIso;
    const yesterdayTo = options?.yesterdayTo ?? windows.yesterday.toIso;
    const todayFrom = options?.todayFrom ?? windows.today.fromIso;
    const todayTo = options?.todayTo ?? windows.today.toIso;

    // Validate that windows are valid ISO strings with explicit timezones
    if (
      !isValidIsoDateTimeWithExplicitTimezone(yesterdayFrom) ||
      !isValidIsoDateTimeWithExplicitTimezone(yesterdayTo) ||
      !isValidIsoDateTimeWithExplicitTimezone(todayFrom) ||
      !isValidIsoDateTimeWithExplicitTimezone(todayTo)
    ) {
      throw new InvalidContributionDataError(
        'Date window boundaries must be complete ISO-8601 date-time strings with explicit timezones.'
      );
    }

    const effectiveWindows: TwoDayUtcWindows = {
      yesterday: {
        date: yesterdayFrom.slice(0, 10),
        fromIso: yesterdayFrom,
        toIso: yesterdayTo,
      },
      today: {
        date: todayFrom.slice(0, 10),
        fromIso: todayFrom,
        toIso: todayTo,
      },
    };

    const startMs = Date.now();
    let capturedHeaders: RateLimitHeaders | null = null;
    const wrappedOptions: GraphQLRequestOptions = {
      ...options,
      onResponseHeaders: (headers) => {
        capturedHeaders = headers;
        if (options?.onResponseHeaders) {
          try {
            options.onResponseHeaders(headers);
          } catch {
            // Callback failure must not prevent response handling
          }
        }
      },
    };

    try {
      const rawData = await this.client.execute<RawGraphQL2DayContributionResponse>(
        USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY,
        {
          login: normalizedLogin,
          yesterdayFrom,
          yesterdayTo,
          todayFrom,
          todayTo,
        },
        token,
        wrappedOptions
      );

      const latencyMs = Date.now() - startMs;
      return parseAndValidate2DayContributionResponse(
        rawData,
        normalizedLogin,
        effectiveWindows,
        latencyMs,
        capturedHeaders,
        {
          expectedOwnerDatabaseId: options?.expectedOwnerDatabaseId,
          requireStrictRateLimitConsistency: options?.requireStrictRateLimitConsistency,
        }
      );
    } catch (err: unknown) {
      if (err instanceof GitHubGraphQLError) {
        // Primary query carries repositoryOwner in partialData if GraphQL execution produced partial data with errors
        const partial = err.partialData as RawGraphQL2DayContributionResponse | undefined;
        if (partial && typeof partial === 'object') {
          if (partial.repositoryOwner?.__typename === 'Organization') {
            throw new OrganizationAccountError(
              `Configured account "${normalizedLogin}" is an Organization. Profile Pet requires an individual personal user account.`
            );
          }
          if (partial.repositoryOwner === null && partial.user === null) {
            throw new UserNotFoundError(`GitHub user "${normalizedLogin}" was not found.`);
          }
        }

        const isUserNotFound = err.errors.some(
          (e) =>
            e.type === 'NOT_FOUND' ||
            e.message.toLowerCase().includes('could not resolve to a user')
        );

        if (isUserNotFound) {
          throw new UserNotFoundError(`GitHub user "${normalizedLogin}" was not found.`);
        }
      }

      const errorObj = err as Error;
      const sanitizedMessage = redactSensitiveData(errorObj.message, token);
      errorObj.message = sanitizedMessage;
      throw errorObj;
    }
  }
}
