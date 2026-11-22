# Sprint 4.3 — Security & Operational Readiness Audit

**Audit Date:** 2026-11-22  
**Target Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Target Candidate HEAD:** `990607837ac95617411190fd15cf895793cfcebd`  

---

## 1. Authentication, Authorization & Identity Boundaries

### Visitor Mode (Default Unauthenticated)
- **Security Boundary:** All unauthenticated users accessing the hosted game or viewing the repository README are placed into **Visitor Mode**.
- **Read-Only Invariant:** Visitor Mode can never trigger GitHub repository writes, open issues, modify files, or change canonical pet state.
- **Local Sandbox Simulation:** Any care actions performed in Visitor Mode operate strictly on ephemeral client-side memory or local browser storage.

### Trainer Mode (Authenticated)
- **Token Handling:** If a user chooses to connect their personal GitHub Personal Access Token (classic `repo` scope or fine-grained issue dispatch scope) to trigger real care actions via GitHub Issues:
  - **Volatile In-Memory Storage:** Tokens are held strictly in React component state (`useState`).
  - **Zero Persistent Storage:** Tokens are **never written** to `localStorage`, `sessionStorage`, cookies, IndexedDB, or server logs.
  - **Active Purge:** On application load, `loadRepoConfig` actively searches `localStorage` and purges any legacy token string found.
  - **Automatic Expiration:** Refreshing or closing the browser tab immediately wipes the token from memory.

### Actor Attribution & Trust Model
- Commit authors, pushers, and issue creators are treated as untrusted strings in client-side code.
- Canonical state advancement occurs only on GitHub Actions runners executing with authenticated `GITHUB_TOKEN` credentials under lockstep concurrency locks.

---

## 2. Input Validation & Anti-Exploit Controls

### Care Action Payload Validation (`tests/unit/actionValidation.test.ts`)
1. **Type Checking:** All payloads must be JSON objects with a valid care action type (`feed`, `play`, `train`, `rest`, `pet`). Non-object or unknown types are rejected.
2. **Client Action ID Bounds:** `clientActionId` must be a non-empty string with maximum length of 64 characters. Whitespace is strictly trimmed.
3. **Replay Protection:** Duplicate `clientActionId` submissions within the same session or batch are rejected without awarding rewards or advancing cooldowns.

### Gamification Anti-Exploit Economics (`tests/unit/xpAccountingAccuracy.test.ts`)
1. **Daily Cap:** Total daily activity XP is hard-capped at 300 XP. Any qualifying events received after reaching 300 XP earn 0 XP.
2. **Diminishing Returns:** Care actions enforce cooldown timers (e.g. 15 minutes for Train, 5 minutes for Feed). Actions performed while on cooldown yield zero rewards.
3. **Boundary Clamping:** If an event rewards 15 XP but only 5 XP remains before reaching the 300 XP daily cap, the award is clamped to exactly 5 XP.

---

## 3. GitHub API Telemetry & Rate-Limit Protection

1. **GraphQL Single-Request Guarantee:** The contribution snapshot query dispatches exactly one aliased GraphQL query requesting 2-day contribution data, minimizing API quota usage.
2. **Rate Limit Consistency:** Measures actual point cost and remaining quota from response headers (`x-ratelimit-remaining`) and GraphQL payload (`rateLimit.cost`).
3. **Safe Deferral:** If rate limit drops below 100 points against a 5,000-point ceiling, accounting safely defers with zero mutations.

---

## 4. Secret & Credential Leakage Audit

Executed rigorous pattern searches across the candidate codebase:
```powershell
git grep -E "ghp_[A-Za-z0-9_]{36}|github_pat_[A-Za-z0-9_]{82}|BEGIN [A-Z ]+ PRIVATE KEY"
```
**Audit Result:**
- **Zero Real Secrets Found.**
- Only 2 explicit mock test tokens exist inside isolated unit test files (`tests/pet-engine/twoDayContributionProvider.test.ts` and `tests/unit/tokenSecurityHardening.test.ts`).
- File system audit confirms zero `.env`, `.env.local`, or `.env.production` files exist on disk (only `.env.example` is tracked).

---

## 5. Dependency & Supply Chain Security

- **Zero Added Runtime Dependencies:** The candidate uses Next.js 16.4.6, React 19, Tailwind CSS 4, and native Node.js 22 built-in libraries (`node:test`, `node:fs/promises`, `node:crypto`).
- **No Third-Party Analytics / Trackers:** Zero external tracking scripts, ad pixels, or telemetry beacons are injected into the frontend.
- **Audio Synthesizer:** Implemented via browser-native Web Audio API (`AudioContext`); requires no external audio assets or audio decoding libraries.

---

## 6. Audit Verdict

| Security Vector | Assessment | Risk Level | Status |
| :--- | :--- | :--- | :--- |
| **Token Volatility** | In-memory only; verified by automated tests | Low | **PASS** |
| **Secret Leakage** | Clean grep audit; no .env files tracked | Low | **PASS** |
| **Input Sanitization** | Strict payload validation & regex sanitization | Low | **PASS** |
| **API Quota Protection** | Rate limit telemetry & safe deferral | Low | **PASS** |
| **Transaction Safety** | Multi-document journal with crash recovery | Low | **PASS** |
| **Visitor Sandbox** | Read-only local simulation | Low | **PASS** |

**Overall Security Rating:** **PRODUCTION HARDENED (PASS)**
