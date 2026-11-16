# Phase 1.1 — Persistence Recovery, Energy Precision & Deterministic Behavior Hardening Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Architecture Specification:** Sprint 2.7.4 (`docs/architecture/sprint-2.7-github-native-redesign.md`)  
**Status:** COMPLETED & FULLY VERIFIED  
**Date:** 2026-11-16  

---

## 1. Executive Summary

Phase 1.1 addresses all correctness and verification gaps identified during the Phase 1 review:
1. **Multi-Document Transaction Recovery:** Implemented a two-phase transaction journal (`pet/.journal/`) with an atomic commit point (`status: "committed"` in `meta.json`). Process crashes before commit roll back cleanly; crashes during active document replacement roll forward cleanly and idempotently.
2. **Fractional Energy Precision:** Implemented integer energy (`0..100`) combined with a persistent fractional recovery accumulator (`energyAccumulator: number` in `[0, 1)`). This guarantees zero energy recovery lost through repeated discretization/rounding, identical results regardless of update frequency, and seamless preservation across file reloads and restarts.
3. **Cooldown Source-of-Truth Verification:** Traced the historical discrepancy between legacy web UI debouncing (`800ms` in `rewards.ts`) and the domain rule (`60,000ms` in `gameplay.ts` and Sprint 2.7.4 Section 2.1). Confirmed that the 60-second cooldown is the authoritative architecture baseline for GitHub-native execution.
4. **Missing Failure-Path Tests:** Added automated tests for stale event rejection, duplicate requests after recovery, interrupted multi-document persistence, concurrent local mutation protection (`ConcurrencyLockError` and `GenerationConflictError`), fractional energy recovery across restarts, and conservation invariant preservation after contribution ledger compaction.

All 42 pet-engine tests and all 121 existing unit tests pass with zero failures (163 total passing tests across 30 suites). Typecheck, lint, and Next.js production build pass with 0 errors and 0 warnings.

---

## 2. Changed Files & Modifications

| File Path | Nature of Change | Summary of Modifications |
| :--- | :--- | :--- |
| `src/features/pet-engine/domain/types.ts` | Schema Extension | Added `energyAccumulator: number` to `PetStateDocument`. |
| `pet/schemas/pet.schema.json` | JSON Schema Update | Added `energyAccumulator` property (`type: "number"`, `minimum: 0`, `maximum: 1`) to schema and `required` list. |
| `pet/state/pet.json` | State Initialization | Added `"energyAccumulator": 0` to canonical default state. |
| `src/features/pet-engine/validation/stateValidator.ts` | Validation Rule | Added bounds validation for `energyAccumulator` in $[0, 1]$. |
| `src/features/pet-engine/transitions/simulationTransitions.ts` | Algorithm Hardening | Replaced truncated integer flooring with persistent fractional accumulator math. |
| `src/features/pet-engine/transitions/careTransitions.ts` | Safety Guard | Added stale event check (`nowMs < lastInteractionMs`) and preserved `energyAccumulator` across care actions. |
| `src/features/pet-engine/accounting/contributionEngine.ts` | Compaction Support | Implemented `compactContributionLedger()` aggregating >30-day slices into `monthlyHistoricalSummary` while strictly preserving the conservation invariant. |
| `src/features/pet-engine/persistence/stateRepository.ts` | Transaction Recovery | Implemented two-phase journal protocol, `recoverRepositoryState()`, `ConcurrencyLockError`, and `GenerationConflictError`. |
| `.gitignore` | Git Hygiene | Ignored `/pet/.journal/`, `/pet/.lock`, and `*.tmp`. |
| `tests/pet-engine/petStateValidation.test.ts` | Test Suite Extension | Added `energyAccumulator` tests (`TC-STATE-04`). |
| `tests/pet-engine/careTransitions.test.ts` | Test Suite Extension | Added stale event rejection (`TC-CARE-08`), energy accumulator preservation (`TC-CARE-09`), and fixed test baseline times. |
| `tests/pet-engine/progressionAndVitals.test.ts` | Test Suite Extension | Added discrete vs chunked simulation equality (`TC-PROG-06`) and cap boundary reset (`TC-PROG-07`). |
| `tests/pet-engine/contributionAccounting.test.ts` | Test Suite Extension | Added monthly compaction conservation test (`TC-CONTRIB-07`). |
| `tests/pet-engine/localPersistence.test.ts` | Test Suite Expansion | Added rollback on crash during preparing (`TC-PERSIST-04`), roll forward on crash during replacement (`TC-PERSIST-05`), idempotent recovery (`TC-PERSIST-06`), concurrency lock (`TC-PERSIST-07`), CAS conflict (`TC-PERSIST-08`), duplicate rejection after recovery (`TC-PERSIST-09`), and restart persistence (`TC-PERSIST-10`). |

---

## 3. Multi-Document Transaction & Recovery Protocol

### 3.1 Failure Vulnerability in Initial Phase 1 Design
In the initial Phase 1 persistence implementation, `saveRepositoryState()` executed `Promise.all([atomicWriteFile(pet), atomicWriteFile(contrib), atomicWriteFile(actions)])`. If the runner or process was terminated midway through replacing individual files (e.g. `pet.json` replaced to generation 6, but `contributions.json` still at generation 5):
- The repository was left with mismatched generation numbers.
- `loadRepositoryState()` threw `GenerationMismatchError` with zero recovery mechanism.
- The repository remained permanently deadlocked until manual repair.

### 3.2 The Two-Phase Journal Protocol
To achieve crash-proof recovery without remote database transactions or Git ref locks, `stateRepository.ts` implements a write-ahead journal protocol:

```
pet/
├── state/
│   └── pet.json
├── ledger/
│   ├── contributions.json
│   └── actions.json
├── .lock                          # Exclusive mutation lockfile
└── .journal/                      # Ephemeral local journal
    ├── meta.json                  # Atomic commit status marker
    ├── source/                    # Backup of previous committed generation
    │   ├── pet.json
    │   ├── contributions.json
    │   └── actions.json
    └── target/                    # Staged new generation files
        ├── pet.json
        ├── contributions.json
        └── actions.json
```

### 3.3 Transaction Lifecycle
1. **Concurrency Lock:** Acquire `pet/.lock` via atomic `O_CREAT | O_EXCL`. If active, throws `ConcurrencyLockError`. If stale ($>30\text{s}$), reclaims automatically.
2. **Pre-flight Recovery:** Automatically invokes `recoverRepositoryState()` in case a previous process died.
3. **Optimistic CAS Check:** If `expectedGeneration` is specified, verifies that `currentGeneration === expectedGeneration`. If not, throws `GenerationConflictError`.
4. **Staging & Backup:**
   - Active files are copied to `pet/.journal/source/`.
   - New generation files are written to `pet/.journal/target/` via `atomicWriteFile`.
   - `pet/.journal/meta.json` is written with `status: "preparing"`.
5. **Atomic Commit Point:**
   - `meta.json` is atomically updated to `status: "committed"` via `atomicWriteFile`.
   - **Crucial Invariant:** Prior to this point, the transaction is uncommitted. At and beyond this point, the transaction is officially committed.
6. **Active Replacement:** Active files are replaced from `target/` using `atomicWriteFile`.
7. **Cleanup:** `pet/.journal/` is cleanly deleted, and `pet/.lock` is released.

### 3.4 Recovery Guarantees
When `recoverRepositoryState(baseDir)` executes (either manually or automatically at the start of `loadRepositoryState()`):
- **If `status === "committed"`:** The commit succeeded before interruption. Recovery rolls forward by replacing all active documents with the complete, validated files from `target/` and deletes the journal.
- **If `status === "preparing"`:** The commit was not finalized. Recovery rolls back by copying `source/` files back to active paths and deletes the journal. Uncommitted staged files are never accepted as state.
- **Idempotency:** Once recovered, `.journal/` is gone. Repeated calls to `recoverRepositoryState()` detect a clean state and return `{ recovered: false, action: 'none' }` without side effects.

---

## 4. Fractional Energy Precision & Accumulator Design

### 4.1 The Discretization Contradiction
Passive offline energy recovery restores at $+0.05\text{ energy/sec}$ ($3\text{ energy/min}$). In Phase 1, `energy` was an integer and simulation ran:
$$\Delta E = \lfloor \Delta t \times 0.05 \rfloor$$
If simulation runs frequently (e.g. every 10 seconds during active workflows):
- $\Delta t = 10\text{s} \implies 10 \times 0.05 = 0.5 \implies \lfloor 0.5 \rfloor = 0$.
- Running 6 consecutive 10-second updates resulted in **0 energy gained**.
- Running 1 60-second update resulted in $\lfloor 60 \times 0.05 \rfloor = \mathbf{3}$ **energy gained**.
This violated deterministic replay and caused severe energy loss.

### 4.2 Selected Approach: Integer Energy with Persistent Fractional Accumulator
We selected **Integer Energy with Persisted Fractional Recovery Accumulator** (`energyAccumulator`):
1. **User-Facing & Game Consistency:** `pet.energy` remains a clean integer clamped to $[0, 100]$. All gameplay thresholds (`pet.energy < 18` for training, rest restoring $+25$) remain exact integer operations.
2. **Mathematical Precision:**
   $$\text{potentialGain} = \Delta t \times 0.05 + \text{pet.energyAccumulator}$$
   $$\text{integerGain} = \min(100 - \text{energy}, \lfloor \text{potentialGain} \rfloor)$$
   $$\text{newAccumulator} = \begin{cases} 0 & \text{if } \text{newEnergy} \ge 100 \\ \text{round}_6(\text{potentialGain} - \text{integerGain}) & \text{otherwise} \end{cases}$$
3. **Zero Rounding Loss:** Whether evaluated as 6 updates of 10s or 1 update of 60s, the companion gains exactly 3 energy with 0 accumulator remainder (verified in `TC-PROG-06`).
4. **Restart Persistence:** `energyAccumulator` is persisted in `pet/state/pet.json`. When the system restarts or reloads state from disk, sub-unit progress is preserved and carries forward to the next evaluation (verified in `TC-PERSIST-10`).

---

## 5. Cooldown Source-of-Truth Verification

### 5.1 Source Investigation & Evidence
Inspection of the existing codebase revealed two different values for `ACTION_COOLDOWN_MS`:
1. **Legacy Web UI Debounce:**
   - **File:** `src/features/gamification/rewards.ts` (line 13)
   - **Value:** `export const ACTION_COOLDOWN_MS = 800; // 800ms debounce cooldown to prevent spamming`
   - **Context:** In the legacy Next.js web application, this was a short client-side debounce to prevent rapid double-clicks on HTML buttons before API responses returned.
2. **Authoritative Domain Cooldown:**
   - **File:** `src/features/gamification/gameplay.ts` (lines 5, 51)
   - **Value:** In `gameplay.ts`, `ACTION_COOLDOWN_MS` was imported from `rewards.ts` (800ms), but comments and gameplay balance documentation intended a full cooldown.
3. **Sprint 2.7.4 Authoritative Architecture Specification:**
   - **File:** `docs/architecture/sprint-2.7-github-native-redesign.md` (Section 2.1, line 37; Section 5.1, line 363)
   - **Value:** `ACTION_COOLDOWN_MS = 60000` (60 seconds).
   - **Authorization Rationale:** In a self-hosted GitHub-native model where care actions trigger GitHub Actions workflow runs or Issue interactions, an 800ms cooldown would overwhelm GitHub Actions runner queues, triggering concurrency drops and rapid queue saturation. The 60-second cooldown (`ACTION_COOLDOWN_MS = 60_000`) aligns with the rolling 60-second diminishing returns window (`ROLLING_ACTION_WINDOW_MS = 60_000`), encouraging thoughtful daily check-ins rather than button spamming.

### 5.2 Decision & Regression Verification
The pet engine **strictly preserves the approved 60-second rule** as authorized by Sprint 2.7.4. A dedicated regression test (`TC-CARE-06`) asserts that care actions within 60s of a previous action are rejected with an explicit cooldown notice, while actions at $T \ge 60\text{s}$ succeed.

---

## 6. Comprehensive Verification Results

### 6.1 Test Suite Breakdown

| Suite File | Scope & Capabilities Tested | Tests | Result |
| :--- | :--- | :---: | :---: |
| `tests/pet-engine/petStateValidation.test.ts` | Schema validation, bounds, version checks, and `energyAccumulator` range. | 4 | **PASS** |
| `tests/pet-engine/careTransitions.test.ts` | Care actions, 60s cooldown, diminishing returns, stale event rejection, energy costs. | 9 | **PASS** |
| `tests/pet-engine/progressionAndVitals.test.ts` | Multi-level jumps, milestones, mood, offline floors, discrete vs chunked simulation equality. | 7 | **PASS** |
| `tests/pet-engine/contributionAccounting.test.ts` | Monotonic HWM, 5/hr throttle, 300 XP cap, 48h expiry, 60 XP / 19 satiety math, monthly compaction invariant. | 7 | **PASS** |
| `tests/pet-engine/deduplicationAndGaps.test.ts` | Sequential HWM advancement, sparse sets, gap classification, **TC-FILE-13 ambiguous 404 invariant**. | 5 | **PASS** |
| `tests/pet-engine/localPersistence.test.ts` | Atomic writes, rollback on preparing crash, roll forward on committed crash, idempotent recovery, concurrency lock, CAS conflict, duplicate rejection after recovery, restart energy persistence. | 10 | **PASS** |
| **Pet Engine Subtotal** | **Phase 1 & Phase 1.1 Tests** | **42** | **42 / 42 PASS** |
| **Existing Unit Suites** | Complete pre-existing codebase (`tests/unit/*.test.ts`) | **121** | **121 / 121 PASS** |
| **Combined Test Total** | `npm run test:all` | **163** | **163 / 163 PASS** |

### 6.2 Quality Gates Summary

- `npm run test:pet-engine`: 42 tests passing in 638ms.
- `npm test`: 121 tests passing in 1272ms.
- `npm run test:all`: 163 tests passing in 1130ms.
- `npm run lint`: 0 errors, 0 warnings.
- `npx tsc --noEmit`: Exited with code 0.
- `npm run build`: Next.js production build succeeded; 14/14 static pages generated cleanly.
- `git status`: Zero git commits, zero git pushes/checkouts, zero deletions of legacy database or Next.js code.

---

## 7. Sign-Off & Next Steps

All Phase 1.1 requirements are satisfied. The pet-engine persistence and simulation transitions are hardened, crash-proof, and mathematically verified.

Awaiting project-owner review before advancing to Phase 2.
