/**
 * GitHub Profile Pet - Activity Archive Management & Compaction CLI (Sprint 5.0D)
 *
 * Provides safe, auditable, and idempotent operations over activity history:
 *   archive:inspect  - Read-only inspection of record counts, XP totals, and archive status
 *   archive:compact  - Safe compaction of older activity records (default --dry-run)
 *   archive:verify   - Comprehensive integrity, checksum, and deduplication audit
 *   archive:recover  - Recover pending write-ahead transactions after interruption
 *
 * Usage:
 *   node --experimental-strip-types scripts/manage-activity-archive.ts inspect
 *   node --experimental-strip-types scripts/manage-activity-archive.ts compact [--dry-run] [--execute] [--threshold 5000]
 *   node --experimental-strip-types scripts/manage-activity-archive.ts verify
 *   node --experimental-strip-types scripts/manage-activity-archive.ts recover [--dry-run] [--execute]
 */

import {
  inspectActivityLedger,
  compactActivityArchive,
  verifyActivityArchive,
  recoverArchiveTransaction,
} from '../src/features/pet-engine/activity/compactor.ts';
import {
  escapeMarkdown,
  sanitizeSecrets,
  writeStepSummary,
} from '../src/features/pet-engine/reporting/index.ts';

interface CliArgs {
  command: 'inspect' | 'compact' | 'verify' | 'recover';
  dryRun: boolean;
  execute: boolean;
  threshold?: number;
  force: boolean;
  baseDir: string;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    command: 'inspect',
    dryRun: true, // Default safe mode
    execute: false,
    force: false,
    baseDir: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'inspect' || arg === 'compact' || arg === 'verify' || arg === 'recover') {
      result.command = arg;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
      result.execute = false;
    } else if (arg === '--execute') {
      result.execute = true;
      result.dryRun = false;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--threshold' && i + 1 < args.length) {
      result.threshold = parseInt(args[++i], 10);
    } else if (arg.startsWith('--threshold=')) {
      result.threshold = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--base-dir' && i + 1 < args.length) {
      result.baseDir = args[++i];
    } else if (arg.startsWith('--base-dir=')) {
      result.baseDir = arg.split('=')[1];
    }
  }

  return result;
}

async function handleInspect(args: CliArgs): Promise<number> {
  console.log('================================================================');
  console.log('GitHub Profile Pet — Activity Archive Inspection');
  console.log('================================================================');

  const report = await inspectActivityLedger({
    baseDir: args.baseDir,
    threshold: args.threshold,
  });

  console.log(`Active Records:       ${report.activeRecordCount}`);
  console.log(`Archived Records:     ${report.archiveRecordCount}`);
  console.log(`Total Events:         ${report.totalEventCount}`);
  console.log(`Total Combined XP:    ${report.totalCombinedXp} (Active: ${report.totalActiveXp}, Archive: ${report.totalArchivedXp})`);
  console.log(`Compaction Threshold: ${report.compactionThreshold}`);
  console.log(`Compaction Needed:    ${report.compactionNeeded ? 'YES (Exceeds threshold)' : 'NO'}`);
  console.log(`Eligible to Archive:  ${report.eligibleForArchivalCount}`);
  console.log(`Archive Schema:       ${report.archiveSchemaVersion ? `v${report.archiveSchemaVersion}` : 'None (Uninitialized)'}`);
  console.log(`Archive Batches:      ${report.batchesCount}`);
  console.log(`Active Ledger Size:   ${report.activeFileSize} bytes`);
  console.log(`Archive File Size:    ${report.archiveFileSize} bytes`);
  console.log('----------------------------------------------------------------');

  const summary = [
    '## 📦 Activity Archive Inspection Report',
    '',
    '| Metric | Value |',
    '| :--- | :--- |',
    `| **Active Records** | \`${report.activeRecordCount}\` |`,
    `| **Archived Records** | \`${report.archiveRecordCount}\` |`,
    `| **Total Events** | \`${report.totalEventCount}\` |`,
    `| **Total Combined XP** | \`${report.totalCombinedXp} XP\` |`,
    `| **Compaction Threshold** | \`${report.compactionThreshold}\` |`,
    `| **Compaction Needed** | \`${report.compactionNeeded ? 'YES' : 'NO'}\` |`,
    `| **Eligible For Archival** | \`${report.eligibleForArchivalCount}\` |`,
    `| **Archive Batches** | \`${report.batchesCount}\` |`,
    `| **Archive Schema** | \`${report.archiveSchemaVersion ? `v${report.archiveSchemaVersion}` : 'None'}\` |`,
    '',
  ].join('\n');

  writeStepSummary(summary);
  return 0;
}

async function handleCompact(args: CliArgs): Promise<number> {
  const isDryRun = !args.execute;
  console.log('================================================================');
  console.log(`GitHub Profile Pet — Activity Archive Compaction (${isDryRun ? 'DRY-RUN' : 'EXECUTE'})`);
  console.log('================================================================');

  if (isDryRun) {
    console.log('[SAFETY] Running in safe read-only --dry-run mode.');
    console.log('[SAFETY] To apply compaction changes, run with --execute.');
  }

  const result = await compactActivityArchive({
    baseDir: args.baseDir,
    threshold: args.threshold,
    dryRun: isDryRun,
    force: args.force,
  });

  console.log(`Status:               ${result.status}`);
  console.log(`Message:              ${result.message}`);
  console.log(`Initial Active:       ${result.initialActiveRecords}`);
  console.log(`Final Active:         ${result.finalActiveRecords}`);
  console.log(`Initial Archive:      ${result.initialArchiveRecords}`);
  console.log(`Final Archive:        ${result.finalArchiveRecords}`);
  console.log(`Archived In Run:      ${result.archivedRecordCount} records (${result.archivedXp} XP)`);
  console.log(`Total Combined XP:    ${result.totalCombinedXp} XP (Before: ${result.totalActiveXpBefore + (result.totalCombinedXp - result.totalActiveXpAfter)})`);
  if (result.batchId) {
    console.log(`Batch ID:             ${result.batchId}`);
    console.log(`Batch SHA-256:        ${result.batchSha256}`);
  }
  console.log(`Duration:             ${result.durationMs} ms`);
  console.log('----------------------------------------------------------------');

  const summary = [
    `## 🗜️ Activity Archive Compaction (${isDryRun ? 'DRY-RUN' : 'COMMITTED'})`,
    '',
    `> **Status:** \`${result.status}\` — ${escapeMarkdown(result.message)}`,
    '',
    '| Metric | Initial | Final | Net Change |',
    '| :--- | :--- | :--- | :--- |',
    `| **Active Records** | \`${result.initialActiveRecords}\` | \`${result.finalActiveRecords}\` | \`-${result.archivedRecordCount}\` |`,
    `| **Archived Records** | \`${result.initialArchiveRecords}\` | \`${result.finalArchiveRecords}\` | \`+${result.archivedRecordCount}\` |`,
    `| **Combined Events** | \`${result.initialActiveRecords + result.initialArchiveRecords}\` | \`${result.finalActiveRecords + result.finalArchiveRecords}\` | \`0\` (Preserved) |`,
    `| **Total Combined XP** | \`${result.totalCombinedXp} XP\` | \`${result.totalCombinedXp} XP\` | \`0 XP\` (Preserved) |`,
    '',
  ];

  if (result.batchId) {
    summary.push(`**Batch ID:** \`${result.batchId}\``);
    summary.push(`**Integrity Checksum (SHA-256):** \`${result.batchSha256}\``);
    summary.push('');
  }

  writeStepSummary(summary.join('\n'));
  return result.status === 'ERROR' ? 1 : 0;
}

async function handleVerify(args: CliArgs): Promise<number> {
  console.log('================================================================');
  console.log('GitHub Profile Pet — Activity Archive Verification');
  console.log('================================================================');

  const result = await verifyActivityArchive({ baseDir: args.baseDir });

  console.log(`Verification Status:  ${result.status}`);
  console.log(`Active Records:       ${result.activeRecordCount}`);
  console.log(`Archived Records:     ${result.archivedRecordCount}`);
  console.log(`Total Events:         ${result.totalEventCount}`);
  console.log(`Unique Event IDs:     ${result.uniqueEventCount}`);
  console.log(`Total Combined XP:    ${result.totalCombinedXp} XP (Active: ${result.totalActiveXp}, Archive: ${result.totalArchivedXp})`);
  console.log(`Archive Batches:      ${result.batchCount}`);
  console.log(`Issues Detected:      ${result.issues.length}`);
  console.log(`Duration:             ${result.durationMs} ms`);

  if (result.issues.length > 0) {
    console.log('\nAudit Issues:');
    for (const issue of result.issues) {
      console.log(` - [${issue.severity}] [${issue.code}] ${issue.message}`);
    }
  }
  console.log('----------------------------------------------------------------');

  const summary = [
    `## 🔍 Activity Archive Verification: ${result.status === 'PASS' ? '✅ PASS' : result.status === 'WARNING' ? '⚠️ WARNING' : '❌ FAIL'}`,
    '',
    '| Audit Metric | Result |',
    '| :--- | :--- |',
    `| **Classification** | \`${result.status}\` |`,
    `| **Active Records** | \`${result.activeRecordCount}\` |`,
    `| **Archived Records** | \`${result.archivedRecordCount}\` |`,
    `| **Total Events** | \`${result.totalEventCount}\` |`,
    `| **Unique Event IDs** | \`${result.uniqueEventCount}\` |`,
    `| **Total Combined XP** | \`${result.totalCombinedXp} XP\` |`,
    `| **Verified Batches** | \`${result.batchCount}\` |`,
    '',
  ];

  if (result.issues.length > 0) {
    summary.push('### Issues Detected');
    summary.push('');
    summary.push('| Severity | Code | Description |');
    summary.push('| :--- | :--- | :--- |');
    for (const issue of result.issues) {
      summary.push(`| **${issue.severity}** | \`${issue.code}\` | ${escapeMarkdown(issue.message)} |`);
    }
    summary.push('');
  }

  writeStepSummary(summary.join('\n'));
  return result.status === 'FAIL' ? 1 : 0;
}

async function handleRecover(args: CliArgs): Promise<number> {
  const isDryRun = !args.execute;
  console.log('================================================================');
  console.log(`GitHub Profile Pet — Activity Transaction Recovery (${isDryRun ? 'DRY-RUN' : 'EXECUTE'})`);
  console.log('================================================================');

  const result = await recoverArchiveTransaction({
    baseDir: args.baseDir,
    dryRun: isDryRun,
  });

  console.log(`Recovery Status:      ${result.status}`);
  console.log(`Details:              ${result.message}`);
  console.log('----------------------------------------------------------------');

  writeStepSummary([
    `## 🔄 Activity Transaction Recovery (${isDryRun ? 'DRY-RUN' : 'APPLIED'})`,
    '',
    `> **Status:** \`${result.status}\` — ${escapeMarkdown(result.message)}`,
    '',
  ].join('\n'));

  return 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let exitCode = 0;

  try {
    switch (args.command) {
      case 'inspect':
        exitCode = await handleInspect(args);
        break;
      case 'compact':
        exitCode = await handleCompact(args);
        break;
      case 'verify':
        exitCode = await handleVerify(args);
        break;
      case 'recover':
        exitCode = await handleRecover(args);
        break;
      default:
        console.error(`Unknown command: ${args.command}`);
        exitCode = 1;
    }
  } catch (err) {
    console.error('[FATAL] Activity archive operation failed:', sanitizeSecrets((err as Error).message));
    exitCode = 1;
  }

  process.exit(exitCode);
}

void main();
