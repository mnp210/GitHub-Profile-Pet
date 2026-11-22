// src/app/api/internal/sync/route.ts
// Sprint 2.5D: Internal Background Sync Trigger Endpoint
// Secure, constant-time authenticated endpoint to trigger the Background Contribution Sync Coordinator.

import crypto from 'node:crypto';
import {
  executeBackgroundContributionSync,
  type BackgroundBatchRunResult,
  type BatchAccountingMetrics,
} from '../../../../lib/sync/backgroundSyncCoordinator.ts';
import { validateAndCanonicalizeUtcDate } from '../../../../lib/github/dailyReconciliation.ts';

// Hook for test injection in development and test environments only
type CoordinatorFn = typeof executeBackgroundContributionSync;
let coordinatorOverride: CoordinatorFn | null = null;

export function setCoordinatorForTesting(fn: CoordinatorFn | null): void {
  if (process.env.NODE_ENV !== 'production') {
    coordinatorOverride = fn;
  }
}

/**
 * Constant-time comparison using fixed-length SHA-256 digests.
 * Prevents timing attacks and byte-length disclosure.
 */
function safeCompareSecret(provided: string, expected: string): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const hashProvided = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const hashExpected = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(hashProvided, hashExpected);
}

/**
 * Extracts the bearer token from the Authorization header.
 * Expected format: "Bearer <token>" (case-insensitive scheme).
 */
function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const match = authHeader.trim().match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1] || match[1].trim().length === 0) {
    return null;
  }
  return match[1].trim();
}

/**
 * Sanitizes batch metrics to ensure zero sensitive fields or identifiers are returned.
 */
function sanitizeMetrics(metrics: BatchAccountingMetrics): BatchAccountingMetrics {
  return {
    accountsDiscovered: metrics.accountsDiscovered,
    leaseAcquisitionAttempts: metrics.leaseAcquisitionAttempts,
    accountsAttempted: metrics.accountsAttempted,
    successfulSyncs: metrics.successfulSyncs,
    noChangeSyncs: metrics.noChangeSyncs,
    failedSyncs: metrics.failedSyncs,
    commitOutcomeUnknown: metrics.commitOutcomeUnknown,
    skippedContended: metrics.skippedContended,
    leaseAcquisitionErrors: metrics.leaseAcquisitionErrors,
    deferredLimit: metrics.deferredLimit,
    rateLimitedAccounts: metrics.rateLimitedAccounts,
    reauthRequiredAccounts: metrics.reauthRequiredAccounts,
    timedOutAccounts: metrics.timedOutAccounts,
    fencedStaleAccounts: metrics.fencedStaleAccounts,
    pendingRewardsProcessed: metrics.pendingRewardsProcessed,
    expiredSlicesProcessed: metrics.expiredSlicesProcessed,
    totalXpAwarded: metrics.totalXpAwarded,
  };
}

/**
 * POST /api/internal/sync
 * Authenticated entrypoint for background contribution sync orchestration.
 */
export async function POST(request: Request): Promise<Response> {
  // 1. Verify server-side secret configuration
  const configuredSecret = process.env.SYNC_CRON_SECRET;
  if (!configuredSecret || configuredSecret.trim().length === 0) {
    return Response.json(
      {
        error: 'Background sync secret is not configured on server',
        code: 'SYNC_SECRET_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  // 2. Validate Authorization header
  const authHeader = request.headers.get('authorization');
  const providedToken = extractBearerToken(authHeader);

  if (!providedToken) {
    return Response.json(
      {
        error: 'Unauthorized: missing or malformed Authorization header. Expected "Authorization: Bearer <token>"',
        code: 'UNAUTHORIZED',
      },
      { status: 401 }
    );
  }

  // 3. Constant-time secret verification
  if (!safeCompareSecret(providedToken, configuredSecret.trim())) {
    return Response.json(
      {
        error: 'Unauthorized: invalid authorization credentials',
        code: 'UNAUTHORIZED',
      },
      { status: 401 }
    );
  }

  // 4. Parse and validate optional request body (metadata only; cannot override coordinator safety limits)
  let targetDate: string | undefined;

  const contentType = request.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      const rawBody = await request.text();
      if (rawBody.trim().length > 0) {
        const body = JSON.parse(rawBody);

        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          return Response.json(
            { error: 'Invalid JSON payload: expected a JSON object', code: 'BAD_REQUEST' },
            { status: 400 }
          );
        }

        // Strict whitelist: only targetDate is permitted
        const allowedKeys = new Set(['targetDate']);
        for (const key of Object.keys(body)) {
          if (!allowedKeys.has(key)) {
            return Response.json(
              {
                error: `Unauthorized parameter: "${key}" is not permitted`,
                code: 'FORBIDDEN_PARAMETER',
              },
              { status: 400 }
            );
          }
        }

        if (body.targetDate !== undefined) {
          if (typeof body.targetDate !== 'string') {
            return Response.json(
              {
                error: 'Invalid targetDate: expected UTC date string (YYYY-MM-DD)',
                code: 'INVALID_TARGET_DATE',
              },
              { status: 400 }
            );
          }
          try {
            targetDate = validateAndCanonicalizeUtcDate(body.targetDate);

            // Strict future date rejection guard
            const todayUtc = new Date().toISOString().slice(0, 10);
            if (targetDate > todayUtc) {
              return Response.json(
                {
                  error: `Invalid targetDate: "${targetDate}" is in the future. Target date must not exceed current UTC date (${todayUtc}).`,
                  code: 'INVALID_TARGET_DATE',
                },
                { status: 400 }
              );
            }
          } catch (dateErr) {
            return Response.json(
              {
                error: `Invalid targetDate: ${(dateErr as Error).message}`,
                code: 'INVALID_TARGET_DATE',
              },
              { status: 400 }
            );
          }
        }
      }
    } catch {
      return Response.json(
        { error: 'Malformed JSON payload in request body', code: 'MALFORMED_JSON' },
        { status: 400 }
      );
    }
  }

  // 5. Invoke Background Contribution Sync Coordinator
  try {
    const coordinator = coordinatorOverride || executeBackgroundContributionSync;
    const result: BackgroundBatchRunResult = await coordinator({
      targetDate,
    });

    const sanitizedMetrics = sanitizeMetrics(result.metrics);

    // 6. Map coordinator batch outcomes to appropriate HTTP responses
    if (result.status === 'completed') {
      return Response.json(
        {
          success: true,
          status: 'completed',
          batchId: result.batchId,
          batchGeneration: result.batchGeneration,
          metrics: sanitizedMetrics,
          durationMs: result.durationMs,
        },
        { status: 200 }
      );
    }

    if (result.status === 'partially_completed') {
      return Response.json(
        {
          success: true,
          status: 'partially_completed',
          batchId: result.batchId,
          batchGeneration: result.batchGeneration,
          metrics: sanitizedMetrics,
          durationMs: result.durationMs,
        },
        { status: 200 }
      );
    }

    if (result.status === 'deferred_contention') {
      return Response.json(
        {
          success: false,
          status: 'deferred_contention',
          batchId: result.batchId,
          batchGeneration: result.batchGeneration,
          error: 'Advisory lock contention: background sync batch deferred',
          code: 'DEFERRED_CONTENTION',
          metrics: sanitizedMetrics,
          durationMs: result.durationMs,
        },
        { status: 409 }
      );
    }

    // Status is 'failed' or 'interrupted'
    return Response.json(
      {
        success: false,
        status: result.status,
        batchId: result.batchId,
        batchGeneration: result.batchGeneration,
        error: 'Background sync batch failed to complete',
        code: 'BATCH_EXECUTION_FAILED',
        metrics: sanitizedMetrics,
        durationMs: result.durationMs,
      },
      { status: 500 }
    );
  } catch {
    // Never expose stack trace, tokens, or credentials in response or log
    console.error('[Internal Sync Trigger Error]: Background sync execution failed unexpectedly');

    return Response.json(
      {
        success: false,
        status: 'failed',
        error: 'Internal background sync coordinator failure',
        code: 'INTERNAL_COORDINATOR_ERROR',
      },
      { status: 500 }
    );
  }
}

// Reject unsupported HTTP methods with 405 Method Not Allowed and Allow: POST header
const methodNotAllowedResponse = () =>
  Response.json(
    { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
    { status: 405, headers: { Allow: 'POST' } }
  );

export async function GET(): Promise<Response> {
  return methodNotAllowedResponse();
}

export async function PUT(): Promise<Response> {
  return methodNotAllowedResponse();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowedResponse();
}

export async function PATCH(): Promise<Response> {
  return methodNotAllowedResponse();
}
