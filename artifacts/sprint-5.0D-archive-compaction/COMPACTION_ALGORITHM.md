# Sprint 5.0D — Compaction Algorithm & Partitioning Specification

## 1. Algorithm Overview

The archive compaction engine partitions the active activity ledger into two deterministic slices:
1. **Recent Active Working Window:** Retained in `pet/ledger/activity.json` for fast display, UI rendering, and recent duplicate checking.
2. **Archived Historical Slice:** Appended to `pet/ledger/archive/activity_archive.json` as an immutable batch.

```
                  ┌────────────────────────────────────────┐
                  │ Active Ledger: recentEvents (N records)│
                  │ (Ordered newest-first: index 0..N-1)   │
                  └───────────────────┬────────────────────┘
                                      │
                   Is N > Threshold (default 5,000)?
                                      │
                     ┌────────────────┴────────────────┐
                    YES                                NO
                     │                                 │
                     ▼                                 ▼
         Partition Slices                          NOOP Status
    Index 0..(Threshold - 1):                   (Files untouched)
     Retain as Active Window
    Index Threshold..(N - 1):
     Eligible for Archival
                     │
                     ▼
         Reverse to Chronological
          (Oldest-to-Newest)
                     │
                     ▼
         Compute Batch SHA-256 Digest
         (Canonical JSON Stringification)
                     │
                     ▼
         Execute Multi-Document
         Transaction Journal
         (Stage -> Commit -> Apply -> Cleanup)
                     │
                     ▼
         Post-Commit Audit Verification
```

---

## 2. Partitioning Mathematics & Record Selection

The active ledger's `recentEvents` array is structured newest-first:
- `recentEvents[0]` represents the most recent event.
- `recentEvents[recentEvents.length - 1]` represents the oldest recorded event.

Given a configurable threshold $T$ (default $T = 5,000$):
- If $N \le T$: Compaction is skipped (`status: NOT_NEEDED`). No records are moved.
- If $N > T$:
  - $\text{Active Slice} = \text{recentEvents}[0 \dots T-1]$ ($\text{length} = T$).
  - $\text{Archive Slice} = \text{recentEvents}[T \dots N-1]$ ($\text{length} = N - T$).

The archive slice is reversed to chronological order (oldest to newest) prior to batch generation so historical records in `activity_archive.json` remain sequentially readable for auditors.

---

## 3. Deterministic Batch Checksum Computation

To prevent bit-rot, intentional tampering, or accidental file corruption, each batch computes an immutable SHA-256 digest:

```typescript
export function canonicalStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(obj[key])}`);
  return '{' + entries.join(',') + '}';
}

export function computeBatchSha256(records: ActivityEventRecord[]): string {
  const canonical = canonicalStringify(records);
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}
```

This guarantees that:
- Property key reordering produces the exact same hash.
- Any modification of a single timestamp, XP value, or actor immediately invalidates the checksum during `archive:verify`.

---

## 4. Invariant Assertion Pre-Commit

Before any staged file is committed to disk, the compactor executes two strict mathematical assertions:

1. **Total Record Count Conservation:**
   $$\text{Active}_{\text{before}} + \text{Archive}_{\text{before}} \equiv \text{Active}_{\text{after}} + \text{Archive}_{\text{after}}$$
2. **Total XP Conservation:**
   $$\text{XP}_{\text{active, before}} + \text{XP}_{\text{archive, before}} \equiv \text{XP}_{\text{active, after}} + \text{XP}_{\text{archive, after}}$$

If either invariant fails, the process immediately aborts, throwing an error without committing the transaction.
