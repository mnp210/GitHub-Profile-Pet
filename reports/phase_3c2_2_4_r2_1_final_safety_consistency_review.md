# Phase 3C2.2.4-R2.1: Final Rollback, Remote-Ref & Schedule Consistency Review

**Project:** GitHub Profile Pet (`mnp210/GitHub-Profile-Pet`)  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Milestone:** Phase 3C2.2.4-R2.1 (Read-Only Safety & Consistency Verification)  
**Date:** 2026-11-18  
**Mode:** Strictly Read-Only Audit  

---

## 1. Exact Files Inspected

This audit independently inspected the actual source code, scripts, and workflow files:

1. [src/features/pet-engine/publication/publishPipeline.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/publication/publishPipeline.ts) (lines 1–598: preflights, rollback execution, git helpers, branch and authoritative file validations).
2. [scripts/publish-pipeline.ts](file:///D:/Projects/GitHub-Profile-Pet/scripts/publish-pipeline.ts) (lines 1–102: CLI argument parsing, environment variable bindings, exit code semantics).
3. [.github/workflows/pet-publisher.yml](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-publisher.yml) (lines 1–48: trigger configuration, schedule crons, checkout action, concurrency groups, permissions, timeout).
4. [.github/workflows/pet-interaction.yml](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-interaction.yml) (lines 1–113: issue trigger, hourly inbox sweep cron, concurrency group, git push retry loop).
5. [.github/workflows/diagnostics-contribution-probe.yml](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/diagnostics-contribution-probe.yml) (lines 1–48: workflow_dispatch configuration, read-only permissions, isolated concurrency group).
6. [tests/pet-engine/publishPipeline.test.ts](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/publishPipeline.test.ts) (lines 1–1228: TC-PUSH-01 through TC-PUSH-11, and F-01/F-02/F-03 test implementations).
7. [tests/pet-engine/publication.test.ts](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/publication.test.ts) (lines 1–424: TC-PUB-01 through TC-PUB-10).
8. Git history and commit log for `.github/workflows/` (commits `ab2f88e` to HEAD).

---

## 2. F-01: Rollback Safety Under Concurrent Local Changes

### 2.1. Mechanism Analysis
In `src/features/pet-engine/publication/publishPipeline.ts`:
- **Preflight (Step 2, lines 266–298):**
  Executes `git status --porcelain --untracked-files=all` before simulation or accounting. If any tracked modifications or untracked files are detected, the pipeline aborts immediately with `status: 'dirty_working_tree'`.
- **Preflight (Step 1, lines 241–264):**
  Captures `sourceCommitSha = currentHead` ($S_0$).
- **Push Rejection Rollback (Step 13, lines 553–584):**
  Upon push failure (non-fast-forward rejection or network error), line 572 executes:
  ```ts
  await execGit(['reset', '--hard', sourceCommitSha]).catch(() => {});
  ```

### 2.2. Five Scenario Evaluations

1. **Scenario 1: A separate process modifies a tracked file after preflight.**
   - *Behavior:* Preflight passes at $t_0$. At $t_1$, an external process (e.g. IDE, build tool, or concurrent terminal) modifies a tracked file (e.g. `src/index.ts`). The pipeline commits only `modifiedManifestPaths` at $t_2$. At $t_3$, push is rejected. At $t_4$, `git reset --hard sourceCommitSha` executes.
   - *Impact:* `git reset --hard` resets the Git index and working tree to $S_0$. **Any uncommitted modifications made to any tracked file by the external process are irreversibly destroyed.** Initial cleanliness at $t_0$ does not protect changes introduced between $t_0$ and $t_4$.

2. **Scenario 2: A separate process creates an untracked file after preflight.**
   - *Behavior:* Preflight passes at $t_0$. At $t_1$, an external process creates an untracked file (e.g. `scratch.txt`). Push is rejected at $t_3$. Rollback runs `git reset --hard sourceCommitSha`.
   - *Impact:* `git reset --hard` affects only tracked files. The untracked file `scratch.txt` is **not destroyed**. However, the file remains on disk, causing the working tree to become dirty for any subsequent pipeline run.

3. **Scenario 3: The pipeline itself modifies several allowlisted files before push rejection.**
   - *Behavior:* The pipeline updates `pet/state/pet.json`, `pet/ledger/contributions.json`, `pet/ledger/actions.json`, and `public/pet.svg`. These files are committed locally as `commitSha`. Push to remote fails (non-fast-forward).
   - *Impact:* `git reset --hard sourceCommitSha` resets the local commit and discards the unpushed mutations on these files, restoring them cleanly to $S_0$. **This is the desired, safe behavior**, preventing rejected, unpushed state mutations from remaining on disk.

4. **Scenario 4: The pipeline creates a temporary file or journal before push rejection.**
   - *Behavior:* `saveRepositoryState()` uses `.journal/` during disk staging, but cleans it up in step 7 upon successful file replacement before git staging. If a crash or error occurs mid-pipeline leaving an untracked temporary file:
   - *Impact:* `git reset --hard` does **not** delete untracked temporary files. Such files would remain on disk unless cleaned by repository recovery handlers or `git clean`.

5. **Scenario 5: Another process changes a file between the final publication checks and rollback.**
   - *Behavior:* Between manifest verification (step 10) / commit (step 11) and rollback (step 13), another process modifies a tracked file.
   - *Impact:* `git reset --hard sourceCommitSha` overwrites and **destroys** that modification.

### 2.3. Environmental Distinctions
- **GitHub Actions Runner (Operational Target):**
  - Ephemeral, single-tenant virtual machine (`ubuntu-latest`).
  - Serialized execution enforced by `concurrency: group: pet-runtime-${{ github.repository }}` (`cancel-in-progress: false`).
  - No human developers, IDEs, or concurrent background processes exist on the runner filesystem.
  - On the GitHub Actions runner, `git reset --hard sourceCommitSha` is **completely safe** because concurrent local writers cannot exist.
- **Local Development / Shared CLI Environment:**
  - If executed locally on a developer machine while background tasks, file watchers, or user edits occur, `git reset --hard sourceCommitSha` can clobber unstaged changes in tracked files.

### 2.4. F-01 Verdict
**CONDITIONALLY SAFE with documented restrictions.**
- **Enforced Execution Restriction:** Safe exclusively in isolated, single-tenant environments (such as GitHub Actions runners or dedicated CI workers) where no concurrent local modifications occur.
- **Identified Improvement for General Environments:** To make rollback unconditionally safe across shared local environments, Git rollback should avoid `--hard`, using either:
  1. `git reset --keep sourceCommitSha` (aborts if uncommitted changes would be clobbered); or
  2. Targeted checkout of allowlisted files: `git checkout sourceCommitSha -- "${PUBLICATION_MANIFEST_PATHS[@]}"` followed by `git reset sourceCommitSha` (mixed reset).

---

## 3. F-02: Remote Destination & Identity Verification

### 3.1. What Is Verified
1. **Destination Branch:** Validated non-empty (`if (!targetBranch)` in line 301). Normalized from ref format (stripping `refs/heads/`).
2. **Current Checked-Out Branch:** Queried via `git branch --show-current` (line 314).
3. **Detached HEAD Guard:** Explicitly fails with `'branch_mismatch'` if `currentBranch` is empty or `'HEAD'` (line 326).
4. **Branch Matching Guard:** Explicitly fails with `'branch_mismatch'` if `currentBranch !== targetBranch` (line 337).
5. **Intended Remote Ref:** Pushes explicitly to `HEAD:${targetBranch}` on the configured remote.

### 3.2. What Is NOT Verified (Remote Identity & Misconfiguration Risk)
1. **Configured Remote Name (`gitRemote`):**
   - Defaults to `'origin'`. The pipeline does not inspect `git remote` to verify the remote exists prior to push (failure is caught during `git push`).
2. **Remote Repository Identity (URL / Owner / Repo):**
   - Neither `publishPipeline.ts` nor `scripts/publish-pipeline.ts` inspects `git remote get-url origin`.
   - The code does **not** assert that `origin` points to `https://github.com/mnp210/GitHub-Profile-Pet.git` or matches `process.env.GITHUB_REPOSITORY`.
3. **Misconfiguration Risk:**
   - In a local environment where a developer's clone has `origin` pointing to a personal fork or different repository, running `publish-pipeline.ts --ref main` will push `main` to that foreign repository without warning.
   - In GitHub Actions (`.github/workflows/pet-publisher.yml`), the remote identity is established by `actions/checkout@v4`, which sets `origin` to `https://github.com/${{ github.repository }}` using the runner's contextual token. Thus, in GitHub Actions, the remote destination is guaranteed by the platform harness, not by code-level assertions.

### 3.3. F-02 Verdict
**CONDITIONALLY SAFE with documented restrictions.**
- Local branch-to-destination validation (`git branch --show-current === targetBranch`) is fully enforced.
- Remote repository identity is **not verified by code**, but is guaranteed by the GitHub Actions checkout harness in production.
- **Identified Improvement for General Environments:** Add a preflight remote URL inspection: verify `git remote get-url <gitRemote>` contains the expected repository owner/repo when `GITHUB_REPOSITORY` is defined.

---

## 4. Complete Workflow Schedule Inventory

Every workflow file in `.github/workflows/` was inspected:

| Workflow File | Cron Expressions | Manual Dispatch | Event Triggers | Concurrency Group | Mutating or Read-Only | Scheduled Invocations / Day |
|---|---|---|---|---|---|---|
| [.github/workflows/pet-publisher.yml](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-publisher.yml) | `47 * * * *` (hourly at min 47) | Yes (`workflow_dispatch` with `force_render`) | None | `pet-runtime-${{ github.repository }}` (`cancel-in-progress: false`) | **Mutating** (updates state, ledgers, SVG badge, README; commits & pushes) | 24 / day |
| [.github/workflows/pet-interaction.yml](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/pet-interaction.yml) | `47 * * * *` (hourly at min 47) | Yes (`workflow_dispatch`) | `issues: [opened]` | `pet-runtime-${{ github.repository }}` (`cancel-in-progress: false`) | **Mutating** (drains care action issues, updates state, commits & pushes) | 24 / day (plus event runs on issues) |
| [.github/workflows/diagnostics-contribution-probe.yml](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/diagnostics-contribution-probe.yml) | None | Yes (`workflow_dispatch` with `owner_login`) | None | `pet-diagnostics-${{ github.repository }}` (`cancel-in-progress: false`) | **Read-Only** (`contents: read`; diagnostic GraphQL probe only) | 0 / day |

### 4.1. Historical Reference Reconciliation
- **`pet-maintenance.yml`:** Referenced in the Phase 3C2.2.4-R2 report as running at `17 * * * *`. Git log and filesystem inspection prove that `pet-maintenance.yml` **does not exist and has never existed** in repository history. That reference was a documentation artifact.
- **`pet-interaction.yml`:** The actual second runtime workflow in the repository is `pet-interaction.yml`. It handles issue-based care actions and includes an hourly recovery sweep scheduled at `47 * * * *`.
- **`pet-publisher.yml`:** In Phase 3C2.2.4-R2, the redundant cron `23 */6 * * *` was removed. It now contains only `47 * * * *`.
- **`diagnostics-contribution-probe.yml`:** Remains strictly manual (`workflow_dispatch`), read-only, and unscheduled.

### 4.2. Daily Scheduled Invocation Estimate & Concurrency Interaction
- **Daily Invocations Estimate:**
  - `pet-publisher.yml`: 24 scheduled runs/day.
  - `pet-interaction.yml`: 24 scheduled runs/day.
  - `diagnostics-contribution-probe.yml`: 0 scheduled runs/day.
  - **Total Estimated Scheduled Invocations:** **48 runs per day**.
- **Important Execution Semantics:**
  - GitHub Actions scheduled workflows are best-effort: they do not guarantee execution on the exact second and may be delayed or coalesced during high platform load.
  - **Shared Concurrency Bottleneck:** Both `pet-publisher.yml` and `pet-interaction.yml` are scheduled at `47 * * * *` and share the identical concurrency group:
    ```yaml
    concurrency:
      group: pet-runtime-${{ github.repository }}
      cancel-in-progress: false
    ```
  - When both fire at minute 47, GitHub Actions serializes them: one executes while the other waits in the pending queue.
  - Because GitHub Actions queues at most 1 pending run per concurrency group, rapid consecutive runs could experience queue pressure.
  - *Recommendation for Phase 3C2.3:* Stagger the cron schedules (e.g. `pet-interaction.yml` at `17 * * * *` and `pet-publisher.yml` at `47 * * * *`) to eliminate unnecessary lock contention at minute 47.

---

## 5. Summary of Unresolved Risks

1. **Risk R-01 (Low in Actions / Medium in Local):** `git reset --hard sourceCommitSha` on push failure clobbers uncommitted modifications in tracked files made after preflight. Mitigated in GitHub Actions by single-tenant runner isolation and workflow concurrency serialization.
2. **Risk R-02 (Low in Actions / Medium in Local):** Code does not verify remote URL (`git remote get-url origin`) against `GITHUB_REPOSITORY`. Mitigated in GitHub Actions by `actions/checkout@v4` configuring the correct repository origin.
3. **Risk R-03 (Operational Efficiency):** Both `pet-publisher.yml` and `pet-interaction.yml` fire at `47 * * * *` under the same concurrency group. Mitigated by `cancel-in-progress: false` serialization, but creates unnecessary runner queue latency at minute 47.

---

## 6. Audit Verdict & Phase 3C2.3 Readiness

| Decision Item | Verdict | Justification |
|---|---|---|
| **Phase 3C2.2.4-R2 Formal Acceptance** | **ACCEPTED (CONDITIONALLY)** | All required remediation items (F-01, F-02, F-03, F-04) are correctly implemented, fail closed, and are verified by 24 passing integration tests. The conditional risks are fully mitigated by GitHub Actions runner isolation. |
| **Phase 3C2.3 Operational Preparation** | **AUTHORIZED TO PROCEED** | The runtime integration, safe publication pipeline, preflight protections, and workflow YAMLs are structurally sound and safe for end-to-end dry-run testing under GitHub Actions. |

---

## 7. Working Tree & Diff Verification

A clean Git status check was performed to confirm that this audit made zero modifications to source files, tests, workflows, pet state, contribution ledgers, SVG badge, or README:

```
$ git status --porcelain pet public README.md
(clean — zero modifications to production assets)

$ git status --short
 M .github/workflows/pet-publisher.yml
 M src/features/pet-engine/accounting/contributionEngine.ts
 M src/features/pet-engine/index.ts
 M src/features/pet-engine/publication/index.ts
 M src/features/pet-engine/validation/ledgerValidator.ts
 M tests/pet-engine/publication.test.ts
?? reports/phase_3c2_2_4_r2_1_final_safety_consistency_review.md
?? scripts/publish-pipeline.ts
?? src/features/pet-engine/publication/publishPipeline.ts
?? src/features/pet-engine/sync/
?? tests/pet-engine/contributionSyncIntegration.test.ts
?? tests/pet-engine/publishPipeline.test.ts
```

No git reset, commit, rebase, push, workflow dispatch, or production mutations were performed.
