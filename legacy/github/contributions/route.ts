// src/app/api/github/contributions/route.ts
// Authenticated GitHub public contribution snapshots and server-authoritative daily reconciliation

import crypto from 'node:crypto';
import { resolveServerUser } from '../../../../lib/auth/sessionContext.ts';
import { fetchContributionSnapshot } from '../../../../lib/github/contributionSnapshot.ts';
import { reconcileDailyContributionForUser } from '../../../../lib/github/dailyReconciliation.ts';
import { classifyGitHubError } from '../../../../lib/github/failureClassification.ts';
import { syncLogger } from '../../../../lib/github/syncLogger.ts';

function formatApiErrorResponse(err: unknown, correlationId: string): Response {
  const classified = classifyGitHubError(err);
  const status = classified.statusCode ?? 500;

  const headers: Record<string, string> = {
    'x-correlation-id': correlationId,
  };

  if (classified.rateLimit?.retryAfterSeconds) {
    headers['Retry-After'] = String(classified.rateLimit.retryAfterSeconds);
  }

  syncLogger.error('Contribution API request failed', {
    correlationId,
    apiStatus: status,
    apiErrorCode: classified.errorCode,
    failureCategory: classified.category,
    rateLimit: classified.rateLimit
      ? {
          kind: classified.rateLimit.kind,
          resetAt: classified.rateLimit.resetAt?.toISOString(),
          retryAfterSeconds: classified.rateLimit.retryAfterSeconds,
        }
      : undefined,
  });

  const body: Record<string, unknown> = {
    success: false,
    error: classified.message,
    code: classified.errorCode,
    category: classified.category,
    retryable: classified.retryable,
  };

  if (classified.category === 'AUTHENTICATION_ERROR') {
    body.reauthorizationRequired = true;
  }

  if (classified.rateLimit) {
    body.rateLimit = {
      kind: classified.rateLimit.kind,
      resetAt: classified.rateLimit.resetAt ? classified.rateLimit.resetAt.toISOString() : null,
      retryAfterSeconds: classified.rateLimit.retryAfterSeconds,
    };
    body.resetAt = classified.rateLimit.resetAt ? classified.rateLimit.resetAt.toISOString() : null;
  }

  return Response.json(body, { status, headers });
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const userContext = await resolveServerUser(request);

  if (!userContext) {
    return Response.json(
      {
        success: false,
        error: 'Authentication required. Active session cookie missing or expired.',
        code: 'UNAUTHORIZED',
        category: 'AUTHENTICATION_ERROR',
        retryable: false,
        reauthorizationRequired: true,
      },
      {
        status: 401,
        headers: { 'x-correlation-id': correlationId },
      }
    );
  }

  const url = new URL(request.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  try {
    const snapshot = await fetchContributionSnapshot({
      userId: userContext.userId,
      from: fromParam,
      to: toParam,
      requestOptions: { correlationId },
    });

    return Response.json(
      {
        success: true,
        snapshot,
      },
      {
        status: 200,
        headers: { 'x-correlation-id': correlationId },
      }
    );
  } catch (err: unknown) {
    return formatApiErrorResponse(err, correlationId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const userContext = await resolveServerUser(request);

  if (!userContext) {
    return Response.json(
      {
        success: false,
        error: 'Authentication required. Active session cookie missing or expired.',
        code: 'UNAUTHORIZED',
        category: 'AUTHENTICATION_ERROR',
        retryable: false,
        reauthorizationRequired: true,
      },
      {
        status: 401,
        headers: { 'x-correlation-id': correlationId },
      }
    );
  }

  let targetDate: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body.date === 'string') {
      targetDate = body.date;
    }
  } catch {
    // defaults to current UTC date
  }

  try {
    const syncResult = await reconcileDailyContributionForUser(userContext.userId, targetDate, {
      correlationId,
    });

    return Response.json(
      {
        success: true,
        reconciliation: {
          userId: syncResult.userId,
          utcDate: syncResult.utcDate,
          latestObservedContributions: syncResult.latestObservedContributions,
          currentHighWaterMark: syncResult.currentHighWaterMark,
          previousHighWaterMark: syncResult.previousHighWaterMark,
          newlyObservedIncrements: syncResult.newlyObservedIncrements,
          rewardEligibleIncrements: syncResult.rewardEligibleIncrements,
          isStale: syncResult.isStale,
          reconciledAt: syncResult.reconciledAt,
        },
        reward: syncResult.reward,
      },
      {
        status: 200,
        headers: { 'x-correlation-id': correlationId },
      }
    );
  } catch (err: unknown) {
    return formatApiErrorResponse(err, correlationId);
  }
}
