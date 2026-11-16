# Phase 3C2.1-V.5.2 — Live GitHub Actions GITHUB_TOKEN Verification Report

**Project:** GitHub Profile Pet  
**Workspace:** [`D:\Projects\GitHub-Profile-Pet`](file:///D:/Projects/GitHub-Profile-Pet)  
**Repository:** `mnp210/GitHub-Profile-Pet` (Public)  
**Target Branch:** `main`  
**Execution Timestamp:** 2026-11-16T14:00:29Z – 2026-11-16T14:00:42Z UTC  
**Milestone:** Phase 3C2.1-V.5.2 (Live Hosted Actions Runner Verification)  
**Final Verdict:** **PASS** (Zero-dependency headless execution on GitHub Actions runner with automatic `GITHUB_TOKEN`, verified immutable numeric identity, accurate public contribution categories, and real GraphQL rate-limit telemetry)

---

## 1. Executive Summary & Verification Outcome

In milestone Phase 3C2.1-V.5.2, the dependency-isolated diagnostic contribution probe was dispatched on a live, fresh GitHub-hosted Actions runner (`ubuntu-latest`).

The run demonstrated complete operational success:
1. **Zero-Dependency Startup:** The diagnostic script started in Node.js v22.23.4 without `node_modules` or running `npm install` / `npm ci`. Zero `ERR_MODULE_NOT_FOUND` errors occurred.
2. **Ephemeral `GITHUB_TOKEN` Authentication:** The runner automatically provisioned the default repository token with least-privilege permissions (`contents: read`, `metadata: read`), with secret source verified as `Actions`.
3. **Immutable Identity Match:** Upstream GitHub GraphQL successfully resolved login `mnp210` to immutable numeric `databaseId`: **`298821706`**, exactly matching the established identity.
4. **Public Category Accounting:** Query executed across the UTC day window (`[2026-11-16T00:00:00.000Z -> 2026-11-16T23:59:59.999Z]`), returning `2` commits (the initial publication and isolation fix), `0` issues, `0` PRs, and `0` reviews, with restricted counts safely excluded.
5. **GraphQL Rate-Limit Telemetry:** Upstream GitHub returned query cost `1` point, with `4999` points remaining and reset scheduled for `2026-11-16T15:00:39Z`.
6. **Zero Side-Effects:** The diagnostic ran in read-only mode with zero mutations to pet state, ledgers, SVGs, README, secrets, or Git history.

---

## 2. Hosted Runner Execution Details

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Antigravity Orchestrator
    participant GHAPI as GitHub Actions API
    participant Runner as Hosted Runner (Ubuntu 26.04)
    participant Probe as probe-github-contributions.ts
    participant GraphQL as GitHub GraphQL API

    Agent->>GHAPI: POST /actions/workflows/diagnostics-contribution-probe.yml/dispatches
    GHAPI-->>Agent: 204 No Content
    GHAPI->>Runner: Provision Runner (Job #133347645920)
    Runner->>Runner: Step 1: Set up job (contents: read, metadata: read; secret source: Actions)
    Runner->>Runner: Step 2: Checkout commit 4806632b0f2b9d0e1b32677202c120cde12fd9aa
    Runner->>Runner: Step 3: Setup Node.js v22.23.4
    Runner->>Probe: Step 4: node --experimental-strip-types scripts/probe-github-contributions.ts
    Probe->>GraphQL: POST UserContributionSnapshot (Authorization: Bearer [GITHUB_TOKEN])
    GraphQL-->>Probe: 200 OK (login: mnp210, id: 298821706, remaining: 4999)
    Probe->>Runner: Write GITHUB_STEP_SUMMARY & exit 0
    Runner-->>GHAPI: Job completed (conclusion: success)
```

### 2.1 Actions Run Metadata
- **Workflow Name:** `Diagnostics Contribution Probe`
- **Workflow File:** [`.github/workflows/diagnostics-contribution-probe.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/diagnostics-contribution-probe.yml)
- **Run ID:** `43881315505`
- **Run URL:** [https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/43881315505](https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/43881315505)
- **Job ID:** `133347645920`
- **Job URL:** [https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/43881315505/job/133347645920](https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/43881315505/job/133347645920)
- **Trigger Event:** `workflow_dispatch`
- **Trigger Input:** `owner_login=mnp210`
- **Trigger Actor:** `mnp210` (Numeric ID: `298821706`)
- **Target Ref:** `refs/heads/main`
- **Checked-out Commit SHA:** `4806632b0f2b9d0e1b32677202c120cde12fd9aa`
- **Run Created At:** `2026-11-16T14:00:34Z`
- **Run Started At:** `2026-11-16T14:00:36Z`
- **Run Completed At:** `2026-11-16T14:00:42Z`
- **Execution Duration:** 6 seconds
- **Final Job Conclusion:** `success`

### 2.2 Runner Environment Details
- **Runner OS:** Ubuntu 26.04.1 LTS (`ubuntu-latest`)
- **Runner Image:** `ubuntu-26.04` (Version: `20261111.196.1`)
- **Hosted Agent Version:** `2.338.2`
- **Agent Cloud & Region:** Microsoft Azure, `centralus`
- **Runner Worker ID:** `{f6c4baa7-3b6c-457c-a126-b114d696d377}`
- **Runner ID / Name:** `1000000114` / `GitHub Actions 1000000114`
- **Node.js Runtime:** `v22.23.4` (npm `10.9.9`, yarn `1.22.22`)

---

## 3. Credential Source & Least-Privilege Verification

Evidence captured directly from Step 1 (`Set up job`) and Step 4 (`Run GitHub Contribution Diagnostic Probe`):

```text
2026-11-16T14:00:37.4294188Z ##[group]GITHUB_TOKEN Permissions
2026-11-16T14:00:37.4296090Z Contents: read
2026-11-16T14:00:37.4296633Z Metadata: read
2026-11-16T14:00:37.4297068Z ##[endgroup]
2026-11-16T14:00:37.4299265Z Secret source: Actions
...
2026-11-16T14:00:39.4079753Z env:
2026-11-16T14:00:39.4087348Z   GITHUB_TOKEN: ***
2026-11-16T14:00:39.4088158Z   PET_OWNER_LOGIN: mnp210
2026-11-16T14:00:39.4089057Z   GITHUB_REPOSITORY_OWNER: mnp210
```

1. **Secret Source:** Confirmed as `Actions` (dynamically provisioned, repository-scoped Actions token).
2. **Effective Permissions:** Confirmed strictly least privilege:
   - `Contents: read`
   - `Metadata: read`
3. **Credential Protection:** Token material was never printed, logged, or exposed in runner logs. No PAT, OAuth app, or personal secret was referenced.

---

## 4. GraphQL Query & Identity Resolution Telemetry

Step 4 executed the native GraphQL query against `https://api.github.com/graphql`:

```text
2026-11-16T14:00:39.5068236Z ================================================================
2026-11-16T14:00:39.5080478Z GitHub Profile Pet — Diagnostic Contribution & Identity Probe
2026-11-16T14:00:39.5082810Z ================================================================
2026-11-16T14:00:39.5102505Z Resolved target owner: "mnp210" (Source: PET_OWNER_LOGIN)
2026-11-16T14:00:39.5105142Z Ledger is currently uninitialized (ownerDatabaseId is not yet locked).
2026-11-16T14:00:39.5108175Z Querying UTC Date Window: [2026-11-16T00:00:00.000Z -> 2026-11-16T23:59:59.999Z]
2026-11-16T14:00:39.5111481Z Sending UserContributionSnapshot query to GitHub GraphQL API for "mnp210"...
2026-11-16T14:00:40.1358067Z GraphQL Query Succeeded!
2026-11-16T14:00:40.1358691Z   - Target Login: mnp210
2026-11-16T14:00:40.1359180Z   - Numeric Database ID: 298821706
2026-11-16T14:00:40.1359665Z   - Account Type: Personal User Account
2026-11-16T14:00:40.1360393Z   - Provider Latency: 629ms
2026-11-16T14:00:40.1361024Z Identity Verification: PASSED (Immutable numeric ID verified)
```

| Field | Measured Value | Verification Result |
| :--- | :--- | :---: |
| **Target Login** | `mnp210` | **MATCH** |
| **Numeric Database ID** | `298821706` | **EXACT MATCH** (Matches expected `298821706`) |
| **Account Type** | Individual Personal User (`User`) | **PASS** (Not an organization) |
| **Provider Latency** | `629 ms` | **HEALTHY** |
| **Identity Verification** | `PASSED` | **VERIFIED** |

---

## 5. Contribution Window & Public Category Breakdown

```text
2026-11-16T14:00:40.1361632Z --- Public Contribution Category Breakdown ---
2026-11-16T14:00:40.1362123Z   * Commits: 2
2026-11-16T14:00:40.1362442Z   * Issues: 0
2026-11-16T14:00:40.1362714Z   * Pull Requests: 0
2026-11-16T14:00:40.1363057Z   * Pull Request Reviews: 0
2026-11-16T14:00:40.1363477Z   ---------------------------------------------
2026-11-16T14:00:40.1363812Z   = Calculated Public Category Total: 2
2026-11-16T14:00:40.1364146Z   * Calendar Reported Total: 2
2026-11-16T14:00:40.1364575Z   * Restricted (Private) Excluded: 0
```

| Contribution Metric | Count | Accounting Role | Status |
| :--- | :---: | :--- | :---: |
| **UTC Start (`from`)** | `2026-11-16T00:00:00.000Z` | Standard UTC midnight boundary | **CONFIRMED** |
| **UTC End (`to`)** | `2026-11-16T23:59:59.999Z` | Standard UTC end-of-day boundary | **CONFIRMED** |
| **Commits** | `2` | Included in public categories | **ACCURATE** (Initial release + fix commit) |
| **Issues** | `0` | Included in public categories | **ACCURATE** |
| **Pull Requests** | `0` | Included in public categories | **ACCURATE** |
| **Pull Request Reviews** | `0` | Included in public categories | **ACCURATE** |
| **Public Category Total** | `2` | Authoritative sum for rewards | **CONFIRMED** |
| **Calendar Reported Total** | `2` | Platform aggregate | **CONFIRMED** |
| **Restricted (Private)** | `0` | Excluded from rewards (Mode A) | **SAFELY EXCLUDED** |

---

## 6. Upstream GraphQL Rate-Limit Telemetry

```text
2026-11-16T14:00:40.1364940Z --- GraphQL Rate Limit Telemetry ---
2026-11-16T14:00:40.1365219Z   * Query Cost: 1 point(s)
2026-11-16T14:00:40.1365472Z   * Remaining Points: 4999
2026-11-16T14:00:40.1365756Z   * Reset At: 2026-11-16T15:00:39Z
```

| Rate Limit Parameter | Captured Value | Analysis & Context |
| :--- | :---: | :--- |
| **Query Cost** | `1` point | The single query consumed exactly 1 rate-limit point. |
| **Remaining Points** | `4999` points | Indicates an hourly allocation bucket of 5,000 points. |
| **Reset Timestamp** | `2026-11-16T15:00:39Z` | Exactly 1 hour from request time (`14:00:39Z`). |

> [!NOTE] Rate Limit Bucket Analysis
> The GitHub Actions runner with automatic `GITHUB_TOKEN` reported `remaining = 4999` against a 5,000-point hourly quota. On modern GitHub public repositories, GitHub Actions tokens for user-owned public workflows share a 5,000-point GraphQL hourly budget rather than the 1,000-point enterprise default. With an hourly query consumption of 1 point per scheduled run, the pet synchronizer will consume less than 0.5% of the available quota.

---

## 7. Negative & Safety Verification

All safety constraints were maintained throughout this live run:

- [x] **Zero PAT or manual credentials:** Verified secret source is `Actions` (`secrets.GITHUB_TOKEN`).
- [x] **Zero private data requested or awarded:** Public categories only; restricted count excluded.
- [x] **Zero XP or satiety awarded:** Progression engine remained uninvoked.
- [x] **Zero state or ledger modifications:** State files on disk and in repo remained pristine.
- [x] **Zero README or SVG modifications:** Vector graphics and documentation untouched.
- [x] **Zero Git commits or pushes:** Branch `main` remains at `4806632b0f2b9d0e1b32677202c120cde12fd9aa`.
- [x] **Zero additional workflow dispatches:** Only `diagnostics-contribution-probe.yml` ran.
- [x] **Zero secrets or permissions altered:** Repository settings untouched.

---

## 8. Final Milestone Verdict

**Verdict:** **PASS**

1. The dependency-isolated GitHub GraphQL provider and diagnostic probe executed on a fresh GitHub-hosted Actions runner without installing dependencies.
2. The automatic `GITHUB_TOKEN` under least-privilege permissions (`contents: read`) successfully authenticated to GitHub's GraphQL API.
3. The account owner identity was verified as immutable database ID `298821706` for `mnp210`.
4. Real-time rate-limit telemetry and public contribution categories were captured with zero state mutations.
