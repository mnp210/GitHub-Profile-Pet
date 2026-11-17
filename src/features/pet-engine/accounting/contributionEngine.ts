/**
 * GitHub Profile Pet - Deterministic Contribution Accounting Engine (Phase 3C2.2.1)
 *
 * Implements:
 * - Per-date Monotonic High-Water Marks (dailyHwm)
 * - Independent Durable Reward Ordinals (dailyRewardOrdinal)
 * - Installation Baseline Lifecycle (zero retroactive XP, baseline does not consume ordinals)
 * - Diminishing Activity Reward Schedule (25, 15, 10, 5, 5 XP; 10, 5, 2, 1, 1 Satiety)
 * - 5 Individual Increments per UTC Hour Processing Throttle
 * - Daily 300 Activity XP Cap with Whole-Increment Forfeiture Policy
 * - 48-Hour Pending Expiration Boundary (syncDate midnight + 48h UTC)
 * - Fundamental Accounting Conservation Invariant:
 *     total_contributions_recorded = rewarded + forfeited + pending + expired
 * - Fail-Closed Security on Corrupt Accounting State or Identity Mismatch
 */

import {
  CONTRIBUTION_SLICE_EXPIRY_MS,
  DAILY_CONTRIBUTION_XP_CAP,
  MAX_INCREMENTS_PER_HOUR,
} from '../domain/constants.ts';
import type {
  ContributionLedgerDocument,
  ContributionSlice,
  InstallationBaselineMetadata,
  MonthlyHistoricalSummary,
  PetStateDocument,
  SyncReceipt,
} from '../domain/types.ts';
import type { GitHubContributionSnapshot } from '../contribution/types.ts';
import {
  applyExperience,
  clampVital,
  derivePetMoodFromVitals,
} from '../transitions/progressionEngine.ts';

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

export class CorruptOrdinalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptOrdinalError';
  }
}

export class CorruptHwmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptHwmError';
  }
}

export class InvalidSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSnapshotError';
  }
}

export class IdentityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityMismatchError';
  }
}

// ---------------------------------------------------------------------------
// Interfaces & Types
// ---------------------------------------------------------------------------

export interface DailySnapshotInput {
  date: string; // YYYY-MM-DD UTC
  observedTotal: number; // public category sum: commits + issues + PRs + reviews
}

export interface ContributionReconciliationParams {
  pet: PetStateDocument;
  ledger: ContributionLedgerDocument;
  observedPublicTotal?: number;
  syncDateOverride?: string;
  snapshots?: Array<DailySnapshotInput | GitHubContributionSnapshot>;
  snapshot?: GitHubContributionSnapshot;
  ownerDatabaseId?: number;
  ownerLogin?: string;
  nowMs: number;
}

export interface ContributionReconciliationResult {
  nextPetState: PetStateDocument;
  nextContributionLedger: ContributionLedgerDocument;
  deltaObserved: number;
  totalXpAwarded: number;
  totalSatietyAwarded: number;
  newSlicesCreated: number;
  pendingSlicesExpired: number;
  incrementsEvaluatedThisRun: number;
  invariantSatisfied: boolean;
}

export interface InvariantVerificationResult {
  satisfied: boolean;
  totalObserved: number;
  sumCategorized: number;
  breakdown: {
    rewarded: number;
    forfeited: number;
    pending: number;
    expired: number;
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

export function computeExpiryAtForSyncDate(syncDate: string): string {
  const midnightMs = new Date(`${syncDate}T00:00:00.000Z`).getTime();
  return new Date(midnightMs + CONTRIBUTION_SLICE_EXPIRY_MS).toISOString();
}

export function getUtcDateString(timestampMs: number): string {
  return new Date(timestampMs).toISOString().split('T')[0];
}

export function getUtcHourKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().substring(0, 13); // e.g. "2026-11-16T14"
}

export function getRewardForOrdinal(ordinal: number): { xp: number; satiety: number } {
  if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error(`Invalid reward ordinal: ${String(ordinal)}. Ordinals must be integers >= 1.`);
  }
  if (ordinal === 1) return { xp: 25, satiety: 10 };
  if (ordinal === 2) return { xp: 15, satiety: 5 };
  if (ordinal === 3) return { xp: 10, satiety: 2 };
  if (ordinal === 4) return { xp: 5, satiety: 1 };
  return { xp: 5, satiety: 1 };
}

export function verifyAccountingInvariant(ledger: ContributionLedgerDocument): InvariantVerificationResult {
  let observed = 0;
  let rewarded = 0;
  let forfeited = 0;
  let pending = 0;
  let expired = 0;

  for (const slice of ledger.slices) {
    observed += slice.units;
    if (slice.status === 'rewarded') rewarded += slice.units;
    else if (slice.status === 'forfeited') forfeited += slice.units;
    else if (slice.status === 'pending') pending += slice.units;
    else if (slice.status === 'expired') expired += slice.units;
  }

  for (const s of ledger.monthlyHistoricalSummary) {
    observed += s.totalObservedUnits;
    rewarded += s.rewardedUnits;
    forfeited += s.forfeitedUnits;
    expired += s.expiredUnits;
  }

  const sumCategorized = rewarded + forfeited + pending + expired;
  return {
    satisfied: observed === sumCategorized,
    totalObserved: observed,
    sumCategorized,
    breakdown: {
      rewarded,
      forfeited,
      pending,
      expired,
    },
  };
}

// ---------------------------------------------------------------------------
// Normalization & Validation of Incoming Snapshots
// ---------------------------------------------------------------------------

function normalizeSnapshots(params: ContributionReconciliationParams): {
  snapshots: DailySnapshotInput[];
  ownerDatabaseId?: number;
  ownerLogin?: string;
} {
  const normalized: DailySnapshotInput[] = [];
  let ownerDatabaseId = params.ownerDatabaseId;
  let ownerLogin = params.ownerLogin;

  if (params.snapshot) {
    const snap = params.snapshot;
    if (snap.isPersonalAccount === false) {
      throw new InvalidSnapshotError('Organization accounts are ineligible for contribution rewards.');
    }
    ownerDatabaseId = ownerDatabaseId ?? snap.ownerDatabaseId;
    ownerLogin = ownerLogin ?? snap.ownerLogin;
    const date = snap.fromIso.substring(0, 10);
    normalized.push({
      date,
      observedTotal: snap.counts.publicCategoryTotal,
    });
  }

  if (params.snapshots && Array.isArray(params.snapshots)) {
    for (const item of params.snapshots) {
      if ('counts' in item) {
        // GitHubContributionSnapshot
        const snap = item as GitHubContributionSnapshot;
        if (snap.isPersonalAccount === false) {
          throw new InvalidSnapshotError('Organization accounts are ineligible for contribution rewards.');
        }
        ownerDatabaseId = ownerDatabaseId ?? snap.ownerDatabaseId;
        ownerLogin = ownerLogin ?? snap.ownerLogin;
        const date = snap.fromIso.substring(0, 10);
        normalized.push({
          date,
          observedTotal: snap.counts.publicCategoryTotal,
        });
      } else {
        // DailySnapshotInput
        const input = item as DailySnapshotInput;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
          throw new InvalidSnapshotError(`Invalid snapshot date format: ${input.date}`);
        }
        if (typeof input.observedTotal !== 'number' || !Number.isInteger(input.observedTotal) || input.observedTotal < 0) {
          throw new InvalidSnapshotError(`Invalid observedTotal for ${input.date}: ${String(input.observedTotal)}`);
        }
        normalized.push(input);
      }
    }
  }

  // Fallback for legacy / scalar test signatures: observedPublicTotal
  if (normalized.length === 0 && typeof params.observedPublicTotal === 'number') {
    if (!Number.isInteger(params.observedPublicTotal) || params.observedPublicTotal < 0) {
      throw new InvalidSnapshotError(`Invalid observedPublicTotal: ${String(params.observedPublicTotal)}`);
    }
    const date = params.syncDateOverride || getUtcDateString(params.nowMs);
    normalized.push({
      date,
      observedTotal: params.observedPublicTotal,
    });
  }

  return { snapshots: normalized, ownerDatabaseId, ownerLogin };
}

// ---------------------------------------------------------------------------
// Core Deterministic Reconciliation Engine
// ---------------------------------------------------------------------------

export function reconcileContributions(
  params: ContributionReconciliationParams
): ContributionReconciliationResult {
  const { pet, ledger, nowMs } = params;
  const nowIso = new Date(nowMs).toISOString();
  const hourKey = getUtcHourKey(nowMs);

  // 1. Normalize and validate inputs
  const { snapshots, ownerDatabaseId, ownerLogin } = normalizeSnapshots(params);

  // Identity validation: fail closed if snapshot identity disagrees with established ledger
  if (ledger.ownerDatabaseId !== undefined && ownerDatabaseId !== undefined) {
    if (ledger.ownerDatabaseId !== ownerDatabaseId) {
      throw new IdentityMismatchError(
        `Immutable Owner Database ID Mismatch: Ledger owned by ${ledger.ownerDatabaseId}, snapshot provided ${ownerDatabaseId}.`
      );
    }
  }

  const isBaselineCompleted = ledger.installationBaseline?.completed === true;

  // -------------------------------------------------------------------------
  // Path A: Installation Baseline Initialization (Zero Retroactive Rewards)
  // -------------------------------------------------------------------------
  if (!isBaselineCompleted) {
    // If ledger has slices or non-empty history, missing baseline is an integrity failure
    if (ledger.slices.length > 0) {
      throw new CorruptOrdinalError(
        'Class B Fatal Local Integrity Failure: Established ledger contains recorded slices but is missing installationBaseline.'
      );
    }

    const todayDate = getUtcDateString(nowMs);
    const yesterdayDate = getUtcDateString(nowMs - 86400000);

    const initialHwm: Record<string, number> = {};
    const initialOrdinals: Record<string, number> = {};

    let yesterdayCount = 0;
    let todayCount = 0;

    for (const snap of snapshots) {
      initialHwm[snap.date] = snap.observedTotal;
      initialOrdinals[snap.date] = 0; // Ordinal starts strictly at 0
      if (snap.date === yesterdayDate) yesterdayCount = snap.observedTotal;
      if (snap.date === todayDate) todayCount = snap.observedTotal;
    }

    // Default yesterday and today in HWM if not explicitly present in snapshots
    if (initialHwm[yesterdayDate] === undefined) {
      initialHwm[yesterdayDate] = yesterdayCount;
      initialOrdinals[yesterdayDate] = 0;
    }
    if (initialHwm[todayDate] === undefined) {
      initialHwm[todayDate] = todayCount;
      initialOrdinals[todayDate] = 0;
    }

    const baselineMeta: InstallationBaselineMetadata = {
      completed: true,
      installedAt: nowIso,
      baselineDateUtc: todayDate,
      initialCounts: {
        yesterday: yesterdayCount,
        today: todayCount,
      },
    };

    const receipt: SyncReceipt = {
      timestamp: nowIso,
      status: 'success',
      incrementsProcessed: 0,
      notes: 'Installation baseline recorded. Historical contributions baseline established with zero rewards.',
    };

    const nextContributionLedger: ContributionLedgerDocument = {
      schemaVersion: ledger.schemaVersion,
      generation: ledger.generation + 1,
      ownerDatabaseId: ownerDatabaseId ?? ledger.ownerDatabaseId,
      ownerLogin: ownerLogin ?? ledger.ownerLogin,
      installationBaseline: baselineMeta,
      dailyHwm: initialHwm,
      dailyRewardOrdinal: initialOrdinals,
      lastSyncReceipt: receipt,
      dailyAccruedXp: { ...ledger.dailyAccruedXp },
      hourlyIncrementUsage: { ...(ledger.hourlyIncrementUsage || {}) },
      hourlySliceUsage: { ...(ledger.hourlySliceUsage || {}) },
      monotonicPublicHwm: Math.max(...Object.values(initialHwm), 0),
      slices: [],
      monthlyHistoricalSummary: [...ledger.monthlyHistoricalSummary],
    };

    const invariant = verifyAccountingInvariant(nextContributionLedger);

    return {
      nextPetState: { ...pet },
      nextContributionLedger,
      deltaObserved: 0,
      totalXpAwarded: 0,
      totalSatietyAwarded: 0,
      newSlicesCreated: 0,
      pendingSlicesExpired: 0,
      incrementsEvaluatedThisRun: 0,
      invariantSatisfied: invariant.satisfied,
    };
  }

  // -------------------------------------------------------------------------
  // Path B: Established Ledger Reconciliation
  // -------------------------------------------------------------------------

  // Validate integrity of established counters
  if (!ledger.dailyHwm || typeof ledger.dailyHwm !== 'object') {
    throw new CorruptHwmError('Class B Fatal Local Integrity Failure: Established ledger is missing dailyHwm object.');
  }
  if (!ledger.dailyRewardOrdinal || typeof ledger.dailyRewardOrdinal !== 'object') {
    throw new CorruptOrdinalError(
      'Class B Fatal Local Integrity Failure: Established ledger is missing dailyRewardOrdinal object.'
    );
  }

  // Clone mutable tracking records
  const dailyHwm: Record<string, number> = { ...ledger.dailyHwm };
  const dailyRewardOrdinal: Record<string, number> = { ...ledger.dailyRewardOrdinal };
  const dailyAccruedXp: Record<string, number> = { ...ledger.dailyAccruedXp };
  const hourlyIncrementUsage: Record<string, number> = { ...(ledger.hourlyIncrementUsage || {}) };
  if (hourlyIncrementUsage[hourKey] === undefined) {
    hourlyIncrementUsage[hourKey] = 0;
  }

  let totalDeltaObserved = 0;
  let newSlicesCreated = 0;
  const newPendingSlices: ContributionSlice[] = [];

  // Sort snapshots by date ascending for deterministic processing
  const sortedSnapshots = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  for (const snap of sortedSnapshots) {
    const { date, observedTotal } = snap;

    // Verify counter integrity for active date
    if (date in dailyHwm) {
      const hwm = dailyHwm[date];
      if (typeof hwm !== 'number' || !Number.isInteger(hwm) || hwm < 0) {
        throw new CorruptHwmError(
          `Class B Fatal Local Integrity Failure: Corrupt dailyHwm for date ${date}: ${String(hwm)}`
        );
      }
    } else {
      // Subsequent date default
      dailyHwm[date] = 0;
    }

    if (date in dailyRewardOrdinal) {
      const ord = dailyRewardOrdinal[date];
      if (typeof ord !== 'number' || !Number.isInteger(ord) || ord < 0) {
        throw new CorruptOrdinalError(
          `Class B Fatal Local Integrity Failure: Corrupt dailyRewardOrdinal for date ${date}: ${String(ord)}`
        );
      }
    } else {
      // Subsequent date default
      dailyRewardOrdinal[date] = 0;
    }

    const currentHwm = dailyHwm[date];
    const currentOrdinal = dailyRewardOrdinal[date];

    // Monotonic High-Water Mark calculation
    const delta = Math.max(0, observedTotal - currentHwm);
    const nextHwm = Math.max(currentHwm, observedTotal);

    dailyHwm[date] = nextHwm;
    totalDeltaObserved += delta;

    if (delta > 0) {
      const expiryAt = computeExpiryAtForSyncDate(date);
      for (let k = 1; k <= delta; k++) {
        const assignedOrdinal = currentOrdinal + k;
        const slice: ContributionSlice = {
          sliceId: `slice_${date}_ord_${assignedOrdinal}`,
          syncDate: date,
          dailyOrdinal: assignedOrdinal,
          discoveredAt: nowIso,
          units: 1, // Strictly 1 unit per increment
          status: 'pending',
          rewardedXp: 0,
          rewardedSatiety: 0,
          expiryAt,
          evaluatedAt: null,
        };
        newPendingSlices.push(slice);
        newSlicesCreated++;
      }
      // Advance daily reward ordinal monotonically and atomically with HWM
      dailyRewardOrdinal[date] = currentOrdinal + delta;
    }
  }

  // -------------------------------------------------------------------------
  // 3. Process Pending Queue: Expiration, Throttle, and Daily Cap
  // -------------------------------------------------------------------------

  // Collect all existing non-pending slices and existing pending slices
  const finalizedSlices: ContributionSlice[] = [];
  const activePendingSlices: ContributionSlice[] = [];

  for (const s of ledger.slices) {
    if (s.status === 'pending') {
      activePendingSlices.push({ ...s });
    } else {
      finalizedSlices.push({ ...s });
    }
  }

  // Combine existing pending slices and newly created pending slices
  const combinedPending = [...activePendingSlices, ...newPendingSlices];

  // Invariant 6: Sort strictly by (syncDate ASC, dailyOrdinal ASC)
  combinedPending.sort((a, b) => {
    const dateCmp = a.syncDate.localeCompare(b.syncDate);
    if (dateCmp !== 0) return dateCmp;
    return (a.dailyOrdinal || 0) - (b.dailyOrdinal || 0);
  });

  let remainingHourlyQuota = Math.max(0, MAX_INCREMENTS_PER_HOUR - (hourlyIncrementUsage[hourKey] || 0));
  let pendingSlicesExpired = 0;
  let incrementsEvaluatedThisRun = 0;
  let totalXpAwarded = 0;
  let totalSatietyAwarded = 0;

  const processedSlices: ContributionSlice[] = [];

  for (const slice of combinedPending) {
    const expiryMs = new Date(slice.expiryAt).getTime();

    // 3.1 Expiration Check (now >= expiry_at)
    if (nowMs >= expiryMs) {
      slice.status = 'expired';
      slice.evaluatedAt = nowIso;
      slice.rewardedXp = 0;
      slice.rewardedSatiety = 0;
      pendingSlicesExpired++;
      processedSlices.push(slice);
      continue;
    }

    const sliceDate = slice.syncDate;
    if (dailyAccruedXp[sliceDate] === undefined) {
      dailyAccruedXp[sliceDate] = 0;
    }

    const currentDailyXp = dailyAccruedXp[sliceDate];

    // 3.2 Immediate Daily-Cap Exhaustion Forfeiture (Phase 3C2.2.1-R2 Policy)
    // When dailyAccruedXp[syncDate] reaches 300 XP, immediately transition every remaining
    // pending increment for that UTC date to 'forfeited' with reason 'daily_cap_exhausted'.
    // These bulk-forfeited increments:
    // - Must NOT consume the five-increment-per-hour evaluation quota (remainingHourlyQuota untouched)
    // - Must NOT increment hourlyIncrementUsage[hourKey]
    // - Must receive zero XP and zero satiety
    // - Must retain their original syncDate and dailyOrdinal
    // - Must be permanently terminal
    // - Must NOT block subsequent pending increments from newer UTC dates whose daily cap has not been reached.
    if (currentDailyXp >= DAILY_CONTRIBUTION_XP_CAP) {
      slice.status = 'forfeited';
      slice.forfeitureReason = 'daily_cap_exhausted';
      slice.evaluatedAt = nowIso;
      slice.rewardedXp = 0;
      slice.rewardedSatiety = 0;
      processedSlices.push(slice);
      continue;
    }

    // 3.3 Hourly Throttle Check (Max 5 increments/hour for ordinary evaluation)
    if (remainingHourlyQuota <= 0) {
      // Retain in pending queue with original date, ordinal, and expiry
      processedSlices.push(slice);
      continue;
    }

    // 3.4 Increment Evaluation (Room in daily cap > 0)
    const roomInDailyCap = Math.max(0, DAILY_CONTRIBUTION_XP_CAP - currentDailyXp);
    const ordinal = slice.dailyOrdinal || 1;
    const reward = getRewardForOrdinal(ordinal);

    if (reward.xp <= roomInDailyCap) {
      // Complete increment fits within remaining daily cap allowance
      slice.status = 'rewarded';
      slice.evaluatedAt = nowIso;
      slice.rewardedXp = reward.xp;
      slice.rewardedSatiety = reward.satiety;
      dailyAccruedXp[sliceDate] = currentDailyXp + reward.xp;
      totalXpAwarded += reward.xp;
      totalSatietyAwarded += reward.satiety;
      hourlyIncrementUsage[hourKey] = (hourlyIncrementUsage[hourKey] || 0) + 1;
      remainingHourlyQuota--;
      incrementsEvaluatedThisRun++;
      processedSlices.push(slice);
    } else {
      // Whole-increment forfeiture policy:
      // Increment's complete reward exceeds remaining allowance -> forfeited permanently!
      // Never partially award an increment. Forfeiture permanently consumes ordinal.
      // Daily accrued XP is not incremented, so subsequent smaller increments may still fit!
      slice.status = 'forfeited';
      slice.forfeitureReason = 'whole_increment_overflow';
      slice.evaluatedAt = nowIso;
      slice.rewardedXp = 0;
      slice.rewardedSatiety = 0;
      hourlyIncrementUsage[hourKey] = (hourlyIncrementUsage[hourKey] || 0) + 1;
      remainingHourlyQuota--;
      incrementsEvaluatedThisRun++;
      processedSlices.push(slice);
    }
  }

  // All slices: previously finalized + newly evaluated / remaining pending
  const allSlices = [...finalizedSlices, ...processedSlices];

  // Calculate overall scalar peak for backward compatibility
  const scalarHwm = Math.max(...Object.values(dailyHwm), 0);

  const receipt: SyncReceipt = {
    timestamp: nowIso,
    status: 'success',
    incrementsProcessed: incrementsEvaluatedThisRun,
    notes: `Reconciled ${snapshots.length} snapshot(s). Observed delta: ${totalDeltaObserved}. Evaluated: ${incrementsEvaluatedThisRun}.`,
  };

  const nextContributionLedger: ContributionLedgerDocument = {
    schemaVersion: ledger.schemaVersion,
    generation: ledger.generation + 1,
    ownerDatabaseId: ownerDatabaseId ?? ledger.ownerDatabaseId,
    ownerLogin: ownerLogin ?? ledger.ownerLogin,
    installationBaseline: ledger.installationBaseline,
    dailyHwm,
    dailyRewardOrdinal,
    lastSyncReceipt: receipt,
    dailyAccruedXp,
    hourlyIncrementUsage,
    hourlySliceUsage: { ...(ledger.hourlySliceUsage || {}) },
    monotonicPublicHwm: scalarHwm,
    slices: allSlices,
    monthlyHistoricalSummary: [...ledger.monthlyHistoricalSummary],
  };

  // -------------------------------------------------------------------------
  // 4. Update Pet State Vitals and XP
  // -------------------------------------------------------------------------
  let nextPetState: PetStateDocument = { ...pet };

  if (totalXpAwarded > 0 || totalSatietyAwarded > 0) {
    const progResult = applyExperience(pet.level, pet.xp, totalXpAwarded);
    const newHunger = clampVital(pet.hunger + totalSatietyAwarded);
    const newMood = derivePetMoodFromVitals({
      energy: pet.energy,
      hunger: newHunger,
      happiness: pet.happiness,
    });

    nextPetState = {
      ...pet,
      generation: pet.generation + 1,
      level: progResult.newLevel,
      xp: progResult.newXp,
      maxExp: progResult.newMaxExp,
      evolutionStage: progResult.newEvolutionStage,
      hunger: newHunger,
      mood: newMood,
      updatedAt: nowIso,
    };
  } else {
    // If no XP/satiety was awarded, keep generation in lockstep with ledger
    nextPetState = {
      ...pet,
      generation: pet.generation + 1,
      updatedAt: nowIso,
    };
  }

  // -------------------------------------------------------------------------
  // 5. Verify Accounting Conservation Invariant
  // -------------------------------------------------------------------------
  const invariant = verifyAccountingInvariant(nextContributionLedger);
  if (!invariant.satisfied) {
    throw new Error(
      `Accounting Conservation Invariant Violated: totalObserved (${invariant.totalObserved}) !== sumCategorized (${invariant.sumCategorized}).`
    );
  }

  return {
    nextPetState,
    nextContributionLedger,
    deltaObserved: totalDeltaObserved,
    totalXpAwarded,
    totalSatietyAwarded,
    newSlicesCreated,
    pendingSlicesExpired,
    incrementsEvaluatedThisRun,
    invariantSatisfied: invariant.satisfied,
  };
}

// ---------------------------------------------------------------------------
// Historical Slices Compaction
// ---------------------------------------------------------------------------

export function compactContributionLedger(
  ledger: ContributionLedgerDocument,
  cutoffTimestampMs: number
): ContributionLedgerDocument {
  const activeSlices: ContributionSlice[] = [];
  const slicesToCompact: ContributionSlice[] = [];

  for (const slice of ledger.slices) {
    const discoveredMs = new Date(slice.discoveredAt).getTime();
    if (discoveredMs < cutoffTimestampMs && slice.status !== 'pending') {
      slicesToCompact.push(slice);
    } else {
      activeSlices.push(slice);
    }
  }

  if (slicesToCompact.length === 0) {
    return { ...ledger };
  }

  const monthlyMap = new Map<string, MonthlyHistoricalSummary>();

  for (const s of ledger.monthlyHistoricalSummary) {
    monthlyMap.set(s.month, { ...s });
  }

  for (const slice of slicesToCompact) {
    const month = slice.syncDate.substring(0, 7); // e.g. "2026-10"
    const entry = monthlyMap.get(month) || {
      month,
      totalObservedUnits: 0,
      rewardedUnits: 0,
      forfeitedUnits: 0,
      expiredUnits: 0,
      rewardedXp: 0,
      rewardedSatiety: 0,
    };

    entry.totalObservedUnits += slice.units;
    if (slice.status === 'rewarded') entry.rewardedUnits += slice.units;
    else if (slice.status === 'forfeited') entry.forfeitedUnits += slice.units;
    else if (slice.status === 'expired') entry.expiredUnits += slice.units;

    entry.rewardedXp += slice.rewardedXp;
    entry.rewardedSatiety = (entry.rewardedSatiety || 0) + slice.rewardedSatiety;
    monthlyMap.set(month, entry);
  }

  const updatedSummaries = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  const compactedLedger: ContributionLedgerDocument = {
    ...ledger,
    slices: activeSlices,
    monthlyHistoricalSummary: updatedSummaries,
  };

  const invariant = verifyAccountingInvariant(compactedLedger);
  if (!invariant.satisfied) {
    throw new Error(
      `Accounting Conservation Invariant Violated after Compaction: observed (${invariant.totalObserved}) !== categorized (${invariant.sumCategorized}).`
    );
  }

  return compactedLedger;
}
