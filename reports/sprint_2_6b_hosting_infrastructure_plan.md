# Sprint 2.6B — Hosting Architecture & Zero-Cost Infrastructure Plan (Final Corrected Closure)

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Date:** November 15, 2026 (Updated per Sprint 2.6B.5 Review)  
**Mode:** PLANNING, ZERO-COST POLICY & PRE-PROVISIONING  
**Status:** **COMPLETE**  
**Final Verdict:** **CONDITIONALLY READY FOR FREE STAGING PROVISIONING**

---

## 1. Executive Summary & Permanent Zero-Cost Product Financial Policy

This blueprint defines the authoritative zero-cost hosting and database architecture for GitHub Profile Pet. Following the completion of the Sprint 2.5 background contribution sync coordinator, Sprint 2.5E scheduled execution workflow, and Sprint 2.6A deployment audits, this document establishes provider evaluations, compatibility verifications, resource budgets, and operational rules required to operate the application at **₹0 recurring monthly operating cost** without compromising coordinator correctness or data integrity.

### 1.1 Non-Negotiable Product Financial Policy

GitHub Profile Pet is designed and operated as a **completely free project**. This is a non-negotiable architectural and product constraint, not a temporary preference.

#### User-Facing Financial Invariants
Every developer must be able to access the complete core product experience without payment:
- GitHub OAuth sign-in and session management.
- Pet adoption, naming, and cosmetic customization.
- Daily gameplay loops (feeding, training, resting, mood and vitals stabilization).
- XP progression, level milestones, achievements, and species evolutions.
- Public pet profile pages.
- README dynamic SVG embed widgets.
- Automated GitHub activity synchronization and contribution streak calculations.
- All core and future gameplay mechanics.

The product strictly prohibits:
- Paid subscriptions, memberships, or premium passes.
- Paywalled or feature-gated content.
- Third-party advertising networks, affiliate banners, or commercial tracking.
- Mandatory donations or pay-to-progress dynamics.
- Requiring users to provide their own paid third-party API keys for standard operation.
- Inactivity fees, profile deletion fees, or any charge to keep pets alive.

#### Project-Owner Financial Invariants
The project targets an ongoing operating cost of **₹0 / month ($0.00 / month)**.

All infrastructure choices prioritize zero-cost providers in this order:
1. Generous free-tier application hosting (e.g. Vercel Hobby for personal/non-commercial open source).
2. Free-tier managed PostgreSQL (e.g. Neon Free with scale-to-zero compute).
3. Free-tier scheduled execution within published allowances (e.g. GitHub Actions).
4. Permissive open-source libraries and runtime frameworks.
5. Existing local development workstations for testing, migrations, and builds.
6. Highly optimized resource consumption with minimal idle footprint.
7. Avoiding unnecessary third-party paid microservices.

**Zero Silent Upgrades:** No paid plan, automatic subscription, or billable cloud resource may ever be activated without the project owner's explicit written approval.

**Free Limit Escalation Hierarchy:** If any free provider threshold (compute hours, storage, bandwidth, or runner minutes) is approached or exceeded, the engineering response sequence is mandatory:
1. *Measure:* Accurately profile and measure actual system and database resource consumption.
2. *Optimize:* Tune application memory, connection pool sizes, query performance, and caching.
3. *Prune:* Reduce unnecessary background work or redundant poll intervals while strictly preserving data correctness.
4. *Evaluate:* Investigate alternative compatible free providers (e.g. Cloudflare Pages, Netlify, Supabase).
5. *Self-Host:* Consider self-hosted or containerized alternatives where practical.
6. *Throttle:* Pause or limit non-essential operations if no sustainable zero-cost solution exists. Under no circumstances may infrastructure costs be shifted to users or silently charged to paid cards.

### 1.2 Core Architectural Decisions
1. **Primary Hosting Candidate:** **Vercel Hobby (Next.js 16 App Router) + Neon PostgreSQL 16 (Free Tier Direct Connection) + GitHub Actions (6-hour Sync Scheduler)**.
   - Enforces a **Direct Connection String** (`ep-xyz.region.aws.neon.tech:5432` without `-pooler`) to guarantee session-level advisory locks (`pg_try_advisory_lock`), dedicated worker client connections, and stable backend process tracking (`pg_backend_pid()`, `pg_stat_activity`).
   - Neon Free compute scales to zero after 5 minutes of inactivity, keeping monthly compute consumption strictly within the 100 CU-hour free allowance per project.
   - Database network transfer is managed strictly within the **5 GB public network transfer allowance per project/month**.
   - GitHub Actions provides a decoupled, resilient cron trigger running every 6 hours (`0 */6 * * *`), operating completely free on public repositories or consuming only ~6%–12% of the 2,000 minute private allowance.
2. **Approved Operating Budget:** **₹0 / month ($0.00 / month)**.
   - Initial Staging / Development: **$0.00 / month** (within separate Neon Free project).
   - Low-Traffic Production Baseline: **$0.00 / month** (within separate Neon Free project, scale-to-zero enabled, network transfer <5 GB).
   - Paid Launch/Pro references are retained strictly as external unit benchmarks, **never as an approved operating budget**.
3. **Public Product Integrity:** The public SVG embed endpoint (`/api/pet/[id]/embed` or `/api/pet/embed`) is an explicit architectural requirement. Its implementation in the codebase is a mandatory release prerequisite for README embedding; no placeholder or preview URL substitutes for this live contract.
4. **Boundary Compliance:** No cloud infrastructure, paid subscriptions, GitHub Apps, or production secrets were created or provisioned during this sprint.

---

## 2. Hosting & PostgreSQL Provider Comparison

*Data verified against live official provider documentation as of November 15, 2026.*

### 2.1 Application Hosting Providers

| Evaluation Criteria | Vercel | Render | Railway | Cloudflare Pages + Workers | Netlify |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Free Tier Availability** | **Hobby:** $0/mo perpetual (**personal / non-commercial use**). | **Free:** $0/mo web service with 750 instance-hours/mo. | **Trial Only:** 30-day $5 credit; no permanent free tier. | **Free:** 100k worker requests/day; unlimited static requests. | **Credit-based Free:** **300 credits/mo** ($0/mo, hard limit). |
| **Cold Starts & Idle Sleep** | **Fluid Compute:** Fast warm start (~100–300ms). Never sleeps. | **Severe:** **Spins down after 15 min idle**; 30–60s cold start. | **None:** Containers run until credit exhausted ($5/mo min). | **Zero Cold Start:** V8 isolates start in <5ms. | **Fast:** Fast serverless function invocation (~200ms). |
| **Next.js App Router Support** | **Native / Best-in-Class:** Creator of Next.js; full Turbopack & SSR. | Standard Docker / Node buildpack (`next start`). | Automatic Nixpacks container build (`next start`). | OpenNext adapter required; edge runtime limitations. | Next.js runtime plugin with automatic SSR adapter. |
| **Execution Limits** | Up to 300s function duration; 120s gateway timeout. | Continuous (Web service). | Continuous (Container). | Free: 10ms CPU time; 128 MB RAM; 50 subrequests. | Credit-metered build minutes and function invocations. |
| **Rollback Capability** | **Instant 1-Click Rollback** to immutable deployment URLs. | Manual re-deploy of prior commit. | Fast rollback to prior deployment image. | Instant rollback to prior deployment. | Instant rollback to prior deploy. |
| **Built-in Schedulers** | Hobby: Max 2 crons, **limited to 1x/day**. | Cron Jobs start at $3/mo; no free cron. | Cron jobs bill per usage second. | Cron Triggers included free on Workers. | Scheduled functions (beta) or external trigger. |
| **Commercial Terms** | Strictly personal / non-commercial. Commercial requires Pro ($20/mo). | Paid plans start at $7/mo. | Hobby base fee starts at $5/mo. | Generous free tier for commercial and personal. | Free tier permits personal & non-commercial use. |
| **Suitability for Project** | **HIGH (PENDING VERIFICATION)** (paired with GitHub Actions). | **LOW** (15-min spin-down creates severe UX latency). | **UNSUITABLE ON FREE** (No permanent free tier). | **UNVERIFIED / UNPROVEN** (TCP socket & advisory lock proxy risks). | **UNVERIFIED / HIGH RISK** (300 credits exhausted by ~20 deploys). |

#### 2.1.1 Vercel Hobby Terms & Eligibility Classification
*Official References: https://vercel.com/legal/terms and https://vercel.com/pricing*

To ensure full compliance with hosting provider agreements, three distinct dimensions must be clearly distinguished:
1. **Confirmed Provider Terms:** Vercel's published Terms of Service explicitly stipulate that the free **Hobby plan must only be used for personal or non-commercial projects**. Commercial websites, businesses, monetization, client work, or revenue-generating applications require Vercel Pro ($20/user/month).
2. **Project's Intended Non-Commercial Model:** GitHub Profile Pet operates as a 100% free virtual companion with no subscriptions, no ads, no premium tiers, no paywalls, and no user payments of any kind. It is entirely open source.
3. **Unverified Provider Eligibility Interpretation:** Merely lacking advertisements, subscriptions, or fees does not automatically guarantee that Vercel classifies a multi-user application with user accounts and GitHub OAuth integration as "personal/non-commercial" under its operational enforcement policy. Without an explicit contractual determination or written confirmation from Vercel support/legal, **Vercel Hobby eligibility for this application is formally classified as UNVERIFIED**.
4. **Mandatory Compliance Rule:** Vercel Hobby must **not** be used in violation of its terms.
5. **Zero-Cost Mandate:** Under no circumstances is Vercel Pro ($20/month) or any paid hosting service authorized.

---

#### 2.1.2 Cloudflare Workers Free Alternative Reassessment
*Official References: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/workers/platform/pricing/*

Cloudflare Workers provides a generous free tier (100,000 requests/day), but imposes platform constraints that present severe architectural incompatibilities with GitHub Profile Pet:
- **Free Platform Constraints:**
  - **10 ms CPU time per invocation** (wall-clock time is higher, but active JS execution is capped at 10 ms).
  - **128 MB memory limit**.
  - **50 subrequests per request**.
  - **6 simultaneous outgoing connections per request**.
- **PostgreSQL Connectivity & Session Semantics Incompatibility:**
  - Cloudflare Workers run on V8 isolates without native Node.js TCP socket primitives (`net.Socket`).
  - Connecting to PostgreSQL requires either Cloudflare's `connect()` socket API or Cloudflare Hyperdrive.
  - **Hyperdrive Proxy Hazard:** Hyperdrive is a connection pooling and query acceleration engine. Connection poolers multiplex transactions across shared backend connections. **This breaks session-level advisory locks (`pg_try_advisory_lock(982347102)`), dedicated client checkouts, and stable backend process tracking (`pg_backend_pid()`, `pg_stat_activity`)!**
- **10 ms CPU Boundary Risk:** Cryptographic operations (AES-256-GCM token decryption/encryption, constant-time bearer token comparisons, session hashing) and parsing large GitHub contribution calendars under traffic spikes risk tripping the strict 10 ms CPU execution ceiling.
- **Next.js App Router Compatibility:** Running Next.js 16.4.6 with Turbopack and React 19 Server Components on Cloudflare requires the OpenNext adapter, which involves non-trivial translation layers and edge polyfills.
- **Suitability Classification:** Formally classified as **UNVERIFIED / UNPROVEN** for direct session PostgreSQL coordinator workloads. It cannot be considered a verified drop-in replacement without extensive architectural testing.

---

#### 2.1.3 Netlify Credit-Based Model Reassessment
*Official References: https://www.netlify.com/pricing/ and https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/*

Netlify has replaced its legacy fixed bandwidth/build-minute allowances with a unified **Credit-Based Pricing Model**:
- **Free Plan Allowance:** **300 credits per month** at $0/month.
- **Credit Consumption Rates:**
  - **Production Deploys:** Consumes **15 credits per production deploy**. *(Branch/preview deploys are 0 credits).*
  - **Bandwidth:** Consumes credits based on metered egress.
  - **Serverless Compute:** Functions consume credits based on execution count and duration.
- **Hard Limit Enforcement:** Netlify enforces a strict hard limit on the Free tier. Once the 300 credits are exhausted, all sites on the account are **suspended immediately** until the credits refresh at the start of the next billing cycle.
- **No Auto-Recharge on Free:** Free accounts do not support purchasing credit add-ons or enabling auto-recharge.
- **Deployment Churn Risk:** A team running active CI/CD that performs **20 production deploys in a month exhausts all 300 credits solely on deployments**, leaving 0 credits for bandwidth and compute functions!
- **Suitability Classification:** Formally classified as **UNVERIFIED / HIGH RISK**. Netlify cannot be treated as a reliable zero-cost fallback for an active Next.js application without strict deployment throttling.

---

### 2.2 Managed PostgreSQL Providers & Neon Limits

*Official Reference: https://neon.com/pricing (Verified Nov 15, 2026)*

| Evaluation Criteria | Neon PostgreSQL | Render PostgreSQL | Railway PostgreSQL | Supabase |
| :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL Version** | Native PostgreSQL 16+. | Native PostgreSQL 16+. | Native PostgreSQL 16+. | Native PostgreSQL 15/16. |
| **Free Tier Specs** *(Verified Nov 15, 2026)* | **Free ($0/mo):** **100 CU-hours/project/mo**, **1 GB storage/project**, **5 GB public network transfer/project/mo**, up to 100 projects, **up to 20 GB total storage across projects**, up to 10 branches/project, instant restore up to 6 hours or 1 GB data changes, autoscaling to 2 CU, scale-to-zero after 5 min idle. | **Free ($0/mo):** **EXPIRES AFTER 30 DAYS**. | **None:** 30-day $5 credit; burns quickly ($3–$5/mo continuous RAM). | **Free ($0/mo):** 2 free projects, 500 MB database, pauses after 1 week inactivity. |
| **Launch Paid Reference** | Compute: $0.106/CU-hr. Storage: $0.35/GB-mo. **500 GB network transfer included**, then $0.10/GB. PITR: $0.20/GB-mo. | Paid plans start at $7/mo. | Paid Hobby plan starts at $5/mo. | Pro plan starts at $25/mo. |
| **Direct Connections** | **YES** (**112 max connections** on 0.25 CU, 7 reserved for superusers -> **105 usable**). | **YES** (Standard native connection). | **YES** (Standard native connection). | **YES** (Direct port 5432 or connection pooler). |
| **Advisory Lock Support** | **YES** on Direct Connection (prohibited on `-pooler`). | **YES**. | **YES**. | **YES** on direct connection (port 5432). |
| **Backend PID & `pg_stat_activity`** | **YES** on Direct Connection. | **YES**. | **YES**. | **YES** on direct connection. |
| **Compute Execution Model** | **Free:** Scales to zero after 5 min idle (~500ms–1.5s wake).<br>**Launch:** Consumption-based ($0.106/CU-hr); scale-to-zero configurable. | Does not sleep, but expires in 30 days on Free. | Always-on container; billed continuously. | Always-on, but pauses project after 7 days without API requests. |
| **Backup & PITR** | Free: Instant restore up to 6 hours or 1 GB data changes. Launch: Usage-based PITR ($0.20/GB-mo history). | Free: None. Paid ($7): Daily snapshots. | Volume snapshots via Railway dashboard. | Free: Daily backups (7-day retention). |
| **Suitability for Project** | **HIGH** (Direct connection meets all coordinator rules at $0). | **UNUSABLE ON FREE** (30-day deletion kills persistent data). | **UNSUITABLE ON FREE** (No permanent free tier). | **MEDIUM-HIGH** (Viable zero-cost fallback, but 500 MB limit). |

---

### 2.3 Neon Free-Tier Suspension & Availability Risks

Neon Free provides an excellent functional platform for development and low-traffic operation, but enforces hard resource limits that introduce operational availability risks:

1. **Compute Exhaustion Behavior (100 CU-Hours Limit):**
   - If total active compute time across the billing month reaches 100 CU-hours, Neon **suspends the project's compute endpoints**.
   - The database remains suspended and inaccessible until the quota refreshes at the beginning of the next monthly billing cycle.
2. **Network Transfer Exhaustion Behavior (5 GB Limit):**
   - If total egress/ingress data transfer over the direct endpoint reaches **5 GB in a billing month**, Neon **throttles or blocks external connections** to the database.
   - The database cannot be queried from external serverless functions until the quota resets.
3. **Monthly Reset Implications & Downtime:**
   - Quotas reset on the **1st day of each calendar billing month**.
   - If an unexpected traffic spike or scraping event exhausts compute or transfer on the 20th of the month, the application experiences **10–11 consecutive days of complete database downtime** unless optimization is applied.
4. **User-Facing Consequences:**
   - Web visitors encounter `500 Internal Server Error` pages on all database-backed routes.
   - Database connection pools throw `ETIMEDOUT` or `ECONNREFUSED`.
   - GitHub OAuth sign-in fails closed.
   - Scheduled background sync workflows fail and log 500 responses.
   - README SVG embed requests fail or return fallback offline images.
5. **No Production SLA:**
   - Neon Free provides **zero service-level agreement (0% SLA)**. It is explicitly designed for prototypes and personal projects.
6. **Monitoring & Alerting Requirements:**
   - Operators must monitor Neon console usage dashboards weekly.
   - Free account email usage alerts (typically sent at 80% and 100% of quota) must be directed to active project maintainers.
7. **Strict Escalation Policy (No Silent Upgrades):**
   - Under no circumstances will the database be silently upgraded to Launch ($0.106/CU-hr) when limits are approached.
   - If limits are reached, the application will pause non-essential sync operations or wait for the monthly quota reset while maintainers optimize query payloads.

---

## 3. Mandatory PostgreSQL Compatibility Assessment

The application uses a unified `DATABASE_URL` resolved via `src/lib/db/config.ts` and managed by `src/lib/db/pool.ts`.

### 3.1 Strict Coordinator Persistence Invariants
The production database must satisfy the five invariants established in Sprint 2.5A.1–2.5A.7:
1. **Session-Level Advisory Lock:** The coordinator checks out a dedicated client (`advClient`) and executes `SELECT pg_try_advisory_lock(982347102)`. This lock must persist for the entire batch duration (up to 45 seconds).
2. **Dedicated Worker Checkout:** Worker threads check out dedicated clients (`workerClient = await pool.connect()`) for each account sync, maintaining the same connection for attempt logging (Tx 0) and commit dispatch (Tx 1).
3. **Stable Backend PID & Start Time:** The worker reads `pg_backend_pid()` and `backend_start` from `pg_stat_activity`. The physical PostgreSQL backend process must remain constant between statement dispatches.
4. **Transaction-Mode Pooler Prohibition:** **PgBouncer in transaction pooling mode (or Neon's `-pooler` hostname) is strictly prohibited.** Transaction poolers multiplex queries across random backend processes, breaking session locks and causing `pg_backend_pid()` to shift between statements.
5. **Role Visibility in `pg_stat_activity`:** Because coordinator workers and recovery queries authenticate using the **same database user role** specified in `DATABASE_URL`, PostgreSQL permits the role to view its own sessions in `pg_stat_activity` by default. Rather than applying a blanket grant of `pg_read_all_stats`, an empirical permission test must be executed during staging using the intended production database role. Additional privileges should be granted only if necessary with a documented least-privilege justification. Fail-closed recovery is preserved: if backend identity cannot be verified, the coordinator marks attempts as `'unknown'` and defers without premature rollback.

### 3.2 Neon Free Database Scale-to-Zero & Cold-Start Compatibility
- **Scale-to-Zero Behavior:** On Neon Free, compute automatically suspends after 5 minutes of zero active connections.
- **Wake-Up Latency:** Resuming from suspension requires **~500ms to 1.5 seconds**.
- **Impact on Scheduled Coordinator:** The GitHub Actions workflow invokes the sync endpoint via `curl` with a 60-second HTTP timeout (`--max-time 60`). The 1.5s database wake-up latency is effortlessly absorbed without triggering timeouts or retry failures.
- **Impact on Web Dashboard Users:** The first user visit after an idle period experiences a ~1-second initial page load delay while the database awakens. Subsequent requests remain warm and fast. This minor cold-start trade-off is mandatory to guarantee operation within the 100 CU-hour free tier allowance.

### 3.3 Aggregate Connection Modeling vs. Capacity (Illustrative Planning Assumptions)
On a Neon compute instance of 0.25 CU, the documented PostgreSQL `max_connections` is **112**, with **7 connections reserved for superuser/system maintenance**, yielding **105 usable application connections**.

The per-instance pool setting (`DATABASE_MAX_CONNECTIONS = 10` in `src/lib/db/config.ts`) is a **per-process pool ceiling, not a global database connection limit**. In serverless hosting (such as Vercel), the platform instantiates multiple independent function containers under concurrent traffic. Each container initializes its own connection pool:

```text
       ILLUSTRATIVE PLANNING ASSUMPTION: AGGREGATE CONNECTION MODEL (PEAK CONCURRENCY)
┌────────────────────────────────────────────────────────┐
│ Vercel Serverless Function Instances (Web & API)       │
│  - 3 to 6 active concurrent lambdas                    │ ───> 15 to 30 connections
│  - (e.g. 3-5 connections per instance pool)            │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│ Background Contribution Sync Coordinator (Scheduled)   │
│  - 1 dedicated global advisory client (advClient)      │
│  - Up to 3 dedicated worker clients (Tx 0/1)           │ ───> 5 to 6 connections
│  - Ephemeral discovery & unknown-outcome recovery      │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│ Operational / Staging / CI Activity                    │
│  - Staging environment / test branch queries           │ ───> 5 to 10 connections
│  - CI/CD migration runner (`scripts/migrate.ts`)       │
└────────────────────────────────────────────────────────┘
───────────────────────────────────────────────────────────────────────────────────────
ILLUSTRATIVE ESTIMATED AGGREGATE PEAK:                         25 to 46 connections
NEON 0.25 CU USABLE DIRECT CONNECTION LIMIT:                   105 connections (Theoretical Ceiling)
```

**Capacity & Measurement Notice:**  
- The 25–46 connection estimate is an **illustrative planning assumption**, not a verified capacity guarantee.
- Under heavy concurrent spikes, aggregate serverless connections can easily exceed an individual process's pool ceiling.
- The 105 usable connections do **not** represent guaranteed application capacity under every possible workload.
- **Mandatory Operational Action:** Actual aggregate connection usage, connection spikes, and database pool behavior must be empirically measured under load tests during staging before declaring production capacity ready.
- **Mitigation Tuning:** For standard web route lambdas, tune `DATABASE_MAX_CONNECTIONS` to **3–5** per instance, while reserving **5–10** for coordinator and migration contexts.

---

## 4. GitHub Actions Zero-Cost Execution, Expiry Contract & Scheduler Timing

*Official Reference: https://docs.github.com/en/billing/concepts/product-billing/github-actions (Verified Nov 15, 2026)*

The scheduled contribution sync runs via `.github/workflows/scheduled-contribution-sync.yml` on a 6-hour interval (`0 */6 * * *`) and via manual `workflow_dispatch`.

### 4.1 Corrected Job Runtime & Allowance Estimates
To avoid miscalculations, job execution duration must be clearly distinguished from HTTP timeout settings and billing rules:
- **Invocation Frequency:** 4 scheduled runs/day × 30.5 days = **~122 runs/month**.
- **Runtime Component Breakdown:** Total workflow job duration must **not** be equated with the `curl --max-time 60` HTTP timeout. Total job duration comprises:
  1. GitHub Actions runner virtual machine provisioning and initialization.
  2. Repository checkout (`actions/checkout@v4`).
  3. Environment and runner tool setup.
  4. Execution of the sync trigger step (curl command against `/api/internal/sync`).
  5. Response code validation, status evaluation, and `$GITHUB_STEP_SUMMARY` logging.
- **Billing-Minute Rounding Rule:** GitHub Actions rounds execution time up to the nearest whole minute per job. A 40-second job consumes 1 billed minute; a 65-second job consumes 2 billed minutes.
- **Runtime Estimates (Subject to Staging Measurement):**
  - *Typical Job Duration (Estimated):* Under normal conditions, the internal sync coordinator processes batches within 15–30 seconds. With runner overhead (~10–15s), total job duration is **estimated at 25–45 seconds**. Billed as **1 runner minute** per execution.
    $$\text{Typical Monthly Billed Minutes} \approx 122\text{ runs} \times 1\text{ min} = \mathbf{122\text{ runner minutes/month}}$$
  - *Worst-Case Job Duration (Estimated):* In the worst-case scenario where the endpoint hits the 60-second curl timeout (`--max-time 60`), total job duration with workflow setup overhead is **estimated at 75–90 seconds**. Billed as **2 runner minutes** per execution (or 3 minutes in extreme runner queue delays).
    $$\text{Worst-Case Monthly Billed Minutes} \approx 122\text{ runs} \times 2\text{ mins} = \mathbf{244\text{ runner minutes/month}}$$
- **Allowance Assessment:**
  - *Public Repositories:* Standard GitHub-hosted Linux runners are **100% free and completely unlimited**. Scheduled sync execution incurs **$0.00 / ₹0** and does not consume any monthly account minutes.
  - *Private Repositories:* The GitHub Free plan includes **2,000 Linux runner minutes per month**. Estimated consumption of 122–244 minutes represents only **6.1% to 12.2%** of the included free allowance, leaving ~88% of minutes for CI/CD, linting, and automated testing suites.
- **Empirical Requirement:** Because live production metrics do not yet exist, these figures are **estimates**. Staging execution will establish the actual measured empirical job duration and billing metrics.

### 4.2 Authoritative Pending Reward Expiry Contract
The pending contribution reward expiration contract is governed strictly by the approved Sprint 2.3/2.4 accounting engine. (The earlier claim in preliminary reports of an 8-day / 192-hour window was an inaccurate documentation error and is completely revoked).

The actual established contract operates as follows:
1. **48-Hour Boundary Past UTC Midnight:** Pending contribution slices expire at **UTC sync-date midnight plus 48 hours**:
   $$\text{expiry\_at} = (\text{sync\_date}::\text{date} + \text{INTERVAL '48 hours'})$$
2. **Deterministic Expiry Condition:** Slices transition from `'pending'` to `'expired'` via `expireStalePendingSlices()` when:
   $$\text{now} \ge \text{expiry\_at}$$
3. **Canonical Base Anchor:** The expiry calculation is strictly anchored to the **original UTC sync date** of the contribution slice.
4. **Immutability of Expiry Window:** Expiry **must never be extended** by caller-controlled `targetDate` parameters or scheduler delays. Once a slice is created for a given UTC date, its `expiry_at` is fixed and immutable.

### 4.3 Scheduler Frequency Versus Retry Eligibility Timing
The coordinator and scheduler interact across two distinct temporal mechanisms:
1. **Transient Retry Eligibility (`next_sync_eligible_at`):**
   - When an individual account sync fails due to a transient condition (e.g. GitHub API secondary rate limit, temporary network blip), the coordinator stamps:
     $$\text{next\_sync\_eligible\_at} = \text{NOW}() + \text{INTERVAL '15 minutes'}$$
   - This timestamp designates the **earliest moment the account becomes eligible** to be selected in another batch.
2. **Scheduler Execution Cadence:**
   - The GitHub Actions workflow executes on a **fixed 6-hour interval** (`0 */6 * * *`).
   - The scheduler dictates the **next execution opportunity**.
3. **Operational Reality (No Immediate 15-Minute Execution):**
   - A 6-hour scheduled workflow does **not** guarantee execution exactly 15 minutes after a transient failure. An account marked eligible at $T+15\text{m}$ will be processed during the next 6-hour cron tick (or if an operator triggers manual `workflow_dispatch`).
4. **Operational Adequacy Evaluation:**
   - Because pending contribution slices expire at UTC sync-date midnight + 48 hours, a 6-hour cadence provides **up to 8 execution opportunities** within the 48-hour validity window.
   - For a low-traffic production system, this cadence provides ample opportunities to retry and resolve transient failures well before expiry occurs.
   - The existing pending expiry rules remain completely intact.
5. **Zero-Cost Alternatives & Limitations (If Higher Frequency Were Desired):**
   - *2-Hour Cadence (`0 */2 * * *` = 12 runs/day = ~365 runs/month):* Billed at ~365 to 730 runner minutes/month (18.3%–36.5% of private allowance).
   - *1-Hour Cadence (`0 * * * *` = 24 runs/day = ~730 runs/month):* Billed at ~730 to 1,460 runner minutes/month (36.5%–73% of private allowance).
   - *Limitations & Trade-Offs:* Increasing scheduler frequency increases cron invocation churn, burns substantial private runner minutes, and increases exposure to GitHub Actions cron scheduling jitter (which can delay runs during high platform traffic).
   - *Conclusion:* The approved **6-hour cadence is operationally adequate**, safe for reward accounting, and preserves ~88% of private runner minutes for development testing at ₹0.

---

## 5. Recalculated Workloads & Cost Models

### 5.1 Neon Official Pricing Structure (Verified November 15, 2026)
*Reference: https://neon.com/pricing*

Neon operates two primary service models: Free Tier and consumption-based Launch/Scale tiers (with **no fixed monthly minimum fee**):

1. **Free-Tier Allowances:**
   - **Compute:** **100 CU-hours per project/month** included free.
   - **PostgreSQL Storage:** **1 GB per project** included free.
   - **Public Network Transfer (Egress):** **5 GB per project/month** included free. *(Hard limit / throttling applies upon exhaustion).*
   - **Account-Wide Storage Ceiling:** **Up to 20 GB total storage across projects**.
   - **Instant Restore:** Up to **6 hours or 1 GB of data changes**, subject to published plan conditions.
   - **Branches:** Up to 10 branches per project included.
   - **Compute Model:** Autoscaling up to 2 CU; **scales to zero after 5 minutes of inactivity**.
   - *Allocation Scope:* Free-tier compute, storage, and transfer allowances are **per project**. Separate staging and production projects each receive their own independent 100 CU-hour, 1 GB storage, and 5 GB network transfer allocations.
2. **Launch Plan Usage-Based Reference Rates (Subject to Current Verification):**
   - **Compute Consumption:** **$0.106 per CU-hour** (minimum compute is 0.25 CU = **$0.0265 per active hour**).
   - **Storage Charges:** **$0.35 per GB-month** based on total volume.
   - **Data Transfer (Egress):** **First 500 GB/project included free**; **$0.10 per GB** thereafter.
   - **Restore-History Charges:** **$0.20 per GB-month** for WAL changes retained in the selected history window.
   - **Additional Branch Charges:** **$0.002 per branch-hour** beyond the plan allowance.

### 5.2 Workload Compute Calculations
- **Workload A (Staging / Dev):** 0.25 CU for 60 active hours = **15 CU-hours**.
  - Fits within Free allowance: **YES** (consumes 15% of the 100 CU-hour project allowance).
- **Workload B.1 (Low Traffic, Scale-to-Zero Enabled):** 0.25 CU for 240 active hours = **60 CU-hours**.
  - Fits within Free allowance: **YES** (consumes 60% of the 100 CU-hour project allowance).
- **Workload B.2 (Low Traffic, Always-On Compute):** 0.25 CU for 730 hours = **182.5 CU-hours**.
  - Fits within Free allowance: **NO — UNSUPPORTED ON FREE TIER**. Exceeds the 100 CU-hour limit by 82.5 CU-hours.
- **Workload C (Growth Tier):** 0.25 CU baseline for 730 hours (182.5 CU-hours) + 0.25 CU incremental burst for 50 hours (12.5 CU-hours) = **195 CU-hours**; Storage: 5 GB.
  - Fits within Free allowance: **NO — UNSUPPORTED ON FREE TIER**. Exceeds compute limit by 95 CU-hours and storage limit by 4 GB.

---

### 5.3 Granular Database Network Transfer Reassessment (Workload A & B.1)

Database network transfer represents the raw PostgreSQL wire protocol data exchanged over port 5432 between Vercel serverless function instances and the Neon direct endpoint. This must be strictly distinguished from Vercel public CDN egress bandwidth (web assets to end users) and GitHub Actions runner internet traffic.

#### 5.3.1 Database Wire Protocol Traffic Components
1. **Background Contribution Sync Transactions:**
   - Global advisory lock checkout & release: ~2 KB wire payload per run.
   - Candidate discovery query (`SELECT ... FROM users ...`): ~5 KB per run.
   - Per-synced user account:
     - Tx 0 (Attempt logging & lease acquisition): ~4 KB.
     - Tx 1 (Commit logging: slice verification, increment upsert, pet state & receipt write): ~20 KB.
   - For a batch of 5 accounts: $5 \times 24\text{ KB} + 7\text{ KB} \approx 127\text{ KB}$ per sync run.
   - At 4 runs/day: $4 \times 127\text{ KB} = 508\text{ KB/day} \approx \mathbf{\sim15.5\text{ MB/month}}$.
2. **Dashboard & Authenticated Pet Reads:**
   - Loading dashboard or public pet page queries user session, trainer record, pet state, vitals, active streak, and daily contribution flags: ~12 KB wire protocol payload per visit.
   - Assuming 50 Daily Active Users (DAU), each visiting 4–5 times daily:
     $$50\text{ DAU} \times 4.5\text{ visits} \times 12\text{ KB} = 2,700\text{ KB/day} = 2.7\text{ MB/day} \approx \mathbf{\sim82.3\text{ MB/month}}$$
3. **Public Dynamic SVG Embed Reads (README Traffic):**
   - When a user embeds their pet SVG on a GitHub profile README, GitHub's `camo` proxy caches the SVG with `Cache-Control: max-age` (typically 5 to 60 minutes).
   - When Camo revalidates against `/api/pet/[id]/embed`, the route executes queries fetching pet species, mood, level, streak, and recent stats: ~10 KB database wire payload.
   - Assuming 50 active embedded pets, each viewed with Camo cache revalidation occurring ~20–30 times/day:
     $$50\text{ pets} \times 25\text{ cache-miss queries/day} \times 10\text{ KB} = 12.5\text{ MB/day} \approx \mathbf{\sim380\text{ MB/month}}$$
4. **Interactive Gameplay Mutations (Feeding, Training, Resting):**
   - Each gameplay action executes a transaction updating `pets` and reading updated vitals: ~5 KB wire payload.
   - Assuming 50 DAU × 3 actions/day:
     $$150\text{ actions/day} \times 5\text{ KB} = 750\text{ KB/day} = 0.75\text{ MB/day} \approx \mathbf{\sim22.9\text{ MB/month}}$$
5. **Operational, Migrations, CI & Health Checks:**
   - Standalone migrations (`scripts/migrate.ts`) + health check pings (`SELECT 1`): $\mathbf{\sim10\text{ MB/month}}$.

#### 5.3.2 Workload Transfer Assessment Against Neon Free 5 GB Limit

| Assessment Metric | Workload A (Staging / Dev) | Workload B.1 (Production: 100 Users / 50 DAU) |
| :--- | :--- | :--- |
| **Expected Monthly Database Transfer** | **<100 MB / month (<0.10 GB)** | **~510.7 MB / month (~0.51 GB baseline)**<br>*(Estimated range with 2x–3x spike margin: **0.51 GB to 1.53 GB / month**)* |
| **Estimated Peak Daily Transfer** | **<10 MB / day** | **~25 to 50 MB / day** |
| **Measurement Assumptions** | Intermittent testing, 2–5 testers, synthetic seed runs, 60 active hours/month. | 50 DAU, 4 syncs/day, 5 dashboard loads/day, GitHub Camo caching behaving normally (~25 revalidations/pet/day), 150 gameplay actions/day. |
| **Neon Free 5 GB Allowance Utilization** | **<2.0%** of 5 GB allowance consumed. | **10.2% to 30.6%** of 5 GB allowance consumed. |
| **Safety Margin Headroom** | **>4.90 GB remaining** (>98% headroom). | **~3.47 GB to 4.49 GB remaining** (69.4% to 89.8% headroom). |
| **Fits Neon Free 5 GB Limit?** | **YES — VERIFIED COMPATIBLE** | **CONDITIONALLY SUPPORTED — UNVERIFIED PENDING STAGING MEASUREMENT** |

> [!WARNING]
> **Operational Staging Prerequisite:** While the projected baseline for Workload B.1 (~0.51 GB to 1.53 GB) fits comfortably within the 5 GB Free allowance, **it is not yet a measured production metric**. If GitHub's Camo proxy experiences aggressive cache invalidations or if bots aggressively scrape public pet profiles, database egress can escalate. Therefore, Workload B.1 network transfer is formally designated as **CONDITIONALLY SUPPORTED / UNVERIFIED PENDING EMPIRICAL STAGING MEASUREMENT**.

---

### 5.4 Cost Tables

#### Table 1 — Intended Free-Plan Scenarios (Approved Operating Target: ₹0 / $0.00)

*All figures reflect Neon Free allowances: 100 CU-hours compute, 1 GB database storage, and **5 GB public network transfer per project/month**.*

| Scenario / Workload | Compute Allowance & Expected Usage | Storage Allowance & Expected Usage | Restore Allowance | Network Transfer Allowance & Usage *(Neon Direct Endpoint)* | Hosting Tier | Scheduled Execution Allowance | Total Expected Monthly Charge |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **Workload A: Staging & Internal Testing** | 100 CU-hr allowance; **15 CU-hr used** (15%) | 1 GB allowance; **<0.2 GB used** | 6 hrs / 1 GB changes (Included) | **5 GB allowance; <0.1 GB used** (<2% utilized) | Vercel Hobby ($0.00) *(Pending Verification)* | GitHub Actions (<100 mins used) | **₹0 ($0.00 / mo)**<br>*(Supported)* |
| **Workload B.1: Production (Scale-to-Zero Enabled)** | 100 CU-hr allowance; **60 CU-hr used** (60%) | 1 GB allowance; **<0.5 GB used** | 6 hrs / 1 GB changes (Included) | **5 GB allowance; ~0.51–1.53 GB used** (10%–31% utilized) | Vercel Hobby ($0.00) *(Pending Verification)* | GitHub Actions (~122 mins used) | **₹0 ($0.00 / mo)**<br>*(Conditionally Supported)* |
| **Workload B.2: Production (Always-On Compute)** | 100 CU-hr allowance; **182.5 CU-hr required** | 1 GB allowance; **<0.5 GB used** | 6 hrs / 1 GB changes (Included) | **5 GB allowance; ~1.5–3.0 GB used** (30%–60% utilized) | Vercel Hobby ($0.00) | GitHub Actions (~122 mins used) | **UNSUPPORTED ON FREE**<br>*(Exceeds compute by 82.5 CU-hr)* |
| **Workload C: Growth Tier (1,000 users / 300 DAU)** | 100 CU-hr allowance; **195 CU-hr required** | 1 GB allowance; **5 GB required** | Exceeds free history window | **5 GB allowance; ~15–30 GB required** (Exceeds by 10–25 GB) | Vercel Hobby or Pro | GitHub Actions (~122 mins used) | **UNSUPPORTED ON FREE**<br>*(Exceeds compute, storage & transfer)* |

> [!IMPORTANT]
> **Operational Rule for Free Operation:** Workload B.2 (always-on compute) cannot run on the Neon Free plan. To maintain the project's permanent ₹0 operating target, **scale-to-zero compute (5-minute inactivity timeout) is mandatory** in production.

---

#### Table 2 — Paid Reference Scenarios (Hypothetical Benchmark Only — NOT Approved Budget)

*The following calculations are retained strictly for provider rate comparison and external cost benchmarking. They do NOT represent an approved operating budget or authorized expenditure.*

| Paid Scenario | Compute Calculation & Cost | Storage Cost | Restore History | Database Subtotal | Vercel Hosting Reference | Total Hypothetical Monthly Reference |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Reference B.1 (Metered Scale-to-Zero)** | 240 hrs × 0.25 CU × $0.106 = **$6.36** | 1 GB × $0.35 = **$0.35** | 1 GB × $0.20 = **$0.20** | **$6.91 / mo** | Hobby ($0.00) or Pro ($20.00) | **$6.91 – $26.91 / mo** |
| **Reference B.2 (Metered Always-On)** | 730 hrs × 0.25 CU × $0.106 = **$19.35** | 1 GB × $0.35 = **$0.35** | 1 GB × $0.20 = **$0.20** | **$19.90 / mo** | Hobby ($0.00) or Pro ($20.00) | **$19.90 – $39.90 / mo** |
| **Reference C (Growth Tier)** | Baseline: 730 × 0.25 × $0.106 = $19.35<br>Burst: 50 × 0.25 × $0.106 = $1.33<br>**Compute Total: $20.67** | 5 GB × $0.35 = **$1.75** | 5 GB × $0.20 = **$1.00** | **$23.42 / mo** | Vercel Pro = **$20.00 / mo** | **$43.42 / mo** |

---

## 6. Zero-Cost Infrastructure Architecture Blueprint

```mermaid
flowchart TD
    subgraph GitHub["GitHub Platform (Free Tier)"]
        GHA["GitHub Actions Scheduler<br>(cron: 0 */6 * * *)<br>~122 mins/mo (Estimated)"]
        OAUTH["GitHub App OAuth 2.0<br>(Free User-to-Server Flow)"]
    end

    subgraph Hosting["Hosting Tier ($0/mo - Vercel Hobby or Free Fallback)"]
        APP["Next.js 16 Web App & API<br>(Turbopack, SSR, Route Handlers)"]
        SYNC_ROUTE["Internal Sync Trigger<br>(POST /api/internal/sync)"]
        SVG_ROUTE["Public SVG Embed Route<br>(Release Prerequisite)"]
    end

    subgraph Neon["Neon Serverless PostgreSQL (Free Tier - $0/mo)"]
        DB["PostgreSQL 16 Direct Endpoint<br>(port 5432, scale-to-zero enabled, 5 GB transfer limit)"]
        ADV_LOCK["Advisory Lock (982347102)"]
        AUDIT["Attempts, Receipts & Batch Runs"]
    end

    GHA -- "Bearer SYNC_CRON_SECRET (60s timeout)" --> SYNC_ROUTE
    OAUTH -- "OAuth Callback Code" --> APP
    APP -- "pg.Pool (direct session connections, <1.6 GB/mo)" --> DB
    SYNC_ROUTE -- "Dedicated advClient" --> ADV_LOCK
    SYNC_ROUTE -- "Dedicated workerClient" --> AUDIT
    APP -- "Public Read / Embed" --> SVG_ROUTE
```

### 6.1 Database Setup (Neon Free Tier)
1. **Engine Version:** **PostgreSQL 16**.
2. **Region Selection:** Co-locate with application compute:
   - If Vercel region is `iad1`, select **AWS US East (N. Virginia - us-east-1)**.
   - If Vercel region is `cle1`, select **AWS US East (Ohio - us-east-2)**.
3. **Compute Allocation & Autoscaling:** 
   - Ensure **Scale-to-zero after 5 minutes of inactivity** is active. Autoscaling max set to 2 CU (default free tier).
4. **Connection String Extraction:**
   - Extract the **Direct Connection String** (`postgresql://user:password@ep-xyz.region.aws.neon.tech/neondb?sslmode=require`).
   - **DO NOT** select the "Pooled connection" checkbox in the Neon dashboard.
5. **Initial Role Verification:** Run verification query via Neon SQL editor using the application user role:
   ```sql
   SELECT pg_backend_pid(), backend_start FROM pg_stat_activity WHERE pid = pg_backend_pid();
   ```

### 6.2 Application Hosting Setup (Vercel Hobby Tier Candidate)
1. **Framework Preset:** Next.js (auto-detected).
2. **Build Command:** `npm run build`.
3. **Output Directory:** `.next` (default).
4. **Install Command:** `npm install`.
5. **Node.js Version:** `20.x` or `22.x`.
6. **Serverless Function Region:** Match Neon database region (`iad1` for `us-east-1` or `cle1` for `us-east-2`).

### 6.3 Environment Variables Blueprint

| Variable Name | Environment Scope | Generation Method / Configuration Rule |
| :--- | :---: | :--- |
| `DATABASE_URL` | Staging & Production (Server) | Direct Neon PostgreSQL connection string (with `?sslmode=require`). Distinct projects for staging and prod. |
| `TOKEN_ENCRYPTION_KEY` | Staging & Production (Server) | 64 hexadecimal characters (256-bit AES key).<br>Generate: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `SYNC_CRON_SECRET` | Staging & Production (Server) | 64 hexadecimal characters (high-entropy secret).<br>Generate: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `GITHUB_CLIENT_ID` | Staging & Production (Server) | Copied from registered GitHub App (separate staging and prod apps). |
| `GITHUB_CLIENT_SECRET` | Staging & Production (Server) | Generated secret from registered GitHub App. |
| `GITHUB_CALLBACK_URL` | Staging & Production (Server) | `https://<domain>/api/auth/callback` (must match GitHub App setting). |
| `NEXT_PUBLIC_APP_URL` | Staging & Production (Client/Server) | `https://<domain>` (canonical root URL for CSRF validation). |
| `NODE_ENV` | Production (Client/Server) | Automatically set to `production` by Vercel deployment engine. |

### 6.4 GitHub Actions Configuration
In repository **Settings > Secrets and variables > Actions**:
- **Repository Variable:** `APP_BASE_URL` = `https://<production-domain>` (e.g. `https://pet.example.com`).
- **Repository Secret:** `SYNC_CRON_SECRET` = (identical value to application server's `SYNC_CRON_SECRET`).

---

## 7. Staging & Production Project Isolation Matrix

To guarantee strict privacy and eliminate cross-environment interference while remaining at ₹0, **two independent Neon Free projects** are provisioned. Because Neon permits multiple free projects per account (up to 100 projects and up to 20 GB aggregate storage), both staging and production operate under their own independent 100 CU-hour, 1 GB storage, and 5 GB network transfer allocations:

| Infrastructure Layer | Staging Environment (Free Tier) | Production Environment (Free Tier) | Isolation Guarantee |
| :--- | :--- | :--- | :--- |
| **Database Instance** | Dedicated Neon project: `github-profile-pet-staging` | Dedicated Neon project: `github-profile-pet-prod` | Distinct projects, credentials, storage, independent 100 CU-hr / 1 GB / 5 GB transfer allowances ($0/mo). Draws against 20 GB account ceiling. |
| **GitHub App** | `GitHub Profile Pet (Staging)` | `GitHub Profile Pet` | Separate Client ID and Secret; staging callback cannot authenticate against prod. |
| **Application Domain** | `https://staging-pet.vercel.app` | `https://<project>.vercel.app` (or custom domain) | Strict origin separation; session cookies cannot cross origins. |
| **Sync Cron Secret** | `STAGING_SYNC_CRON_SECRET` | `PROD_SYNC_CRON_SECRET` | Staging workflow trigger cannot trigger production sync. |

---

## 8. Backup & Recovery Configuration (Free Tier)

1. **Free Instant Restore:**
   - Neon Free includes instant restore up to **6 hours or 1 GB of data changes**.
   - Allows instant rewind of physical storage in the event of an operational anomaly.
2. **Pre-Migration Snapshot:**
   - Before applying forward schema migrations (`scripts/migrate.ts`), create an instantaneous branch snapshot via Neon dashboard or CLI:
     ```bash
     neon branches create --name pre-migration-snapshot
     ```
3. **Application Rollback:**
   - In Vercel, navigate to **Deployments**, select the previous stable deployment, and click **Promote to Production**. Switchover completes at the edge in <1 second without touching database state.

---

## 9. Remaining Live Verification Requirements & Release Blockers

The following items are verified structurally but require **live verification** once staging infrastructure is provisioned:

1. **PostgreSQL Backend Identity & Recovery Visibility:** Empirically verify that the unprivileged application role in the live managed Neon database can query its own `backend_start` in `pg_stat_activity` without permission errors.
2. **Aggregate Connection Behavior:** Empirically verify connection behavior and connection ceilings when multiple concurrent Vercel serverless function instances access the direct unpooled endpoint.
3. **Empirical Database Network Transfer Measurement:** Measure actual database wire protocol bytes transferred during staging under synthetic load to confirm Workload B.1 stays within the 5 GB Free allowance.
4. **Live Database Migration Execution:** Verify that `npm run migrate` runs smoothly against the live SSL-enabled cloud endpoint without connection timeout.
5. **Live OAuth Callback & Rotating Token Lifecycle:** Verify authorization code exchange, user profile retrieval, AES-256-GCM encryption, and token refresh against the live GitHub App endpoints.
6. **Deployed Background Sync & Scheduled Workflow Runtime:** Verify that GitHub Actions successfully invokes the live deployed endpoint, respects the 60s timeout, logs batch accounting metrics to `$GITHUB_STEP_SUMMARY`, and empirically measure actual job execution time.
7. **Vercel Hobby Terms Final Clarification:** Verify that Vercel accepts the personal, non-commercial open-source companion deployment under Hobby without flagging multi-user accounts. (If disputed, execute contingency migration to Cloudflare Pages or Netlify Free).
8. **Public SVG Embed Endpoint (Release Blocker):** The dynamic SVG endpoint for README embedding (`/api/pet/[id]/embed` or `/api/pet/embed`) must be implemented and verified in the codebase before README embed functionality can be declared operational.

---

## 10. Exact External Actions Requiring Separate Approval

The following specific external actions are **prepared but not yet executed**, pending explicit user approval:

1. **Vercel Project Setup:** Linking repository to Vercel and configuring environment variables under Hobby tier.
2. **Neon Database Creation:** Creating separate Neon projects for Staging and Production under Free tier.
3. **GitHub App Registration:** Creating live GitHub Apps at `https://github.com/settings/apps/new`.
4. **Secret Generation:** Generating actual production cryptographically random keys for `TOKEN_ENCRYPTION_KEY` and `SYNC_CRON_SECRET`.
5. **DNS & Custom Domains:** Adding and pointing custom DNS records for production (if desired).

---

## 11. Final Architecture and Cost Verdict

### **VERDICT: CONDITIONALLY READY FOR FREE STAGING PROVISIONING**

**Justification:**  
1. **Genuinely Zero-Cost Architecture:** The proposed primary architecture (Vercel Hobby + Neon Free + GitHub Actions) can genuinely operate at **₹0 / month ($0.00 / month)** in both staging and production.
2. **Workload Bounded with Transfer Headroom:** Workload A (Staging: 15 CU-hr, <0.1 GB transfer) fits well within Free allowances (<2% transfer utilized). Workload B.1 (Production: 60 CU-hr, ~0.51–1.53 GB transfer) is projected to consume ~10%–31% of the 5 GB network transfer allowance, providing ~69%–90% headroom. Always-on compute (Workload B.2) and growth tier (Workload C) exceed free limits and are explicitly categorized as unsupported on Free.
3. **Availability & Suspension Risks Documented:** The operational risks of Neon Free (zero SLA, suspension upon 100 CU-hr or 5 GB transfer exhaustion until monthly reset) are documented with monitoring and alerting protocols. Silent upgrades to Launch are strictly prohibited.
4. **Alternative Hosting Formally Assessed:** Cloudflare Workers is categorized as UNVERIFIED/UNPROVEN due to TCP connection pooling/proxy risks (Hyperdrive breaking advisory locks and backend PIDs) and 10ms CPU limits. Netlify is categorized as UNVERIFIED/HIGH RISK due to its 300-credit hard limit being exhausted by ~20 production deploys.
5. **Scheduler & Reward Invariants Preserved:** The 6-hour scheduler provides up to 8 retry execution opportunities within the authoritative 48-hour pending reward expiry window (UTC sync date midnight + 48 hours). Monthly consumption (~122 billed minutes estimated) is 100% free on public repositories, or consumes only ~6% of the 2,000-minute private allowance.
6. **Conditions Prior to Production:**
   - Scale-to-zero compute (5-minute inactivity timeout) must be active on Neon Free.
   - Live empirical verification of `pg_stat_activity` session visibility must be confirmed during staging.
   - Live empirical measurement of database network transfer and GitHub Actions job duration must be recorded.
   - The public SVG embed endpoint must be implemented and verified before README embeds are advertised as operational.

*Execution halts here in accordance with instructions. Awaiting explicit project owner approval before provisioning external staging infrastructure or registering cloud services.*
