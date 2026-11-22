# Sprint 5.0B — README Regression & Markdown Integrity Check

## 1. Markdown Syntax & Structural Validation

### 1.1 Structural Tag & Marker Validation
The README relies on exact operational comments for dynamic pet menu embedding:
- `<!-- START_SECTION:github-profile-pet -->` (Start delimiter)
- `<!-- END_SECTION:github-profile-pet -->` (End delimiter)

**Regression Check Results:**
- Number of `<!-- START_SECTION:github-profile-pet -->` markers: **Exactly 1**
- Number of `<!-- END_SECTION:github-profile-pet -->` markers: **Exactly 1**
- Marker ordering: Start marker appears before End marker.
- Marker content: Contains valid centered `public/pet.svg` image embed.
- Verified by: `tests/pet-engine/freshForkOnboardingRemediation.test.ts` (Tests `P1-02-A` and `P1-02-B` passed).

### 1.2 Interactive Menu Script Validation
- `tests/unit/readmeMenu.test.ts`: 17/17 tests passed.
- Validates URL resolution, snippet generation, marker structure, in-place updates, uninstallation, and CRLF line ending preservation.

### 1.3 Static Analysis & Link Checks
- All 5 badge URLs are verified HTTPS links to `github.com/mnp210/GitHub-Profile-Pet`.
- All 5 badge images are verified HTTPS links to `github.com/mnp210/GitHub-Profile-Pet/actions/workflows/{file}.yml/badge.svg?branch=main`.
- All markdown image syntax uses standard `[![alt](image_url)](link_url)` pattern.
- Linter (`npm run lint`): 0 errors, 0 warnings.
- TypeScript (`npx tsc --noEmit`): 0 errors.

---

## 2. Invariance Verification of Sprint 5.0A Implementation

To strictly ensure zero inadvertent modifications to code or telemetry utilities:
- `src/features/pet-engine/reporting/stepSummary.ts`: **Unchanged**
- `src/features/pet-engine/reporting/index.ts`: **Unchanged**
- `src/features/pet-engine/index.ts`: **Unchanged**
- `scripts/process-activity.ts`: **Unchanged**
- `scripts/publish-pipeline.ts`: **Unchanged**
- `scripts/process-inbox.ts`: **Unchanged**
- `scripts/probe-github-contributions.ts`: **Unchanged**
- `tests/unit/stepSummary.test.ts`: **Unchanged**

---

## 3. Complete README Git Diff

```diff
diff --git a/README.md b/README.md
index 6776689..40853b1 100644
--- a/README.md
+++ b/README.md
@@ -2,6 +2,12 @@
 
 A customizable, virtual developer pet companion hosted natively in your GitHub repository and driven by autonomous GitHub Actions workflows.
 
+[![Deploy Playable Game to GitHub Pages](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/deploy-pages.yml/badge.svg?branch=main)](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/deploy-pages.yml)
+[![Pet Activity Progression](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-activity.yml/badge.svg?branch=main)](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-activity.yml)
+[![Pet SVG Publication](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-publisher.yml/badge.svg?branch=main)](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-publisher.yml)
+[![Pet Care Action Inbox](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-interaction.yml/badge.svg?branch=main)](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/pet-interaction.yml)
+[![Diagnostics Contribution Probe](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/diagnostics-contribution-probe.yml/badge.svg?branch=main)](https://github.com/mnp210/GitHub-Profile-Pet/actions/workflows/diagnostics-contribution-probe.yml)
+
 The companion features **serverless care interactions** (Feed, Train, Rest, Pet via native GitHub Issue Forms), **deterministic passive vitals simulation** (hunger and happiness decay over elapsed time), **fail-closed trainer authorization**, and **automated SVG badge publishing** directly to your profile README.
 
 <!-- START_SECTION:github-profile-pet -->
@@ -65,14 +71,16 @@ graph LR
 
 ## Active GitHub Actions Workflows
 
-The companion operates via four dedicated workflows in [`.github/workflows/`](.github/workflows/):
+The companion operates via dedicated production workflows in [`.github/workflows/`](.github/workflows/):
 
 | Workflow Name | File | Exact Triggers & Cadence | Least-Privilege Permissions | Description & Role |
 | :--- | :--- | :--- | :--- | :--- |
-| **Pet Baseline Initialization** | [`pet-baseline.yml`](.github/workflows/pet-baseline.yml) | `workflow_dispatch` only | `contents: write` | **One-Time Setup Only:** Establishes the authoritative contribution baseline for a fresh installation. Fails closed if already established. |
+| **Deploy Playable Game to GitHub Pages** | [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) | 1. `push`: `[main]`<br>2. `workflow_dispatch` | `contents: read`, `pages: write`, `id-token: write` | Builds static assets and deploys the full-featured playable virtual pet game to GitHub Pages. |
+| **Pet Activity Progression** | [`pet-activity.yml`](.github/workflows/pet-activity.yml) | 1. `push`: `[main]`<br>2. `issues`: `[opened]`<br>3. `pull_request`: `[opened, closed]`<br>4. `pull_request_review`: `[submitted]`<br>5. `schedule`: `*/30 * * * *`<br>6. `workflow_dispatch` | `contents: write`, `issues: read`, `pull-requests: read` | Processes commits, merged PRs, reviews, and issues into pet XP progression with permanent deduplication. |
 | **Pet SVG Publication** | [`pet-publisher.yml`](.github/workflows/pet-publisher.yml) | 1. `schedule`: `47 * * * *` (Hourly)<br>2. `workflow_dispatch` (`force_render`: bool) | `contents: write` | Simulates passive hunger/happiness decay over elapsed time and publishes updated vitals and `public/pet.svg`. |
 | **Pet Care Action Inbox** | [`pet-interaction.yml`](.github/workflows/pet-interaction.yml) | 1. `issues`: `[opened]`<br>2. `schedule`: `47 * * * *` (Hourly sweep)<br>3. `workflow_dispatch` | `contents: write`, `issues: write` | Drains pending care action issues (`pet-action:pending`), verifies trainer identity, executes state transitions, and closes issues with feedback labels. |
 | **Diagnostics Contribution Probe** | [`diagnostics-contribution-probe.yml`](.github/workflows/diagnostics-contribution-probe.yml) | `workflow_dispatch` only (`owner_login`: string) | `contents: read` | **Diagnostic Tool Only:** Verifies read-only GraphQL public contribution queries and numeric identity resolution using `GITHUB_TOKEN`. Does **not** mutate state. |
+| **Pet Baseline Initialization** | [`pet-baseline.yml`](.github/workflows/pet-baseline.yml) | `workflow_dispatch` only | `contents: write` | **One-Time Setup Only:** Establishes the authoritative contribution baseline for a fresh installation. Fails closed if already established. |
 
 ---
```

---

## 4. Conclusion
Zero unintended edits, deletions, or marker corruptions occurred. All regression checks passed cleanly.
