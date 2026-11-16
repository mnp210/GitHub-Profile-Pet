# Phase 3C2.1-V.5.2.1.1 — Strict Rate-Limit Telemetry Validation Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Target Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Target Branch:** `main`  
**Starting Commit:** `1dac52b469145d831f63f084b87d5b7d5c8db1b8`  
**Status:** COMPLETE (Awaiting Review; Zero Git/Workflow Mutations)  

---

## 1. Executive Summary

This milestone hardens rate-limit telemetry extraction, HTTP response header parsing, and cross-consistency validation so that missing, malformed, incomplete, or contradictory telemetry cannot be reported as consistent. 

Previously, certain missing or malformed telemetry fields (such as missing `cost`, missing `remaining`, or partially numeric headers like `'5000abc'`) were either silently defaulted (e.g. `cost: 1`, `remaining: 0`) or loosely parsed via JavaScript's `parseInt()`, which allowed trailing alphanumeric characters to pass undetected. Furthermore, missing GraphQL `rateLimit` objects or missing HTTP response headers did not explicitly trigger a fail-closed status in all execution paths.

With this hardening in place:
1. **Zero Silent Defaults:** Missing or non-integer GraphQL body fields are stored strictly as `null` and flagged as explicit discrepancies.
2. **Strict Integer Header Parsing:** A dedicated parser (`parseStrictHeaderInteger`) rejects partially numeric values (`5000abc`), negative values (`-10`), decimals (`3.14`), and whitespace-only strings, while preserving the raw string representation for discrepancy auditing.
3. **Comprehensive Invariant Checking:** Field bounds (`limit > 0`, `cost > 0`, `remaining >= 0`, `used >= 0`), ceiling constraints (`remaining <= limit`, `used <= limit`), internal sum overflow (`used + remaining <= limit`), ISO-8601 timestamp validity, and resource type (`resource === 'graphql'`) are rigorously validated.
4. **Diagnostic Fail-Closed Enforcement:** `scripts/probe-github-contributions.ts` fails closed with exit code 1 if `snapshot.rateLimit` is absent or if any consistency discrepancy is detected.
5. **No Hardcoded Quotas:** The validation engine does not assume or enforce any specific quota (e.g. 1,000 or 5,000). Both 1,000, 5,000, and enterprise quotas (e.g. 15,000) validate cleanly as long as the upstream values are self-consistent and valid.

---

## 2. Files Changed

| File Path | Description of Changes |
| :--- | :--- |
| `src/features/pet-engine/contribution/types.ts` | Updated `RateLimitHeaders` to capture `raw` header strings alongside parsed numbers. Updated `RateLimitInfo` so fields are nullable (`number \| null`, `string \| null`) rather than defaulted. Updated `RawGraphQLContributionResponse` rateLimit definition. |
| `src/features/pet-engine/contribution/nativeGraphQLClient.ts` | Added and exported `parseStrictHeaderInteger()` using strict regex `/^\d+$/`. Updated `executeSingleAttempt` to populate both strictly parsed integer headers and `raw` header strings. |
| `src/features/pet-engine/contribution/contributionProvider.ts` | Hardened `checkRateLimitConsistency()` to validate all 5 GraphQL body fields, all 5 HTTP headers, ceiling/overflow invariants, timestamp validity, and cross-consistency. Updated `parseAndValidateContributionResponse()` to eliminate silent defaults (`cost: 1`, `remaining: 0`, `resetAt: ''`). |
| `scripts/probe-github-contributions.ts` | Hardened diagnostic execution: initializes `isTelemetryConsistent = false`, records failure if `!snapshot.rateLimit`, formats missing/malformed headers in Markdown step summary, and exits with code 1 on discrepancy. |
| `tests/pet-engine/contributionProvider.test.ts` | Added unit tests `TC-PROV-27` through `TC-PROV-38` testing missing payload, missing individual fields, invalid/negative values, missing headers, individual missing headers, malformed headers (`5000abc`), non-graphql resources, body/header mismatches, invalid timestamps, quota neutrality, probe exit failure, and token redaction. |
| `tests/pet-engine/nativeGraphQLClient.test.ts` | Added unit tests verifying `parseStrictHeaderInteger` rejection of partially numeric strings and preservation of raw strings in `onResponseHeaders`. |

---

## 3. Previous Validation Gaps vs. New Fail-Closed Behavior

| Validation Dimension | Previous Behavior (V.5.2.1) | New Hardened Behavior (V.5.2.1.1) |
| :--- | :--- | :--- |
| **Missing GraphQL `rateLimit`** | `isTelemetryConsistent` remained `true` in probe; `checkRateLimitConsistency` returned `{ isConsistent: true }` when payload was missing. | `checkRateLimitConsistency` records `'Missing GraphQL rateLimit telemetry in response payload.'` and returns `isConsistent: false`. Probe exits code 1. |
| **Missing `rateLimit.cost`** | Silently defaulted to `1`. | Parsed as `null`. Flagged with `'Missing or non-integer GraphQL rateLimit.cost.'`. |
| **Missing `rateLimit.remaining`** | Silently defaulted to `0`. | Parsed as `null`. Flagged with `'Missing or non-integer GraphQL rateLimit.remaining.'`. |
| **Missing `rateLimit.resetAt`** | Silently defaulted to `''`. | Parsed as `null`. Flagged with `'Missing or empty GraphQL rateLimit.resetAt timestamp.'`. |
| **Partially numeric headers (e.g. `'5000abc'`)** | `parseInt('5000abc', 10)` returned `5000`. Trailing characters were ignored. | `parseStrictHeaderInteger('5000abc')` returns `null`. Raw string `'5000abc'` is preserved. Flagged with `'Malformed HTTP header x-ratelimit-limit: expected positive integer string, received "5000abc"'.` |
| **Negative or zero limit/cost** | `limit: 0` or `cost: 0` were accepted without check. | Explicitly rejected: `limit <= 0` and `cost <= 0` produce `'Invalid GraphQL rateLimit.*: expected positive integer (> 0)'`. |
| **Negative remaining/used** | Negative counts were not checked. | Explicitly rejected: `remaining < 0` and `used < 0` produce `'expected non-negative integer (>= 0)'`. |
| **Ceiling Violations** | `remaining > limit` or `used > limit` were not checked. | Explicitly rejected: flags `'GraphQL rateLimit.remaining (X) exceeds limit (Y)'`. |
| **Internal Sum Overflow** | `used + remaining > limit` was not checked. | Explicitly rejected: flags `'Internal sum overflow: GraphQL body used + remaining exceeds limit'`. |
| **Invalid Timestamp** | Any string was accepted (even `'invalid-date'`). | Validated with `!isNaN(new Date(resetAt).getTime())`. Malformed dates produce `'Invalid GraphQL rateLimit.resetAt: expected valid ISO timestamp'`. |
| **Resource Header** | Non-graphql headers were not validated. | `headers.resource !== 'graphql'` produces `'Invalid HTTP header x-ratelimit-resource: expected "graphql", received "${resource}"'`. |
| **Quota Expectation** | Neutral (no hardcoding). | **Strictly Neutral**: No quota (1,000 or 5,000) is hardcoded. Arbitrary positive integer quotas validate identically. |

---

## 4. Internal Invariant Analysis: `used + remaining` vs `limit`

Section 2, Requirement 7 states:
> *"Validate internal consistency where appropriate, including whether `used + remaining` agrees with `limit`. If GitHub's response semantics do not guarantee an exact equality, document that and do not invent a stricter invariant."*

### Upstream GitHub Semantics
1. **Mathematical Invariant:**
   In any rate-limiting window, the points used plus the points remaining cannot exceed the total pool limit without an internal quota leak or reset synchronization bug. Therefore, **`used + remaining > limit` is strictly forbidden and flagged as a fatal discrepancy (`Internal sum overflow`)**.
2. **Exact Equality Considerations:**
   In normal quiescent conditions, GitHub GraphQL maintains exact conservation:
   - In Run #43881315505: $\text{used } (1) + \text{remaining } (4999) = 5000 = \text{limit}$.
   - In Run #43884639634: $\text{used } (2) + \text{remaining } (4998) = 5000 = \text{limit}$.
   However, GitHub's API documentation notes that under secondary rate limiting, concurrent requests in-flight, or token pooling across multiple runners, `x-ratelimit-remaining` may decrement before `x-ratelimit-used` commits, or tier adjustments may yield a transient sum $< \text{limit}$.
   Therefore, the validation engine enforces $\text{used} + \text{remaining} \le \text{limit}$, flagging mathematical overflows while not inventing an un-documented strict equality rule that would fail valid GitHub upstream responses under concurrent traffic.

---

## 5. Provider Contract Stability

- **Core Signature Unchanged:**
  `fetchUserContributionSnapshot(login, from, to, token, options)` retains its exact public signature and return type (`GitHubContributionSnapshot`).
- **Zero-Dependency Guarantee Preserved:**
  All changes in `nativeGraphQLClient.ts` rely exclusively on standard ECMAScript / Node 22 built-ins (RegExp, Number, Math, Date). No external dependencies (`pg`, `axios`, etc.) were introduced.
- **Fail-Closed Diagnostic Decoupling:**
  The contribution provider attaches `snapshot.rateLimit.consistency`, allowing diagnostics to fail closed when evaluating system health without breaking non-diagnostic callers that do not require HTTP transport headers.
- **Token Redaction:**
  All error paths, consistency discrepancy messages, and log formatters sanitize access tokens using `redactSensitiveData()`.

---

## 6. Test Cases & Validation Results

### A. New Test Manifest (Tests 27–38 in `contributionProvider.test.ts` & Tests in `nativeGraphQLClient.test.ts`)

| Test ID | Description | Result |
| :--- | :--- | :---: |
| **TC-PROV-27** | Entire GraphQL `rateLimit` object missing fails consistency check with explicit discrepancy | ✅ PASS |
| **TC-PROV-28** | Each required GraphQL field missing individually produces an explicit discrepancy (`limit`, `cost`, `remaining`, `used`, `resetAt`) | ✅ PASS |
| **TC-PROV-29** | Invalid, non-integer, negative, or overflow GraphQL values fail consistency (`limit <= 0`, `cost <= 0`, `remaining < 0`, `used < 0`, `remaining > limit`, `used > limit`, `used + remaining > limit`) | ✅ PASS |
| **TC-PROV-30** | Missing HTTP headers object fails consistency check with explicit discrepancy | ✅ PASS |
| **TC-PROV-31** | Each required HTTP header missing individually produces an explicit discrepancy (`limit`, `remaining`, `used`, `reset`, `resource`) | ✅ PASS |
| **TC-PROV-32** | `parseStrictHeaderInteger` and `checkRateLimitConsistency` reject partially numeric strings (`5000abc`, `abc5000`, `12.34`, `-10`, `""`) | ✅ PASS |
| **TC-PROV-33** | Non-graphql resource header (e.g. `'core'`) produces an explicit discrepancy | ✅ PASS |
| **TC-PROV-34** | Discrepancies flagged for body/header mismatches across every comparable field (`limit`, `remaining`, `used`, `reset` outside tolerance) | ✅ PASS |
| **TC-PROV-35** | Malformed reset timestamp string (e.g. `'invalid-iso-timestamp'`) fails ISO timestamp validation | ✅ PASS |
| **TC-PROV-36** | Valid telemetry passes without hardcoding 1,000 or 5,000 quota (verifies 1k, 5k, and 15k quotas) | ✅ PASS |
| **TC-PROV-37** | Diagnostic probe script fails closed with non-zero exit code on missing token or telemetry | ✅ PASS |
| **TC-PROV-38** | Token redaction preserves secrets across rate limit error telemetry failure paths | ✅ PASS |
| **TC-NAT-01** | `parseStrictHeaderInteger` unit tests in `nativeGraphQLClient.test.ts` validating integer strictness | ✅ PASS |
| **TC-NAT-02** | `onResponseHeaders` captures both parsed and raw headers, rejecting `'5000abc'` | ✅ PASS |

### B. Validation Suite Execution Matrix

| Verification Step | Command | Result |
| :--- | :--- | :---: |
| **Pet Engine Suite** | `npm run test:pet-engine` | ✅ **265 / 265 PASS** (19 suites, 0 failures) |
| **Unit Test Suite** | `npm test` | ✅ **121 / 121 PASS** (24 suites, 0 failures) |
| **TypeScript Typecheck** | `npx tsc --noEmit` | ✅ **0 errors** |
| **ESLint Check** | `npm run lint` | ✅ **0 errors, 0 warnings** |
| **Next.js Production Build** | `npm run build` | ✅ **14 / 14 static pages generated** |

---

## 7. Historical Evidence Preservation Confirmation

The measured telemetry from hosted Actions Run #`43884639634` (executed at commit `1dac52b469145d831f63f084b87d5b7d5c8db1b8`) remains fully preserved in `reports/phase_3c2_1_v5_2_1_rate_limit_reconciliation_report.md`:
- `rateLimit.limit`: `5000` points
- `rateLimit.cost`: `1` point
- `rateLimit.remaining`: `4998` points
- `rateLimit.used`: `2` points
- `rateLimit.resetAt`: `2026-11-16T15:00:39Z` (`x-ratelimit-reset`: `1794841239`)
- `x-ratelimit-resource`: `graphql`
- Under the newly hardened validation rules, the telemetry from Run #`43884639634` continues to evaluate as **100% valid and consistent** ($5000 > 0$, $1 > 0$, $4998 \ge 0$, $2 \ge 0$, $4998 + 2 = 5000 \le 5000$, $\Delta t = 0\text{s}$, `resource === 'graphql'`).

---

## 8. Confirmation of Strict Scope Restrictions

In adherence to the strict scope boundaries:
- **Zero Workflows Dispatched:** No workflow dispatch was triggered.
- **Zero Remote Mutations:** No Git staging (`git add`), commits (`git commit`), or pushes (`git push`) were performed. Working tree changes remain unstaged in the local workspace.
- **Zero Permission / Credential Changes:** Workflow permissions remain `contents: read`. No PAT, OAuth, GCM, or external secrets were introduced.
- **Zero Runtime / Ledger Mutations:** `pet/state/pet.json`, `pet/ledger/contributions.json`, schemas, reward accounting, and high-water marks remain 100% untouched.
- **Phase 3C2.2 Preserved:** No reward calculation or Phase 3C2.2 logic was implemented.
