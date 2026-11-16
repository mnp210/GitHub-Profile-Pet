# GitHub Contribution Synchronization Architecture & GraphQL Integration Specification

**Project:** GitHub Profile Pet  
**Milestone:** Sprint 2.4A — GitHub GraphQL Client & Public Contribution Snapshot Retrieval  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Status:** Approved & Verified Against PostgreSQL 16+

---

## 1. Executive Summary & Purpose

Sprint 2.4A establishes a production-grade, server-authoritative GitHub GraphQL integration that retrieves authenticated users' public contribution snapshots.

This milestone provides the trustworthy, auditable data layer for future contribution reward calculation (Sprint 2.4B) and sync automation (Sprint 2.4C). In accordance with the strict safety constraints of Sprint 2.4A, this subsystem is **strictly read-only**:
- Zero XP is awarded.
- Zero pet vitals (energy, hunger, happiness) are modified.
- Zero activity reward ledger entries are written.
- Daily synchronization high-water marks (`daily_sync_states`) remain untouched.

---

## 2. GitHub GraphQL Architecture

### 2.1 Endpoint and Protocol
- **Official Endpoint:** `https://api.github.com/graphql`
- **Transport:** Native Node.js `fetch` with TypeScript (zero external GraphQL client dependencies).
- **Authentication:** `Authorization: Bearer <decrypted_access_token>`.
- **Headers:**
  - `Accept: application/vnd.github+json`
  - `Content-Type: application/json`
  - `User-Agent: GitHub-Profile-Pet`
  - `X-GitHub-Api-Version: 2022-11-28`
- **Timeout:** Strict 10,000ms timeout per request via `AbortSignal.timeout(10_000)`.

### 2.2 Security & Token Redaction Invariant
Access tokens (e.g. `ghu_*`, `gho_*`, `ghp_*`) and `Authorization: Bearer` strings are strictly redacted from all error messages and application logs via `redactSensitiveData()`. Under no circumstances are provider tokens exposed to client-side code or browser network responses.

---

## 3. Contribution Snapshot Query & Field Semantics

### 3.1 GraphQL Query
The server executes the following query against GitHub's GraphQL API:

```graphql
query ContributionSnapshot($from: DateTime!, $to: DateTime!) {
  viewer {
    id
    databaseId
    login
    contributionsCollection(from: $from, to: $to) {
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
}
```

### 3.2 Field Semantics
| Field | Source Type | Semantic Definition | Public / Restricted Status |
|---|---|---|---|
| `viewer.id` | `ID!` | Base64 GraphQL Node ID (e.g. `MDQ6VXNlcjU4MzIzMQ==`). | Internal GraphQL identity. |
| `viewer.databaseId` | `Int!` | Immutable numeric GitHub user ID (e.g. `583231`). | **Primary Identity Anchor**. Must strictly match stored `github_accounts.github_user_id`. |
| `viewer.login` | `String!` | Current GitHub username (e.g. `octocat`). | Mutable handle; verified on each query to trigger safe username update if changed. |
| `totalCommitContributions` | `Int!` | Aggregate commits authored in public repositories within `[from, to]`. | Public |
| `totalIssueContributions` | `Int!` | Issues opened in public repositories within `[from, to]`. | Public |
| `totalPullRequestContributions` | `Int!` | Pull requests authored in public repositories within `[from, to]`. | Public |
| `totalPullRequestReviewContributions` | `Int!` | PR reviews submitted in public repositories within `[from, to]`. | Public |
| `restrictedContributionsCount` | `Int!` | Contributions in private repositories or restricted organizations. | **Restricted / Isolated** (Non-rewardable in default mode). |
| `contributionCalendar.totalContributions` | `Int!` | Total contributions recognized on the user's GitHub contribution calendar. | Aggregate |

> [!IMPORTANT]
> **Aggregate Count vs Category Sum:**
> `contributionCalendar.totalContributions` does not necessarily equal the arithmetic sum of the four category fields. GitHub calculates calendar totals using distinct business logic (such as repository visibility and co-authored commits). The platform records both category breakdowns and the calendar aggregate to ensure auditable accounting.

---

## 4. Public vs Restricted Contributions

### 4.1 Default Zero-Scope Footprint
- **Default Scopes:** None (zero repository permissions, zero account permissions).
- **Behavior:** The default experience syncs only public contributions.
- **Restricted Separation & `publicTotal` Invariant:**
  - `restrictedContributionsCount` is isolated in its own field in `GitHubContributionSnapshot.contributions.restricted`.
  - To prevent future reward engines from mistakenly counting restricted contributions, the snapshot explicitly provides `publicTotal`:
    $$\text{publicTotal} = \text{commits} + \text{issues} + \text{pullRequests} + \text{pullRequestReviews}$$
  - `total` preserves the raw count from GitHub's `contributionCalendar.totalContributions`.
  - When `restricted > 0`, GitHub's calendar `total` includes private contributions! In this scenario, `hasRestrictedContributions` is set to `true` and `visibility` is `'mixed_restricted'`, alerting consumers that while category breakdowns are public, the calendar total contains restricted counts.
  - The future reward engine (Sprint 2.4B) **must strictly consume `publicTotal`** in default mode.

### 4.2 Private Contribution Constraints (Future Milestone)
As established in Stage 2.0C, counting contributions from private repositories requires:
1. Explicit user consent in pet settings.
2. The optional `read:user` authorization scope.
3. The user's GitHub profile setting: *"Include private contributions on my profile"*.

In Sprint 2.4A and 2.4A.1, private contribution synchronization is not enabled, and default rewards must strictly ignore private counts.

---

## 5. Date-Range Handling & UTC Normalization

### 5.1 UTC Boundary Enforcement
All date queries are normalized to UTC ISO-8601 format (`YYYY-MM-DDTHH:mm:ss.sssZ`):
- **Omitted parameters:** Defaults to the current UTC day:
  - `from`: Start of current UTC day (`00:00:00.000Z`).
  - `to`: End of current UTC day (`23:59:59.999Z`).
- **Explicit `from` only:** `from` to end of current UTC day.
- **Explicit `to` only:** 30 days prior to `to` through `to`.
- **Both provided:** Validates that `from <= to` and that `(to - from) <= 366 days` (1 year max).

### 5.2 Boundary Inclusivity
GitHub GraphQL `contributionsCollection(from: $from, to: $to)` interprets `from` and `to` as timestamp boundaries. Using UTC millisecond precision (`00:00:00.000Z` to `23:59:59.999Z`) guarantees clean, non-overlapping daily windows for subsequent daily sync reconciliation.

---

## 6. Identity Verification & Account Security

1. **Session-Bound Identity:** Requests never accept arbitrary GitHub usernames or IDs from client payloads. The query is bound to the user's `pet_session` HttpOnly cookie.
2. **Immutable Numeric Anchor:** The GraphQL viewer's `databaseId` is cast to string and verified against `github_accounts.github_user_id`. If they do not match, the request fails with `HTTP 403 Forbidden` (`GitHubIdentityMismatchError`).
3. **Handle Renames:** If the developer renamed their GitHub account, `viewer.login` differs from `account.username`. When detected, the system safely triggers `UserRepository.updateHandleIfChanged(userId, viewer.login)` to synchronize handles without disrupting account ownership or pet progression.

---

## 7. Token Lifecycle, Rotating Refresh Concurrency & Lease Serialization

Managed in `src/lib/github/tokenManager.ts` with two-tier concurrency protection:

### 7.1 In-Process Promise Coalescing
When multiple simultaneous requests arrive within the same Node.js process for an account with an expiring token, they attach to a single in-flight `Promise<string>` stored in `inFlightRefreshes.get(account.id)`. Exactly one network request is dispatched, and all awaiting callers resolve with the identical fresh access token.

### 7.2 Cross-Process Distributed Lease Serialization & Fencing (PostgreSQL)
To prevent race conditions across multiple server instances or worker processes:
1. **Double-Checked Read:** Before requesting a lease, the process re-reads `github_accounts`. If another process has already refreshed the token, it immediately returns the fresh credentials without contacting GitHub.
2. **Atomic Lease Claim with Unique Fencing Token:**
   Every worker generates an unpredictable, unique lease owner identifier (fencing token via `crypto.randomUUID()`) when attempting acquisition:
   ```sql
   UPDATE github_accounts
   SET token_refresh_locked_at = NOW(),
       token_refresh_owner = $2
   WHERE id = $1
     AND (token_refresh_locked_at IS NULL OR token_refresh_locked_at < NOW() - make_interval(secs => $3))
   RETURNING id, token_version;
   ```
   - **Winner (`rowCount === 1`):** Releases the DB connection, executes `authClient.refreshToken()`, persists new encrypted tokens conditionally, and increments `token_version`.
   - **Contender (`rowCount === 0`):** Enters a short backoff polling loop (checking every 200ms up to 5 seconds). As soon as the winner commits the new tokens, the contender reads and decrypts the fresh token without executing a second upstream refresh.
   - **Deadlock Prevention:** The 30-second TTL guarantees recovery even if a worker node crashes mid-flight.
   - **Zero Connection Bloat:** **Zero database transactions are held open** during the external GitHub network call.

3. **Conditional Credential Persistence (Fencing Protection):**
   To prevent a slow worker (e.g., experiencing GC pauses or network delays) whose lease expired from overwriting newer credentials persisted by another worker, token updates are strictly conditional on lease ownership:
   ```sql
   UPDATE github_accounts
   SET encrypted_access_token = $1,
       encrypted_refresh_token = $2,
       token_expires_at = $3,
       refresh_expires_at = $4,
       is_disconnected = FALSE,
       token_refresh_locked_at = NULL,
       token_refresh_owner = NULL,
       token_version = token_version + 1,
       updated_at = NOW()
   WHERE id = $5
     AND token_refresh_owner = $6
   RETURNING token_version;
   ```
   - If `rowCount === 0`, the worker has lost its lease and was fenced out. The stale write is safely rejected, leaving the winning worker's newer token generation intact.
   - The fenced worker recovers seamlessly by re-reading the database and returning the winning worker's fresh credentials.

4. **Conditional Lease Release:**
   When a refresh fails or encounters an error, the worker releases the lease conditionally:
   ```sql
   UPDATE github_accounts
   SET token_refresh_locked_at = NULL,
       token_refresh_owner = NULL
   WHERE id = $1
     AND token_refresh_owner = $2;
   ```
   This ensures that a stale worker cannot inadvertently release a lock acquired by another concurrent worker.

5. **Timeout Invariant & Monotonic Versioning:**
   - **Timeout Hierarchy:** GitHub OAuth refresh HTTP timeout ($10\text{s}$) is strictly smaller than lease TTL ($30\text{s}$), providing a $20\text{s}$ safety margin against premature lease expiration during normal execution.
   - **Monotonic Version:** Every successful credential persistence increments `token_version` monotonically (`DEFAULT 1`), providing verifiable generation tracking across audits.

### 7.3 External Token Rotation Ambiguity & Fail-Closed Recovery (Migration 006)
In distributed token refresh architectures using OAuth 2.0 rotating refresh tokens, **external token rotation by GitHub and local database persistence cannot form a 2-phase commit (2PC) atomic transaction**. When upstream rotation succeeds but local persistence is interrupted or unconfirmed, blind retries risk submitting an already-consumed refresh token, triggering provider-side token-family revocation.

To resolve this failure window, Migration 006 introduces state tracking via:
- `token_refresh_status VARCHAR(32) NOT NULL DEFAULT 'idle'` (`idle`, `dispatched`, `ambiguous`)
- `token_refresh_dispatched_at TIMESTAMPTZ`
- `token_refresh_dispatched_version INTEGER`

#### 7.3.1 Pre-Dispatch Intent vs Un-dispatched Leases
Before initiating the external HTTP request, the active worker atomically records its dispatch intent via `UserRepository.markRefreshDispatched`:
```sql
UPDATE github_accounts
SET token_refresh_status = 'dispatched',
    token_refresh_dispatched_at = NOW(),
    token_refresh_dispatched_version = $3,
    updated_at = NOW()
WHERE id = $1 AND token_refresh_owner = $2;
```
- **Un-dispatched Crashes:** If a worker crashes or loses its lease *before* dispatching (`status === 'idle'`), subsequent workers know with 100% certainty that the refresh token was never sent over the wire and can safely proceed with refresh.
- **Dispatched / Ambiguous Recovery:** If a worker marked generation $V$ as `dispatched` and its lease expired without generation $V+1$ being persisted (Scenario 1 & 2), the token is considered *tainted*. Any subsequent worker immediately fences itself from replaying the token, marks the account as `ambiguous`, and fails closed with `GitHubReauthorizationRequiredError`.

#### 7.3.2 Ambiguous Upstream Failure & Persistence Breakdown
- **Upstream Network Loss (Scenario 2):** If GitHub drops the connection or times out, the application cannot ascertain whether the provider rotated the token. The worker marks `status = 'ambiguous'`, releases the lease, and throws `GitHubReauthorizationRequiredError` to prevent token-family revocation.
- **Persistence Failure (Scenario 4):** If GitHub returns fresh credentials but local PostgreSQL persistence fails, the worker cannot guarantee durable storage. The account is transitioned to `ambiguous`, the old refresh token is never reused, and the user is guided to reauthorize without losing existing pet progression or user profiles.
- **Reauthorization Recovery:** When the developer signs in through GitHub OAuth callback (`/api/auth/callback`), `UserRepository.updateTokens` unconditionally resets `token_refresh_status = 'idle'`, clears dispatched tracking, increments `token_version`, and restores normal operation.

### 7.4 Disconnected Accounts
If `is_disconnected = true` or credentials are NULL, the request immediately throws `GitHubAccountDisconnectedError` (HTTP 403).

---

## 8. Rate-Limit Strategy & Error Classification

### 8.1 Rate-Limit Detection
- **Primary Rate Limit:** Inspects `x-ratelimit-remaining === '0'` or HTTP 429.
- **Secondary Rate Limit:** Inspects HTTP 403 responses containing "secondary rate limit" or "abuse".
- **Propagation:** Throws `GitHubRateLimitError`, returning HTTP 429 with:
  - `Retry-After: <seconds>` header (if provided by GitHub).
  - `resetAt: <ISO-8601>` timestamp in response body.

### 8.2 HTTP Status Code Mapping
| Failure Condition | Internal Error Class | HTTP Status Code | Response Body |
|---|---|---|---|
| Missing / expired session cookie | `SessionVerificationError` | **401 Unauthorized** | `{"success": false, "error": "Authentication required..."}` |
| Token expired / revoked upstream | `GitHubUnauthorizedError` | **401 Unauthorized** | `{"success": false, "error": "GitHub token is invalid..."}` |
| Invalid / inverted / oversized dates | `InvalidDateRangeError` | **400 Bad Request** | `{"success": false, "error": "..."}` |
| GitHub account disconnected | `GitHubAccountDisconnectedError` | **403 Forbidden** | `{"success": false, "error": "GitHub account is disconnected..."}` |
| Stored credentials missing / NULL | `GitHubMissingCredentialsError` | **403 Forbidden** | `{"success": false, "error": "GitHub account has no stored credentials."}` |
| Identity mismatch (`databaseId`) | `GitHubIdentityMismatchError` | **403 Forbidden** | `{"success": false, "error": "Identity mismatch..."}` |
| Rate limit exceeded | `GitHubRateLimitError` | **429 Too Many Requests** | `{"success": false, "error": "...", "resetAt": "..."}` |
| Upstream network timeout (>10s) | `GitHubTimeoutError` | **503 Service Unavailable** | `{"success": false, "error": "GitHub GraphQL request timed out..."}` |
| GitHub 500/502/503 or malformed payload | `GitHubServerError` / `GitHubGraphQLError` | **502 Bad Gateway** | `{"success": false, "error": "GitHub provider error: ..."}` |
| Trainer record not found | `UserNotFoundError` | **404 Not Found** | `{"success": false, "error": "Trainer account..."}` |

---

## 9. API Route Specification

### `GET /api/github/contributions`

#### Request
- **Headers:** `Cookie: pet_session=<token>`
- **Query Parameters (Optional):**
  - `from`: ISO-8601 DateTime (e.g. `2026-11-01T00:00:00.000Z`).
  - `to`: ISO-8601 DateTime (e.g. `2026-11-15T23:59:59.999Z`).

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "snapshot": {
    "githubUserId": "583231",
    "username": "octocat",
    "period": {
      "from": "2026-11-01T00:00:00.000Z",
      "to": "2026-11-15T23:59:59.000Z"
    },
    "contributions": {
      "commits": 25,
      "issues": 4,
      "pullRequests": 7,
      "pullRequestReviews": 3,
      "restricted": 10,
      "total": 39,
      "publicTotal": 39
    },
    "retrievedAt": "2026-11-15T10:35:00.000Z",
    "visibility": "mixed_restricted",
    "hasRestrictedContributions": true
  }
}
```

---

## 10. Sprint 2.4B — Daily Contribution State & High-Water Mark Reconciliation

### 10.1 Mathematical Definition & Invariants
Sprint 2.4B implements the persistent daily GitHub contribution reconciliation engine. This system computes observed activity increments without altering gameplay progression:
- **Observed Public Count ($P_{\text{observed}}$):** Strictly computed from the four public categories:
  $$P_{\text{observed}} = \text{commits} + \text{issues} + \text{pullRequests} + \text{pullRequestReviews}$$
- **Previous High-Water Mark ($H_{\text{prev}}$):** Persisted in `daily_sync_states.total_contributions_recorded`.
- **Newly Observed Increments ($\Delta$):**
  $$\Delta = \max(0, P_{\text{observed}} - H_{\text{prev}})$$
- **Current High-Water Mark ($H_{\text{curr}}$):** Monotonically non-decreasing:
  $$H_{\text{curr}} = \max(H_{\text{prev}}, P_{\text{observed}})$$
- **Latest Observed Contributions:** Persisted in `daily_sync_states.latest_observed_contributions`, tracking the exact upstream count reported by GitHub (allowing auditability even if upstream contributions drop due to git history rebases or repository deletion).

### 10.2 Concurrency & Locking Strategy
- **Transaction Boundary:** External GitHub GraphQL query executes **outside** the database transaction.
- **Row-Level Lock:** Enters transaction and executes `SELECT ... FOR UPDATE` on `daily_sync_states` with unique constraint `(user_id, sync_date)`.
- **Lock Hold Duration:** Bounded to sub-millisecond execution (<5ms).

### 10.3 Strict Scope Invariants (Zero-Progression Boundary)
- **Zero XP Awarded:** Pet experience remains strictly unmodified.
- **Zero Pet Vitals Modified:** Energy, hunger, and happiness remain unchanged.
- **Zero Ledger Entries:** `activity_reward_ledger` is not written to in this milestone.
- **Zero Queueing:** No pending reward queues or reward processing.

### 10.4 API Route Specification: `POST /api/github/contributions`
- **Authentication:** `Cookie: pet_session=<session_token>`
- **Request Body:** `{ "date": "YYYY-MM-DD" }` (optional; defaults to current UTC day).
- **Response (`200 OK`):**
```json
{
  "success": true,
  "reconciliation": {
    "userId": "usr_...",
    "utcDate": "2026-11-15",
    "latestObservedContributions": 9,
    "previousHighWaterMark": 4,
    "currentHighWaterMark": 9,
    "newlyObservedIncrements": 5,
    "reconciledAt": "2026-11-15T10:45:00.000Z"
  }
}
```

---

## 11. Future Integration Points (Sprint 2.4C)

1. **Sprint 2.4C — Reward Accounting, Progression & Background Sync:**
   - Feed observed increments ($\Delta$) into the reward calculator.
   - Apply the 5-increment hourly throttle and diminishing returns schedule:
     - Increment 1: 25 XP
     - Increment 2: 15 XP
     - Increment 3: 10 XP
     - Increment 4+: 5 XP
   - Enforce the daily 300 XP activity cap.
   - Enqueue excess increments into `pending_contribution_increments`.
   - Write atomic append-only ledger entries to `activity_reward_ledger`.
   - Implement scheduled periodic background polling with 2-day grace window reconciliation.

---

## 12. Official Documentation References

- [GitHub GraphQL API — Explorer & Reference](https://docs.github.com/en/graphql/reference)
- [GitHub GraphQL API — ContributionsCollection](https://docs.github.com/en/graphql/reference/objects#contributionscollection)
- [GitHub App User-to-Server Requests](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user)
- [Refreshing User-to-Server Access Tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-to-server-access-tokens)
