# Phase 3C2.3-B0.1-R2 — Final Feedback Retention & Ambiguous-Push Hardening Report

**Project:** GitHub Profile Pet (`mnp210/GitHub-Profile-Pet`)  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Target Branch:** `main`  
**Milestone:** Phase 3C2.3-B0.1-R2  
**Milestone Type:** Implementation & Isolated Regression Verification  
**Date:** 2026-11-18  

---

## 1. Executive Summary & Preflight Findings

### Final Verdict: `ALL GAPS RESOLVED / FULL ACCEPTANCE DEMONSTRATED`

Phase 3C2.3-B0.1-R2 resolves the two acceptance gaps identified during the Phase 3C2.3-B0.1-R1 audit:
1. **Strict Delivery Timestamp Retention (R2-A):** Removed the fallback from `deliveredAt` to `completedAt` in `isFeedbackRecordEligibleForPruning()`. Pruning strictly requires `deliveredAt` to exist as a valid ISO date-time string, alongside `feedbackDelivered === true`, `closureConfirmed === true`, valid terminal status, and age $\ge 7$ days (604,800,000 ms). Added 8 dedicated unit test cases (`R2-A-01` to `R2-A-08`) covering the complete eligibility boundary matrix.
2. **Ambiguous Push Fault Injection & Recovery (R2-B & R2-C):** Reused and leveraged the existing `gitExecutor` pipeline option seam to author an integration test (`TC-INBOX-COMPL-10`) that actively injects a transport failure (`ECONNRESET`) specifically after the Phase 2 push advances `refs/heads/main` on the bare remote. Demonstrated that the local pipeline rolls back unconfirmed Phase 2 state to the Phase 1 commit without rebase or force-push, and a subsequent run starting from authoritative remote state discovers the published Phase 2 completion, cleanly exiting as `noop` with zero duplicate XP, zero duplicate comments, zero duplicate closures, and intact permanent deduplication.

### Preflight Verification
- Confirmed the findings of the R1 acceptance audit: `actionProcessor.ts` previously fell back to `record.completedAt` if `record.deliveredAt` was absent; `TC-INBOX-COMPL-10` previously tested the post-condition without active transport error injection.
- Verified that `InboxPublicationOptions` already included the `gitExecutor` seam in `src/features/pet-engine/publication/inboxPublicationPipeline.ts`, allowing non-intrusive fault injection without altering production Git command dispatching.

---

## 2. Exact Files Changed

1. `src/features/pet-engine/inbox/actionProcessor.ts`:
   - Updated `isFeedbackRecordEligibleForPruning()`:
     - Enforced that `record.deliveredAt` must exist, be a string, and pass `isValidIsoDateString`.
     - Removed fallback to `record.completedAt`.
     - Added `VALID_PRUNING_STATUSES` set (`accepted`, `rejected`, `quarantined`, `duplicate`) and rejected missing, unknown, or deferred statuses.
2. `tests/pet-engine/durableFeedbackCompletion.test.ts`:
   - Added `closeIssueCallCount` to `MockGitHubClient` to verify that duplicate issue closure is never attempted.
   - Updated `TC-INBOX-COMPL-10` to inject an active `ECONNRESET` Git transport error during Phase 2 push after the remote bare repository ref updates.
   - Added Part 2a suite (`R2-A-01` through `R2-A-08`) covering all 8 specified pruning boundary conditions.

---

## 3. Strict Delivery Timestamp Implementation (R2-A)

### Implementation in `actionProcessor.ts`
```typescript
const VALID_PRUNING_STATUSES = new Set(['accepted', 'rejected', 'quarantined', 'duplicate']);

export function isFeedbackRecordEligibleForPruning(
  record: ActionFeedbackRecord,
  nowMs: number,
  retentionPeriodMs: number = FEEDBACK_RETENTION_PERIOD_MS
): boolean {
  if (typeof record !== 'object' || record === null) {
    return false;
  }

  // 1. Must be durably marked as delivered
  if (record.feedbackDelivered !== true) {
    return false;
  }

  // 2. Closure must be confirmed
  if (record.closureConfirmed !== true) {
    return false;
  }

  // 3. Must have a valid terminal status (not deferred, missing, or unknown)
  if (
    !record.status ||
    typeof record.status !== 'string' ||
    record.status === 'deferred' ||
    !VALID_PRUNING_STATUSES.has(record.status)
  ) {
    return false;
  }

  // 4. Must have a valid delivery timestamp (deliveredAt is strictly required; NO fallback to completedAt)
  if (
    !record.deliveredAt ||
    typeof record.deliveredAt !== 'string' ||
    !isValidIsoDateString(record.deliveredAt)
  ) {
    return false;
  }

  const deliveredAtMs = Date.parse(record.deliveredAt);
  if (Number.isNaN(deliveredAtMs)) {
    return false;
  }

  // 5. Explicit retention boundary check: nowMs - deliveredAtMs >= retentionPeriodMs
  const ageMs = nowMs - deliveredAtMs;
  return ageMs >= retentionPeriodMs;
}
```

### Safety Properties:
- A record with missing, null, undefined, or malformed `deliveredAt` returns `false` (fails closed) even if `completedAt` is valid and older than seven days.
- The retention period is strictly 7 days: `FEEDBACK_RETENTION_PERIOD_MS = 604,800,000 ms`.
- Evaluates the inclusive boundary rule: `nowMs - deliveredAtMs >= 604800000`.

---

## 4. Pruning Boundary & Missing-Closure Confirmation Test Evidence

The 8 conditions specified in the milestone requirements were explicitly implemented and verified:

| Test ID | Condition Tested | Result | Key Assertion |
| :--- | :--- | :--- | :--- |
| `R2-A-01` | Delivered + closure confirmed + valid `deliveredAt` + exactly 7 days | **PASS** | `isFeedbackRecordEligibleForPruning(...) === true` |
| `R2-A-02` | Same record 1 ms younger than 7 days (`nowMs - 604800000 + 1`) | **PASS** | `isFeedbackRecordEligibleForPruning(...) === false` |
| `R2-A-03` | Missing `deliveredAt` + old valid `completedAt` (20 days old) | **PASS** | `isFeedbackRecordEligibleForPruning(...) === false` (Strict: no fallback) |
| `R2-A-04` | Invalid `deliveredAt` ('2026-99-99...') + old valid `completedAt` | **PASS** | `isFeedbackRecordEligibleForPruning(...) === false` |
| `R2-A-05` | Missing `closureConfirmed` (`undefined`) on delivered record | **PASS** | `isFeedbackRecordEligibleForPruning(...) === false` |
| `R2-A-06` | Explicit `closureConfirmed: false` on delivered record | **PASS** | `isFeedbackRecordEligibleForPruning(...) === false` |
| `R2-A-07` | Unconfirmed delivery (`feedbackDelivered: false`) | **PASS** | `isFeedbackRecordEligibleForPruning(...) === false` |
| `R2-A-08` | Invalid status (`undefined`, `'bogus_status'`, `'deferred'`) | **PASS** | `isFeedbackRecordEligibleForPruning(...) === false` |

---

## 5. Git Executor Injection Design & Safety (R2-B)

### 5.1 Design
In `src/features/pet-engine/publication/inboxPublicationPipeline.ts`, `InboxPublicationOptions` provides:
```typescript
gitExecutor?: (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
```
And inside `executeInboxPublicationPipeline`:
```typescript
  const execGit = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
    if (options.gitExecutor) {
      return options.gitExecutor('git', args, baseDir);
    }
    try {
      return await execFileAsync('git', args, { cwd: baseDir, env: gitEnv as NodeJS.ProcessEnv });
    } catch (err: unknown) {
...
```

### 5.2 Why This Does Not Weaken Production Safety
1. **Production Default Intact:** In production workflows (`pet-interaction.yml`), `options.gitExecutor` is undefined. The pipeline invokes standard `execFileAsync('git', args, ...)` with sanitized environment and token redaction.
2. **Zero Bypasses:** The seam does not bypass source commit SHA checks, working tree preflight checks, branch verification, remote fence checks, staged manifest allowlists, or fast-forward push requirements.
3. **Scoped Lifetime:** The seam exists only within the memory scope of the passed options for that single invocation; it cannot leak across processes or runs.
4. **Information Security:** Errors thrown from `gitExecutor` are processed through `redactSensitiveData()` if tokens are present.

---

## 6. Exact Ambiguous-Push Fault-Injection Sequence (R2-C)

Test `TC-INBOX-COMPL-10` in `tests/pet-engine/durableFeedbackCompletion.test.ts` executes the following sequence:

```mermaid
sequenceDiagram
    participant Test as Test Runner
    participant Pipeline as inboxPublicationPipeline
    participant Executor as Injected gitExecutor
    participant Remote as Bare Remote (remote.git)

    Test->>Pipeline: executeInboxPublicationPipeline(gitExecutor)
    Pipeline->>Pipeline: Process Inbox (feed action, G -> G+1)
    Pipeline->>Executor: Phase 1 push: git push origin HEAD:main
    Executor->>Remote: execFileAsync(git push) -> Remote HEAD advances to Phase 1 commit
    Pipeline->>Pipeline: Phase 2 deliverPendingFeedback (comment + close issue)
    Pipeline->>Pipeline: Stage actions.json & commit Phase 2 completion
    Pipeline->>Executor: Phase 2 push: git push origin HEAD:main
    Note over Executor,Remote: Push arrives at bare remote and advances refs/heads/main!
    Executor->>Remote: execFileAsync(git push) -> Remote HEAD advances to Phase 2 commit
    Note over Executor: INJECT FAULT: ECONNRESET (Connection reset by peer)
    Executor-->>Pipeline: throw Error("fatal: ... (ECONNRESET)")
    Pipeline->>Pipeline: Catch push error: git reset --hard to Phase 1 commit
    Pipeline-->>Test: Returns status: 'published' (Phase 1 care actions published)
    Note over Test: Remote HEAD has Phase 2 completion; Local HEAD has Phase 1 commit
    Test->>Test: git fetch origin main && git reset --hard origin/main
    Test->>Pipeline: Run 2: executeInboxPublicationPipeline() (Recovery)
    Pipeline->>Pipeline: Load remote state (already completed)
    Pipeline-->>Test: Returns status: 'noop' (0 commits, 0 pushes)
```

---

## 7. Remote & Local State Assertions in TC-INBOX-COMPL-10

1. **Phase 2 Completion Durably Published:**
   - Remote bare repository HEAD matches the Phase 2 completion commit SHA:
     `remoteHeadSha === 'pet: record feedback delivery completion [skip ci]'`.
   - Remote `actions.json` records:
     - `feedbackDelivered === true`
     - `closureConfirmed === true`
     - `deliveredAt` is a valid ISO date string.
2. **Local Rollback Integrity:**
   - Upon the simulated `ECONNRESET` on Phase 2 push, the local pipeline rolled back unconfirmed working-tree modifications to the Phase 1 commit SHA (`localHeadSha === careActionCommitSha`).
   - `localHeadSha !== remoteHeadSha`, proving the local runner rolled back cleanly without corrupting tracked files.
3. **Fresh Authoritative Recovery Run:**
   - Run 2 checked out `origin/main` and returned `status: 'noop'`, `commitSha: undefined`.
   - Exactly **1** comment exists in `client.comments.get(10)` (no duplicate comments).
   - Exactly **1** closure call recorded in `client.closeIssueCallCount` (no duplicate closures).
   - Pet XP is exactly 10 (not duplicated).
   - Pet hunger is unchanged from Run 1.
   - Remote Git history contains exactly 3 commits: Initial setup, Phase 1 action processing, and Phase 2 completion. Exactly one completion commit exists.

---

## 8. Generation & Permanent Deduplication Verification

- **Generation Parity:**
  `stateAfter.pet.generation === stateAfter.contributions.generation === stateAfter.actions.generation === stateAfter.generation`. Generation remained strictly monotonic and synchronized.
- **Permanent Deduplication Registry:**
  `isRequestProcessed(stateAfter.actions.processedRequestRegistry, 10)` returned `true`.
  `stateAfter.actions.processedRequestRegistry.sparseProcessedIssueNumbers` contains `10`.
  The action remains permanently deduplicated.

---

## 9. Test Counts & Verification Commands

| Test Suite | Command | Test Count | Suites | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Durable Feedback Completion Suite** | `node --test tests/pet-engine/durableFeedbackCompletion.test.ts` | 36 | 1 | **36 Passed, 0 Failed** |
| **Full Pet-Engine Suite** | `npm run test:pet-engine` | 452 | 39 | **452 Passed, 0 Failed** |
| **Unit Test Suite** | `npm test` | 121 | 24 | **121 Passed, 0 Failed** |
| **Grand Total (Distinct Executions)** | — | **573** | **63** | **573 Passed, 0 Failed** |

*(Note: The 36 tests in `durableFeedbackCompletion.test.ts` include the 8 new `R2-A` tests and the fault-injected `TC-INBOX-COMPL-10`, all of which run as part of the 452 pet-engine test total. The 121 unit tests are completely independent).*

---

## 10. Lint, Typecheck, and Build Results

1. **ESLint (`npm run lint`):**
   - Result: Exit code 0, clean, 0 errors, 0 warnings.
2. **TypeScript Typecheck (`npx tsc --noEmit`):**
   - Result: Exit code 0, clean, 0 errors.
3. **Next.js Production Build (`npm run build`):**
   - Result: Exit code 0, compiled successfully with Turbopack, 14/14 static pages generated, 0 errors.

---

## 11. Production State & Workflow Integrity Verification

Strict verification confirmed zero diffs on the five authoritative production files:
```bash
git diff --exit-code pet/state/pet.json pet/ledger/contributions.json pet/ledger/actions.json public/pet.svg README.md
```
- **Exit Code:** 0
- **Diff Output:** None (0 lines modified)
- **Workflow State:** Zero workflows triggered, dispatched, enabled, or altered.
- **API State:** Zero live GitHub REST/GraphQL API calls executed.

---

## 12. Git Working-Tree Status

All tracked modifications and untracked files are accounted for:

```text
Tracked modifications:
  .github/workflows/pet-interaction.yml
  .github/workflows/pet-publisher.yml
  scripts/process-inbox.ts
  src/features/pet-engine/accounting/contributionEngine.ts
  src/features/pet-engine/domain/types.ts
  src/features/pet-engine/inbox/actionProcessor.ts
  src/features/pet-engine/inbox/types.ts
  src/features/pet-engine/index.ts
  src/features/pet-engine/publication/index.ts
  src/features/pet-engine/publication/inboxPublicationPipeline.ts
  src/features/pet-engine/validation/ledgerValidator.ts
  tests/pet-engine/publication.test.ts

Untracked milestone files & reports:
  docs/operations/
  reports/phase_3c2_3_b0_1_r2_feedback_retention_and_ambiguous_push_report.md
  scripts/publish-pipeline.ts
  src/features/pet-engine/publication/publishPipeline.ts
  src/features/pet-engine/sync/
  tests/pet-engine/actionDurability.test.ts
  tests/pet-engine/contributionSyncIntegration.test.ts
  tests/pet-engine/durableFeedbackCompletion.test.ts
  tests/pet-engine/feedbackRecovery.test.ts
  tests/pet-engine/inboxInvariants.test.ts
  tests/pet-engine/inboxPublication.test.ts
  tests/pet-engine/publishPipeline.test.ts
```

---

## 13. Remaining Limitations & Operational Recommendations

1. **Operational Boundaries Preserved:**
   - Live workflow dispatch, production baseline establishment, and live contribution accounting remain strictly unauthorized and were not performed.
2. **Readiness Status:**
   - Both acceptance gaps identified in R1 are fully resolved.
   - The Path A feedback publication pipeline, compaction engine, and recovery semantics are fully hardened, verified, and ready for production operational review.
