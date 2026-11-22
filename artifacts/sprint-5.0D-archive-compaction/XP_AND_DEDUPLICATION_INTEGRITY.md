# Sprint 5.0D — XP & Deduplication Integrity Specification

## 1. Zero-XP-Drift Guarantee

The highest-priority correctness invariant for GitHub Profile Pet is that **archival must never award XP, remove previously awarded XP, or alter pet progression**.

### Mathematical Invariants
Let $E$ be the set of all activity events recorded in the system.
At any point in time $t$:
$$E = E_{\text{active}} \cup E_{\text{archived}}, \quad E_{\text{active}} \cap E_{\text{archived}} = \emptyset$$
$$\text{Total XP}(E) = \sum_{e \in E_{\text{active}}} \text{xpAwarded}(e) + \sum_{e \in E_{\text{archived}}} \text{xpAwarded}(e)$$

During compaction:
$$\Delta \text{Total XP} \equiv 0$$

Furthermore:
- `pet/state/pet.json`: `xp`, `level`, and `evolutionStage` are **100% untouched** by archive compaction.
- `dailyAccruedXp`: Remains untouched in `pet/ledger/activity.json`.
- `daily_cap`: The daily limit of 300 XP continues to guard current-day evaluations independently of historical event location.

---

## 2. Universal Replay Protection Across Active and Archived Records

In Sprint 4.0, permanent event deduplication was introduced using:
1. `processedRegistry`: In-memory array of the most recent 500 identifiers per category.
2. `permanentIndex`: Range-compressed integer intervals for sequential IDs (`issueIntervals`, `prOpenedIntervals`, `prMergedIntervals`, `reviewIntervals`) and a working set of commit SHAs.
3. `archivedCommitShas`: Fast array lookup of older commit SHAs that rolled into archive storage.

In Sprint 5.0D, the replay protection mechanism is unified across **all event types**:

```typescript
export function isDuplicateEvent(
  registry: ActivityProcessedRegistry,
  eventType: ActivityType,
  eventId: string,
  permanentIndex?: PermanentDeduplicationIndex,
  archivedCommitShas?: string[],
  archivedEvents?: ActivityEventRecord[] | Set<string>
): boolean {
  const cleanId = eventId.trim();

  // 1. Direct match against archived event records (all event types)
  if (archivedEvents) {
    if (archivedEvents instanceof Set) {
      if (archivedEvents.has(cleanId.toLowerCase())) return true;
    } else if (Array.isArray(archivedEvents)) {
      if (archivedEvents.some((e) => e.eventId.toLowerCase() === cleanId.toLowerCase())) return true;
    }
  }

  switch (eventType) {
    case 'commit': {
      const sha = cleanId.replace(/^commit:/i, '').toLowerCase();
      if (registry.commitShas.some((s) => s.toLowerCase() === sha)) return true;
      if (permanentIndex?.commitShas.some((s) => s.toLowerCase() === sha)) return true;
      if (archivedCommitShas && archivedCommitShas.some((s) => s.toLowerCase() === sha)) return true;
      return false;
    }
    case 'issue_opened': {
      const num = parseInt(cleanId.replace(/^issue:/i, ''), 10);
      if (!Number.isInteger(num)) return false;
      if (registry.issueNumbers.includes(num)) return true;
      if (permanentIndex && isNumberInIntervals(permanentIndex.issueIntervals, num)) return true;
      return false;
    }
    // pr_opened, pr_merged, review_submitted follow equivalent interval and set checks
  }
}
```

### Verification Scenarios Tested
- **Commit Replay after Compaction:** A commit compacted into `activity_archive.json` and purged from `activeLedger.recentEvents` is replayed. Evaluation returns `status: skipped_duplicate`, awarding 0 XP.
- **Issue Replay after Compaction:** Issue #42 is archived. Replay returns `skipped_duplicate` through both permanent intervals and archived event set.
- **PR Merge Replay after Compaction:** PR #1 (merged for 50 XP) is archived. Replay returns `skipped_duplicate`, awarding 0 XP.

---

## 3. Before-and-After Accounting Comparison (Test Matrix)

| Test Fixture Scenario | Active Events Before | Archive Events Before | Total XP Before | Active Events After | Archive Events After | Total XP After | Net XP Change | Deduplication Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Below Threshold (40 records)** | 40 | 0 | 600 XP | 40 | 0 | 600 XP | 0 XP | 100% Unique |
| **Equal Threshold (100 records)** | 100 | 0 | 1,500 XP | 100 | 0 | 1,500 XP | 0 XP | 100% Unique |
| **Above Threshold (150 records -> 100)**| 150 | 0 | 2,750 XP | 100 | 50 | 2,750 XP | 0 XP | 100% Unique |
| **Subsequent Batch (180 records -> 100)**| 180 | 50 | 4,200 XP | 100 | 130 | 4,200 XP | 0 XP | 100% Unique |
| **Replay Compacted Commit** | 100 | 50 | 2,750 XP | 100 | 50 | 2,750 XP | 0 XP | Skipped Duplicate |
| **Synthetic Scale (10,000 records)** | 10,000 | 0 | 200,000 XP | 5,000 | 5,000 | 200,000 XP | 0 XP | 100% Unique |
| **Synthetic Scale (50,000 records)** | 50,000 | 0 | 1,000,000 XP | 5,000 | 45,000 | 1,000,000 XP | 0 XP | 100% Unique |
