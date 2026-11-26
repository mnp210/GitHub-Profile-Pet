# Sprint 5.0D — Archive Schema Design & Versioning Specification

## 1. Context & Motivation

Prior to Sprint 5.0D, the activity archive schema (`pet/schemas/activity_archive.schema.json` v1) only supported commit SHA overflow arrays (`archivedCommitShas: string[]`). It lacked support for general event records (issues, pull requests, reviews), event timestamps, XP accounting values, provenance attributes, and batch integrity checksums.

Sprint 5.0D introduces **Activity Archive Schema v2** while preserving 100% backward compatibility with legacy v1 documents.

---

## 2. Dual-Schema JSON Specification

The schema specification at `pet/schemas/activity_archive.schema.json` uses JSON Schema `oneOf` to accept both legacy v1 and comprehensive v2 documents:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/github-profile-pet/schemas/activity_archive.schema.json",
  "title": "ActivityArchiveDocument",
  "oneOf": [
    { "$ref": "#/definitions/ActivityArchiveV1" },
    { "$ref": "#/definitions/ActivityArchiveV2" }
  ]
}
```

### A. Schema v2 Structure
```typescript
export interface ActivityArchiveV2Document {
  schemaVersion: 2;
  archivedCommitShas: string[];       // Fast O(1) set of lowercase commit SHAs
  archivedEvents: ActivityEventRecord[]; // Complete audit trail of archived records
  batches: ActivityArchiveBatch[];    // Immutable batch manifests
  totalArchivedEvents: number;        // Total count of archived event records
  totalArchivedXp: number;            // Total XP sum of archived event records
  updatedAt: string;                  // ISO-8601 UTC timestamp of last modification
}
```

### B. Archive Batch Manifest (`ActivityArchiveBatch`)
Each compaction run appends an immutable batch manifest:
```typescript
export interface ActivityArchiveBatch {
  batchId: string;                   // Deterministic ID: batch-YYYYMMDDTHHMMSSZ-<hash8>
  createdAt: string;                 // ISO-8601 UTC creation timestamp
  sourceLedger: string;              // "pet/ledger/activity.json"
  recordCount: number;               // Number of records archived in this batch
  totalXp: number;                   // Exact XP sum of records archived in this batch
  firstEventTimestamp: string;       // Chronological start timestamp
  lastEventTimestamp: string;        // Chronological end timestamp
  recordRange: {
    startEventId: string;            // First event ID in batch
    endEventId: string;              // Last event ID in batch
  };
  sha256: string;                    // Hex SHA-256 digest over canonical JSON records
  compactorVersion: string;          // "1.0.0"
}
```

### C. Preserved Event Record Schema
Every archived record preserves all original fields without truncation:
- `eventId`: Stable unique identifier (`commit:3a5c7f...`, `issue:42`, `pr_opened:12`, `pr_merged:12`, `review:987`).
- `eventType`: `'commit' | 'issue_opened' | 'pr_opened' | 'pr_merged' | 'review_submitted'`.
- `actor`: GitHub username of author.
- `timestamp`: Original event ISO-8601 UTC timestamp.
- `xpAwarded`: Exact experience points awarded.
- `status`: Evaluation status (`rewarded`, `skipped_bot`, `skipped_duplicate`, `skipped_daily_cap`, `skipped_care_action`, `skipped_stale`, `invalid`).
- `details`: Human-readable description.
- `ref`: Git branch or PR ref.

---

## 3. Migration Strategy & Reversibility

### In-Memory V1 to V2 Migration
When `loadActivityArchive(baseDir)` encounters a legacy v1 archive, it transparently upgrades it in-memory:
```typescript
export function migrateArchiveV1ToV2(v1: ActivityArchiveV1Document): ActivityArchiveV2Document {
  return {
    schemaVersion: 2,
    archivedCommitShas: [...(v1.archivedCommitShas || [])],
    archivedEvents: [],
    batches: [],
    totalArchivedEvents: v1.archivedEventCount ?? (v1.archivedCommitShas?.length || 0),
    totalArchivedXp: 0,
    updatedAt: v1.updatedAt || new Date().toISOString(),
  };
}
```

### Reversible Down-Conversion (V2 to V1)
To ensure zero vendor lock-in and complete testing reversibility, `migrateArchiveV2ToV1` extracts the commit SHAs and event counts, producing a fully compliant v1 document:
```typescript
export function migrateArchiveV2ToV1(v2: ActivityArchiveV2Document): ActivityArchiveV1Document {
  return {
    schemaVersion: 1,
    archivedCommitShas: [...(v2.archivedCommitShas || [])],
    archivedEventCount: v2.totalArchivedEvents ?? v2.archivedEvents.length,
    updatedAt: v2.updatedAt || new Date().toISOString(),
  };
}
```

Both migration paths are tested and verified in `tests/unit/archiveCompaction.test.ts`.
