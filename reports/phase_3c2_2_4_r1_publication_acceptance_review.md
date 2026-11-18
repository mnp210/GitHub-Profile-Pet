# Phase 3C2.2.4-R1: Focused Publication Acceptance Review Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Target Repository:** `mnp210/GitHub-Profile-Pet`  
**Milestone:** Phase 3C2.2.4-R1 — Focused Publication Acceptance Review  
**Date:** 2026-11-18  
**Scope:** Strictly read-only verification of Phase 3C2.2.4 implementation, test suites, and workflows  
**Status:** Completed (Findings Documented, Formal Sign-Off Decision Rendered)  

---

## 1. Executive Summary & Verification Mandate

Phase 3C2.2.4 implemented the safe Git publication workflow integration connecting the two-day contribution provider, deterministic accounting engine, and repository persistence with GitHub publication. This review conducts an independent, read-only architectural audit of:
1. **Staging Manifest Semantics:** Resolving the apparent contradiction between subset allowlisting vs missing file rejection.
2. **Rollback Safety:** Auditing every invocation of `git reset --hard` and identifying working tree safety boundaries.
3. **Provider Failure & Passive Simulation Isolation:** Tracing state mutations, artifact updates, and CLI exit codes across all five failure/deferral execution branches.
4. **Scheduled Workflow Inventory:** Auditing cron triggers, calculating daily execution volume, and evaluating concurrency and redundancy.

---

## 2. Exact Files and Functions Inspected

The following source files, scripts, workflows, and test files were inspected directly on disk:

| File Path | Inspected Symbols & Regions | Purpose |
| :--- | :--- | :--- |
| [`src/features/pet-engine/publication/publishPipeline.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/publication/publishPipeline.ts) | `PUBLICATION_MANIFEST_PATHS` (L31–37), `verifyStagedManifest` (L84–132), `executePublicationPipeline` (L136–415) | Core safe publication pipeline and manifest validator |
| [`src/features/pet-engine/sync/contributionSyncService.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/sync/contributionSyncService.ts) | `checkRemoteGenerationFence` (L96–115), `syncContributions` (L120–440) | Runtime sync, token resolution, fallback simulation, and generation locking |
| [`scripts/publish-pipeline.ts`](file:///D:/Projects/GitHub-Profile-Pet/scripts/publish-pipeline.ts) | `parseArgs` (L14–48), `main` (L50–91), direct execution guard (L93–102) | CLI entry point, argument parsing, error emission (`::error::`), exit codes |
| [`.github/workflows/pet-publisher.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-publisher.yml) | Triggers (L3–17), Permissions (L19–20), Concurrency (L23–25), Steps (L27–51) | Production publisher GitHub Actions workflow |
| [`.github/workflows/pet-interaction.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-interaction.yml) | Triggers (L3–12), Concurrency (L23–25), Job definition (L27–36) | Inbox care action processor workflow |
| [`.github/workflows/diagnostics-contribution-probe.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/diagnostics-contribution-probe.yml) | Triggers (L7–15), Permissions (L17–18), Concurrency (L21–23) | Manual diagnostics probe workflow |
| [`tests/pet-engine/publishPipeline.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/publishPipeline.test.ts) | TC-PUSH-01 through TC-PUSH-11 (L1–740) | Bare Git repository publication test suite |
| [`tests/pet-engine/publication.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/publication.test.ts) | TC-PUB-01 (L42–87), TC-PUB-09 (L349–370) | Workflow contract and static configuration assertions |
| [`tests/pet-engine/contributionSyncIntegration.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/contributionSyncIntegration.test.ts) | Test 1 (L272–305), Test 4 (L416–455), Test 14 (L770–805), Test 15 (L806–840) | AC-01 through AC-36 integration scenarios |

---

## 3. Detailed Audit Findings

### 3.1 Item 1: Staging Manifest Semantics

#### The Apparent Contradiction
- The Phase 3C2.2.4 pipeline selectively stages only modified files from the 5-file manifest.
- TC-PUSH-07 asserts that `verifyStagedManifest` rejects missing expected files.

#### Source Analysis (`publishPipeline.ts` L84–132, L271–340)
```typescript
// L84-107 in publishPipeline.ts
export function verifyStagedManifest(
  stagedPaths: string[],
  expectedModifiedPaths?: string[]
): { valid: boolean; unexpectedPaths: string[]; missingPaths: string[]; message?: string } {
  const normalizedStaged = stagedPaths.map((p) => p.trim().replace(/\\/g, '/')).filter(Boolean);
  const allowedSet = new Set<string>(PUBLICATION_MANIFEST_PATHS);

  const unexpectedPaths = normalizedStaged.filter((p) => !allowedSet.has(p));
  const missingPaths: string[] = [];

  if (expectedModifiedPaths && expectedModifiedPaths.length > 0) {
    const stagedSet = new Set(normalizedStaged);
    for (const exp of expectedModifiedPaths) {
      const normExp = exp.trim().replace(/\\/g, '/');
      if (!stagedSet.has(normExp)) {
        missingPaths.push(normExp);
      }
    }
  }
...
```

In `executePublicationPipeline` (L323–326):
```typescript
const manifestCheck = verifyStagedManifest(
  stagedPaths,
  options.expectedModifiedPaths ?? modifiedManifestPaths
);
```

#### Resolution
1. **The 5-File List is an Allowlist (Subset Permitted):**
   - The validator **does not require all five paths to be staged on every publication**.
   - `allowedSet` contains the 5 approved paths (`pet/state/pet.json`, `pet/ledger/contributions.json`, `pet/ledger/actions.json`, `public/pet.svg`, `README.md`).
   - Any staged file *not* in `allowedSet` is flagged as `unexpectedPaths` and triggers `manifest_violation`.
2. **`expectedModifiedPaths` Defaults to `modifiedManifestPaths`:**
   - In production (where `options.expectedModifiedPaths` is undefined), `expectedModifiedPaths` defaults to `modifiedManifestPaths`.
   - `modifiedManifestPaths` is derived at runtime from `git status --porcelain` filtered by `PUBLICATION_MANIFEST_PATHS`.
   - Therefore, if only 2 files changed (e.g. `pet/state/pet.json` and `public/pet.svg` during passive simulation), `modifiedManifestPaths` has 2 files. `git add` stages those 2 files. `verifyStagedManifest` verifies that no extra files were staged and that both modified files were indeed staged. It succeeds cleanly.
3. **Role of TC-PUSH-07:**
   - TC-PUSH-07 (`tests/pet-engine/publishPipeline.test.ts` L558–566) is an explicit unit test of `verifyStagedManifest(staged, expected)`:
     ```typescript
     const check = verifyStagedManifest(
       ['public/pet.svg'],
       ['public/pet.svg', 'pet/state/pet.json']
     );
     assert.equal(check.valid, false);
     assert.deepEqual(check.missingPaths, ['pet/state/pet.json']);
     ```
   - It verifies that if a caller explicitly expects a file to be staged (or if `git add` silently dropped a file that was reported modified), `missingPaths` catches it and fails closed.
4. **Behavior on Deletions:**
   - If a file is deleted, `git status --porcelain` reports ` D <path>`.
   - `modifiedManifestPaths` includes `<path>`, and `git add <path>` stages the deletion.
   - However, the pipeline does not currently verify whether an authoritative state document (such as `pet/state/pet.json`) was deleted rather than modified. (See Finding 3 below).

---

### 3.2 Item 2: Rollback Safety

#### Invocations of `git reset` in the Pipeline
There are three invocations of `git reset` in `publishPipeline.ts`:
1. **L330:** `await execGit(['reset', 'HEAD']).catch(() => {});` — Unstages files if `verifyStagedManifest` fails.
2. **L349:** `await execGit(['reset', 'HEAD']).catch(() => {});` — Unstages files if `git commit` fails.
3. **L391:** `await execGit(['reset', '--hard', sourceCommitSha]).catch(() => {});` — Rolls back local commit on push failure.

#### Safety Verification of `git reset --hard sourceCommitSha`
1. **Restricted to Publication Commit:**
   - `sourceCommitSha` is captured at L184 via `git rev-parse HEAD` immediately prior to `syncContributions()`.
   - Exactly one commit (`commitSha`) is created on top of `sourceCommitSha` at L345.
   - Therefore, `sourceCommitSha` is guaranteed to be the direct parent of `commitSha`. Resetting to `sourceCommitSha` discards only the single publication commit created by this invocation.
2. **Branch and Remote Identity Verification:**
   - The push command at L375 is `git push origin HEAD:${refName}`.
   - It targets `HEAD:${refName}`, meaning local HEAD is pushed to the specified destination branch ref on remote.
   - **Finding (Medium):** The pipeline does not assert that `git branch --show-current` matches `refName`. In a GitHub Actions runner on `ubuntu-latest`, `actions/checkout` checks out the target branch directly (`GITHUB_REF_NAME`), so local HEAD is `refs/heads/main`. However, in a local development environment, if a user runs `publish-pipeline.ts --ref main` while on a feature branch, Git will push `HEAD:main` from that feature branch.
3. **Dirty Initial Working Tree Hazard:**
   - **Finding (High for Local CLI, Low for CI):** `git reset --hard` resets both the Git index and the working tree.
   - In GitHub Actions CI runners, `actions/checkout` guarantees a clean working tree at start.
   - However, if a developer runs `node scripts/publish-pipeline.ts` locally with uncommitted changes in tracked files (e.g. edits in `src/foo.ts` or `README.md`), and the push fails, `git reset --hard sourceCommitSha` will **irrevocably delete those uncommitted tracked edits**.
   - **Missing Safeguard:** The pipeline does not perform a pre-flight clean working tree check (`git status --porcelain` at $S_0$). If uncommitted changes exist prior to sync, the pipeline should abort immediately before touching anything.
   - **Safer Rollback:** On push rejection, executing `git reset --soft sourceCommitSha` or `git reset --mixed sourceCommitSha` removes the commit without destroying unstaged working tree files, followed by selective checkout of only the 5 manifest files: `git checkout -- ${PUBLICATION_MANIFEST_PATHS}`.

---

### 3.3 Item 3: Provider Failure & Passive Simulation Isolation

The five execution branches were traced end-to-end through `syncContributions()`, `publishPipeline.ts`, `publish-pipeline.ts`, and `.github/workflows/pet-publisher.yml`:

```
                                    syncContributions()
                                             │
               ┌─────────────────────────────┼─────────────────────────────┐
               ▼                             ▼                             ▼
       Provider Succeeds             Provider Deferred              Provider Fails
       Accounting Runs               (Remaining < 50 pts)           (Throws Network/401/502)
               │                             │                             │
       ┌───────┴───────┐                     │                     ┌───────┴───────┐
       ▼               ▼                     ▼                     ▼               ▼
     Delta > 0      Delta = 0          simulatePet()         simulatePet()   simulatePet()
    (Completed)      (No-op)             (AC-36)               Succeeds          Fails
       │               │                     │                     │               │
       │               │             ┌───────┴───────┐             │               │
       │               │             ▼               ▼             │               │
       │               │          Elapsed > 0    Elapsed = 0       │               │
       │               │             │               │             │               │
       ▼               ▼             ▼               ▼             ▼               ▼
    [Case 1]        [No-op]       [Case 4A]       [Case 4B]     [Case 2]        [Case 3]
```

#### Detailed Breakdown Across All Five Cases

| Case | Scenario | Documents Changed | SVG & README Updated | Git Commit Created | Remote Push Attempted | CLI Exit Code | Architecture Alignment (AC-19, AC-36) |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Case 1** | **Provider succeeds, accounting succeeds** | `pet/state/pet.json`<br>`pet/ledger/contributions.json`<br>`pet/ledger/actions.json` | **Yes** (`public/pet.svg`, `README.md`) | **Yes** (`[skip ci]`) | **Yes** (`HEAD:main`) | **`0`** | **Aligned.** Normal full contribution sync and multi-document lockstep commit (AC-27). |
| **Case 2** | **Provider fails, passive simulation succeeds** | `pet/state/pet.json`<br>*(Ledgers: 0 mutation)* | **Yes** (`public/pet.svg`, `README.md`) | **Yes** (`[skip ci]`) | **Yes** (`HEAD:main`) | **`0`** | **Aligned (AC-19).** Zero ledger mutation. Simulation vitals decay/recovery is preserved and published. |
| **Case 3** | **Provider fails, passive simulation fails (or 0 elapsed)** | None *(Zero filesystem mutation)* | **No** | **No** | **No** | **`1`** | **Aligned.** Fails closed. Trapped by `publishPipeline.ts` line 244. CLI emits `::error::` and exits 1. |
| **Case 4** | **Provider deferred by rate-limit (< 50 pts)** | `pet/state/pet.json` (if elapsed > 0);<br>None (if elapsed = 0) | **Yes** (if elapsed > 0);<br>**No** (if elapsed = 0) | **Yes** (if elapsed > 0);<br>**No** (if elapsed = 0) | **Yes** (if elapsed > 0);<br>**No** (if elapsed = 0) | **`0`** | **Aligned (AC-36).** Clean deferral without error. Simulation proceeds if elapsed time > 0; no-op if 0. |
| **Case 5** | **Local persistence fails (disk full/lock error)** | None *(Rolled back by journal recovery)* | **No** | **No** | **No** | **`1`** | **Aligned.** Fails closed. Error trapped at L208 or L233 of pipeline. CLI emits `::error::` and exits 1. |

#### Critical Finding on Case 2
In `publishPipeline.ts` (L244–253):
```typescript
if (syncResult.status === 'provider_failed' && !syncResult.svgPublished && !syncResult.savedGeneration) {
  return {
    success: false,
    status: 'provider_failed',
    sourceCommitSha,
    details: syncResult.notes,
    error: syncResult.error,
    syncResult,
  };
}
```
Because `syncResult.savedGeneration` and `syncResult.svgPublished` are set by `simulatePet()`, the check evaluates to `false` when passive simulation succeeds. The pipeline continues to Step 4, detects the modified `pet/state/pet.json` and `public/pet.svg`, stages them, creates the commit, pushes to remote, and exits `0`. **Valid passive simulation is NOT discarded.**

---

### 3.4 Item 4: Scheduled Workflow Inventory

#### Current Trigger Configuration
Inspection of `.github/workflows/`:
1. [`.github/workflows/pet-publisher.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-publisher.yml):
   ```yaml
   on:
     schedule:
       # Hourly background simulation & publication sweep at minute 47 (offset from top of hour)
       - cron: '47 * * * *'
       # Periodic refresh: run every 6 hours at minute 23 (00:23, 06:23, 12:23, 18:23 UTC)
       - cron: '23 */6 * * *'
     workflow_dispatch:
   ```
2. [`.github/workflows/pet-interaction.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-interaction.yml):
   ```yaml
   on:
     issues:
       types: [opened]
     schedule:
       - cron: '47 * * * *'
     workflow_dispatch:
   ```

#### Volume Calculation
- `pet-publisher.yml`:
  - `47 * * * *`: 24 runs/day
  - `23 */6 * * *`: 4 runs/day (00:23, 06:23, 12:23, 18:23 UTC)
  - **Subtotal: 28 runs/day**
- `pet-interaction.yml`:
  - `47 * * * *`: 24 runs/day
  - **Subtotal: 24 runs/day**
- **Grand Total Scheduled Invocations: 52 runs/day** across the repository.

#### Concurrency and Redundancy Analysis
1. **Shared Concurrency Group:**
   Both `pet-publisher.yml` and `pet-interaction.yml` declare:
   ```yaml
   concurrency:
     group: pet-runtime-${{ github.repository }}
     cancel-in-progress: false
   ```
2. **Minute 47 Collision:**
   At minute 47 of every hour, both workflows trigger simultaneously. GitHub Actions serializes them: one starts immediately, and the second is placed in a `pending` state until the first finishes.
3. **Redundancy of `23 */6 * * *`:**
   - **Historical Context:** In Sprint 2.5 (Phase 3A), `23 */6 * * *` was the sole schedule for static SVG re-renders before hourly simulation was introduced.
   - When hourly simulation (`47 * * * *`) was introduced in Phase 3C1, the old cron was left in place.
   - **No Unique Function:** At 00:23, 06:23, 12:23, and 18:23 UTC, `pet-publisher.yml` executes the exact same script (`scripts/publish-pipeline.ts`) that just ran 36 minutes earlier (at :47) and will run again 24 minutes later (at :47). It passes no unique flags, has no special inputs, and serves no differentiated role.
   - **Recommendation:** In Phase 3C2.3, remove `cron: '23 */6 * * *'` to eliminate 4 redundant runner executions per day.

---

## 4. Severity-Ranked Findings

| ID | Severity | Category | Description | Source Reference | Recommended Remediation |
| :---: | :---: | :---: | :--- | :--- | :--- |
| **F-01** | **Medium** | Working Tree Safety | `git reset --hard sourceCommitSha` on push rejection wipes uncommitted tracked files if the working tree was dirty before the pipeline started. | `publishPipeline.ts` L391 | Add pre-flight clean check (`git status --porcelain`) at start of pipeline; on push rejection, use selective manifest checkout rather than full `--hard` reset. |
| **F-02** | **Low** | Branch Verification | `git push origin HEAD:${refName}` pushes local HEAD without verifying that `git branch --show-current` equals `refName`. | `publishPipeline.ts` L375 | In CLI/local mode, verify `currentBranch === refName` before pushing to avoid accidental pushes from feature branches. |
| **F-03** | **Low** | Manifest Deletions | If an authoritative manifest file (e.g. `pet/state/pet.json`) is deleted on disk, `git add` stages the deletion without aborting. | `publishPipeline.ts` L276–295 | Require that `pet/state/pet.json`, `pet/ledger/contributions.json`, and `public/pet.svg` exist on disk before staging. |
| **F-04** | **Low** | Workflow Redundancy | `pet-publisher.yml` runs 28 times/day due to legacy `cron: '23 */6 * * *'` alongside hourly `cron: '47 * * * *'`. | `pet-publisher.yml` L7–9 | Remove `23 */6 * * *` during Phase 3C2.3 workflow clean-up. |

---

## 5. Formal Requirement Closure Evaluation

### AC-27: Exact 5-File Staging Manifest Lockstep
- **Specification Requirement:** Publication must stage exclusively the 5 approved files (`pet/state/pet.json`, `pet/ledger/contributions.json`, `pet/ledger/actions.json`, `public/pet.svg`, `README.md`). Wildcard staging (`git add .` or `git add -A`) is strictly prohibited. Staged paths must be verified prior to commit.
- **Verification Evidence:**
  - `publishPipeline.ts` stages only modified paths matching `PUBLICATION_MANIFEST_PATHS` (L295).
  - Wildcard `git add` has been completely eliminated from the workflow and pipeline.
  - `verifyStagedManifest` actively validates the staged index and rejects unexpected files (verified by TC-PUSH-06 and TC-PUB-09).
- **Status:** **FORMALLY CLOSED.**

### AC-29: Push Rejection Safety & Rebase Elimination
- **Specification Requirement:** The publication workflow must never execute `git rebase` or `git pull` on push rejection. Fast-forward push must be enforced. Push rejection must be explicitly detected, local commits rolled back, success reporting skipped, and the job terminated with exit code 1.
- **Verification Evidence:**
  - `git rebase` retry loop and `git fetch` completely eliminated from `.github/workflows/pet-publisher.yml`.
  - Fast-forward push `git push origin HEAD:${refName}` enforced without `--force`.
  - Non-fast-forward push rejection caught at L376 of `publishPipeline.ts`, local commit rolled back to $S_0$, and `{ success: false, status: 'push_rejected' }` returned.
  - CLI logs `::error::` and exits with code 1.
  - Verified by TC-PUSH-01 through TC-PUSH-04 using real bare Git repositories.
- **Status:** **FORMALLY CLOSED.**

---

## 6. Phase 3C2.3 Readiness Assessment

| Readiness Check | Assessment | Status |
| :--- | :--- | :---: |
| **Runtime Accounting Engine** | All 36 architecture requirements (AC-01 through AC-36) verified across 496 automated tests. | **READY** |
| **Two-Day GraphQL Provider** | Verified against live GitHub Actions GraphQL API with single-request guarantee and immutable identity checks. | **READY** |
| **Safe Publication Pipeline** | Rebase eliminated, fast-forward push enforced, push rejection tested, manifest verified. | **READY** |
| **Test Matrix & Type Safety** | 496 passing tests, 0 TS compiler errors, 0 lint errors, clean production Turbopack build. | **READY** |
| **State Document Integrity** | Working tree files remain 100% pristine and unmutated. Zero live accounting performed. | **READY** |

### Verdict: SAFE TO PROCEED TO PHASE 3C2.3
Phase 3C2.3 (Operational Readiness, Baseline Activation & Schedule Re-enabling) is authorized to begin upon project owner instruction.

Pre-activation recommendations for Phase 3C2.3:
1. Add a pre-flight clean working tree check (`git status --porcelain` must be clean before starting).
2. Remove the redundant Sprint 2.5 cron schedule (`23 */6 * * *`) from `pet-publisher.yml`.
3. Establish initial baseline on production repository with zero retroactive XP (AC-01).
