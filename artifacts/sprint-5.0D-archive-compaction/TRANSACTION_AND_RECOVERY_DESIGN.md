# Sprint 5.0D — Transaction & Recovery Design Specification

## 1. Multi-Document Write-Ahead Transaction Protocol

Compaction modifies two separate files simultaneously:
- `pet/ledger/activity.json` (active ledger truncation)
- `pet/ledger/archive/activity_archive.json` (archive document extension)

In the Node.js / POSIX / Windows filesystem model, atomic multi-file replacement does not exist at the operating system level. To eliminate any possibility of partial writes, torn documents, or orphaned records, compaction strictly reuses the **Write-Ahead Transaction Journal Protocol** established in `src/features/pet-engine/activity/activityTransactionJournal.ts`.

```
                    ┌────────────────────────────┐
                    │    1. PREPARE STAGE        │
                    │ Write updated documents    │
                    │ to .activity_tx/staged/    │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │    2. ATOMIC COMMIT POINT  │
                    │ Atomically write tx.json   │
                    │ with status: "committed"   │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │    3. APPLY STAGE          │
                    │ Rename staged files to     │
                    │ destination paths          │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │    4. CLEANUP STAGE        │
                    │ Remove .activity_tx/       │
                    └────────────────────────────┘
```

---

## 2. Crash Scenarios & Recovery State Machine

The recovery protocol (`recoverActivityTransaction` and `recoverArchiveTransaction`) handles interruptions deterministically across all failure modes:

| Failure Point | Manifest State on Disk | Recovery Strategy | Guarantee |
| :--- | :--- | :--- | :--- |
| **Crash during Prepare** (before `tx.json` is committed) | No `tx.json`, or `status !== "committed"` | **ROLL BACK**: Deletes `.activity_tx/`. Source files were never modified. | Original state preserved 100%. |
| **Crash after Commit Point** (during atomic rename of files) | `tx.json` exists with `status: "committed"` | **ROLL FORWARD**: Checks remaining staged files and renames them to final paths. Deletes `.activity_tx/`. | Fully committed compacted state restored. |
| **Crash after Apply but before Cleanup** | Files are already in place; `.activity_tx/` remains | **CLEANUP**: Cleans up leftover staging directory safely. | Clean filesystem state. |
| **Crash during Recovery** | `recoverActivityTransaction` is re-invoked on restart | **IDEMPOTENT**: Evaluates `tx.json` status again and completes the forward/rollback sweep. | Zero double-mutation risk. |

---

## 3. Disclosed Limitations & Guarantees

### What is Guaranteed
- **Atomicity:** An interrupted compaction will either completely roll back to the pre-compaction state or completely roll forward to the post-compaction state.
- **Zero Record Vanishing:** An event cannot disappear from both the active ledger and archive.
- **Zero Event Duplication:** An event cannot be committed twice.
- **Automated Pre-Flight Recovery:** Every compaction invocation (`compactActivityArchive`) automatically runs `recoverActivityTransaction` before inspecting or modifying files.

### Disclosed Limitations
- File operations on Windows and Linux run on local filesystems; if the machine suffers hard hardware power loss while the disk controller is flushing a single file write, filesystem-level journal journaling (NTFS / ext4) ensures individual file block consistency, while the write-ahead journal ensures multi-file application consistency.
- In hosted GitHub Actions, operations run inside an ephemeral Ubuntu runner container; if a runner is abruptly terminated by GitHub Actions, the next runner starts fresh from Git checkout, where Git commit boundaries provide repository-level rollback.
