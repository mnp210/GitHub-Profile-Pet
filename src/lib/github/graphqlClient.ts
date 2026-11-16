// src/lib/github/graphqlClient.ts
// Native fetch-based GitHub GraphQL API client with token redaction, bounded retries with jitter, and typed error handling

import { executeWithRetry, type RetryPolicyConfig } from './retryPolicy.ts';
import { syncLogger } from './syncLogger.ts';

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

export interface GraphQLRequestOptions {
  timeoutMs?: number;
  retryPolicy?: Partial<RetryPolicyConfig>;
  sleepFn?: (ms: number) => Promise<void>;
  correlationId?: string;
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

export class ProductionGitHubGraphQLClient implements GitHubGraphQLClient {
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
        // Bound each request timeout by the remaining total retry budget
        const effectiveTimeoutMs = Math.max(1, Math.min(requestedTimeoutMs, remainingBudgetMs));
        return this.executeSingleAttempt<T>(query, variables, accessToken, {
          ...mergedOptions,
          timeoutMs: effectiveTimeoutMs,
        });
      },
      {
        config: mergedOptions.retryPolicy,
        sleepFn: mergedOptions.sleepFn,
        tokenToRedact: accessToken,
        onRetry: ({ attempt, error, delayMs, remainingBudgetMs }) => {
          syncLogger.warn('Retrying upstream GitHub GraphQL request after transient failure', {
            correlationId: mergedOptions.correlationId,
            attempt,
            failureCategory: error.category,
            statusCode: error.statusCode,
            delayMs,
            remainingBudgetMs,
          });
        },
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

    // Inspect rate-limiting response headers
    const remainingHeader = response.headers.get('x-ratelimit-remaining');
    const resetHeader = response.headers.get('x-ratelimit-reset');
    const retryAfterHeader = response.headers.get('retry-after');

    const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : null;
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;

    if (response.status === 401) {
      throw new GitHubUnauthorizedError();
    }

    // Rate Limiting Evaluation (Status 429 or Status 403 with Rate Limit Evidence)
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

    // GraphQL execution error checking even on HTTP 200
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

let activeGraphQLClient: GitHubGraphQLClient = new ProductionGitHubGraphQLClient();

export function setGitHubGraphQLClient(client: GitHubGraphQLClient): void {
  activeGraphQLClient = client;
}

export function resetGitHubGraphQLClient(): void {
  activeGraphQLClient = new ProductionGitHubGraphQLClient();
  resetFetchImplementation();
}

export function getGitHubGraphQLClient(): GitHubGraphQLClient {
  return activeGraphQLClient;
}
