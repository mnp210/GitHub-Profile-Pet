# Phase 3 — GitHub Actions Runtime & Safe Publication Architecture

**Document Version:** 1.0.0  
**Domain:** GitHub Actions Workflow Runtime, Safe SVG Publication, Idempotent Git Commits  
**Status:** COMPLETED & VERIFIED (PHASE 3A)  
**Architecture Specification:** Sprint 2.7.4 (`docs/architecture/sprint-2.7-github-native-redesign.md`)  

---

## 1. Executive Overview & System Architecture

Phase 3 establishes the **GitHub Actions Runtime Foundation** for GitHub Profile Pet. Following the architectural decisions confirmed in Sprint 2.7.4, GitHub Profile Pet operates entirely within the user's personal GitHub repository with zero external dependencies:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User's GitHub Repository                        │
│                                                                        │
│  ┌───────────────────────┐            ┌─────────────────────────────┐  │
│  │   pet/state/pet.json  │            │   .github/workflows/        │  │
│  │ (Authoritative State) │            │     pet-publisher.yml       │  │
│  └───────────┬───────────┘            └──────────────┬──────────────┘  │
│              │                                       │                 │
│              ▼                                       ▼                 │
│  ┌───────────────────────┐            ┌─────────────────────────────┐  │
│  │   SVG Render Engine   │ ─────────► │    Atomic File Publisher    │  │
│  │ (Pure & Deterministic)│            │   (public/pet.svg + README) │  │
│  └───────────────────────┘            └──────────────┬──────────────┘  │
│                                                      │                 │
│                                                      ▼                 │
│                                       ┌─────────────────────────────┐  │
│                                       │   Idempotent Git Committer  │  │
│                                       │ (push origin with conflict  │  │
│                                       │      rebase protection)     │  │
│                                       └─────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Core Architecture Guarantees
1. **Self-Hosted per User:** Each user installs the project into their own repository. No centralized backend servers, multi-tenant databases, or third-party schedulers are required.
2. **True Zero Recurring Cost (₹0 / $0.00 / month):** Operates within GitHub's standard free tier for public repositories and within included account allowances for private repositories. No paid subscriptions, ads, or paywalls.
3. **Pure Standalone Publication Runtime:** Operates with zero user computer dependency. In Phase 3A, the workflow validates existing repository state and renders the standalone SVG asset. (Pet simulation and vitals transitions remain decoupled and will be integrated into their dedicated milestone).
4. **Non-Destructive README Embedding:** Updates only content enclosed between explicit demarcation markers (`<!-- START_SECTION:github-profile-pet -->` and `<!-- END_SECTION:github-profile-pet -->`), strictly preserving all surrounding markdown.

---

## 2. GitHub Actions Workflow Specification (`pet-publisher.yml`)

The primary publication workflow is defined in `.github/workflows/pet-publisher.yml`.

### 2.1 Workflow Triggers
```yaml
on:
  schedule:
    # Run every 6 hours at minute 23 (00:23, 06:23, 12:23, 18:23 UTC)
    # Offset from minute zero to mitigate high-load scheduling delays on GitHub infrastructure
    - cron: '23 */6 * * *'
  workflow_dispatch:
    inputs:
      force_render:
        description: 'Force SVG re-generation and README update check'
        required: false
        type: boolean
        default: false
```
- **Scheduled Trigger:** Automatically executes every 6 hours at minute 23. Offset from minute zero to avoid runner queue delays caused by top-of-the-hour load spikes on GitHub infrastructure. In Phase 3A, this scheduled run strictly validates existing state and refreshes published assets without mutating pet vitals.
- **Manual Trigger (`workflow_dispatch`):** Enables repository owners to trigger immediate rendering directly from the GitHub Actions web UI or via GitHub Mobile.

### 2.2 Least-Privilege Permissions
```yaml
permissions:
  contents: write
```
- Strictly limits GitHub Actions permissions to writing repository contents (`public/pet.svg` and `README.md`).
- Explicitly rejects `write-all` permission.
- Denies all other GitHub API scopes (`issues`, `pull-requests`, `packages`, `actions`, `security-events`).

### 2.3 Concurrency Control
```yaml
concurrency:
  group: pet-runtime-${{ github.repository }}
  cancel-in-progress: false
```
- Restricts concurrent executions to **at most one active job** per repository.
- `cancel-in-progress: false` ensures that an active running publisher is never canceled abruptly mid-commit.

### 2.4 Bounded Job Timeout
```yaml
jobs:
  publish-pet:
    runs-on: ubuntu-latest
    timeout-minutes: 5
```
- Sets a strict 5-minute timeout ceiling (compared to GitHub's default 360 minutes).
- Guarantees that any unexpected network deadlock or process hang terminates swiftly without exhausting runner minutes.

---

## 3. Safe SVG Publication & README Embed Protocol

Publication logic is encapsulated in `src/features/pet-engine/publication/` and invoked via `scripts/publish-pet.ts`.

### 3.1 Five-Stage Publication Lifecycle

```
[1. State Load] ──► [2. Pure Render] ──► [3. SVG Validation] ──► [4. Atomic Write] ──► [5. Git Commit]
```

1. **State Load & Invariant Check:**
   - Reads `pet/state/pet.json`.
   - Asserts schema conformance and numeric vital bounds ($[0, 100]$) using `assertValidPetState()`.
2. **Pure Deterministic SVG Generation:**
   - Invokes `renderPetSvg()` to produce the companion card vector asset.
   - Guarantees 100% byte-for-byte determinism for identical pet states.
3. **Strict Structural & Security Assertion:**
   - Passes output through `assertValidSvgOutput()`.
   - Explicitly rejects all scripts (`<script>`), foreign objects (`<foreignObject>`), event handlers (`onclick`, `onload`), external URLs, or protocol injections (`javascript:`, `data:`).
   - If assertion fails, the process terminates immediately with an error. **Zero files are modified.**
4. **Atomic Filesystem Replacement:**
   - Reads existing `public/pet.svg` if present. If content is byte-for-byte identical, writes are skipped (mtime preserved).
   - If content changed, writes to a temporary file (`public/.tmp.pet.svg.<timestamp>.<nonce>`) and atomically renames it over `public/pet.svg`.
5. **README Demarcation Update:**
   - Inspects `README.md` for `<!-- START_SECTION:github-profile-pet -->` and `<!-- END_SECTION:github-profile-pet -->`.
   - If markers exist: Replaces ONLY the enclosed slice with the fresh embed snippet.
   - If NO markers exist: Leaves `README.md` 100% untouched.

---

## 4. README Marker Specification

### 4.1 Canonical Markers
To embed the virtual pet into any GitHub README, add the following HTML comment markers:

```markdown
<!-- START_SECTION:github-profile-pet -->
<p align="center">
  <img src="public/pet.svg" alt="GitHub Profile Pet" width="450" height="200" />
</p>
<!-- END_SECTION:github-profile-pet -->
```

### 4.2 Marker Safety Invariants
- **Unrelated Content Preservation:** Everything above `<!-- START_SECTION:github-profile-pet -->` and everything below `<!-- END_SECTION:github-profile-pet -->` is preserved byte-for-byte.
- **Line-Ending Parity:** Automatically detects CRLF (`\r\n`) vs LF (`\n`) in the source README and formats the replacement block with matching line endings to eliminate cross-platform git diff noise.
- **Malformed Marker Defense:** If markers are unbalanced (e.g. start marker without end marker, or end marker preceding start marker), `MalformedReadmeMarkersError` is thrown, halting execution before any file modification.

---

## 5. Git Commit Idempotency & Conflict Handling

### 5.1 Idempotency Check
Before staging or committing, the workflow executes:
```bash
if git diff --quiet public/pet.svg README.md; then
  echo "No changes detected in public/pet.svg or README.md. Skipping publication commit."
  exit 0
fi
```
If neither `public/pet.svg` nor `README.md` changed, the workflow exits with code 0. **No empty or redundant commits are created.**

### 5.2 Bot Author Identity & Event Loop Suppression
Automated publication commits use GitHub's standard action bot credentials:
```bash
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
```

#### Recursive Trigger Protection Architecture:
1. **Primary Platform Protection (`GITHUB_TOKEN` Event Suppression):**
   According to official GitHub Actions security architecture, when tasks are executed using the repository's built-in `GITHUB_TOKEN`, events triggered by that token (such as `push`) **ordinarily do not trigger new workflow runs**. This platform-level behavior is the definitive mechanism preventing recursive workflow loops.
2. **Role of the `[skip ci]` Commit Convention:**
   The commit message includes `[skip ci]` (`pet: update visual badge [skip ci]`) for secondary, defense-in-depth reasons:
   - **External CI Compatibility:** If the user connects third-party CI pipelines, webhook listeners, or test runners (e.g., Codecov, external linters), `[skip ci]` signals to those external tools that the commit is an automated documentation/asset update and should not trigger heavy external builds.
   - **Custom PAT Fallback:** If a user ever adapts the workflow to use a custom Personal Access Token (where `GITHUB_TOKEN` suppression does not apply), `[skip ci]` provides an additional layer of protection against accidental trigger loops.
   - **Git History Clarity:** Explicitly denotes automated visual asset updates in git logs for human contributors.

### 5.3 Conflict Replay & Push Retry Loop
In distributed GitHub Actions executions, a remote commit might land while the publisher is running. The workflow implements a bounded retry loop:

```bash
MAX_RETRIES=3
RETRY=0
PUSHED=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  if git push origin HEAD:${{ github.ref_name }}; then
    PUSHED=true
    echo "Successfully pushed published pet visual badge."
    break
  else
    echo "Remote branch moved. Fetching and attempting safe fast-forward / rebase..."
    git fetch origin ${{ github.ref_name }}
    if git rebase origin/${{ github.ref_name }}; then
      RETRY=$((RETRY + 1))
    else
      echo "::error::Rebase conflict detected during push retry. Aborting rebase to protect repository state."
      git rebase --abort
      exit 1
    fi
  fi
done

if [ "$PUSHED" = false ]; then
  echo "::error::Unable to push after $MAX_RETRIES retry attempts."
  exit 1
fi
```

#### Conflict Safety Rules
1. **Never Force-Push:** Commands like `git push --force` or `git push --force-with-lease` are strictly prohibited.
2. **Abort on Conflict:** If `git rebase` fails due to merge conflicts, `git rebase --abort` is executed immediately, leaving the working tree clean and exiting with status 1.
3. **Preserve User Changes:** Unrelated user commits (documentation, source code) are cleanly rebased beneath the pet badge update.

---

## 6. Security & Credential Isolation

1. **Zero Secret Requirements:** The workflow uses only the built-in ephemeral `${{ secrets.GITHUB_TOKEN }}` provisioned automatically by GitHub Actions. No Personal Access Tokens (PATs) or repository secrets are required.
2. **Model C Privacy Boundary:** Only public pet state attributes (name, species, level, vitals, mood, evolution form) are rendered into the SVG. Private repository data, emails, runner IPs, and tokens are never included.
3. **SVG Vector Hardening:** The SVG output validator ensures zero injection vectors can reach GitHub Camo or visitor browsers.

---

## 7. Free-Tier Resource, Billing & Lifecycle Analysis

### 7.1 Platform Allowance & Usage Limits
- **Public Repositories:** Standard GitHub-hosted Linux runners (`ubuntu-latest`: 4 vCPUs, 16 GB RAM, 14 GB SSD) are free of minute charges for public repositories. However, they are **subject to GitHub's standard platform policies, abuse and fair-use guidelines, and account concurrency limits** (maximum 20 concurrent jobs across the user's account on GitHub Free). They should not be assumed to be unconditionally unlimited.
- **Private Repositories:** Private repository execution runs on standard Linux runners (`ubuntu-latest`: 2 vCPUs, 8 GB RAM, 14 GB SSD; SKU: `actions_linux`) and draws compute from the account's monthly monetary allowance ($12.00 USD/month on GitHub Free) at $0.006/min.
  - 4 runs/day × 30.5 days = ~122 runs/month.
  - Typical duration: ~15 seconds per run (rounded up to 1 minute per job in GitHub Actions billing increments) = **~122 billed minutes/month (~6.1% of included allowance)**.
  - Leaves ~93.9% of runner minutes for other private development workflows.
  - *Billing Ceiling:* If an account exhausts its included monthly quota, additional workflow runs are either blocked (if the user's spending limit is set to $0.00) or billed according to standard GitHub Actions per-minute rates (if a positive spending limit is configured).

### 7.2 The 60-Day Schedule Inactivity Rule & Re-Enabling Protocol
According to official GitHub documentation, GitHub automatically disables scheduled workflows (`cron`) in public repositories that have not experienced any commit or repository activity for 60 consecutive days.
- **Automatic Disablement Mechanism:** Once 60 days elapse without activity, GitHub suspends cron triggers to conserve server capacity.
- **Re-Enabling Requirement:** To re-enable a schedule that GitHub has automatically disabled, the repository owner must use GitHub's documented workflow management controls:
  1. **Web UI:** Navigate to the repository's **Actions** tab, select the disabled `Pet SVG Publication` workflow from the left sidebar, and click the **"Enable workflow"** button.
  2. **GitHub REST API:** Issue an authenticated `PUT` request to `/repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable`.
  - *Important Clarification:* Simply executing a manual `workflow_dispatch` run does **not** automatically restore a schedule that GitHub has placed into a disabled state; explicit re-enabling through the UI button or enable API endpoint is required.

---

## 8. Verification & Acceptance Criteria (Phase 3A)

The publication engine and workflow are verified by 10 dedicated automated tests in `tests/pet-engine/publication.test.ts`:

- `TC-PUB-01`: Workflow configuration enforces least-privilege permissions, concurrency, and bounded timeouts.
- `TC-PUB-02`: Generates valid, deterministic SVG and writes to target path safely.
- `TC-PUB-03`: Rejects invalid or corrupted pet state documents before file publication.
- `TC-PUB-04`: Atomic publication safety preserves existing SVG on disk if rendering fails.
- `TC-PUB-05`: Idempotency avoids redundant writes when state and rendered output are identical.
- `TC-PUB-06`: Strict preservation of unrelated README content before and after markers.
- `TC-PUB-07`: Leaves README 100% untouched when no markers are present.
- `TC-PUB-08`: Throws `MalformedReadmeMarkersError` when markers are unbalanced or corrupted.
- `TC-PUB-09`: Push retry algorithm enforces maximum attempts, safe rebase, and never force-pushes.
- `TC-PUB-10`: Publication engine and workflow maintain strict credential isolation with zero token leaks.
