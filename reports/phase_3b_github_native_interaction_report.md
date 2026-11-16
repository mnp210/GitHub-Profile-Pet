# Phase 3B Engineering Report: GitHub-Native Pet Interaction & Durable Action Inbox

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Architecture:** Sprint 2.7.4 — GitHub-native, self-hosted per user  
**Status:** Complete & Fully Verified  
**Date:** 2026-11-16  

---

## 1. Executive Summary

Phase 3B establishes the asynchronous, event-driven interaction mechanism for GitHub Profile Pet. By transforming GitHub Issues into a durable, tamper-evident action inbox and executing state transitions directly via GitHub Actions, pet owners can feed, train, rest, and pet their companion without requiring:
- Any local server or developer machine left running.
- Any centralized application server, backend, or proxy.
- Any hosted database (PostgreSQL, Supabase, Redis).
- Any monthly operational expense (**₹0/month guarantee preserved**).

All interactions are backed by the Phase 1 pet engine, Phase 1.1 multi-document atomic commit protocol, Phase 1.1.1 process-aware locking, and Phase 2 deterministic SVG generator.

---

## 2. Deliverables & Implementation Audit

### 2.1 GitHub Issue Forms (`.github/ISSUE_TEMPLATE/`)
- `pet-feed.yml`: Form for feeding actions, offering meal selections (Clean Code Kibble, Gourmet Salmon, Binary Bits, Star Fruit). Auto-applies `pet-action:pending` and `pet:feed`.
- `pet-train.yml`: Form for training drills, offering training foci (Agility Drill, Logic Puzzle, Focus Meditation, Speed Run). Auto-applies `pet-action:pending` and `pet:train`.
- `pet-rest.yml`: Form for resting, offering comfort spots (Cozy Blanket, Sunlit Window, Cloud Hammock, Cat Tree). Auto-applies `pet-action:pending` and `pet:rest`.
- `pet-pet.yml`: Form for bonding interactions, offering gestures (Gentle Ear Scratch, Head Pat, Belly Rub, Chin Tickle). Auto-applies `pet-action:pending` and `pet:pet`.

### 2.2 Inbox Core Modules (`src/features/pet-engine/inbox/`)
- `types.ts`: TypeScript contracts for `GitHubIssue`, `ActionParseResult`, `ActionProcessOutcome`, `GitHubInboxClient`, `InboxProcessingOptions`, and `InboxProcessResult`.
- `issueParser.ts`: Untrusted issue parser. Verifies labels, checks for Pull Requests (using `issue.pull_request`), validates form dropdown payloads, and enforces the post-creation edit quarantine ($\Delta t > 10,000\,\text{ms}$).
- `gitHubClient.ts`: `DefaultGitHubInboxClient` implementing native REST API operations (issue retrieval, comments, labeling, closing) with automatic token redaction and `GITHUB_TOKEN` credential safety.
- `inboxScanner.ts`: Durable scanner discovering open `pet-action:pending` issues, ordering them chronologically (`created_at ASC, number ASC`), inspecting historical sequence gaps up to the lowest open issue, and enforcing monotonic HWM constraints.
- `actionProcessor.ts`: Master orchestrator. Drains the inbox, executes state transitions via `executeCareAction`, enforces CAS generation consistency, commits atomic journals via `saveRepositoryState`, tracks processed issues in `processedRequestRegistry`, posts user comments with rich Markdown feedback, closes issues, and re-renders/publishes the updated SVG.
- `index.ts`: Public API export module.

### 2.3 CLI & Workflow Integration
- `scripts/process-inbox.ts`: Standalone CLI runner invoked in GitHub Actions runners via `npm run process:inbox`.
- `package.json`: Added script target:
  ```json
  "process:inbox": "node --experimental-strip-types scripts/process-inbox.ts"
  ```
- `.github/workflows/pet-interaction.yml`: Workflow triggered on `issues: [opened]` and `workflow_dispatch`. Configured with concurrency group `pet-runtime-${{ github.repository }}`, timeout 5m, and least-privilege permissions:
  ```yaml
  permissions:
    contents: write
    issues: write
  ```

---

## 3. Correctness & Security Invariants

### 3.1 At-Most-Once State Execution & Idempotency
Every processed issue is recorded in `processedRequestRegistry` inside `pet/state/actions.json`. If GitHub re-delivers an `issues: opened` webhook, or if an action issue is re-opened, the scanner recognizes it as `status: 'already_processed'` and emits a duplicate outcome without re-applying vitals or XP mutations.

### 3.2 Monotonic Sequence Gap Classification
GitHub Issues and Pull Requests share a unified number space. To prevent deleted issues or external PRs from indefinitely blocking the high-water mark:
- `410 Gone`: Treated as a retired deletion, advancing HWM.
- `404 Not Found`: Treated as ambiguous (unresolved gap), preventing HWM from advancing past it.
- `403 / 429 / 5xx`: Unresolved API rate-limiting or server errors, preventing HWM from advancing.
- `Pull Requests`: Identified by the presence of `issue.pull_request`, retired as non-action gaps without touching gameplay state.
- `Sparse Processing`: Actions higher than an unresolved gap are executed and stored in `sparseProcessedIssueNumbers`, ensuring that earlier sequence gaps never block later valid care actions.

### 3.3 Post-Creation Edit Quarantine
To prevent players from opening an action and later editing the issue body to alter action types or parameters, any issue where `updated_at - created_at > 10,000ms` is immediately quarantined with `pet-action:quarantine`, closed, and recorded in the registry without executing gameplay state transitions.

---

## 4. Verification & Test Suite Summary

### 4.1 Unit & Integration Test Matrix (`tests/pet-engine/inboxProcessing.test.ts`)
| Test ID | Scenario | Result |
|---|---|---|
| TC-INBOX-01 | Issue form YAML schemas for feed, train, rest, pet | Passed |
| TC-INBOX-02 | Workflow least-privilege permissions & concurrency | Passed |
| TC-INBOX-03 | Pull Request rejection in shared number space | Passed |
| TC-INBOX-04 | Ordinary non-pet issue ignoring | Passed |
| TC-INBOX-05 | Malformed and unknown action rejection | Passed |
| TC-INBOX-06 | Post-creation edit quarantine defense | Passed |
| TC-INBOX-07 | Duplicate delivery idempotency | Passed |
| TC-INBOX-08 | 410 vs 404 gap classification invariant | Passed |
| TC-INBOX-09 | 403, 429, and 5xx error handling | Passed |
| TC-INBOX-10 | Out-of-order sparse tracking and deferred HWM | Passed |
| TC-INBOX-11 | Author authorization and impersonation defense | Passed |
| TC-INBOX-12 | Gameplay rejection zero-mutation verification | Passed |
| TC-INBOX-13 | Accepted feed action state mutation, comment, SVG publish | Passed |
| TC-INBOX-14 | Interrupted journal recovery prior to drainage | Passed |
| TC-INBOX-15 | Chronological order processing across multiple issues | Passed |
| TC-INBOX-16 | Client construction and scanner integration | Passed |

### 4.2 Full Verification Matrix
- **`npm run test:pet-engine`**: 9 suites, 99 tests passed, 0 failed.
- **`npm test`**: 24 suites, 121 tests passed, 0 failed.
- **`npm run test:all`**: 33 suites, 220 tests passed, 0 failed.
- **`npm run lint`**: 0 errors, 0 warnings.
- **`npx tsc --noEmit`**: 0 errors.
- **`npm run build`**: Next.js production build succeeded in 1290ms.
- **`npm run render:svg`**: Generated standalone SVG (12,441 bytes) successfully.
- **`npm run publish:pet`**: Rendered and published pet SVG cleanly.
- **`npm run process:inbox`**: Drained inbox cleanly with zero unhandled exceptions.

---

## 5. Scope Boundaries Maintained

In accordance with strict controlled implementation guidelines:
- **Zero Git mutations performed** (no commits, pushes, resets, rebases, or branch checkouts).
- **Phase 1 gameplay rules preserved untouched** (feeding awards +10 XP, +24 satiety; training costs 18 energy; 60s cooldown preserved).
- **Phase 2 SVG renderer preserved untouched**.
- **Phase 3C features excluded** (contribution sync and passive background simulation deferred to their authorized phase).
- **Zero external service dependencies introduced**.
