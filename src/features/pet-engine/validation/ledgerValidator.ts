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
const VALID_FORFEITURE_REASONS: Set<string> = new Set(['daily_cap_exhausted', 'whole_increment_overflow']);

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

  if (obj.monotonicPublicHwm !== undefined) {
    if (
      typeof obj.monotonicPublicHwm !== 'number' ||
      !Number.isInteger(obj.monotonicPublicHwm) ||
      obj.monotonicPublicHwm < 0
    ) {
      errors.push(`monotonicPublicHwm must be a non-negative integer.`);
    }
  }

  // Phase 3C2: dailyHwm validation
  if (obj.dailyHwm !== undefined) {
    if (typeof obj.dailyHwm !== 'object' || obj.dailyHwm === null || Array.isArray(obj.dailyHwm)) {
      errors.push(`dailyHwm must be a record mapping date string to high-water mark count.`);
    } else {
      for (const [date, hwm] of Object.entries(obj.dailyHwm as Record<string, unknown>)) {
        if (typeof hwm !== 'number' || !Number.isInteger(hwm) || hwm < 0) {
          errors.push(`dailyHwm for ${date} must be a non-negative integer, received: ${String(hwm)}.`);
        }
      }
    }
  }

  // Phase 3C2: dailyRewardOrdinal validation
  if (obj.dailyRewardOrdinal !== undefined) {
    if (
      typeof obj.dailyRewardOrdinal !== 'object' ||
      obj.dailyRewardOrdinal === null ||
      Array.isArray(obj.dailyRewardOrdinal)
    ) {
      errors.push(`dailyRewardOrdinal must be a record mapping date string to reward ordinal counter.`);
    } else {
      for (const [date, ord] of Object.entries(obj.dailyRewardOrdinal as Record<string, unknown>)) {
        if (typeof ord !== 'number' || !Number.isInteger(ord) || ord < 0) {
          errors.push(`dailyRewardOrdinal for ${date} must be a non-negative integer, received: ${String(ord)}.`);
        }
      }
    }
  }

  // Phase 3C2: installationBaseline validation
  if (obj.installationBaseline !== undefined) {
    if (typeof obj.installationBaseline !== 'object' || obj.installationBaseline === null) {
      errors.push(`installationBaseline must be an object.`);
    } else {
      const base = obj.installationBaseline as Record<string, unknown>;
      if (typeof base.completed !== 'boolean') {
        errors.push(`installationBaseline.completed must be a boolean.`);
      }
      if (typeof base.installedAt !== 'string' || !isValidIsoDateString(base.installedAt)) {
        errors.push(`installationBaseline.installedAt must be a valid ISO-8601 date string.`);
      }
      if (typeof base.baselineDateUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(base.baselineDateUtc)) {
        errors.push(`installationBaseline.baselineDateUtc must be a valid YYYY-MM-DD date string.`);
      }
      if (typeof base.initialCounts !== 'object' || base.initialCounts === null) {
        errors.push(`installationBaseline.initialCounts must be an object with yesterday and today counts.`);
      } else {
        const counts = base.initialCounts as Record<string, unknown>;
        if (typeof counts.yesterday !== 'number' || !Number.isInteger(counts.yesterday) || counts.yesterday < 0) {
          errors.push(`installationBaseline.initialCounts.yesterday must be a non-negative integer.`);
        }
        if (typeof counts.today !== 'number' || !Number.isInteger(counts.today) || counts.today < 0) {
          errors.push(`installationBaseline.initialCounts.today must be a non-negative integer.`);
        }
      }

      // If baseline is marked completed, dailyHwm and dailyRewardOrdinal are strictly required
      if (base.completed === true) {
        if (typeof obj.dailyHwm !== 'object' || obj.dailyHwm === null) {
          errors.push(`Established ledger with completed installationBaseline must contain dailyHwm.`);
        }
        if (typeof obj.dailyRewardOrdinal !== 'object' || obj.dailyRewardOrdinal === null) {
          errors.push(`Established ledger with completed installationBaseline must contain dailyRewardOrdinal.`);
        }
      }
    }
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

  if (obj.hourlyIncrementUsage !== undefined) {
    if (
      typeof obj.hourlyIncrementUsage !== 'object' ||
      obj.hourlyIncrementUsage === null ||
      Array.isArray(obj.hourlyIncrementUsage)
    ) {
      errors.push(`hourlyIncrementUsage must be a record mapping hour string to evaluated increment counts.`);
    } else {
      for (const [hour, count] of Object.entries(obj.hourlyIncrementUsage as Record<string, unknown>)) {
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 5) {
          errors.push(`hourlyIncrementUsage for ${hour} must be an integer between 0 and 5, received: ${String(count)}.`);
        }
      }
    }
  }

  if (obj.hourlySliceUsage !== undefined) {
    if (
      typeof obj.hourlySliceUsage !== 'object' ||
      obj.hourlySliceUsage === null ||
      Array.isArray(obj.hourlySliceUsage)
    ) {
      errors.push(`hourlySliceUsage must be a record mapping hour string to slice counts.`);
    }
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

      if (slice.dailyOrdinal !== undefined) {
        if (typeof slice.dailyOrdinal !== 'number' || !Number.isInteger(slice.dailyOrdinal) || slice.dailyOrdinal < 1) {
          errors.push(`Slice at index ${i} dailyOrdinal must be an integer >= 1.`);
        }
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

      if (slice.evaluatedAt !== null && !isValidIsoDateString(slice.evaluatedAt)) {
        errors.push(`Slice at index ${i} has invalid evaluatedAt date.`);
      }

      if (slice.forfeitureReason !== undefined) {
        if (typeof slice.forfeitureReason !== 'string' || !VALID_FORFEITURE_REASONS.has(slice.forfeitureReason)) {
          errors.push(`Slice at index ${i} has invalid forfeitureReason: ${String(slice.forfeitureReason)}.`);
        }
        if (slice.status !== 'forfeited') {
          errors.push(`Slice at index ${i} has forfeitureReason but status is ${slice.status} (expected 'forfeited').`);
        }
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

  if (obj.pendingFeedback !== undefined) {
    if (!Array.isArray(obj.pendingFeedback)) {
      errors.push(`pendingFeedback must be an array when present.`);
    } else {
      for (let i = 0; i < obj.pendingFeedback.length; i++) {
        const rec = obj.pendingFeedback[i];
        if (typeof rec !== 'object' || rec === null) {
          errors.push(`pendingFeedback[${i}] must be an object.`);
          continue;
        }
        const r = rec as Record<string, unknown>;
        if (typeof r.issueNumber !== 'number' || !Number.isInteger(r.issueNumber) || r.issueNumber <= 0) {
          errors.push(`pendingFeedback[${i}].issueNumber must be a positive integer.`);
        }
        if (typeof r.requestId !== 'string' || !r.requestId) {
          errors.push(`pendingFeedback[${i}].requestId must be a non-empty string.`);
        }
        if (typeof r.feedbackDelivered !== 'boolean') {
          errors.push(`pendingFeedback[${i}].feedbackDelivered must be a boolean.`);
        }
        if (r.deliveredAt !== undefined && (typeof r.deliveredAt !== 'string' || !isValidIsoDateString(r.deliveredAt))) {
          errors.push(`pendingFeedback[${i}].deliveredAt must be a valid ISO date string when present.`);
        }
        if (r.closureConfirmed !== undefined && typeof r.closureConfirmed !== 'boolean') {
          errors.push(`pendingFeedback[${i}].closureConfirmed must be a boolean when present.`);
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

export class LedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerIntegrityError';
  }
}

/**
 * Strict pristine ledger predicate derived from the accepted runtime architecture.
 * A contribution ledger is pristine uninitialized if and only if all 12 conditions hold.
 */
export function isPristineContributionLedger(
  ledger: unknown,
  verifiedOwnerDatabaseId?: number
): boolean {
  if (typeof ledger !== 'object' || ledger === null || Array.isArray(ledger)) {
    return false;
  }
  const L = ledger as Record<string, unknown>;

  if (L.schemaVersion !== 1) return false;
  if (typeof L.generation !== 'number' || !Number.isInteger(L.generation) || L.generation < 1) return false;
  if (L.installationBaseline !== undefined) return false;
  if (!Array.isArray(L.slices) || L.slices.length !== 0) return false;
  if (!Array.isArray(L.monthlyHistoricalSummary) || L.monthlyHistoricalSummary.length !== 0) return false;

  if (
    L.dailyHwm !== undefined &&
    (typeof L.dailyHwm !== 'object' || L.dailyHwm === null || Object.keys(L.dailyHwm).length > 0)
  ) {
    return false;
  }

  if (
    L.dailyRewardOrdinal !== undefined &&
    (typeof L.dailyRewardOrdinal !== 'object' || L.dailyRewardOrdinal === null || Object.keys(L.dailyRewardOrdinal).length > 0)
  ) {
    return false;
  }

  if (
    L.dailyAccruedXp !== undefined &&
    (typeof L.dailyAccruedXp !== 'object' || L.dailyAccruedXp === null || Object.keys(L.dailyAccruedXp).length > 0)
  ) {
    return false;
  }

  if (L.lastSyncReceipt !== undefined) return false;

  if (
    L.hourlyIncrementUsage !== undefined &&
    (typeof L.hourlyIncrementUsage !== 'object' || L.hourlyIncrementUsage === null || Object.keys(L.hourlyIncrementUsage).length > 0)
  ) {
    return false;
  }

  if (
    L.hourlySliceUsage !== undefined &&
    (typeof L.hourlySliceUsage !== 'object' || L.hourlySliceUsage === null || Object.keys(L.hourlySliceUsage).length > 0)
  ) {
    return false;
  }

  if (L.monotonicPublicHwm !== undefined && L.monotonicPublicHwm !== 0) return false;

  if (L.ownerDatabaseId !== undefined && L.ownerDatabaseId !== null && verifiedOwnerDatabaseId !== undefined) {
    if (L.ownerDatabaseId !== verifiedOwnerDatabaseId) return false;
  }

  return true;
}

