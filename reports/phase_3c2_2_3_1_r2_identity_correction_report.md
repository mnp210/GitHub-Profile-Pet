# Phase 3C2.2.3.1-R2 — Primary Query Identity Correction Report

**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Baseline Commit:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`  
**Milestone:** Phase 3C2.2.3.1-R2 (Implementation & Verification)  
**Status:** Complete & Fully Verified

---

## 1. Executive Summary

Phase 3C2.2.3.1-R2 implements the approved primary-query organization-identity correction identified by the R1 audit.

By selecting `repositoryOwner(login: $login) { __typename id login }` directly within `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY`, the provider now deterministically discriminates personal user accounts from organization accounts in a **single GraphQL round-trip**. It eliminates fabricated test fixture fields, harmonizes the raw response types with the actual GraphQL selection, removes redundant secondary organization queries, and enforces strict identity fail-closed rules.

---

## 2. Corrected Primary Query (`USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY`)

From [contributionProvider.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts#L61-L111):

```graphql
query UserContributionSnapshot2Day(
  $login: String!
  $yesterdayFrom: DateTime!
  $yesterdayTo: DateTime!
  $todayFrom: DateTime!
  $todayTo: DateTime!
) {
  repositoryOwner(login: $login) {
    __typename
    id
    login
  }
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

---

## 3. Strict Parser Validation Rules (`parseAndValidate2DayContributionResponse`)

The parser in [contributionProvider.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts#L614-L670) enforces the following deterministic fail-closed sequence:

1. **Existence Check:**
   - If `raw.repositoryOwner === null && raw.user === null`, throws `UserNotFoundError` (account does not exist on GitHub).
   - If `raw.repositoryOwner` is missing, null (with non-null user), or malformed, throws `InvalidContributionDataError`.
2. **Typename Discrimination:**
   - `repositoryOwner.__typename` must be a non-empty string and strictly `"User"` or `"Organization"`. Any unknown type throws `InvalidContributionDataError`.
   - If `repositoryOwner.__typename === 'Organization'`, immediately throws `OrganizationAccountError` (fails closed; organizations cannot accumulate pet contributions).
3. **Repository Owner Handle Verification:**
   - `repositoryOwner.login` must match the queried `targetLogin` case-insensitively. Mismatch throws `IdentityMismatchError`.
4. **Personal User Contribution Object:**
   - When `repositoryOwner.__typename === 'User'`, `raw.user` must be non-null. If null, throws `InvalidContributionDataError` (cannot accept personal owner without user details).
5. **User Handle Agreement:**
   - `user.login` must match `targetLogin` case-insensitively (`IdentityMismatchError` on mismatch).
   - `user.login` must match `repositoryOwner.login` case-insensitively (`IdentityMismatchError` on internal disagreement).
6. **Numeric Database ID Verification:**
   - `user.databaseId` must be a positive integer (`InvalidContributionDataError` on missing, string, float, or negative).
   - If `expectedOwnerDatabaseId` is provided, `user.databaseId !== expectedOwnerDatabaseId` throws `IdentityMismatchError`.

---

## 4. Elimination of Secondary Fallback Requests

1. **No Duplicate Lookups:** `fetchUserContributionSnapshot2Day` no longer issues `CHECK_REPOSITORY_OWNER_TYPE_QUERY`.
2. **Partial Data Inspection:** If upstream GraphQL returns errors alongside `data` (e.g. `user: null` with `NOT_FOUND`), `NativeGitHubGraphQLClient` attaches `partialData` to `GitHubGraphQLError`.
3. **Direct Error Inspection:** In [contributionProvider.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts#L1003-L1033), `fetchUserContributionSnapshot2Day` inspects `err.partialData.repositoryOwner` directly. If `Organization`, it throws `OrganizationAccountError`. If non-existent (`repositoryOwner === null`), it throws `UserNotFoundError`.
4. **Single-Request Guarantee:** Verified by tests `TC-2DAY-REQ-01` and `TC-2DAY-REQ-02` that both successful personal snapshots and organization rejections execute **exactly 1 GraphQL request**.

---

## 5. Files Modified

| File | Change Type | Summary of Changes |
|---|---|---|
| `src/features/pet-engine/contribution/contributionProvider.ts` | Modified | Updated `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY` to select `repositoryOwner { __typename id login }`. Rewrote `parseAndValidate2DayContributionResponse` with strict identity verification. Removed secondary `CHECK_REPOSITORY_OWNER_TYPE_QUERY` call from `fetchUserContributionSnapshot2Day`. |
| `src/features/pet-engine/contribution/types.ts` | Modified | Updated `RawGraphQL2DayContributionResponse` to type `repositoryOwner` as a selected field (`{ __typename: string; id: string; login: string } \| null`). |
| `src/features/pet-engine/contribution/nativeGraphQLClient.ts` | Modified | Added `partialData?: unknown` property to `GitHubGraphQLError` and passed `payload.data` when constructing it during GraphQL error returns. |
| `tests/pet-engine/twoDayContributionProvider.test.ts` | Modified | Updated `createValidRaw2DayResponse` to reflect actual query selection. Added 9 new identity and network efficiency test cases (total 37 tests). Cleaned up unused imports. |
| `reports/phase_3c2_2_3_1_r2_identity_correction_report.md` | Created | Comprehensive verification, compliance, and test report. |

---

## 6. Test & Quality Verification Results

### 6.1 Focused Two-Day Provider Suite
- **File:** `tests/pet-engine/twoDayContributionProvider.test.ts`
- **Result:** **37 passed, 0 failed, 11 suites**
- **Test Scenarios Covered:**
  - `TC-2DAY-WIN-01` to `05`: UTC boundary calculations, month, leap year, and year transitions.
  - `TC-2DAY-QRY-01`: Query transmission selecting `repositoryOwner`, variables, and 2-day windows.
  - `TC-2DAY-AGG-01` & `02`: 4-category public sum, restricted count exclusion, zero-count handling.
  - `TC-2DAY-ID-01`: Valid personal user with matching expectedOwnerDatabaseId.
  - `TC-2DAY-ID-02`: Expected numeric owner ID mismatch (`IdentityMismatchError`).
  - `TC-2DAY-ID-03`: User login mismatch (`IdentityMismatchError`).
  - `TC-2DAY-ID-04`: Realistic organization response from primary query (`OrganizationAccountError`).
  - `TC-2DAY-ID-05`: Null repositoryOwner and null user (`UserNotFoundError`).
  - `TC-2DAY-ID-06`: Missing `__typename` on repositoryOwner (`InvalidContributionDataError`).
  - `TC-2DAY-ID-07`: Unknown `__typename` on repositoryOwner (`InvalidContributionDataError`).
  - `TC-2DAY-ID-08`: Repository owner login mismatch with target (`IdentityMismatchError`).
  - `TC-2DAY-ID-09`: Owner/user login disagreement (`IdentityMismatchError`).
  - `TC-2DAY-ID-10`: Personal owner with null user details (`InvalidContributionDataError`).
  - `TC-2DAY-ID-11`: Missing, string, or negative databaseId (`InvalidContributionDataError`).
  - `TC-2DAY-ID-12`: Organization with GraphQL error and partial data (`OrganizationAccountError`, 1 request).
  - `TC-2DAY-REQ-01`: Exactly one GraphQL request for successful snapshot.
  - `TC-2DAY-REQ-02`: Exactly one GraphQL request for organization detection (no secondary probe).
  - `TC-2DAY-INC-01` to `04`: Incomplete/null collections and missing categories.
  - `TC-2DAY-MAL-01` to `03`: Malformed, fractional, and negative counts.
  - `TC-2DAY-RL-01` to `03`: Actual cost measurement, strict consistency flag, lenient mode.
  - `TC-2DAY-NET-01` to `04`: Request timeout, 502 retry with backoff, HTTP 401, token sanitization.
  - `TC-2DAY-RO-01`: Strict read-only filesystem integrity across pet state and ledgers.

### 6.2 Existing Contribution Provider Suite
- **File:** `tests/pet-engine/contributionProvider.test.ts`
- **Result:** **46 passed, 0 failed, 1 suite**

### 6.3 Full Pet-Engine Suite
- **Command:** `npm run test:pet-engine`
- **Result:** **342 passed, 0 failed, 32 suites**

### 6.4 Standard Unit Suite
- **Command:** `npm test`
- **Result:** **121 passed, 0 failed, 24 suites**

### 6.5 Total Automated Tests
- **Total:** **463 tests passed, 0 failed** across all test suites.

### 6.6 Code Quality & Build Checks
- **ESLint (`npm run lint`):** **0 errors, 0 warnings** (clean exit).
- **TypeScript (`npx tsc --noEmit`):** **0 errors** (clean exit).
- **Production Build (`npm run build`):** **Compiled successfully in 5.4s**, all static/dynamic routes generated cleanly.

---

## 7. Strict Boundary Confirmation

| Boundary Requirement | Status | Evidence |
|---|---|---|
| HWM or ordinal changes | NONE | Verified: `pet/state/` remains untouched. |
| Contribution baseline initialization | NONE | Verified: No baseline records created. |
| Reward accounting or ledger mutations | NONE | Verified: Zero ledger modifications. |
| Pet state mutations | NONE | Verified: `TC-2DAY-RO-01` verified 0-byte difference. |
| Workflow modifications or dispatch | NONE | Verified: No files in `.github/workflows/` touched. |
| Live GitHub queries | NONE | Verified: All tests run against mock transports. |
| Secrets, PATs, or paid dependencies | NONE | Verified: Zero new dependencies installed. |
| Git commits, pushes, rebases, or branch changes | NONE | Verified: No git mutation commands run. |
| Starting Phase 3C2.2.3.2 | NONE | Strictly uninitiated; awaiting owner review. |
