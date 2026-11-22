# Sprint 5.0A — Workflow Security & Telemetry Safety Review

## Security Review Scope

This review evaluates the security properties of GitHub Actions execution telemetry introduced in Sprint 5.0A across `src/features/pet-engine/reporting/stepSummary.ts`, `scripts/process-activity.ts`, `scripts/publish-pipeline.ts`, and `scripts/process-inbox.ts`.

---

## 1. Threat Modeling & Mitigation Analysis

### 1.1 Credential & Secret Leakage into Step Summaries
**Threat:** Workflows access sensitive repository secrets (`GITHUB_TOKEN`, personal access tokens, developer credentials). If error messages, HTTP request dumps, or exception traces are directly rendered into `$GITHUB_STEP_SUMMARY`, tokens could be exposed in the GitHub Actions UI.

**Mitigation:**
- Multi-layer regex secret scrubbing in `sanitizeSecrets(text)`:
  - Classic personal access tokens (`ghp_[a-zA-Z0-9]{20,}`) are replaced with `***REDACTED***`.
  - Fine-grained tokens (`github_pat_[a-zA-Z0-9_]{20,}`) are replaced with `***REDACTED***`.
  - OAuth access tokens (`gho_[a-zA-Z0-9]{20,}`) are replaced with `***REDACTED***`.
  - Authorization headers (`Bearer <token>`, `token <token>`) have their values scrubbed.
- `escapeMarkdown(text)` calls `sanitizeSecrets(text)` before any Markdown formatting is applied.
- All error summaries (`formatActivityFailureSummary`, `formatPublisherFailureSummary`, `formatInboxFailureSummary`) pipe raw error strings through `escapeMarkdown()`.
- Verified in unit suite: `tests/unit/stepSummary.test.ts` (Secret Sanitization category).

### 1.2 Markdown & HTML Injection
**Threat:** Untrusted inputs provided by external GitHub users (e.g. Git commit messages, Pull Request titles, Issue titles, user logins) may contain Markdown syntax (`|`, `---`, `\n`) that breaks table columns, or HTML tags (`<script>`, `<img onerror=...>`) intended for cross-site scripting (XSS) or visual spoofing.

**Mitigation:**
- `escapeMarkdown(text)` neutralizes table corruption:
  - Table pipe characters (`|`) are escaped to `\|`.
  - Angle brackets (`<`, `>`) are escaped to `&lt;` and `&gt;`.
  - Line breaks within table cells (`\r\n`, `\n`) are replaced with `<br/>` to maintain row integrity without altering cell structure.
- Actor logins are wrapped in code spans (e.g. `` `@${escapeMarkdown(actor)}` ``) to prevent mention pinging or formatting breakage.
- Event identifiers are clamped to 36 characters with ellipsis (`…`) to avoid table layout distortion.

### 1.3 Telemetry Denial-of-Service / Workflow Failure Coupling
**Threat:** If `$GITHUB_STEP_SUMMARY` writing fails (e.g., due to disk quota exhaustion, runner file lock, or permissions error), the exception could crash the workflow, causing a successful game state transition or git push to be marked as failed.

**Mitigation:**
- `writeStepSummary` is explicitly designed as a **fail-safe, non-throwing** function.
- All file system operations (`fs.appendFileSync`) are enclosed in a `try/catch` block.
- Any write failure logs a diagnostic warning (`console.warn('[STEP_SUMMARY] ...')`) and safely returns `false`.
- State transactions, Git staging, and pushes are decoupled from summary generation.

### 1.4 Principle of Least Privilege in Workflows
**Threat:** Workflows granted excessive permissions (`contents: write`, `issues: write`, `pull-requests: write`, etc.) risk privilege escalation.

**Audit of Workflow Permissions:**
- `.github/workflows/pet-activity.yml`:
  - `contents: write` (required for committing state updates to target branch).
  - `issues: read` (read-only for inspecting issue opened events).
  - `pull-requests: read` (read-only for inspecting PR events and reviews).
- `.github/workflows/pet-publisher.yml`:
  - `contents: write` (required for committing generated SVG badge and state).
- `.github/workflows/pet-interaction.yml`:
  - `contents: write` (required for committing pet care action transitions).
  - `issues: write` (required for posting feedback comments and closing action issues).
- Telemetry modules do not request or require additional GitHub API scopes.

---

## 2. Compliance Checklist

| Security Control | Verification Status | Evidence |
| :--- | :--- | :--- |
| **Token Redaction** | ✅ PASS | Verified against `ghp_`, `github_pat_`, `gho_`, `Bearer` |
| **XSS / HTML Escaping** | ✅ PASS | All `<`, `>` escaped to `&lt;`, `&gt;` |
| **Markdown Integrity** | ✅ PASS | Pipes escaped `\|`, newlines formatted `<br/>` |
| **Exception Decoupling**| ✅ PASS | `writeStepSummary` never throws; state transactions preserved |
| **Clean Dependency Tree**| ✅ PASS | Zero new external npm packages; zero legacy DB imports |
