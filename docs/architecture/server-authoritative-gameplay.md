# Server-Authoritative Gameplay Architecture & Specifications

**Project:** GitHub Profile Pet  
**Milestone:** Sprint 2.2 — Server-Authoritative Gameplay  
**Status:** Approved & Verified Against PostgreSQL 16+

---

## 1. Domain Separation & Architectural Principles

Sprint 2.2 transfers game-loop authority entirely from the client browser to the server. The client serves purely as an input dispatcher and presentation layer, while the server enforces all business rules, validates pre-conditions, calculates rewards and diminishing returns, manages concurrency, and commits state atomically to PostgreSQL.

```
       Browser Client                    Next.js API Route                   PostgreSQL 16+
+--------------------------+         +-----------------------+         +--------------------------+
|  User clicks "Train"     |         | POST /api/pet/action  |         |                          |
|  Generates UUID v4       | ------> | Resolve Session Auth  |         |                          |
|  clientActionId          |         | Validate Action & ID  |         |                          |
+--------------------------+         +-----------+-----------+         |                          |
                                                 | withTransaction     |                          |
                                                 v                     |                          |
                                     +-----------------------+         |                          |
                                     | Check Idempotency     | ------> | care_action_idempotency  |
                                     | (Return retry if hit) |         | (FOR UPDATE)             |
                                     +-----------+-----------+         +--------------------------+
                                                 | Cache miss                                     |
                                                 v                                                |
                                     +-----------------------+         +--------------------------+
                                     | Lock Pet State        | ------> | pet_states (FOR UPDATE)  |
                                     +-----------+-----------+         +--------------------------+
                                                 |                                                |
                                                 v                                                |
                                     +-----------------------+                                    |
                                     | 1. Check 800ms Cooldown                                    |
                                     | 2. Check Pre-conditions                                    |
                                     | 3. Query 60s Window   | ------> | care_action_idempotency  |
                                     | 4. Compute Reward     |                                    |
                                     | 5. Advance Level/XP   |                                    |
                                     | 6. Update Vitals      |                                    |
                                     +-----------+-----------+                                    |
                                                 |                                                |
                                                 v                                                |
                                     +-----------------------+         +--------------------------+
                                     | Update pet_states     | ------> | pet_states               |
                                     | Append Ledger Entry   | ------> | activity_reward_ledger   |
                                     | Save Idempotency +    | ------> | care_action_idempotency  |
                                     |   response_payload    |         | (COMMIT TRANSACTION)     |
                                     +-----------+-----------+         +--------------------------+
                                                 |
<------------------------------------------------+
  HTTP 200 Success Payload
  (or 429 Cooldown / 422 Precondition / 400 Validation)
```

---

## 2. HTTP API Contract (`POST /api/pet/action`)

### 2.1 Route & Headers
- **Endpoint:** `POST /api/pet/action`
- **Content-Type:** `application/json`
- **Authentication Context:**
  - Resolved server-side via `resolveSessionContext(req)`.
  - Production: Authenticated session cookie or Bearer token.
  - Test / Dev Sandbox: Isolated test trainer handle passed via `x-test-trainer-handle` or `x-test-user-id`.
  - **Security Rule:** Client-supplied user IDs in request bodies are strictly ignored and rejected.

### 2.2 Request Payload
```json
{
  "action": "train",
  "clientActionId": "b18b6fc7-1111-4444-8888-abcdef123456"
}
```

| Field | Type | Constraints | Description |
|---|---|---|---|
| `action` | String | Must be `'train'`, `'feed'`, `'rest'`, or `'pet'` | The intended pet care action. |
| `clientActionId` | String | Non-empty, max 64 chars, ASCII/UUID | Client-generated idempotent operation key. |

### 2.3 Response Payloads & Status Codes

#### `200 OK` — Success (or Idempotent Replay)
```json
{
  "success": true,
  "isRetry": false,
  "action": "train",
  "clientActionId": "b18b6fc7-1111-4444-8888-abcdef123456",
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
  "reward": {
    "expGained": 30,
    "energyCost": 18,
    "hungerGained": 0,
    "happinessGained": 0,
    "multiplier": 1.0,
    "percentageDisplay": 100,
    "consecutiveCount": 1
  },
  "didLevelUp": false,
  "levelsGained": 0,
  "reaction": "Shadow Claw strikes the training dummy with feline focus!"
}
```
*Note:* On an idempotent retry with the same `clientActionId`, the server returns HTTP 200 with identical fields, but with `"isRetry": true`.

#### `429 Too Many Requests` — Action Cooldown Rejection
Returned when an action is executed within the 800ms debounce cooldown from the previous care action.
```json
{
  "success": false,
  "isRetry": false,
  "action": "train",
  "clientActionId": "rapid-click-id-2",
  "rejectedReason": "Action Cooldown: Please wait 0.6s before next action.",
  "reaction": "Paws are busy — catch your breath!",
  "cooldownRemainingMs": 600,
  "currentPet": { ... }
}
```

#### `422 Unprocessable Entity` — Pre-Condition Failure
Returned when pet vitals violate action pre-conditions (e.g. Energy < 18 for Training, Hunger = 100 for Feeding).
```json
{
  "success": false,
  "isRetry": false,
  "action": "train",
  "clientActionId": "exhausted-train-id",
  "rejectedReason": "Insufficient Energy: Pet requires 18 energy to train, but only has 10.",
  "reaction": "Shadow Claw curls into a resting ball, too exhausted to practice leaps.",
  "currentPet": { ... }
}
```

#### `400 Bad Request` — Validation Error
Returned when the body payload fails structural validation (missing action, unsupported action, missing `clientActionId`, or `clientActionId` > 64 chars).
```json
{
  "error": "Missing or invalid clientActionId (must be 1-64 characters)."
}
```

#### `401 Unauthorized` — Authentication Missing
Returned when the session resolver cannot find an authenticated user identity.
```json
{
  "error": "Authentication required to interact with your pet."
}
```

---

## 3. Concurrency Control & Row-Level Locking

Care actions modify mutable state across multiple tables (`pet_states`, `care_action_idempotency`, `activity_reward_ledger`). To prevent race conditions, lost updates, or double-awards:

1. **Transaction Scope:** Every action runs within a managed database transaction (`withTransaction`).
2. **Pessimistic Locking:**
   ```sql
   SELECT * FROM care_action_idempotency
   WHERE user_id = $1 AND client_action_id = $2
   FOR UPDATE;
   ```
   Followed immediately by:
   ```sql
   SELECT * FROM pet_states
   WHERE user_id = $1
   FOR UPDATE;
   ```
3. **Serialization:** Concurrent actions on the same pet are locked and serialized at the database row level. If two distinct actions arrive simultaneously (e.g., `train` and `feed`), transaction B waits until transaction A commits, observing transaction A's updated vitals, XP, and action timestamps.
4. **User Isolation:** All queries bind `user_id = $1`. Actions by User A can never lock, read, or mutate User B's pet.

---

## 4. Idempotency & Exact Replay Guarantee

### 4.1 Schema Enhancement (Migration 002)
To provide exact payload replays on network retries without re-evaluating calculations or re-applying mutations:
```sql
ALTER TABLE care_action_idempotency
ADD COLUMN response_payload JSONB;
```

### 4.2 Replay Lifecycle
1. When an action executes successfully, the server creates the `responsePayload` object containing the final vitals, calculated rewards, level-up details, and species reaction.
2. The server inserts this payload into `care_action_idempotency.response_payload` within the same atomic transaction.
3. If a client retries the action (e.g. timeout or flaky mobile connection) using the same `clientActionId`, the server finds the existing row and returns the stored payload with `"isRetry": true`.
4. No double XP, no double energy deductions, and no double ledger entries are generated.

---

## 5. Authoritative Rules & Balance Mechanics

| Rule Category | Authoritative Logic | Enforcement Layer |
|---|---|---|
| **Training Energy Cost** | Deducts strictly **18 Energy**. Fails with HTTP 422 if `energy < 18`. | Server (`GameplayService.handleAction`) |
| **Feeding Satiety Cap** | Fails with HTTP 422 if `hunger >= 100`. | Server (`GameplayService.handleAction`) |
| **Action Cooldown** | **800ms debounce** across all care actions. Fails with HTTP 429 if `elapsedMs < 800`. | Server (`care_action_idempotency.executed_at`) |
| **Diminishing Returns** | Rolling **60-second window** per action type:<br>1st = 100%, 2nd = 60%, 3rd = 35%, 4th = 20%, 5th+ = 10%. Actions > 60s expire automatically. | Server (`care_action_idempotency` history query) |
| **Rest Action** | Grants strictly **0 XP** and restores **+25 Energy** (clamped to 100). | Server (`applyRestAction`) |
| **Progression Formula** | $MaxXP(L) = L \times 100$. Cumulative: $TotalXP(L) = 50 \times L \times (L - 1)$. | Server (`progression.ts`) |
| **Evolution Milestones** | *[SUPERSEDED SPRINT 2.5 PROPOSAL]*<br>Initial planning proposal: Hatchling 1–9, Juvenile 10–24, Ascendant 25–49, Mythic 50+.<br>**Authoritative Phase 1 / Phase 2 Baseline (Phase 2.0.1 Confirmed):**<br>• Hatchling: Levels 1–4<br>• Juvenile: Levels 5–9<br>• Ascended: Levels 10–19<br>• Celestial: Level 20+ | Production Engine (`progressionEngine.ts` / `deriveEvolutionStage`) |
| **Vitals Bounds** | Energy, Hunger, Happiness are clamped to $[0, 100]$. | Server & DB (`CHECK` constraints) |
| **No-Pet-Death** | Energy and hunger have non-zero safety floors; no action or neglect causes pet death. | Architecture Guarantee |

---

## 6. Migration 002 Documentation & Rollback

- **Up Migration:** `migrations/002_care_action_payload.sql`
  ```sql
  ALTER TABLE care_action_idempotency
  ADD COLUMN IF NOT EXISTS response_payload JSONB;
  ```
- **Down Migration:** `migrations/002_care_action_payload.down.sql`
  ```sql
  ALTER TABLE care_action_idempotency
  DROP COLUMN IF EXISTS response_payload;
  ```

---

## 7. Verification Evidence & Quality Assurance

- **Unit Test Suite (`tests/unit/*.test.ts`):** **46/46 tests passing across 9 suites**.
- **PostgreSQL 16+ Integration Test Suite (`tests/integration/*.test.ts`):** **23/23 tests passing across 2 suites** on PostgreSQL 16.15:
  - `postgresIntegration.test.ts`: 12 tests (Schema, constraints, migrations, account cascade, sync concurrency, ledger idempotency).
  - `serverAuthoritativeGameplay.test.ts`: 11 tests (Migration 002, care actions, pre-conditions, 800ms cooldown, 60s diminishing returns, level progression, evolution boundaries, idempotency, concurrent distinct serialization, ownership isolation, HTTP API route).
- **ESLint & TypeScript Compilation:** Strict type-checking and clean lint execution.
