// src/lib/github/failureClassification.ts
// Centralized classification for GitHub API errors, network failures, rate limits, and authentication states

import {
  GitHubGraphQLError,
  GitHubUnauthorizedError,
  GitHubForbiddenError,
  GitHubRateLimitError,
  GitHubServerError,
  GitHubTimeoutError,
  GitHubNetworkError,
  redactSensitiveData,
} from './graphqlClient.ts';
import {
  InvalidDateRangeError,
  GitHubIdentityMismatchError,
  InvalidContributionDataError,
  UserNotFoundError,
} from './contributionSnapshot.ts';
import {
  GitHubAccountDisconnectedError,
  GitHubMissingCredentialsError,
  GitHubTokenExpiredError,
  GitHubTokenRefreshError,
  GitHubReauthorizationRequiredError,
} from './tokenManager.ts';
import { DuplicateSequenceConflictError } from '../db/repositories/syncRepository.ts';
import { InvalidDateError } from './dailyReconciliation.ts';

export type GitHubFailureCategory =
  | 'TRANSIENT_NETWORK'
  | 'TIMEOUT'
  | 'UPSTREAM_5XX'
  | 'PRIMARY_RATE_LIMIT'
  | 'SECONDARY_RATE_LIMIT'
  | 'AUTHENTICATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'GRAPHQL_ERROR'
  | 'INVALID_REQUEST'
  | 'DATABASE_ERROR'
  | 'UNKNOWN_ERROR';

export interface RateLimitMetadata {
  kind: 'primary' | 'secondary';
  resetAt: Date | null;
  retryAfterSeconds: number | null;
}

export interface ClassifiedGitHubError {
  category: GitHubFailureCategory;
  retryable: boolean;
  statusCode?: number;
  rateLimit?: RateLimitMetadata;
  errorCode: string;
  message: string;
}

/**
 * Classifies any error into a standardized category, retryability determination, and stable machine-readable code.
 * Ensures all tokens, secrets, and raw credentials in the error message are redacted.
 */
export function classifyGitHubError(err: unknown, tokenToRedact?: string): ClassifiedGitHubError {
  const errorObj = err instanceof Error ? err : new Error(String(err));
  const rawMessage = errorObj.message || 'Unknown error occurred.';
  const sanitizedMessage = redactSensitiveData(rawMessage, tokenToRedact);

  // 1. Rate Limit Errors (Primary vs Secondary)
  if (err instanceof GitHubRateLimitError) {
    const isSecondary =
      err.kind === 'secondary' ||
      sanitizedMessage.toLowerCase().includes('secondary') ||
      sanitizedMessage.toLowerCase().includes('abuse') ||
      (err.retryAfterSeconds !== null && err.kind !== 'primary');

    const rateLimit: RateLimitMetadata = {
      kind: isSecondary ? 'secondary' : 'primary',
      resetAt: err.resetAt,
      retryAfterSeconds: err.retryAfterSeconds,
    };

    // Secondary rate limits with a small retry-after budget (<= 2 seconds) may be retryable
    const retryable = isSecondary && err.retryAfterSeconds !== null && err.retryAfterSeconds <= 2;

    return {
      category: isSecondary ? 'SECONDARY_RATE_LIMIT' : 'PRIMARY_RATE_LIMIT',
      retryable,
      statusCode: 429,
      rateLimit,
      errorCode: isSecondary ? 'SECONDARY_RATE_LIMIT' : 'PRIMARY_RATE_LIMIT',
      message: sanitizedMessage,
    };
  }

  // 1b. Generic Rate Limit Messages (when not explicitly wrapped in GitHubForbiddenError)
  const lowerMsg = sanitizedMessage.toLowerCase();
  const isPlainSecondary =
    lowerMsg.includes('secondary rate limit') || lowerMsg.includes('abuse detection');
  const isPlainPrimary =
    lowerMsg.includes('primary rate limit') ||
    lowerMsg.includes('rate limit exceeded') ||
    lowerMsg.includes('api rate limit');

  if (isPlainSecondary && !(err instanceof GitHubForbiddenError)) {
    return {
      category: 'SECONDARY_RATE_LIMIT',
      retryable: false,
      statusCode: 429,
      rateLimit: { kind: 'secondary', resetAt: null, retryAfterSeconds: null },
      errorCode: 'SECONDARY_RATE_LIMIT',
      message: sanitizedMessage,
    };
  }

  if (isPlainPrimary && !(err instanceof GitHubForbiddenError)) {
    return {
      category: 'PRIMARY_RATE_LIMIT',
      retryable: false,
      statusCode: 429,
      rateLimit: { kind: 'primary', resetAt: null, retryAfterSeconds: null },
      errorCode: 'PRIMARY_RATE_LIMIT',
      message: sanitizedMessage,
    };
  }

  // 2. GraphQL Query Execution Errors (including partial data payloads - never classify as client timeout)
  if (err instanceof GitHubGraphQLError) {
    return {
      category: 'GRAPHQL_ERROR',
      retryable: false,
      statusCode: 502,
      errorCode: 'GRAPHQL_EXECUTION_ERROR',
      message: sanitizedMessage,
    };
  }

  // 3. Request Timeout Errors
  if (
    err instanceof GitHubTimeoutError ||
    errorObj.name === 'TimeoutError' ||
    errorObj.name === 'AbortError' ||
    sanitizedMessage.toLowerCase().includes('timed out') ||
    sanitizedMessage.toLowerCase().includes('timeout')
  ) {
    return {
      category: 'TIMEOUT',
      retryable: true,
      statusCode: 503,
      errorCode: 'UPSTREAM_TIMEOUT',
      message: sanitizedMessage,
    };
  }

  // 3. Transient Network Errors
  if (
    err instanceof GitHubNetworkError ||
    sanitizedMessage.includes('ECONNRESET') ||
    sanitizedMessage.includes('ETIMEDOUT') ||
    sanitizedMessage.includes('ENOTFOUND') ||
    sanitizedMessage.includes('fetch failed') ||
    sanitizedMessage.includes('socket hang up') ||
    sanitizedMessage.includes('Network error')
  ) {
    return {
      category: 'TRANSIENT_NETWORK',
      retryable: true,
      statusCode: 502,
      errorCode: 'TRANSIENT_NETWORK_FAILURE',
      message: sanitizedMessage,
    };
  }

  // 4. Upstream Server Errors (HTTP 5xx)
  if (err instanceof GitHubServerError) {
    const is5xx = err.status >= 500 && err.status <= 599;
    return {
      category: is5xx ? 'UPSTREAM_5XX' : 'UNKNOWN_ERROR',
      retryable: is5xx,
      statusCode: err.status,
      errorCode: is5xx ? 'UPSTREAM_SERVER_ERROR' : 'UPSTREAM_ERROR',
      message: sanitizedMessage,
    };
  }

  // 5. Authentication & Token Revocation Errors (Non-retryable)
  if (
    err instanceof GitHubUnauthorizedError ||
    err instanceof GitHubTokenExpiredError ||
    err instanceof GitHubTokenRefreshError
  ) {
    const isReauth =
      err instanceof GitHubReauthorizationRequiredError ||
      err instanceof GitHubUnauthorizedError ||
      err instanceof GitHubTokenExpiredError;

    return {
      category: 'AUTHENTICATION_ERROR',
      retryable: false,
      statusCode: isReauth ? 401 : 502,
      errorCode: isReauth ? 'REAUTHORIZATION_REQUIRED' : 'TOKEN_REFRESH_FAILED',
      message: sanitizedMessage,
    };
  }

  // 6. Permission & Disconnection Errors (Non-retryable HTTP 403)
  if (
    err instanceof GitHubForbiddenError ||
    err instanceof GitHubAccountDisconnectedError ||
    err instanceof GitHubMissingCredentialsError ||
    err instanceof GitHubIdentityMismatchError
  ) {
    return {
      category: 'PERMISSION_DENIED',
      retryable: false,
      statusCode: 403,
      errorCode:
        err instanceof GitHubIdentityMismatchError
          ? 'IDENTITY_MISMATCH'
          : err instanceof GitHubAccountDisconnectedError
            ? 'ACCOUNT_DISCONNECTED'
            : err instanceof GitHubMissingCredentialsError
              ? 'MISSING_CREDENTIALS'
              : 'PERMISSION_DENIED',
      message: sanitizedMessage,
    };
  }

  // 7. Invalid Request / Validation Errors (HTTP 400 or 404 or 409)
  if (err instanceof DuplicateSequenceConflictError) {
    return {
      category: 'INVALID_REQUEST',
      retryable: false,
      statusCode: 409,
      errorCode: 'DUPLICATE_SEQUENCE_CONFLICT',
      message: sanitizedMessage,
    };
  }

  if (err instanceof UserNotFoundError) {
    return {
      category: 'INVALID_REQUEST',
      retryable: false,
      statusCode: 404,
      errorCode: 'USER_NOT_FOUND',
      message: sanitizedMessage,
    };
  }

  if (
    err instanceof InvalidDateRangeError ||
    err instanceof InvalidDateError ||
    err instanceof InvalidContributionDataError
  ) {
    return {
      category: 'INVALID_REQUEST',
      retryable: false,
      statusCode: 400,
      errorCode:
        err instanceof InvalidContributionDataError
          ? 'INVALID_CONTRIBUTION_DATA'
          : 'INVALID_DATE_REQUEST',
      message: sanitizedMessage,
    };
  }

  // 9. Database Errors
  if (
    errorObj.name === 'DatabaseError' ||
    sanitizedMessage.includes('violates unique constraint') ||
    sanitizedMessage.includes('violates foreign key constraint') ||
    sanitizedMessage.includes('database system is ready')
  ) {
    return {
      category: 'DATABASE_ERROR',
      retryable: false,
      statusCode: 500,
      errorCode: 'DATABASE_TRANSACTION_ERROR',
      message: sanitizedMessage,
    };
  }

  // 10. Default / Unknown
  return {
    category: 'UNKNOWN_ERROR',
    retryable: false,
    statusCode: 500,
    errorCode: 'INTERNAL_ERROR',
    message: sanitizedMessage,
  };
}
