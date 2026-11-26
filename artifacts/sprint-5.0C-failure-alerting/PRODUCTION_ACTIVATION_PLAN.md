# Sprint 5.0C — Production Activation Plan

## 1. Safety Guardrails & Boundary Control

Sprint 5.0C is implemented strictly within the candidate workspace (`D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`).

Production alerting is **disabled by default**:
- Workflow configuration in `.github/workflows/workflow-failure-alert.yml` defaults `FAILURE_ALERTS_ENABLED: "false"`.
- Candidate code does **not** push to production or create real issues on `mnp210/GitHub-Profile-Pet`.

---

## 2. Step-by-Step Production Activation Procedure

When operator authorizes activation in production during a future release sprint:

### Step 1: Preflight Verification
1. Confirm repository is public (`mnp210/GitHub-Profile-Pet`).
2. Verify that GitHub Actions Issues permission is enabled on the repository (`Settings -> Actions -> General -> Workflow permissions -> Read and write permissions`).
3. Confirm repository label `automated-alert` exists or allow automatic creation (resilient fallback handles missing label gracefully).

### Step 2: Merge Candidate to Production
1. In candidate workspace: review git diff and tag candidate commit.
2. In production repository: fast-forward merge or PR merge candidate branch to `main`.
3. Verify production default branch remains clean and workflows are operational.

### Step 3: Enable Alerting in Production
Option A: Set repository-level variable (Recommended):
- In `mnp210/GitHub-Profile-Pet`, navigate to `Settings -> Secrets and variables -> Actions -> Variables`.
- Add repository variable:
  - Name: `FAILURE_ALERTS_ENABLED`
  - Value: `true`

Option B: Set directly in workflow file:
- In `.github/workflows/workflow-failure-alert.yml`, update env block:
  ```yaml
  env:
    FAILURE_ALERTS_ENABLED: "true"
  ```

### Step 4: Verification via Controlled Test
1. Perform a safe dry-run test using a non-critical workflow dispatch.
2. Verify step summary outputs in GitHub Actions UI.
3. Verify that zero duplicate issues are generated during consecutive executions.

---

## 3. Rollback & Emergency Deactivation

If unexpected alerting behavior or duplicate issues occur:

1. **Immediate Deactivation (Zero Git Commits Required):**
   - In `mnp210/GitHub-Profile-Pet`, update repository variable `FAILURE_ALERTS_ENABLED` to `false` (or delete the variable).
   - All subsequent alerting workflow runs immediately evaluate to `status: DISABLED` and exit `0` without making any GitHub API mutations.

2. **Workflow Level Disablement:**
   - In GitHub Actions UI, disable workflow `Automated Workflow Failure Alert`.

3. **Issue Cleanup:**
   - If an alert issue was created, maintainers close the issue with state reason `completed` or `not_planned`.
