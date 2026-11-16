# Phase 3C1.1.2 — Fractional Decay Conservation & Scheduled Simulation Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Milestone:** Phase 3C1.1.2  
**Status:** Completed & Fully Verified  
**Date:** 2026-11-16  

---

## 1. Executive Summary

Phase 3C1.1.2 eliminates the rounding defect in passive pet simulation where hourly executions permanently discarded fractional vitals decay ($\approx 0.36\text{ points/hour}$), resulting in a major simulation discrepancy between hourly runs (0 total decay over 24 hours) and a single 24-hour run (8 points decay).

To ensure that **splitting an elapsed interval across any number of scheduled runs produces the exact same cumulative decay as a single uninterrupted run**, durable fractional decay accumulators (`hungerDecayAccumulator` and `happinessDecayAccumulator`) have been introduced into the authoritative state document, schema, validator, transition engine, and persistence transactions.

All 15 required deterministic tests from Section 6 of the specification have been authored and passed 100% across the test suite (305 passing tests across 34 suites, 0 failures, 0 lint warnings, and clean Next.js/Turbopack builds).

---

## 2. The Original Rounding Defect

### 2.1 The Independent Flooring Flaw
Prior to Phase 3C1.1.2, passive simulation computed integer vitals loss independently on every execution:

$$\Delta \text{Loss} = \lfloor \text{elapsedSeconds} \times 0.0001 \rfloor$$

With the scheduled workflow executing hourly ($3,600\text{ seconds}$):

$$\Delta \text{Loss}_{\text{hourly}} = \lfloor 3,600 \times 0.0001 \rfloor = \lfloor 0.36 \rfloor = \mathbf{0\text{ points}}$$

If the workflow ran every hour for 24 consecutive hours:
$$\text{Total 24h Decay (Hourly)} = 24 \times 0 = \mathbf{0\text{ points}}$$

Whereas if the workflow ran once after 24 uninterrupted hours ($86,400\text{ seconds}$):
$$\text{Total 24h Decay (Uninterrupted)} = \lfloor 86,400 \times 0.0001 \rfloor = \lfloor 8.64 \rfloor = \mathbf{8\text{ points}}$$

The pet's vitals decay depended on workflow execution frequency rather than actual elapsed wall-clock time, violating deterministic simulation consistency.

---

## 3. Persistent Fractional Decay Accounting

### 3.1 Chosen Representation & Precision
To maintain structural consistency with `energyAccumulator`, fractional decay is stored as fixed-precision micro-points in $[0, 1)$:

- **Fields:** `hungerDecayAccumulator` and `happinessDecayAccumulator` on [`PetStateDocument`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/domain/types.ts).
- **Unit Scale:** 1 vitals point = $1,000,000\text{ micro-units}$ ($10^{-6}$ decimal precision).
- **Rounding Rule:**
  $$\text{accumulator}_{\text{next}} = \frac{\text{round}(\text{remainder} \times 1,000,000)}{1,000,000}$$
  If $\text{accumulator}_{\text{next}} \ge 1.0$, it is clamped to $0.999999$.

### 3.2 Exact Arithmetic Lifecycle
For an interval with $S$ elapsed seconds and active accumulator $A_{\text{current}}$:

1. **Calculate Total Decay Units:**
   $$U = S \times 0.0001 + A_{\text{current}}$$
2. **Integer Decay Application:**
   $$\Delta_{\text{integer}} = \lfloor U \rfloor$$
3. **Remainder Preservation:**
   $$R = U - \Delta_{\text{integer}}$$
   $$A_{\text{next}} = \frac{\text{round}(R \times 1,000,000)}{1,000,000}$$
4. **Vitals Subtraction (Above Ethical Floor):**
   $$V_{\text{next}} = V_{\text{current}} - \Delta_{\text{integer}}$$
   $$\Delta_{\text{decayed}} = \Delta_{\text{integer}}$$

---

## 4. Ethical Floor Behavior

The ethical floors defined in Phase 1 ([`constants.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/domain/constants.ts)) are strictly preserved:
- $\text{Hunger} \ge 20$ (ethical non-starvation bound)
- $\text{Happiness} \ge 40$ (ethical non-depression bound)

### 4.1 Floor Suppression Rules
1. **Vital Already at Floor:**
   - If $V_{\text{current}} \le \text{Floor}$, no further decay is applied ($\Delta_{\text{decayed}} = 0$).
   - The decay accumulator is clamped to 0 ($A_{\text{next}} = 0$). Fractional decay is not permitted to accumulate below the floor.
2. **Vital Reaches Floor During Interval:**
   - If $V_{\text{current}} - \Delta_{\text{integer}} \le \text{Floor}$, the vital clamps at the floor ($V_{\text{next}} = \text{Floor}$).
   - The applied loss is bounded by the distance to the floor: $\Delta_{\text{decayed}} = V_{\text{current}} - \text{Floor}$.
   - The accumulator is reset to 0 ($A_{\text{next}} = 0$). Any residual decay that would have dropped the stat below the floor is safely discarded.
3. **Care Action Above Floor:**
   - When a care action (e.g. Feed, Pet) raises a vital from its floor (e.g. Hunger $20 \to 44$), future elapsed time begins accumulating decay from 0 normally. It **never** retroactively consumes previously suppressed decay.
4. **Accumulator Independence:**
   - Hunger and happiness accumulators operate completely independently. A pet at happiness floor ($40$) with accumulator $0$ will continue accumulating hunger decay normally if hunger is above its floor ($70 \to 0.36\text{ acc}$).

---

## 5. Care-Action Integration

In [`careTransitions.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/transitions/careTransitions.ts#L178):
1. **Preservation Across Interactions:** When a care action executes, the pre-simulated fractional accumulators are preserved on `nextPetState` unless the action or simulation left the vital at/below floor.
2. **Atomic Ledger Parity:** Both accumulators are serialized into `pet/state/pet.json` under exclusive `.pet-lock` protection and verified against CAS generation counters.
3. **Rejected Actions:** Rejections (e.g. full satiety, insufficient energy) do not modify vitals or accumulators, maintaining complete transaction rollback semantics.

---

## 6. Required Deterministic Tests & Results

All 15 required scenarios from Section 6 were implemented in [`simulation.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/simulation.test.ts#L1000-L1430):

| Test ID | Scenario | Pattern & Verification | Outcome |
| :--- | :--- | :--- | :--- |
| **TC-CONSERV-32** | 1 Uninterrupted 24h | $1 \times 86,400\text{s} \to$ hunger: $100 \to 92$, acc: $0.64$; happiness: $100 \to 92$, acc: $0.64$ | **PASS** |
| **TC-CONSERV-33** | 24 Consecutive 1h Runs | $24 \times 3,600\text{s} \to$ hunger: $100 \to 92$, acc: $0.64$; happiness: $100 \to 92$, acc: $0.64$ (100% identical to 32) | **PASS** |
| **TC-CONSERV-34** | 2 Consecutive 12h Runs | $2 \times 43,200\text{s} \to$ Int 1: vitals 96, acc 0.32; Int 2: vitals 92, acc 0.64 (100% identical to 32 & 33) | **PASS** |
| **TC-CONSERV-35** | 48 Consecutive 1h Runs | $48 \times 3,600\text{s} \to$ vitals: $100 \to 83$, acc: $0.28$ (matches $172,800\text{s} \times 0.0001 = 17.28$) | **PASS** |
| **TC-CONSERV-36** | Irregular Intervals (Sum=24h) | $3.5\text{h} + 7.25\text{h} + 1.25\text{h} + 12\text{h} = 24\text{h} \to$ vitals: $92$, acc: $0.64$ (exact match) | **PASS** |
| **TC-CONSERV-37** | Identical Timestamps | Repeated simulation at $t_0 \to$ `simulated: false`, vitals and accumulators 100% unchanged | **PASS** |
| **TC-CONSERV-38** | Process Restart Between Intervals | Re-reading repository state from disk between runs preserves $0.36 \to 0.72$ accumulation | **PASS** |
| **TC-CONSERV-39** | Journal Crash Recovery | Interrupted journal write recovers pre-crash state cleanly without losing or duplicating accumulators | **PASS** |
| **TC-CONSERV-40** | Hunger Reaches Floor | Hunger $22 \to 20$ (floor), residual decay discarded, accumulator safely resets to $0$ | **PASS** |
| **TC-CONSERV-41** | Happiness Reaches Floor | Happiness $42 \to 40$ (floor), residual decay discarded, accumulator safely resets to $0$ | **PASS** |
| **TC-CONSERV-42** | Care Action Raises Hunger | Hunger at $20$ + Feed $\to 44$; subsequent 1h accumulates from $0$ to $0.36$ without suppressed decay | **PASS** |
| **TC-CONSERV-43** | Care Action Raises Happiness | Happiness at $40$ + Pet $\to 52$; subsequent 1h accumulates from $0$ to $0.36$ without suppressed decay | **PASS** |
| **TC-CONSERV-44** | Accumulators Independent | Hunger above floor ($70 \to 0.36\text{ acc}$) while happiness at floor ($40 \to 0\text{ acc}$) remain decoupled | **PASS** |
| **TC-CONSERV-45** | Delayed Scheduled Run | $2.5\text{h}$ delay ($0.90$) $+ 1\text{h}$ run ($0.36$) $= 1.26 \to 1\text{ integer decay}$, $0.26\text{ acc}$ | **PASS** |
| **TC-CONSERV-46** | Care Action Integration | $1\text{h}$ simulation ($0.36\text{ acc}$) followed by Train; Train preserves $0.36\text{ acc}$; next 1h adds $0.36 \to 0.72$ | **PASS** |

---

## 7. Workflow Compatibility Verification

The scheduled publication and simulation workflow ([`.github/workflows/pet-publisher.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-publisher.yml)) was inspected and verified:
- **Cadence Preserved:** `cron: '47 * * * *'` remains unchanged.
- **Concurrency Group:** `group: pet-runtime-${{ github.repository }}` with `cancel-in-progress: false` preserved.
- **Workflow Architecture:** No second simulation workflow added; the existing hourly run safely and deterministically processes fractional decay.

---

## 8. Verification Results

- **`npm run test:pet-engine`:** 10 suites, 184 tests passed, 0 failed.
- **`npm run test:all`:** 34 suites, 305 tests passed, 0 failed.
- **`npm run lint`:** 0 errors, 0 warnings.
- **`npx tsc --noEmit`:** 0 errors.
- **`npm run build`:** Production Next.js build completed in Turbopack.
- **`npm run simulate:pet -- --dry-run`:** Success (`STATUS: ADVANCED`, elapsed 125,819s, decay 12, accumulator $0.5819$).
- **`npm run process:inbox`:** Success (`STATUS: Drained=true`).

---

## 9. Files Modified

1. [`src/features/pet-engine/domain/types.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/domain/types.ts): Added `hungerDecayAccumulator?: number` and `happinessDecayAccumulator?: number` to `PetStateDocument`.
2. [`pet/schemas/pet.schema.json`](file:///D:/Projects/GitHub-Profile-Pet/pet/schemas/pet.schema.json): Added `hungerDecayAccumulator` and `happinessDecayAccumulator` schemas ($[0, 1]$ range).
3. [`pet/state/pet.json`](file:///D:/Projects/GitHub-Profile-Pet/pet/state/pet.json): Added initial zero accumulators to canonical seed.
4. [`src/features/pet-engine/validation/stateValidator.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/validation/stateValidator.ts): Added type and range validation for both decay accumulators.
5. [`src/features/pet-engine/transitions/simulationTransitions.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/transitions/simulationTransitions.ts): Implemented fractional decay accumulation, floor suppression, and micro-point rounding.
6. [`src/features/pet-engine/transitions/careTransitions.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/transitions/careTransitions.ts): Preserved decay accumulators across care interactions.
7. [`src/features/pet-engine/simulation/types.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/simulation/types.ts) & [`simulationService.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/simulation/simulationService.ts): Added accumulator telemetry before/after simulation.
8. [`scripts/simulate-pet.ts`](file:///D:/Projects/GitHub-Profile-Pet/scripts/simulate-pet.ts): Enhanced CLI console logs with hunger/happiness accumulator progression.
9. [`tests/pet-engine/simulation.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/simulation.test.ts): Added Tests 32–46 covering all 15 required deterministic scenarios.

---

## 10. Scope Boundaries

- **Phase 3C1.1.2 Scope:** Confined strictly to fractional decay conservation and scheduled simulation accuracy.
- **Phase 3C2 (Contribution Sync):** Out of scope; not initiated.
- **Git State:** Clean working copy; 0 git commits or remote pushes created.
- **Self-Hosted Model:** 100% self-hosted on GitHub Actions with zero server or external hosting costs.
