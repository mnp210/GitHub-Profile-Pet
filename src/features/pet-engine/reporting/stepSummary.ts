/**
 * GitHub Profile Pet - GitHub Actions Step Summaries & Execution Telemetry
 *
 * Provides human-readable, auditable, and structured Markdown reports for
 * GitHub Actions workflows via $GITHUB_STEP_SUMMARY.
 *
 * Supports:
 * - Activity Progression workflow (pet-activity.yml)
 * - Hourly SVG Publication & Simulation workflow (pet-publisher.yml)
 * - Action Inbox Drainage workflow (pet-interaction.yml)
 * - Diagnostics & Contribution Probes (diagnostics-contribution-probe.yml)
 */

import fs from 'node:fs';
import type { PetStateDocument } from '../domain/types.ts';

/**
 * Strips sensitive tokens (GitHub PATs, app tokens, bearer tokens) from telemetry output.
 */
export function sanitizeSecrets(text: string): string {
  if (!text) return '';
  return text
    .replace(/ghp_[a-zA-Z0-9]{20,}/g, '***REDACTED***')
    .replace(/github_pat_[a-zA-Z0-9_]{20,}/g, '***REDACTED***')
    .replace(/gho_[a-zA-Z0-9]{20,}/g, '***REDACTED***')
    .replace(/(Bearer\s+)[a-zA-Z0-9_.~+-]{20,}/gi, '$1***REDACTED***')
    .replace(/(token\s+)[a-zA-Z0-9_.~+-]{20,}/gi, '$1***REDACTED***');
}

/**
 * Escapes characters that break Markdown table cells or permit unwanted HTML injection.
 */
export function escapeMarkdown(text: string): string {
  if (!text) return '';
  const sanitized = sanitizeSecrets(text);
  return sanitized
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br/>');
}

/**
 * Writes or appends markdown content to GitHub Actions step summary file.
 * Returns true if successfully written, false otherwise.
 * Never throws an exception to ensure telemetry failure cannot abort state transitions.
 */
export function writeStepSummary(markdown: string, customPath?: string): boolean {
  const summaryFile = customPath || process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile || !summaryFile.trim()) {
    return false;
  }

  try {
    const formatted = markdown.trim() + '\n\n';
    fs.appendFileSync(summaryFile, formatted, 'utf8');
    return true;
  } catch (err) {
    console.warn('[STEP_SUMMARY] Failed to write step summary to file:', (err as Error).message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. Activity Progression Telemetry Formatter
// ---------------------------------------------------------------------------

export interface ProcessedEventTelemetry {
  eventType: string;
  eventId: string;
  actor: string;
  xpAwarded: number;
  status: string;
  details?: string;
  ref?: string;
}

export interface ActivityReconciliationTelemetry {
  commitsDiscovered: number;
  issuesDiscovered: number;
  prsDiscovered: number;
  reviewsDiscovered: number;
  lastCommitSha?: string;
  lastIssueNumber?: number;
  lastPrNumber?: number;
  completedFully: boolean;
  warnings?: string[];
}

export interface ActivityPublicationTelemetry {
  status: 'COMMITTED_AND_PUSHED' | 'NO_CHANGES_COMMITTED' | 'DRY_RUN' | 'SKIPPED' | 'DEFERRED_TO_RECONCILIATION';
  commitSha?: string;
  modifiedFiles?: string[];
  destinationRef?: string;
  reason?: string;
}

export interface ActivitySummaryParams {
  eventName?: string;
  targetRef: string;
  dryRun: boolean;
  eventsCount: number;
  totalXpAwarded: number;
  initialPetState?: PetStateDocument | null;
  updatedPetState?: PetStateDocument | null;
  processedEvents?: ProcessedEventTelemetry[];
  reconciliation?: ActivityReconciliationTelemetry;
  publication?: ActivityPublicationTelemetry;
  executionTimeIso?: string;
  notes?: string;
}

export function formatActivitySummary(params: ActivitySummaryParams): string {
  const {
    eventName = 'manual',
    targetRef,
    dryRun,
    eventsCount,
    totalXpAwarded,
    initialPetState,
    updatedPetState,
    processedEvents = [],
    reconciliation,
    publication,
    executionTimeIso = new Date().toISOString(),
    notes,
  } = params;

  const modeBadge = dryRun ? '🔍 `DRY-RUN`' : '⚡ `LIVE`';
  const lines: string[] = [];

  lines.push('### 🐾 GitHub Profile Pet — Activity Progression Summary');
  lines.push('');
  lines.push(`**Trigger:** \`${escapeMarkdown(eventName)}\` | **Target Branch:** \`${escapeMarkdown(targetRef)}\` | **Mode:** ${modeBadge} | **Time:** \`${executionTimeIso}\``);
  lines.push('');

  // Pet State Transition Table
  if (initialPetState && updatedPetState) {
    const levelChange = updatedPetState.level > initialPetState.level
      ? `Level ${updatedPetState.level} 🌟 (Level Up!)`
      : `Level ${updatedPetState.level}`;
    const xpChange = `+${totalXpAwarded} XP (${initialPetState.xp} → ${updatedPetState.xp})`;
    const genChange = `G${initialPetState.generation} → G${updatedPetState.generation}`;

    lines.push('#### 📊 Companion State Transition');
    lines.push('');
    lines.push('| Metric | Before | After | Change |');
    lines.push('| :--- | :--- | :--- | :--- |');
    lines.push(`| **Companion** | \`${escapeMarkdown(initialPetState.name)}\` | \`${escapeMarkdown(updatedPetState.name)}\` | Species: \`${updatedPetState.species}\` |`);
    lines.push(`| **Level** | Level ${initialPetState.level} | Level ${updatedPetState.level} | ${levelChange} |`);
    lines.push(`| **Experience (XP)** | ${initialPetState.xp} / ${initialPetState.maxExp} | ${updatedPetState.xp} / ${updatedPetState.maxExp} | **${xpChange}** |`);
    lines.push(`| **Energy** | ${initialPetState.energy}% | ${updatedPetState.energy}% | ${updatedPetState.energy - initialPetState.energy >= 0 ? '+' : ''}${updatedPetState.energy - initialPetState.energy}% |`);
    lines.push(`| **Satiety** | ${initialPetState.hunger}% | ${updatedPetState.hunger}% | ${updatedPetState.hunger - initialPetState.hunger >= 0 ? '+' : ''}${updatedPetState.hunger - initialPetState.hunger}% |`);
    lines.push(`| **Happiness** | ${initialPetState.happiness}% | ${updatedPetState.happiness}% | ${updatedPetState.happiness - initialPetState.happiness >= 0 ? '+' : ''}${updatedPetState.happiness - initialPetState.happiness}% |`);
    lines.push(`| **Generation** | G${initialPetState.generation} | G${updatedPetState.generation} | ${genChange} |`);
    lines.push('');
  } else if (updatedPetState) {
    lines.push('#### 📊 Companion State Snapshot');
    lines.push('');
    lines.push('| Metric | Current Value |');
    lines.push('| :--- | :--- |');
    lines.push(`| **Companion** | \`${escapeMarkdown(updatedPetState.name)}\` (Level ${updatedPetState.level}, ${updatedPetState.species}) |`);
    lines.push(`| **Experience (XP)** | ${updatedPetState.xp} / ${updatedPetState.maxExp} (+${totalXpAwarded} XP awarded) |`);
    lines.push(`| **Vitals (E/S/H)** | Energy: ${updatedPetState.energy}% \\| Satiety: ${updatedPetState.hunger}% \\| Happiness: ${updatedPetState.happiness}% |`);
    lines.push(`| **Generation** | G${updatedPetState.generation} |`);
    lines.push('');
  }

  // Events Processed Breakdown
  lines.push('#### 📜 Evaluated Activity Events');
  lines.push('');
  if (processedEvents.length === 0) {
    lines.push('_No qualifying events detected or queued during this cycle._');
    lines.push('');
  } else {
    lines.push(`Processed **${eventsCount}** event(s) resulting in **+${totalXpAwarded} XP** awarded:`);
    lines.push('');
    lines.push('| Event Type | Identifier | Actor | Status | XP Awarded | Details |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

    for (const ev of processedEvents) {
      const statusIcon = ev.status === 'rewarded'
        ? '✅ `rewarded`'
        : ev.status === 'skipped_duplicate'
        ? '🔄 `duplicate`'
        : ev.status === 'skipped_bot'
        ? '🤖 `bot_filtered`'
        : ev.status === 'skipped_daily_cap'
        ? '🛑 `daily_cap`'
        : `⚠️ \`${ev.status}\``;

      const actorDisplay = ev.actor ? `\`@${escapeMarkdown(ev.actor)}\`` : '`unknown`';
      const idDisplay = `\`${escapeMarkdown(ev.eventId.length > 36 ? ev.eventId.slice(0, 36) + '…' : ev.eventId)}\``;
      const detailsDisplay = ev.details ? escapeMarkdown(ev.details) : '-';
      const xpDisplay = ev.xpAwarded > 0 ? `**+${ev.xpAwarded} XP**` : '0 XP';

      lines.push(`| \`${ev.eventType}\` | ${idDisplay} | ${actorDisplay} | ${statusIcon} | ${xpDisplay} | ${detailsDisplay} |`);
    }
    lines.push('');
  }

  // Reconciliation Telemetry
  if (reconciliation) {
    lines.push('#### 🔍 Reconciliation Sweep Telemetry');
    lines.push('');
    const statusText = reconciliation.completedFully ? '✅ Fully Reconciled' : '⚠️ Incomplete / Truncated';
    lines.push(`- **Reconciliation Status:** ${statusText}`);
    lines.push(`- **Discovered Events:** Commits: ${reconciliation.commitsDiscovered} | Issues: ${reconciliation.issuesDiscovered} | PRs: ${reconciliation.prsDiscovered} | Reviews: ${reconciliation.reviewsDiscovered}`);
    if (reconciliation.lastCommitSha) {
      lines.push(`- **Last Commit Checkpoint:** \`${reconciliation.lastCommitSha.slice(0, 10)}\``);
    }
    if (reconciliation.lastIssueNumber) {
      lines.push(`- **Last Issue Checkpoint:** #${reconciliation.lastIssueNumber}`);
    }
    if (reconciliation.lastPrNumber) {
      lines.push(`- **Last PR Checkpoint:** #${reconciliation.lastPrNumber}`);
    }
    if (reconciliation.warnings && reconciliation.warnings.length > 0) {
      lines.push('');
      lines.push('> [!NOTE]');
      for (const w of reconciliation.warnings) {
        lines.push(`> - ${escapeMarkdown(w)}`);
      }
    }
    lines.push('');
  }

  // Publication Telemetry
  if (publication) {
    lines.push('#### 🚀 Publication Status');
    lines.push('');
    if (publication.status === 'COMMITTED_AND_PUSHED') {
      lines.push(`- **Outcome:** ✅ Committed & Fast-Forward Pushed (\`COMMITTED_AND_PUSHED\`) to \`${escapeMarkdown(publication.destinationRef || targetRef)}\``);
      if (publication.commitSha) {
        lines.push(`- **Commit SHA:** \`${publication.commitSha}\``);
      }
      if (publication.modifiedFiles && publication.modifiedFiles.length > 0) {
        lines.push(`- **Published Artifacts (${publication.modifiedFiles.length}):** \`${publication.modifiedFiles.join('`, `')}\``);
      }
    } else if (publication.status === 'NO_CHANGES_COMMITTED') {
      lines.push('- **Outcome:** ℹ️ Clean NO-OP (`NO_CHANGES_COMMITTED`) — no state modifications or XP changes required publication.');
    } else if (publication.status === 'DRY_RUN') {
      lines.push('- **Outcome:** 🔍 Dry-run complete. Working tree and remote unchanged.');
    } else if (publication.status === 'DEFERRED_TO_RECONCILIATION') {
      lines.push('- **Outcome:** ⏳ **Deferred to Reconciliation (`DEFERRED_TO_RECONCILIATION`)**');
      lines.push(`- **Reason:** ${escapeMarkdown(publication.reason || 'Direct Git push is omitted in PR context to protect repository branches and production state.')}`);
      lines.push('- **Durable Persistence:** Durable ledger recording and pet state update will be reconciled automatically during the next default-branch sweep (on push to main or scheduled cron).');
    } else {
      lines.push(`- **Outcome:** \`${publication.status}\``);
    }
    lines.push('');
  }

  if (notes) {
    lines.push(`> [!NOTE]\n> ${escapeMarkdown(notes)}`);
    lines.push('');
  }

  return lines.join('\n');
}

export interface ActivityFailureParams {
  eventName?: string;
  targetRef: string;
  stage: string;
  error: unknown;
  eventsAttempted?: number;
  executionTimeIso?: string;
}

export function formatActivityFailureSummary(params: ActivityFailureParams): string {
  const {
    eventName = 'manual',
    targetRef,
    stage,
    error,
    eventsAttempted = 0,
    executionTimeIso = new Date().toISOString(),
  } = params;

  const rawErrMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const sanitizedErr = escapeMarkdown(rawErrMsg);

  const lines: string[] = [
    '### ❌ GitHub Profile Pet — Activity Progression Failed',
    '',
    `**Trigger:** \`${escapeMarkdown(eventName)}\` | **Target Branch:** \`${escapeMarkdown(targetRef)}\` | **Failed Stage:** \`${escapeMarkdown(stage)}\` | **Time:** \`${executionTimeIso}\``,
    '',
    `> [!WARNING]`,
    `> **Error Message:** ${sanitizedErr}`,
    `> **Events In Context:** ${eventsAttempted}`,
    '',
    '#### Diagnostic & Recovery Steps',
    '- Verify working tree cleanliness and transaction journal state (`pet/ledger/activity-journal.json`).',
    '- Ensure `GITHUB_TOKEN` permissions include `contents: write`, `issues: read`, and `pull-requests: read`.',
    '- If push failed due to concurrency collision, the workflow resets to `origin/${targetRef}` on retry.',
    '',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 2. SVG Publication & Simulation Telemetry Formatter
// ---------------------------------------------------------------------------

export interface PublisherSummaryParams {
  mode: 'passive_simulation' | 'baseline';
  targetRef: string;
  dryRun: boolean;
  skipPush: boolean;
  status: string;
  details: string;
  commitSha?: string;
  stagedFiles?: string[];
  petState?: PetStateDocument | null;
  syncResult?: {
    incrementsEvaluated: number;
    xpAwarded: number;
    satietyAwarded: number;
    deltaObserved: number;
    queryCost?: number;
    rateLimitRemaining?: number;
    latencyMs?: number;
    notes?: string;
  };
  executionTimeIso?: string;
}

export function formatPublisherSummary(params: PublisherSummaryParams): string {
  const {
    mode,
    targetRef,
    dryRun,
    skipPush,
    status,
    details,
    commitSha,
    stagedFiles = [],
    petState,
    syncResult,
    executionTimeIso = new Date().toISOString(),
  } = params;

  const lines: string[] = [];
  const statusIcon = status === 'published'
    ? '✅ `PUBLISHED`'
    : status === 'noop_identical'
    ? 'ℹ️ `NOOP_IDENTICAL`'
    : status === 'dry_run'
    ? '🔍 `DRY_RUN`'
    : `⚠️ \`${status.toUpperCase()}\``;

  lines.push('### 🎨 GitHub Profile Pet — SVG Publication & Simulation Summary');
  lines.push('');
  lines.push(`**Mode:** \`${mode}\` | **Target Branch:** \`${escapeMarkdown(targetRef)}\` | **Pipeline Status:** ${statusIcon} | **Time:** \`${executionTimeIso}\``);
  lines.push('');

  // Pet State Overview
  if (petState) {
    lines.push('#### 🐾 Companion Status');
    lines.push('');
    lines.push('| Attribute | Value | Description |');
    lines.push('| :--- | :--- | :--- |');
    lines.push(`| **Name** | \`${escapeMarkdown(petState.name)}\` | ${escapeMarkdown(petState.species)} (Stage: ${escapeMarkdown(petState.evolutionStage || 'Hatchling')}) |`);
    lines.push(`| **Level & XP** | Level ${petState.level} | ${petState.xp} / ${petState.maxExp} XP |`);
    lines.push(`| **Energy** | ${petState.energy}% | Vitals decay / passive recovery |`);
    lines.push(`| **Satiety** | ${petState.hunger}% | Nourishment level |`);
    lines.push(`| **Happiness** | ${petState.happiness}% | Well-being & mood |`);
    lines.push(`| **State Generation** | G${petState.generation} | Monotonic state revision |`);
    lines.push('');
  }

  // Contribution Sync Metrics
  if (syncResult) {
    lines.push('#### 📈 Contribution Synchronization Telemetry');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('| :--- | :--- |');
    lines.push(`| **Increments Evaluated** | ${syncResult.incrementsEvaluated} |`);
    lines.push(`| **New Contributions Observed** | ${syncResult.deltaObserved} |`);
    lines.push(`| **XP Awarded** | +${syncResult.xpAwarded} XP |`);
    lines.push(`| **Satiety Awarded** | +${syncResult.satietyAwarded}% |`);
    if (syncResult.queryCost !== undefined) {
      lines.push(`| **GraphQL Query Cost** | ${syncResult.queryCost} point(s) |`);
    }
    if (syncResult.rateLimitRemaining !== undefined) {
      lines.push(`| **Rate Limit Remaining** | ${syncResult.rateLimitRemaining.toLocaleString()} / 5,000 |`);
    }
    if (syncResult.latencyMs !== undefined) {
      lines.push(`| **API Latency** | ${syncResult.latencyMs} ms |`);
    }
    lines.push('');
  }

  // Git Publication Telemetry
  lines.push('#### 📦 Git Publication Details');
  lines.push('');
  lines.push(`- **Details:** ${escapeMarkdown(details)}`);
  if (commitSha) {
    lines.push(`- **Commit SHA:** \`${commitSha}\``);
  }
  if (stagedFiles.length > 0) {
    lines.push(`- **Verified Manifest Files (${stagedFiles.length}):** \`${stagedFiles.join('`, `')}\``);
  }
  if (skipPush) {
    lines.push('- **Push Policy:** Skipped via `--skip-push` flag');
  } else if (dryRun) {
    lines.push('- **Push Policy:** Skipped via `--dry-run` flag');
  }
  lines.push('');

  return lines.join('\n');
}

export interface PublisherFailureParams {
  mode?: string;
  targetRef?: string;
  status: string;
  details: string;
  error?: unknown;
  executionTimeIso?: string;
}

export function formatPublisherFailureSummary(params: PublisherFailureParams): string {
  const {
    mode = 'passive_simulation',
    targetRef = 'main',
    status,
    details,
    error,
    executionTimeIso = new Date().toISOString(),
  } = params;

  const rawErrMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error || details);
  const sanitizedErr = escapeMarkdown(rawErrMsg);

  const lines: string[] = [
    '### ❌ GitHub Profile Pet — SVG Publication Failed',
    '',
    `**Mode:** \`${escapeMarkdown(mode)}\` | **Target Branch:** \`${escapeMarkdown(targetRef)}\` | **Status:** \`${escapeMarkdown(status.toUpperCase())}\` | **Time:** \`${executionTimeIso}\``,
    '',
    `> [!WARNING]`,
    `> **Failure Details:** ${escapeMarkdown(details)}`,
    `> **Exception:** ${sanitizedErr}`,
    '',
    '#### Diagnostic & Recovery Steps',
    '- Confirm that the 5-file atomic manifest matches `pet.json`, `contributions.json`, `actions.json`, `badge.svg`, and `README.md`.',
    '- Verify remote generation fence (`checkRemoteGenerationFence`) against fast-forward push restrictions.',
    '- Check GitHub API token rate limits and repository write permissions.',
    '',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 3. Action Inbox Drainage Telemetry Formatter
// ---------------------------------------------------------------------------

export interface InboxSummaryParams {
  targetRef: string;
  dryRun: boolean;
  status: string;
  details: string;
  commitSha?: string;
  stagedFiles?: string[];
  inboxResult?: {
    scannedCount: number;
    processedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    duplicateCount: number;
    quarantinedCount: number;
    newHighWaterMark: number;
    queueDrained: boolean;
    hasMorePending: boolean;
    savedGeneration?: number;
  };
  executionTimeIso?: string;
}

export function formatInboxSummary(params: InboxSummaryParams): string {
  const {
    targetRef,
    dryRun,
    status,
    details,
    commitSha,
    stagedFiles = [],
    inboxResult,
    executionTimeIso = new Date().toISOString(),
  } = params;

  const lines: string[] = [];
  const statusIcon = status === 'published'
    ? '✅ `PUBLISHED`'
    : status === 'noop_identical'
    ? 'ℹ️ `NOOP_IDENTICAL`'
    : status === 'dry_run'
    ? '🔍 `DRY_RUN`'
    : `⚠️ \`${status.toUpperCase()}\``;

  lines.push('### 📥 GitHub Profile Pet — Action Inbox Drainage Summary');
  lines.push('');
  lines.push(`**Target Branch:** \`${escapeMarkdown(targetRef)}\` | **Status:** ${statusIcon} | **Time:** \`${executionTimeIso}\``);
  lines.push('');

  if (inboxResult) {
    const queueStatus = inboxResult.queueDrained
      ? '✅ Fully Drained'
      : inboxResult.hasMorePending
      ? '⏳ Has More Pending (will drain in subsequent batch)'
      : 'Idle';

    lines.push('#### 📬 Queue & Drainage Statistics');
    lines.push('');
    lines.push('| Metric | Count / Value |');
    lines.push('| :--- | :--- |');
    lines.push(`| **Total Issues Scanned** | ${inboxResult.scannedCount} |`);
    lines.push(`| **Actions Processed** | ${inboxResult.processedCount} |`);
    lines.push(`| **Accepted Actions** | ${inboxResult.acceptedCount} ✅ |`);
    lines.push(`| **Rejected Actions** | ${inboxResult.rejectedCount} ❌ |`);
    lines.push(`| **Duplicate Actions** | ${inboxResult.duplicateCount} 🔄 |`);
    lines.push(`| **Quarantined Actions** | ${inboxResult.quarantinedCount} ⚠️ |`);
    lines.push(`| **High-Water Mark** | Issue #${inboxResult.newHighWaterMark} |`);
    lines.push(`| **Queue Condition** | ${queueStatus} |`);
    if (inboxResult.savedGeneration !== undefined) {
      lines.push(`| **State Generation** | G${inboxResult.savedGeneration} |`);
    }
    lines.push('');
  }

  lines.push('#### 📦 Git Publication Details');
  lines.push('');
  lines.push(`- **Details:** ${escapeMarkdown(details)}`);
  if (commitSha) {
    lines.push(`- **Commit SHA:** \`${commitSha}\``);
  }
  if (stagedFiles.length > 0) {
    lines.push(`- **Staged Manifest Files (${stagedFiles.length}):** \`${stagedFiles.join('`, `')}\``);
  }
  if (dryRun) {
    lines.push('- **Execution Mode:** Dry-run (push skipped)');
  }
  lines.push('');

  return lines.join('\n');
}

export interface InboxFailureParams {
  targetRef?: string;
  status: string;
  details: string;
  error?: unknown;
  executionTimeIso?: string;
}

export function formatInboxFailureSummary(params: InboxFailureParams): string {
  const {
    targetRef = 'main',
    status,
    details,
    error,
    executionTimeIso = new Date().toISOString(),
  } = params;

  const rawErrMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error || details);
  const sanitizedErr = escapeMarkdown(rawErrMsg);

  const lines: string[] = [
    '### ❌ GitHub Profile Pet — Action Inbox Drainage Failed',
    '',
    `**Target Branch:** \`${escapeMarkdown(targetRef)}\` | **Status:** \`${escapeMarkdown(status.toUpperCase())}\` | **Time:** \`${executionTimeIso}\``,
    '',
    `> [!WARNING]`,
    `> **Failure Details:** ${escapeMarkdown(details)}`,
    `> **Exception:** ${sanitizedErr}`,
    '',
    '#### Diagnostic & Recovery Steps',
    '- Verify GitHub issue label permissions (`issues: write`).',
    '- Inspect recent issues with label `pet-action:pending` for malformed action payloads.',
    '- If publication failed on push conflict, the hourly recovery sweep will automatically retry.',
    '',
  ];

  return lines.join('\n');
}
