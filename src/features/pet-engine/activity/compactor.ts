/**
 * GitHub Profile Pet - Activity Archive Compactor & Integrity Engine (Sprint 5.0D)
 *
 * Provides deterministic, idempotent, and recoverable activity history compaction.
 * Prevents unbounded growth of activity.json while preserving:
 * - 100% of historical event records and provenance.
 * - Exact XP accounting integrity (zero XP gain/loss).
 * - Full deduplication across active and archived events.
 * - Multi-document write-ahead transactional durability and recovery.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  ACTIVITY_ARCHIVE_RELATIVE_PATH,
  COMPACTOR_VERSION,
  DEFAULT_COMPACTION_THRESHOLD,
} from './constants.ts';
import type {
  ActivityEventRecord,
  ActivityLedgerDocument,
  ActivityArchiveDocument,
  ActivityArchiveV1Document,
  ActivityArchiveV2Document,
  ActivityArchiveBatch,
  ArchiveCompactionOptions,
  ArchiveCompactionResult,
  ArchiveVerificationResult,
  ArchiveVerificationIssue,
} from './types.ts';
import {
  executeActivityTransaction,
  recoverActivityTransaction,
  ACTIVITY_TX_DIR,
} from './activityTransactionJournal.ts';

// ---------------------------------------------------------------------------
// Schema Helpers & Migration
// ---------------------------------------------------------------------------

export function isArchiveV2(archive: ActivityArchiveDocument): archive is ActivityArchiveV2Document {
  return archive.schemaVersion === 2 && Array.isArray((archive as ActivityArchiveV2Document).archivedEvents);
}

export function migrateArchiveV1ToV2(v1: ActivityArchiveV1Document): ActivityArchiveV2Document {
  return {
    schemaVersion: 2,
    archivedCommitShas: [...(v1.archivedCommitShas || [])],
    archivedEvents: [],
    batches: [],
    totalArchivedEvents: v1.archivedEventCount ?? (v1.archivedCommitShas?.length || 0),
    totalArchivedXp: 0,
    updatedAt: v1.updatedAt || new Date().toISOString(),
  };
}

export function migrateArchiveV2ToV1(v2: ActivityArchiveV2Document): ActivityArchiveV1Document {
  return {
    schemaVersion: 1,
    archivedCommitShas: [...(v2.archivedCommitShas || [])],
    archivedEventCount: v2.totalArchivedEvents ?? v2.archivedEvents.length,
    updatedAt: v2.updatedAt || new Date().toISOString(),
  };
}

export function initDefaultActivityArchiveV2(): ActivityArchiveV2Document {
  return {
    schemaVersion: 2,
    archivedCommitShas: [],
    archivedEvents: [],
    batches: [],
    totalArchivedEvents: 0,
    totalArchivedXp: 0,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Canonical Serialization & Integrity Hashing
// ---------------------------------------------------------------------------

/**
 * Deterministically sorts object keys recursively to produce canonical JSON.
 */
export function canonicalStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(obj[key])}`);
  return '{' + entries.join(',') + '}';
}

/**
 * Computes deterministic SHA-256 digest over an array of event records.
 */
export function computeBatchSha256(records: ActivityEventRecord[]): string {
  const canonical = canonicalStringify(records);
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// Inspection Interface
// ---------------------------------------------------------------------------

export interface LedgerInspectionReport {
  activeRecordCount: number;
  archiveRecordCount: number;
  totalEventCount: number;
  totalActiveXp: number;
  totalArchivedXp: number;
  totalCombinedXp: number;
  compactionThreshold: number;
  compactionNeeded: boolean;
  eligibleForArchivalCount: number;
  projectedActiveRecords: number;
  projectedArchiveRecords: number;
  activeFileSize: number;
  archiveFileSize: number;
  archiveSchemaVersion?: number;
  batchesCount: number;
}

export async function inspectActivityLedger(options: {
  baseDir?: string;
  threshold?: number;
}): Promise<LedgerInspectionReport> {
  const baseDir = options.baseDir ?? process.cwd();
  const threshold = options.threshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const activityPath = path.join(baseDir, 'pet/ledger/activity.json');
  const archivePath = path.join(baseDir, ACTIVITY_ARCHIVE_RELATIVE_PATH);

  let activeLedger: ActivityLedgerDocument | null = null;
  let activeFileSize = 0;
  try {
    const raw = await fs.readFile(activityPath, 'utf-8');
    activeLedger = JSON.parse(raw);
    const stat = await fs.stat(activityPath);
    activeFileSize = stat.size;
  } catch {
    // Ledger missing or empty
  }

  let archive: ActivityArchiveDocument | null = null;
  let archiveFileSize = 0;
  try {
    const raw = await fs.readFile(archivePath, 'utf-8');
    archive = JSON.parse(raw);
    const stat = await fs.stat(archivePath);
    archiveFileSize = stat.size;
  } catch {
    // Archive missing
  }

  const activeEvents = activeLedger?.recentEvents || [];
  const activeRecordCount = activeEvents.length;
  const totalActiveXp = activeEvents.reduce((sum, e) => sum + (e.xpAwarded || 0), 0);

  let archiveRecordCount = 0;
  let totalArchivedXp = 0;
  let batchesCount = 0;
  let archiveSchemaVersion: number | undefined;

  if (archive) {
    archiveSchemaVersion = archive.schemaVersion;
    if (isArchiveV2(archive)) {
      archiveRecordCount = archive.archivedEvents.length;
      totalArchivedXp = archive.totalArchivedXp || archive.archivedEvents.reduce((sum, e) => sum + (e.xpAwarded || 0), 0);
      batchesCount = archive.batches.length;
    } else {
      archiveRecordCount = archive.archivedEventCount || archive.archivedCommitShas.length;
    }
  }

  const compactionNeeded = activeRecordCount > threshold;
  const eligibleForArchivalCount = Math.max(0, activeRecordCount - threshold);
  const projectedActiveRecords = Math.min(activeRecordCount, threshold);
  const projectedArchiveRecords = archiveRecordCount + eligibleForArchivalCount;

  return {
    activeRecordCount,
    archiveRecordCount,
    totalEventCount: activeRecordCount + archiveRecordCount,
    totalActiveXp,
    totalArchivedXp,
    totalCombinedXp: totalActiveXp + totalArchivedXp,
    compactionThreshold: threshold,
    compactionNeeded,
    eligibleForArchivalCount,
    projectedActiveRecords,
    projectedArchiveRecords,
    activeFileSize,
    archiveFileSize,
    archiveSchemaVersion,
    batchesCount,
  };
}

// ---------------------------------------------------------------------------
// Core Compaction Engine
// ---------------------------------------------------------------------------

export async function compactActivityArchive(
  options: ArchiveCompactionOptions = {}
): Promise<ArchiveCompactionResult> {
  const startTime = Date.now();
  const baseDir = options.baseDir ?? process.cwd();
  const threshold = options.threshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const nowIso = options.nowIso ?? new Date().toISOString();
  const isDryRun = Boolean(options.dryRun);

  const activityPath = path.join(baseDir, 'pet/ledger/activity.json');
  const archivePath = path.join(baseDir, ACTIVITY_ARCHIVE_RELATIVE_PATH);

  // 1. Recover any prior interrupted transactions first
  if (!isDryRun) {
    await recoverActivityTransaction(baseDir);
  }

  // 2. Load Active Ledger
  let activeLedger: ActivityLedgerDocument;
  try {
    const raw = await fs.readFile(activityPath, 'utf-8');
    activeLedger = JSON.parse(raw);
  } catch (err) {
    return {
      status: 'ERROR',
      message: `Failed to load active ledger from ${activityPath}: ${(err as Error).message}`,
      initialActiveRecords: 0,
      finalActiveRecords: 0,
      initialArchiveRecords: 0,
      finalArchiveRecords: 0,
      archivedRecordCount: 0,
      archivedXp: 0,
      totalActiveXpBefore: 0,
      totalActiveXpAfter: 0,
      totalCombinedXp: 0,
      durationMs: Date.now() - startTime,
      error: err as Error,
    };
  }

  // 3. Load or Initialize Durable Archive
  let archive: ActivityArchiveV2Document;
  try {
    const raw = await fs.readFile(archivePath, 'utf-8');
    const parsed = JSON.parse(raw) as ActivityArchiveDocument;
    if (parsed.schemaVersion === 1) {
      archive = migrateArchiveV1ToV2(parsed as ActivityArchiveV1Document);
    } else {
      archive = parsed as ActivityArchiveV2Document;
    }
  } catch {
    archive = initDefaultActivityArchiveV2();
  }

  const initialActiveRecords = activeLedger.recentEvents.length;
  const initialArchiveRecords = archive.archivedEvents.length;
  const totalActiveXpBefore = activeLedger.recentEvents.reduce((s, e) => s + (e.xpAwarded || 0), 0);
  const totalArchivedXpBefore = archive.totalArchivedXp || archive.archivedEvents.reduce((s, e) => s + (e.xpAwarded || 0), 0);
  const totalCombinedXpBefore = totalActiveXpBefore + totalArchivedXpBefore;

  // 4. Check if compaction is needed
  if (initialActiveRecords <= threshold && !options.force) {
    return {
      status: 'NOT_NEEDED',
      message: `Active ledger has ${initialActiveRecords} records (threshold: ${threshold}). Compaction not needed.`,
      initialActiveRecords,
      finalActiveRecords: initialActiveRecords,
      initialArchiveRecords,
      finalArchiveRecords: initialArchiveRecords,
      archivedRecordCount: 0,
      archivedXp: 0,
      totalActiveXpBefore,
      totalActiveXpAfter: totalActiveXpBefore,
      totalCombinedXp: totalCombinedXpBefore,
      durationMs: Date.now() - startTime,
    };
  }

  // 5. Partition Records: Retain recent `threshold` records; archive older records
  // recentEvents is newest-first: index 0 is most recent
  const newActiveRecords = activeLedger.recentEvents.slice(0, threshold);
  const rawRecordsToArchive = activeLedger.recentEvents.slice(threshold);

  if (rawRecordsToArchive.length === 0) {
    return {
      status: 'NOT_NEEDED',
      message: `No eligible records found to archive beyond threshold of ${threshold}.`,
      initialActiveRecords,
      finalActiveRecords: initialActiveRecords,
      initialArchiveRecords,
      finalArchiveRecords: initialArchiveRecords,
      archivedRecordCount: 0,
      archivedXp: 0,
      totalActiveXpBefore,
      totalActiveXpAfter: totalActiveXpBefore,
      totalCombinedXp: totalCombinedXpBefore,
      durationMs: Date.now() - startTime,
    };
  }

  // Sort recordsToArchive chronologically (oldest to newest) for archival batch
  const recordsToArchive = [...rawRecordsToArchive].reverse();
  const archivedRecordCount = recordsToArchive.length;
  const archivedXp = recordsToArchive.reduce((s, e) => s + (e.xpAwarded || 0), 0);

  // 6. Compute Batch Metadata & Integrity Digest
  const batchSha256 = computeBatchSha256(recordsToArchive);
  const cleanIso = nowIso.replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const batchId = `batch-${cleanIso}-${batchSha256.slice(0, 8)}`;

  const firstEventTimestamp = recordsToArchive[0].timestamp || nowIso;
  const lastEventTimestamp = recordsToArchive[recordsToArchive.length - 1].timestamp || nowIso;
  const startEventId = recordsToArchive[0].eventId;
  const endEventId = recordsToArchive[recordsToArchive.length - 1].eventId;

  const newBatch: ActivityArchiveBatch = {
    batchId,
    createdAt: nowIso,
    sourceLedger: 'pet/ledger/activity.json',
    recordCount: archivedRecordCount,
    totalXp: archivedXp,
    firstEventTimestamp,
    lastEventTimestamp,
    recordRange: {
      startEventId,
      endEventId,
    },
    sha256: batchSha256,
    compactorVersion: COMPACTOR_VERSION,
  };

  // 7. Construct Updated Archive Document (v2)
  const existingCommitShas = new Set(archive.archivedCommitShas.map((s) => s.toLowerCase()));
  for (const record of recordsToArchive) {
    if (record.eventType === 'commit') {
      const sha = record.eventId.replace(/^commit:/i, '').toLowerCase();
      if (!existingCommitShas.has(sha)) {
        existingCommitShas.add(sha);
        archive.archivedCommitShas.push(sha);
      }
    }
  }

  const updatedArchive: ActivityArchiveV2Document = {
    schemaVersion: 2,
    archivedCommitShas: archive.archivedCommitShas,
    archivedEvents: [...archive.archivedEvents, ...recordsToArchive],
    batches: [...archive.batches, newBatch],
    totalArchivedEvents: archive.archivedEvents.length + archivedRecordCount,
    totalArchivedXp: totalArchivedXpBefore + archivedXp,
    updatedAt: nowIso,
  };

  // 8. Construct Updated Active Ledger Document
  const updatedActiveLedger: ActivityLedgerDocument = {
    ...activeLedger,
    recentEvents: newActiveRecords,
    updatedAt: nowIso,
  };

  const finalActiveRecords = updatedActiveLedger.recentEvents.length;
  const finalArchiveRecords = updatedArchive.archivedEvents.length;
  const totalActiveXpAfter = updatedActiveLedger.recentEvents.reduce((s, e) => s + (e.xpAwarded || 0), 0);
  const totalCombinedXpAfter = totalActiveXpAfter + updatedArchive.totalArchivedXp;

  // 9. Pre-Commit Invariant Integrity Checks
  const totalEventsBefore = initialActiveRecords + initialArchiveRecords;
  const totalEventsAfter = finalActiveRecords + finalArchiveRecords;

  if (totalEventsBefore !== totalEventsAfter) {
    throw new Error(
      `Compaction integrity violation: Total event count mismatch! Before: ${totalEventsBefore}, After: ${totalEventsAfter}`
    );
  }

  if (totalCombinedXpBefore !== totalCombinedXpAfter) {
    throw new Error(
      `Compaction integrity violation: Total combined XP mismatch! Before: ${totalCombinedXpBefore}, After: ${totalCombinedXpAfter}`
    );
  }

  // 10. Handle Dry-Run Mode
  if (isDryRun) {
    return {
      status: 'DRY_RUN',
      message: `Dry-run evaluated: ${archivedRecordCount} records eligible for archival into batch ${batchId}. Files untouched.`,
      initialActiveRecords,
      finalActiveRecords,
      initialArchiveRecords,
      finalArchiveRecords,
      archivedRecordCount,
      archivedXp,
      totalActiveXpBefore,
      totalActiveXpAfter,
      totalCombinedXp: totalCombinedXpAfter,
      batchId,
      batchSha256,
      durationMs: Date.now() - startTime,
    };
  }

  // 11. Transactional Write-Ahead Commit
  try {
    await executeActivityTransaction(baseDir, [
      { targetPath: activityPath, data: updatedActiveLedger },
      { targetPath: archivePath, data: updatedArchive },
    ]);
  } catch (txErr) {
    return {
      status: 'ERROR',
      message: `Transaction commit failed during compaction: ${(txErr as Error).message}`,
      initialActiveRecords,
      finalActiveRecords: initialActiveRecords,
      initialArchiveRecords,
      finalArchiveRecords: initialArchiveRecords,
      archivedRecordCount: 0,
      archivedXp: 0,
      totalActiveXpBefore,
      totalActiveXpAfter: totalActiveXpBefore,
      totalCombinedXp: totalCombinedXpBefore,
      durationMs: Date.now() - startTime,
      error: txErr as Error,
    };
  }

  return {
    status: 'COMPACTED',
    message: `Successfully compacted ${archivedRecordCount} records into archive batch ${batchId}.`,
    initialActiveRecords,
    finalActiveRecords,
    initialArchiveRecords,
    finalArchiveRecords,
    archivedRecordCount,
    archivedXp,
    totalActiveXpBefore,
    totalActiveXpAfter,
    totalCombinedXp: totalCombinedXpAfter,
    batchId,
    batchSha256,
    durationMs: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Comprehensive Archive Verifier
// ---------------------------------------------------------------------------

export async function verifyActivityArchive(options: {
  baseDir?: string;
  ledgerData?: ActivityLedgerDocument;
  archiveData?: ActivityArchiveDocument;
}): Promise<ArchiveVerificationResult> {
  const startTime = Date.now();
  const baseDir = options.baseDir ?? process.cwd();
  const issues: ArchiveVerificationIssue[] = [];

  const activityPath = path.join(baseDir, 'pet/ledger/activity.json');
  const archivePath = path.join(baseDir, ACTIVITY_ARCHIVE_RELATIVE_PATH);
  const txDir = path.join(baseDir, ACTIVITY_TX_DIR);

  // 1. Check for Pending / Unresolved Transactions
  try {
    const txStat = await fs.stat(txDir);
    if (txStat.isDirectory()) {
      issues.push({
        severity: 'WARNING',
        code: 'PENDING_TRANSACTION_EXISTS',
        message: `An uncommitted or incomplete transaction journal exists at ${txDir}. Run recover to resolve.`,
      });
    }
  } catch {
    // Clean: No pending tx directory
  }

  // 2. Load Active Ledger
  let activeLedger: ActivityLedgerDocument | null = null;
  if (options.ledgerData) {
    activeLedger = options.ledgerData;
  } else {
    try {
      const raw = await fs.readFile(activityPath, 'utf-8');
      activeLedger = JSON.parse(raw);
    } catch (err) {
      issues.push({
        severity: 'ERROR',
        code: 'ACTIVE_LEDGER_LOAD_ERROR',
        message: `Failed to load active ledger at ${activityPath}: ${(err as Error).message}`,
      });
    }
  }

  // 3. Load Archive Document
  let archive: ActivityArchiveDocument | null = null;
  if (options.archiveData) {
    archive = options.archiveData;
  } else {
    try {
      const raw = await fs.readFile(archivePath, 'utf-8');
      archive = JSON.parse(raw);
    } catch {
      // Archive may not exist yet, which is valid if no records compacted
    }
  }

  const activeEvents = activeLedger?.recentEvents || [];
  const activeRecordCount = activeEvents.length;
  const totalActiveXp = activeEvents.reduce((s, e) => s + (e.xpAwarded || 0), 0);

  let archivedEvents: ActivityEventRecord[] = [];
  let batches: ActivityArchiveBatch[] = [];
  let totalArchivedXp = 0;

  if (archive) {
    const rawVersion = (archive as { schemaVersion?: unknown }).schemaVersion;
    if (rawVersion !== 1 && rawVersion !== 2) {
      issues.push({
        severity: 'ERROR',
        code: 'UNSUPPORTED_ARCHIVE_SCHEMA',
        message: `Archive document has unsupported schemaVersion: ${String(rawVersion)}`,
      });
    }

    if (isArchiveV2(archive)) {
      archivedEvents = archive.archivedEvents || [];
      batches = archive.batches || [];
      totalArchivedXp = archive.totalArchivedXp || archivedEvents.reduce((s, e) => s + (e.xpAwarded || 0), 0);
    } else {
      // v1 archive
      if (!Array.isArray(archive.archivedCommitShas)) {
        issues.push({
          severity: 'ERROR',
          code: 'MALFORMED_ARCHIVE_V1',
          message: 'V1 Archive document missing archivedCommitShas array',
        });
      }
    }
  }

  const archivedRecordCount = archivedEvents.length;
  const totalEventCount = activeRecordCount + archivedRecordCount;
  const totalCombinedXp = totalActiveXp + totalArchivedXp;

  // 4. Validate Event Identifiers & Check for Duplicates
  const seenEventIds = new Set<string>();

  for (const event of activeEvents) {
    if (!event.eventId) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_EVENT_ID',
        message: 'Active ledger contains record with missing or empty eventId',
        details: { event },
      });
      continue;
    }
    const lowerId = event.eventId.toLowerCase();
    if (seenEventIds.has(lowerId)) {
      issues.push({
        severity: 'ERROR',
        code: 'DUPLICATE_EVENT_ID',
        message: `Duplicate eventId detected in active ledger: ${event.eventId}`,
      });
    } else {
      seenEventIds.add(lowerId);
    }

    // Verify required fields
    if (!event.eventType || !event.actor || typeof event.xpAwarded !== 'number' || !event.status) {
      issues.push({
        severity: 'ERROR',
        code: 'MALFORMED_EVENT_RECORD',
        message: `Active event ${event.eventId} is missing required fields`,
      });
    }
  }

  for (const event of archivedEvents) {
    if (!event.eventId) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_ARCHIVED_EVENT_ID',
        message: 'Archived ledger contains record with missing or empty eventId',
      });
      continue;
    }
    const lowerId = event.eventId.toLowerCase();
    if (seenEventIds.has(lowerId)) {
      issues.push({
        severity: 'ERROR',
        code: 'COLLIDING_EVENT_ID_ACROSS_LEDGERS',
        message: `Event ID ${event.eventId} appears in both active ledger and archive!`,
      });
    } else {
      seenEventIds.add(lowerId);
    }

    if (!event.eventType || !event.actor || typeof event.xpAwarded !== 'number' || !event.status) {
      issues.push({
        severity: 'ERROR',
        code: 'MALFORMED_ARCHIVE_RECORD',
        message: `Archived event ${event.eventId} is missing required provenance fields`,
      });
    }
  }

  // 5. Verify Checksums across all Archive Batches
  let eventOffset = 0;
  for (const batch of batches) {
    const batchRecords = archivedEvents.slice(eventOffset, eventOffset + batch.recordCount);
    eventOffset += batch.recordCount;

    if (batchRecords.length !== batch.recordCount) {
      issues.push({
        severity: 'ERROR',
        code: 'BATCH_RECORD_COUNT_MISMATCH',
        message: `Batch ${batch.batchId} expects ${batch.recordCount} records, but only found ${batchRecords.length}`,
      });
      continue;
    }

    const computedSha = computeBatchSha256(batchRecords);
    if (computedSha.toLowerCase() !== batch.sha256.toLowerCase()) {
      issues.push({
        severity: 'ERROR',
        code: 'BATCH_CHECKSUM_MISMATCH',
        message: `Batch ${batch.batchId} checksum failed! Stored: ${batch.sha256}, Computed: ${computedSha}`,
      });
    }

    // Check batch XP sum
    const computedXp = batchRecords.reduce((s, e) => s + (e.xpAwarded || 0), 0);
    if (computedXp !== batch.totalXp) {
      issues.push({
        severity: 'ERROR',
        code: 'BATCH_XP_SUM_MISMATCH',
        message: `Batch ${batch.batchId} XP sum mismatch! Stored: ${batch.totalXp}, Computed: ${computedXp}`,
      });
    }
  }

  // 6. Classification Verdict
  const hasErrors = issues.some((i) => i.severity === 'ERROR');
  const hasWarnings = issues.some((i) => i.severity === 'WARNING');
  const status: 'PASS' | 'WARNING' | 'FAIL' = hasErrors ? 'FAIL' : hasWarnings ? 'WARNING' : 'PASS';

  return {
    status,
    activeRecordCount,
    archivedRecordCount,
    totalEventCount,
    uniqueEventCount: seenEventIds.size,
    totalActiveXp,
    totalArchivedXp,
    totalCombinedXp,
    batchCount: batches.length,
    issues,
    durationMs: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Transaction Recovery Helper
// ---------------------------------------------------------------------------

export async function recoverArchiveTransaction(options: {
  baseDir?: string;
  dryRun?: boolean;
}): Promise<{
  recovered: boolean;
  status: 'RECOVERED_COMMITTED' | 'ROLLED_BACK_UNCOMMITTED' | 'NO_PENDING_TX';
  message: string;
}> {
  const baseDir = options.baseDir ?? process.cwd();
  const txDir = path.join(baseDir, ACTIVITY_TX_DIR);
  const txMetaPath = path.join(txDir, 'tx.json');

  let isCommitted = false;

  try {
    const raw = await fs.readFile(txMetaPath, 'utf-8');
    const manifest = JSON.parse(raw);
    isCommitted = manifest.status === 'committed';
  } catch {
    // Missing or invalid
  }

  try {
    const stat = await fs.stat(txDir);
    if (!stat.isDirectory()) {
      return { recovered: false, status: 'NO_PENDING_TX', message: 'No transaction directory found.' };
    }
  } catch {
    return { recovered: false, status: 'NO_PENDING_TX', message: 'No transaction directory found.' };
  }

  if (options.dryRun) {
    if (isCommitted) {
      return {
        recovered: true,
        status: 'RECOVERED_COMMITTED',
        message: 'Pending committed transaction found. Recovery would roll forward staged files.',
      };
    } else {
      return {
        recovered: true,
        status: 'ROLLED_BACK_UNCOMMITTED',
        message: 'Uncommitted or partial transaction found. Recovery would roll back and remove staging directory.',
      };
    }
  }

  const success = await recoverActivityTransaction(baseDir);
  return {
    recovered: success,
    status: isCommitted ? 'RECOVERED_COMMITTED' : 'ROLLED_BACK_UNCOMMITTED',
    message: isCommitted
      ? 'Committed transaction successfully rolled forward.'
      : 'Uncommitted transaction successfully rolled back.',
  };
}
