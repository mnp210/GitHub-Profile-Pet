# GitHub Profile Pet — Production Contribution Baseline Procedure

**Document ID:** `docs/operations/contribution-baseline-procedure.md`  
**Milestone:** Phase 3C2.3-A.2 (Final Operational Recovery & GraphQL Safety Corrections)  
**Target Repository:** `mnp210/GitHub-Profile-Pet`  
**Status:** Approved Reference  

---

## 1. Purpose & Non-Retroactive Invariant

The **Installation Baseline** establishes the authoritative contribution reference point for a new pet companion. 

### The Core Invariant
> **Historical contributions prior to pet installation MUST NEVER be awarded retroactively.**  
> Existing lifetime contributions observed during the first synchronization run serve solely to calibrate the initial daily high-water marks (`dailyHwm`) and baseline records. **Zero XP, zero satiety, and zero reward slices are awarded upon baseline establishment.**

Subsequent contributions observed in future hourly synchronization runs that exceed these initial high-water marks will be eligible for rewards, starting strictly at **Reward Ordinal 1** for their respective calendar date.

---

## 2. Pre-Baseline Verification Protocol

Before initiating the baseline synchronization run, the operator must execute the following non-mutating pre-checks:

### 2.1 Repository and Owner Identity Checks
1. **Target Repository:** Verify current Git origin URL points to `mnp210/GitHub-Profile-Pet`:
   ```bash
   git remote get-url origin
   ```
   *Qualification Note (F-02):* The local branch check confirms branch alignment, but the runtime does not independently inspect the remote URL. In production GitHub Actions, `actions/checkout@v4` guarantees that `origin` points to the hosted repository.
2. **Owner Account Type:** Confirm the owner is a personal GitHub user, not an organization:
   - Target Login: `mnp210`
   - Account Type: `User` (`__typename == "User"`)
   - Organization accounts are rejected fail-closed with `OrganizationAccountError`.
3. **Immutable Numeric Database ID:**
   - Confirm owner numeric ID resolution: Database ID `298821706` for `mnp210`.
   - Once recorded in `pet/ledger/contributions.json`, this ID binds the ledger permanently to prevent cross-account credential theft or username recycling.

### 2.2 Provider, Rate-Limit & Credential Checks
1. **Default `GITHUB_TOKEN` Access & Invocation Mapping (F-03):**
   - The default Actions-provided `GITHUB_TOKEN` is used for both the production contribution provider and diagnostic probes.
   - **Production Provider Call Site:** ONLY Path B (`pet-publisher.yml`) calls `twoDayContributionProvider.ts` to sync contributions and update state. It runs on an expected schedule of 24 runs/day (once per hour at `:47`), though manual workflow dispatches can add runs.
   - **Diagnostic Probe Call Site:** `diagnostics-contribution-probe.yml` runs `scripts/probe-github-contributions.ts` via manual dispatch only for read-only connectivity checks. It does not perform contribution accounting, mutate ledgers, or publish commits.
   - **Path A (`pet-interaction.yml`):** Interacts exclusively with GitHub's REST API for Issues and never invokes GraphQL queries.
2. **Dynamic GraphQL Query Cost & Rate-Limit Safeguard (F-02):**
   - The diagnostic probe observed a query cost of 1 point for its specific payload.
   - **This is an observed measurement, not a fixed-cost contract guarantee.** GitHub's GraphQL API calculates query cost dynamically based on requested node complexity.
   - **Primary Quota Baseline:** The conservative planning limit is GitHub Actions' authoritative documented primary quota of **1,000 points per hour per repository** for `GITHUB_TOKEN`. (The 5,000 pt/hr ceiling seen in run `44051016461` is a runtime observation, not an alternative Actions quota).
   - The runtime dynamically inspects `rateLimit.cost` and `rateLimit.remaining`. If remaining quota falls below 50 points, execution defers cleanly with zero ledger mutation.
   - **Safeguard Limitation Statement:**
     > The configured threshold is a conservative safeguard intended to reduce rate-limit exhaustion risk. It cannot guarantee immunity from primary or secondary rate limits, external API usage, or changes to GitHub's policies.
3. **Public Category Boundaries:** Confirm the GraphQL query requests only the four public contribution categories:
   - `totalCommitContributions`
   - `totalIssueContributions`
   - `totalPullRequestContributions`
   - `totalPullRequestReviewContributions`
   - Restricted private contributions (`restrictedContributionsCount`) are strictly excluded.

### 2.3 Pristine Installation Predicate
Inspect `pet/ledger/contributions.json` to verify that it satisfies the accepted mathematical pristine predicate (`isPristineContributionLedger`):
- `schemaVersion === 1`
- `generation >= 1` (integer)
- `installationBaseline === undefined` (must not exist)
- `slices.length === 0` (empty array)
- `monthlyHistoricalSummary.length === 0` (empty array)
- `dailyHwm` is undefined or `{}`
- `dailyRewardOrdinal` is undefined or `{}`
- `dailyAccruedXp` is undefined or `{}`
- `lastSyncReceipt === undefined`
- `hourlyIncrementUsage` is undefined or `{}`
- `monotonicPublicHwm === 0` or undefined
- `ownerDatabaseId` is undefined or matches `298821706`

> [!CAUTION]
> **Fail-Closed Condition:** If `pet/ledger/contributions.json` contains partial baseline records, existing slices, non-empty daily high-water marks, or contradictory receipts, the runtime classifies this as a **Class B Fatal Local Integrity Failure**. Baseline establishment will immediately abort with `LedgerIntegrityError`. Operators must investigate manually; the runtime will never silently overwrite or repair damaged ledgers.

### 2.4 Authoritative Runtime Documents
Confirm all four required authoritative files exist, are readable, and share matching generation counters:
- `pet/state/pet.json` (Generation: $G$, valid pet state document)
- `pet/ledger/contributions.json` (Generation: $G$, pristine contribution ledger)
- `pet/ledger/actions.json` (Generation: $G$, valid action ledger)
- `public/pet.svg` (Readable vector badge)

---

## 3. Baseline Semantics vs. Ordinary Synchronization

Baseline establishment is executed strictly via **Path B (`pet-publisher.yml`)**. Path A (`pet-interaction.yml`) handles only issue-based care actions and never invokes the contribution provider.

| Property | Installation Baseline Run (Path B) | Ordinary Synchronization Run (Path B) |
|---|---|---|
| **Pristine Predicate** | Must evaluate to `true` | Evaluates to `false` (baseline completed) |
| **`installationBaseline`** | Created with `completed: true`, timestamp, and counts | Read-only; preserved untouched |
| **Observed Contributions** | Captured as initial reference counts | Compared against `dailyHwm` to find new increments |
| **XP Awarded** | **Strictly 0 XP** | Calculated via diminishing reward schedule (5–25 XP) |
| **Satiety Awarded** | **Strictly 0 Satiety** | Calculated via schedule (1–10 satiety) |
| **Reward Slices** | **0 slices created** (`slices.length == 0`) | Created for each rewarded increment |
| **Initial Ordinals** | Initialized to `0` for yesterday and today | Incremented for each evaluated increment ($1, 2, \dots$) |
| **High-Water Marks** | Initialized to current observed totals | Advanced monotonically if observed counts increase |
| **Sync Receipt Status** | `'success'` with note `'Installation baseline recorded'` | `'success'` or `'noop'` |
| **Return Status** | `'baseline_established'` | `'completed'` or `'noop'` |

---

## 4. Operator Baseline Execution Procedure

*(To be executed only upon authorization in Phase 3C2.3-B)*

### Step 1: Pre-Execution Verification
Ensure local repository is clean and on `main`:
```bash
git checkout main
git pull origin main
git status --porcelain
```
Verify output is completely empty.

### Step 2: Dry-Run Baseline Verification
Execute the publication pipeline in `--dry-run` mode with `--skip-push`:
```bash
node --experimental-strip-types scripts/publish-pipeline.ts --ref main --dry-run --skip-push
```
- Confirm output logs show:
  - `[publish-pipeline] Mode: DRY RUN`
  - `status: "baseline_established"`
  - `xpAwarded: 0`
  - `deltaObserved: 0`
  - `Zero retroactive rewards` note.

### Step 3: Production Baseline Dispatch
When ready for production baseline initialization:
1. Navigate to GitHub Actions tab $\rightarrow$ **Pet SVG Publication** workflow.
2. Select **Run workflow** on branch `main`.
3. Monitor execution logs in runner console.
4. *Operational Note:* The durable Issue inbox and subsequent recovery sweeps provide eventual recovery opportunities, subject to GitHub Actions runner availability and concurrency scheduling.

---

## 5. Post-Baseline Verification Protocol

Immediately after the baseline workflow run completes, the operator must verify:

1. **Generation Counter:**
   - The generation counter across `pet/state/pet.json`, `pet/ledger/contributions.json`, and `pet/ledger/actions.json` advanced by exactly 1 (from 1 to 2).
2. **Zero XP Awarded:**
   - In `pet/state/pet.json`, `xp` remains unchanged (0 XP), and `level` remains 1.
3. **Empty Slices Array:**
   - In `pet/ledger/contributions.json`, `slices` is strictly `[]`.
4. **Baseline Object Recorded:**
   - `pet/ledger/contributions.json` contains:
     ```json
     "installationBaseline": {
       "completed": true,
       "installedAt": "<ISO_TIMESTAMP>",
       "baselineDateUtc": "<TODAY_UTC>",
       "initialCounts": {
         "yesterday": <COUNT>,
         "today": <COUNT>
       }
     }
     ```
5. **High-Water Marks Calibrated:**
   - `dailyHwm` contains keys for yesterday and today matching `initialCounts`.
   - `dailyRewardOrdinal` contains keys for yesterday and today set to `0`.
6. **Conservation Invariant:**
   - `rewarded (0) + forfeited (0) + pending (0) + expired (0) == 0`.
7. **Commit & Publication:**
   - The commit message includes `[skip ci]`.
   - `public/pet.svg` and `README.md` remain valid and consistent.
