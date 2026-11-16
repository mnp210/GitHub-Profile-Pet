# GitHub Authentication, Secure Sessions & Account Lifecycle Architecture

**Project:** GitHub Profile Pet  
**Milestone:** Sprint 2.3  
**Status:** Approved & Verified Against PostgreSQL 16+

---

## 1. Executive Summary & Model Selection

Sprint 2.3 establishes production-ready GitHub authentication, persistent hashed session management, and complete account lifecycle operations for the GitHub Profile Pet platform.

### Selected Model: GitHub App with User-to-Server OAuth 2.0 Flow
As evaluated in Stage 1.3A and ratified in Stage 2.0C, GitHub Profile Pet uses the **GitHub App User-to-Server authorization model** instead of legacy OAuth Apps:

| Architectural Property | Legacy OAuth App | Modern GitHub App (Adopted) | Rationale |
|---|---|---|---|
| **Access Token Lifetime** | Indefinite (static strings) | **8 hours** (28,800s) | Eliminates perpetual exposure risk if credentials leak. |
| **Refresh Token Lifetime** | None | **6 months** with rotation | Regular rotation with one-time use per refresh grant. |
| **Permission Scope** | Broad, coarse scopes | **Fine-grained & minimal** | Zero repository and zero account permissions required for default experience. |
| **API Rate Limits** | 5,000 req/hr (shared) | **5,000 req/hr per user/app** | Isolated user-level budget; cannot be drained by third-party apps. |
| **Identity Endpoint** | `GET /user` | `GET /user` | Returns immutable numeric ID (`id`), username (`login`), and avatar without requiring email access. |

---

## 2. Permissions, Scopes & Identity Anchor

### 2.1 Default Zero-Permission Footprint
- **Default Scopes:** **None** (zero account permissions, zero repository permissions).
- **Public Developer Trust:** The user authorizes GitHub Profile Pet purely for identity authentication. The application cannot view private repositories, cannot commit code, cannot modify settings, and cannot read email addresses.
- **Identity Anchor:** The immutable GitHub numeric user ID (`id` from `GET /user`, stored as `github_user_id` VARCHAR(64) in `github_accounts`).
  - GitHub usernames can be renamed by developers at any time. Renames are detected during login/sync and safely update `users.primary_handle` and `github_accounts.username` without changing account ownership or losing pet progression.

### 2.2 Optional Scope (Reserved for Stage 2.4+)
- **`read:user`:** Reserved exclusively for optional private contribution counting. It will only be requested when the user explicitly toggles *"Sync Private Contributions"* in pet settings.

---

## 3. Persistent Session Architecture

```
 Browser Cookie                                    PostgreSQL 16+
+--------------------------+                   +----------------------------------+
| pet_session              |                   | user_sessions                    |
| (64-hex Raw Token)       |                   |                                  |
|                          |                   | id: UUID                         |
| HttpOnly; Path=/;        |   SHA-256 Hash    | user_id: UUID (FK -> users)      |
| SameSite=Lax;            | ----------------> | session_token_hash: VARCHAR(64)  |
| Max-Age=2592000;         |                   | expires_at: TIMESTAMPTZ          |
| Secure (in prod)         |                   | last_active_at: TIMESTAMPTZ      |
+--------------------------+                   | revoked_at: TIMESTAMPTZ          |
                                               +----------------------------------+
```

### 3.1 Security Invariants
1. **Never Store Plaintext Session Tokens:** The browser holds the 64-character random hex token in an `HttpOnly` cookie. The database stores strictly `SHA-256(rawToken)`. Even with complete database read access, an attacker cannot construct valid session cookies.
2. **Explicit Expiration & Revocation:**
   - Active lookup query:
     ```sql
     SELECT * FROM user_sessions
     WHERE session_token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW();
     ```
   - Logout immediately sets `revoked_at = NOW()`.
3. **Throttled Activity Touch:** `last_active_at` is updated at most once every 5 minutes to eliminate write amplification on high-frequency requests.
4. **Cascading Deletion:** `user_sessions.user_id REFERENCES users(id) ON DELETE CASCADE`. When an account is deleted, all session records are automatically wiped.

---

## 4. Token Encryption at Rest (AES-256-GCM)

All GitHub OAuth access tokens and refresh tokens are encrypted before insertion into `github_accounts`:

- **Cipher:** Authenticated `aes-256-gcm` (Galois/Counter Mode).
- **IV:** 96-bit (12-byte) cryptographically secure random IV generated per encryption.
- **AAD:** Associated Authenticated Data `Buffer.from('github_token')` bound to the cipher.
- **Auth Tag:** 128-bit (16-byte) tag ensuring ciphertext integrity and authenticity.
- **Serialized Format:** `v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`.
- **Key Management:** Derived from `TOKEN_ENCRYPTION_KEY` (must be 64 hexadecimal characters in production).

---

## 5. Account Lifecycle: Logout vs Disconnect vs Deletion

| Operation | Target Endpoint | GitHub Grant Revocation | Database State | Session State |
|---|---|---|---|---|
| **Logout** | `POST /api/auth/logout` | No | Retained intact. | Session revoked (`revoked_at = NOW()`), cookie cleared. |
| **Disconnect** | `POST /api/auth/disconnect` | **Attempts upstream grant revocation** (`DELETE /applications/{client_id}/grant` with 3s timeout) | `is_disconnected = true`, tokens set to `NULL`. User, profile, pet retained. | Active session retained. |
| **Account Deletion** | `DELETE /api/auth/account` | **Yes** (Upstream `DELETE /applications/{client_id}/grant` with 3s timeout) | Entire account, pet, ledger, history purged via atomic cascade. | All user sessions purged, cookie cleared. |

### 5.1 Upstream Revocation Failure Handling (Account Deletion)
If GitHub's grant revocation API times out or fails (e.g. GitHub API outage):
1. The local deletion transaction **still executes completely and irrevocably** (guaranteeing user data deletion under privacy regulations).
2. The API response returns `upstreamRevoked: false` with an actionable instruction pointing the user to `https://github.com/settings/applications`.

### 5.2 Disconnect Upstream Revocation Semantics
When a user disconnects their GitHub account:
1. The server decrypts the user's stored access token and attempts to revoke the GitHub App grant upstream.
2. Regardless of whether upstream revocation succeeds or fails (e.g. timeout, network partition):
   - Local stored credentials (`encrypted_access_token`, `encrypted_refresh_token`, expiration timestamps) are **immediately and permanently set to NULL**.
   - `is_disconnected` is set to `true`.
   - The user record, pet state, inventory, and history are preserved so the pet is never lost or orphaned.
3. If upstream revocation fails, the response clearly indicates `upstreamRevoked: false` and provides the exact link `https://github.com/settings/applications` for manual OAuth permission removal.

---

## 6. API Route Contracts

### 6.1 `GET /api/auth/login`
- **Purpose:** Initiates OAuth 2.0 authorization.
- **Query Params:** `returnUrl` (optional, sanitized against open redirects).
- **Behavior:** Generates 256-bit random state, sets `pet_oauth_state` (10-min TTL) and `pet_oauth_return` cookies, redirects 302 to GitHub.

### 6.2 `GET /api/auth/callback`
- **Purpose:** Completes authorization, associates identity, provisions persistent account and session.
- **Behavior:** Validates state with constant-time equality, exchanges authorization code, retrieves `GET /user`, encrypts tokens, upserts trainer, creates session, sets `pet_session` cookie, and redirects 302 to target destination.

### 6.3 `GET /api/auth/me`
- **Purpose:** Returns authenticated trainer profile, pet stats, and session metadata.
- **Security:** Access tokens, refresh tokens, and session hashes are strictly omitted.
```json
{
  "authenticated": true,
  "authSource": "session",
  "user": {
    "id": "e2a0b123-...",
    "primaryHandle": "octocat",
    "role": "trainer"
  },
  "account": {
    "githubUserId": "583231",
    "username": "octocat",
    "hasPrivateContributionsScope": false,
    "isDisconnected": false
  },
  "pet": {
    "name": "Shadow Claw",
    "species": "cat",
    "level": 1,
    "xp": 30,
    "maxExp": 100,
    "mood": "Focused",
    "evolutionStage": "Hatchling",
    "energy": 62,
    "hunger": 60,
    "happiness": 70
  },
  "session": {
    "id": "c1f8a...",
    "expiresAt": "2026-12-15T11:00:00.000Z",
    "lastActiveAt": "2026-11-15T11:00:00.000Z"
  }
}
```

### 6.4 `GET /api/auth/session`
- **Purpose:** Lightweight session verification.
- **Response (Active):** `{ "authenticated": true, "session": { "id": "...", "userId": "...", "handle": "octocat", "expiresAt": "..." } }`
- **Response (Unauthenticated):** `{ "authenticated": false, "session": null }`

### 6.5 `POST /api/auth/logout`
- **Headers:** Requires trusted Origin/Referer.
- **Behavior:** Revokes session in database, returns `Set-Cookie` with `Max-Age=0`.
- **Response:** `{ "success": true, "message": "Logged out successfully" }`

### 6.6 `POST /api/auth/disconnect`
- **Headers:** Requires trusted Origin/Referer and authentication.
- **Behavior:** Sets `is_disconnected = true` and clears encrypted tokens in `github_accounts`.
- **Response:** `{ "success": true, "message": "GitHub account disconnected successfully. Stored credentials purged." }`

### 6.7 `DELETE /api/auth/account`
- **Headers:** Requires trusted Origin/Referer and authentication.
- **Behavior:** Upstream grant revocation, cascading database purge, session cookie cleared.
- **Response:**
```json
{
  "success": true,
  "upstreamRevoked": true,
  "message": "Account and GitHub grant successfully deleted."
}
```

---

## 7. Production Security Guarantees & Test Isolation

### 7.1 Test Header Isolation
- **Headers:** `x-test-trainer-handle`, `x-test-user-id`.
- **Security Invariant:** In `process.env.NODE_ENV === 'production'`, these headers are **strictly ignored**. Requests fail closed with HTTP 401 unless authenticated via a valid persistent session cookie.
- **Automated Verification:** Verified in `tests/unit/authSecurityIsolation.test.ts`.

### 7.2 CSRF & Origin Defense
- State-changing endpoints (`POST`, `DELETE`, `PUT`, `PATCH`) enforce Origin/Referer verification against configured application domains (`NEXT_PUBLIC_APP_URL` and `Host`).
- Foreign cross-origin requests are rejected with HTTP 403 Forbidden.

### 7.3 Open Redirect Prevention
- `returnUrl` parameters are sanitized via `sanitizeReturnUrl`.
- Protocol-relative (`//evil.com`), absolute (`https://evil.com`), and backslash (`/\evil.com`) exploits are neutralized to root (`/`).

### 7.4 Cookie-Only Authentication Policy (Bearer Token Removal)
- In Sprint 2.3A, the `Authorization: Bearer` authentication mechanism was audited and permanently removed from all session endpoints (`/api/auth/me`, `/api/auth/session`, `/api/auth/logout`, `/api/auth/disconnect`, `/api/auth/account`, `/api/pet/action`).
- **Security Rationale:** Allowing Bearer tokens in a first-party web application creates a dangerous precedent: it encourages developers to store tokens in JavaScript-accessible storage (`localStorage` or `sessionStorage`), which exposes sessions to total compromise via Cross-Site Scripting (XSS).
- **Enforcement:** All browser clients authenticate exclusively via the `pet_session` `HttpOnly`, `SameSite=Lax`, `Secure` cookie, rendering tokens unreachable by injected client-side JavaScript.

---

## 8. Database Migrations

### Migration 003 (`migrations/003_user_sessions.sql`)
```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    ip_address VARCHAR(45),
    user_agent TEXT
);
CREATE INDEX idx_user_sessions_lookup ON user_sessions(session_token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
```

### Rollback 003 (`migrations/003_user_sessions.down.sql`)
```sql
DROP TABLE IF EXISTS user_sessions CASCADE;
```

### Migration 004 (`migrations/004_account_cleanup_trigger.sql`)
```sql
-- Migration 004: Ensure deleting a user purges its associated github_accounts record
CREATE OR REPLACE FUNCTION purge_orphaned_github_account()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.github_account_id IS NOT NULL THEN
        DELETE FROM github_accounts WHERE id = OLD.github_account_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_user_github_account ON users;
CREATE TRIGGER trg_delete_user_github_account
AFTER DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION purge_orphaned_github_account();
```

### Rollback 004 (`migrations/004_account_cleanup_trigger.down.sql`)
```sql
DROP TRIGGER IF EXISTS trg_delete_user_github_account ON users;
DROP FUNCTION IF EXISTS purge_orphaned_github_account();
```

---

## 9. Verification Summary

| Gate | Execution Command | Result |
|---|---|---|
| **Unit Tests** | `npm test` | **75/75 passing across 14 suites** |
| **Integration Tests (PostgreSQL 16.15)** | `npm run test:integration` | **40/40 passing across 4 suites** |
| **ESLint Quality Gate** | `npm run lint` | **0 errors, 0 warnings** |
| **Production Build (Turbopack)** | `npm run build` | **8 dynamic routes compiled successfully** |
