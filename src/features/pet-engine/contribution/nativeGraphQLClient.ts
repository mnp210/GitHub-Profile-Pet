// src/features/pet-engine/contribution/nativeGraphQLClient.ts
// Pure zero-dependency GitHub GraphQL client & bounded retry implementation for GitHub-native pet engine

import type { RateLimitHeaders } from './types.ts';

export class GitHubGraphQLError extends Error {
  public readonly errors: Array<{ message: string; type?: string; path?: unknown }>;

  constructor(errors: Array<{ message: string; type?: string; path?: unknown }>) {
    const summary = errors.map((e) => e.message).join('; ');
    super(`GitHub GraphQL execution error: ${summary}`);
    this.name = 'GitHubGraphQLError';
    this.errors = errors;
  }
}

export class GitHubUnauthorizedError extends Error {
  constructor(message = 'GitHub token is invalid, expired, or revoked (HTTP 401).') {
    super(message);
    this.name = 'GitHubUnauthorizedError';
  }
}

export class GitHubForbiddenError extends Error {
  constructor(message = 'GitHub API access forbidden (HTTP 403).') {
    super(message);
    this.name = 'GitHubForbiddenError';
  }
}

export class GitHubRateLimitError extends Error {
  public readonly resetAt: Date | null;
  public readonly retryAfterSeconds: number | null;
  public readonly kind: 'primary' | 'secondary';

  constructor(
    message = 'GitHub API rate limit exceeded.',
    resetAt: Date | null = null,
    retryAfterSeconds: number | null = null,
    kind: 'primary' | 'secondary' = 'primary'
  ) {
    super(message);
    this.name = 'GitHubRateLimitError';
    this.resetAt = resetAt;
    this.retryAfterSeconds = retryAfterSeconds;
    this.kind = kind;
  }
}

export class GitHubServerError extends Error {
  public readonly status: number;

  constructor(status: number, message = 'GitHub upstream server returned an error.') {
    super(`${message} (HTTP ${status})`);
    this.name = 'GitHubServerError';
    this.status = status;
  }
}

export class GitHubTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`GitHub GraphQL request timed out after ${timeoutMs}ms.`);
    this.name = 'GitHubTimeoutError';
  }
}

export class GitHubNetworkError extends Error {
  constructor(message = 'Network error communicating with GitHub GraphQL API.') {
    super(message);
    this.name = 'GitHubNetworkError';
  }
}

/**
 * Sanitizes any string to ensure access tokens (such as ghu_*, gho_*, ghp_*) never leak in logs or errors.
 */
export function redactSensitiveData(input: string, tokenToRedact?: string): string {
  let cleaned = input;
  if (tokenToRedact && tokenToRedact.length > 5) {
    cleaned = cleaned.replaceAll(tokenToRedact, '[REDACTED_TOKEN]');
  }
  return cleaned
    .replace(/gh[pousr]_[A-Za-z0-9_]{16,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_BEARER]');
}

export interface RetryPolicyConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  maxTotalDurationMs: number;
  maxRetryAfterBudgetSeconds: number;
}

export const DEFAULT_RETRY_CONFIG: RetryPolicyConfig = {
  maxAttempts: 3,                 // 1 initial + up to 2 retries
  initialDelayMs: 200,            // Start with 200ms base
  maxDelayMs: 2000,               // Cap delay at 2s
  backoffFactor: 2,               // 2x exponential growth
  maxTotalDurationMs: 10_000,     // Total duration budget: 10s (includes initial request)
  maxRetryAfterBudgetSeconds: 2,  // Maximum allowable Retry-After to sleep during request
};

const MIN_ATTEMPT_BUDGET_MS = 50;

/**
 * Calculates exponential backoff with full jitter to prevent synchronized retry storms.
 * Delay is uniformly distributed in [0, min(maxDelay, initialDelay * backoffFactor^(attempt - 1))].
 */
export function calculateBackoffWithJitter(
  attempt: number,
  config: RetryPolicyConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponential = config.initialDelayMs * Math.pow(config.backoffFactor, attempt - 1);
  const capped = Math.min(config.maxDelayMs, exponential);
  return Math.floor(Math.random() * (capped + 1));
}

export type RetryOperation<T> = (attempt: number, remainingBudgetMs: number) => Promise<T>;

export interface ExecuteWithRetryOptions {
  config?: Partial<RetryPolicyConfig>;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  tokenToRedact?: string;
  onRetry?: (info: {
    attempt: number;
    error: Error;
    delayMs: number;
    totalElapsedMs: number;
    remainingBudgetMs: number;
  }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ErrorClassification {
  retryable: boolean;
  category: 'AUTHENTICATION' | 'PERMISSION' | 'RATE_LIMIT' | 'UPSTREAM_5XX' | 'TIMEOUT' | 'NETWORK' | 'GRAPHQL' | 'UNKNOWN';
  rateLimit?: {
    kind: 'primary' | 'secondary';
    resetAt: Date | null;
    retryAfterSeconds: number | null;
  };
}

/**
 * Self-contained error classifier that inspects HTTP/network errors without legacy dependencies.
 */
export function classifyNativeGitHubError(err: unknown): ErrorClassification {
  if (err instanceof GitHubUnauthorizedError) {
    return { retryable: false, category: 'AUTHENTICATION' };
  }

  if (err instanceof GitHubForbiddenError) {
    return { retryable: false, category: 'PERMISSION' };
  }

  if (err instanceof GitHubRateLimitError) {
    const isSecondaryWithBudget =
      err.kind === 'secondary' ||
      (err.retryAfterSeconds !== null && err.retryAfterSeconds !== undefined);

    return {
      retryable: isSecondaryWithBudget,
      category: 'RATE_LIMIT',
      rateLimit: {
        kind: err.kind,
        resetAt: err.resetAt,
        retryAfterSeconds: err.retryAfterSeconds,
      },
    };
  }

  if (err instanceof GitHubServerError) {
    // 5xx upstream errors are transient and retryable
    return { retryable: true, category: 'UPSTREAM_5XX' };
  }

  if (err instanceof GitHubTimeoutError) {
    return { retryable: true, category: 'TIMEOUT' };
  }

  if (err instanceof GitHubNetworkError) {
    return { retryable: true, category: 'NETWORK' };
  }

  if (err instanceof GitHubGraphQLError) {
    const isRateLimited = err.errors.some(
      (e) => e.type === 'RATE_LIMITED' || e.message.toLowerCase().includes('rate limit')
    );
    if (isRateLimited) {
      return {
        retryable: false, // Primary GraphQL rate limits cannot be resolved within seconds
        category: 'RATE_LIMIT',
      };
    }
    return { retryable: false, category: 'GRAPHQL' };
  }

  return { retryable: false, category: 'UNKNOWN' };
}

/**
 * Executes an asynchronous operation bounded by a strict overall duration deadline and retry policy.
 */
export async function executeWithRetry<T>(
  operation: RetryOperation<T>,
  options?: ExecuteWithRetryOptions
): Promise<T> {
  const config: RetryPolicyConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...options?.config,
  };
  const sleep = options?.sleepFn ?? defaultSleep;
  const getNow = options?.nowFn ?? Date.now;

  const startTime = getNow();
  const absoluteDeadline = startTime + config.maxTotalDurationMs;

  let attempt = 1;
  let lastError: unknown = null;

  while (attempt <= config.maxAttempts) {
    const currentNow = getNow();
    const remainingForAttempt = absoluteDeadline - currentNow;

    if (remainingForAttempt < MIN_ATTEMPT_BUDGET_MS) {
      if (lastError) {
        throw lastError;
      }
      throw new GitHubTimeoutError(config.maxTotalDurationMs);
    }

    try {
      return await operation(attempt, remainingForAttempt);
    } catch (err: unknown) {
      lastError = err;
      const classified = classifyNativeGitHubError(err);
      const nowAfterError = getNow();
      const remainingAfterError = absoluteDeadline - nowAfterError;

      // 1. Never retry non-retryable errors (authentication, permission, GraphQL validation, user not found)
      if (!classified.retryable) {
        throw err;
      }

      // 2. If max attempts reached, fail immediately
      if (attempt >= config.maxAttempts) {
        throw err;
      }

      // 3. Determine backoff delay
      let delayMs: number;
      if (
        classified.rateLimit &&
        classified.rateLimit.retryAfterSeconds !== null &&
        classified.rateLimit.retryAfterSeconds !== undefined
      ) {
        const retryAfterSec = classified.rateLimit.retryAfterSeconds;
        if (retryAfterSec > config.maxRetryAfterBudgetSeconds) {
          throw err;
        }
        delayMs = retryAfterSec * 1000;
      } else {
        delayMs = calculateBackoffWithJitter(attempt, config);
      }

      // 4. Do not sleep past the deadline
      if (delayMs >= remainingAfterError) {
        throw err;
      }

      // 5. Ensure that after sleeping, sufficient budget remains for the next attempt
      if (remainingAfterError - delayMs < MIN_ATTEMPT_BUDGET_MS) {
        throw err;
      }

      // 6. Notify onRetry hook
      if (options?.onRetry && err instanceof Error) {
        try {
          options.onRetry({
            attempt,
            error: err,
            delayMs,
            totalElapsedMs: nowAfterError - startTime,
            remainingBudgetMs: remainingAfterError,
          });
        } catch {
          // ignore notification errors
        }
      }

      // 7. Sleep and advance attempt
      await sleep(delayMs);
      attempt++;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new GitHubTimeoutError(config.maxTotalDurationMs);
}

export interface GraphQLRequestOptions {
  timeoutMs?: number;
  retryPolicy?: Partial<RetryPolicyConfig>;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  correlationId?: string;
  onResponseHeaders?: (headers: RateLimitHeaders) => void;
}

export interface GitHubGraphQLClient {
  execute<T>(
    query: string,
    variables: Record<string, unknown>,
    accessToken: string,
    options?: GraphQLRequestOptions
  ): Promise<T>;
}

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchFunction = typeof fetch;
let activeFetch: FetchFunction = fetch;

export function setFetchImplementation(fn: FetchFunction): void {
  activeFetch = fn;
}

export function resetFetchImplementation(): void {
  activeFetch = fetch;
}

export function getFetchImplementation(): FetchFunction {
  return activeFetch;
}

export class NativeGitHubGraphQLClient implements GitHubGraphQLClient {
  private defaultOptions?: GraphQLRequestOptions;

  public setDefaultOptions(opts?: GraphQLRequestOptions): void {
    this.defaultOptions = opts;
  }

  public async execute<T>(
    query: string,
    variables: Record<string, unknown>,
    accessToken: string,
    options?: GraphQLRequestOptions
  ): Promise<T> {
    const mergedOptions: GraphQLRequestOptions = {
      ...this.defaultOptions,
      ...options,
      retryPolicy: {
        ...this.defaultOptions?.retryPolicy,
        ...options?.retryPolicy,
      },
    };

    const requestedTimeoutMs = mergedOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return executeWithRetry<T>(
      async (_attempt: number, remainingBudgetMs: number) => {
        const effectiveTimeoutMs = Math.max(1, Math.min(requestedTimeoutMs, remainingBudgetMs));
        return this.executeSingleAttempt<T>(query, variables, accessToken, {
          ...mergedOptions,
          timeoutMs: effectiveTimeoutMs,
        });
      },
      {
        config: mergedOptions.retryPolicy,
        sleepFn: mergedOptions.sleepFn,
        nowFn: mergedOptions.nowFn,
        tokenToRedact: accessToken,
      }
    );
  }

  private async executeSingleAttempt<T>(
    query: string,
    variables: Record<string, unknown>,
    accessToken: string,
    options?: GraphQLRequestOptions
  ): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let response: Response;
    try {
      response = await activeFetch(GITHUB_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'GitHub-Profile-Pet',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: unknown) {
      const errorObj = err as Error;
      if (errorObj.name === 'TimeoutError' || errorObj.name === 'AbortError') {
        throw new GitHubTimeoutError(timeoutMs);
      }
      throw new GitHubNetworkError(redactSensitiveData(errorObj.message, accessToken));
    }

    const limitHeader = response.headers.get('x-ratelimit-limit');
    const remainingHeader = response.headers.get('x-ratelimit-remaining');
    const usedHeader = response.headers.get('x-ratelimit-used');
    const resetHeader = response.headers.get('x-ratelimit-reset');
    const resourceHeader = response.headers.get('x-ratelimit-resource');
    const retryAfterHeader = response.headers.get('retry-after');

    const parsedLimit = limitHeader !== null ? parseInt(limitHeader, 10) : null;
    const parsedRemaining = remainingHeader !== null ? parseInt(remainingHeader, 10) : null;
    const parsedUsed = usedHeader !== null ? parseInt(usedHeader, 10) : null;
    const parsedReset = resetHeader !== null ? parseInt(resetHeader, 10) : null;

    const rateLimitHeaders: RateLimitHeaders = {
      limit: Number.isInteger(parsedLimit) ? parsedLimit : null,
      remaining: Number.isInteger(parsedRemaining) ? parsedRemaining : null,
      used: Number.isInteger(parsedUsed) ? parsedUsed : null,
      reset: Number.isInteger(parsedReset) ? parsedReset : null,
      resource: resourceHeader,
    };

    if (options?.onResponseHeaders) {
      try {
        options.onResponseHeaders(rateLimitHeaders);
      } catch {
        // Callback errors must not interrupt GraphQL execution
      }
    }

    const resetAt = parsedReset !== null ? new Date(parsedReset * 1000) : null;
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;

    if (response.status === 401) {
      throw new GitHubUnauthorizedError();
    }

    if (response.status === 429 || (response.status === 403 && remainingHeader === '0')) {
      const text = await response.text().catch(() => '');
      const isSecondary =
        text.toLowerCase().includes('secondary rate limit') ||
        text.toLowerCase().includes('abuse detection') ||
        retryAfterSeconds !== null;

      if (isSecondary) {
        throw new GitHubRateLimitError(
          'GitHub API secondary rate limit triggered.',
          resetAt,
          retryAfterSeconds,
          'secondary'
        );
      }
      throw new GitHubRateLimitError(
        'GitHub API primary rate limit exceeded.',
        resetAt,
        retryAfterSeconds,
        'primary'
      );
    }

    if (response.status === 403) {
      const text = await response.text().catch(() => '');
      const isSecondary =
        text.toLowerCase().includes('secondary rate limit') ||
        text.toLowerCase().includes('abuse detection') ||
        retryAfterSeconds !== null;

      if (isSecondary) {
        throw new GitHubRateLimitError(
          'GitHub API secondary rate limit triggered.',
          resetAt,
          retryAfterSeconds,
          'secondary'
        );
      }
      throw new GitHubForbiddenError(
        `GitHub GraphQL access forbidden (HTTP 403): ${redactSensitiveData(text, accessToken)}`
      );
    }

    if (response.status >= 500) {
      const text = await response.text().catch(() => '');
      const msg = text
        ? `GitHub upstream server returned an error: ${redactSensitiveData(text, accessToken)}`
        : 'GitHub upstream server returned an error.';
      throw new GitHubServerError(response.status, msg);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new GitHubServerError(
        response.status,
        `GitHub API returned unexpected HTTP status ${response.status}: ${redactSensitiveData(text, accessToken)}`
      );
    }

    let payload: { data?: T; errors?: Array<{ message: string; type?: string; path?: unknown }> };
    try {
      payload = await response.json();
    } catch {
      throw new GitHubServerError(response.status, 'Invalid JSON returned from GitHub GraphQL API.');
    }

    // Reject partial data when errors are present
    if (payload.errors && payload.errors.length > 0) {
      const isRateLimit = payload.errors.some(
        (e) => e.type === 'RATE_LIMITED' || e.message.toLowerCase().includes('rate limit')
      );
      if (isRateLimit) {
        throw new GitHubRateLimitError(
          'GitHub GraphQL rate limit exceeded in payload errors.',
          resetAt,
          retryAfterSeconds,
          'primary'
        );
      }

      const sanitizedErrors = payload.errors.map((e) => ({
        ...e,
        message: redactSensitiveData(e.message, accessToken),
      }));
      throw new GitHubGraphQLError(sanitizedErrors);
    }

    if (!payload.data) {
      throw new GitHubGraphQLError([{ message: 'GraphQL response contained neither data nor errors.' }]);
    }

    return payload.data;
  }
}

let activeNativeClient: GitHubGraphQLClient = new NativeGitHubGraphQLClient();

export function setNativeGraphQLClient(client: GitHubGraphQLClient): void {
  activeNativeClient = client;
}

export function resetNativeGraphQLClient(): void {
  activeNativeClient = new NativeGitHubGraphQLClient();
  resetFetchImplementation();
}

export function getNativeGraphQLClient(): GitHubGraphQLClient {
  return activeNativeClient;
}
