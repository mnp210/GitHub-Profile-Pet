# Stage 2.0B — Final Accounting, Permissions & Transaction Corrections Specification
## GitHub Profile Pet Platform

**Document Version:** 2.0.2-STAGE-2.0B  
**Author:** Staff Software Architect & Principal Systems Designer  
**Target Milestone:** Sprint 2.1 — Database and Migrations  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Status:** Approved Architectural Specification (Implementation Baseline)  

---

## 1. Executive Summary & Final Decision Table

Stage 2.0B resolves the final accounting, authorization, concurrency, and operational details for GitHub Profile Pet.

### Final Decision Table

| Issue / Area | Priority | Identified Flaw / Ambiguity | Resolution & Architectural Invariant | Sprint 2.1 Readiness |
| :--- | :---: | :--- | :--- | :---: |
| **Contribution Semantics** | **P0** | Aggregate calendar data was conflated with individual commit tracking. | Renamed category to **GitHub Activity XP**. Operating strictly on **observed GitHub contributions** ($\Delta C = \max(0, C_{\text{observed}} - C_{\text{recorded}})$). Individual commit tracking is out of scope. | **READY** |
| **Private Contributions** | **P0** | Claimed private contribution access under zero account permissions. | **Public-only synchronization is the default baseline with zero permissions.** Optional private contributions require the user's GitHub profile toggle AND user authorization with the optional **`read:user`** scope (see Stage 2.0C). Zero repo scopes required. | **READY** |
| **First-Sync Concurrency** | **P1** | `SELECT ... FOR UPDATE` fails to acquire locks on non-existent rows. | Sequence corrected: `INSERT ... ON CONFLICT (user_id, sync_date) DO NOTHING` followed immediately by `SELECT ... FOR UPDATE`. Guarantees lock on first sync. External API call moved outside transaction (Stage 2.0C). | **READY** |
| **GitHub App Revocation** | **P1** | Assumed App private key was used for token revocation endpoint. | Endpoint identified: `DELETE /applications/{client_id}/grant` with **HTTP Basic Auth (`client_id:client_secret`)**. Fallback: Local cascading purge with deterministic cache invalidation and user remediation link (Stage 2.0C). | **READY** |
| **Accounting Invariants** | **P1** | Ambiguity on rebase reductions, high-water marks, and post-cap syncs. | `total_contributions_recorded` is a **monotonically non-decreasing high-water mark**. Rebase drops never subtract XP. Durable pending increment queue introduced in Stage 2.0C (`pending_contribution_increments`). Ledger is versioned (`rule_version = 1`). | **READY** |
| **Test Environment** | **P2** | Potential conflation of mocked unit tests and PostgreSQL integration tests. | Preserved 40 unit tests as fast regression gate (`npm test`). Integration test suite defined for Sprint 2.1 against local/container PostgreSQL. Skipped tests must not be reported as passed. | **READY** |

---

## 2. GitHub Contribution Semantics (P0)

### 2.1 Contribution Terminology Correction
GitHub's GraphQL `contributionsCollection` returns aggregate calendar data composed of multiple contribution types:
- Git commits pushed to default/gh-pages branches.
- Pull requests opened.
- Issues opened.
- Pull request reviews submitted.

**Specification Invariants:**
1. All reward mechanisms refer strictly to **observed GitHub contributions** or **contribution increments**.
2. The reward category is named **GitHub Activity XP** (distinct from **Care Action XP**).
3. The diminishing reward schedule applies strictly to newly observed aggregate contribution increments within the UTC calendar day:
   - 1st observed contribution: $+25\text{ XP}$
   - 2nd observed contribution: $+15\text{ XP}$
   - 3rd observed contribution: $+10\text{ XP}$
   - 4th+ observed contribution: $+5\text{ XP}$
   - Max 5 rewarded increments per sync batch / hour.
4. **Zero Commit Pretenses:** The platform makes no claim of knowing commit SHAs, commit messages, modified files, or branch names. Individual commit-level rewards are explicitly out of scope for the core aggregate integration.

---

## 3. Private Contribution Authorization & Boundaries (P0)

### 3.1 The Authorization Reality
- **GitHub Permission Requirement:** A GitHub App with **zero repository permissions** CANNOT inspect private repository contents or query private repository data directly.
- **The Profile-Level Toggle:** GitHub provides a user-facing setting:
  > *"Include private contributions on my profile"*  
  > (GitHub Settings $\rightarrow$ Profile $\rightarrow$ Public profile $\rightarrow$ Contribution settings)
- When enabled by the developer on GitHub:
  - GitHub's GraphQL API automatically merges private contribution counts into `contributionDays.contributionCount` and `totalContributions` in the public `contributionsCollection`.
  - The application receives these aggregate numbers without needing private repository access!
- When disabled on GitHub:
  - `contributionDays` contains public open-source contributions only.
  - The application CANNOT access private counts without requesting private repository read permissions.

### 3.2 Canonical Policy
1. **Public-Only Synchronization as Default:** The platform operates by default on public contributions.
2. **Consent-Based Private Contributions:** The dashboard onboarding explains:
   > *"To have your private contributions count toward your pet's growth without granting GitHub Profile Pet access to your private code, enable 'Include private contributions on my profile' in your GitHub profile settings."*
3. **Graceful Fallback:** If private contributions are not enabled or visible, the sync engine synchronizes public contributions with zero errors.

---

## 4. First-Sync Concurrency & Row-Locking Sequence (P1)

### 4.1 The Concurrency Bug in Simple `SELECT ... FOR UPDATE`
If user `usr_1` has never had a sync record on date `2026-11-15`, executing:
```sql
SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2 FOR UPDATE;
```
returns **0 rows**. In PostgreSQL, row-level locks can only be held on *existing* rows. If two concurrent sync workers (e.g. user dashboard login + scheduled cron) query simultaneously, both observe 0 rows and both attempt to insert, leading to duplicate calculations or race conditions.

### 4.2 The Correct Atomic Ingestion Sequence
Every synchronization transaction MUST follow this exact 6-step protocol:

```mermaid
sequenceDiagram
    autonumber
    participant Worker as Sync Worker
    participant DB as PostgreSQL 16+
    participant GH as GitHub GraphQL API

    Worker->>DB: BEGIN TRANSACTION;
    Worker->>DB: INSERT INTO daily_sync_states (user_id, sync_date, total_contributions_recorded, daily_activity_xp_awarded)<br/>VALUES ($1, $2, 0, 0)<br/>ON CONFLICT (user_id, sync_date) DO NOTHING;
    Worker->>DB: SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2 FOR UPDATE;
    Note over Worker,DB: Row lock is now GUARANTEED on existing or freshly initialized row!
    Worker->>GH: Query contributionsCollection for sync_date
    GH-->>Worker: Return observed contribution count C_observed
    Worker->>Worker: Calculate delta: max(0, C_observed - C_recorded)
    alt delta > 0 AND daily_xp < 300
        Worker->>Worker: Calculate XP under diminishing schedule & daily cap
        Worker->>DB: INSERT INTO activity_reward_ledger (user_id, canonical_id, xp_awarded, ...)
        Worker->>DB: UPDATE pet_states SET xp = xp + xp_awarded, ...
        Worker->>DB: UPDATE daily_sync_states SET total_contributions_recorded = max(recorded, C_observed),<br/>daily_activity_xp_awarded = daily_xp + xp_awarded,<br/>last_synced_at = NOW();
    else delta == 0 OR daily_xp >= 300
        Worker->>DB: UPDATE daily_sync_states SET total_contributions_recorded = max(recorded, C_observed),<br/>last_synced_at = NOW();
    end
    Worker->>DB: COMMIT TRANSACTION;
```

### 4.3 Database Constraint Requirements
To guarantee this sequence:
```sql
ALTER TABLE daily_sync_states ADD CONSTRAINT uq_user_sync_date UNIQUE (user_id, sync_date);
ALTER TABLE activity_reward_ledger ADD CONSTRAINT uq_user_canonical_activity UNIQUE (user_id, canonical_activity_id);
```

### 4.4 Test Specification: Concurrent First-Time Sync
- **Precondition:** No row exists in `daily_sync_states` for `usr_test` on date `2026-11-15`.
- **Action:** Worker A and Worker B simultaneously invoke sync with observed count = 4.
- **Assertion:**
  - Both transactions complete successfully without deadlock or unique violation error.
  - Exactly one transaction calculates $\Delta C = 4$ and awards XP.
  - The second transaction observes $\Delta C = 0$ and awards 0 XP.
  - Exactly 1 ledger row is inserted.
  - Final `daily_sync_states.total_contributions_recorded` is exactly 4.
  - Final `daily_activity_xp_awarded` is exactly 55 XP ($25 + 15 + 10 + 5$).

---

## 5. GitHub Account Revocation & Deletion Architecture (P1)

### 5.1 Upstream Revocation Audit
- **Official GitHub REST API Endpoint:**
  `DELETE https://api.github.com/applications/{client_id}/grant`
- **Authentication Method:**
  **HTTP Basic Authentication** using `client_id` and `client_secret`:
  ```http
  DELETE /applications/Iv1.1234567890abcdef/grant HTTP/1.1
  Host: api.github.com
  Authorization: Basic <base64(client_id + ":" + client_secret)>
  Accept: application/vnd.github+json
  Content-Type: application/json

  {
    "access_token": "ghu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
  ```
- **Expected Responses:**
  - `204 No Content`: Successfully revoked upstream authorization and all user tokens.
  - `404 Not Found`: Token was already revoked or invalid.
  - `401 Unauthorized`: Invalid client credentials.

### 5.2 Deterministic Deletion Protocol (Failure-Tolerant)
If GitHub's API is unreachable, times out, or returns a 5xx error during user account deletion:
1. **Local Purge Is Authoritative:** The user requested deletion of their GitHub Profile Pet account. Local deletion MUST NOT fail or be blocked by upstream network errors.
2. **Transaction Sequence:**
   ```sql
   BEGIN;
   DELETE FROM users WHERE id = $1; -- Cascades to github_accounts, pet_states, ledger, sync_states
   COMMIT;
   ```
3. **Upstream Cleanup:** Attempt `DELETE /applications/{client_id}/grant` synchronously with a 3-second timeout.
   - If success (`204`) or already revoked (`404`): Proceed.
   - If timeout / 5xx: Log warning. The local encrypted token is already permanently destroyed. Any orphan token on GitHub's side naturally expires within $\le 8\text{ hours}$ and cannot be refreshed because the refresh token was destroyed.
4. **Public Cache Purge:** Invalidate edge cache for `/api/pet/[username]/svg`. Subsequent requests return a generic fallback egg graphic.

---

## 6. Reward Ledger & Accounting Invariants (P1)

### 6.1 The Monotonic High-Water Mark Invariant
To handle commit rebases, force-pushes, and deleted commits:
$$\text{RecordedSnapshot} = \max(\text{RecordedSnapshot}, C_{\text{observed}})$$

```text
INVARIANT 1: Monotonically Non-Decreasing Snapshot
  Let C_recorded be the recorded count in daily_sync_states.
  If C_observed < C_recorded:
    delta = 0.
    xp_awarded = 0.
    C_recorded is NOT decremented.

INVARIANT 2: Rebase Anti-Exploit
  If a user has 10 contributions, rebases down to 8, and later pushes 3 new commits (total 11):
  - On drop to 8: delta = max(0, 8 - 10) = 0.
  - On push to 11: delta = max(0, 11 - 10) = 1.
  The user is rewarded ONLY for the 1 genuinely new contribution above their daily high-water mark (10).
  They cannot re-earn XP for contributions 9 and 10!
```

### 6.2 Post-Cap Sync Invariant
When a user reaches the daily cap ($XP_{\text{prev}} = 300\text{ XP}$):
- Subsequent syncs observe new contributions ($\Delta C > 0$).
- Available budget: $\max(0, 300 - 300) = 0\text{ XP}$.
- XP awarded: $0\text{ XP}$.
- `daily_sync_states.total_contributions_recorded` is updated to reflect the true contribution count for profile badge accuracy.
- No XP ledger row is added (preventing ledger bloat), or a 0-XP audit row is logged with reason `"DAILY_CAP_EXHAUSTED"`.

### 6.3 Versioned Economic Rules Invariant
Every row in `activity_reward_ledger` includes:
```sql
rule_version INTEGER NOT NULL DEFAULT 1
```
- `rule_version = 1`: The Stage 1.3A/2.0 schedule ($25 \rightarrow 15 \rightarrow 10 \rightarrow 5\text{ XP}$, 300 XP daily cap).
- If game balancing changes in Stage 3, `rule_version = 2` is deployed.
- Historical ledger rows remain immutable and mathematically verifiable against the rule version under which they were minted.

---

## 7. Sprint 2.1 Integration Test Specification (P2)

To ensure high-confidence database execution without mocking PostgreSQL transactions:

### 7.1 Architecture Test Strategy
1. **Unit Tests (Fast Regression Gate):**
   - Script: `npm test` (`node --test --experimental-strip-types tests/unit/*.test.ts`)
   - 40 tests across 8 suites (Pure functions: progression, formulas, deduplication, inactivity, embed sanitization).
   - Must run in $< 1\text{ second}$ with zero database dependency.
2. **PostgreSQL Integration Tests (Dedicated Suite):**
   - Script: `npm run test:integration` (`tests/integration/*.test.ts`)
   - Runs against a local PostgreSQL 16 container (`docker run -p 5432:5432 ...`) or test database URL (`TEST_DATABASE_URL`).
   - If `TEST_DATABASE_URL` is unset, the suite **skips explicitly** with an informative banner and **is NEVER reported as passed**.

### 7.2 Mandatory Integration Test Scenarios for Sprint 2.1
- **Test 1 (Concurrent First Sync):** Two concurrent worker promises invoke the sync sequence for a new user/date. Assert exactly 1 awards XP, zero unique constraint violations throw, and final XP matches single execution.
- **Test 2 (Concurrent Existing Row Sync):** Two concurrent workers invoke sync on an existing row with $\Delta C = 3$. Assert row lock queues them sequentially and awards exactly once.
- **Test 3 (Atomic 300 XP Cap):** Worker attempts to award 400 XP across multiple increments in a single day. Assert database constraint `chk_daily_xp_cap` and transaction logic clamp final `daily_activity_xp_awarded` to exactly 300.
- **Test 4 (Monotonic Rebase Protection):** Observed count decreases from 10 to 7, then increases to 12. Assert total XP awarded corresponds to exactly 12 contributions ($10 + 2$), never double-counting 8, 9, or 10.
- **Test 5 (Transaction Rollback on Error):** Simulated failure during pet state update rolls back ledger insertion and leaves sync state untouched.

---

## 8. Summary of Sprint 2.1 Readiness

| Requirement | Implementation Artifact | Status |
| :--- | :--- | :---: |
| **DDL Migrations** | `migrations/001_initial_schema.sql` & `.down.sql` | **Ready for authoring** |
| **Connection Pooling** | `src/lib/db/pool.ts` (PostgreSQL 16+) | **Ready for authoring** |
| **Repositories** | `UserRepository`, `PetRepository`, `LedgerRepository`, `SyncRepository` | **Ready for authoring** |
| **Transaction Wrapper** | `withTransaction(async (client) => { ... })` with row locks | **Ready for authoring** |
| **Regression Gates** | 40 unit tests passing + ESLint + Turbopack build | **100% Passed** |

*All architectural ambiguities have been resolved. The platform is ready for Sprint 2.1 implementation upon approval.*
