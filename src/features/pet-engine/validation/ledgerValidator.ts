/**
 * GitHub Profile Pet - Ledger Validators & Invariant Checker
 * Strictly validates contributions.json, actions.json, and the accounting conservation invariant.
 */

import { ENGINE_SCHEMA_VERSION } from '../domain/constants.ts';
import type {
  ActionLedgerDocument,
  CareActionType,
  ContributionLedgerDocument,
  ContributionSlice,
  SliceStatus,
} from '../domain/types.ts';
import { isValidIsoDateString, type ValidationResult } from './stateValidator.ts';

const VALID_ACTIONS: Set<CareActionType> = new Set(['feed', 'train', 'rest', 'pet']);
const VALID_SLICE_STATUSES: Set<SliceStatus> = new Set(['rewarded', 'forfeited', 'pending', 'expired']);

export function validateContributionLedger(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['Contribution ledger must be a JSON object.'] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== ENGINE_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion in contributions ledger: expected ${ENGINE_SCHEMA_VERSION}.`);
  }

  if (typeof obj.generation !== 'number' || !Number.isInteger(obj.generation) || obj.generation < 1) {
    errors.push(`generation must be a positive integer.`);
  }

  if (
    typeof obj.monotonicPublicHwm !== 'number' ||
    !Number.isInteger(obj.monotonicPublicHwm) ||
    obj.monotonicPublicHwm < 0
  ) {
    errors.push(`monotonicPublicHwm must be a non-negative integer.`);
  }

  if (typeof obj.dailyAccruedXp !== 'object' || obj.dailyAccruedXp === null || Array.isArray(obj.dailyAccruedXp)) {
    errors.push(`dailyAccruedXp must be a record mapping date string to accrued XP.`);
  } else {
    for (const [date, xp] of Object.entries(obj.dailyAccruedXp as Record<string, unknown>)) {
      if (typeof xp !== 'number' || !Number.isInteger(xp) || xp < 0 || xp > 300) {
        errors.push(`dailyAccruedXp for ${date} must be an integer between 0 and 300, received: ${String(xp)}.`);
      }
    }
  }

  if (
    typeof obj.hourlySliceUsage !== 'object' ||
    obj.hourlySliceUsage === null ||
    Array.isArray(obj.hourlySliceUsage)
  ) {
    errors.push(`hourlySliceUsage must be a record mapping hour string to slice counts.`);
  }

  if (!Array.isArray(obj.slices)) {
    errors.push(`slices must be an array of ContributionSlice.`);
  } else {
    let activeObserved = 0;
    let activeRewarded = 0;
    let activeForfeited = 0;
    let activePending = 0;
    let activeExpired = 0;

    for (let i = 0; i < obj.slices.length; i++) {
      const slice = obj.slices[i] as ContributionSlice;
      if (typeof slice !== 'object' || slice === null) {
        errors.push(`Slice at index ${i} is not an object.`);
        continue;
      }

      if (typeof slice.sliceId !== 'string' || !slice.sliceId) {
        errors.push(`Slice at index ${i} has invalid sliceId.`);
      }

      if (typeof slice.syncDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(slice.syncDate)) {
        errors.push(`Slice at index ${i} has invalid syncDate (expected YYYY-MM-DD).`);
      }

      if (!isValidIsoDateString(slice.discoveredAt)) {
        errors.push(`Slice at index ${i} has invalid discoveredAt date.`);
      }

      if (typeof slice.units !== 'number' || !Number.isInteger(slice.units) || slice.units < 1) {
        errors.push(`Slice at index ${i} units must be an integer >= 1.`);
      } else {
        activeObserved += slice.units;
      }

      if (!VALID_SLICE_STATUSES.has(slice.status)) {
        errors.push(`Slice at index ${i} has invalid status: ${String(slice.status)}.`);
      } else {
        if (slice.status === 'rewarded') activeRewarded += slice.units;
        else if (slice.status === 'forfeited') activeForfeited += slice.units;
        else if (slice.status === 'pending') activePending += slice.units;
        else if (slice.status === 'expired') activeExpired += slice.units;
      }

      if (!isValidIsoDateString(slice.expiryAt)) {
        errors.push(`Slice at index ${i} has invalid expiryAt date.`);
      }

      if (!isValidIsoDateString(slice.evaluatedAt)) {
        errors.push(`Slice at index ${i} has invalid evaluatedAt date.`);
      }
    }

    // Verify Conservation Invariant across active slices
    const activeCategorized = activeRewarded + activeForfeited + activePending + activeExpired;
    if (activeObserved !== activeCategorized) {
      errors.push(
        `Active slice accounting invariant violated: observedUnits (${activeObserved}) !== sum of categorized units (${activeCategorized}).`
      );
    }
  }

  // Monthly summary validation
  if (!Array.isArray(obj.monthlyHistoricalSummary)) {
    errors.push(`monthlyHistoricalSummary must be an array.`);
  } else {
    for (let i = 0; i < obj.monthlyHistoricalSummary.length; i++) {
      const summary = obj.monthlyHistoricalSummary[i];
      if (typeof summary !== 'object' || summary === null) {
        errors.push(`Monthly summary at index ${i} is invalid.`);
        continue;
      }
      const s = summary as Record<string, unknown>;
      const total = Number(s.totalObservedUnits || 0);
      const rewarded = Number(s.rewardedUnits || 0);
      const forfeited = Number(s.forfeitedUnits || 0);
      const expired = Number(s.expiredUnits || 0);
      if (total !== rewarded + forfeited + expired) {
        errors.push(
          `Monthly summary at index ${i} invariant violated: totalObserved (${total}) !== rewarded (${rewarded}) + forfeited (${forfeited}) + expired (${expired}).`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateActionLedger(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['Action ledger must be a JSON object.'] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== ENGINE_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion in actions ledger: expected ${ENGINE_SCHEMA_VERSION}.`);
  }

  if (typeof obj.generation !== 'number' || !Number.isInteger(obj.generation) || obj.generation < 1) {
    errors.push(`generation must be a positive integer.`);
  }

  if (!Array.isArray(obj.recentActions)) {
    errors.push(`recentActions must be an array.`);
  } else {
    for (let i = 0; i < obj.recentActions.length; i++) {
      const entry = obj.recentActions[i];
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`recentActions[${i}] is not an object.`);
        continue;
      }
      const e = entry as Record<string, unknown>;
      if (!VALID_ACTIONS.has(e.action as CareActionType)) {
        errors.push(`recentActions[${i}].action is invalid: ${String(e.action)}.`);
      }
      if (typeof e.timestamp !== 'number' || e.timestamp < 0) {
        errors.push(`recentActions[${i}].timestamp must be a non-negative timestamp number.`);
      }
      if (typeof e.requestId !== 'string' || !e.requestId) {
        errors.push(`recentActions[${i}].requestId must be a non-empty string.`);
      }
    }
  }

  if (
    typeof obj.processedRequestRegistry !== 'object' ||
    obj.processedRequestRegistry === null ||
    Array.isArray(obj.processedRequestRegistry)
  ) {
    errors.push(`processedRequestRegistry must be an object.`);
  } else {
    const reg = obj.processedRequestRegistry as Record<string, unknown>;
    const hwm = reg.highWaterIssueNumber;
    if (typeof hwm !== 'number' || !Number.isInteger(hwm) || hwm < 0) {
      errors.push(`highWaterIssueNumber must be a non-negative integer.`);
    }

    if (!Array.isArray(reg.sparseProcessedIssueNumbers)) {
      errors.push(`sparseProcessedIssueNumbers must be an array.`);
    }

    if (!Array.isArray(reg.retiredNonActionGaps)) {
      errors.push(`retiredNonActionGaps must be an array.`);
    }

    if (!Array.isArray(reg.unresolvedGaps)) {
      errors.push(`unresolvedGaps must be an array.`);
    }

    // High-Water Mark Invariant:
    // HWM must never advance past an unresolved gap.
    // If any unresolved gap is <= highWaterIssueNumber, the invariant is violated!
    if (typeof hwm === 'number' && Array.isArray(reg.unresolvedGaps)) {
      for (const gap of reg.unresolvedGaps) {
        if (typeof gap === 'number' && gap <= hwm) {
          errors.push(
            `HWM Advancement Invariant Violated: highWaterIssueNumber (${hwm}) cannot be >= unresolvedGap (${gap}).`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertValidContributionLedger(data: unknown): asserts data is ContributionLedgerDocument {
  const result = validateContributionLedger(data);
  if (!result.valid) {
    throw new Error(`Contribution ledger validation failed:\n - ${result.errors.join('\n - ')}`);
  }
}

export function assertValidActionLedger(data: unknown): asserts data is ActionLedgerDocument {
  const result = validateActionLedger(data);
  if (!result.valid) {
    throw new Error(`Action ledger validation failed:\n - ${result.errors.join('\n - ')}`);
  }
}
