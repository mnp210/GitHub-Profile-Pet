# Phase 3C1.1 — Checkpoint Integration & Recovery Hardening Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Milestone:** Phase 3C1.1  
**Status:** Completed & Verified  
**Date:** 2026-11-16  

---

## 1. Executive Summary

Phase 3C1.1 resolves the critical checkpoint synchronization and corruption vulnerabilities identified in the passive simulation subsystem. Specifically, it eliminates desynchronization risks between scheduled passive simulation and user-triggered care actions, establishes a strict fail-closed recovery model for corrupted or non-UTC checkpoints, and clarifies the welcome-back bonus mechanics.

All 15 required test scenarios from the specification—alongside 5 invariant regression tests—have been implemented and passed with 100% pass rates across the test suite (279 passing tests across 34 suites, 0 failures, 0 lint warnings, and clean Next.js/Turbopack builds).

---

## 2. Care-Action Transaction Ordering & Integration

### 2.1 The Race Condition & Desynchronization Risk
Prior to Phase 3C1.1, user care actions (Feed, Train, Rest, Pet) executed directly against the on-disk pet state without first evaluating the time elapsed since the last simulation checkpoint (`lastSimulatedAt`). If a pet was offline for 8 hours and the user then performed a Feed action:
1. Without simulation pre-processing, hunger would not have experienced the 8-hour decay prior to feeding, potentially hitting satiety caps prematurely or skipping hunger transitions.
2. Worse, if the care action stamped `lastSimulatedAt = nowUtc`, the accumulated 8 hours of passive simulation, energy regeneration, and hunger/happiness decay would be permanently and silently lost.

### 2.2 Authoritative 9-Step Transaction Order
To resolve this, both the action inbox processor ([`actionProcessor.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/inbox/actionProcessor.ts)) and the unified transaction runner ([`executeCareActionTransaction`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/inbox/actionProcessor.ts#L484)) enforce the following strict 9-step atomic sequence:

1. **Acquire Repository Lock:**
   Acquires the exclusive directory lock (`.pet-lock`) using `acquireLock(paths.lockPath)`. If held by an active running process, execution fails fast with `ConcurrencyLockError`.
2. **Recover Interrupted Journal:**
   Executes `recoverRepositoryState(baseDir, { lockOwnerId })` to replay or cleanly roll back any partial or interrupted journal files (`.pet-journal.json`).
3. **Load and Validate Authoritative State:**
   Loads and validates the pet state document, action ledger, and contribution ledger via `loadRepositoryState(baseDir, { lockOwnerId })`.
4. **Capture Single Operation Timestamp:**
   Captures one immutable UTC timestamp for the operation (`capturedUtcTimestamp`). For GitHub issue interactions, this is the issue's ISO 8601 creation timestamp; for manual invocations, it is `new Date().toISOString()`.
5. **Calculate Elapsed Time from Durable Checkpoint:**
   Resolves the active simulation checkpoint via `resolveSimulationCheckpoint(state.pet, capturedTimestampMs)`. Determines the exact seconds elapsed since the last checkpoint.
6. **Apply Passive Simulation Transitions:**
   Applies the authoritative `applyInactivitySimulation(state.pet, capturedTimestampMs)` simulation transitions to advance hunger/happiness decay, fractional energy accumulator recovery, and status transitions up to the exact moment of the care action.
7. **Apply Requested Care Action to Simulated State:**
   Executes `executeCareAction(simulatedPet, action, { ... })` using the simulated pet as the base state.
   - **If Care Action Succeeds:** Proceeds to Step 8.
   - **If Care Action is Rejected:** (e.g., full satiety, insufficient energy):
     - `state.pet` is **NOT mutated**.
     - Checkpoint is **NOT advanced independently**.
     - Rejected action semantics and cooldowns are preserved without committing simulation.
8. **Persist Resulting State Atomically:**
   Persists the combined state (including updated `lastSimulatedAt`, vitals, XP, level, action ledger, and incremented generation counter) using `saveRepositoryState(baseDir, combinedState, { existingLock })`.
9. **Release Repository Lock:**
   Releases the `.pet-lock` in the `finally` block via `releaseLock()`.

---

## 3. Checkpoint Fallback & Corruption Policy

The checkpoint resolution logic in [`simulationCheckpoint.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/simulation/simulationCheckpoint.ts) implements a strict, tamper-resistant hierarchy:

### 3.1 Strict UTC ISO Validation
All candidate timestamps must satisfy `isValidUtcIsoDateString(val)`. A valid timestamp must:
- Be a non-empty string.
- Contain explicit UTC designators (`Z`, `+00:00`, or `-00:00`).
- Parse successfully into a non-NaN timestamp via `Date.parse()`.
- Successfully re-emit into identical UTC ISO representation. Local or ambiguous strings lacking timezone designators (e.g., `2026-11-16T12:00:00`) are rejected immediately.

### 3.2 Precedence Order & Fallback Matrix
1. **Primary Checkpoint:** `state.pet.lastSimulatedAt` (if valid UTC ISO date).
2. **Legacy Fallback 1:** `state.pet.lastOfflineResolutionTime` (if valid UTC ISO date).
3. **Legacy Fallback 2:** `state.pet.updatedAt` (if valid UTC ISO date).

### 3.3 New Installation Policy
A pet state is classified as a new installation (`isNewInstallation(pet)`) if and only if:
- `pet.createdAt === pet.updatedAt`, AND
- `pet.experience === 0`, AND
- `pet.level === 1`, AND
- `pet.evolutionStage === 'Hatchling'`.

For new installations without a prior simulation checkpoint, the checkpoint is safely initialized to `nowMs` with **0 seconds elapsed time**. No passive decay is applied on first boot.

### 3.4 Corrupted Checkpoint Policy (Fail-Closed)
If an existing, non-new installation lacks all three valid candidate timestamps, or contains corrupted non-UTC dates without a trustworthy fallback:
- **Strict Fail-Closed:** The system throws a structured `CorruptedCheckpointError`.
- **Zero Inventions:** It **never** silently replaces corrupted timestamps with `nowMs` or invents artificial estimates.
- **State Preservation:** On-disk pet state is preserved unmutated to enable manual or administrative audit without compounding corruption.

### 3.5 Clock Regression Handling
If the system clock reports a timestamp earlier than the durable checkpoint (`nowMs < checkpointMs`):
- Elapsed seconds are safely clamped to `0`.
- No vitals decay or accumulator changes are applied.
- The durable checkpoint is **never rewound**.

---

## 4. Welcome-Back Bonus Clarification

The Phase 1 simulation engine calculates `welcomeBackBonusEligible: boolean` as an informational flag within `InactivitySimulationResult`.
- It indicates whether the pet was offline longer than the inactivity threshold (24 hours).
- **Authoritative Behavior:** In accordance with the Phase 1 pet engine design, calculating eligibility does **not** grant bonus items or automatically modify pet vitals upon simulation. The pet-engine invariants are preserved intact without introducing unauthorized side-effects.

---

## 5. Verification & Test Suite

The test suite in [`simulation.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/simulation.test.ts) was expanded to thoroughly cover all 15 required scenarios from Section 4 of the specification:

| Test ID | Test Scenario | Outcome | Description |
| :--- | :--- | :--- | :--- |
| **TC-HARDEN-01** | 8h offline followed by Feed | **PASS** | Simulates 8h decay (-12 hunger, -12 happiness), then executes Feed (+24 hunger, +10 XP, +4 happiness). Final state reflects both atomically. |
| **TC-HARDEN-02** | 8h offline followed by Train | **PASS** | Simulates 8h decay (-12 hunger, -12 happiness), then executes Train (-20 energy, +4 happiness, +30 XP). Final state reflects both atomically. |
| **TC-HARDEN-03** | 8h offline followed by Rest | **PASS** | Simulates 8h decay and energy recovery up to cap (100), then executes Rest. Final state reflects both atomically. |
| **TC-HARDEN-04** | 8h offline followed by Pet | **PASS** | Simulates 8h decay, then executes Pet (+12 happiness, +6 XP). Final state reflects both atomically. |
| **TC-HARDEN-05** | Multiple care actions at same timestamp | **PASS** | First action processes 4h simulation + Feed. Second action at same timestamp sees 0s elapsed, applying only Pet without double decay. |
| **TC-HARDEN-06** | Care action interrupted before commit | **PASS** | Simulated crash during action execution prior to journal commit. Recovery on next run restores original state without corruption. |
| **TC-HARDEN-07** | Care action interrupted after commit | **PASS** | Interruption after journal write before final rename. Recovery cleans up journal safely without corrupting primary repository state. |
| **TC-HARDEN-08** | Duplicate action delivery after recovery | **PASS** | Processed issue processed once; second scanner execution detects duplicate via `action_ledger.json` and skips execution. |
| **TC-HARDEN-09** | Missing checkpoint in new installation | **PASS** | New pet (Hatchling, 0 XP, created=updated) safely initializes checkpoint to `nowMs` with 0 elapsed seconds. |
| **TC-HARDEN-10** | Missing checkpoint in existing installation | **PASS** | Existing pet with missing `lastSimulatedAt` safely falls back to valid `lastOfflineResolutionTime` / `updatedAt`. |
| **TC-HARDEN-11** | Corrupted checkpoint with valid legacy fallback | **PASS** | Malformed non-UTC string in `lastSimulatedAt` falls back to valid UTC `lastOfflineResolutionTime`. |
| **TC-HARDEN-12** | Corrupted checkpoint without valid fallback | **PASS** | Malformed strings across all fields throw structured `CorruptedCheckpointError` without mutating state on disk. |
| **TC-HARDEN-13** | Clock regression | **PASS** | System clock behind checkpoint returns 0 elapsed seconds, zero mutations, and leaves checkpoint unrewound. |
| **TC-HARDEN-14** | Concurrent simulation and care-action execution | **PASS** | Both operations contend on `.pet-lock`. First succeeds; second fails fast with `ConcurrencyLockError` without corrupting state. |
| **TC-HARDEN-15** | Repeated execution after successful care action | **PASS** | Consecutive executions with zero elapsed time return `STATUS: UNCHANGED`, avoiding redundant writes. |

### Complete Test Results
- **Pet Engine Test Suite:** 10 suites, 158 tests passed, 0 failed.
- **Full Repository Test Suite:** 34 suites, 279 tests passed, 0 failed.
- **Static Analysis (`eslint`):** Clean (0 errors, 0 warnings).
- **TypeScript Verification (`tsc`):** Clean (0 type errors).
- **Next.js Production Build (`next build`):** Clean build completed in Turbopack.
- **CLI Commands:**
  - `npm run simulate:pet -- --dry-run`: Successful dry run execution (advanced state preview without disk writes).
  - `npm run process:inbox`: Successful queue drain execution (gracefully handles absence of GitHub token in local environment).
  - `npm run publish:pet`: Successful publication run, rendering pet and leaving README embed in sync.

---

## 6. Files Modified

1. [`src/features/pet-engine/persistence/stateRepository.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/persistence/stateRepository.ts):
   - Added `existingLock?: LockReleaseFn` to `SaveStateOptions` to allow caller to hold lock across simulation + action pipeline without release/re-acquire race windows.
   - Forwarded `RecoverOptions` through `loadRepositoryState` to allow lock owner to bypass self-concurrency checks.
2. [`src/features/pet-engine/simulation/simulationCheckpoint.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/simulation/simulationCheckpoint.ts):
   - Implemented `CorruptedCheckpointError` structured error class.
   - Implemented `isValidUtcIsoDateString` with strict UTC validation.
   - Implemented `isNewInstallation` detection heuristic.
   - Updated `resolveSimulationCheckpoint` with fail-closed behavior for corrupt existing state.
3. [`src/features/pet-engine/inbox/actionProcessor.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/inbox/actionProcessor.ts):
   - Integrated passive simulation into Case F of `processInbox` prior to `executeCareAction`.
   - Preserved rejected-action semantics (no state mutation, no checkpoint advance).
   - Implemented and exported `executeCareActionTransaction` encapsulating the 9-step atomic sequence.
4. [`src/features/pet-engine/simulation/simulationService.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/simulation/simulationService.ts):
   - Added lock acquisition and owner ID propagation to non-dry-run simulation runs.
5. [`tests/pet-engine/simulation.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/simulation.test.ts):
   - Implemented all 15 required Section 4 test cases plus regression coverage.
6. [`tests/pet-engine/inboxProcessing.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/inboxProcessing.test.ts):
   - Adjusted mock issue timestamps in integration tests to align with sample state timestamps.

---

## 7. Scope Boundaries & Remaining Limitations

- **Phase 3C1.1 Scope:** Confined strictly to checkpoint integration, race condition prevention, and recovery hardening.
- **Phase 3C2 (Contribution Sync):** Out of scope for this milestone; not started.
- **Git State:** Clean working copy; no git commits or remote pushes created.
- **Self-Hosted Guarantee:** Completely preserved; 100% self-hosted on GitHub Actions with zero centralized servers or external subscription costs.
