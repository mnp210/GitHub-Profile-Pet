// scripts/probe-github-contributions.ts
// Standalone diagnostic probe to verify GitHub GraphQL public contribution API access and immutable identity

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GitHubContributionProvider,
  resolveTargetOwner,
  verifyOwnerIdentity,
  redactSensitiveData,
} from '../src/features/pet-engine/contribution/index.ts';

interface LedgerIdentityInspection {
  isInitialized: boolean;
  ownerDatabaseId: number | null;
  ownerLogin: string | null;
}

function inspectLedgerIdentity(repoRoot: string): LedgerIdentityInspection {
  const ledgerPath = path.join(repoRoot, 'pet', 'ledger', 'contributions.json');
  if (!fs.existsSync(ledgerPath)) {
    return { isInitialized: false, ownerDatabaseId: null, ownerLogin: null };
  }

  try {
    const content = fs.readFileSync(ledgerPath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const ownerDatabaseId = typeof parsed.ownerDatabaseId === 'number' ? parsed.ownerDatabaseId : null;
    const ownerLogin = typeof parsed.ownerLogin === 'string' ? parsed.ownerLogin : null;
    return {
      isInitialized: ownerDatabaseId !== null,
      ownerDatabaseId,
      ownerLogin,
    };
  } catch {
    return { isInitialized: false, ownerDatabaseId: null, ownerLogin: null };
  }
}

function writeStepSummary(markdown: string): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, markdown + '\n', 'utf8');
    } catch (err) {
      console.error('Failed writing to GITHUB_STEP_SUMMARY:', err);
    }
  }
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('GitHub Profile Pet — Diagnostic Contribution & Identity Probe');
  console.log('================================================================');

  const repoRoot = process.cwd();
  const token = process.env.GITHUB_TOKEN?.trim();

  if (!token) {
    console.error('ERROR: GITHUB_TOKEN environment variable is required.');
    console.error('In GitHub Actions, ensure `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` is set.');
    process.exit(1);
  }

  // 1. Resolve Target Owner
  let targetOwner: string;
  let ownerSource: string;
  try {
    const resolved = resolveTargetOwner(process.env);
    targetOwner = resolved.login;
    ownerSource = resolved.source;
    console.log(`Resolved target owner: "${targetOwner}" (Source: ${ownerSource})`);
  } catch (err: unknown) {
    console.error(`ERROR resolving target owner: ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Read-only inspection of local ledger identity
  const ledgerInfo = inspectLedgerIdentity(repoRoot);
  if (ledgerInfo.isInitialized) {
    console.log(
      `Established ledger found: ownerDatabaseId = ${ledgerInfo.ownerDatabaseId} (Login: "${ledgerInfo.ownerLogin}")`
    );
  } else {
    console.log('Ledger is currently uninitialized (ownerDatabaseId is not yet locked).');
  }

  // 3. Formulate UTC query window (Today: 00:00:00Z to 23:59:59.999Z)
  const now = new Date();
  const todayUtcStr = now.toISOString().slice(0, 10);
  const fromIso = `${todayUtcStr}T00:00:00.000Z`;
  const toIso = `${todayUtcStr}T23:59:59.999Z`;
  console.log(`Querying UTC Date Window: [${fromIso} -> ${toIso}]`);

  // 4. Execute GraphQL Provider Query
  const provider = new GitHubContributionProvider();
  console.log(`Sending UserContributionSnapshot query to GitHub GraphQL API for "${targetOwner}"...`);

  try {
    const snapshot = await provider.fetchUserContributionSnapshot(
      targetOwner,
      fromIso,
      toIso,
      token
    );

    console.log('GraphQL Query Succeeded!');
    console.log(`  - Target Login: ${snapshot.ownerLogin}`);
    console.log(`  - Numeric Database ID: ${snapshot.ownerDatabaseId}`);
    console.log(`  - Account Type: Personal User Account`);
    console.log(`  - Provider Latency: ${snapshot.providerLatencyMs}ms`);

    // 5. Verify Owner Identity against Established Ledger
    verifyOwnerIdentity(snapshot, ledgerInfo.ownerDatabaseId);
    console.log('Identity Verification: PASSED (Immutable numeric ID verified)');

    console.log('\n--- Observed Public Contribution Categories (Planned Phase 3C2.2 Scope) ---');
    console.log(`  * Commits: ${snapshot.counts.commits}`);
    console.log(`  * Issues: ${snapshot.counts.issues}`);
    console.log(`  * Pull Requests: ${snapshot.counts.pullRequests}`);
    console.log(`  * Pull Request Reviews: ${snapshot.counts.pullRequestReviews}`);
    console.log(`  ---------------------------------------------`);
    console.log(`  = Calculated Public Category Total: ${snapshot.counts.publicCategoryTotal} (Candidate sum for planned Phase 3C2.2)`);
    console.log(`  * Calendar Reported Total: ${snapshot.counts.calendarReportedTotal} (Informational platform aggregate)`);
    console.log(`  * Restricted (Private) Excluded: ${snapshot.counts.restricted} (Excluded from candidate rewards in Mode A)`);

    let isTelemetryConsistent = true;
    let telemetryDiscrepancies: string[] = [];

    if (snapshot.rateLimit) {
      console.log('\n--- GraphQL Rate Limit Telemetry ---');
      console.log(`  * Pool Limit: ${snapshot.rateLimit.limit !== null ? snapshot.rateLimit.limit : 'unspecified'} points`);
      console.log(`  * Query Cost: ${snapshot.rateLimit.cost} point(s)`);
      console.log(`  * Remaining Points: ${snapshot.rateLimit.remaining}`);
      console.log(`  * Used Points: ${snapshot.rateLimit.used !== null ? snapshot.rateLimit.used : 'unspecified'}`);
      console.log(`  * Reset At: ${snapshot.rateLimit.resetAt}`);

      if (snapshot.rateLimit.headers) {
        console.log('\n--- HTTP Response Headers (Rate Limit) ---');
        console.log(`  * x-ratelimit-limit: ${snapshot.rateLimit.headers.limit}`);
        console.log(`  * x-ratelimit-remaining: ${snapshot.rateLimit.headers.remaining}`);
        console.log(`  * x-ratelimit-used: ${snapshot.rateLimit.headers.used}`);
        console.log(`  * x-ratelimit-reset: ${snapshot.rateLimit.headers.reset}`);
        console.log(`  * x-ratelimit-resource: ${snapshot.rateLimit.headers.resource}`);
      }

      if (snapshot.rateLimit.consistency) {
        isTelemetryConsistent = snapshot.rateLimit.consistency.isConsistent;
        telemetryDiscrepancies = snapshot.rateLimit.consistency.discrepancies;
        if (isTelemetryConsistent) {
          console.log('\nTelemetry Consistency Check: PASSED (GraphQL body and HTTP headers agree)');
        } else {
          console.error('\nTelemetry Consistency Check: FAILED (Discrepancy detected between GraphQL body and HTTP headers):');
          for (const d of telemetryDiscrepancies) {
            console.error(`  - ${d}`);
          }
        }
      }
    }

    // 6. Generate Sanitized GitHub Step Summary
    const summaryMd = `
### 🐾 GitHub Profile Pet — Public Contribution Probe Result

| Parameter | Value |
| :--- | :--- |
| **Resolved Login** | \`${snapshot.ownerLogin}\` (${ownerSource}) |
| **Numeric GitHub ID** | \`${snapshot.ownerDatabaseId}\` |
| **Account Type** | Individual Personal User |
| **GraphQL Query Status** | ✅ **SUCCESS** |
| **Query Latency** | ${snapshot.providerLatencyMs} ms |
| **Identity Verification** | ✅ **PASSED** ${ledgerInfo.isInitialized ? '(Matches established ledger)' : '(Uninitialized ledger inspection)'} |
| **Telemetry Consistency** | ${isTelemetryConsistent ? '✅ **PASSED** (GraphQL body matches HTTP headers)' : '❌ **FAILED** (Discrepancy detected)'} |

#### 📊 Observed Public Contribution Categories (${todayUtcStr})

| Category | Count | Status |
| :--- | :---: | :--- |
| **Commits** | \`${snapshot.counts.commits}\` | Candidate for planned rewards (Phase 3C2.2) |
| **Issues** | \`${snapshot.counts.issues}\` | Candidate for planned rewards (Phase 3C2.2) |
| **Pull Requests** | \`${snapshot.counts.pullRequests}\` | Candidate for planned rewards (Phase 3C2.2) |
| **PR Reviews** | \`${snapshot.counts.pullRequestReviews}\` | Candidate for planned rewards (Phase 3C2.2) |
| **Public Category Total** | **\`${snapshot.counts.publicCategoryTotal}\`** | **Observed Public Total (Candidate sum for planned Phase 3C2.2)** |
| **Calendar Reported Total** | \`${snapshot.counts.calendarReportedTotal}\` | Platform aggregate (Informational) |
| **Restricted (Private)** | \`${snapshot.counts.restricted}\` | 🚫 **Excluded from candidate rewards (Public-only Mode A)** |

${
  snapshot.rateLimit
    ? `
#### ⏱️ Rate Limit Telemetry Reconciliation

| Metric | GraphQL Body | HTTP Header (\`x-ratelimit-*\`) | Status |
| :--- | :---: | :---: | :--- |
| **Pool Limit** | \`${snapshot.rateLimit.limit ?? 'N/A'}\` pts | \`${snapshot.rateLimit.headers?.limit ?? 'N/A'}\` pts | ${snapshot.rateLimit.limit === snapshot.rateLimit.headers?.limit ? '✅ Matches' : '⚠️ Discrepancy'} |
| **Remaining Points** | \`${snapshot.rateLimit.remaining}\` pts | \`${snapshot.rateLimit.headers?.remaining ?? 'N/A'}\` pts | ${snapshot.rateLimit.remaining === snapshot.rateLimit.headers?.remaining ? '✅ Matches' : '⚠️ Discrepancy'} |
| **Used Points** | \`${snapshot.rateLimit.used ?? 'N/A'}\` pts | \`${snapshot.rateLimit.headers?.used ?? 'N/A'}\` pts | ${snapshot.rateLimit.used === snapshot.rateLimit.headers?.used ? '✅ Matches' : '⚠️ Discrepancy'} |
| **Query Cost** | \`${snapshot.rateLimit.cost}\` pt(s) | N/A (GraphQL only) | Measured query cost |
| **Reset Timestamp** | \`${snapshot.rateLimit.resetAt}\` | \`${snapshot.rateLimit.headers?.reset ?? 'N/A'}\` | ${isTelemetryConsistent ? '✅ Consistent' : '⚠️ Discrepancy'} |
| **Resource Pool** | N/A | \`${snapshot.rateLimit.headers?.resource ?? 'N/A'}\` | Transport header |

${
  !isTelemetryConsistent
    ? `
> ⚠️ **Telemetry Discrepancies Detected:**
${telemetryDiscrepancies.map((d) => `> - ${d}`).join('\n')}
`
    : ''
}
`
    : ''
}

> *Probe completed in read-only mode. Zero ledger, state, or Git mutations were performed.*
`.trim();

    writeStepSummary(summaryMd);

    if (!isTelemetryConsistent) {
      console.error('\n❌ PROBE FAILED: Telemetry consistency check failed between GraphQL body and HTTP headers.');
      process.exit(1);
    }

    console.log('\nDiagnostic probe completed successfully with zero mutations.');
    process.exit(0);
  } catch (err: unknown) {
    const errorObj = err as Error;
    const sanitizedMsg = redactSensitiveData(errorObj.message, token);
    console.error(`\n❌ PROBE FAILED: ${sanitizedMsg}`);

    const failureSummary = `
### ❌ GitHub Profile Pet — Public Contribution Probe Failed

- **Target Owner:** \`${targetOwner}\`
- **Error Name:** \`${errorObj.name}\`
- **Error Details:** ${sanitizedMsg}
- **Action Taken:** Fails closed. Zero mutations performed.
`.trim();

    writeStepSummary(failureSummary);
    process.exit(1);
  }
}

void main();
