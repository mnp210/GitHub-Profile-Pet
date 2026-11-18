# GitHub Profile Pet — Production Recovery and Rollback Runbook

**Document ID:** `docs/operations/recovery-and-rollback.md`  
**Milestone:** Phase 3C2.3-A.2 (Final Operational Recovery, Documentation Acceptance & Path A Hardening Reconciliation)  
**Target Repository:** `mnp210/GitHub-Profile-Pet`  
**Status:** Approved Reference  

---

## 1. Architectural Recovery Principles

The GitHub Profile Pet runtime maintains a strict dichotomy between **External Provider Failures** and **Local Integrity Failures**:

### 1.1 Provider Failure vs. Local Integrity Failure
- **Provider Failure (External Network/API):**
  - Occurs when GitHub's GraphQL API times out, returns HTTP 5xx, or exhausts rate-limit quota.
  - *Accounting Behavior:* Fails open to safety — **skips accounting with strictly zero ledger mutation**.
  - *Simulation Behavior:* Passive inactivity simulation (hunger/happiness decay, energy restoration) **proceeds independently** so the pet's natural clock does not freeze.
  - *Publication Behavior:* Proceeds with passive simulation updates and SVG badge rendering if vitals shifted.
- **Local Integrity Failure (Corrupt File/Ledger/Schema/Identity):**
  - Occurs when ledger documents are corrupt, authoritative files are missing, numeric database IDs disagree, or generation counters conflict.
  - *Behavior:* **Fails closed immediately.** Accounting, simulation, and publication are completely halted. The runner exits with a non-zero code.
  - *Golden Rule:* **Established ledgers, ordinals, and baseline records must NEVER be reconstructed or reset automatically.** Human operator intervention is required to avoid silent state corruption or duplicate rewards.

---

## 2. Comprehensive 15-Scenario Failure Recovery Matrix

| # | Failure Scenario | Detection Signal | Simulation Allowed? | Accounting Allowed? | Publication Allowed? | Auto Retry? | Human Intervention? | Critical Invariant: What Must NEVER Be Done |
|---|---|---|:---:|:---:|:---:|:---:|:---:|---|
| **1** | **Provider Timeout** | `GitHubTimeoutError` (request exceeds bounded 15s timeout) | **YES** (passive) | **NO** (zero mutation) | **YES** (if simulation changed) | No (next hour) | No | Never record a synthetic zero snapshot. |
| **2** | **GraphQL Rate Limit** | Points remaining $< 50$ (evaluated against 1,000 pt/hr planning ceiling) | **YES** (passive) | **NO** (deferred cleanly) | **YES** (if simulation changed) | No (waits for quota) | No | Never consume quota below safety threshold. |
| **3** | **Owner Identity Mismatch** | `IdentityMismatchError` (database ID or login mismatch) | **NO** | **NO** | **NO** | No | **YES** | Never bind a new owner database ID to an established ledger. |
| **4** | **Organization Account** | `OrganizationAccountError` (`__typename == "Organization"`) | **NO** | **NO** | **NO** | No | **YES** | Never award contribution rewards to organization accounts. |
| **5** | **Incomplete GraphQL Response** | `InvalidContributionDataError` (null categories or dates) | **YES** (passive) | **NO** (zero mutation) | **YES** (if simulation changed) | No (next hour) | No | Never guess missing counts or treat null as zero. |
| **6** | **Corrupt Ledger Document** | `LedgerIntegrityError` (fails schema or conservation) | **NO** | **NO** | **NO** | No | **YES** | Never auto-delete or re-initialize an established ledger. |
| **7** | **Missing Authoritative File** | `missing_authoritative_file` (missing state/ledger/SVG) | **NO** | **NO** | **NO** | No | **YES** | Never auto-generate blank replacement files on established repos. |
| **8** | **Corrupt Reward Ordinal** | `CorruptOrdinalError` (ordinal counter missing or invalid) | **NO** | **NO** | **NO** | No | **YES** | Never reset ordinals to zero after baseline establishment. |
| **9** | **Expired Increments** | `now >= expiry_at` (UTC discovery midnight + 48h) | **YES** | **YES** (forfeits expired) | **YES** | Yes (automatic) | No | Never grant grace periods or resurrect expired increments. |
| **10** | **Interrupted Journal** | Directory `pet/.journal/` detected on startup | **YES** (after recovery) | **YES** (after recovery) | **YES** | Yes (auto-recovery) | No | Never leave uncommitted journal files active on disk. |
| **11** | **Generation Conflict** | `GenerationConflictError` or Stage 1 Fence Conflict | **NO** | **NO** | **NO** | No | No (fresh checkout) | Never force-write or ignore generation mismatches. |
| **12** | **Remote Push Rejection** | `status: 'push_rejected'` (non-fast-forward rejection) | **NO** (rolled back) | **NO** (rolled back) | **NO** (rolled back) | No (next hour) | No | Never blind rebase or force-push (`--force`) state documents. |
| **13** | **Publication Failure Post-Commit** | Git commit succeeded locally but push network error | **NO** (rolled back) | **NO** (rolled back) | **NO** (rolled back) | No (next hour) | No | Never leave unpushed local commits in working clone. |
| **14** | **Concurrency Queue Stalling** | Runner queue wait time or replaced pending run | **YES** (next run) | **YES** (next run) | **YES** (next run) | Yes (next schedule) | No | Never bypass the shared concurrency group. |
| **15** | **Workflow Schedule Inactivity** | GitHub Actions 60-day repository cron disablement | **NO** (workflow paused) | **NO** (workflow paused) | **NO** (workflow paused) | No | **YES** (re-enable via UI/CLI/API) | Never allow crons to remain disabled unnoticed. |

---

## 3. Test Coverage & Verification Status for the 15 Scenarios

To maintain complete audit integrity, test coverage for the 15 recovery scenarios is explicitly classified into verified categories:

| Scenario | Classification | Evidence & Reported Result |
|---|---|---|
| **1. Provider Timeout** | **Automated regression test exists** | `twoDayContributionProvider.test.ts` (`TC-2DAY-NET-01` PASS): Bounded timeout throws `GitHubTimeoutError`. |
| **2. GraphQL Rate Limit (< 50 pts)** | **Automated regression test exists** | `contributionSyncIntegration.test.ts` (`TC-SYNC-05` PASS): Points below 50 defers cleanly with status `'deferred'` and zero ledger mutation. Safe planning ceiling is 1,000 pt/hr. |
| **3. Owner Identity Mismatch** | **Automated regression test exists** | `twoDayContributionProvider.test.ts` (`TC-2DAY-ID-02`, `03`, `08`, `09` PASS), `contributionSyncIntegration.test.ts` (`TC-SYNC-03`, `06` PASS): Rejects database ID/login mismatch with `IdentityMismatchError`. |
| **4. Organization Account Detected** | **Automated regression test exists** | `twoDayContributionProvider.test.ts` (`TC-2DAY-ID-04` PASS), `contributionSyncIntegration.test.ts` (`TC-SYNC-02` PASS): Primary query rejects organization with `OrganizationAccountError`. |
| **5. Incomplete GraphQL Response** | **Automated regression test exists** | `twoDayContributionProvider.test.ts` (`TC-2DAY-INC-01` through `04` PASS): Null collections or missing breakdowns throw `InvalidContributionDataError`. |
| **6. Corrupt Contribution Ledger** | **Automated regression test exists** | `contributionAccounting.test.ts` (Test 19 PASS), `capThrottleAudit.test.ts` (Scenarios 4–5 PASS): Throws `LedgerIntegrityError` on corrupt ledger. |
| **7. Missing Authoritative File** | **Automated regression test exists** | `publishPipeline.test.ts` (`TC-PUSH-F03-01` through `05` PASS): Missing `pet.json`, `contributions.json`, `actions.json`, or `pet.svg` aborts with `missing_authoritative_file`; zero auto-replacement. |
| **8. Missing/Corrupt Reward Ordinal** | **Automated regression test exists** | `contributionAccounting.test.ts` (Test 18 PASS): Missing or non-sequential established ordinal throws `CorruptOrdinalError`. |
| **9. Expired Pending Increments** | **Automated regression test exists** | `contributionAccounting.test.ts` (Test 9 PASS): Increments evaluated at $\ge \text{discovery UTC midnight} + 48\text{h}$ are expired and forfeited. |
| **10. Persistence Journal Interruption** | **Automated regression test exists** | `localPersistence.test.ts` (Tests 6–10 PASS), `capThrottleAudit.test.ts` (Scenario 7 PASS): Rolls forward committed metadata; rolls back preparing metadata. |
| **11. Generation Conflict** | **Automated regression test exists** | `publishPipeline.test.ts` (`TC-PUSH-05` PASS Stage 1 fence), `contributionAccounting.test.ts` (Test 17 PASS `GenerationConflictError`). |
| **12. Remote Fast-Forward Push Rejection** | **Automated regression test exists** | `publishPipeline.test.ts` (`TC-PUSH-01`, `TC-PUSH-02`, `TC-PUSH-F01-04` PASS), `inboxPublication.test.ts` (TC-INBOX-PUB-01, 02 PASS): Exits `push_rejected`, resets to source commit $S_0$; zero blind rebase or force-push. |
| **13. Post-Commit Publication Failure** | **Automated regression test exists** | `publishPipeline.test.ts` (`TC-PUSH-08` PASS), `durableFeedbackCompletion.test.ts` (`TC-INBOX-COMPL-08`, `09`, `10` PASS): Network failure rolls back local commit; unpushed commit SHA is not recorded as published. |
| **14. Concurrency Queue Stalling** | **Documented operational procedure exists; automated coverage not established** | Concurrency queuing behavior is an inherent property of GitHub Actions runner infrastructure; live queue eviction is not simulated in unit suites. |
| **15. 60-Day Workflow Inactivity** | **Documented operational procedure exists; automated coverage not established** | 60-day inactivity suspension is an external GitHub platform policy; verified via documented manual UI/CLI/API re-enablement procedure. |

---

## 4. Specific Operational Procedures

### Procedure 1: Handling Non-Fast-Forward Push Rejection in Path B & Path A (Scenario 12)
- **Signal:** Log outputs `Publication Conflict: Git server rejected non-fast-forward push`.
- **Cause:** A concurrent workflow or external push updated `main` while processing was underway.
- **Automated Response:** The pipeline executes `git reset --hard sourceCommitSha`. Local unpushed commit is discarded. Working tree returns to clean initial state.
- **Safety Qualification:** `git reset --hard` is safe exclusively under the isolated GitHub Actions runner model where no concurrent processes or human edits exist on the runner filesystem. Local CLI execution must not be treated as universally safe if concurrent local edits occur.
- **Operator Action:** None required. The next scheduled hourly run automatically performs a fresh `git checkout` of the new remote HEAD, ingests the updated generation, and recomputes deterministically.

### Procedure 2: Handling Journal Interruption Recovery (Scenario 10)
- **Signal:** Log outputs `Recovered uncommitted journal` or `Rolled forward committed transaction`.
- **Cause:** Previous runner process died abruptly (SIGKILL or out-of-memory) during `saveRepositoryState()`.
- **Automated Response:**
  - If `pet/.journal/meta.json` has `status: 'committed'`, files are rolled forward to target generation.
  - If `status: 'preparing'` or meta is missing, files are rolled back to source generation.
  - The `.journal/` directory is purged.
- **Operator Action:** Confirm that generation numbers across `pet/state/pet.json`, `pet/ledger/contributions.json`, and `pet/ledger/actions.json` are identical.

### Procedure 3: Handling Missing Authoritative Files (Scenario 7)
- **Signal:** Pipeline preflight fails with status `'missing_authoritative_file'` and lists missing paths.
- **Cause:** Accidental deletion, misconfigured git sparse-checkout, or corrupted branch.
- **Operator Action:**
  1. Inspect Git history for the last valid commit on `main`:
     ```bash
     git log -n 5 --stat
     ```
  2. Restore the missing file from the authoritative commit:
     ```bash
     git checkout HEAD~1 -- pet/state/pet.json
     ```
  3. Validate ledger schema before committing restoration:
     ```bash
     npm run test:pet-engine
     ```

### Procedure 4: Handling 60-Day Workflow Inactivity Disablement (Scenario 15)
- **Signal:** Scheduled crons stop firing. No runs appear in Actions tab at minute 47.
- **Cause:** GitHub automatically disables scheduled workflows on public repositories that have seen no commit activity for 60 consecutive days.
- **Correct Re-Enablement Procedure:**
  > [!IMPORTANT]
  > Triggering `workflow_dispatch` **does NOT re-enable** an automatically disabled scheduled workflow. The workflow must be explicitly re-enabled through one of the approved platform management interfaces before the schedule will resume.

  1. **Identify Affected Workflows:** Identify which scheduled workflows were paused (`pet-publisher.yml` and/or `pet-interaction.yml`).
  2. **Re-Enable via Approved Interface:**
     - **Option A (GitHub Web UI):** Navigate to **Actions** tab $\rightarrow$ select the affected workflow $\rightarrow$ click the banner prompt **Enable workflow**.
     - **Option B (GitHub CLI):** Execute:
       ```bash
       gh workflow enable pet-publisher.yml
       gh workflow enable pet-interaction.yml
       ```
     - **Option C (REST API):** Call:
       ```bash
       PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable
       ```
  3. **Confirm Workflow Status:** Verify that `gh workflow list` reports the workflows as `active`.
  4. **Verify Subsequent Scheduled Execution:** Check the Actions execution tab after the next scheduled hourly cron window (`:47`) to confirm automated triggering resumed.
  5. **Investigate Actor State if Inactive:** If scheduled execution still does not resume after re-enablement, verify the status of the repository owner/actor account (e.g. account suspension, billing restrictions, or revoked workflow permissions).
  - *Diagnostic Dispatch Distinction:* Manual execution via `workflow_dispatch` remains available as an independent manual diagnostic or catch-up trigger to verify runner environment health, but it does not alter workflow enable/disable state.
- **Eventual Recovery Semantics:**
  > The durable Issue inbox and subsequent recovery sweeps provide eventual recovery opportunities, subject to GitHub Actions availability, scheduling delays, and concurrency contention.

---

## 5. Path A Hardened Two-Commit Publication Safety (Phases 3C2.3-B0, B0.1, B0.1-R2)

In Phases 3C2.3-B0, B0.1, and B0.1-R2, Path A's interaction publication was transitioned from a legacy shell script rebase approach to a hardened, fully tested TypeScript publication pipeline (`src/features/pet-engine/publication/inboxPublicationPipeline.ts`):

### 5.1 Elimination of Blind Rebase and Merge Conflicts
1. **Fast-Forward Only:** Path A executes strict fast-forward pushes (`git push origin HEAD:${targetBranch}`). Zero blind rebase, zero merge commits, and zero force-push.
2. **Remote Generation Fence:** Before staging or committing state files, Path A calls `checkRemoteGenerationFence()` to verify that remote HEAD matches the expected source commit and generation. If remote movement is detected, local processing aborts cleanly.

### 5.2 Two-Commit Transaction Lifecycle
Path A separates external side effects from state transitions using a two-commit protocol:

1. **Phase 1 Commit & Push (Core Vitals & Deduplication):**
   - Applies care transitions to `pet/state/pet.json`.
   - Records the action in `processedRequestRegistry` and stages an initial `pendingFeedback` entry in `pet/ledger/actions.json`.
   - Advances generation lockstep $G \to G+1$ and atomically saves files via local journal.
   - Pushes Phase 1 commit via fast-forward push.
   - *Failure Boundary 1:* If Phase 1 push fails or is rejected, the pipeline executes `git reset --hard sourceCommitSha`. The GitHub Issue remains open with `pet-action:pending`. Zero feedback comment has been posted. The next sweep cleanly retries the action from the updated remote HEAD.

2. **External Delivery Phase:**
   - Once Phase 1 is durably committed on remote `main`, the runner calls GitHub's REST API:
     - `createComment()` posts the markdown feedback comment.
     - `closeIssue()` closes the issue and applies the completion/rejection label.
   - Captures exact `deliveredAt` timestamp and asserts `closureConfirmed = true`.

3. **Phase 2 Commit & Push (Feedback Completion & Compaction):**
   - Records `feedbackDelivered: true`, `closureConfirmed: true`, and `deliveredAt` in `pendingFeedback`.
   - Applies bounded 7-day compaction: records older than 7 days (604,800,000 ms) with confirmed closure are pruned. The permanent `processedRequestRegistry` is strictly preserved.
   - Advances generation lockstep $G+1 \to G+2$ and creates Phase 2 commit.
   - Pushes Phase 2 commit via fast-forward push.
   - *Failure Boundary 2:* If Phase 2 push fails or network drops, the local clone executes `git reset --hard phase1CommitSha`. The remote already holds Phase 1 (action recorded in `processedRequestRegistry`!).
   - *Eventual Recovery on Next Sweep:* The next sweep discovers the pending feedback item. Because `isRequestProcessed()` evaluates to `true`, **care transitions, XP, and satiety are NEVER re-applied**. The recovery engine merely re-checks comment delivery/closure confirmation, commits Phase 2, and pushes.
   - *Ambiguous Push Recovery:* In the event of network disruption where the Git server accepted the push but the runner received an error (verified via `ECONNRESET` injection test `TC-INBOX-COMPL-10`), subsequent sweeps inspect remote state and resume cleanly without duplicate effects.
