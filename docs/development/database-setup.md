# Database Setup & Local PostgreSQL Environment
## GitHub Profile Pet Platform

**Target Database:** PostgreSQL 16+  
**Connection Driver:** `pg` (node-postgres) with bounded pooling  
**Default Local Port:** `5432`  

---

## 1. Environment Variables Configuration

The database layer reads configuration strictly from environment variables. Copy `.env.example` to `.env.local` for local development.

| Environment Variable | Required | Default Value | Description |
| :--- | :---: | :---: | :--- |
| `DATABASE_URL` | **Yes** | `postgresql://test_user:test_password@localhost:5432/github_profile_pet_test` | PostgreSQL connection string. |
| `DATABASE_MAX_CONNECTIONS` | No | `10` | Maximum connection pool size (clamped to $[1, 10]$). |
| `DATABASE_IDLE_TIMEOUT_MS` | No | `30000` | Milliseconds before an idle client is closed (30s). |
| `DATABASE_CONNECT_TIMEOUT_MS` | No | `5000` | Milliseconds before a connection attempt times out (5s). |
| `DATABASE_SSL` | No | `false` | Explicit SSL flag (`true`/`false`). Enforced automatically in `production`. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | No | `true` | When SSL is active, whether to reject invalid certificates. |

> [!CAUTION]
> **Zero Credential Logging Policy:** The database pool and error wrapper automatically redact passwords from connection strings (`maskConnectionString`). Never log raw connection strings or secrets.

---

## 2. Local Environment Setup via Docker Compose

A reproducible PostgreSQL 16+ development container is defined in `docker-compose.yml`.

### 2.1 Starting the Database Container (PowerShell)

```powershell
# 1. Start PostgreSQL 16 Alpine container in the background
docker compose up -d

# 2. Verify container status and healthcheck
docker compose ps
```

Container configuration:
- **Image:** `postgres:16-alpine`
- **Host Port:** `5432`
- **User:** `test_user`
- **Password:** `test_password`
- **Database:** `github_profile_pet_test`
- **Healthcheck:** `pg_isready -U test_user -d github_profile_pet_test`

### 2.2 Stopping the Database Container

```powershell
# Stop container without deleting volume data
docker compose stop

# Stop and remove container
docker compose down
```

---

## 3. Alternative: Native PostgreSQL Installation

If running PostgreSQL directly on Windows without Docker:

1. Ensure PostgreSQL 16+ is installed and listening on `localhost:5432`.
2. Connect with `psql` and create the development/test database:
   ```sql
   CREATE USER test_user WITH PASSWORD 'test_password';
   CREATE DATABASE github_profile_pet_test OWNER test_user;
   GRANT ALL PRIVILEGES ON DATABASE github_profile_pet_test TO test_user;
   ```
3. Set `DATABASE_URL` in your `.env.local`:
   ```bash
   DATABASE_URL="postgresql://test_user:test_password@localhost:5432/github_profile_pet_test"
   ```

---

## 4. Verifying Connectivity & Running Migrations

Once your PostgreSQL database is running, apply the database schema:

```powershell
# Run pending migrations
npm run migrate

# Verify with the integration test suite
npm run test:integration
```

If no database is reachable, `npm run test:integration` cleanly reports all integration tests as `SKIPPED`, preserving build and CI predictability without false positives.
