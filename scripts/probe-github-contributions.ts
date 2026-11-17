// scripts/probe-github-contributions.ts
// Standalone diagnostic probe to verify GitHub GraphQL public contribution API access and immutable identity
// using the Phase 3C2.2.3.1-R2 two-day contribution provider.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GitHubContributionProvider,
  resolveTargetOwner,
  verifyOwnerIdentity,
  redactSensitiveData,
  checkRateLimitConsistency,
  compute2DayUtcWindows,
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
  console.log('GitHub Profile Pet — Two-Day Contribution & Identity Probe');
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

  // 3. Formulate UTC query windows (Yesterday and Today)
  const windows = compute2DayUtcWindows();
  console.log('Computed UTC Date Windows:');
  console.log(`  - Yesterday (${windows.yesterday.date}): [${windows.yesterday.fromIso} -> ${windows.yesterday.toIso}]`);
  console.log(`  - Today     (${windows.today.date}): [${windows.today.fromIso} -> ${windows.today.toIso}]`);

  // 4. Execute Two-Day GraphQL Provider Query
  const provider = new GitHubContributionProvider();
  console.log(`Sending UserContribution2DaySnapshot query to GitHub GraphQL API for "${targetOwner}"...`);

  try {
    const snapshot2Day = await provider.fetchUserContributionSnapshot2Day(
      targetOwner,
      token
    );

    console.log('GraphQL Query Succeeded!');
    console.log(`  - Target Login: ${snapshot2Day.ownerLogin}`);
    console.log(`  - Numeric Database ID: ${snapshot2Day.ownerDatabaseId}`);
    console.log(`  - Account Type: Personal User Account (${snapshot2Day.isPersonalAccount ? 'Personal' : 'Organization'})`);
    console.log(`  - Provider Latency: ${snapshot2Day.providerLatencyMs}ms`);

    // 5. Verify Owner Identity against Established Ledger
    verifyOwnerIdentity(snapshot2Day.today, ledgerInfo.ownerDatabaseId);
    console.log('Identity Verification: PASSED (Immutable numeric ID verified)');

    const yesterdayDate = snapshot2Day.yesterday.fromIso.slice(0, 10);
    const todayDate = snapshot2Day.today.fromIso.slice(0, 10);

    // 6. Log Category Breakdown for Both Windows
    console.log(`\n--- Yesterday Public Contributions (${yesterdayDate}) ---`);
    console.log(`  * Window: [${snapshot2Day.yesterday.fromIso} -> ${snapshot2Day.yesterday.toIso}]`);
    console.log(`  * Commits: ${snapshot2Day.yesterday.counts.commits}`);
    console.log(`  * Issues: ${snapshot2Day.yesterday.counts.issues}`);
    console.log(`  * Pull Requests: ${snapshot2Day.yesterday.counts.pullRequests}`);
    console.log(`  * Pull Request Reviews: ${snapshot2Day.yesterday.counts.pullRequestReviews}`);
    console.log(`  ---------------------------------------------`);
    console.log(`  = Calculated Public Category Total: ${snapshot2Day.yesterday.counts.publicCategoryTotal}`);
    console.log(`  * Calendar Reported Total: ${snapshot2Day.yesterday.counts.calendarReportedTotal} (Informational platform aggregate)`);
    console.log(`  * Restricted (Private) Excluded: ${snapshot2Day.yesterday.counts.restricted} (Excluded from candidate rewards in Mode A)`);

    console.log(`\n--- Today Public Contributions (${todayDate}) ---`);
    console.log(`  * Window: [${snapshot2Day.today.fromIso} -> ${snapshot2Day.today.toIso}]`);
    console.log(`  * Commits: ${snapshot2Day.today.counts.commits}`);
    console.log(`  * Issues: ${snapshot2Day.today.counts.issues}`);
    console.log(`  * Pull Requests: ${snapshot2Day.today.counts.pullRequests}`);
    console.log(`  * Pull Request Reviews: ${snapshot2Day.today.counts.pullRequestReviews}`);
    console.log(`  ---------------------------------------------`);
    console.log(`  = Calculated Public Category Total: ${snapshot2Day.today.counts.publicCategoryTotal}`);
    console.log(`  * Calendar Reported Total: ${snapshot2Day.today.counts.calendarReportedTotal} (Informational platform aggregate)`);
    console.log(`  * Restricted (Private) Excluded: ${snapshot2Day.today.counts.restricted} (Excluded from candidate rewards in Mode A)`);

    // 7. Rate Limit Telemetry
    let isTelemetryConsistent = false;
    let telemetryDiscrepancies: string[] = [];

    const rateLimit = snapshot2Day.rateLimit;
    if (!rateLimit) {
      telemetryDiscrepancies.push('Missing GraphQL rateLimit telemetry in response payload.');
      console.error('\nTelemetry Consistency Check: FAILED (Missing GraphQL rateLimit in response payload)');
    } else {
      console.log('\n--- GraphQL Rate Limit Telemetry ---');
      console.log(`  * Pool Limit: ${rateLimit.limit !== null ? rateLimit.limit : 'unspecified'} points`);
      console.log(`  * Query Cost: ${rateLimit.cost !== null ? rateLimit.cost : 'unspecified'} point(s)`);
      console.log(`  * Remaining Points: ${rateLimit.remaining !== null ? rateLimit.remaining : 'unspecified'}`);
      console.log(`  * Used Points: ${rateLimit.used !== null ? rateLimit.used : 'unspecified'}`);
      console.log(`  * Reset At: ${rateLimit.resetAt !== null ? rateLimit.resetAt : 'unspecified'}`);

      if (rateLimit.headers) {
        console.log('\n--- HTTP Response Headers (Rate Limit) ---');
        console.log(`  * x-ratelimit-limit: ${rateLimit.headers.limit !== null ? rateLimit.headers.limit : (rateLimit.headers.raw?.limit ?? 'missing')}`);
        console.log(`  * x-ratelimit-remaining: ${rateLimit.headers.remaining !== null ? rateLimit.headers.remaining : (rateLimit.headers.raw?.remaining ?? 'missing')}`);
        console.log(`  * x-ratelimit-used: ${rateLimit.headers.used !== null ? rateLimit.headers.used : (rateLimit.headers.raw?.used ?? 'missing')}`);
        console.log(`  * x-ratelimit-reset: ${rateLimit.headers.reset !== null ? rateLimit.headers.reset : (rateLimit.headers.raw?.reset ?? 'missing')}`);
        console.log(`  * x-ratelimit-resource: ${rateLimit.headers.resource ?? 'missing'}`);
      } else {
        console.log('\n--- HTTP Response Headers (Rate Limit) ---');
        console.log('  * Headers: MISSING (Could not capture transport headers)');
      }

      const consistency = rateLimit.consistency ?? checkRateLimitConsistency(rateLimit, rateLimit.headers ?? null);
      isTelemetryConsistent = consistency.isConsistent;
      telemetryDiscrepancies = consistency.discrepancies;

      if (isTelemetryConsistent) {
        console.log('\nTelemetry Consistency Check: PASSED (GraphQL body and HTTP headers agree)');
      } else {
        console.error('\nTelemetry Consistency Check: FAILED (Discrepancy detected between GraphQL body and HTTP headers):');
        for (const d of telemetryDiscrepancies) {
          console.error(`  - ${d}`);
        }
      }
    }

    // 8. Generate Sanitized GitHub Step Summary
    const summaryMd = `
### 🐾 GitHub Profile Pet — Two-Day Contribution & Identity Probe Result

| Parameter | Value |
| :--- | :--- |
| **Resolved Login** | \`${snapshot2Day.ownerLogin}\` (${ownerSource}) |
| **Numeric GitHub ID** | \`${snapshot2Day.ownerDatabaseId}\` |
| **Account Type** | Individual Personal User (\`User\`) |
| **GraphQL Query Status** | ✅ **SUCCESS** |
| **Query Latency** | ${snapshot2Day.providerLatencyMs} ms |
| **Identity Verification** | ✅ **PASSED** ${ledgerInfo.isInitialized ? '(Matches established ledger)' : '(Uninitialized ledger inspection)'} |
| **Telemetry Consistency** | ${isTelemetryConsistent ? '✅ **PASSED** (GraphQL body matches HTTP headers)' : '❌ **FAILED** (Discrepancy detected)'} |

#### 📅 Query Windows (UTC)
- **Yesterday:** \`${yesterdayDate}\` (\`${snapshot2Day.yesterday.fromIso}\` &rarr; \`${snapshot2Day.yesterday.toIso}\`)
- **Today:** \`${todayDate}\` (\`${snapshot2Day.today.fromIso}\` &rarr; \`${snapshot2Day.today.toIso}\`)

#### 📊 Yesterday Public Contributions (${yesterdayDate})

| Category | Count | Status |
| :--- | :---: | :--- |
| **Commits** | \`${snapshot2Day.yesterday.counts.commits}\` | Candidate for planned accounting |
| **Issues** | \`${snapshot2Day.yesterday.counts.issues}\` | Candidate for planned accounting |
| **Pull Requests** | \`${snapshot2Day.yesterday.counts.pullRequests}\` | Candidate for planned accounting |
| **PR Reviews** | \`${snapshot2Day.yesterday.counts.pullRequestReviews}\` | Candidate for planned accounting |
| **Public Category Total** | **\`${snapshot2Day.yesterday.counts.publicCategoryTotal}\`** | **Observed Public Total (Yesterday)** |
| **Calendar Reported Total** | \`${snapshot2Day.yesterday.counts.calendarReportedTotal}\` | Platform aggregate (Informational) |
| **Restricted (Private)** | \`${snapshot2Day.yesterday.counts.restricted}\` | 🚫 **Excluded from candidate rewards (Public-only Mode A)** |

#### 📊 Today Public Contributions (${todayDate})

| Category | Count | Status |
| :--- | :---: | :--- |
| **Commits** | \`${snapshot2Day.today.counts.commits}\` | Candidate for planned accounting |
| **Issues** | \`${snapshot2Day.today.counts.issues}\` | Candidate for planned accounting |
| **Pull Requests** | \`${snapshot2Day.today.counts.pullRequests}\` | Candidate for planned accounting |
| **PR Reviews** | \`${snapshot2Day.today.counts.pullRequestReviews}\` | Candidate for planned accounting |
| **Public Category Total** | **\`${snapshot2Day.today.counts.publicCategoryTotal}\`** | **Observed Public Total (Today)** |
| **Calendar Reported Total** | \`${snapshot2Day.today.counts.calendarReportedTotal}\` | Platform aggregate (Informational) |
| **Restricted (Private)** | \`${snapshot2Day.today.counts.restricted}\` | 🚫 **Excluded from candidate rewards (Public-only Mode A)** |

${
  rateLimit
    ? `
#### ⏱️ Rate Limit Telemetry Reconciliation

| Metric | GraphQL Body | HTTP Header (\`x-ratelimit-*\`) | Status |
| :--- | :---: | :---: | :--- |
| **Pool Limit** | \`${rateLimit.limit ?? 'N/A'}\` pts | \`${rateLimit.headers?.limit ?? (rateLimit.headers?.raw?.limit ?? 'N/A')}\` pts | ${rateLimit.limit !== null && rateLimit.limit === rateLimit.headers?.limit ? '✅ Matches' : '⚠️ Discrepancy'} |
| **Remaining Points** | \`${rateLimit.remaining ?? 'N/A'}\` pts | \`${rateLimit.headers?.remaining ?? (rateLimit.headers?.raw?.remaining ?? 'N/A')}\` pts | ${rateLimit.remaining !== null && rateLimit.remaining === rateLimit.headers?.remaining ? '✅ Matches' : '⚠️ Discrepancy'} |
| **Used Points** | \`${rateLimit.used ?? 'N/A'}\` pts | \`${rateLimit.headers?.used ?? (rateLimit.headers?.raw?.used ?? 'N/A')}\` pts | ${rateLimit.used !== null && rateLimit.used === rateLimit.headers?.used ? '✅ Matches' : '⚠️ Discrepancy'} |
| **Query Cost** | \`${rateLimit.cost ?? 'N/A'}\` pt(s) | N/A (GraphQL only) | ${rateLimit.cost !== null && rateLimit.cost > 0 ? 'Measured query cost' : '⚠️ Invalid cost'} |
| **Reset Timestamp** | \`${rateLimit.resetAt ?? 'N/A'}\` | \`${rateLimit.headers?.reset ?? (rateLimit.headers?.raw?.reset ?? 'N/A')}\` | ${isTelemetryConsistent ? '✅ Consistent' : '⚠️ Discrepancy'} |
| **Resource Pool** | N/A | \`${rateLimit.headers?.resource ?? 'N/A'}\` | ${rateLimit.headers?.resource === 'graphql' ? '✅ graphql' : '⚠️ Invalid resource'} |

${
  !isTelemetryConsistent
    ? `
> ⚠️ **Telemetry Discrepancies Detected:**
${telemetryDiscrepancies.map((d) => `> - ${d}`).join('\n')}
`
    : ''
}
`
    : `
#### ⏱️ Rate Limit Telemetry Reconciliation

> ❌ **Telemetry Discrepancies Detected:**
> - Missing GraphQL rateLimit telemetry in response payload.
`
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
