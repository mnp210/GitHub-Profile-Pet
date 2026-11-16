# Database Migrations Guide
## GitHub Profile Pet Platform

**Migration Engine:** Custom deterministic migration runner (`src/lib/db/migrator.ts`)  
**Tracking Table:** `schema_migrations`  
**Migrations Directory:** `migrations/`  

---

## 1. Architecture & Deterministic Execution

The migration engine guarantees that database mutations occur strictly on-demand, deterministically, and idempotently:

1. **Explicit Execution Requirement:** Application startup **never** silently mutates or applies schema migrations. Migrations must be run explicitly via deployment scripts or CLI commands.
2. **Deterministic Sequence:** Files in `migrations/` are scanned and sorted alphabetically (e.g. `001_initial_schema.sql`, `002_*.sql`).
3. **Idempotency Tracking:** Applied migrations are recorded in `schema_migrations`:
   ```sql
   CREATE TABLE IF NOT EXISTS schema_migrations (
     id SERIAL PRIMARY KEY,
     name VARCHAR(255) NOT NULL UNIQUE,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```
4. **Atomic Transaction Scope:** Each migration file and its insertion into `schema_migrations` execute inside an atomic transaction (`withTransaction`). If a migration fails mid-way, the entire file rolls back cleanly.

---

## 2. CLI Commands (PowerShell)

### 2.1 Applying Pending Migrations (Up)

```powershell
# Applies all unapplied migrations in ascending order
npm run migrate
```

Sample output:
```text
[Database Migration] Executing command: up
[Database Migration] Migrations applied (1): [ '001_initial_schema.sql' ]
```

When already up to date:
```text
[Database Migration] Executing command: up
[Database Migration] Migrations applied (0): []
[Database Migration] Already up to date (1): [ '001_initial_schema.sql' ]
```

### 2.2 Rolling Back the Latest Migration (Down)

```powershell
# Reverts the most recently applied migration using its corresponding .down.sql script
npm run migrate:down
```

Sample output:
```text
[Database Migration] Executing command: down
[Database Migration] Successfully rolled back: 001_initial_schema.sql
```

---

## 3. Creating New Migrations

When schema changes are approved for future sprints:

1. Create a sequential `.sql` file in `migrations/`:
   `migrations/002_<feature_description>.sql`
2. Create the exact corresponding `.down.sql` rollback file:
   `migrations/002_<feature_description>.down.sql`
3. Adhere to Sprint 2.1 design rules:
   - Use PostgreSQL 16+ native features (e.g. `gen_random_uuid()` without `pgcrypto`).
   - Use composite uniqueness instead of global unique constraints where data belongs to a user (e.g. `UNIQUE (user_id, client_action_id)`).
   - Avoid creating redundant indexes where a `UNIQUE` constraint already generates a B-Tree index.
   - Use explicit `ON DELETE CASCADE` where child entities depend on parent lifespan.
