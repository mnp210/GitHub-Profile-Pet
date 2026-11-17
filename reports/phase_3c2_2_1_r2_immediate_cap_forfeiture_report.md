# Phase 3C2.2.1-R2 Deliverable Report — Immediate Cap-Exhaustion Forfeiture

**Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Current Baseline Git Commit:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`  
**Milestone:** Phase 3C2.2.1-R2  
**Status:** COMPLETE (All Tests, Lint, Type Check, and Production Build Passing)

---

## 1. Executive Summary & Policy Objective

In Phase 3C2.2.1-R1, the consistency audit demonstrated that under the initial engine design, when a date's daily 300 XP cap was reached, remaining pending increments for that date were evaluated one-by-one under the 5-increment/hour throttle. A backlog of 100 cap-exhausted increments required 20 consecutive hourly windows (20 hours) to reach terminal forfeiture status, consuming 100 hourly evaluation quota units and blocking pending increments from newer UTC dates.

Under explicit repository owner authorization, **Phase 3C2.2.1-R2** adjusts this policy to **Immediate Cap-Exhaustion Forfeiture**:

> When `dailyAccruedXp[syncDate]` reaches exactly 300 XP (the daily contribution XP cap), every remaining pending increment belonging to that UTC date immediately transitions to `status: 'forfeited'` in the current run.

### Approved Invariants Enforced in R2
1. **Zero Quota Consumption**: Bulk-forfeited increments do not decrement `remainingHourlyQuota` and do not increment `hourlyIncrementUsage[hourKey]`.
2. **Zero Reward**: Bulk-forfeited increments receive strictly 0 XP and 0 satiety.
3. **Identity & Ordinal Preservation**: Slices retain their original `syncDate`, `dailyOrdinal`, `discoveredAt`, and `units: 1`.
4. **Permanent Terminal Status**: Bulk-forfeited increments cannot be re-awarded, re-evaluated, or revived across subsequent runs or date rollovers.
5. **Explicit Reason Disambiguation**: Slices carry an explicit, validated `forfeitureReason`:
   - `'daily_cap_exhausted'`: Bulk-forfeited because the daily 300 XP cap was reached.
   - `'whole_increment_overflow'`: Individually evaluated increment forfeited under the all-or-nothing rule because its full reward exceeded remaining room (e.g. at 290 XP, an increment awarding 20 XP forfeits and consumes 1 quota unit, leaving 10 XP room for smaller subsequent increments).
6. **Expiration Precedence**: Already-expired increments (`nowMs >= expiryMs`) are marked `status: 'expired'` with `forfeitureReason: undefined`, taking strict precedence over cap exhaustion.
7. **Non-Blocking Multi-Day Processing**: Newer dates queued behind an exhausted date are not throttled or delayed by the bulk forfeiture.

---

## 2. Architecture & Data Model Adjustments

### 2.1 Domain Types (`src/features/pet-engine/domain/types.ts`)
Added `ForfeitureReason` union type and optional property to `ContributionSlice`:
```typescript
export type ForfeitureReason = 'daily_cap_exhausted' | 'whole_increment_overflow';

export interface ContributionSlice {
  sliceId: string;
  syncDate: string;        // YYYY-MM-DD UTC
  dailyOrdinal?: number;   // 1-based sequential increment ordinal within syncDate
  discoveredAt: string;    // ISO-8601 UTC
  units: number;           // Observed units in this slice (strictly 1 for Phase 3C2 increments)
  status: SliceStatus;     // 'rewarded' | 'forfeited' | 'pending' | 'expired'
  rewardedXp: number;
  rewardedSatiety: number;
  expiryAt: string;        // ISO-8601 UTC (syncDate midnight + 48h)
  evaluatedAt: string | null; // ISO-8601 UTC or null if not yet evaluated
  forfeitureReason?: ForfeitureReason;
}
```

### 2.2 Schema Definition (`pet/schemas/contributions.schema.json`)
Updated slice properties in `pet/schemas/contributions.schema.json` with strict enum validation:
```json
"forfeitureReason": {
  "type": "string",
  "enum": ["daily_cap_exhausted", "whole_increment_overflow"]
}
```

### 2.3 Ledger Validator (`src/features/pet-engine/validation/ledgerValidator.ts`)
Added strict validation in `validateContributionLedger`:
- Rejects invalid `forfeitureReason` values not in `['daily_cap_exhausted', 'whole_increment_overflow']`.
- Rejects non-forfeited slices (e.g. `rewarded`, `pending`, `expired`) that carry a `forfeitureReason`.
- Preserves accounting conservation invariant across all states.

---

## 3. Deterministic Reconciliation Engine Implementation

In `src/features/pet-engine/accounting/contributionEngine.ts`, the pending queue loop was restructured with exact precedence:

```typescript
  for (const slice of combinedPending) {
    const expiryMs = new Date(slice.expiryAt).getTime();

    // 3.1 Expiration Check (now >= expiry_at)
    // Slices whose expiration date has passed must be marked expired, not forfeited.
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
    if (currentDailyXp >= DAILY_CONTRIBUTION_XP_CAP) {
      slice.status = 'forfeited';
      slice.forfeitureReason = 'daily_cap_exhausted';
      slice.evaluatedAt = nowIso;
      slice.rewardedXp = 0;
      slice.rewardedSatiety = 0;
      // Does NOT consume remainingHourlyQuota
      // Does NOT increment hourlyIncrementUsage[hourKey]
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
```

---

## 4. Comprehensive Test Suite & Verification Matrix

### 4.1 Dedicated Test Suite: `tests/pet-engine/immediateCapForfeiture.test.ts`
All 9 scenarios implemented and passing:
1. **100 pending increments with date at 300 XP**: Forfeit in 1 single run with exactly 0 hourly quota consumed (`hourlyIncrementUsage` remains 0).
2. **Non-blocking multi-day processing**: Day 1 has 50 pending increments at 300 XP, Day 2 has 8 increments at 0 XP. In one run, Day 1 bulk-forfeits 50 increments consuming 0 quota, while Day 2 evaluates 5 increments (consuming 5 quota) and defers 3.
3. **Mid-run cap reach**: Date at 295 XP evaluates ordinal 4 (5 XP), reaches 300 XP (consuming 1 quota). Slices 5–8 immediately bulk-forfeit with `'daily_cap_exhausted'` without consuming remaining quota.
4. **Individual evaluation at 290 XP**: Date at 290 XP evaluates ordinal 1 (25 XP > 10 XP -> `'whole_increment_overflow'`, consumes 1 quota), ordinal 2 (15 XP > 10 XP -> `'whole_increment_overflow'`, consumes 1 quota), ordinal 3 (10 XP <= 10 XP -> rewarded, consumes 1 quota, reaches 300 XP), then ordinals 4 & 5 bulk-forfeit as `'daily_cap_exhausted'`. Total quota consumed = 3.
5. **Expiration precedence**: Expired slices retain status `'expired'` even if the date is at cap.
6. **Permanent terminal status**: Bulk-forfeited slices are never re-awarded on subsequent syncs or new dates.
7. **Persistence and restart durability**: State repository persists and reloads ledger with `forfeitureReason` cleanly; schema and validators pass.
8. **Monthly compaction consistency**: Compacted ledger aggregates bulk-forfeited slices into `monthlyHistoricalSummary.forfeitedUnits` with 0 XP; unit conservation holds.
9. **Strict validator enforcement**: Validates schema and validator rejection of invalid reasons or invalid status/reason combinations.

### 4.2 Updated Consistency Audit: `tests/pet-engine/capThrottleAudit.test.ts`
- Audit Scenario 1 & 2 updated to assert R2 policy: 100 increments forfeit immediately, 0 hourly quota consumed.
- Audit Scenario 3 updated to assert `whole_increment_overflow` reasons.
- All 8 audit scenarios passing.

### 4.3 Full Test Matrix Results

| Suite / Check | Command | Result | Pass / Fail |
|---|---|---|---|
| Immediate Cap Forfeiture Suite | `node --test tests/pet-engine/immediateCapForfeiture.test.ts` | 9 tests, 1 suite | **9 passed, 0 failed** |
| Cap Throttle Audit Suite | `node --test tests/pet-engine/capThrottleAudit.test.ts` | 8 tests, 1 suite | **8 passed, 0 failed** |
| Contribution Accounting Suite | `node --test tests/pet-engine/contributionAccounting.test.ts` | 23 tests, 1 suite | **23 passed, 0 failed** |
| Combined Contribution Suites | `node --test tests/pet-engine/{contributionAccounting,immediateCapForfeiture,capThrottleAudit}.test.ts` | 39 tests, 3 suites | **39 passed, 0 failed** |
| Pet-Engine Full Suite | `npm run test:pet-engine` | 305 tests, 21 suites | **305 passed, 0 failed** |
| Unit Test Suite | `npm test` | 121 tests, 24 suites | **121 passed, 0 failed** |
| ESLint Check | `npm run lint` | 0 warnings, 0 errors | **Passed** |
| TypeScript Check | `npx tsc --noEmit` | 0 errors | **Passed** |
| Production Build | `npm run build` | Next.js 16.4.6 static & dynamic routes | **Passed** |

---

## 5. Working Tree Status & Publication Readiness

```
 M pet/schemas/contributions.schema.json
 M src/features/pet-engine/accounting/contributionEngine.ts
 M src/features/pet-engine/domain/constants.ts
 M src/features/pet-engine/domain/types.ts
 M src/features/pet-engine/validation/ledgerValidator.ts
 M tests/pet-engine/contributionAccounting.test.ts
?? reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md
?? reports/phase_3c2_1_v5_2_1_4_final_verification_report.md
?? reports/phase_3c2_2_1_accounting_engine_report.md
?? reports/phase_3c2_2_1_r1_cap_throttle_compaction_audit.md
?? reports/phase_3c2_2_1_r2_immediate_cap_forfeiture_report.md
?? tests/pet-engine/capThrottleAudit.test.ts
?? tests/pet-engine/immediateCapForfeiture.test.ts
```

No git commits, pushes, branch changes, or working tree cleans have been executed. All changes remain safely in the local working directory awaiting review and controlled staging authorization. Phase 3C2.2.2 remains strictly uninitiated.
