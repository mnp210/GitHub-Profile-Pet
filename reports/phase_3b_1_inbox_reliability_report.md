# Phase 3B.1 Engineering Report: Durable Inbox Recovery & Issue Integrity Hardening

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Architecture:** Sprint 2.7.4 — GitHub-native, self-hosted per user  
**Status:** Complete & Fully Verified  
**Date:** 2026-11-16  

---

## 1. Executive Summary

Phase 3B.1 resolves the reliability and security gaps identified during the Phase 3B review. Specifically, this hardening milestone:
1. Implements automatic scheduled inbox sweeps (`cron: '47 * * * *'`) in `.github/workflows/pet-interaction.yml` to prevent pending actions from being permanently stranded if GitHub replaces a queued workflow run.
2. Replaces the 10-second grace-period heuristic with conservative, deterministic post-creation edit eligibility rules (`created_at === updated_at` for delayed scans; verified creation events for immediate triggers).
3. Verifies persistent idempotency and feedback recovery across all five crash-interruption boundaries, guaranteeing that accepted actions mutate gameplay state at most once, and allowing recovery sweeps to complete outstanding feedback (comment/close) without repeating gameplay mutations.
4. Aligns repository-wide concurrency behavior across `pet-publisher.yml` and `pet-interaction.yml`, verifying that publication and state mutation cannot race.

---

## 2. Scheduled Recovery & Concurrency Architecture

### 2.1 Scheduled Inbox Recovery Sweep
- **Trigger Added:** `.github/workflows/pet-interaction.yml` now includes:
  ```yaml
  on:
    issues:
      types: [opened]
    schedule:
      # Hourly durable inbox recovery sweep (minute 47 to avoid hour-boundary runner spikes)
      - cron: '47 * * * *'
    workflow_dispatch:
  ```
- **Job Guard Updated:**
  ```yaml
  if: >
    github.event_name == 'schedule' ||
    github.event_name == 'workflow_dispatch' ||
    contains(github.event.issue.labels.*.name, 'pet-action:pending')
  ```
- **Best-Effort Scheduling Semantics:** Documented explicitly in the workflow that GitHub Actions scheduled workflows execute on a best-effort basis, subject to platform queue availability, and do not guarantee real-time wall-clock execution.
- **Repository-Wide Drainage:** Each invocation of `processInbox()` fetches all open issues bearing `pet-action:pending` via `listPendingIssues()`. It drains all pending actions in ascending chronological order (`created_at ASC, number ASC`), not merely the single issue that triggered the event.

### 2.2 Concurrency Group & Event Replacement Safety
- **Unified Group:** Both `pet-publisher.yml` and `pet-interaction.yml` share the identical repository concurrency group:
  ```yaml
  concurrency:
    group: pet-runtime-${{ github.repository }}
    cancel-in-progress: false
  ```
- **Concurrency Invariant:** State mutations, SVG publication, and README updates can never run concurrently.
- **Queue Replacement Recovery:** In GitHub Actions, when `cancel-in-progress: false` is configured, GitHub maintains at most 1 active running job and 1 queued pending job. If multiple issue events arrive rapidly, GitHub may replace the older pending run with the latest run. Because `processInbox()` drains the entire open pending queue, and because the scheduled sweep runs hourly, no action is permanently stranded even under severe webhook replacement.

---

## 3. Conservative Post-Creation Edit Eligibility

### 3.1 Elimination of Grace-Period Heuristic
The previous `MAX_CREATION_JITTER_MS = 10_000` rule has been completely removed. It is no longer possible for an attacker or player to edit an issue payload within 10 seconds of creation to evade detection.

### 3.2 Authoritative Eligibility Rules
Implemented in `src/features/pet-engine/inbox/issueParser.ts`:
1. **Immediate Creation Event Fast-Path:** When `options.isCreationEvent === true` (verified from an `issues: [opened]` event where `github.event.action === 'opened'`), the creation snapshot is validated directly.
2. **Delayed Scanner / Scheduled Sweep Verification:** When scanned via the REST API or scheduled sweep (`!options.isCreationEvent`):
   - The parser inspects `issue.created_at` and `issue.updated_at`.
   - Requires:
     - Both timestamps must be valid, positive dates (`!isNaN(createdAtMs) && !isNaN(updatedAtMs)`).
     - Millisecond timestamps must match exactly: `createdAtMs === updatedAtMs`.
     - Raw ISO timestamp strings must match exactly: `issue.created_at === issue.updated_at`.
   - If any difference exists (even 1 millisecond or 3 seconds), or if date strings are malformed, the issue is flagged as `status: 'edited_quarantined'`, closed with `pet-action:quarantine`, and retired in the deduplication registry without mutating gameplay state.
   - Unchanged delayed issues (e.g. created 4 hours ago, where `created_at === updated_at`) remain fully eligible.
3. **Post-Processing Tamper Resistance:** Once an issue has been processed, its number is permanently recorded in `processedRequestRegistry`. Any subsequent edit, label re-addition, or reopening is immediately identified as `already_processed` before parsing, completely blocking any second action execution or state mutation.

---

## 4. Crash-Boundary Idempotency & Feedback Recovery

The engine verifies and handles five distinct crash boundaries:

| Boundary | Crash Timing | Recovery Behavior | State Mutation Invariant |
|---|---|---|---|
| **Boundary 1** | Before state mutation | Active state remains at generation $N$. No journal exists. Subsequent sweep executes action normally. | Mutated exactly once ($N \to N+1$). |
| **Boundary 2** | During journal preparation | Uncommitted files in `.journal/target/` (missing `meta.json`). `recoverRepositoryState()` cleans stale journal before drainage. Subsequent sweep processes action from clean generation $N$. | Mutated exactly once ($N \to N+1$). |
| **Boundary 3** | After state commit, before comment | State committed at generation $N+1$. `processedRequestRegistry` contains issue number. Issue is open with `comments === 0`. Recovery sweep detects `already_processed`, posts feedback comment, and closes issue. | Mutated exactly once. Zero duplicate mutation. |
| **Boundary 4** | After comment, before close | State committed at generation $N+1$. Issue open with `comments === 1`. Recovery sweep detects `already_processed`, observes existing comment, avoids duplicate comment, and closes issue. | Mutated exactly once. Zero duplicate comment. |
| **Boundary 5** | After close, before subsequent sweep | Issue closed on GitHub. Closed issues are omitted from pending query. Action remains in registry. | Zero mutation. Clean no-op. |

### 4.1 Ledger Compaction Survival
`ProcessedRequestRegistry` maintains `highWaterIssueNumber` and `sparseProcessedIssueNumbers` as dedicated monotonic tracking sets. Even when `recentActions` is pruned or compacted to empty `[]`, `isRequestProcessed()` evaluates true for all past issues, guaranteeing permanent deduplication.

### 4.2 Ethical Rejection Guarantee
Rejected actions (e.g. full hunger) and quarantined actions (post-creation edit or malformed timestamps) never award XP, never mutate pet vitals, and never increment state generation.

---

## 5. Automated Verification Results

### 5.1 Test Suite Breakdown (`tests/pet-engine/inboxProcessing.test.ts`)
All 24 test cases pass:
- **TC-INBOX-01:** Verifies YAML schemas for all 4 Issue Forms (`feed`, `train`, `rest`, `pet`).
- **TC-INBOX-02:** Verifies least-privilege permissions, concurrency group, and scheduled recovery trigger.
- **TC-INBOX-03:** Pull Request rejection in shared issue number space.
- **TC-INBOX-04:** Non-pet issues without `pet-action:pending` ignored.
- **TC-INBOX-05:** Malformed / unknown action payloads rejected with `pet-action:invalid`.
- **TC-INBOX-06:** Conservative edit quarantine (edits within 10s, edits after 10s, unchanged delayed issues, ambiguous timestamps, creation event fast-path).
- **TC-INBOX-07:** Duplicate delivery processed at-most-once.
- **TC-INBOX-08:** 410 Gone vs 404 Ambiguous gap classification semantics.
- **TC-INBOX-09:** 403, 429, and 5xx errors treated as unresolved gaps.
- **TC-INBOX-10:** Out-of-order sparse tracking and deferred HWM advancement.
- **TC-INBOX-11:** Untrusted author rejection with `pet-action:unauthorized`.
- **TC-INBOX-12:** Gameplay rejection zero-mutation verification.
- **TC-INBOX-13:** Accepted feed action state mutation, comment, SVG publish, and issue closure.
- **TC-INBOX-14:** Interrupted journal recovery prior to drainage.
- **TC-INBOX-15:** Strict chronological ordering across multiple pending issues.
- **TC-INBOX-16:** Client construction and scanner integration.
- **TC-INBOX-17:** Interruption Boundary 1 (crash before state mutation).
- **TC-INBOX-18:** Interruption Boundary 2 (crash during journal preparation).
- **TC-INBOX-19:** Interruption Boundary 3 (crash after state commit before comment: feedback recovery delivers comment and closes issue without re-mutation).
- **TC-INBOX-20:** Interruption Boundary 4 (crash after comment before close: avoids duplicate comment and closes issue without re-mutation).
- **TC-INBOX-21:** Interruption Boundary 5 (crash after closure before subsequent sweep: clean no-op).
- **TC-INBOX-22:** Deduplication survives `recentActions` ledger compaction.
- **TC-INBOX-23:** Rejected and quarantined actions never receive gameplay rewards.
- **TC-INBOX-24:** Unified repository concurrency group alignment between publisher and interaction workflows.

### 5.2 Verification Gates Matrix

| Command | Status | Output Summary |
|---|---|---|
| `npm run test:pet-engine` | **PASSED** | 9 suites, 107 tests passed, 0 failed (1549ms) |
| `npm test` | **PASSED** | 24 suites, 121 tests passed, 0 failed (774ms) |
| `npm run test:all` | **PASSED** | 33 suites, 228 tests passed, 0 failed (1707ms) |
| `npm run lint` | **PASSED** | ESLint clean: 0 errors, 0 warnings |
| `npx tsc --noEmit` | **PASSED** | TypeScript clean: 0 errors |
| `npm run build` | **PASSED** | Next.js production build succeeded in 1112ms |
| `npm run render:svg` | **PASSED** | Clean: generated standalone SVG (12,441 bytes) |
| `npm run publish:pet` | **PASSED** | Clean: SVG & README publication verified |
| `npm run process:inbox` | **PASSED** | Clean: dry-run drainage completed without errors |

---

## 6. Scope Boundaries & Remaining Limitations

1. **Zero Git Mutations:** No commits, pushes, resets, rebases, or branch checkouts were performed.
2. **Phase 1 & Phase 2 Invariants:** Gameplay formulas, vitals, leveling thresholds, and SVG rendering are 100% preserved.
3. **Deferred Capabilities:** Contribution synchronization and passive background simulation remain strictly excluded, pending authorization for Phase 3C.
4. **Platform Limitations:**
   - GitHub Actions scheduled workflows are subject to platform load and may execute with variable jitter (+/- 15-30 minutes).
   - In rare cases where GitHub Actions public runners experience severe outages exceeding 24 hours, actions remain queued in GitHub Issues until runner availability is restored.
