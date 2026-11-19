# Phase 3C2.3-B2-R3.38 — Fresh-Fork Onboarding Remediation, Transactional Baseline Repair & Regression Verification

**Milestone:** R3.38  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `phase-3c2-3-b2-r3-38-onboarding-remediation`  
**Base Commit:** `0a6d08448220be11cd54ccf6cb2d35f560b1cc69` (`origin/main`)  
**Candidate Commits:**
- `ab5ab69b8fe7413f9667967dcdafae23e41676f8`: `fix(onboarding): remediate fresh-fork baseline reset, marker collision, and nullable timestamp schema`
- `232bc8bce72098e223a85ab345fdd6ab573537a2`: `fix(baseline): skip remote fence check when skipPush is true`  
**Isolated Test Repository:** `D:\Projects\GitHub-Profile-Pet-Test-Fork` (Branch: `test/fresh-fork-onboarding`)  
**Production Remote:** `https://github.com/mnp210/GitHub-Profile-Pet.git` (`origin/main`: `0a6d08448220be11cd54ccf6cb2d35f560b1cc69`) — **Completely untouched**  
**Final Verdict:** **PASS — READY FOR RELEASE REVIEW**

---

## 1. Executive Summary

Milestone R3.37 identified three Priority-1 onboarding defects preventing third-party users who fork the repository from successfully onboarding and operating their pets using standard GitHub workflows:
1. **P1-01:** Foreign-fork baseline reinitialization failed closed because `baselinePipeline.ts` executed `validatePristineInstallation()` against the inherited upstream state prior to performing the baseline reset.
2. **P1-02:** A README documentation example in Step 7 included literal operational marker strings (`<!-- START_SECTION:github-profile-pet -->`), creating duplicate marker pairs and causing `updateReadmeContent()` to throw `MalformedReadmeMarkersError` during SVG publication.
3. **P1-03:** The pristine template (`pet/templates/pet.template.json`) contains `null` timestamps (`lastInteractionTime`, `lastOfflineResolutionTime`, `lastSimulatedAt`, `updatedAt`) and `contributions.template.json` contains `ownerDatabaseId: null`, which were rejected by `stateValidator.ts` and `ledgerValidator.ts`.

Milestone R3.38 successfully remediates all three defects with zero weakening of security controls, concurrency locks, transaction journaling, or anti-wipe protections. Full end-to-end acceptance was verified on an isolated test fork repository simulating a realistic developer fork, followed by a comprehensive regression suite (121 unit tests, 536 pet-engine tests, 12 new onboarding regression tests, full Next.js production build, and ESLint).

---

## 2. Root Cause Analysis & Architectural Remediation

### 2.1 P1-01: Foreign-Fork Baseline Reinitialization & Transactional Reset
- **Defect:** In `baselinePipeline.ts`, step 2 of `executeBaselinePipeline()` called `validatePristineInstallation(baseDir)`. An inherited fork clone inevitably contains upstream state (`pet.json` at Gen 3, Level 1, 55 XP, 4 activity slices). Because `isPristineInstallation` evaluated to `false`, the pipeline immediately failed closed with `integrity_failed`, even when the caller explicitly supplied `--reinitialize-foreign-fork`.
- **Remediation:**
  1. Restructured `executeBaselinePipeline` to distinguish foreign-fork reinitialization from same-repo pristine initialization.
  2. For foreign owners with `reinitializeForeignFork: true`:
     - Fails closed immediately if an active `.lock` file exists or an uncommitted transaction journal `.journal` is detected.
     - Captures an in-memory byte snapshot of `pet.json`, `contributions.json`, and `actions.json` for atomic rollback.
     - Generates canonical pristine replacement documents bound strictly to the new owner (`rawExpectedDbId`, `targetOwnerLogin`, current UTC timestamp), Level 1, 0 XP, Hatchling.
     - Validates all generated documents in-memory via `assertValidPetState`, `assertValidActionLedger`, and `assertValidContributionLedger`.
     - Transactionally commits the pristine state using `saveRepositoryState()` (which writes atomic temporary files and renames under journal protection).
     - Validates post-reset pristine installation via `validatePristineInstallation(baseDir, { allowForeignBaseline: false, ... })`.
     - Executes `syncContributions()` to pull initial contribution history.
     - **Atomic Rollback Guarantee:** If `syncContributions` or any downstream verification step fails, `baselinePipeline` executes an immediate byte-for-byte rollback restoring `pet.json`, `contributions.json`, and `actions.json` to their pre-reset bytes, guaranteeing zero corrupt intermediate state.
  3. Short-circuited `remoteFenceCheck` when `skipPush: true`, enabling local dry-run / isolated branch verification without requiring remote origin pushes.

### 2.2 P1-02: README Profile Embed Marker Collision
- **Defect:** In `README.md`, Step 7 demonstrated how a user embeds their pet SVG into their personal profile README. The code fence example included the literal comment tags:
  ```markdown
  <!-- START_SECTION:github-profile-pet -->
  <!-- END_SECTION:github-profile-pet -->
  ```
  Because `updateReadmeContent()` searches `README.md` using `indexOf(README_MARKER_START)` and checks that the start and end markers occur exactly once, the existence of the documentation code block produced a marker count of 2, triggering `MalformedReadmeMarkersError: README contains multiple start markers`.
- **Remediation:**
  - Updated the Step 7 profile README example to use `<!-- START_SECTION:profile-pet -->` and `<!-- END_SECTION:profile-pet -->`.
  - The repository's operational marker remains `<!-- START_SECTION:github-profile-pet -->`, preserving complete backwards compatibility while eliminating any substring collision.
  - Added clarification in Step 4 regarding maintaining a clean working tree prior to baseline setup.

### 2.3 P1-03: Nullable Timestamp & Owner Schema Alignment
- **Defect:**
  - `pet/templates/pet.template.json` initializes `lastInteractionTime: null`, `lastOfflineResolutionTime: null`, `lastSimulatedAt: null`, and `updatedAt: null`.
  - `pet/templates/contributions.template.json` initializes `ownerDatabaseId: null` and `ownerLogin: null`.
  - `stateValidator.ts` rejected `null` for `lastOfflineResolutionTime` and `updatedAt`, requiring ISO-8601 strings.
  - `ledgerValidator.ts`'s `isPristineContributionLedger()` threw on `L.ownerDatabaseId === null` due to an unchecked truthiness check.
- **Remediation:**
  - Updated domain type definitions (`PetStateDocument`, `ContributionLedgerDocument`) to formalize nullable timestamps and owner fields.
  - In `stateValidator.ts`:
    - `lastInteractionTime` and `lastSimulatedAt` permit `null` across all lifecycle stages (representing events that have not yet occurred).
    - Unplayed hatchlings (`generation <= 1`, `level === 1`, `xp === 0`, `evolutionStage === 'Hatchling'`) permit `lastOfflineResolutionTime: null` and `updatedAt: null` (matching the pristine template).
    - Established pets (`level > 1`, `xp > 0`, `generation > 1`, or evolved forms) strictly require valid ISO-8601 UTC date strings for `lastOfflineResolutionTime` and `updatedAt`.
  - In `ledgerValidator.ts`: Guarded `isPristineContributionLedger()` to accept `ownerDatabaseId: null` and `ownerLogin: null`.
  - In `careTransitions.ts`: Safely guarded `lastInteractionMs = pet.lastInteractionTime ? new Date(pet.lastInteractionTime).getTime() : 0` so hatchlings with `null` interaction timestamps do not produce `NaN` or fail stale checks.

---

## 3. Verification of Invariants & Security Guardrails

| Guard / Invariant | Enforcement Mechanism | Verification Status |
| :--- | :--- | :--- |
| **Concurrency Lock Protection** | `baselinePipeline.ts` verifies `.lock` does not exist prior to reset | **VERIFIED** (Regression test `P1-01-D` passed) |
| **Transaction Journal Protection** | `baselinePipeline.ts` verifies `.journal` does not exist prior to reset | **VERIFIED** (Regression test `P1-01-E` passed) |
| **Anti-Wipe Guard** | Same owner cannot wipe their own established baseline via `--reinitialize-foreign-fork` | **VERIFIED** (Regression test `P1-01-C` & Acceptance Step 4 passed) |
| **Atomic Rollback** | In-memory byte snapshots restored on sync failure | **VERIFIED** (Regression test `P1-01-F` passed) |
| **Manifest Isolation (F-04)** | Working tree must contain only `pet.json`, `contributions.json`, `actions.json` | **VERIFIED** (Acceptance Step 3 commit `6b4c850` strictly contains 3 files) |
| **Schema Strictness** | Established pets strictly reject null clock timestamps | **VERIFIED** (Regression tests `P1-03-C`, `P1-03-D` passed) |
| **Marker Uniqueness** | Exactly one operational marker pair in repo README | **VERIFIED** (Regression tests `P1-02-A`, `P1-02-B` passed) |

---

## 4. Test Suite Execution & Quality Gates

All quality gates were executed in `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` and passed with zero errors or warnings:

### 4.1 TypeScript Verification
```
Command: npx tsc --noEmit
Exit Code: 0
Output: Clean (0 errors)
```

### 4.2 Unit Test Suite
```
Command: npm run test
Result: 121 / 121 passed (100%)
Duration: ~1.2s
Failures: 0
```

### 4.3 Pet Engine Test Suite
```
Command: npm run test:pet-engine
Result: 536 / 536 passed (100%)
Duration: 69.8s
Failures: 0
```

### 4.4 Dedicated Onboarding Regression Test Suite (`tests/pet-engine/freshForkOnboardingRemediation.test.ts`)
```
Command: npx tsx --test tests/pet-engine/freshForkOnboardingRemediation.test.ts
Result: 12 / 12 passed (100%)
Duration: ~1.6s

Tests:
✔ P1-01-A: Reinitializes inherited upstream state cleanly for foreign fork owner
✔ P1-01-B: Refuses foreign fork baseline when reinitializeForeignFork is false
✔ P1-01-C: Prevents baseline reinitialization if target owner already matches existing owner
✔ P1-01-D: Refuses reinitialization if concurrency lock exists
✔ P1-01-E: Refuses reinitialization if uncommitted transaction journal exists
✔ P1-01-F: Performs atomic rollback to pre-reset bytes if sync fails
✔ P1-02-A: Repository README has exactly 1 operational marker pair
✔ P1-02-B: updateReadmeContent successfully updates README.md without MalformedReadmeMarkersError
✔ P1-03-A: pet.template.json passes schema validation with null timestamps
✔ P1-03-B: contributions.template.json passes isPristineContributionLedger with null owner ID
✔ P1-03-C: Established pet (Level > 1) rejects null updatedAt or lastOfflineResolutionTime
✔ P1-03-D: Established pet allows null lastInteractionTime and lastSimulatedAt
```

### 4.5 Production Build
```
Command: npm run build
Result: Next.js production build completed successfully
Output: Generating static pages (6/6), finalizing page optimization, build complete.
```

### 4.6 Linter
```
Command: npm run lint
Result: 0 errors, 0 warnings
```

---

## 5. End-to-End Acceptance in Isolated Test Fork

**Test Repository:** `D:\Projects\GitHub-Profile-Pet-Test-Fork`  
**Test Branch:** `test/fresh-fork-onboarding`  
**Simulated User:** `@alice-dev` (Database ID: `445566`)  

| Step | Action | Expected Result | Actual Result | Verdict |
| :---: | :--- | :--- | :--- | :---: |
| **1** | Inspect Inherited State | Contains upstream pet (Gen 3, Level 1, 55 XP, @mnp210 / 298821706) | Gen 3, Level 1, 55 XP, @mnp210 detected | **PASS** |
| **2** | Baseline without `--reinitialize-foreign-fork` | Rejection (`baseline_refused`) | Rejected: `foreign_fork_reinitialization_required` | **PASS** |
| **3** | Baseline with `--reinitialize-foreign-fork` | Reset state to Gen 2, Level 1, 0 XP, bind to `@alice-dev`, commit 3 files | Succeeded (`baseline_established`), commit `6b4c850` created | **PASS** |
| **4** | Repeat Baseline by `@alice-dev` | Refusal (`baseline_refused`), anti-wipe guard active | Rejected: `baseline_refused` (owner matches, not pristine) | **PASS** |
| **5** | SVG Publication (`publishPetSvg`) | Generates `public/pet.svg`, updates `README.md` without marker error | Succeeded, SVG updated, 0 marker collisions | **PASS** |
| **6** | Care Action Interaction (`feed`) | Applies transition, adds 10 XP, updates Hunger to 94, increments Gen to 3 | Succeeded, XP = 10, Hunger = 94, Gen = 3 saved | **PASS** |
| **7** | Re-publish SVG | Updates SVG embed with new vitals | Succeeded, SVG generated with updated stats | **PASS** |

### Acceptance Step 3 Commit Audit (`6b4c850`)
```
Commit: 6b4c850 chore(pet): initialize contribution baseline [skip ci]
Author: alice-dev <445566+alice-dev@users.noreply.github.com>
Files Changed:
 pet/ledger/actions.json       | 2 +-
 pet/ledger/contributions.json | 10 +--
 pet/state/pet.json            | 8 +--
 3 files changed, 10 insertions(+), 10 deletions(-)
```
Strict manifest isolation verified: exactly 3 state files committed, zero foreign files staged.

---

## 6. Repository State & File Manifest

### 6.1 Candidate Remediation Commits
- `ab5ab69b8fe7413f9667967dcdafae23e41676f8`:
  - `README.md`
  - `src/features/pet-engine/domain/types.ts`
  - `src/features/pet-engine/publication/baselinePipeline.ts`
  - `src/features/pet-engine/sync/contributionSyncService.ts`
  - `src/features/pet-engine/transitions/careTransitions.ts`
  - `src/features/pet-engine/validation/ledgerValidator.ts`
  - `src/features/pet-engine/validation/stateValidator.ts`
  - `tests/pet-engine/freshForkOnboardingRemediation.test.ts`
  - `tests/pet-engine/releasePortabilityAndSecurity.test.ts`
- `232bc8bce72098e223a85ab345fdd6ab573537a2`:
  - `src/features/pet-engine/publication/baselinePipeline.ts`

### 6.2 Production Repository Status
- Remote `origin/main` at `0a6d08448220be11cd54ccf6cb2d35f560b1cc69`.
- **Zero changes, pushes, or PR merges performed against production `mnp210/GitHub-Profile-Pet`.**

---

## 7. Conclusion & Next Steps

All three Priority-1 onboarding defects identified in R3.37 have been remediated, verified against atomic rollback and anti-wipe invariants, covered with 12 targeted regression tests, and confirmed via realistic end-to-end acceptance testing on a test fork.

The candidate remediation branch `phase-3c2-3-b2-r3-38-onboarding-remediation` is fully verified and ready for formal release review.
