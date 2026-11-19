# GitHub Profile Pet — Production Launch & Readiness Checklist

**Document ID:** `docs/operations/production-launch-checklist.md`  
**Milestone:** Phase 3C2.3-A.2 (Final Operational Recovery & GraphQL Safety Corrections)  
**Target Repository:** `<owner>/<repo>` (Operational Reference)  
**Status:** Operational Pre-Launch Document (Awaiting Baseline Authorization)  

---

## Phase 1: Pre-Baseline Readiness Checklist

Every item in this section must be verified prior to authorizing baseline initialization.

- [ ] **1.1 Repository Identity Verification**
  - *Requirement:* Working tree remote `origin` points strictly to `<owner>/<repo>`.
  - *Verification Command:*
    ```bash
    git remote get-url origin
    # Expected: https://github.com/<owner>/<repo>.git (or git@github.com:<owner>/<repo>.git)
    ```
  - *Qualification (F-02):* The local branch check confirms local branch alignment, but does not independently inspect remote URLs. Production safety relies on `actions/checkout@v4` on the Actions runner to configure the correct repository origin.

- [ ] **1.2 Owner Identity & Personal Account Type**
  - *Requirement:* Owner login is `<owner-username>`, immutable numeric database ID is `<owner-database-id>`, and account type is `User`.
  - *Verification Command:*
    ```bash
    node --experimental-strip-types scripts/probe-github-contributions.ts
    # Expected output: isPersonalAccount: true, databaseId: <owner-database-id>, login: "<owner-username>"
    ```

- [ ] **1.3 Workflow Configurations & Schedule Overlap**
  - *Requirement:* `.github/workflows/pet-publisher.yml` has single hourly cron `47 * * * *`, least-privilege `contents: write`, and concurrency group `pet-runtime-${{ github.repository }}`.
  - *Verification Command:*
    ```bash
    node --test --experimental-strip-types tests/pet-engine/publication.test.ts
    # Expected: TC-PUB-01 PASS (confirms 47 * * * * present, 23 */6 * * * absent)
    ```

- [ ] **1.4 GitHub Secrets and Environment Variables**
  - *Requirement:* Zero proprietary secrets required. Default runner `GITHUB_TOKEN` is used exclusively.
  - *Verification:* Check repository Settings $\rightarrow$ Secrets and variables $\rightarrow$ Actions. Confirm no custom PAT or database URL is required for GitHub-native operation.

- [ ] **1.5 Required Authoritative Files Existence**
  - *Requirement:* All 4 authoritative runtime files exist, are readable, and non-empty.
  - *Verification Command:*
    ```bash
    node -e 'const { verifyRequiredAuthoritativeFiles } = require("./src/features/pet-engine/publication/publishPipeline.ts"); verifyRequiredAuthoritativeFiles(".").then(r => console.log(r));'
    # Expected: { valid: true, missingFiles: [] }
    ```

- [ ] **1.6 Schema Validity & Pristine Ledger Invariant**
  - *Requirement:* `pet/ledger/contributions.json` passes strict pristine predicate (`isPristineContributionLedger`).
  - *Verification Command:*
    ```bash
    node -e 'const fs = require("fs"); const { isPristineContributionLedger } = require("./src/features/pet-engine/validation/ledgerValidator.ts"); const l = JSON.parse(fs.readFileSync("pet/ledger/contributions.json")); console.log("Pristine:", isPristineContributionLedger(l, 298821706));'
    # Expected: Pristine: true
    ```

- [ ] **1.7 Clean Working Tree & Branch Alignment**
  - *Requirement:* Repository is on branch `main` with zero uncommitted or untracked changes.
  - *Verification Command:*
    ```bash
    git status --porcelain
    # Expected: (empty output)
    ```

- [ ] **1.8 Generation Lockstep & Source SHA**
  - *Requirement:* `pet/state/pet.json`, `pet/ledger/contributions.json`, and `pet/ledger/actions.json` all share generation `1`.
  - *Verification Command:*
    ```bash
    node -e 'const fs = require("fs"); const g1 = JSON.parse(fs.readFileSync("pet/state/pet.json")).generation; const g2 = JSON.parse(fs.readFileSync("pet/ledger/contributions.json")).generation; const g3 = JSON.parse(fs.readFileSync("pet/ledger/actions.json")).generation; console.log({g1, g2, g3});'
    # Expected: { g1: 1, g2: 1, g3: 1 }
    ```

- [ ] **1.9 Provider Health, Quota Baseline & Rate Limit Safeguard (F-02, F-03)**
  - *Requirement:* GitHub GraphQL API is reachable. Conservative planning baseline is GitHub's authoritative 1,000 pt/hr limit for Actions `GITHUB_TOKEN`. Points remaining $\ge 1,000$ points.
  - *Verification Command:*
    ```bash
    node --experimental-strip-types scripts/probe-github-contributions.ts
    # Expected: rateLimit.remaining >= 1000, rateLimit.cost >= 1
    ```
  - *Cost Note (F-02, F-03):* The diagnostic probe observed a query cost of 1 point for its specific payload. This is an observed measurement, not a fixed-cost contract guarantee. The runtime dynamically measures `rateLimit.cost` and `rateLimit.remaining`.
  - *Safeguard Limitation Statement:* The configured 50-point threshold is a conservative safeguard intended to reduce rate-limit exhaustion risk. It cannot guarantee immunity from primary or secondary rate limits, external API usage, or changes to GitHub's policies.
  - *Call Site Separation:* `scripts/probe-github-contributions.ts` is purely a diagnostic tool; only Path B (`pet-publisher.yml`) invokes the production provider. Expected scheduled executions are 24 runs/day (manual dispatches may add runs). Path A invokes zero GraphQL queries.

---

## Phase 2: Baseline Establishment Checklist

*(To be executed during authorized Phase 3C2.3-B via Path B: `pet-publisher.yml`)*

- [ ] **2.1 Explicit Operator Approval Recorded**
  - *Requirement:* User authorization documented in audit trail before dispatch.

- [ ] **2.2 Baseline Execution via Dry-Run Verification**
  - *Requirement:* Dry-run execution demonstrates `baseline_established` without disk mutation.
  - *Verification Command:*
    ```bash
    node --experimental-strip-types scripts/publish-pipeline.ts --ref main --dry-run --skip-push
    ```

- [ ] **2.3 Production Baseline Execution**
  - *Requirement:* Executed via manual `workflow_dispatch` on `Pet SVG Publication` workflow (`pet-publisher.yml`).

- [ ] **2.4 Zero Historical Retroactive Rewards**
  - *Requirement:* In resulting commit, `pet.xp` is strictly 0 and `slices` is strictly `[]`.

- [ ] **2.5 Baseline Document Fields Recorded**
  - *Requirement:* `installationBaseline.completed === true`, `initialCounts` recorded, `dailyRewardOrdinal` initialized to 0.

- [ ] **2.6 Generation Advancement**
  - *Requirement:* Generations lockstep advanced from 1 to 2 across all three JSON documents.

---

## Phase 3: First Live Synchronization Checklist

*(To be verified during the first hourly scheduled run of Path B following baseline)*

- [ ] **3.1 GraphQL Provider Success**
  - *Requirement:* Log reports successful snapshot fetch with 1 GraphQL request.

- [ ] **3.2 Rate-Limit Telemetry Recording**
  - *Requirement:* Actual query cost and remaining quota recorded in sync receipt.

- [ ] **3.3 Daily High-Water Mark Progression**
  - *Requirement:* If new contributions occurred, `dailyHwm` advances monotonically. If zero contributions, HWM unchanged.

- [ ] **3.4 Ordinal Reward Progression**
  - *Requirement:* If new contributions observed, first increment awarded Ordinal 1 (+25 XP, +10 satiety).

- [ ] **3.5 Reward Conservation Verification**
  - *Requirement:* `totalRecordedUnits = rewarded + forfeited + pending + expired`.

- [ ] **3.6 SVG Badge Rendering & README Embed**
  - *Requirement:* `public/pet.svg` updated and valid; `README.md` marker section intact.

- [ ] **3.7 Fast-Forward Push Success**
  - *Requirement:* Push succeeds cleanly with `[skip ci]` commit message.

---

## Phase 4: Post-Launch Ongoing Monitoring

- [ ] **4.1 Workflow Run Status:** Monitor GitHub Actions tab daily for any failed runs.
- [ ] **4.2 Runner Queue Latency:** Track job start delay at minute 47; verify concurrency serialization. Note that the durable Issue inbox and subsequent recovery sweeps provide eventual recovery opportunities, subject to GitHub Actions availability, scheduling delays, and concurrency contention.
- [ ] **4.3 Rate Limit Health:** Ensure rate limit remaining consistently exceeds 50 points against the 1,000 pt/hr planning ceiling. Note that while this conservative threshold reduces risk, it cannot guarantee complete immunity from primary or secondary limits.
- [ ] **4.4 Ledger Schema Invariant:** Run automated integrity tests weekly (`npm run test:pet-engine`).
- [ ] **4.5 Inactivity Suspension Check & Re-Enablement (F-01):** Check at 45 days of inactivity to prevent GitHub's 60-day cron pause. If suspended, re-enable workflows via the GitHub Web UI ("Enable workflow"), GitHub CLI (`gh workflow enable <file>`), or REST API; do not rely on `workflow_dispatch` alone.
- [ ] **4.6 Capacity and Usage Accounting:**
  - Standard hosted runners in public repositories (`ubuntu-latest`: 4 vCPUs, 16 GB RAM, 14 GB SSD) are free of runner-minute charges, subject to GitHub usage policies and capacity. Free of charge does not mean unlimited execution capacity or guaranteed scheduling.
  - For private repositories, compute usage (`ubuntu-latest`: 2 vCPUs, 8 GB RAM, 14 GB SSD; SKU: `actions_linux`) draws from the account's monthly included monetary compute allowance (e.g. $12.00 USD/month on GitHub Free) at the standard Linux rate ($0.006/min for 2-core x64). Job durations round up to the nearest whole minute. An illustrative scenario of 48 runs/day at 1 min/job across a 30-day month yields ~1,440 billable minutes (~$8.64 USD/month, or ~72% of a $12.00 allowance). This is an illustrative estimate; all other account workflows and shared compute workloads draw from the same allowance.
