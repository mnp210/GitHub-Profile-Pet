# Phase 3C2.2.3.1-R1 — Organization Identity Verification Audit Report

**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Baseline Commit:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`  
**Status:** Audit Complete — Findings Documented (Read-Only)

---

## 1. Executive Summary

This read-only audit inspects the organization identity verification mechanism in the newly implemented two-day contribution provider (`src/features/pet-engine/contribution/contributionProvider.ts`, `types.ts`, and `tests/pet-engine/twoDayContributionProvider.test.ts`).

### Overall Audit Verdict: **FAIL (ARCHITECTURAL DISCREPANCY DETECTED)**
1. **Immutable Numeric ID & Login Verification:** **PASS**. The provider strictly asserts that `user.databaseId` matches `expectedOwnerDatabaseId` and that `user.login` matches the target handle (case-insensitive).
2. **Organization Discrimination in Primary Parser:** **FAIL**. The query `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY` **does not select** `repositoryOwner`. However, `parseAndValidate2DayContributionResponse` attempts to read `raw.repositoryOwner?.__typename === 'Organization'`.
3. **Test Fixture Fabrication:** **FAIL**. The unit test `TC-2DAY-ID-04` passed **only because the test fixture injected a fabricated `repositoryOwner` field** into the simulated GraphQL response that the actual GraphQL query never requested.
4. **Secondary Fallback vs Primary Response:** In real GitHub GraphQL operations, querying an organization handle against `user(login: $login)` returns `user: null` with a `NOT_FOUND` GraphQL error. The provider catches this error in `fetchUserContributionSnapshot2Day` and dispatches a secondary query (`CHECK_REPOSITORY_OWNER_TYPE_QUERY`). However, the primary query and response parser cannot independently discriminate an organization account from primary response data.

---

## 2. Exact Current Query (`USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY`)

From [contributionProvider.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts#L61-L106):

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

---

## 3. Identity Field & Validation Path Analysis

### 3.1 GitHub GraphQL Domain Identity Model
In GitHub's GraphQL schema:
- `user(login: $login)`: Resolves exclusively for individual personal user accounts (`User` type). When queried with an organization handle, it returns `null` and a GraphQL execution error: `Could not resolve to a User with the login of '<login>'.`
- `repositoryOwner(login: $login)`: An interface implemented by both `User` and `Organization`. Its `__typename` meta-field evaluates to either `"User"` or `"Organization"`.

### 3.2 Parsing & Validation Path in `parseAndValidate2DayContributionResponse`
From [contributionProvider.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts#L619-L627):

```typescript
  // 1. Account type discrimination
  if (!raw.user) {
    if (raw.repositoryOwner?.__typename === 'Organization') {
      throw new OrganizationAccountError(
        `Configured account "${targetLogin}" is an Organization. Profile Pet requires an individual personal user account.`
      );
    }
    throw new UserNotFoundError(`GitHub user "${targetLogin}" was not found.`);
  }
```

### 3.3 The Architectural Discrepancy
- The parser expects `raw.repositoryOwner?.__typename`.
- The TypeScript interface `RawGraphQL2DayContributionResponse` in [types.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/types.ts#L99-L103) declares:
  ```typescript
  repositoryOwner?: {
    __typename: 'User' | 'Organization';
    id: string;
    login: string;
  } | null;
  ```
- **HOWEVER:** `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY` **does not select** `repositoryOwner`.
- Consequently, in any real GitHub GraphQL response to `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY`, `raw.repositoryOwner` is **always `undefined`**.
- If a response where `user === null` enters `parseAndValidate2DayContributionResponse`, `raw.repositoryOwner` is undefined, causing the parser to jump directly to:
  ```typescript
  throw new UserNotFoundError(`GitHub user "${targetLogin}" was not found.`);
  ```
  It **never** throws `OrganizationAccountError` from primary response data.

---

## 4. Test Fixture & Verification Evidence

### 4.1 Test Fixture Fabrication in `tests/pet-engine/twoDayContributionProvider.test.ts`
From [twoDayContributionProvider.test.ts](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/twoDayContributionProvider.test.ts#L79-L86):

```typescript
  return {
    user,
    repositoryOwner: {
      __typename: 'User',
      id: 'MDQ6VXNlcjU4MzIzMQ==',
      login: 'mnp210',
      ...overrides.repositoryOwner,
    },
    rateLimit: { ... },
  };
```

Notice that `createValidRaw2DayResponse` injects a synthetic `repositoryOwner` object that the query itself never requested.

### 4.2 Test `TC-2DAY-ID-04`
From [twoDayContributionProvider.test.ts](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/twoDayContributionProvider.test.ts#L392-L422):

```typescript
    it('TC-2DAY-ID-04: Rejects organization account with OrganizationAccountError', async () => {
      const raw = createValidRaw2DayResponse({
        user: null,
        repositoryOwner: {
          __typename: 'Organization',
          id: 'MDEyOk9yZ2FuaXphdGlvbjE=',
          login: 'org-account',
        },
      });

      setFetchImplementation(async () => {
        return new Response(JSON.stringify({ data: raw }), {
          status: 200,
          headers: makeRateLimitHeaders(),
        });
      });

      const provider = new GitHubContributionProvider();
      await assert.rejects(
        async () => {
          await provider.fetchUserContributionSnapshot2Day('org-account', SAMPLE_TOKEN, {
            now: FIXED_NOW,
          });
        },
        (err: Error) => {
          assert.ok(err instanceof OrganizationAccountError);
          assert.ok(err.message.includes('Organization'));
          return true;
        }
      );
    });
```

### 4.3 Finding
`TC-2DAY-ID-04` passes because the test mock returns `data.repositoryOwner: { __typename: 'Organization' }` over HTTP. In production against GitHub's actual GraphQL API, GitHub returns only fields present in the query document; GitHub would never return `data.repositoryOwner` for `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY`.

---

## 5. Error-Fallback Secondary Probe Path

When an actual organization login is queried against GitHub, GitHub returns:
```json
{
  "data": { "user": null },
  "errors": [{ "type": "NOT_FOUND", "message": "Could not resolve to a User with the login of 'org-account'." }]
}
```
In `fetchUserContributionSnapshot2Day` ([contributionProvider.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts#L952-L984)), this triggers the catch block:
1. Detects `isUserNotFound` from GraphQL errors.
2. Dispatches a second network request: `CHECK_REPOSITORY_OWNER_TYPE_QUERY`:
   ```graphql
   query CheckRepositoryOwnerType($login: String!) {
     repositoryOwner(login: $login) {
       __typename
       id
       login
     }
   }
   ```
3. Inspects `ownerCheck.repositoryOwner?.__typename === 'Organization'`.
4. Throws `OrganizationAccountError`.

While this secondary fallback works in a live environment, it requires **two separate GraphQL round-trips** and two rate-limit points. It also creates a split-brain architecture where `parseAndValidate2DayContributionResponse` claims to handle organization rejection via `raw.repositoryOwner`, but cannot do so on real responses from its own query.

---

## 6. Immutable Owner Numeric ID & Target Login Verification

The provider retains strict, reliable checks for owner identity:
1. **Target Login Verification ([contributionProvider.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts#L636-L640)):**
   ```typescript
   if (user.login.toLowerCase() !== targetLogin.toLowerCase()) {
     throw new IdentityMismatchError(
       `Queried GitHub login "${user.login}" does not match target login "${targetLogin}".`
     );
   }
   ```
   Verified by test `TC-2DAY-ID-03`.
2. **Numeric Owner Database ID Verification ([contributionProvider.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts#L642-L655)):**
   ```typescript
   if (typeof user.databaseId !== 'number' || !Number.isInteger(user.databaseId) || user.databaseId <= 0) {
     throw new InvalidContributionDataError(
       `Invalid or missing numeric databaseId for user "${user.login}": expected positive integer.`
     );
   }

   if (options?.expectedOwnerDatabaseId !== undefined) {
     if (user.databaseId !== options.expectedOwnerDatabaseId) {
       throw new IdentityMismatchError(
         `Queried GitHub databaseId (${user.databaseId}) does not match expected ownerDatabaseId (${options.expectedOwnerDatabaseId}).`
       );
     }
   }
   ```
   Verified by tests `TC-2DAY-ID-01` and `TC-2DAY-ID-02`.

---

## 7. Smallest Required Correction (Design Only — Not Implemented)

To make organization discrimination deterministic, single-round-trip, and based entirely on actual GraphQL response data without relying on error catch handlers or fabricated mock fields:

### Add `repositoryOwner(login: $login)` directly into `USER_CONTRIBUTION_2DAY_SNAPSHOT_QUERY`:

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

### Benefits of this correction:
1. **Single Round-Trip:** Organization accounts are detected immediately in the primary response without dispatching `CHECK_REPOSITORY_OWNER_TYPE_QUERY`.
2. **Eliminates Test Fabrication:** The fixture in `tests/pet-engine/twoDayContributionProvider.test.ts` will match actual GraphQL response fields.
3. **Harmonizes Parser & Query:** `RawGraphQL2DayContributionResponse` and `parseAndValidate2DayContributionResponse` will operate directly on fields returned by the query document.

*(Note: In accordance with audit boundaries, this correction has NOT been implemented).*

---

## 8. Files Inspected & Confirmation of Non-Modification

### Files Inspected:
- `src/features/pet-engine/contribution/contributionProvider.ts`
- `src/features/pet-engine/contribution/types.ts`
- `src/features/pet-engine/contribution/nativeGraphQLClient.ts`
- `src/features/pet-engine/contribution/identityResolver.ts`
- `tests/pet-engine/twoDayContributionProvider.test.ts`
- `tests/pet-engine/contributionProvider.test.ts`

### Confirmation:
No source files, schemas, workflows, configuration, or tests were modified during this audit. The working tree remains identical to the pre-audit state (with only this audit report added).
