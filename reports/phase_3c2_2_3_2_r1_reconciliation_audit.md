# Phase 3C2.2.3.2-R1 — Hosted Verification Reconciliation Audit Report

**Project:** GitHub Profile Pet  
**Workspace:** [`D:\Projects\GitHub-Profile-Pet`](file:///D:/Projects/GitHub-Profile-Pet)  
**Repository:** `mnp210/GitHub-Profile-Pet` (Public)  
**Target Branch:** `main`  
**Audit Timestamp:** 2026-11-17T12:05:00Z UTC  
**Milestone:** Phase 3C2.2.3.2-R1 (Hosted Verification Reconciliation Audit)  
**Audit Scope:** Read-Only Audit of (1) Rate-limit discrepancy (5,000 vs. 1,000), (2) Commit publication scope (f324141), and (3) Automated test count reconciliation (463 unique vs. 500 double-counted).  
**Final Audit Verdict:** **RECONCILED WITH SAFEGUARDS** (Pristine zero-mutation boundaries verified; 1,000 points/hr conservative assumption mandated; publication manifest categorized; unique test count corrected to 463).

---

## 1. Evidence Inspected

During this read-only audit, the following primary sources of evidence were inspected directly without any write operations, API calls, or workflow dispatches:

1. **Workflow & Script Definitions:**
   - [`.github/workflows/diagnostics-contribution-probe.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/diagnostics-contribution-probe.yml)
   - [`scripts/probe-github-contributions.ts`](file:///D:/Projects/GitHub-Profile-Pet/scripts/probe-github-contributions.ts)
   - [`src/features/pet-engine/contribution/contributionProvider.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts)
   - [`src/features/pet-engine/contribution/nativeGraphQLClient.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/nativeGraphQLClient.ts)
2. **Hosted Execution Telemetry & Logs:**
   - Hosted GitHub Actions Workflow Run: `44051016461` ([https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/44051016461](https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/44051016461))
   - Hosted Job: `133928550033` ([https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/44051016461/job/133928550033](https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/44051016461/job/133928550033))
   - Job setup logs and step environment logs.
   - GraphQL response telemetry (`rateLimit` object) and HTTP transport headers (`x-ratelimit-*`).
3. **Official GitHub Documentation:**
   - GitHub Actions Documentation: *Automatic token authentication & Rate limits* (`automatic-token-authentication#rate-limits`).
   - GitHub GraphQL API Documentation: *Resource limitations & Rate limits* (`resource-limitations#rate-limit`).
   - GitHub Apps Documentation: *Rate limits for GitHub Apps* (`rate-limits-for-github-apps`).
4. **Git Repository Commit & History:**
   - Commit [`f3241415943d1f65667ccc1bb5ae32b8977b4e19`](file:///D:/Projects/GitHub-Profile-Pet) and its diff relative to parent `9658548d2173dfc19a26f6434c6ed341632c9b2a`.
   - Git log history of `pet/ledger/contributions.json`, `pet/ledger/actions.json`, and `pet/state/pet.json`.
5. **Project Manifest & Test Directories:**
   - [`package.json`](file:///D:/Projects/GitHub-Profile-Pet/package.json) test script definitions (`test`, `test:pet-engine`, `test:all`).
   - All 16 test files under [`tests/pet-engine/`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/).
   - All 24 test files under [`tests/unit/`](file:///D:/Projects/GitHub-Profile-Pet/tests/unit/).

---

## 2. Rate-Limit Discrepancy Investigation

### 2.1 The Discrepancy
In hosted run `44051016461` (job `133928550033`), the diagnostic probe recorded:
- **GraphQL Body:** `rateLimit.limit = 5000`, `rateLimit.cost = 1`, `rateLimit.remaining = 4999`.
- **HTTP Transport Headers:** `x-ratelimit-limit: 5000`, `x-ratelimit-remaining: 4999`, `x-ratelimit-resource: graphql`.

However, GitHub's documentation for GitHub Actions automatic token authentication states:
> *"The rate limit for `GITHUB_TOKEN` is 1,000 requests [or points] per hour per repository."*

### 2.2 Forensic Analysis
We evaluated the six required verification questions:

1. **Did the workflow use the automatically provisioned Actions `GITHUB_TOKEN`?**  
   **YES.** Step 1 (`Set up job`) explicitly records:
   ```text
   2026-11-17T08:56:29.1624633Z ##[group]GITHUB_TOKEN Permissions
   2026-11-17T08:56:29.1627343Z Contents: read
   2026-11-17T08:56:29.1627948Z Metadata: read
   2026-11-17T08:56:29.1628579Z ##[endgroup]
   2026-11-17T08:56:29.1631571Z Secret source: Actions
   ```
   `Secret source: Actions` confirms the token was created dynamically by GitHub Actions infrastructure, not injected from repository secrets or external inputs.

2. **Could repository or environment configuration substitute another credential?**  
   **NO.** In [`.github/workflows/diagnostics-contribution-probe.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/diagnostics-contribution-probe.yml), the step environment defines strictly:
   ```yaml
   env:
     GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     PET_OWNER_LOGIN: ${{ inputs.owner_login || vars.PET_OWNER_LOGIN || '' }}
     GITHUB_REPOSITORY_OWNER: ${{ github.repository_owner }}
   ```
   No alternative token (such as a PAT secret `GH_PAT`, `PERSONAL_TOKEN`, or app private key) is referenced in the workflow or repository variables.

3. **Did the GraphQL request actually use the environment variable supplied by `secrets.GITHUB_TOKEN`?**  
   **YES.** Tracing [`scripts/probe-github-contributions.ts`](file:///D:/Projects/GitHub-Profile-Pet/scripts/probe-github-contributions.ts#L58):
   ```typescript
   const token = process.env.GITHUB_TOKEN?.trim();
   ...
   const snapshot2Day = await provider.fetchUserContributionSnapshot2Day(targetOwner, token);
   ```
   Which passes `token` directly to [`NativeGraphQLClient.request`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/nativeGraphQLClient.ts#L43):
   ```typescript
   headers['authorization'] = `Bearer ${token}`;
   ```
   The runner executed `node --experimental-strip-types scripts/probe-github-contributions.ts` with no local `.env` file present. The token used for the GraphQL request was strictly the runner's `GITHUB_TOKEN`.

4. **Is the 5,000 limit consistently recorded in both GraphQL response and HTTP headers?**  
   **YES.** Both transport layers agreed with 100% mathematical consistency:
   - GraphQL Response Payload: `{ limit: 5000, cost: 1, remaining: 4999, used: 1, resetAt: "2026-11-17T09:56:31Z" }`
   - HTTP Transport Headers: `x-ratelimit-limit: 5000`, `x-ratelimit-remaining: 4999`, `x-ratelimit-used: 1`, `x-ratelimit-reset: 1794909391`, `x-ratelimit-resource: graphql`
   - Reset epoch `1794909391` corresponds exactly to `2026-11-17T09:56:31.000Z`.

5. **Is there a documented explanation for the difference between the observed 5,000 and documented Actions 1,000 limit?**  
   **PARTIALLY DOCUMENTED / DOCUMENTATION CONFLICT.**  
   Under the hood, GitHub Actions provisions `GITHUB_TOKEN` as an **installation access token** belonging to the internal GitHub Actions App installation.  
   According to GitHub's official GraphQL documentation (*Resource limitations & Rate limits*):
   > *"For GitHub App installations: 5,000 points per hour per installation for installations not on a GitHub Enterprise Cloud organization."*  
   
   However, GitHub's Actions documentation (*Automatic token authentication*) explicitly states:
   > *"The rate limit for `GITHUB_TOKEN` is 1,000 requests per hour per repository."*  
   
   In live execution, GitHub's GraphQL gateway (`resource: graphql`) applies the general GitHub App installation limit (5,000 points/hr) rather than clamping the token to the 1,000 requests/hr limit documented for REST or general Actions usage.

6. **Can the result be explained conclusively or does it remain unresolved?**  
   **REMAINS FORMALLY UNRESOLVED AT PLATFORM LEVEL.**  
   While the architectural mechanism (GitHub App installation token inheriting the 5,000-point GraphQL pool) explains the observed telemetry, GitHub's platform documentation contains a direct conflict. Because GitHub could enforce the documented 1,000 limit at any time without notice, the 5,000 limit **cannot be relied upon as a guaranteed SLA**.

### 2.3 Mandated Action
In accordance with user instructions:  
> [!IMPORTANT]
> **Conservative Planning Rule:** All contribution synchronization runtime designs, schedules, throttling algorithms, and recovery procedures must adopt **1,000 points per hour** as the authoritative platform rate-limit ceiling. The observed 5,000 points must be treated solely as diagnostic headroom and never used for production capacity planning.

---

## 3. Publication Scope Audit

### 3.1 Commit Under Review
- **Commit SHA:** `f3241415943d1f65667ccc1bb5ae32b8977b4e19`
- **Parent SHA:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`
- **Commit Message:** `feat: implement two-day contribution provider with primary identity resolution and diagnostic probe`
- **Total Changed Files:** 25 files (10 modified, 15 added)

### 3.2 Full Changed-File Inventory & Classification

Every single file in commit `f3241415943d1f65667ccc1bb5ae32b8977b4e19` has been inspected and classified into one of four distinct categories:

| File Path | Type | Category | Scope & Purpose Summary |
| :--- | :---: | :---: | :--- |
| `scripts/probe-github-contributions.ts` | Modified | **Specifically Authorized** | Updated diagnostic probe script to execute the 2-day snapshot query. |
| `tests/pet-engine/twoDayContributionProvider.test.ts` | Added | **Specifically Authorized** | Focused unit test suite (37 tests) verifying the two-day provider. |
| `src/features/pet-engine/contribution/contributionProvider.ts` | Modified | **Specifically Authorized** | Two-day provider implementation with `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY`. |
| `src/features/pet-engine/contribution/nativeGraphQLClient.ts` | Modified | **Specifically Authorized** | Native zero-dependency GraphQL client used by provider. |
| `src/features/pet-engine/contribution/types.ts` | Modified | **Specifically Authorized** | Data types for 2-day snapshots and rate-limit structures. |
| `src/features/pet-engine/accounting/contributionEngine.ts` | Modified | **Previously Approved Implementation** | Deterministic accounting engine implemented in Phase 3C2.2.1 / R2. |
| `src/features/pet-engine/domain/types.ts` | Modified | **Previously Approved Implementation** | Ledger and contribution slice domain types from Phase 3C2.2.1. |
| `src/features/pet-engine/domain/constants.ts` | Modified | **Previously Approved Implementation** | Contribution constants (XP caps, hourly throttle) from Phase 3C2.2.1. |
| `src/features/pet-engine/validation/ledgerValidator.ts` | Modified | **Previously Approved Implementation** | Pristine ledger predicate & schema validation from Phase 3C2.2.1 / 3C2.2.2-R4. |
| `pet/schemas/contributions.schema.json` | Modified | **Previously Approved Implementation** | Contributions ledger JSON schema from Phase 3C2.2.1. |
| `tests/pet-engine/contributionAccounting.test.ts` | Modified | **Previously Approved Implementation** | Accounting engine test suite (26 tests) from Phase 3C2.2.1. |
| `tests/pet-engine/capThrottleAudit.test.ts` | Added | **Previously Approved Implementation** | Cap throttle consistency tests from Phase 3C2.2.1-R1. |
| `tests/pet-engine/immediateCapForfeiture.test.ts` | Added | **Previously Approved Implementation** | Cap forfeiture tests from Phase 3C2.2.1-R2. |
| `reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md` | Added | **Report / Documentation** | Audit report from Phase 3C2.1. |
| `reports/phase_3c2_1_v5_2_1_4_final_verification_report.md` | Added | **Report / Documentation** | Final verification report from Phase 3C2.1. |
| `reports/phase_3c2_2_1_accounting_engine_report.md` | Added | **Report / Documentation** | Implementation report from Phase 3C2.2.1. |
| `reports/phase_3c2_2_1_r1_cap_throttle_compaction_audit.md` | Added | **Report / Documentation** | Audit report from Phase 3C2.2.1-R1. |
| `reports/phase_3c2_2_1_r2_immediate_cap_forfeiture_report.md` | Added | **Report / Documentation** | Forfeiture policy report from Phase 3C2.2.1-R2. |
| `reports/phase_3c2_2_2_contribution_sync_runtime_architecture.md` | Added | **Report / Documentation** | Accepted runtime architecture specification from Phase 3C2.2.2. |
| `reports/phase_3c2_2_2_r2_final_architecture_review.md` | Added | **Report / Documentation** | Final architecture review from Phase 3C2.2.2-R2. |
| `reports/phase_3c2_2_2_r3_final_consistency_report.md` | Added | **Report / Documentation** | Consistency report from Phase 3C2.2.2-R3. |
| `reports/phase_3c2_2_2_r4_final_signoff_report.md` | Added | **Report / Documentation** | Sign-off report from Phase 3C2.2.2-R4. |
| `reports/phase_3c2_2_3_1_two_day_provider_report.md` | Added | **Report / Documentation** | Two-day provider report from Phase 3C2.2.3.1. |
| `reports/phase_3c2_2_3_1_r1_identity_audit.md` | Added | **Report / Documentation** | Identity audit report from Phase 3C2.2.3.1-R1. |
| `reports/phase_3c2_2_3_1_r2_identity_correction_report.md` | Added | **Report / Documentation** | Identity correction report from Phase 3C2.2.3.1-R2. |

### 3.3 Audit Findings on Publication Scope
1. **No Unauthorized or Foreign Code:** Zero files in commit `f324141` contain unauthorized, foreign, unreviewed, or experimental code. Every single source file and test corresponds to an authorized milestone previously completed and approved in local testing.
2. **Over-Bundling in Publication Commit:** Phase 3C2.2.3.2 authorized publishing "only the explicitly approved diagnostic workflow and any necessary diagnostic script/test/report files." In staging the commit, the author bundled the 8 previously approved implementation files (accounting engine, schema, validator, and tests) and 12 historical milestone reports alongside the 5 diagnostic provider files.
3. **Operational Impact Assessment:** While these files were published to `origin/main`, **none of the accounting files were activated or executed in production**. They remain passive source code without any workflow triggers or production calls.

---

## 4. Confirmation of Zero Accounting Execution & Zero Mutation

We performed forensic checks on the actual repository state to verify whether any accounting execution or state mutation occurred during or after publication:

1. **Accounting Engine Invocation:**  
   [`ContributionAccountingEngine`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/accounting/contributionEngine.ts) was **never imported, instantiated, or invoked** by [`scripts/probe-github-contributions.ts`](file:///D:/Projects/GitHub-Profile-Pet/scripts/probe-github-contributions.ts) or by [`.github/workflows/diagnostics-contribution-probe.yml`](file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/diagnostics-contribution-probe.yml).
2. **Contribution Ledger Status (`pet/ledger/contributions.json`):**  
   Git log inspection proves this file has had **zero commits** since repository creation (`ab2f88e`). Current disk contents:
   ```json
   {
     "schemaVersion": 1,
     "generation": 1,
     "monotonicPublicHwm": 0,
     "dailyAccruedXp": {},
     "hourlySliceUsage": {},
     "slices": [],
     "monthlyHistoricalSummary": []
   }
   ```
   The ledger is 100% pristine: generation 1, HWM 0, empty slices, empty accrued XP, empty usage.
3. **Actions Ledger Status (`pet/ledger/actions.json`):**  
   Git log inspection proves this file has had **zero commits** since repository creation (`ab2f88e`).
4. **Pet State Status (`pet/state/pet.json`):**  
   Git log inspection proves this file has had **zero commits** since repository creation (`ab2f88e`). Level is 1, XP is 0, generation is 1, last interaction time is `2026-11-15T00:00:00.000Z`.
5. **No Scheduled Workflow Activation:**  
   No scheduled cron workflows exist in `.github/workflows/` that execute contribution accounting.
6. **No SVG or README Updates:**  
   `README.md` and public SVG embeds remain completely untouched.

**Verdict:** Zero accounting execution, zero baseline initialization, zero HWM updates, zero ordinal updates, and zero state/ledger/asset mutations occurred.

---

## 5. Test-Count Reconciliation

### 5.1 The Discrepancy
In the Phase 3C2.2.3.2 report, the automated test summary claimed:
- Focused Provider Tests: `37`
- Pet Engine Suite: `342`
- Application Unit Suite: `121`
- **Reported Total:** `37 + 342 + 121 = 500`

### 5.2 Forensic Test Mapping
Inspection of [`package.json`](file:///D:/Projects/GitHub-Profile-Pet/package.json#L10-L12) reveals:
- `"test": "node --test --experimental-strip-types tests/unit/*.test.ts"`
- `"test:pet-engine": "node --test --experimental-strip-types tests/pet-engine/*.test.ts"`

The file [`tests/pet-engine/twoDayContributionProvider.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/twoDayContributionProvider.test.ts) resides inside `tests/pet-engine/`.  
When `npm run test:pet-engine` executes, Node glob-matches `tests/pet-engine/*.test.ts`, which automatically executes `twoDayContributionProvider.test.ts`.

The 342 tests reported by `npm run test:pet-engine` **already included** the 37 tests of `twoDayContributionProvider.test.ts`.  
Adding 37 + 342 + 121 mathematically double-counted the 37 focused provider tests.

### 5.3 Corrected Unique Test Reconciliation Matrix

| Test Suite Scope | Test Runner Command | File Count | Suite Count | Unique Test Count | Notes |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Pet Engine Suite** | `npm run test:pet-engine` | 16 | 32 | **342** | Covers all pet-engine components (including 37 tests of `twoDayContributionProvider.test.ts`). |
| **Application Unit Suite** | `npm test` | 24 | 24 | **121** | Covers UI, session, security, calendar, and API unit tests. |
| **Focused Provider Suite** | `node --test tests/pet-engine/twoDayContributionProvider.test.ts` | 1 | 11 | *(37)* | *Subset of `test:pet-engine`; do NOT add to total.* |
| **Authoritative Unique Total** | Combined Unique Test Count | **40** | **56** | **463** | **Exact unique count of automated tests (100% passing).** |

---

## 6. Outstanding Issues & Recommended Next Actions

### 6.1 Outstanding Issues
1. **GitHub Documentation Inconsistency on Rate Limits:**  
   GitHub's Actions documentation specifies 1,000 points/hr for `GITHUB_TOKEN`, while GitHub's GraphQL documentation specifies 5,000 points/hr for GitHub App installations. Live hosted runners observe 5,000 points/hr.
   - *Risk:* Future GitHub platform changes could restrict GraphQL tokens to 1,000 points/hr without notice.
   - *Mitigation:* Formally mandate 1,000 points/hr as the hard ceiling in runtime design.

2. **Published Commit History:**  
   Commit `f3241415943d1f65667ccc1bb5ae32b8977b4e19` contains approved Phase 3C2.2.1 accounting engine files alongside the Phase 3C2.2.3.2 diagnostic provider files.
   - *Risk:* Potential confusion regarding whether accounting integration was authorized.
   - *Mitigation:* This audit confirms zero accounting execution took place, ledgers remain pristine, and no rollback/rebase is required because all code in the commit is reviewed, passing, and passive.

### 6.2 Recommended Next Actions
1. **Accept the Reconciled Findings:** Approve this audit report establishing the unique test count of **463** and the conservative rate-limit planning assumption of **1,000 points/hr**.
2. **Retain Commit `f324141` Without Modification:** Do not rewrite, amend, or revert commit history. The passive presence of approved accounting source files does not violate state or ledger invariants.
3. **Await Owner Authorization:** Do not implement Phase 3C2.2.3.3 (Runtime Accounting Integration) or dispatch any workflows until explicitly authorized by the project owner.

---

## 7. Confirmation of Strict Stop Conditions

During the execution of this audit:
- [x] Zero source code changes made.
- [x] Zero workflow changes made.
- [x] Zero live GitHub API requests made.
- [x] Zero workflow dispatches triggered.
- [x] Zero mutations to `pet/state/`, `pet/ledger/`, SVGs, or `README.md`.
- [x] Zero Git operations (no commits, pushes, rebases, resets, or amends).
- [x] Zero Phase 3C2.2.3.3 implementation work started.

**Read-only audit completed. Awaiting owner review.**
