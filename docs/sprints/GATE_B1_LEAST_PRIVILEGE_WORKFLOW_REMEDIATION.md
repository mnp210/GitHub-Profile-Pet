# GATE B1 — GitHub Actions Least-Privilege Remediation & PR Validation Hardening

## Executive Summary

Gate B1 resolves the HIGH security finding from Gate B in `.github/workflows/pet-activity.yml`. Workflow-level `permissions: contents: write` was replaced with a strict `contents: read` workflow baseline and two isolated jobs:
1. `validate-pr-activity` (`pull_request`, `pull_request_review`): strictly `contents: read`, `persist-credentials: false`, no `secrets.GITHUB_TOKEN` exposure, and `--dry-run`.
2. `progress-activity` (`push`, `issues`, `schedule`, `workflow_dispatch`): explicitly excludes `pull_request` and `pull_request_review` and grants `contents: write` only at the job level.

No branch was pushed, PR #3 was not updated or merged, and production `main` remains untouched.

---

## 1. Before / After Workflow Permission Model

| Scope | Before (Gate B Baseline `034d116...`) | After (Gate B1 Remediation) |
|---|---|---|
| **Workflow-level `permissions`** | `contents: write`, `issues: read`, `pull-requests: read` | `contents: read` (strict read-only baseline) |
| **PR-triggered execution (`pull_request`, `pull_request_review`)** | Shared `progress-activity` job with `Contents: write`, `persist-credentials: true`, `secrets.GITHUB_TOKEN` | Dedicated `validate-pr-activity` job with `contents: read`, `issues: read`, `pull-requests: read`, `persist-credentials: false`, no `secrets.GITHUB_TOKEN`, and `--dry-run` |
| **Trusted default-branch execution (`push`, `issues`, `schedule`, `workflow_dispatch`)** | Shared `progress-activity` job with workflow-level `contents: write` | `progress-activity` job with explicit `github.event_name != 'pull_request' && github.event_name != 'pull_request_review'` guard and job-level `contents: write`, `issues: read`, `pull-requests: read` |
| **`pull_request_target`** | Not used | Not used |

---

## 2. Trigger-to-Job Mapping

| Trigger Event | Routed Job | Job Token `contents` Permission | Checkout `persist-credentials` | Script Mode |
|---|---|---|---|---|
| `pull_request` (`opened`, `closed`) | `validate-pr-activity` | `read` | `false` | `--dry-run` (`prContext = true`) |
| `pull_request_review` (`submitted`) | `validate-pr-activity` | `read` | `false` | `--dry-run` (`prContext = true`) |
| `push` (`main`) | `progress-activity` | `write` | `true` (default) | Durable reconciliation & push |
| `issues` (`opened`) | `progress-activity` | `write` | `true` (default) | Durable reconciliation & push |
| `schedule` (`*/30 * * * *`) | `progress-activity` | `write` | `true` (default) | Durable reconciliation & push |
| `workflow_dispatch` | `progress-activity` | `write` | `true` (default) | Durable reconciliation & push |

---

## 3. Security Rationale & Limitation

- **Least-Privilege Isolation**: Untrusted PR merge refs (`<pr>/merge`) can no longer execute with a `contents: write` token, persisted git credentials, or `secrets.GITHUB_TOKEN` in environment variables.
- **No Indirect Privileged Trigger**: `validate-pr-activity` cannot dispatch or trigger `progress-activity`, and `workflow-failure-alert.yml` runs on `workflow_run` with `contents: read`.
- **Static Verification Limitation**: Local unit tests (`tests/unit/prActivityPushSafety.test.ts`) statically parse `.github/workflows/pet-activity.yml` to verify job separation, permissions, `persist-credentials: false`, and absence of `pull_request_target`; live GitHub Actions runner token enforcement can only be observed after the updated workflow is pushed to a PR branch (not authorized in Gate B1).
- **Visitor Mode & Trainer Mode**: Unaffected; UI and `src/lib/storage/gameStateStorage.ts` were not modified.

---

## 4. Reward Reconciliation & Validation Results

- **Reward Preservation**: `reconcileGitHubApiEvents` and `evaluateActivityEvent` continue to award `+25 XP` once per `pr_opened:<num>` (including opened-but-unmerged PRs) and `+50 XP` once per `pr_merged:<num>`, with idempotent deduplication and bounded `maxPages` continuation.

| Command | Exit Code | Result |
|---|---:|---|
| `node --test --experimental-strip-types tests/unit/prActivityPushSafety.test.ts` | `0` | **PASS** (16 / 16 across 12 suites) |
| `npm test` | `0` | **PASS** (406 / 406 across 135 suites) |
| `npm run test:pet-engine` | `0` | **PASS** (547 / 547 across 43 suites) |
| `node --test tests/integration/crossSystemIntegration.test.ts` | `0` | **PASS** (9 / 9 across 6 suites) |
| `npx tsc --noEmit` | `0` | **PASS** (0 errors) |
| `npm run lint` | `0` | **PASS** (0 errors, 0 warnings) |
| `npm run build` | `0` | **PASS** (Next.js 16.4.6 static build) |

- **Unique Tests**: `962` (`390` other unit + `16` PR push/workflow safety + `547` pet-engine + `9` cross-system integration).

---

## 5. Changed-File Inventory & Boundary Confirmation

- `.github/workflows/pet-activity.yml` — split into read-only `validate-pr-activity` and job-scoped `progress-activity`.
- `tests/unit/prActivityPushSafety.test.ts` — added Gate B1 least-privilege workflow tests and opened-but-unmerged PR discovery test.
- `docs/sprints/GATE_B1_LEAST_PRIVILEGE_WORKFLOW_REMEDIATION.md` — this remediation report.
- **Boundary Confirmed**: Candidate-only commit on `candidate/playable-virtual-pet-game`. No push, no PR #3 update/merge/approval, no workflow dispatch, and no production mutation occurred.
