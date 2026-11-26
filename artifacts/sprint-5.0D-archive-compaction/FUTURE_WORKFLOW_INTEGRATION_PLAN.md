# Sprint 5.0D — Future Workflow Integration Plan

## 1. Scope & Strict Boundaries

Per Sprint 5.0D constraints:
- **No scheduled compaction workflow has been activated in this sprint.**
- **No automatic production ledger changes have been scheduled.**
- **No production workflow dispatch or repository settings changes have been executed.**

This document outlines the proposed, safe architecture for integrating archive compaction into the production lifecycle during a future authorized release sprint.

---

## 2. Proposed Production Workflow Architecture

### Recommended Integration Point: `pet-activity.yml` (Post-Reconciliation Hook)

Archive compaction should **not** run on every small push event. Instead, it should execute as a scheduled maintenance task following successful activity reconciliation:

```yaml
      # Step in .github/workflows/pet-activity.yml (Future Release)
      - name: Evaluate Activity Ledger Compaction
        if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
        run: |
          npm run archive:compact -- --execute --threshold 5000
```

### Why After Reconciliation?
1. **Reconciliation Completeness:** Running compaction after full Git & API sweep guarantees that all active events have been reconciled and checkpoints advanced before older records are archived.
2. **Frequency Alignment:** The schedule runs every 30 minutes; checking the 5,000-record threshold twice an hour adds less than 15 ms of overhead and only triggers a Git commit when the threshold is actually exceeded.
3. **Publication Manifest:** `pet/ledger/archive/activity_archive.json` is already declared in `ACTIVITY_PUBLICATION_MANIFEST_PATHS` in `scripts/process-activity.ts`. When compaction occurs, the updated archive and ledger will naturally be included in the fast-forward atomic push.

---

## 3. Operator Authorization Protocol

Before activating hosted compaction:
1. Operator explicitly reviews the candidate changes and merges them to `main`.
2. Operator runs a manual dispatch test in dry-run mode:
   ```bash
   gh workflow run pet-activity.yml -f ref=main
   ```
3. Operator inspects the Step Summary output in the GitHub Actions dashboard.
4. If healthy, operator enables compaction in production.
