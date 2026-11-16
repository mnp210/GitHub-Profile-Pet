/**
 * GitHub Profile Pet - Contribution Accounting Engine
 * Enforces monotonic HWM, 5-slice hourly throttle, daily 300 XP cap, 48-hour expiration,
 * and the fundamental conservation invariant:
 * observedUnits = rewardedUnits + forfeitedUnits + pendingUnits + expiredUnits
 */

import {
  CONTRIBUTION_SLICE_EXPIRY_MS,
  DAILY_CONTRIBUTION_XP_CAP,
  HOURLY_THROTTLE_MAX_SLICES,
  SATIETY_PER_CONTRIBUTION_UNIT,
  XP_PER_CONTRIBUTION_UNIT,
} from '../domain/constants.ts';
import type {
  ContributionLedgerDocument,
  ContributionSlice,
  PetStateDocument,
} from '../domain/types.ts';
import {
  applyExperience,
  clampVital,
  derivePetMoodFromVitals,
} from '../transitions/progressionEngine.ts';

export interface ContributionReconciliationResult {
  nextPetState: PetStateDocument;
  nextContributionLedger: ContributionLedgerDocument;
  deltaObserved: number;
  totalXpAwarded: number;
  totalSatietyAwarded: number;
  newSlicesCreated: number;
  pendingSlicesExpired: number;
  invariantSatisfied: boolean;
}

export function computeExpiryAtForSyncDate(syncDate: string): string {
  const midnightMs = new Date(`${syncDate}T00:00:00.000Z`).getTime();
  return new Date(midnightMs + CONTRIBUTION_SLICE_EXPIRY_MS).toISOString();
}

export function getUtcDateString(timestampMs: number): string {
  const d = new Date(timestampMs);
  return d.toISOString().split('T')[0];
}

export function getUtcHourKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  return d.toISOString().substring(0, 13); // e.g. "2026-11-15T14"
}

export function verifyAccountingInvariant(ledger: ContributionLedgerDocument): {
  satisfied: boolean;
  totalObserved: number;
  sumCategorized: number;
} {
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
  };
}

export function reconcileContributions(params: {
  pet: PetStateDocument;
  ledger: ContributionLedgerDocument;
  observedPublicTotal: number;
  nowMs: number;
  syncDateOverride?: string;
}): ContributionReconciliationResult {
  const { pet, ledger, observedPublicTotal, nowMs } = params;
  const syncDate = params.syncDateOverride || getUtcDateString(nowMs);
  const hourKey = getUtcHourKey(nowMs);
  const nowIso = new Date(nowMs).toISOString();

  // 1. Monotonic High-Water Mark Calculation
  const currentHwm = ledger.monotonicPublicHwm;
  const deltaObserved = Math.max(0, observedPublicTotal - currentHwm);
  const nextHwm = Math.max(currentHwm, observedPublicTotal);

  const updatedSlices: ContributionSlice[] = [];
  let pendingExpiredCount = 0;
  let totalXpAwarded = 0;
  let totalSatietyAwarded = 0;

  // Clone mutable tracking records
  const dailyAccruedXp = { ...ledger.dailyAccruedXp };
  const hourlySliceUsage = { ...ledger.hourlySliceUsage };
  if (dailyAccruedXp[syncDate] === undefined) {
    dailyAccruedXp[syncDate] = 0;
  }
  if (hourlySliceUsage[hourKey] === undefined) {
    hourlySliceUsage[hourKey] = 0;
  }

  // 2. Process existing pending slices (check 48h expiration or claim eligibility)
  for (const slice of ledger.slices) {
    if (slice.status === 'pending') {
      const expiryMs = new Date(slice.expiryAt).getTime();
      if (nowMs >= expiryMs) {
        // Expired!
        updatedSlices.push({
          ...slice,
          status: 'expired',
          evaluatedAt: nowIso,
        });
        pendingExpiredCount++;
      } else {
        // Check if can be rewarded now
        const hourlyUsed = hourlySliceUsage[hourKey] || 0;
        const currentDailyXp = dailyAccruedXp[syncDate] || 0;
        const roomInDailyCap = Math.max(0, DAILY_CONTRIBUTION_XP_CAP - currentDailyXp);

        if (hourlyUsed < HOURLY_THROTTLE_MAX_SLICES && roomInDailyCap > 0) {
          const potentialXp = slice.units * XP_PER_CONTRIBUTION_UNIT;
          const potentialSatiety = Math.round(slice.units * SATIETY_PER_CONTRIBUTION_UNIT);

          if (potentialXp <= roomInDailyCap) {
            updatedSlices.push({
              ...slice,
              status: 'rewarded',
              rewardedXp: potentialXp,
              rewardedSatiety: potentialSatiety,
              evaluatedAt: nowIso,
            });
            dailyAccruedXp[syncDate] = currentDailyXp + potentialXp;
            hourlySliceUsage[hourKey] = hourlyUsed + 1;
            totalXpAwarded += potentialXp;
            totalSatietyAwarded += potentialSatiety;
          } else {
            // Partial room: split slice to maintain exact unit accounting
            const unitsCanReward = Math.floor(roomInDailyCap / XP_PER_CONTRIBUTION_UNIT);
            if (unitsCanReward > 0) {
              const rewardedXp = unitsCanReward * XP_PER_CONTRIBUTION_UNIT;
              const rewardedSatiety = Math.round(unitsCanReward * SATIETY_PER_CONTRIBUTION_UNIT);
              updatedSlices.push({
                ...slice,
                sliceId: `${slice.sliceId}_r`,
                units: unitsCanReward,
                status: 'rewarded',
                rewardedXp,
                rewardedSatiety,
                evaluatedAt: nowIso,
              });
              dailyAccruedXp[syncDate] = currentDailyXp + rewardedXp;
              hourlySliceUsage[hourKey] = hourlyUsed + 1;
              totalXpAwarded += rewardedXp;
              totalSatietyAwarded += rewardedSatiety;

              const remainingUnits = slice.units - unitsCanReward;
              updatedSlices.push({
                ...slice,
                sliceId: `${slice.sliceId}_f`,
                units: remainingUnits,
                status: 'forfeited',
                rewardedXp: 0,
                rewardedSatiety: 0,
                evaluatedAt: nowIso,
              });
            } else {
              // Zero room left today, forfeits
              updatedSlices.push({
                ...slice,
                status: 'forfeited',
                rewardedXp: 0,
                rewardedSatiety: 0,
                evaluatedAt: nowIso,
              });
            }
          }
        } else if (hourlyUsed >= HOURLY_THROTTLE_MAX_SLICES) {
          // Keep pending
          updatedSlices.push({ ...slice });
        } else {
          // Daily cap completely exhausted for this sync date
          updatedSlices.push({
            ...slice,
            status: 'forfeited',
            rewardedXp: 0,
            rewardedSatiety: 0,
            evaluatedAt: nowIso,
          });
        }
      }
    } else {
      updatedSlices.push({ ...slice });
    }
  }

  // 3. Process Newly Observed Contribution Units (deltaObserved)
  let remainingUnits = deltaObserved;
  let newSlicesCreated = 0;
  const expiryAt = computeExpiryAtForSyncDate(syncDate);

  let sliceIndex = updatedSlices.length + 1;
  while (remainingUnits > 0) {
    const unitsInSlice = Math.min(remainingUnits, 5);
    remainingUnits -= unitsInSlice;
    newSlicesCreated++;

    const sliceId = `slice_${syncDate}_${nowMs}_${sliceIndex++}`;
    const hourlyUsed = hourlySliceUsage[hourKey] || 0;

    if (hourlyUsed >= HOURLY_THROTTLE_MAX_SLICES) {
      // Throttle exceeded: enters pending
      updatedSlices.push({
        sliceId,
        syncDate,
        discoveredAt: nowIso,
        units: unitsInSlice,
        status: 'pending',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt,
        evaluatedAt: nowIso,
      });
    } else {
      // Within hourly throttle: check daily cap
      const currentDailyXp = dailyAccruedXp[syncDate] || 0;
      const roomInDailyCap = Math.max(0, DAILY_CONTRIBUTION_XP_CAP - currentDailyXp);

      if (roomInDailyCap <= 0) {
        // Daily cap completely exhausted: forfeited
        updatedSlices.push({
          sliceId,
          syncDate,
          discoveredAt: nowIso,
          units: unitsInSlice,
          status: 'forfeited',
          rewardedXp: 0,
          rewardedSatiety: 0,
          expiryAt,
          evaluatedAt: nowIso,
        });
      } else {
        const potentialXp = unitsInSlice * XP_PER_CONTRIBUTION_UNIT;
        const potentialSatiety = Math.round(unitsInSlice * SATIETY_PER_CONTRIBUTION_UNIT);

        if (potentialXp <= roomInDailyCap) {
          // Full slice rewarded
          updatedSlices.push({
            sliceId,
            syncDate,
            discoveredAt: nowIso,
            units: unitsInSlice,
            status: 'rewarded',
            rewardedXp: potentialXp,
            rewardedSatiety: potentialSatiety,
            expiryAt,
            evaluatedAt: nowIso,
          });
          dailyAccruedXp[syncDate] = currentDailyXp + potentialXp;
          hourlySliceUsage[hourKey] = hourlyUsed + 1;
          totalXpAwarded += potentialXp;
          totalSatietyAwarded += potentialSatiety;
        } else {
          // Partial room available: split into rewarded and forfeited to preserve exact units
          const unitsCanReward = Math.floor(roomInDailyCap / XP_PER_CONTRIBUTION_UNIT);
          if (unitsCanReward > 0) {
            const rewardedXp = unitsCanReward * XP_PER_CONTRIBUTION_UNIT;
            const rewardedSatiety = Math.round(unitsCanReward * SATIETY_PER_CONTRIBUTION_UNIT);
            updatedSlices.push({
              sliceId: `${sliceId}_r`,
              syncDate,
              discoveredAt: nowIso,
              units: unitsCanReward,
              status: 'rewarded',
              rewardedXp,
              rewardedSatiety,
              expiryAt,
              evaluatedAt: nowIso,
            });
            dailyAccruedXp[syncDate] = currentDailyXp + rewardedXp;
            hourlySliceUsage[hourKey] = hourlyUsed + 1;
            totalXpAwarded += rewardedXp;
            totalSatietyAwarded += rewardedSatiety;

            const forfeitedUnits = unitsInSlice - unitsCanReward;
            updatedSlices.push({
              sliceId: `${sliceId}_f`,
              syncDate,
              discoveredAt: nowIso,
              units: forfeitedUnits,
              status: 'forfeited',
              rewardedXp: 0,
              rewardedSatiety: 0,
              expiryAt,
              evaluatedAt: nowIso,
            });
          } else {
            updatedSlices.push({
              sliceId,
              syncDate,
              discoveredAt: nowIso,
              units: unitsInSlice,
              status: 'forfeited',
              rewardedXp: 0,
              rewardedSatiety: 0,
              expiryAt,
              evaluatedAt: nowIso,
            });
          }
        }
      }
    }
  }

  // 4. Update Pet State with Rewarded XP & Satiety
  const progResult = applyExperience(pet.level, pet.xp, totalXpAwarded);
  const newHunger = clampVital(pet.hunger + totalSatietyAwarded);
  const newMood = derivePetMoodFromVitals({
    energy: pet.energy,
    hunger: newHunger,
    happiness: pet.happiness,
  });

  const nextPetState: PetStateDocument = {
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

  const nextContributionLedger: ContributionLedgerDocument = {
    schemaVersion: ledger.schemaVersion,
    generation: ledger.generation + 1,
    monotonicPublicHwm: nextHwm,
    dailyAccruedXp,
    hourlySliceUsage,
    slices: updatedSlices,
    monthlyHistoricalSummary: [...ledger.monthlyHistoricalSummary],
  };

  const invariantCheck = verifyAccountingInvariant(nextContributionLedger);

  return {
    nextPetState,
    nextContributionLedger,
    deltaObserved,
    totalXpAwarded,
    totalSatietyAwarded,
    newSlicesCreated,
    pendingSlicesExpired: pendingExpiredCount,
    invariantSatisfied: invariantCheck.satisfied,
  };
}

/**
 * Compacts finalized contribution slices older than cutoffTimestampMs into monthlyHistoricalSummary records.
 * Slices in 'pending' status are NEVER compacted until they are rewarded or expired.
 * Slices newer than cutoff remain active in slices array.
 * Mathematical conservation is strictly preserved:
 * observedUnits = rewardedUnits + forfeitedUnits + pendingUnits + expiredUnits
 */
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

  // Group compacted slices by month (YYYY-MM)
  const monthlyMap = new Map<
    string,
    {
      month: string;
      totalObservedUnits: number;
      rewardedUnits: number;
      forfeitedUnits: number;
      expiredUnits: number;
      rewardedXp: number;
    }
  >();

  // Populate from existing historical summaries
  for (const s of ledger.monthlyHistoricalSummary) {
    monthlyMap.set(s.month, { ...s });
  }

  // Aggregate newly compacted slices
  for (const slice of slicesToCompact) {
    const month = slice.syncDate.substring(0, 7); // e.g. "2026-11"
    const entry = monthlyMap.get(month) || {
      month,
      totalObservedUnits: 0,
      rewardedUnits: 0,
      forfeitedUnits: 0,
      expiredUnits: 0,
      rewardedXp: 0,
    };

    entry.totalObservedUnits += slice.units;
    if (slice.status === 'rewarded') entry.rewardedUnits += slice.units;
    else if (slice.status === 'forfeited') entry.forfeitedUnits += slice.units;
    else if (slice.status === 'expired') entry.expiredUnits += slice.units;

    entry.rewardedXp += slice.rewardedXp;
    monthlyMap.set(month, entry);
  }

  const updatedSummaries = Array.from(monthlyMap.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

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
