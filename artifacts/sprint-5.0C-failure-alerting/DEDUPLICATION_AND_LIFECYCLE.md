# Sprint 5.0C — Deduplication & Incident Lifecycle State Machine

## 1. Problem Statement: The Alert Flooding Hazard

In automated scheduling systems (e.g. hourly cron workflows like `pet-activity.yml`), an unresolved transient failure (such as an upstream GitHub API outage or git push conflict) could trigger 24 duplicate issues per day, flooding the issue tracker and degrading repository maintainability.

Sprint 5.0C implements a **zero-duplicate guarantee** across the entire lifecycle of an incident.

---

## 2. Deterministic Alert Fingerprinting

Each workflow alert is assigned an immutable, normalized fingerprint:

```typescript
const fingerprint = createAlertFingerprint({
  repository: 'mnp210/GitHub-Profile-Pet',
  workflowFile: 'pet-activity.yml',
  category: 'workflow_failure',
});
// Yields: "mnp210/github-profile-pet:pet-activity.yml:workflow_failure"
```

The fingerprint is injected into the tracking issue body as an invisible HTML comment:
```html
<!-- FAILURE_ALERT_FINGERPRINT:mnp210/github-profile-pet:pet-activity.yml:workflow_failure -->
```

### Why Fingerprint in Body Comment vs. Issue Labels/Titles?
- **Labels can be deleted or fail to create** due to permissions (HTTP 422).
- **Titles can be customized or modified** by repository maintainers during triaging.
- **Embedded body comments persist** across title edits and label renames, and are queryable via API issue body search without adding external dependencies.

---

## 3. Incident Lifecycle State Machine

```
              ┌───────────────────────────┐
              │    Workflow Completes     │
              └─────────────┬─────────────┘
                            │
             [conclusion in (failure, timed_out)]
                            │
                            ▼
              ┌───────────────────────────┐
              │ Check for Open Issue with │
              │   Matching Fingerprint    │
              └─────────────┬─────────────┘
                            │
              ┌─────────────┴─────────────┐
        No Open Issue               Open Issue Exists
              │                           │
              ▼                           ▼
    ┌───────────────────┐       ┌───────────────────┐
    │ CREATE NEW ISSUE  │       │   UPDATE ISSUE    │
    │  State: 'open'    │       │  Post comment on  │
    │  Labels: ['alert']│       │  existing issue   │
    │  Status:          │       │  Status:          │
    │  CREATED_NEW_ISSUE│       │  UPDATED_EXISTING │
    └───────────────────┘       └───────────────────┘
                                          ▲
                                          │ (next failure)
                                          │
                                          │ (subsequent success)
                                          ▼
                                ┌───────────────────┐
                                │  RECOVERY NOTICE  │
                                │  Post comment on  │
                                │  open issue       │
                                │  Status:          │
                                │  POSTED_RECOVERY  │
                                └─────────┬─────────┘
                                          │
                               (Maintainer closes issue)
                                          │
                                          ▼
                                ┌───────────────────┐
                                │ INCIDENT RESOLVED │
                                └───────────────────┘
```

### State Transitions & Actions

1. **First Failure (`CREATED_NEW_ISSUE`):**
   - No open issue with the fingerprint exists.
   - Creates a new issue: `🚨 [ALERT] Workflow Failure: Pet Activity Progression (Run 45042048859)`.
   - Embeds fingerprint comment in issue body.
   - Applies label `automated-alert`.

2. **Repeated Failure (`UPDATED_EXISTING_ISSUE`):**
   - An open issue with the fingerprint is found.
   - **Zero new issues created.**
   - Appends a concise update comment detailing the new run ID, attempt, timestamp, and commit SHA.

3. **Subsequent Success (`POSTED_RECOVERY_COMMENT`):**
   - The previously failing workflow completes successfully (`conclusion: 'success'`).
   - The engine checks for an open issue with the fingerprint.
   - If found, posts a recovery comment informing maintainers that execution recovered at verified commit SHA, inviting them to verify logs and close the issue.

4. **Normal Success (`NOOP_SUCCESS`):**
   - Workflow succeeds and no open alert issue exists.
   - Zero operations, zero noise, zero API mutations.

5. **Re-Opening Protection:**
   - If an issue was closed by a maintainer, a future failure for that workflow creates a *fresh* issue rather than reopening an old historical thread, ensuring clear incident boundary tracking.
