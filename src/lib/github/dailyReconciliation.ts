// src/lib/github/dailyReconciliation.ts
// Sprint 2.4B: Persistent Daily GitHub Contribution Reconciliation & High-Water Mark Engine

import { fetchContributionSnapshot, UserNotFoundError } from './contributionSnapshot.ts';
import type { GraphQLRequestOptions } from './graphqlClient.ts';
import { syncLogger } from './syncLogger.ts';
import {
  SyncRepository,
  type DailyContributionSyncResult,
  type ProcessContributionSyncOptions,
} from '../db/repositories/syncRepository.ts';
import { UserRepository } from '../db/repositories/userRepository.ts';

export class InvalidDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDateError';
  }
}

export interface ReconcileOptions extends ProcessContributionSyncOptions {
  reconcileOnly?: boolean;
  correlationId?: string;
  requestOptions?: GraphQLRequestOptions;
}

/**
 * Converts a Date object into a canonical UTC calendar date string: YYYY-MM-DD.
 */
export function toUtcDateString(date: Date): string {
  if (isNaN(date.getTime())) {
    throw new InvalidDateError('Provided Date is Invalid Date.');
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Validates, checks calendar validity, and canonicalizes any date input into a strict UTC YYYY-MM-DD string.
 * Rejects malformed dates, non-existent calendar days (e.g., February 31, non-leap year Feb 29),
 * and dates outside the supported range (2008 to present + 1 year).
 */
export function validateAndCanonicalizeUtcDate(input?: string | Date | null): string {
  if (!input) {
    return toUtcDateString(new Date());
  }

  if (input instanceof Date) {
    return toUtcDateString(input);
  }

  if (typeof input !== 'string') {
    throw new InvalidDateError('Date must be a string or Date object.');
  }

  const trimmed = input.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (!match) {
    // If given an ISO-8601 timestamp string like 2026-11-15T23:59:59.999Z
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw new InvalidDateError(`Invalid date format "${input}". Expected YYYY-MM-DD format.`);
    }
    return toUtcDateString(parsed);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) {
    throw new InvalidDateError(`Invalid month "${match[2]}" in date "${input}". Must be 01 to 12.`);
  }

  // Construct UTC date to verify strict calendar existence (e.g. leap day, days in month)
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new InvalidDateError(`Calendar date "${input}" does not exist.`);
  }

  const currentYear = new Date().getUTCFullYear();
  if (year < 2008 || year > currentYear + 1) {
    throw new InvalidDateError(
      `Date "${input}" is outside supported range (2008 to ${currentYear + 1}).`
    );
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Returns UTC day boundaries (00:00:00.000Z to 23:59:59.999Z) for a canonical UTC date string.
 */
export function getUtcDayBoundaries(utcDateStr: string): { from: string; to: string } {
  const canonical = validateAndCanonicalizeUtcDate(utcDateStr);
  return {
    from: `${canonical}T00:00:00.000Z`,
    to: `${canonical}T23:59:59.999Z`,
  };
}

/**
 * Orchestrates daily contribution reconciliation and server-authoritative reward accounting for an authenticated user:
 * 1. Resolves user and verifies account existence.
 * 2. Canonicalizes accounting date to UTC YYYY-MM-DD.
 * 3. Atomically allocates monotonically increasing request sequence BEFORE dispatching external request.
 * 4. Fetches GitHub contribution snapshot (zero DB locks/connections held during HTTP request).
 * 5. Extracts publicTotal (strictly public contributions: commits + issues + PRs + reviews).
 * 6. Executes atomic database reconciliation and rate-limited reward accounting.
 */
export async function reconcileDailyContributionForUser(
  userId: string,
  targetDateInput?: string | Date | null,
  options?: ReconcileOptions
): Promise<DailyContributionSyncResult> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID.');
  }

  // 1. Verify user exists in database
  const userDetails = await UserRepository.findByUserId(userId);
  if (!userDetails) {
    throw new UserNotFoundError(`User with ID ${userId} not found.`);
  }

  // 2. Canonicalize target date to UTC
  const utcDate = validateAndCanonicalizeUtcDate(targetDateInput);
  const { from, to } = getUtcDayBoundaries(utcDate);

  // 3. Atomically allocate monotonically increasing request sequence BEFORE dispatching external request.
  // CRITICAL INVARIANT: Holds ZERO database locks or transactions open during the external network call!
  const requestSequence =
    options?.requestSequence !== null && options?.requestSequence !== undefined
      ? options.requestSequence
      : await SyncRepository.allocateSnapshotSequence(userId);

  // 4. Fetch GitHub contribution snapshot (OUTSIDE database transaction)
  // Guarantees zero database locks or connections held during external HTTP requests
  const snapshot = await fetchContributionSnapshot({
    userId,
    from,
    to,
    requestOptions: {
      correlationId: options?.correlationId,
      ...options?.requestOptions,
    },
  });

  // 5. Extract verified publicTotal and snapshot retrieval timestamp
  // Guarantee: publicTotal = commits + issues + PRs + reviews
  // Never uses contributions.total or contributionCalendar.totalContributions
  const observedPublicTotal = snapshot.contributions.publicTotal;
  const observedAt = snapshot.retrievedAt;

  // 6. If caller explicitly requests reconcileOnly, execute pure reconciliation
  if (options?.reconcileOnly) {
    const recon = await SyncRepository.reconcileDailyContributionState(
      userId,
      utcDate,
      observedPublicTotal,
      {
        observedAt,
        requestSequence,
        existingClient: options?.existingClient,
      }
    );
    syncLogger.info('Reconciliation completed (reconcileOnly)', {
      correlationId: options?.correlationId,
      userId,
      requestSequence,
      reconciliationOutcome: {
        highWaterMark: recon.currentHighWaterMark,
        newlyObserved: recon.newlyObservedIncrements,
        rewarded: 0,
        forfeited: 0,
        pending: recon.rewardEligibleIncrements,
        xpAwarded: 0,
      },
    });
    return {
      ...recon,
      reward: {
        processedIncrements: 0,
        rewardedIncrements: 0,
        forfeitedIncrements: 0,
        remainingPendingIncrements: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        dailyXpTotal: 0,
        capExhausted: false,
        hourlyQuotaRemaining: 5,
        canonicalSliceIds: [],
        petProgression: null,
      },
    };
  }

  // 7. Atomic database reconciliation and server-authoritative reward accounting
  let syncResult: DailyContributionSyncResult;
  try {
    syncResult = await SyncRepository.processContributionSync(
      userId,
      utcDate,
      observedPublicTotal,
      {
        observedAt,
        requestSequence,
        currentTime: options?.currentTime,
        bypassHourlyThrottle: options?.bypassHourlyThrottle,
        existingClient: options?.existingClient,
      }
    );
    syncLogger.info('Reconciliation and reward processing committed', {
      correlationId: options?.correlationId,
      userId,
      requestSequence,
      transactionStatus: 'committed',
      reconciliationOutcome: {
        highWaterMark: syncResult.currentHighWaterMark,
        newlyObserved: syncResult.newlyObservedIncrements,
        rewarded: syncResult.reward.rewardedIncrements,
        forfeited: syncResult.reward.forfeitedIncrements,
        pending: syncResult.reward.remainingPendingIncrements,
        xpAwarded: syncResult.reward.xpAwarded,
      },
    });
  } catch (dbErr) {
    syncLogger.error('Reconciliation transaction failed and rolled back', {
      correlationId: options?.correlationId,
      userId,
      requestSequence,
      transactionStatus: 'rolled_back',
      failureCategory: 'DATABASE_ERROR',
    });
    throw dbErr;
  }

  return syncResult;
}
