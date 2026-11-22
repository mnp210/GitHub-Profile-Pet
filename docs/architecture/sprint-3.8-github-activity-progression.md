# Sprint 3.8: GitHub Activity XP & Authoritative Pet State Architecture

## 1. Overview & Mission

GitHub Profile Pet delivers a genuinely repository-specific companion whose growth and evolution are directly driven by real GitHub engineering activity.

This document formalizes:
1. **GitHub Activity XP Progression**: Deterministic XP rules for qualifying commits, issues, pull requests, merges, and code reviews.
2. **Authoritative State Invariants**: Why repository files (`pet/state/pet.json`, `pet/ledger/activity.json`) are the single source of truth, persisting across all browsers and devices.
3. **Dual-Layer Deduplication**: Stable identifier registries preventing duplicate awards across replayed events, network retries, and runner restarts.
4. **Security & Boundary Isolation**: Cryptographic and permission boundaries separating public visitor interactions from authenticated owner repository mutations.

---

## 2. Activity XP Reward Schedule

| Activity Event | Qualification Criteria | XP Reward | Deduplication Identifier |
| :--- | :--- | :--- | :--- |
| **Commit** | Unique non-bot commit on primary branch | `+15 XP` | 40-character lowercase Git commit SHA |
| **Issue Opened** | Unique human issue (non-care action) | `+10 XP` | GitHub Issue number |
| **PR Opened** | Unique human pull request creation | `+25 XP` | GitHub PR number (`prOpenedNumbers`) |
| **PR Merged** | Distinct completion reward on PR merge | `+50 XP` | GitHub PR number (`prMergedNumbers`) |
| **Review Submitted** | Substantive review (`APPROVED` / `CHANGES_REQUESTED`) | `+20 XP` | GitHub Review ID (`reviewIds`) |

> [!NOTE]
> Pull Requests yield up to `75 XP` across their lifecycle: `25 XP` on creation and `50 XP` on merge. These are tracked in distinct registry sets, ensuring both phases are rewarded exactly once.

### Daily Activity Cap & Anti-Grinding Guard
- **Daily Cap:** `300 XP` maximum per UTC calendar day (`YYYY-MM-DD`).
- **Clamping:** Increments that partially cross the daily cap are clamped to the exact remaining budget.
- **Exclusion:** Once 300 XP is reached for the day, subsequent events are audited and recorded as `skipped_daily_cap` with `0 XP` awarded.

---

## 3. Bot & Maintenance Commit Exclusions

To eliminate runaway infinite loops between GitHub Actions commits and activity triggers, the engine strictly excludes:

1. **Bot Logins:** Any actor ending with `[bot]` (e.g. `github-actions[bot]`, `dependabot[bot]`, `renovate[bot]`, `coderabbitai[bot]`) or listed in `KNOWN_BOT_LOGINS`.
2. **Commit Message Directives:**
   - `[skip ci]`, `[ci skip]`
   - `^pet:\s` (automated pet state updates)
   - `^chore\(pet\):`
   - `auto-update pet svg`
   - `^docs:\s(install|update)\spet\smenu`
   - Automated branch and PR merge commit messages (`^Merge pull request`, `^Merge branch`).
3. **Care Action Issues:** Any issue tagged with label `pet-action:pending` or prefixed with `pet:` in the title is routed exclusively to the Care Action Inbox and skipped from activity XP.

---

## 4. Authoritative Ledger Schema (`pet/ledger/activity.json`)

The activity ledger is validated by JSON Schema (`pet/schemas/activity.schema.json`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GitHub Profile Pet Activity Ledger",
  "type": "object",
  "required": [
    "schemaVersion",
    "generation",
    "dailyAccruedXp",
    "processedRegistry",
    "recentEvents",
    "updatedAt"
  ],
  "properties": {
    "schemaVersion": { "type": "integer", "const": 1 },
    "generation": { "type": "integer", "minimum": 1 },
    "dailyAccruedXp": {
      "type": "object",
      "additionalProperties": { "type": "integer", "minimum": 0, "maximum": 300 }
    },
    "processedRegistry": {
      "type": "object",
      "required": ["commitShas", "issueNumbers", "prOpenedNumbers", "prMergedNumbers", "reviewIds"],
      "properties": {
        "commitShas": { "type": "array", "items": { "type": "string" } },
        "issueNumbers": { "type": "array", "items": { "type": "integer" } },
        "prOpenedNumbers": { "type": "array", "items": { "type": "integer" } },
        "prMergedNumbers": { "type": "array", "items": { "type": "integer" } },
        "reviewIds": { "type": "array", "items": { "type": "integer" } }
      }
    },
    "recentEvents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["eventId", "eventType", "actor", "timestamp", "xpAwarded", "status"]
      }
    },
    "updatedAt": { "type": "string", "format": "date-time" }
  }
}
```

---

## 5. Security & Boundary Architecture

### Authoritative Repository vs Client Playground
- **Authoritative Source:** The files on `main` branch inside `pet/state/pet.json` and `pet/ledger/activity.json` represent the sole ground truth.
- **Client Web App:** The static browser app loads this state via `?repo=owner/repo` from GitHub raw content or the GitHub REST API.
- **Authorized Trainer Mode:** When the user supplies a Personal Access Token (PAT) with `repo` / `contents:write` scope, actions can dispatch GitHub Action issues or update the README.
- **Visitor Playground Mode:** When no token is present, public visitors can still freely interact with the pixel pet, trigger retro audio, and observe animations locally. Local interactions do NOT modify remote repository state, preventing unauthorized tampering.

### GitHub Actions Workflow Concurrency Lock
The `.github/workflows/pet-activity.yml` workflow enforces a strict single-runner execution queue:

```yaml
concurrency:
  group: pet-runtime-${{ github.repository }}
  cancel-in-progress: false
```

`cancel-in-progress: false` ensures every event executes sequentially to completion, preventing race conditions or split-brain state conflicts.

### Manifest Boundary Protection
The activity processor commits ONLY to the explicit manifest allowlist:
- `pet/state/pet.json`
- `pet/ledger/activity.json`
- `public/pet.svg`
- `README.md`

`git add .` or wildcard staging is strictly prohibited. All commits carry `[skip ci]` to prevent cyclical runner triggers.
