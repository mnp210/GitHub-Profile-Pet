# Phase 3C2.2.3.1 — Two-Day Aliased Contribution Provider Implementation Report

**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Branch:** `main`  
**Baseline Commit:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`  
**Milestone:** Phase 3C2.2.3.1 (Implementation Only)  
**Status:** Complete & Fully Verified

---

## 1. Executive Summary

Phase 3C2.2.3.1 implements the deterministic two-day aliased GitHub contribution snapshot provider in accordance with the approved Phase 3C2.2.2 runtime architecture specification (`reports/phase_3c2_2_2_contribution_sync_runtime_architecture.md`).

This milestone is strictly bounded to the provider query, response parsing, immutable numeric identity validation, and rate-limit telemetry extraction. It performs zero mutation of pet state or contribution ledgers, executes no accounting or reward reconciliation, and initiates no workflow schedules or live dispatches.

---

## 2. Implementation Specifications

### 2.1 GraphQL Query Shape (`UserContributionSnapshot2Day`)

The query issues a single GraphQL request querying two aliased contribution collections over independent UTC date windows (`yesterday` and `today`):

```graphql
query UserContributionSnapshot2Day(
  $login: String!
  $yesterdayFrom: DateTime!
  $yesterdayTo: DateTime!
  $todayFrom: DateTime!
  $todayTo: DateTime!
) {
  user(login: $login) {
    id
    databaseId
    login
    yesterday: contributionsCollection(from: $yesterdayFrom, to: $yesterdayTo) {
      startedAt
      endedAt
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
      }
    }
    today: contributionsCollection(from: $todayFrom, to: $todayTo) {
      startedAt
      endedAt
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
      }
    }
  }
  rateLimit {
    limit
    cost
    remaining
    used
    resetAt
  }
}
```

### 2.2 Independent UTC Windows (`compute2DayUtcWindows`)

Deterministic date arithmetic via `Date.UTC(year, month, day)` generates millisecond-bounded ISO-8601 strings:
- **Yesterday:** `YYYY-MM-DDT00:00:00.000Z` to `YYYY-MM-DDT23:59:59.999Z`
- **Today:** `YYYY-MM-DDT00:00:00.000Z` to `YYYY-MM-DDT23:59:59.999Z`

Handles month boundaries, leap years (February 29), and year transitions without timezone offset drift.

### 2.3 Category Accounting & Restricted Contributions Exclusion

Only four GitHub activity categories are counted towards `publicCategoryTotal`:
1. `totalCommitContributions`
2. `totalIssueContributions`
3. `totalPullRequestContributions`
4. `totalPullRequestReviewContributions`

$$\text{publicCategoryTotal} = \text{commits} + \text{issues} + \text{pullRequests} + \text{pullRequestReviews}$$

`restrictedContributionsCount` and `contributionCalendar.totalContributions` are captured as telemetry/diagnostics but are **strictly excluded** from `publicCategoryTotal`.

### 2.4 Immutable Owner Identity Verification

The provider enforces:
- `user.databaseId`: Must be a positive integer. If `expectedOwnerDatabaseId` is passed, mismatch triggers `IdentityMismatchError`.
- `user.login`: Case-insensitive check against queried target; mismatch triggers `IdentityMismatchError`.
- `repositoryOwner.__typename === 'Organization'`: Triggers `OrganizationAccountError` (fails closed; organizations cannot accumulate pet contributions).
- `user === null`: Triggers `UserNotFoundError`.

### 2.5 Rate-Limit Telemetry & Actual Cost Measurement

- Captures `limit`, `cost`, `remaining`, `used`, `resetAt` from GraphQL body and `x-ratelimit-*` HTTP transport headers.
- **Actual Cost:** Read directly from `rateLimit.cost` (e.g. 1 point or 2 points); never assumed or hardcoded.
- Cross-verifies GraphQL body against HTTP headers using `checkRateLimitConsistency`.
- In strict mode (`requireStrictRateLimitConsistency: true`), telemetry discrepancies throw `InvalidContributionDataError`.

### 2.6 Token Redaction & Failure Resilience

- All errors, diagnostic logs, and rethrown exceptions sanitize Bearer tokens via `redactSensitiveData`.
- Transient network failures (5xx, ECONNRESET) and bounded timeouts leverage the underlying exponential backoff client with full jitter.

---

## 3. Files Modified and Added

| File | Change Type | Description |
|---|---|---|
| `src/features/pet-engine/contribution/types.ts` | Modified | Added `RawGraphQLContributionCollection`, `RawGraphQL2DayContributionResponse`, `TwoDayUtcWindows`, and `GitHub2DayContributionSnapshot`. |
| `src/features/pet-engine/contribution/contributionProvider.ts` | Modified | Added `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY`, `compute2DayUtcWindows`, `parseAliasedCategoryCounts`, `parseAndValidate2DayContributionResponse`, and `fetchUserContributionSnapshot2Day`. Added target login verification to reject spoofed/mismatched user logins. |
| `tests/pet-engine/twoDayContributionProvider.test.ts` | Added | 28 comprehensive unit tests verifying windows, query variables, category aggregations, restricted exclusions, identity mismatch, rate limit telemetry, retries, and read-only invariants. |
| `reports/phase_3c2_2_3_1_two_day_provider_report.md` | Added | Detailed milestone verification and compliance report. |

---

## 4. Test Verification Suite Results

### 4.1 Two-Day Provider Test Suite (`tests/pet-engine/twoDayContributionProvider.test.ts`)
```
▶ Phase 3C2.2.3.1: Two-Day Aliased GitHub Contribution Provider
  ▶ compute2DayUtcWindows
    ✔ TC-2DAY-WIN-01: Correctly derives yesterday and today UTC windows with millisecond boundaries (0.8764ms)
    ✔ TC-2DAY-WIN-02: Month boundary transition (March 1 to February 28 on non-leap year) (0.266ms)
    ✔ TC-2DAY-WIN-03: Leap year month boundary transition (March 1 to February 29 on leap year) (0.2994ms)
    ✔ TC-2DAY-WIN-04: Year boundary transition (January 1 to December 31 of prior year) (0.2896ms)
    ✔ TC-2DAY-WIN-05: Accepts numeric timestamp or default current time (0.8447ms)
  ✔ compute2DayUtcWindows (3.42ms)
  ▶ Query Execution & Variable Transmission
    ✔ TC-2DAY-QRY-01: Dispatches exact aliased query with four window variables and login (26.1066ms)
  ✔ Query Execution & Variable Transmission (26.2141ms)
  ▶ Category Aggregation & Restricted Exclusion
    ✔ TC-2DAY-AGG-01: Correctly sums the four public categories and excludes restricted contributions (0.5919ms)
    ✔ TC-2DAY-AGG-02: Handles zero contributions across all categories without error (0.4833ms)
  ✔ Category Aggregation & Restricted Exclusion (1.2415ms)
  ▶ Immutable Owner Identity Verification
    ✔ TC-2DAY-ID-01: Accepts matching expectedOwnerDatabaseId (0.4762ms)
    ✔ TC-2DAY-ID-02: Rejects mismatched expectedOwnerDatabaseId with IdentityMismatchError (0.9515ms)
    ✔ TC-2DAY-ID-03: Rejects mismatched login with IdentityMismatchError (0.4566ms)
    ✔ TC-2DAY-ID-04: Rejects organization account with OrganizationAccountError (0.4206ms)
    ✔ TC-2DAY-ID-05: Rejects null user and non-org repositoryOwner with UserNotFoundError (0.451ms)
  ✔ Immutable Owner Identity Verification (2.9253ms)
  ▶ Incomplete Responses & Null Collections
    ✔ TC-2DAY-INC-01: Rejects null yesterday collection with InvalidContributionDataError (0.5073ms)
    ✔ TC-2DAY-INC-02: Rejects null today collection with InvalidContributionDataError (0.5991ms)
    ✔ TC-2DAY-INC-03: Rejects missing category breakdown field in yesterday (0.393ms)
    ✔ TC-2DAY-INC-04: Rejects missing category breakdown field in today (0.3267ms)
  ✔ Incomplete Responses & Null Collections (1.9518ms)
  ▶ Malformed Values & Invalid Counts
    ✔ TC-2DAY-MAL-01: Rejects negative contribution count with InvalidContributionDataError (0.4082ms)
    ✔ TC-2DAY-MAL-02: Rejects non-integer fractional count with InvalidContributionDataError (0.4021ms)
    ✔ TC-2DAY-MAL-03: Rejects string/non-numeric contribution count with InvalidContributionDataError (0.3196ms)
  ✔ Malformed Values & Invalid Counts (1.2477ms)
  ▶ Rate Limit Telemetry & Actual Cost Measurement
    ✔ TC-2DAY-RL-01: Measures actual query cost from GraphQL rateLimit payload (cost: 2) (0.3443ms)
    ✔ TC-2DAY-RL-02: Strict rate limit consistency enforcement rejects mismatched telemetry when requireStrictRateLimitConsistency is true (0.4106ms)
    ✔ TC-2DAY-RL-03: Lenient mode records telemetry discrepancies without throwing when requireStrictRateLimitConsistency is false (0.3206ms)
  ✔ Rate Limit Telemetry & Actual Cost Measurement (1.1791ms)
  ▶ Timeout, Retry & Error Handling
    ✔ TC-2DAY-NET-01: Bounded request timeout throws GitHubTimeoutError (0.4129ms)
    ✔ TC-2DAY-NET-02: Retries on 502 Bad Gateway and succeeds if subsequent attempt succeeds (201.5777ms)
    ✔ TC-2DAY-NET-03: HTTP 401 throws GitHubUnauthorizedError with token sanitized (1.1365ms)
    ✔ TC-2DAY-NET-04: GraphQL error payload sanitizes token (0.5094ms)
  ✔ Timeout, Retry & Error Handling (204.0329ms)
  ▶ Read-Only Verification
    ✔ TC-2DAY-RO-01: Verifies that snapshot fetching produces zero filesystem mutations across pet state and ledgers (0.7324ms)
  ✔ Read-Only Verification (0.7962ms)
✔ Phase 3C2.2.3.1: Two-Day Aliased GitHub Contribution Provider (243.7429ms)
ℹ tests 28
ℹ suites 10
ℹ pass 28
ℹ fail 0
```

### 4.2 Comprehensive Pet-Engine Test Suite
- Command: `npm run test:pet-engine`
- Result: **333 passed, 0 failed, 31 suites** (100% pass)

### 4.3 Standard Unit Test Suite
- Command: `npm test`
- Result: **121 passed, 0 failed, 24 suites** (100% pass)

### 4.4 Repository Total Test Suite
- Total automated unit/domain tests: **454 passed, 0 failed**

---

## 5. Verification Against Mandatory Invariants

1. **Exact 2-Day Aliased Query:** Implemented in `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY` with `$yesterdayFrom`, `$yesterdayTo`, `$todayFrom`, `$todayTo`.
2. **Four Eligible Categories:** Only commits, opened issues, opened PRs, and reviews are summed.
3. **Restricted Contributions:** Excluded from `publicCategoryTotal`.
4. **Immutable Identity Check:** Validates `databaseId` matches `expectedOwnerDatabaseId` and `login` matches target.
5. **Fail-Closed Validation:** Missing collections, non-integer numbers, negative counts, null user, or organizations throw typed domain errors.
6. **Strict UTC Window Boundaries:** Millisecond boundaries (`00:00:00.000Z` to `23:59:59.999Z`) generated and validated.
7. **Accurate Telemetry:** Query cost measured from response (`cost: 2` or `cost: 1`), not assumed.
8. **Token Sanitization:** Tokens are redacted in every error message and rethrown error.
9. **Read-Only Invariant:** Verified via `TC-2DAY-RO-01` that zero pet state or ledger files are modified.
10. **Scope Boundary:** No Git commits, no pushes, no state transitions, no Phase 3C2.2.3.2 initiation.
