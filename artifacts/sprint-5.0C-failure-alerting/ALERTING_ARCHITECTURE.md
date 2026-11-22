# Sprint 5.0C — Alerting Architecture & System Specification

## 1. System Overview

Sprint 5.0C establishes an automated, deduplicated failure alerting mechanism for maintained production workflows within **GitHub Profile Pet**.

The architecture decouples failure detection and alerting from the main execution loops of the production workflows. It guarantees that failure detection never compromises the reliability, transaction boundary, or progression guarantees of the pet state.

```
       Production Workflow Execution
   (deploy-pages / pet-activity / etc.)
                  │
          [Completion Event]
                  ▼
   ┌──────────────────────────────┐
   │    GitHub Actions Event:     │
   │        workflow_run          │
   └──────────────┬───────────────┘
                  │ (failure / timed_out / success)
                  ▼
   ┌──────────────────────────────┐
   │ workflow-failure-alert.yml   │
   │  (Isolated alerting runner)  │
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │ alert-workflow-failure.ts    │
   │ (CLI orchestrator & context) │
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │ executeFailureAlert()        │
   │ 1. Fork PR Security Guard    │
   │ 2. Conclusion Gatekeeper     │
   │ 3. Disabled/Dry-run Check    │
   │ 4. Deterministic Fingerprint │
   │ 5. Issue Query & Deduplicate │
   │ 6. Label Resilient Delivery  │
   └──────────────┬───────────────┘
                  │
                  ├── If New Failure       ──► Create Tracking Issue (#101) with Label
                  ├── If Repeated Failure  ──► Add Update Comment to Open Issue (#101)
                  ├── If Success (Resolved)──► Add Recovery Notice to Open Issue (#101)
                  └── If Success (Normal)  ──► NOOP (Zero noise, zero API mutations)
```

---

## 2. Architectural Pillars

### A. Non-Interfering Decoupling (`workflow_run`)
- Alerting is triggered via GitHub Actions `workflow_run` events.
- Production workflows (`pet-activity.yml`, `pet-publisher.yml`, `pet-interaction.yml`, `deploy-pages.yml`) do not embed error-traps or issue-creation steps within their primary jobs.
- If a production job crashes unexpectedly, encounters an uncaught runtime exception, runs out of memory, or encounters a runner shutdown, the workflow-level completion event is still delivered by GitHub Actions to `workflow-failure-alert.yml`.

### B. Single Responsibility & Reusability
- Reuses the formatting and diagnostic standards introduced in Sprint 5.0A telemetry (`StepSummaryTable`, `escapeMarkdown`, `sanitizeTelemetry`).
- Decouples API operations behind the `GitHubAlertClient` interface, allowing 100% offline unit and integration testing without network calls or mocked external processes.

### C. Anti-Cascading Circuit Breaker (Zero Alert Loops)
- The alerting workflow `.github/workflows/workflow-failure-alert.yml` does **not** listen to its own workflow completion events.
- The alerting runner script `scripts/alert-workflow-failure.ts` always exits with exit code `0`, logging diagnostic telemetry to `$GITHUB_STEP_SUMMARY` without ever throwing an unhandled process exit. This eliminates recursive failure loops.

### D. Multi-Stage Safeguards
1. **Fork PR Security Guard:** Refuses alerts originating from untrusted fork pull requests (`head_repository.fork === true`).
2. **Activation Boundary:** Strictly gated behind `FAILURE_ALERTS_ENABLED=true`. When missing or false, issues are not created.
3. **Deterministic Deduplication:** Fingerprinted via `<!-- FAILURE_ALERT_FINGERPRINT:<owner>/<repo>:<workflow_file>:<category> -->`.
4. **API Fault Tolerance:** Retries issue creation without labels if custom label creation is rejected with HTTP 422.
