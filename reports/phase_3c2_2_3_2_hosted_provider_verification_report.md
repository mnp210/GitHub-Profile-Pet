# Phase 3C2.2.3.2 — Hosted Read-Only Provider Verification Report

**Project:** GitHub Profile Pet  
**Workspace:** [`D:\Projects\GitHub-Profile-Pet`](file:///D:/Projects/GitHub-Profile-Pet)  
**Repository:** `mnp210/GitHub-Profile-Pet` (Public)  
**Target Branch:** `main`  
**Execution Timestamp:** 2026-11-17T08:56:25Z – 2026-11-17T08:56:34Z UTC  
**Milestone:** Phase 3C2.2.3.2 (Hosted Read-Only Provider Verification)  
**Final Verdict:** **PASS** (Zero-dependency headless execution on GitHub Actions runner with automatic `GITHUB_TOKEN`, verified immutable numeric identity, accurate two-day UTC windows and public contribution categories, and real GraphQL rate-limit telemetry with zero retries)

---

## 1. Executive Summary

In milestone Phase 3C2.2.3.2, the corrected Phase 3C2.2.3.1-R2 two-day contribution provider (`GitHubContributionProvider.fetchUserContributionSnapshot2Day`) was executed against GitHub's live GraphQL API from an official GitHub-hosted Actions runner (`ubuntu-latest`).

The verification ran under strictly read-only repository permissions (`contents: read`, `metadata: read`) using solely the ephemeral Actions `GITHUB_TOKEN`. No personal access tokens (PATs), Git Credential Manager sessions, `.env` files, or write privileges were present on the runner.

### Key Verification Highlights
1. **Single-Request Two-Day Aliased Query:** Successfully retrieved independent collections for both UTC dates (`yesterday: 2026-11-16` and `today: 2026-11-17`) along with primary `repositoryOwner` discrimination and rate-limit telemetry in a single network round-trip.
2. **Immutable Owner Identity Resolution:** Upstream GraphQL query resolved login `mnp210` to immutable numeric `databaseId`: **`298821706`**, with `repositoryOwner.__typename` confirmed as **`User`** (individual personal account). Zero fallback queries or organization errors occurred.
3. **Public Category Observation:**
   - **Yesterday (2026-11-16 UTC):** 4 Commits, 0 Issues, 0 PRs, 0 Reviews &rarr; Public Total = 4 (Restricted = 0).
   - **Today (2026-11-17 UTC):** 1 Commit, 0 Issues, 0 PRs, 0 Reviews &rarr; Public Total = 1 (Restricted = 0).
4. **Rate-Limit Telemetry Reconciliation:** Measured actual query cost of **`1 point`** (not assumed or hardcoded). All 5 GraphQL body metrics and 5 HTTP transport headers reconciled with 100% mathematical consistency.
5. **Zero Accounting Mutations:** Zero invocation of the deterministic contribution accounting engine, zero baseline mutations, zero HWM changes, zero ordinal creation, and zero state/ledger/SVG/README writes.

---

## 2. Hosted Workflow Execution Details

### 2.1 Run Identifiers & Timing
- **Workflow File:** [`.github/workflows/diagnostics-contribution-probe.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/diagnostics-contribution-probe.yml)
- **Workflow Run ID:** `44051016461`
- **Workflow Run URL:** [https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/44051016461](https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/44051016461)
- **Job ID:** `133928550033`
- **Job URL:** [https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/44051016461/job/133928550033](https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/44051016461/job/133928550033)
- **Trigger Event:** `workflow_dispatch`
- **Trigger Inputs:** `owner_login: mnp210`
- **Trigger Actor:** `mnp210` (Numeric ID: `298821706`)
- **Target Ref:** `refs/heads/main`
- **Checked-out Commit SHA:** `f3241415943d1f65667ccc1bb5ae32b8977b4e19`
- **Parent Commit SHA:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`
- **Run Created At:** `2026-11-17T08:56:25Z`
- **Run Started At:** `2026-11-17T08:56:25Z`
- **Run Completed At:** `2026-11-17T08:56:34Z`
- **Job Execution Duration:** 6 seconds (overall workflow: 9 seconds)
- **Final Job Conclusion:** `success`

### 2.2 Runner Environment Details
- **Runner OS:** Ubuntu 26.04.1 LTS (`ubuntu-latest`)
- **Runner Image:** `ubuntu-26.04` (Version: `20261111.196.1`)
- **Hosted Agent Version:** `2.338.2`
- **Agent Cloud & Region:** Microsoft Azure, `eastus2`
- **Worker ID:** `{5ca4dfa0-ac09-49a4-9cd6-e40bc2940c28}`
- **Node.js Runtime:** `v22.23.4` (npm `10.9.9`, yarn `1.22.22`)
- **Zero-Dependency Headless Mode:** Executed with `node --experimental-strip-types scripts/probe-github-contributions.ts` without running `npm install`, `npm ci`, or requiring `node_modules`.

---

## 3. Credential Source & Least-Privilege Verification

Evidence extracted directly from Step 1 (`Set up job`) and Step 4 (`Run GitHub Contribution Diagnostic Probe`):

```text
2026-11-17T08:56:29.1624633Z ##[group]GITHUB_TOKEN Permissions
2026-11-17T08:56:29.1627343Z Contents: read
2026-11-17T08:56:29.1627948Z Metadata: read
2026-11-17T08:56:29.1628579Z ##[endgroup]
2026-11-17T08:56:29.1631571Z Secret source: Actions
...
2026-11-17T08:56:31.3954499Z shell: /usr/bin/bash -e {0}
2026-11-17T08:56:31.3955164Z env:
2026-11-17T08:56:31.3958355Z   GITHUB_TOKEN: ***
2026-11-17T08:56:31.3959000Z   PET_OWNER_LOGIN: mnp210
2026-11-17T08:56:31.3959622Z   GITHUB_REPOSITORY_OWNER: mnp210
```

1. **Secret Source:** Confirmed as `Actions` (the ephemeral token generated dynamically per workflow run).
2. **Effective Permissions:** Confirmed strictly read-only:
   - `Contents: read`
   - `Metadata: read`
3. **No Credential Leakage:** Token values were masked (`***`) by GitHub Actions runner redaction and sanitized in all application-level errors and logs.

---

## 4. Upstream Owner Identity Verification

The live query executed against the GitHub GraphQL API endpoint (`https://api.github.com/graphql`) returned authoritative identity data for the queried login `mnp210`:

```text
2026-11-17T08:56:32.0552376Z GraphQL Query Succeeded!
2026-11-17T08:56:32.0554450Z   - Target Login: mnp210
2026-11-17T08:56:32.0555892Z   - Numeric Database ID: 298821706
2026-11-17T08:56:32.0556707Z   - Account Type: Personal User Account (Personal)
2026-11-17T08:56:32.0557385Z   - Provider Latency: 524ms
2026-11-17T08:56:32.0558352Z Identity Verification: PASSED (Immutable numeric ID verified)
```

| Verification Field | Expected / Rule | Live Upstream Value | Verification Status |
| :--- | :--- | :--- | :--- |
| **Target Login** | `mnp210` (case-insensitive) | `mnp210` | **MATCH** |
| **`repositoryOwner.__typename`** | Strictly `User` | `User` | **MATCH** |
| **Numeric Database ID** | Stable integer > 0 | `298821706` | **MATCH** |
| **Account Type** | Individual Personal User | Personal (`isPersonalAccount: true`) | **MATCH** |
| **Organization Detection** | Reject if `Organization` | Not an Organization | **PASS** |
| **Ledger Verification** | Check against uninitialized | Inspection only (no lock yet) | **PASS** |

---

## 5. Two-Day UTC Windows & Contribution Category Counts

The two-day provider computed exact millisecond UTC date boundaries and queried both windows independently using GraphQL aliases (`yesterday` and `today`):

```text
2026-11-17T08:56:31.5325372Z Computed UTC Date Windows:
2026-11-17T08:56:31.5326218Z   - Yesterday (2026-11-16): [2026-11-16T00:00:00.000Z -> 2026-11-16T23:59:59.999Z]
2026-11-17T08:56:31.5327172Z   - Today     (2026-11-17): [2026-11-17T00:00:00.000Z -> 2026-11-17T23:59:59.999Z]
```

### 5.1 Yesterday Window (`2026-11-16` UTC)
- **Window Boundaries:** `[2026-11-16T00:00:00.000Z -> 2026-11-16T23:59:59.999Z]`

| Category | Returned Count | Planned Accounting Treatment (Phase 3C2.2 Scope) |
| :--- | :---: | :--- |
| **Commits** | **`4`** | Eligible candidate increments |
| **Issues** | **`0`** | Eligible candidate increments |
| **Pull Requests** | **`0`** | Eligible candidate increments |
| **PR Reviews** | **`0`** | Eligible candidate increments |
| **Public Category Total** | **`4`** | **Observed Public Sum (Candidate for planned accounting)** |
| **Calendar Reported Total** | `4` | Platform aggregate (Informational) |
| **Restricted (Private)** | `0` | Excluded from candidate rewards (Mode A Public-Only) |

### 5.2 Today Window (`2026-11-17` UTC)
- **Window Boundaries:** `[2026-11-17T00:00:00.000Z -> 2026-11-17T23:59:59.999Z]`

| Category | Returned Count | Planned Accounting Treatment (Phase 3C2.2 Scope) |
| :--- | :---: | :--- |
| **Commits** | **`1`** | Eligible candidate increments (commit `f3241415943d1f65667ccc1bb5ae32b8977b4e19`) |
| **Issues** | **`0`** | Eligible candidate increments |
| **Pull Requests** | **`0`** | Eligible candidate increments |
| **PR Reviews** | **`0`** | Eligible candidate increments |
| **Public Category Total** | **`1`** | **Observed Public Sum (Candidate for planned accounting)** |
| **Calendar Reported Total** | `1` | Platform aggregate (Informational) |
| **Restricted (Private)** | `0` | Excluded from candidate rewards (Mode A Public-Only) |

---

## 6. Rate-Limit Telemetry & Actual Cost Measurement

The runner recorded the actual rate-limit telemetry returned in the GraphQL response body alongside the HTTP transport headers:

```text
2026-11-17T08:56:32.0578459Z --- GraphQL Rate Limit Telemetry ---
2026-11-17T08:56:32.0578949Z   * Pool Limit: 5000 points
2026-11-17T08:56:32.0579661Z   * Query Cost: 1 point(s)
2026-11-17T08:56:32.0580202Z   * Remaining Points: 4999
2026-11-17T08:56:32.0580737Z   * Used Points: 1
2026-11-17T08:56:32.0581324Z   * Reset At: 2026-11-17T09:56:31Z
2026-11-17T08:56:32.0581678Z 
2026-11-17T08:56:32.0581979Z --- HTTP Response Headers (Rate Limit) ---
2026-11-17T08:56:32.0582565Z   * x-ratelimit-limit: 5000
2026-11-17T08:56:32.0583037Z   * x-ratelimit-remaining: 4999
2026-11-17T08:56:32.0583524Z   * x-ratelimit-used: 1
2026-11-17T08:56:32.0583987Z   * x-ratelimit-reset: 1794909391
2026-11-17T08:56:32.0585196Z   * x-ratelimit-resource: graphql
2026-11-17T08:56:32.0585952Z Telemetry Consistency Check: PASSED (GraphQL body and HTTP headers agree)
```

### Telemetry Reconciliation Matrix

| Telemetry Field | GraphQL Response Body | HTTP Transport Header | Status |
| :--- | :---: | :---: | :--- |
| **Pool Limit** | `5000` | `x-ratelimit-limit: 5000` | **MATCH** |
| **Query Cost** | `1` | *N/A (GraphQL only)* | **MEASURED: 1 point** |
| **Remaining Points** | `4999` | `x-ratelimit-remaining: 4999` | **MATCH** |
| **Used Points** | `1` | `x-ratelimit-used: 1` | **MATCH** |
| **Reset Timestamp** | `2026-11-17T09:56:31Z` | `x-ratelimit-reset: 1794909391` | **MATCH** (`1794909391` s &equiv; `2026-11-17T09:56:31.000Z`) |
| **Resource Pool** | *N/A* | `x-ratelimit-resource: graphql` | **MATCH** |
| **Provider Latency** | `524ms` | *N/A* | **NORMAL** |
| **Retry Count** | `0` | *N/A* | **ZERO RETRIES** |

*Note on Query Cost:* The live GitHub GraphQL query cost for `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY` was measured at exactly **1 point** against the 5,000-point hourly pool.

---

## 7. Pre-Publication Quality Assurance & Local Matrix

Prior to committing and publishing commit `f3241415943d1f65667ccc1bb5ae32b8977b4e19`, the full repository validation matrix was executed locally on `D:\Projects\GitHub-Profile-Pet`:

| Test Suite / Quality Gate | Command | Pass Count | Fail Count | Result |
| :--- | :--- | :---: | :---: | :--- |
| **TypeScript Typecheck** | `npx tsc --noEmit` | N/A | 0 errors | **PASS** |
| **ESLint Validation** | `npm run lint` | N/A | 0 warnings / 0 errors | **PASS** |
| **Two-Day Provider Tests** | `node --test --experimental-strip-types tests/pet-engine/twoDayContributionProvider.test.ts` | 37 | 0 | **PASS** (11 suites) |
| **Pet Engine Unit Suite** | `npm run test:pet-engine` | 342 | 0 | **PASS** (32 suites) |
| **Application Unit Suite** | `npm test` | 121 | 0 | **PASS** (24 suites) |
| **Production Build** | `npm run build` | 14 routes | 0 errors | **PASS** (14/14 static pages generated) |
| **Total Automated Tests** | All Suites Combined | **500** | **0** | **100% PASS** |

---

## 8. Invariant & Read-Only Safety Verification

The hosted run strictly adhered to all read-only safety guarantees:
1. **Zero State Mutation:** `pet/state/pet-state.json` was not modified.
2. **Zero Ledger Mutation:** `pet/ledger/contributions.json` and `pet/ledger/actions.json` were not modified.
3. **Zero SVG Generation:** No visual assets or SVGs were generated or uploaded.
4. **Zero README Embed Updates:** `README.md` was not modified.
5. **Zero Accounting Engine Invocation:** `ContributionAccountingEngine` was not instantiated or invoked during the probe.
6. **No Token Elevation:** Executed with standard `GITHUB_TOKEN` under least privilege.

---

## 9. Conclusion & Read-Only Stop Condition

Phase 3C2.2.3.2 is complete with a **PASS** verdict. The two-day contribution snapshot provider is verified operational on hosted GitHub Actions infrastructure against GitHub's production GraphQL API.

**Stop condition reached:** Contribution accounting integration, baseline initialization, and scheduled workflow activation remain strictly unstarted pending explicit owner review and authorization.
