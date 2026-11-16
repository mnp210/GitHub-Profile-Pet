# Phase 3C2.1-V.5.1 — Dependency Isolation Report

**Project:** GitHub Profile Pet  
**Workspace:** [`D:\Projects\GitHub-Profile-Pet`](file:///D:/Projects/GitHub-Profile-Pet)  
**Target Branch:** `main`  
**Published Baseline:** `ab2f88eaadd144cefbc2f9cfd359cf4c4707d870`  
**Milestone:** Phase 3C2.1-V.5.1 (Contribution Diagnostic & Engine Dependency Isolation)  
**Status:** **COMPLETE — 100% Isolated & Validated**

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 The Issue Encountered in Actions Run 43873237663
During Phase 3C2.1-V.5, the diagnostic workflow was dispatched on a hosted GitHub Actions runner (`ubuntu-latest`). While the runner properly acquired the default `GITHUB_TOKEN` with least-privilege permissions (`contents: read`, `metadata: read`), the diagnostic step crashed immediately upon startup with:
```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pg' imported from /home/runner/work/GitHub-Profile-Pet/GitHub-Profile-Pet/src/lib/db/pool.ts
```

### 1.2 Forensic Source Trace of the Original Import Chain
A complete recursive AST and import analysis of `scripts/probe-github-contributions.ts` revealed that although the GitHub-native pet-engine was intended to be self-hosted and zero-dependency, its GraphQL provider client transitively reached into legacy centralized PostgreSQL database repositories:

```text
[Entry Point] scripts/probe-github-contributions.ts
       │
       ▼ imports { getGitHubGraphQLClient, redactSensitiveData, GitHubGraphQLError }
src/lib/github/graphqlClient.ts
       │
       ▼ imports { executeWithRetry }
src/lib/github/retryPolicy.ts
       │
       ▼ imports { classifyGitHubError }
src/lib/github/failureClassification.ts
       │
       ▼ imports { DuplicateSequenceConflictError }
src/lib/db/repositories/syncRepository.ts  <-- LEGACY CENTRALIZED ARCHITECTURE
       │
       ▼ imports { getPool }
src/lib/db/pool.ts
       │
       ▼ imports 'pg'  <-- EXTERNAL NPM PACKAGE (Missing without npm install)
```

In the local developer workspace, `node_modules` was present on disk with `pg` installed for the Next.js/PostgreSQL dashboard. However, on a fresh GitHub-hosted Actions runner, `node_modules` is intentionally absent because GitHub Actions runners for the pet-engine are designed to run leanly with `node --experimental-strip-types` without executing `npm ci` or checking in bloated vendor dependencies.

---

## 2. Files Created, Changed, and Deliberately Left Untouched

### 2.1 Files Created
1. [`src/features/pet-engine/contribution/nativeGraphQLClient.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/nativeGraphQLClient.ts):
   - Pure, zero-dependency Node.js 22 GitHub GraphQL client.
   - Built-in `executeWithRetry` bounded exponential backoff with full jitter and total duration deadline.
   - Self-contained HTTP/network error classifier (`classifyNativeGitHubError`) that never references database repositories or external packages.
   - Explicit typed error classes: `GitHubGraphQLError`, `GitHubUnauthorizedError`, `GitHubForbiddenError`, `GitHubRateLimitError`, `GitHubServerError`, `GitHubTimeoutError`, `GitHubNetworkError`.
   - Native `redactSensitiveData` utility protecting tokens and bearer headers.
   - Native `setFetchImplementation` / `resetFetchImplementation` hooks for mock-based testing without monkey-patching globals.
2. [`tests/pet-engine/nativeGraphQLClient.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/nativeGraphQLClient.test.ts):
   - 24 comprehensive unit tests verifying token redaction, error classification, jitter bounds, retry execution flow, deadline expiration, HTTP status handling, and GraphQL partial data rejection.
3. [`tests/pet-engine/dependencyIsolation.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/dependencyIsolation.test.ts):
   - Automated boundary regression test that walks the complete static import graph of `scripts/probe-github-contributions.ts` and `src/features/pet-engine/contribution/index.ts`.
   - Enforces 0 references to `src/lib/db/`, 0 references to `src/lib/sync/`, and 0 references to package `'pg'`.
   - Asserts that the diagnostic script executes in Node 22 without `ERR_MODULE_NOT_FOUND`.

### 2.2 Files Modified
1. [`scripts/probe-github-contributions.ts`](file:///D:/Projects/GitHub-Profile-Pet/scripts/probe-github-contributions.ts):
   - Decoupled `redactSensitiveData` import from `src/lib/github/graphqlClient.ts` to `src/features/pet-engine/contribution/index.ts`.
2. [`src/features/pet-engine/contribution/contributionProvider.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/contributionProvider.ts):
   - Switched imports from `src/lib/github/graphqlClient.ts` to `./nativeGraphQLClient.ts`.
   - Default client in constructor updated to `getNativeGraphQLClient()`.
3. [`src/features/pet-engine/contribution/index.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/contribution/index.ts):
   - Exported all symbols from `./nativeGraphQLClient.ts`.
4. [`tests/pet-engine/contributionProvider.test.ts`](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/contributionProvider.test.ts):
   - Updated test imports to source client and error classes from `src/features/pet-engine/contribution/index.ts`.

### 2.3 Files Deliberately Left Untouched
To ensure zero regression for the legacy centralized Next.js application, the shared legacy modules were preserved completely intact:
- [`src/lib/github/graphqlClient.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/lib/github/graphqlClient.ts) (retained for legacy centralized sync endpoints and legacy integration tests).
- [`src/lib/github/retryPolicy.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/lib/github/retryPolicy.ts).
- [`src/lib/github/failureClassification.ts`](file:///D:/Projects/GitHub-Profile-Pet/src/lib/github/failureClassification.ts).
- All files under [`src/lib/db/`](file:///D:/Projects/GitHub-Profile-Pet/src/lib/db).

---

## 3. New Isolated Dependency Graph

The newly established dependency graph for the GitHub-native contribution engine and diagnostic probe is 100% self-contained:

```text
[Entry Point] scripts/probe-github-contributions.ts
       │
       ▼ imports
src/features/pet-engine/contribution/index.ts
       │
       ├──► types.ts                (pure TypeScript interfaces & error classes)
       │
       ├──► identityResolver.ts     (Node.js process.env & regex string parsing)
       │
       ├──► contributionProvider.ts (GraphQL query documents & payload validators)
       │         │
       │         ▼
       └──► nativeGraphQLClient.ts  (Web fetch, AbortSignal, zero external dependencies)
```

**Total files traversed:** Exactly 6 internal files.  
**External npm packages required:** 0.  
**Database dependencies:** 0.

---

## 4. Error Handling & Retry Policy Comparison

The new native implementation reproduces the exact retry and error handling contracts of the legacy implementation while eliminating all centralized database concepts:

| Scenario / Error Type | Legacy Implementation | New Isolated Implementation | Behavior Change / Difference |
| :--- | :--- | :--- | :--- |
| **HTTP 401 Unauthorized** | Throws `GitHubUnauthorizedError`; non-retryable | Throws `GitHubUnauthorizedError`; non-retryable | None (Fails fast immediately) |
| **HTTP 403 Forbidden** | Throws `GitHubForbiddenError`; non-retryable | Throws `GitHubForbiddenError`; non-retryable | None (Fails fast immediately) |
| **HTTP 429 / Secondary Rate Limit** | Retried if `retryAfterSeconds <= 2s` | Retried if `retryAfterSeconds <= 2s` | None (Respects policy budget) |
| **Primary Rate Limit (Exceeded)** | Throws `GitHubRateLimitError`; non-retryable | Throws `GitHubRateLimitError`; non-retryable | None (Fails closed) |
| **HTTP 5xx Server Error** | Retried with jittered exponential backoff | Retried with jittered exponential backoff | None (Up to 3 attempts) |
| **Request Timeout** | Throws `GitHubTimeoutError`; retryable | Throws `GitHubTimeoutError`; retryable | None (Up to 3 attempts) |
| **Network Failure (Fetch Error)** | Throws `GitHubNetworkError`; retryable | Throws `GitHubNetworkError`; retryable | None (Up to 3 attempts) |
| **GraphQL Semantic Errors** | Throws `GitHubGraphQLError`; non-retryable | Throws `GitHubGraphQLError`; non-retryable | None (Fails fast) |
| **Partial GraphQL Data (Data + Errors)** | Rejects payload, throws `GitHubGraphQLError` | Rejects payload, throws `GitHubGraphQLError` | None (Guarantees data integrity) |
| **Database Conflict (`DuplicateSequence`)** | Handled in `failureClassification.ts` | **Eliminated** | N/A (GitHub-native engine does not use SQL DB) |
| **Token Redaction in Errors & Logs** | Redacts tokens & `Bearer` headers | Redacts tokens & `Bearer` headers | Identical sanitization rules |

---

## 5. Execution Proof in a Zero-Dependency Environment

To prove that the probe script can start on a clean machine without `node_modules` or running `npm install`:
1. An isolated temporary directory outside the repository tree was created (`%TEMP%/pet-probe-isolated-*`).
2. Only `scripts/probe-github-contributions.ts` and `src/features/pet-engine/contribution/` were copied into the isolated directory.
3. No `node_modules` or `package.json` was present.
4. `node --experimental-strip-types scripts/probe-github-contributions.ts` was executed.

**Execution Result:**
```text
================================================================
GitHub Profile Pet — Diagnostic Contribution & Identity Probe
================================================================
ERROR: GITHUB_TOKEN environment variable is required.
In GitHub Actions, ensure `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` is set.
```
- Module resolution completed in 100% of trials with zero errors.
- Script advanced directly to runtime validation without encountering `ERR_MODULE_NOT_FOUND`.

---

## 6. Comprehensive Test & Validation Results

All test suites and static analysis checks passed with 100% success:

| Verification Suite | Command Executed | Tests Run | Result | Notes |
| :--- | :--- | :---: | :---: | :--- |
| **Unit Test Suite** | `npm test` | 121 | **121 / 121 PASS** | All existing centralized & security unit tests passing |
| **Pet-Engine Test Suite** | `npm run test:pet-engine` | 245 | **245 / 245 PASS** | Includes all existing 218 tests + 27 new isolation & client tests |
| **Total Automated Tests** | Combined | 366 | **366 / 366 PASS** | Zero test failures, zero skipped tests |
| **ESLint** | `npm run lint` | Full codebase | **0 errors, 0 warnings** | Completely clean static analysis |
| **TypeScript Typecheck** | `npx tsc --noEmit` | Full codebase | **0 errors** | Strict typing verified across all modified files |
| **Production Build** | `npm run build` | Next.js Turbopack | **14 / 14 pages** | Production dashboard compiled without issue |

---

## 7. Remaining Limitations & Boundaries

1. **GitHub Actions Hosted Run Pending:**  
   Per the milestone authorization boundaries, no workflow was dispatched on GitHub Actions during this phase. A live Actions dispatch can now be authorized in a follow-up step to re-verify `GITHUB_TOKEN` telemetry on the hosted runner.
2. **Phase 3C2.2 Not Started:**  
   No contribution rewards, high-water marks, reward ordinals, pending queues, or hourly throttling were implemented. The contribution synchronizer remains inactive in accordance with project constraints.
3. **No Commits or Pushes:**  
   In compliance with the prompt instructions, no git commits, pushes, or remote operations have been performed. All changes remain staged/ready in the local workspace.
