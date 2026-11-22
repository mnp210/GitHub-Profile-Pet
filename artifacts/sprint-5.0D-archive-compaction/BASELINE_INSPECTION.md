# Sprint 5.0D — Baseline Inspection: Activity Archive & Ledger State

**Inspection Date:** 2026-11-22  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `candidate/playable-virtual-pet-game`  
**Candidate Verified HEAD:** `c6a6b174b524526fbf824d1c874329abde882109`  
**Production Repository:** `mnp210/GitHub-Profile-Pet` (Default branch: `main`, Status: Untouched / Read-Only)  
**Production Baseline HEAD:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`  
**Working Tree Status:** Clean  

---

## 1. Candidate Workspace & Environment Verification

- **Candidate Working Tree:** Clean (verified via `git status`).
- **Active Branch:** `candidate/playable-virtual-pet-game`.
- **Ahead/Behind:** Ahead of `origin/main` by 3 commits (Sprint 5.0A telemetry, Sprint 5.0B badges, Sprint 5.0C alerting).
- **Node Runtime:** Node.js v22+ with `--experimental-strip-types` support.
- **Test Baseline:** 786 passed / 0 failed (239 unit tests, 547 pet engine tests).

---

## 2. Inventory of Relevant Data Files & Storage Footprint

| File Path | Description | Current Size | Record Count / Content Summary | Schema Version |
| :--- | :--- | :---: | :--- | :---: |
| `pet/state/pet.json` | Authoritative Pet State | 580 B | Level 3, 275 XP, Generation 35, Shadow Claw | 1 |
| `pet/ledger/activity.json` | Active Activity Ledger | 22,468 B | 50 recent events, 40 commit SHAs, 1 PR opened, 1 PR merged | 1 |
| `pet/ledger/contributions.json` | Contribution Sync Ledger | 16,580 B | Historical contribution snapshots & daily sync counters | 1 |
| `pet/ledger/actions.json` | User Care Action Inbox | 232 B | High-water mark cursor & processed actions | 1 |
| `pet/ledger/archive/activity_archive.json` | Durable Activity Archive | *Not Present* | 0 records (Initialized lazily upon first spillover/compaction) | 1 (Schema exists) |

---

## 3. Schema Analysis: Activity Ledger vs. Existing Archive

### A. Active Activity Ledger Schema (`pet/schemas/activity.schema.json`)
The active ledger document conforms to `ActivityLedgerDocument`:
- `schemaVersion` (const 1)
- `generation` (integer, monotonic counter)
- `dailyAccruedXp` (`Record<string, number>`, UTC date key -> daily accumulated XP)
- `processedRegistry`:
  - `commitShas: string[]`
  - `issueNumbers: number[]`
  - `prOpenedNumbers: number[]`
  - `prMergedNumbers: number[]`
  - `reviewIds: number[]`
- `permanentIndex` (optional, introduced in Sprint 4.0):
  - `commitShas: string[]` (active working commit SHAs)
  - `issueIntervals: [number, number][]` (disjoint compressed intervals)
  - `prOpenedIntervals: [number, number][]`
  - `prMergedIntervals: [number, number][]`
  - `reviewIntervals: [number, number][]`
- `checkpoints` (reconciliation cursor):
  - `lastCommitSha`, `lastIssueNumber`, `lastPrNumber`, `reconciledAt`
- `recentEvents: ActivityEventRecord[]`:
  - `eventId: string` (e.g. `commit:829863...`, `pr_opened:1`, `issue:42`)
  - `eventType: 'commit' | 'issue_opened' | 'pr_opened' | 'pr_merged' | 'review_submitted'`
  - `actor: string`
  - `timestamp: string` (ISO-8601 UTC)
  - `xpAwarded: number` (integer >= 0)
  - `status: 'rewarded' | 'skipped_bot' | 'skipped_duplicate' | 'skipped_daily_cap' | 'skipped_care_action' | 'skipped_stale' | 'invalid'`
  - `details?: string`
  - `ref?: string`
- `updatedAt: string` (ISO-8601 UTC)

### B. Legacy Archive Schema (`pet/schemas/activity_archive.schema.json`)
The legacy archive schema was designed solely for commit SHA overflow:
```json
{
  "schemaVersion": 1,
  "archivedCommitShas": ["sha1", "sha2"],
  "archivedEventCount": 2,
  "updatedAt": "2026-11-19T00:00:00Z"
}
```

### Gap Analysis against Sprint 5.0D Requirements

| Requirement | Existing Archive (v1) | Identified Gap & Sprint 5.0D Solution |
| :--- | :---: | :--- |
| **Schema Versioning** | YES (`1`) | Must evolve to `schemaVersion: 2` with backward-compatible v1 migration. |
| **Stable Event Identifiers** | PARTIAL (Only commit SHAs) | Must store full `eventId` across all activity types (issues, PRs, reviews, commits). |
| **Event Timestamps** | NO (Only document `updatedAt`) | Must preserve original `timestamp` on every archived event record. |
| **Source Provenance** | NO (Only raw commit SHAs) | Must preserve `actor`, `ref`, and `details` on every archived event. |
| **XP Values** | NO | Must preserve `xpAwarded` on every record to maintain verifiable XP ledger sums. |
| **Checkpoint Metadata** | NO | Must record compaction boundaries (`firstEventTimestamp`, `lastEventTimestamp`, ID ranges). |
| **Integrity Hashes** | NO | Must calculate and record deterministic SHA-256 digests over batch contents. |
| **Archive Batch Identifiers** | NO | Must assign deterministic batch IDs (`batch-<timestamp>-<hash>`). |

---

## 4. Dependencies & Code Inspection

1. **`src/features/pet-engine/activity/activityProcessor.ts`:**
   - Reads `activity.json` and `activity_archive.json`.
   - Contains `evaluateActivityEvent`, `isDuplicateEvent`, `recordProcessedIdentifier`.
   - Handles commit spillover at `MAX_ACTIVE_COMMIT_SHAS = 200`.
   - Currently slices `recentEvents` to `MAX_RECENT_EVENTS_RETAINED = 50`.
2. **`src/features/pet-engine/activity/activityTransactionJournal.ts`:**
   - Provides `executeActivityTransaction` and `recoverActivityTransaction`.
   - Uses staging directory `pet/ledger/.activity_tx/staged/` and metadata file `tx.json`.
   - Atomic rename and recovery already tested in `tests/unit/transactionJournalRecovery.test.ts`.
3. **`scripts/process-activity.ts`:**
   - Primary CLI and workflow runner entrypoint.
   - Includes `pet/ledger/archive/activity_archive.json` in `ACTIVITY_PUBLICATION_MANIFEST_PATHS`.
4. **`pet/ledger/contributions.json`:**
   - Tracks contribution snapshots and daily sync counts. Does not depend on activity ledger record pruning.

---

## 5. Identified Risks & Architectural Guardrails

1. **Deduplication Amnesia Risk:**
   - If records are archived without updating or retaining deduplication indexes, an attacker or replay could re-award XP for previously archived events.
   - *Guardrail:* Deduplication index (`permanentIndex` and `archivedCommitShas` / archived event set) must be queried in `isDuplicateEvent` so that compacted events are permanently recognized as duplicates.
2. **XP Drift Risk:**
   - Moving events must not alter `pet.json` XP, level, or `dailyAccruedXp`.
   - *Guardrail:* Compaction only transfers historical records between active ledger and archive. XP awarded remains strictly unchanged.
3. **Multi-File Crash Inconsistency:**
   - If the system crashes after writing the archive but before truncating the active ledger, duplicate records could exist in both files.
   - *Guardrail:* Re-use the multi-document write-ahead transaction journal (`executeActivityTransaction`). On crash recovery, if uncommitted, roll back; if committed, roll forward.
4. **Data Loss During Interruption:**
   - *Guardrail:* Never truncate the active ledger until archive file durability and integrity hashes are verified on disk.
