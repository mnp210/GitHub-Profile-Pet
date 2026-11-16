// src/lib/github/retryPolicy.ts
// Bounded exponential backoff with full jitter and single absolute retry deadline enforcement

import { classifyGitHubError, type ClassifiedGitHubError } from './failureClassification.ts';
import { GitHubTimeoutError } from './graphqlClient.ts';

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

export interface ExecuteWithRetryOptions {
  config?: Partial<RetryPolicyConfig>;
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (info: {
    attempt: number;
    error: ClassifiedGitHubError;
    delayMs: number;
    totalElapsedMs: number;
    remainingBudgetMs: number;
  }) => void;
  tokenToRedact?: string;
  nowFn?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type RetryOperation<T> = (attempt: number, remainingBudgetMs: number) => Promise<T>;

/**
 * Minimum remaining time in milliseconds required to start a new request attempt.
 * If less than this budget remains, starting another attempt will inevitably breach the deadline.
 */
const MIN_ATTEMPT_BUDGET_MS = 10;

/**
 * Executes an operation with bounded retries according to the configured retry policy.
 *
 * Sprint 2.4D.1 Deadlines & Budget Invariants:
 * 1. Single Absolute Deadline: deadline = startTime + config.maxTotalDurationMs.
 * 2. Total duration encompasses initial request, backoff sleeps, and retry attempts.
 * 3. Never starts an attempt when insufficient budget remains (< 10ms or <= 0ms).
 * 4. Bounds each request timeout by the remaining total budget.
 * 5. Does not sleep past the deadline.
 * 6. Maximum of 3 attempts strictly preserved.
 * 7. Never holds database transactions or row locks.
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

    // Never start an attempt when insufficient budget remains
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
      const classified = classifyGitHubError(err, options?.tokenToRedact);
      const nowAfterError = getNow();
      const remainingAfterError = absoluteDeadline - nowAfterError;

      // 1. Never retry non-retryable errors (authentication, permission, validation)
      if (!classified.retryable) {
        throw err;
      }

      // 2. If maximum attempt budget reached, fail immediately
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
          // Exceeds our maximum Retry-After policy budget: fail fast
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

      // 6. Invoke retry notification hook (e.g. for structured logging)
      if (options?.onRetry) {
        try {
          options.onRetry({
            attempt,
            error: classified,
            delayMs,
            totalElapsedMs: nowAfterError - startTime,
            remainingBudgetMs: remainingAfterError,
          });
        } catch {
          // Logging failure must never prevent retry
        }
      }

      // 7. Sleep before next attempt
      await sleep(delayMs);
      attempt++;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new GitHubTimeoutError(config.maxTotalDurationMs);
}
