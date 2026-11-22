# Sprint 4.5 — Prioritized Production Hardening Backlog

This backlog catalogs prioritized engineering enhancements identified during the Sprint 4.5 post-launch audit to ensure the long-term maintainability, observability, and self-healing resilience of GitHub Profile Pet.

Every proposed item adheres strictly to the **zero-paid-infrastructure, GitHub-native architecture mandate**.

---

## 1. Prioritized Hardening Items

| Priority | Item ID | Title | Domain | Effort | Description & Rationale |
| :---: | :---: | :--- | :---: | :---: | :--- |
| **P0** | **HARDEN-01** | **GitHub Actions Step Summaries** | Observability | Low (1 pt) | Add markdown summaries to `$GITHUB_STEP_SUMMARY` in `pet-activity.yml` and `pet-publisher.yml` displaying XP awarded, events evaluated, and generation alignment directly in the Actions UI. |
| **P1** | **HARDEN-02** | **Actions Status Badges in README** | User Transparency | Trivial (0.5 pt) | Embed official workflow status badges for `Pet Activity Engine`, `Pages Deployment`, and `Pet Publisher` in the `README.md` footer. |
| **P1** | **HARDEN-03** | **Automated Issue Alert on Workflow Failure** | Alerting | Low (1 pt) | Add an `if: failure()` step using `actions/github-script@v7` to open a private operational alert issue if a scheduled run fails. |
| **P2** | **HARDEN-04** | **Scheduled Archive Compaction Script** | Maintenance | Medium (2 pt) | Author a quarterly scheduled maintenance workflow (`pet-compact.yml`) to move historical commit SHAs exceeding 5,000 entries into `pet/ledger/archive/activity_archive.json`. |
| **P2** | **HARDEN-05** | **GraphQL Quota Warning Step** | Telemetry | Low (1 pt) | Enhance `diagnostics-contribution-probe.yml` to emit an Actions warning notice if remaining GraphQL quota drops below 1,000 points. |
| **P3** | **HARDEN-06** | **Chiptune Audio Volume Slider** | UX | Low (1 pt) | Upgrade the binary sound toggle in the web game settings modal to include an analog volume slider (`0% - 100%`) stored in local preferences. |

---

## 2. Recommended Next Sprint: Sprint 5.0 — Autonomous Maintenance & Observability Instrumentation

### Recommended Sprint Scope
1. Implement **HARDEN-01** (GitHub Actions Step Summaries across all workflows).
2. Implement **HARDEN-02** (README status badges for real-time health visibility).
3. Implement **HARDEN-03** (Automated GitHub Issue alerting on workflow failure).
4. Author comprehensive operational maintenance documentation (`docs/runbooks/operational-maintenance.md`).

### Rationale
With core gameplay, activity progression, deduplication, and hosted Pages fully verified and stable in production, Sprint 5.0 will provide the repository owner with complete operational visibility, self-healing diagnostics, and peace of mind without requiring ongoing manual monitoring.
