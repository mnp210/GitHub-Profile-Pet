# Phase 3C2.1-V.5.2.1.2 — Strict ISO-8601 Reset Timestamp Validation Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Target Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Target Branch:** `main`  
**Baseline Publication Commit:** `1dac52b469145d831f63f084b87d5b7d5c8db1b8`  
**Status:** COMPLETE (Awaiting Review; Zero Git/Workflow Mutations)  

---

## 1. Executive Summary

This milestone applies a narrowly scoped hardening to the rate-limit telemetry validation in `src/features/pet-engine/contribution/contributionProvider.ts`. 

Previously, `rateLimit.resetAt` was checked using JavaScript's native `new Date(resetAt).getTime()`. Because JavaScript Date parsing rolls over out-of-range calendar dates (for example, parsing `'2026-02-31'` into March 3rd, and accepting date-only strings like `'2026-11-16'` without a time or timezone), it was possible for incomplete or impossible calendar strings to pass validation undetected.

With this correction:
1. **Explicit Timezone Enforcement:** `resetAt` must be a complete ISO-8601 date-time ending with an explicit UTC designator (`Z`) or a valid numeric offset (`±HH:MM`). Date-only, year-only, and timezone-less strings are strictly rejected.
2. **Deep Calendar & Time Component Validation:** Component values are extracted and verified against real calendar rules rather than relying on JavaScript Date parseability. Impossible calendar dates (such as February 31st, February 29th on non-leap years, April 31st, November 31st, or month 13) are rejected.
3. **Offset Syntax & Range Verification:** Offsets must strictly conform to `[+-](00-23):(00-59)`. Malformed offsets (e.g. `+25:00`, `-05:60`, `+05`, `+5:00`, `Z123`) are rejected.
4. **Valid Formats Preserved:** Standard UTC timestamps (`Z`), fractional-second timestamps (`.sssZ`), valid positive/negative numeric offsets (`+05:30`, `-08:00`), and leap-year February 29ths (`2024`, `2000`) validate cleanly.
5. **Two-Second Tolerance Preserved with Rationale:** The maximum 2-second tolerance comparing `resetAt` against HTTP transport header `x-ratelimit-reset` is preserved and documented.

---

## 2. Code Changes

### File: `src/features/pet-engine/contribution/contributionProvider.ts`

1. **Authored and Exported `isValidIsoDateTimeWithExplicitTimezone(val: string): boolean`**:
   - Enforces regex: `/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/`.
   - Validates month range $[1, 12]$.
   - Computes exact days in month including standard leap-year rules (`(year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)`).
   - Validates day range $[1, \text{daysInMonth}]$.
   - Validates hour $[0, 23]$, minute $[0, 59]$, and second $[0, 59]$.
   - Verifies JavaScript Date timestamp parseability (`!isNaN(new Date(...).getTime())`).
2. **Updated `checkRateLimitConsistency()`**:
   - Replaced loose `isNaN(new Date(resetAt).getTime())` check with `isValidIsoDateTimeWithExplicitTimezone(payloadRateLimit.resetAt)`.
   - Produces explicit discrepancy message: `Invalid GraphQL rateLimit.resetAt: expected complete ISO-8601 date-time with explicit timezone (Z or ±HH:MM) and valid calendar date, received "${payloadRateLimit.resetAt}".`
   - Preserved maximum 2-second comparison tolerance with documented rationale.

---

## 3. Comparison Tolerance Rationale

In `checkRateLimitConsistency()`, the GraphQL body `resetAt` timestamp is compared against the HTTP response header `x-ratelimit-reset`:

$$\Delta t = |\text{floor}(\text{epochSeconds}(\text{resetAt})) - \text{headerReset}| \le 2\text{s}$$

### Technical Rationale:
1. **Sub-Second Fraction Truncation:** The GraphQL body serializes `DateTime` as an ISO-8601 string (potentially containing sub-second fractions), while the HTTP transport header `x-ratelimit-reset` is serialized as integer Unix epoch seconds. Converting an ISO string to integer seconds via `Math.floor()` truncates millisecond fractions.
2. **Upstream Serialization Boundary Crossings:** In high-throughput cloud environments, generating HTTP headers and formatting GraphQL JSON bodies can span sub-second clock ticks.
3. **Drift Prevention:** A tolerance of $\le 2$ seconds accommodates sub-second boundary truncation and minor serialization jitter while strictly preventing minute, hour, or day clock drift from passing.

---

## 4. Test Cases & Validation Results

### Focused Unit Tests in `tests/pet-engine/contributionProvider.test.ts`

| Test ID | Description | Tested Value | Result |
| :--- | :--- | :--- | :---: |
| **TC-PROV-39** | Rejects date-only strings | `'2026-11-16'` | ✅ PASS |
| **TC-PROV-40** | Rejects year-only strings | `'2026'` | ✅ PASS |
| **TC-PROV-41** | Rejects missing timezones | `'2026-11-16T15:00:00'` | ✅ PASS |
| **TC-PROV-42** | Rejects impossible calendar dates | `'2026-02-31T15:00:00Z'` (Feb 31)<br>`'2025-02-29T12:00:00Z'` (non-leap)<br>`'1900-02-29T12:00:00Z'` (century non-leap)<br>`'2026-04-31T10:00:00Z'` (April 31)<br>`'2026-11-31T00:00:00Z'` (Nov 31)<br>`'2026-13-01T00:00:00Z'` (Month 13)<br>`'2026-00-10T00:00:00Z'` (Month 00)<br>`'2026-05-00T00:00:00Z'` (Day 00) | ✅ PASS |
| **TC-PROV-43** | Rejects empty and whitespace-only strings | `''`, `'   '` | ✅ PASS |
| **TC-PROV-44** | Rejects malformed timezone offsets | `'+25:00'` (hour > 23)<br>`'-05:60'` (min >= 60)<br>`'+05'` (missing minutes)<br>`'+5:00'` (single digit)<br>`'Z123'` (trailing garbage) | ✅ PASS |
| **TC-PROV-45** | Preserves valid UTC and numeric-offset timestamps | `'2026-11-16T15:00:39Z'` (UTC)<br>`'2026-11-16T15:00:39.123Z'` (fractional)<br>`'2026-11-16T20:30:39+05:30'` (positive offset)<br>`'2026-11-16T07:00:39-08:00'` (negative offset)<br>`'2024-02-29T12:00:00Z'` (leap year 2024)<br>`'2000-02-29T00:00:00Z'` (leap year 2000) | ✅ PASS |
| **TC-PROV-46** | Preserves maximum 2-second tolerance with numeric-offset conversion | Exact match ($\Delta = 0\text{s}$): PASS<br>Within tolerance ($\Delta = 2\text{s}$): PASS<br>Exceeds tolerance ($\Delta = 3\text{s}$): Discrepancy flagged | ✅ PASS |

---

## 5. Verification Matrix

| Verification Step | Command | Result |
| :--- | :--- | :---: |
| **Pet Engine Suite** | `npm run test:pet-engine` | ✅ **273 / 273 PASS** (19 suites, 0 failures) |
| **Unit Test Suite** | `npm test` | ✅ **121 / 121 PASS** (24 suites, 0 failures) |
| **TypeScript Typecheck** | `npx tsc --noEmit` | ✅ **0 errors** |
| **ESLint Check** | `npm run lint` | ✅ **0 errors, 0 warnings** |
| **Next.js Production Build** | `npm run build` | ✅ **14 / 14 static pages generated** |

---

## 6. Scope Confirmation

- **Zero Git Mutations:** No commits (`git commit`), staging (`git add`), or pushes (`git push`) were performed. Changes remain in the local working tree.
- **Zero Workflow Dispatches:** No GitHub Actions runs were triggered.
- **Contract & Boundary Integrity:** Unrelated validation rules, provider contracts, workflow files, pet state, ledgers, reward accounting, and contribution synchronization remain 100% untouched.
