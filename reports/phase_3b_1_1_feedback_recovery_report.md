# Phase 3B.1.1 Engineering Report: Feedback Delivery Idempotency & Queue-Bound Verification

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Milestone:** Phase 3B.1.1 — Feedback Delivery Idempotency & Queue-Bound Verification  
**Status:** Verification Passed • All 239 Tests Green • Ready for Review  

---

## 1. Executive Summary

Phase 3B.1.1 resolves the feedback-recovery correctness gap and establishes deterministic bounds on inbox drainage.

Previously, recovery logic relied on comment count heuristics (`commentsCount > 0` or `comments >= 1`) to determine whether user feedback had been delivered. If an ordinary user or third-party bot commented on the issue before the pet processor ran, the engine could falsely assume pet feedback was complete and close the issue without the companion ever responding. Furthermore, network timeouts during comment creation could leave issues open or cause ambiguous retry behaviors.

In Phase 3B.1.1, the engine was hardened with:
1. **Deterministic Feedback Markers:** Unique, immutable HTML markers (`<!-- pet-action-feedback:issue-${issueNumber} -->`) tied to the issue number.
2. **Strict Bot Author Verification:** Comments are recognized as pet feedback if and only if they contain the expected marker **and** their author is verified as `github-actions[bot]`, `[bot]`, or `type === 'Bot'`. Forged markers posted by ordinary users are strictly rejected.
3. **Resilient Feedback Protocol with Ambiguous Timeout Recovery:** Comments are pre-inspected to avoid duplicates. If a submission throws (e.g. upstream timeout after GitHub committed the comment), the issue comments are immediately re-inspected to verify whether the comment landed before failing.
4. **Decoupled State Mutation:** Gameplay state changes are persisted to disk atomically **prior** to attempting feedback. If comment creation fails or times out, the action is durably committed in `processedRequestRegistry` and is never re-applied on subsequent sweeps; the subsequent sweep simply discovers the committed action, delivers the missing feedback, and closes the issue.
5. **Bounded Pagination & Starvation Prevention:** Enforces max page counts (`maxPages: 5`, `perPage: 100`), batch size limits (`maxIssuesPerBatch: 50`), and execution deadlines (`timeBudgetMs: 240_000`). All issues are processed in strict `created_at ASC, number ASC` order, guaranteeing that older issues are drained first and can never be starved by newer submissions.

---

## 2. Architecture & Implementation Details

### 2.1 Feedback Marker & Author Verification (`src/features/pet-engine/inbox/feedbackMarker.ts`)

Every comment posted by the pet engine embeds an immutable marker:
```ts
export function getActionFeedbackMarker(issueNumber: number): string {
  return `<!-- pet-action-feedback:issue-${issueNumber} -->`;
}
```

When evaluating existing comments on an issue:
```ts
export function isBotAuthoredFeedback(
  comment: GitHubIssueComment,
  expectedMarker: string,
  botLogin?: string
): boolean {
  if (!comment || typeof comment.body !== 'string') return false;
  if (!comment.body.includes(expectedMarker)) return false;

  const authorLogin = comment.user?.login?.toLowerCase() ?? '';
  const authorType = comment.user?.type?.toLowerCase() ?? '';

  if (botLogin && authorLogin === botLogin.toLowerCase()) return true;
  if (authorLogin === 'github-actions[bot]' || authorLogin.endsWith('[bot]')) return true;
  if (authorType === 'bot') return true;

  // Any other author (e.g. user attempting to forge marker) is strictly rejected
  return false;
}
```

### 2.2 Resilient Delivery Protocol (`deliverFeedbackWithConfirmation`)

```
   ┌────────────────────────────────────────┐
   │ Check Existing Comments for Bot Marker │
   └───────────────────┬────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
[Marker Found]                [Marker Not Found]
  Skip post                     Attempt client.commentIssue()
  Return true (Confirmed)                    │
                               ┌─────────────┴─────────────┐
                               ▼                           ▼
                           [Success]                    [Error / Timeout]
                         Return true                  Re-inspect comments
                                                      (Ambiguous resolution)
                                                               │
                                                 ┌─────────────┴─────────────┐
                                                 ▼                           ▼
                                           [Marker Found]             [Marker Not Found]
                                             Return true                 Return false
                                             (Confirmed)                (Leave issue open)
```

- If delivery is **confirmed**, `closeIssue` is called with the appropriate outcome label (`pet-action:completed`, `pet-action:rejected`, `pet-action:invalid`, `pet-action:unauthorized`, `pet-action:quarantine`).
- If delivery **fails or is unconfirmed**, the issue is **never closed**. It remains open in the inbox for the next scheduled sweep to deliver feedback.

### 2.3 Independent State Mutation Guarantee

In `src/features/pet-engine/inbox/actionProcessor.ts`:
1. When an action is evaluated and transition succeeds/fails:
   - In-memory state and `processedRequestRegistry` are updated.
   - `persistCurrentState()` writes the changes atomically to disk via `saveRepositoryState`.
   - Only **after** disk persistence succeeds is `deliverFeedbackWithConfirmation()` called.
2. If the runner crashes or comment creation fails:
   - Next sweep inspects the issue.
   - `scanPendingActions` detects the issue number in `state.actions.processedRequestRegistry`.
   - Issue is classified as `already_processed`.
   - Zero state mutation occurs (no XP, hunger, or energy changes).
   - `deliverFeedbackWithConfirmation()` delivers the pending feedback and closes the issue.

### 2.4 Bounded Drainage & Starvation Prevention

In `src/features/pet-engine/inbox/inboxScanner.ts` and `actionProcessor.ts`:
- **Pagination Bounds:** `listPendingIssues` accepts `maxPages` (default: 5) and `perPage` (default: 100), fetching at most 500 issues per run. If additional issues exist on GitHub, `hasMorePending` is set to `true`.
- **Execution Budget:** `timeBudgetMs` (default: 240,000 ms / 4 min) and `maxIssuesPerBatch` (default: 50) ensure workflows never hit GitHub Actions timeouts.
- **Starvation Invariant:** Scanned issues are merged and sorted strictly by `(a.eventTimestampMs - b.eventTimestampMs) || (a.issueNumber - b.issueNumber)`. The oldest issues in the repository are always processed first. Partial batches never skip older issues.

---

## 3. Regression Test Matrix (TC-INBOX-25 to TC-INBOX-35)

The test suite in [inboxProcessing.test.ts](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/inboxProcessing.test.ts) was extended with 11 targeted regression tests:

| Test ID | Objective | Verified Invariant |
|---|---|---|
| **TC-INBOX-25** | Pre-existing user comment before action | Pet ignores user comment and delivers genuine bot feedback comment with marker; closes issue. |
| **TC-INBOX-26** | Forged feedback marker in user comment | User comment containing `<!-- pet-action-feedback:issue-101 -->` is rejected as feedback. Bot posts genuine verified comment. |
| **TC-INBOX-27** | Pre-existing verified bot feedback comment | Recovery sweep discovers existing bot comment with marker; skips duplicate comment; closes issue. |
| **TC-INBOX-28** | Ambiguous comment submission timeout | Upstream created comment before socket timeout. Engine re-inspects comments, confirms creation, and closes issue. |
| **TC-INBOX-29** | Genuine comment creation failure | Comment fails to submit. Issue remains open. Next sweep discovers committed action, posts feedback, and closes issue with zero double-mutation. |
| **TC-INBOX-30** | Feedback exists but closure previously crashed | Recovery sweep closes issue immediately without re-executing action or posting duplicate comment. |
| **TC-INBOX-31** | Repeated recovery sweeps idempotency | Running sweeps 2 and 3 on drained state produces 0 mutations, 0 comments, and maintains exact generation parity. |
| **TC-INBOX-32** | Multiple pre-existing user comments | 3 user comments exist. Pet adds 4th comment (bot feedback) and closes issue; never closes without bot response. |
| **TC-INBOX-33** | Queue pagination bounds | Evaluates `maxPages` and returns `queueDrained: false`, `hasMorePending: true` when issues exceed fetch limits. |
| **TC-INBOX-34** | Time budget & batch limits | With `maxIssuesPerBatch: 2`, stops after 2 issues, defers remaining issues, sets `hasMorePending: true`, `queueDrained: false`. |
| **TC-INBOX-35** | Chronological starvation prevention | Given issues submitted at 10:00, 10:05, and 10:10 with `batchSize: 1`, sweeps process 401 first, then 402, then 403. |

---

## 4. Verification Evidence

### 4.1 Test Suites Execution
```
$ npm run test:pet-engine
ℹ tests 118
ℹ suites 9
ℹ pass 118
ℹ fail 0
ℹ duration_ms 3676.778

$ npm test
ℹ tests 121
ℹ suites 24
ℹ pass 121
ℹ fail 0
ℹ duration_ms 1247.1113

$ npm run test:all
ℹ tests 239
ℹ suites 33
ℹ pass 239
ℹ fail 0
ℹ duration_ms 4463.3245
```

### 4.2 Lint & Type Checking
```
$ npm run lint
> eslint (exited 0 with zero warnings/errors)

$ npx tsc --noEmit
(exited 0 with zero type errors)
```

### 4.3 Production Build & CLI Verification
```
$ npm run build
✓ Compiled successfully in 2.0s
✓ Generating static pages using 11 workers (14/14) in 1175ms

$ npm run render:svg
[render-svg] Successfully generated standalone SVG (12441 bytes) at: public\pet.svg

$ npm run publish:pet
[publish-pet] Publication completed successfully.

$ npm run process:inbox
[process-inbox] Drainage complete.
[process-inbox] Total Scanned: 0
[process-inbox] Actions Processed: 0
[process-inbox] Queue Status: Drained=true, HasMorePending=false
```

---

## 5. Artifact Summary

| File | Purpose |
|---|---|
| [feedbackMarker.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/inbox/feedbackMarker.ts) | Marker generation, bot author verification, and confirmed delivery protocol. |
| [types.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/inbox/types.ts) | Added `GitHubIssueComment`, `PendingIssuesPageResult`, and queue status fields. |
| [gitHubClient.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/inbox/gitHubClient.ts) | Paginated `listPendingIssues` and `listIssueComments` implementations. |
| [inboxScanner.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/inbox/inboxScanner.ts) | Paginated scan unwrap and queue status propagation. |
| [actionProcessor.ts](file:///D:/Projects/GitHub-Profile-Pet/src/features/pet-engine/inbox/actionProcessor.ts) | Chronological bounded queue processing, decoupled persistence, and confirmed feedback closure. |
| [process-inbox.ts](file:///D:/Projects/GitHub-Profile-Pet/scripts/process-inbox.ts) | CLI queue status logging. |
| [inboxProcessing.test.ts](file:///D:/Projects/GitHub-Profile-Pet/tests/pet-engine/inboxProcessing.test.ts) | 11 new regression tests (TC-INBOX-25 to TC-INBOX-35). |

---

## 6. Conclusion & Status

Phase 3B.1.1 is fully verified. Feedback recovery is completely decoupled from comment count heuristics, forged markers are safely eliminated, ambiguous comment outcomes are resolved deterministically, and queue drainage is strictly bounded to prevent workflow timeouts or issue starvation.
