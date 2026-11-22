# Sprint 4.0: Release Readiness, Permanent Deduplication & Complete Reconciliation

## 1. Executive Summary & Architectural Scope

Sprint 4.0 resolves the reliability and deduplication gaps identified in Sprint 3.9, establishing a permanent, mathematically bounded deduplication engine, complete activity reconciliation for all GitHub event types, robust concurrency recovery, and rigorous XP accounting.

Key Architectural Advancements:
1. **Permanent Deduplication Engine**: Replaced naive FIFO array truncation with **Range Interval Compression** for sequential IDs (`issueNumbers`, `prOpenedNumbers`, `prMergedNumbers`, `reviewIds`) and a **Spillover Historical Archive** (`pet/ledger/archive/activity_archive.json`) for commit SHAs. Ensures events are never re-rewarded even after 500+ subsequent events, ledger archival, workflow reruns, or state restoration.
2. **Complete Activity Reconciliation**: Extended the 30-minute scheduled sweep beyond Git commits to query GitHub REST APIs for issues opened, pull requests opened, pull requests merged, and qualifying code reviews (`APPROVED` / `CHANGES_REQUESTED`), with rate limit safeguards and pagination boundaries.
3. **Concurrency Recovery & Checkpointing**: Persists `checkpoints` (`lastCommitSha`, `lastIssueNumber`, `lastPrNumber`, `reconciledAt`) in `activity.json` to recover dropped events caused by GitHub Actions queue depth limits.
4. **Mathematical XP Accounting**: Verified and tested deterministic progression: 20 commits * 15 XP = 300 XP, 21st commit = 0 XP (`skipped_daily_cap`), 135 XP + 15 XP = 150 XP, and exact boundary clamping.

---

## 2. Permanent Event Deduplication Architecture

### 2.1 The Limitations of Bounded FIFO Registries

In Sprint 3.9, active deduplication registries were bounded using `.slice(-MAX_REGISTRY_ENTRIES)`. While this prevented memory exhaustion, it introduced a theoretical replay window: if more than 500 subsequent events occurred, earlier identifiers were evicted from the working registry. While events older than 14 days were rejected as stale, a burst of 501 events within the 14-day window could allow an evicted event to be re-rewarded if re-submitted.

### 2.2 Range Interval Compression for Sequential IDs

GitHub assigns monotonically increasing positive integers for issues, pull requests, and review submissions. Sprint 4.0 introduces **Integer Interval Range Indexing** (`IntegerInterval = [start: number, end: number]`):

```typescript
// src/features/pet-engine/activity/intervalIndex.ts
export function isNumberInIntervals(intervals: IntegerInterval[] | undefined, target: number): boolean;
export function addNumberToIntervals(intervals: IntegerInterval[] | undefined, target: number): IntegerInterval[];
```

#### Properties:
- **Disjoint & Sorted:** Intervals are stored as non-overlapping, contiguous pairs `[[1, 50], [52, 100]]`.
- **Automatic Merging:** Inserting `51` merges `[1, 50]` and `[52, 100]` into `[1, 100]`.
- **O(log N) Lookup:** Binary search verifies membership in logarithmic time.
- **O(1) Space Complexity:** Sequential IDs from 1 to 100,000 compress to a single 14-byte interval: `[[1, 100000]]`.
- **Zero Pruning:** Intervals are **NEVER pruned**. 100% of past issues, PRs, and reviews are permanently recorded with negligible storage overhead.

### 2.3 Commit SHA Spillover & Historical Archive

Commit SHAs are random cryptographic hashes and cannot be interval-compressed. Sprint 4.0 partitions commit deduplication into two tiers:

1. **Active Working Set (`permanentIndex.commitShas`):** Retains the latest 200 commit SHAs in `pet/ledger/activity.json`.
2. **Durable Historical Archive (`pet/ledger/archive/activity_archive.json`):** When the active set exceeds 200 commits, excess commits spill over into the archive file:
   ```json
   {
     "schemaVersion": 1,
     "archivedCommitShas": [ ... ],
     "archivedEventCount": 1420,
     "updatedAt": "2026-11-19T22:45:00Z"
   }
   ```
3. **Lookup Precedence:** `isDuplicateEvent` checks:
   - Tier 1: In-memory working registry `registry.commitShas`.
   - Tier 2: `permanentIndex.commitShas`.
   - Tier 3: `archive.archivedCommitShas`.

Even if a commit was processed months ago, it is permanently recognized as a duplicate and awarded 0 XP.

---

## 3. Complete Activity Reconciliation Engine

### 3.1 Architecture & Flow

```
[ Scheduled Sweep (Every 30 mins) / Workflow Run ]
                        |
                        v
       [ performCompleteReconciliation ]
                        |
       +----------------+----------------+
       |                                 |
       v                                 v
[ Git Commit Log Sweep ]      [ GitHub REST API Query ]
- git log -n 30               - /repos/{owner}/{repo}/issues
- Extracts SHAs & authors     - /repos/{owner}/{repo}/pulls
- Filters [skip ci] & bots    - /repos/{owner}/{repo}/pulls/{id}/reviews
                              - Checks x-ratelimit-remaining (> 10)
                              - Filters bot accounts & care actions
                              - Halts when events > 14 days old
                        |
                        v
     [ Unified In-Memory Deduplication ]
     - Filter out events already queued
     - Pass to evaluateActivityEvent
     - Check active registry, intervals, archive
     - Award XP (clamped to daily cap)
     - Update checkpoints in activity.json
```

### 3.2 Endpoint & Filter Specification

| Activity Type | GitHub Source Endpoint | Qualification Filters | Event ID Format | XP Award |
| :--- | :--- | :--- | :--- | :--- |
| **Commit** | Local Git log (`HEAD~30..HEAD`) | Non-bot, non-merge, no `[skip ci]`, age <= 14 days | `commit:<40-hex-sha>` | `+15 XP` |
| **Issue Opened** | `GET /repos/:owner/:repo/issues?state=all` | Non-bot, non-PR (`!pull_request`), non-care action, age <= 14 days | `issue:<number>` | `+10 XP` |
| **PR Opened** | `GET /repos/:owner/:repo/pulls?state=all` | Non-bot author, age <= 14 days | `pr_opened:<number>` | `+25 XP` |
| **PR Merged** | `GET /repos/:owner/:repo/pulls?state=closed` | Has `merged_at`, non-bot merger, age <= 14 days | `pr_merged:<number>` | `+50 XP` |
| **Review Submitted** | `GET /repos/:owner/:repo/pulls/:id/reviews` | State is `APPROVED` or `CHANGES_REQUESTED`, non-bot, age <= 14 days | `review:<id>` | `+20 XP` |

### 3.3 Rate Limit Safety & Graceful Degradation
- The engine checks `x-ratelimit-remaining`. If remaining requests fall below `MIN_RATE_LIMIT_THRESHOLD = 10`, reconciliation immediately halts and logs a warning without throwing or interrupting the runner.
- If `GITHUB_TOKEN` is not configured (e.g. running in an unauthenticated or local test environment), API reconciliation is skipped gracefully, and the runner proceeds with local commit reconciliation.

---

## 4. Mathematical XP Accounting & Daily Cap Invariants

Sprint 4.0 enforces exact mathematical properties across all activity progressions:

### 4.1 Daily Budget & Cap Invariant
$$\sum \text{XP}_{\text{awarded}}(t \in \text{UTC Day}) \le 300$$

- **20 Commits from Zero:**
  $$20 \times 15\text{ XP} = 300\text{ XP}$$
  - The 20th commit reaches 300 XP.
  - The 21st commit receives $\min(15, 300 - 300) = 0\text{ XP}$ with status `'skipped_daily_cap'`.
- **Progress from Existing State:**
  - Starting at 135 XP:
    $$135 + 15 = 150\text{ XP}$$
- **Boundary Clamping:**
  - If daily accrued is 290 XP, an incoming 15 XP commit receives:
    $$\text{effectiveXP} = \min(15, 300 - 290) = 10\text{ XP}$$
    State advances by 10 XP, and daily accrued reaches exactly 300 XP.
- **UTC Day Rollover:**
  - At `2026-11-19T23:59:59Z`, the daily accrued XP is locked to `2026-11-19`.
  - At `2026-11-20T00:00:00Z`, a fresh 300 XP budget is available under date key `2026-11-20`.

---

## 5. Security & Boundary Architecture

1. **Zero-Token Storage:** PATs are never persisted to `localStorage` or disk. They exist strictly in React memory for the session duration.
2. **Sanitized Error Logging:** HTTP 401, 403, and 404 responses are mapped to generic, token-safe guidance messages.
3. **Atomic Manifest Publication:** Only explicit manifest files (`pet/state/pet.json`, `pet/ledger/activity.json`, `pet/ledger/archive/activity_archive.json`, `public/pet.svg`, `README.md`) are committed. Wildcard commits (`git add .`) are prohibited.
4. **Least-Privilege Actions Workflow:** `.github/workflows/pet-activity.yml` specifies only `contents: write`, `issues: read`, and `pull-requests: read`.
