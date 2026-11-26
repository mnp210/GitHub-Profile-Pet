# Sprint 5.0C — Security & Permissions Audit

## 1. Threat Modeling & Risk Assessment

| Potential Risk | Threat Scenario | Mitigation Strategy | Verification Status |
| :--- | :--- | :--- | :--- |
| **Credential Leakage in Public Issues** | Workflow error output contains Personal Access Tokens, OAuth secrets, or runner tokens. Creating a public issue would expose credentials. | Automatic secret redactor: masks `ghp_*`, `gho_*`, `ghu_*`, `ghs_*`, `ghr_*`, `Bearer *`, and `token=*`. Escapes Markdown and HTML tags (`<script>`, `\|`). | **VERIFIED** in unit test suite (`failureAlert.test.ts`). |
| **Fork PR Privilege Escalation** | An untrusted fork submits a PR that intentionally fails. If `workflow_run` executed in base context without checks, an attacker could trigger arbitrary alerting issues or spam the repository. | **Fork PR Guard**: `executeFailureAlert` explicitly checks `isFork` (`head_repository.fork === true`). Fork runs are immediately rejected with status `IGNORED_FORK`. | **VERIFIED** in unit test suite (`failureAlert.test.ts`). |
| **Recursive Failure Cascade (Alert Storm)** | The failure-alert workflow itself encounters an error and triggers another failure alert recursively. | Workflow exclusions: Alert workflow does not trigger on itself. CLI entrypoint wraps all execution in `try/catch` and exits code `0`. | **VERIFIED** by design & CLI test. |
| **Unauthorized Issue Creation in Production** | Premature or unverified rollout creates spam issues on `mnp210/GitHub-Profile-Pet` before operator approval. | **Default-Disabled Guardrail**: `FAILURE_ALERTS_ENABLED=false` is enforced by default. If the env var is missing, empty, or false, issue creation is completely withheld (`status: DISABLED`). | **VERIFIED** locally via CLI simulation & unit tests. |
| **Excessive GitHub Token Permissions** | Alert workflow requests broad permissions (`contents: write`, `admin`, etc.). | Principle of least privilege: Alert workflow requests strictly `issues: write` and `contents: read`. | **VERIFIED** in `.github/workflows/workflow-failure-alert.yml`. |

---

## 2. GitHub Actions Permissions Audit

The workflow `.github/workflows/workflow-failure-alert.yml` defines the exact minimal set of required permissions:

```yaml
permissions:
  issues: write    # Required to search, create, and comment on tracking issues
  contents: read   # Required to read repository files and package scripts
```

No elevated or administrative permissions are requested:
- ❌ `pull-requests: write` (Not requested)
- ❌ `actions: write` (Not requested)
- ❌ `id-token: write` (Not requested)
- ❌ `security-events: write` (Not requested)
- ❌ `deployments: write` (Not requested)

---

## 3. Concurrency & Race Condition Protection

To prevent concurrent race conditions when multiple workflows fail in close succession, the alerting workflow enforces concurrency serialization grouped by repository and workflow file:

```yaml
concurrency:
  group: failure-alert-${{ github.repository }}-${{ github.event.workflow_run.path }}
  cancel-in-progress: false
```

- Setting `cancel-in-progress: false` ensures that every failure event is processed in order without abruptly terminating an ongoing deduplication check.
