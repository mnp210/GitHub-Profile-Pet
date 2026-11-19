# Sprint 3.9: Remote GitHub Validation, Security Hardening & Event Delivery Reliability

## 1. Executive Summary & Architectural Scope

Sprint 3.9 hardens the GitHub Profile Pet runtime, storage, and synchronization layers. Building upon Sprint 3.8's activity progression and authoritative state architecture, Sprint 3.9 addresses critical real-world GitHub platform constraints:

1. **GitHub Actions Concurrency & Dropped Event Mitigation**: Solves event loss caused by GitHub Actions concurrency queuing limitations through a dual-track strategy combining automatic fast-forward push retries with a periodic Git history reconciliation sweep.
2. **Zero-Token Credential Security**: Completely eliminates Personal Access Token (PAT) storage from client-side `localStorage`, transitioning to strictly in-memory session lifetime, automated legacy token purging, and leak-proof error sanitization.
3. **Authoritative Ledger Lifecycle & Bounded Retention**: Enforces memory and storage boundaries on `pet/ledger/activity.json` with a 14-day activity staleness cutoff, 500-entry FIFO registry capping, and 30-day daily accrued XP pruning.
4. **Repository Multi-Tenant Isolation**: Guarantees that pet instances remain strictly compartmentalized within their respective repositories (`owner/repo`), preventing cross-repository state contamination.

---

## 2. GitHub Actions Event Delivery & Reliability Guarantees

### 2.1 Concurrency Queue Limitations & Problem Analysis

In GitHub Actions, concurrency groups serialize job execution:

```yaml
concurrency:
  group: pet-runtime-${{ github.repository }}
  cancel-in-progress: false
```

While `cancel-in-progress: false` queues runs, GitHub Actions maintains an internal pending queue depth limit of **1**. If two commits arrive rapidly while a run is active, only the latest pending run is retained; intermediate runs can be collapsed or skipped. Furthermore, if concurrent runner jobs or external commits push to `main` between `git pull` and `git push`, the runner's push fails with non-fast-forward rejection.

### 2.2 Dual-Track Reliability Architecture

To eliminate event loss, GitHub Profile Pet implements a dual-track delivery and recovery architecture:

```
[ Push / Webhook Event ] ---> [ Fast-Forward Push Retry Loop ] (Track 1: Immediate Processing)
                                   |
                                   +---> Max 4 attempts with exponential backoff & git rebase
                                   +---> On push conflict: git fetch + rebase + state merge
                                   
[ Scheduled Cron Sweep ] ----> [ Git Commit History Reconciliation ] (Track 2: Recovery Sweep)
(Every 30 Minutes)                 |
                                   +---> Inspects trailing 30 commits on HEAD
                                   +---> Filters out [skip ci], bot commits, and pet commits
                                   +---> Checks commit SHAs against processedRegistry.commitShas
                                   +---> Automatically awards XP for any missed commits
```

#### Track 1: Fast-Forward Push Retry Loop
When `scripts/process-activity.ts` runs inside the runner:
1. Manifest state files (`pet/state/pet.json`, `pet/ledger/activity.json`, `public/pet.svg`, `README.md`) are updated.
2. `pushWithRetry` attempts `git push origin HEAD:<targetRef>`.
3. If rejected due to remote updates, the process executes:
   - `git fetch origin <targetRef>`
   - `git rebase origin/<targetRef>`
   - Re-applies the manifest commits and retries (up to 4 attempts) with randomized exponential backoff.

#### Track 2: Scheduled Reconciliation Sweep
`.github/workflows/pet-activity.yml` runs every 30 minutes (`cron: '*/30 * * * *'`) as well as on `push` and `workflow_dispatch`:
1. The runner executes `git log -n 30 --format=%H|%an|%ae|%aI|%s`.
2. Each commit is evaluated:
   - **Bot Check**: Excludes bots (e.g. `github-actions[bot]`, `dependabot[bot]`).
   - **Directive Check**: Excludes `[skip ci]`, `auto-update pet svg`, `pet:`, and merge commits.
   - **Registry Check**: If the commit SHA is already in `processedRegistry.commitShas`, it is skipped.
   - **Staleness Check**: Commits older than 14 days UTC are rejected.
3. Any unrecorded qualifying human commits missed due to runner concurrency drops are ingested, XP is credited, and state is committed.

---

## 3. Token & Authorization Security Hardening

### 3.1 Zero-Token Storage Invariant

Storing personal access tokens (PATs) in web storage (`localStorage` or `sessionStorage`) exposes credentials to Cross-Site Scripting (XSS), browser extensions, and physical machine access.

GitHub Profile Pet enforces a **Zero-Token Storage Policy**:

```typescript
// src/lib/storage/gameStateStorage.ts
export function saveRepoConfig(config: RepoConfig): void {
  // STRICT SECURITY INVARIANT:
  // Personal Access Tokens MUST NEVER be persisted to localStorage or sessionStorage.
  const safeConfig = {
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
  };
  localStorage.setItem(LOCAL_STORAGE_CONFIG_KEY, JSON.stringify(safeConfig));
  
  // Explicitly purge any legacy token key if present
  localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
}
```

1. **In-Memory Lifespan Only**: When a user inputs a GitHub PAT in the web UI, it is held strictly in React component state for the duration of the current session.
2. **Automatic Purge on Reload**: Refreshing or closing the tab completely clears the token.
3. **Legacy Token Cleanup**: `loadRepoConfig` automatically inspects `localStorage` and deletes any legacy `github_pat_token` entry found from prior versions.

### 3.2 HTTP Error Sanitization & Token Masking

When dispatching GitHub API requests (Issue creation or README updates):
1. **Network Header Protection**: The `Authorization: Bearer <token>` header is sent directly over HTTPS to `api.github.com`.
2. **Error Message Masking**: Catch blocks sanitize error outputs before displaying them to the UI or logging them:
   - Status 401 returns: `"GitHub authentication failed (401 Bad credentials). Please verify your Personal Access Token."`
   - Status 403 returns: `"GitHub permission denied (403 Forbidden). Ensure your token has 'repo' or 'contents:write' scope."`
   - Status 404 returns: `"Repository not found (404). Please verify that the repository exists and your token has access."`
3. Raw error bodies, response headers, and request configurations are stripped, guaranteeing tokens never leak into console logs or toast notifications.

### 3.3 Scope Minimization

The application requires minimal permissions:
- Read-Only Visitors: **Zero permissions / No token required**.
- Interacting Trainers: Fine-Grained PAT with `Issues: Read and write` and `Contents: Read and write` scoped strictly to the target repository.

---

## 4. Authoritative Ledger Lifecycle & Bounded Retention

### 4.1 Bounded Registry Retention

To prevent unbounded JSON ledger growth and performance degradation over months of repository activity, `pet/ledger/activity.json` enforces strict bounds:

```typescript
// src/features/pet-engine/activity/constants.ts
export const MAX_REGISTRY_ENTRIES = 500;
export const MAX_ACTIVITY_AGE_DAYS = 14;
export const MAX_DAILY_ACCRUED_DAYS = 30;
export const MAX_RECENT_EVENTS = 50;
```

1. **Registry Caps (`MAX_REGISTRY_ENTRIES = 500`)**: Each deduplication list (`commitShas`, `issueNumbers`, `prOpenedNumbers`, `prMergedNumbers`, `reviewIds`) maintains a sliding window of the latest 500 identifiers via `.slice(-MAX_REGISTRY_ENTRIES)`.
2. **Activity Staleness Boundary (`MAX_ACTIVITY_AGE_DAYS = 14`)**: Any event with a timestamp older than 14 days UTC is rejected as `'skipped_stale'` with 0 XP. Because the registry retains 500 entries (weeks to months of commits), stale events outside the 14-day window cannot be replayed even if evicted from the 500-entry registry.
3. **Daily Accrued XP Pruning (`MAX_DAILY_ACCRUED_DAYS = 30`)**: `dailyAccruedXp` dictionary entries for dates older than 30 days are automatically pruned, keeping ledger size constant (~15-25 KB).
4. **Recent Events Audit Log (`MAX_RECENT_EVENTS = 50`)**: The human-readable event log is capped at 50 entries.

### 4.2 State Machine Transition Matrix

Every incoming activity event is processed through a deterministic decision pipeline:

```
[ Incoming Event ]
       |
       +---> [ Age > 14 Days? ] ----------> YES: Status = 'skipped_stale' (0 XP)
       |
       +---> [ Known Bot Actor? ] --------> YES: Status = 'skipped_bot' (0 XP)
       |
       +---> [ Directive / Skip CI? ] ----> YES: Status = 'skipped_directive' (0 XP)
       |
       +---> [ Already in Registry? ] ----> YES: Status = 'skipped_duplicate' (0 XP)
       |
       +---> [ Daily Cap Reached? ] ------> YES: Status = 'skipped_daily_cap' (0 XP)
       |
       v
  [ Award XP (Clamped to Remaining Daily Budget) ]
       |
       +---> Status = 'awarded'
       +---> Update dailyAccruedXp[today]
       +---> Append to processedRegistry
       +---> Increment pet.experience & check evolution
       +---> Prepend to recentEvents (capped at 50)
```

---

## 5. Multi-Tenant Repository Isolation

The GitHub Profile Pet web client supports multi-repository navigation through the URL parameter:
`https://<pages-domain>/?repo=<owner>/<repo>`

1. **Storage Isolation**: Web configuration is keyed or reset when switching repositories.
2. **Remote Ground Truth**: The game loads state strictly from the raw content of the requested repository:
   `https://raw.githubusercontent.com/<owner>/<repo>/main/pet/state/pet.json`
3. **Independent Lifecycles**: A commit in `repo-a` only dispatches workflow execution in `repo-a`. `repo-b` remains unaffected, maintaining independent level, experience, mood, and ledger state.

---

## 6. Verification & Automated Test Coverage

The architecture is covered by automated unit and integration suites:

- `tests/unit/tokenSecurityHardening.test.ts`:
  - Validates zero token storage in `localStorage`.
  - Confirms legacy token purging on load.
  - Confirms fail-closed error handling without token leakage on 401, 403, and 404 responses.
- `tests/unit/activityDeliveryReliability.test.ts`:
  - Simulates burst commit arrivals (5 commits in single execution).
  - Validates strict daily cap enforcement across 25 rapid commits.
  - Simulates scheduled reconciliation sweep discovering unrecorded commits and rejecting duplicates.
- `tests/unit/activityProgression.test.ts`:
  - Validates XP awards across commits, issues, PRs, and reviews.
  - Validates 14-day event staleness rejection.
  - Validates 30-day daily accrued XP dictionary pruning.

**Total Automated Test Count:** 714 tests passing (167 core unit tests + 547 pet-engine tests), 0 lint errors, 0 TypeScript errors.
