# Sprint 4.5 — Production Observability Gap Analysis & GitHub-Native Monitoring Architecture

**Document Identifier:** SPRINT-4.5-OBSERVABILITY-AUDIT  
**Evaluation Target:** `mnp210/GitHub-Profile-Pet`  
**Constraint Mandate:** Zero paid services, zero external databases, 100% lightweight GitHub-native architecture.

---

## 1. Failure Mode Detection & Gap Matrix

The table below evaluates the system's current ability to detect, log, and alert on critical production operational failure modes:

| Failure Mode | Current Detection Capability | Current Notification Mechanism | Identified Observability Gap | Proposed GitHub-Native Remediation |
| :--- | :---: | :--- | :--- | :--- |
| **1. Failed Activity Processing** | **Medium** | Actions run fails; email sent to repo owner. | Silent to visitors; README pet badge does not show activity health status. | Add an Actions Status Badge in `README.md` (`[![Activity Engine](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-activity.yml/badge.svg)](...)`). |
| **2. Stale Pet State** | **Low** | Recorded in `pet/state/pet.json` timestamp; no active monitoring. | If activity workflow stops triggering, pet becomes stale without warning. | Lightweight daily diagnostic check: if `Date.now() - pet.lastInteractionTime > 48h` and commits occurred, emit workflow warning. |
| **3. Publication Failures** | **Medium** | Workflow exits with code 1; logged to Actions tab. | No visual indicator if hourly SVG publisher fails to run. | Add `pet-publisher.yml` status badge to README footer or operational monitoring section. |
| **4. Generation Mismatches** | **High** | Detected immediately by `stateRepository.ts` (`GenerationMismatchError`). | Hard failure prevents partial writes, but requires human intervention if tripped. | Auto-harmonization in `process-activity.ts` (implemented in Sprint 4.4) prevents mismatches before they occur. |
| **5. Duplicate Processing** | **High** | Logged to runner stdout (`SKIPPED_DUPLICATE`); 0 XP awarded. | Aggregated duplicate rejection counts not exposed in public telemetry. | Add `stats.duplicatesFilteredCount` to `pet/ledger/activity.json` summary block. |
| **6. Rate-Limit Exhaustion** | **Medium** | `diagnostics-contribution-probe.yml` logs points used vs. remaining. | Telemetry buried in workflow logs; no automated alert if remaining points < 20%. | Add an Actions Step Summary (`$GITHUB_STEP_SUMMARY`) displaying current hourly GraphQL quota. |
| **7. Corrupt State Document** | **High** | JSON schema validators reject malformed files before staging. | Corrupted files cause fail-closed crash without automated issue notification. | Add GitHub Issue generation in workflow `if: failure()` step to notify the repository owner directly. |
| **8. Concurrency Collision** | **High** | Concurrency groups serialize runs; Stage 1 remote fence detects push conflicts. | Push retry telemetry only visible in verbose runner logs. | Include push retry attempts in GitHub Actions step summary. |
| **9. Failed Pages Deployment** | **High** | Actions deploy failure notification from GitHub Pages engine. | Web visitors see stale deployment rather than explicit maintenance state. | Add build status badge for Pages deployment in repository README. |

---

## 2. Recommended GitHub-Native Monitoring Architecture

To eliminate the identified observability gaps without adding external operational complexity, three lightweight GitHub-native mechanisms are proposed:

### 2.1 Workflow Step Summaries (`$GITHUB_STEP_SUMMARY`)
Each workflow runner can write markdown telemetry directly to `$GITHUB_STEP_SUMMARY` during execution. This surfaces immediate, readable run summaries in the GitHub Actions UI without requiring log downloads:

```markdown
### 🐾 Pet Activity Progression Summary
- **Events Evaluated:** 40
- **XP Awarded Today:** 300 / 300 (Daily Cap Reached)
- **Duplicates Filtered:** 20
- **Pet Progression:** Level 3, 275 XP (Generation 35)
- **State Integrity:** All 3 document generations aligned (35)
```

### 2.2 GitHub Actions Status Badges in README
Incorporate standardized SVG status badges into `README.md` to provide immediate, public operational transparency:
```markdown
[![Pet Activity Engine](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-activity.yml/badge.svg)](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-activity.yml)
[![Pages Deployment](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/deploy-pages.yml)
[![SVG Publisher](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-publisher.yml/badge.svg)](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-publisher.yml)
```

### 2.3 Automated Issue Alert on Critical Failure (`if: failure()`)
Add an emergency failure alert step to `.github/workflows/pet-activity.yml` and `pet-publisher.yml`:
```yaml
- name: Alert Repository Owner on Failure
  if: failure()
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.issues.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        title: `🚨 Operational Alert: ${context.workflow} Failed`,
        body: `Workflow run [${context.runId}](https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}) failed during execution. Inspect the runner logs immediately to protect pet state integrity.`,
        labels: ['operational-alert']
      });
```

---

## 3. Observability Architecture Verdict

The proposed enhancements leverage 100% native GitHub primitives (Markdown Step Summaries, Actions Badges, GitHub Script Issue Alerts). They require zero external services, zero API credentials, and impose zero operational maintenance costs.
