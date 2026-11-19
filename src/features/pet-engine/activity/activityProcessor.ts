/**
 * GitHub Profile Pet - Activity Progression Processor
 *
 * Implements deterministic processing of qualifying repository activities (commits,
 * issues, PRs, merges, reviews), awarding XP, enforcing daily caps, and maintaining
 * an auditable, replay-protected, permanently deduplicated activity ledger.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PetStateDocument } from '../domain/types.ts';
import { applyExperience } from '../transitions/progressionEngine.ts';
import { publishPetSvg } from '../publication/svgPublisher.ts';
import {
  ACTIVITY_LEDGER_SCHEMA_VERSION,
  ACTIVITY_ARCHIVE_SCHEMA_VERSION,
  ACTIVITY_ARCHIVE_RELATIVE_PATH,
  ACTIVITY_XP_REWARDS,
  DAILY_ACTIVITY_XP_CAP,
  KNOWN_BOT_LOGINS,
  IGNORE_COMMIT_MESSAGE_PATTERNS,
  PET_ACTION_PENDING_LABEL,
  PET_CARE_ACTION_LABEL_PREFIX,
  MAX_RECENT_EVENTS_RETAINED,
  MAX_REGISTRY_ENTRIES,
  MAX_ACTIVE_COMMIT_SHAS,
  MAX_ACTIVITY_AGE_DAYS,
  MAX_DAILY_ACCRUED_DAYS,
} from './constants.ts';
import {
  isNumberInIntervals,
  addNumberToIntervals,
} from './intervalIndex.ts';
import type {
  ActivityEventRecord,
  ActivityLedgerDocument,
  ActivityProcessedRegistry,
  ActivityArchiveDocument,
  PermanentDeduplicationIndex,
  ActivityType,
  ProcessActivityEventInput,
  ProcessActivityResult,
} from './types.ts';

/**
 * Creates an empty pristine activity ledger with both active and permanent deduplication registries.
 */
export function initDefaultActivityLedger(generation: number = 1): ActivityLedgerDocument {
  return {
    schemaVersion: ACTIVITY_LEDGER_SCHEMA_VERSION,
    generation,
    dailyAccruedXp: {},
    processedRegistry: {
      commitShas: [],
      issueNumbers: [],
      prOpenedNumbers: [],
      prMergedNumbers: [],
      reviewIds: [],
    },
    permanentIndex: {
      commitShas: [],
      issueIntervals: [],
      prOpenedIntervals: [],
      prMergedIntervals: [],
      reviewIntervals: [],
    },
    recentEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Creates an empty activity archive document.
 */
export function initDefaultActivityArchive(): ActivityArchiveDocument {
  return {
    schemaVersion: ACTIVITY_ARCHIVE_SCHEMA_VERSION,
    archivedCommitShas: [],
    archivedEventCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Checks whether an actor represents an automated bot or service.
 */
export function isBotActor(actor: string | undefined, isBotFlag?: boolean): boolean {
  if (isBotFlag === true) return true;
  if (!actor || typeof actor !== 'string') return true;

  const normalized = actor.trim().toLowerCase();
  if (normalized.endsWith('[bot]')) return true;

  return KNOWN_BOT_LOGINS.some((bot) => normalized === bot || normalized.includes(bot));
}

/**
 * Checks whether a commit message represents automated CI maintenance or pet state update.
 */
export function isIgnoredCommit(commitMessage?: string): boolean {
  if (!commitMessage || typeof commitMessage !== 'string') return false;
  return IGNORE_COMMIT_MESSAGE_PATTERNS.some((pattern) => pattern.test(commitMessage));
}

/**
 * Checks whether an issue is a pet care action (which is evaluated by Inbox, not activity XP).
 */
export function isCareActionIssue(labels?: string[], title?: string): boolean {
  if (labels && Array.isArray(labels)) {
    if (labels.some((l) => l === PET_ACTION_PENDING_LABEL || l.startsWith(PET_CARE_ACTION_LABEL_PREFIX))) {
      return true;
    }
  }
  if (title && typeof title === 'string') {
    if (title.trim().toLowerCase().startsWith('pet:')) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an event has already been recorded across:
 * 1. Active working registry
 * 2. Permanent interval indices & active commit set
 * 3. Historical activity archive (if provided)
 */
export function isDuplicateEvent(
  registry: ActivityProcessedRegistry,
  eventType: ActivityType,
  eventId: string,
  permanentIndex?: PermanentDeduplicationIndex,
  archivedCommitShas?: string[]
): boolean {
  const cleanId = eventId.trim();

  switch (eventType) {
    case 'commit': {
      const sha = cleanId.replace(/^commit:/i, '').toLowerCase();
      // 1. Active registry
      if (registry.commitShas.some((s) => s.toLowerCase() === sha)) return true;
      // 2. Permanent index
      if (permanentIndex?.commitShas.some((s) => s.toLowerCase() === sha)) return true;
      // 3. Historical archive
      if (archivedCommitShas && archivedCommitShas.some((s) => s.toLowerCase() === sha)) return true;
      return false;
    }
    case 'issue_opened': {
      const num = parseInt(cleanId.replace(/^issue:/i, ''), 10);
      if (!Number.isInteger(num)) return false;
      if (registry.issueNumbers.includes(num)) return true;
      if (permanentIndex && isNumberInIntervals(permanentIndex.issueIntervals, num)) return true;
      return false;
    }
    case 'pr_opened': {
      const num = parseInt(cleanId.replace(/^pr_opened:/i, '').replace(/^pr:/i, ''), 10);
      if (!Number.isInteger(num)) return false;
      if (registry.prOpenedNumbers.includes(num)) return true;
      if (permanentIndex && isNumberInIntervals(permanentIndex.prOpenedIntervals, num)) return true;
      return false;
    }
    case 'pr_merged': {
      const num = parseInt(cleanId.replace(/^pr_merged:/i, '').replace(/^pr:/i, ''), 10);
      if (!Number.isInteger(num)) return false;
      if (registry.prMergedNumbers.includes(num)) return true;
      if (permanentIndex && isNumberInIntervals(permanentIndex.prMergedIntervals, num)) return true;
      return false;
    }
    case 'review_submitted': {
      const id = parseInt(cleanId.replace(/^review:/i, ''), 10);
      if (!Number.isInteger(id)) return false;
      if (registry.reviewIds.includes(id)) return true;
      if (permanentIndex && isNumberInIntervals(permanentIndex.reviewIntervals, id)) return true;
      return false;
    }
    default:
      return false;
  }
}

/**
 * Checks whether an event timestamp is older than the maximum eligibility lookback window.
 */
export function isEventStale(
  eventTimestamp: string | undefined,
  nowUtc: string,
  maxAgeDays: number = MAX_ACTIVITY_AGE_DAYS
): boolean {
  if (!eventTimestamp) return false;
  const eventTime = new Date(eventTimestamp).getTime();
  const nowTime = new Date(nowUtc).getTime();
  if (Number.isNaN(eventTime) || Number.isNaN(nowTime)) return false;
  const ageMs = nowTime - eventTime;
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

/**
 * Prunes daily accrued XP entries older than the retention threshold.
 */
export function pruneDailyAccruedXp(
  dailyMap: Record<string, number>,
  nowUtc: string,
  maxDays: number = MAX_DAILY_ACCRUED_DAYS
): Record<string, number> {
  const cutoffTime = new Date(nowUtc).getTime() - maxDays * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffTime).toISOString().slice(0, 10);
  const pruned: Record<string, number> = {};

  for (const [dateKey, xp] of Object.entries(dailyMap)) {
    if (dateKey >= cutoffDate) {
      pruned[dateKey] = xp;
    }
  }

  return pruned;
}

/**
 * Records an event identifier into both the active working registry and the permanent index.
 */
export function recordProcessedIdentifier(
  registry: ActivityProcessedRegistry,
  eventType: ActivityType,
  eventId: string,
  permanentIndex?: PermanentDeduplicationIndex,
  maxEntries: number = MAX_REGISTRY_ENTRIES
): PermanentDeduplicationIndex {
  const cleanId = eventId.trim();
  const perm: PermanentDeduplicationIndex = permanentIndex
    ? {
        commitShas: [...permanentIndex.commitShas],
        issueIntervals: [...permanentIndex.issueIntervals],
        prOpenedIntervals: [...permanentIndex.prOpenedIntervals],
        prMergedIntervals: [...permanentIndex.prMergedIntervals],
        reviewIntervals: [...permanentIndex.reviewIntervals],
      }
    : {
        commitShas: [],
        issueIntervals: [],
        prOpenedIntervals: [],
        prMergedIntervals: [],
        reviewIntervals: [],
      };

  switch (eventType) {
    case 'commit': {
      const sha = cleanId.replace(/^commit:/i, '').toLowerCase();
      if (!registry.commitShas.some((s) => s.toLowerCase() === sha)) {
        registry.commitShas.push(sha);
        if (registry.commitShas.length > maxEntries) {
          registry.commitShas = registry.commitShas.slice(-maxEntries);
        }
      }
      if (!perm.commitShas.some((s) => s.toLowerCase() === sha)) {
        perm.commitShas.push(sha);
      }
      break;
    }
    case 'issue_opened': {
      const num = parseInt(cleanId.replace(/^issue:/i, ''), 10);
      if (Number.isInteger(num)) {
        if (!registry.issueNumbers.includes(num)) {
          registry.issueNumbers.push(num);
          if (registry.issueNumbers.length > maxEntries) {
            registry.issueNumbers = registry.issueNumbers.slice(-maxEntries);
          }
        }
        perm.issueIntervals = addNumberToIntervals(perm.issueIntervals, num);
      }
      break;
    }
    case 'pr_opened': {
      const num = parseInt(cleanId.replace(/^pr_opened:/i, '').replace(/^pr:/i, ''), 10);
      if (Number.isInteger(num)) {
        if (!registry.prOpenedNumbers.includes(num)) {
          registry.prOpenedNumbers.push(num);
          if (registry.prOpenedNumbers.length > maxEntries) {
            registry.prOpenedNumbers = registry.prOpenedNumbers.slice(-maxEntries);
          }
        }
        perm.prOpenedIntervals = addNumberToIntervals(perm.prOpenedIntervals, num);
      }
      break;
    }
    case 'pr_merged': {
      const num = parseInt(cleanId.replace(/^pr_merged:/i, '').replace(/^pr:/i, ''), 10);
      if (Number.isInteger(num)) {
        if (!registry.prMergedNumbers.includes(num)) {
          registry.prMergedNumbers.push(num);
          if (registry.prMergedNumbers.length > maxEntries) {
            registry.prMergedNumbers = registry.prMergedNumbers.slice(-maxEntries);
          }
        }
        perm.prMergedIntervals = addNumberToIntervals(perm.prMergedIntervals, num);
      }
      break;
    }
    case 'review_submitted': {
      const id = parseInt(cleanId.replace(/^review:/i, ''), 10);
      if (Number.isInteger(id)) {
        if (!registry.reviewIds.includes(id)) {
          registry.reviewIds.push(id);
          if (registry.reviewIds.length > maxEntries) {
            registry.reviewIds = registry.reviewIds.slice(-maxEntries);
          }
        }
        perm.reviewIntervals = addNumberToIntervals(perm.reviewIntervals, id);
      }
      break;
    }
  }

  return perm;
}

/**
 * Pure evaluation function that processes an activity event against state and ledger documents.
 */
export function evaluateActivityEvent(
  petState: PetStateDocument,
  ledger: ActivityLedgerDocument,
  input: ProcessActivityEventInput,
  nowUtc: string = new Date().toISOString(),
  archivedCommitShas?: string[]
): {
  updatedPet: PetStateDocument;
  updatedLedger: ActivityLedgerDocument;
  result: ProcessActivityResult;
} {
  const dateKey = nowUtc.slice(0, 10); // YYYY-MM-DD
  const baseReward = ACTIVITY_XP_REWARDS[input.eventType] ?? 0;

  // 1. Bot & Automation Filtering
  if (isBotActor(input.actor, input.isBot)) {
    const skippedRecord: ActivityEventRecord = {
      eventId: input.eventId,
      eventType: input.eventType,
      actor: input.actor,
      timestamp: nowUtc,
      xpAwarded: 0,
      status: 'skipped_bot',
      details: `Ignored activity from automated bot or service (${input.actor})`,
      ref: input.ref,
    };

    const updatedLedger: ActivityLedgerDocument = {
      ...ledger,
      recentEvents: [skippedRecord, ...ledger.recentEvents].slice(0, MAX_RECENT_EVENTS_RETAINED),
      updatedAt: nowUtc,
    };

    return {
      updatedPet: petState,
      updatedLedger,
      result: {
        success: true,
        xpAwarded: 0,
        status: 'skipped_bot',
        didLevelUp: false,
        previousLevel: petState.level,
        newLevel: petState.level,
        previousXp: petState.xp,
        newXp: petState.xp,
        evolutionStage: petState.evolutionStage,
        reason: skippedRecord.details,
      },
    };
  }

  // 2. Commit Message Pattern Filtering (e.g. [skip ci], pet automated commits)
  if (input.eventType === 'commit' && isIgnoredCommit(input.commitMessage)) {
    const skippedRecord: ActivityEventRecord = {
      eventId: input.eventId,
      eventType: input.eventType,
      actor: input.actor,
      timestamp: nowUtc,
      xpAwarded: 0,
      status: 'skipped_bot',
      details: `Ignored commit with automation or skip-ci message: "${input.commitMessage?.slice(0, 50)}"`,
      ref: input.ref,
    };

    const updatedLedger: ActivityLedgerDocument = {
      ...ledger,
      recentEvents: [skippedRecord, ...ledger.recentEvents].slice(0, MAX_RECENT_EVENTS_RETAINED),
      updatedAt: nowUtc,
    };

    return {
      updatedPet: petState,
      updatedLedger,
      result: {
        success: true,
        xpAwarded: 0,
        status: 'skipped_bot',
        didLevelUp: false,
        previousLevel: petState.level,
        newLevel: petState.level,
        previousXp: petState.xp,
        newXp: petState.xp,
        evolutionStage: petState.evolutionStage,
        reason: skippedRecord.details,
      },
    };
  }

  // 3. Activity Lookback Window / Staleness Boundary Check
  if (isEventStale(input.timestamp, nowUtc)) {
    const skippedRecord: ActivityEventRecord = {
      eventId: input.eventId,
      eventType: input.eventType,
      actor: input.actor,
      timestamp: nowUtc,
      xpAwarded: 0,
      status: 'skipped_stale',
      details: `Activity event timestamp (${input.timestamp}) exceeds the ${MAX_ACTIVITY_AGE_DAYS}-day eligibility window.`,
      ref: input.ref,
    };

    const updatedLedger: ActivityLedgerDocument = {
      ...ledger,
      recentEvents: [skippedRecord, ...ledger.recentEvents].slice(0, MAX_RECENT_EVENTS_RETAINED),
      updatedAt: nowUtc,
    };

    return {
      updatedPet: petState,
      updatedLedger,
      result: {
        success: true,
        xpAwarded: 0,
        status: 'skipped_stale',
        didLevelUp: false,
        previousLevel: petState.level,
        newLevel: petState.level,
        previousXp: petState.xp,
        newXp: petState.xp,
        evolutionStage: petState.evolutionStage,
        reason: skippedRecord.details,
      },
    };
  }

  // 4. Pet Care Action Issue Exclusion
  if (input.eventType === 'issue_opened' && isCareActionIssue(input.issueLabels, input.details)) {
    const skippedRecord: ActivityEventRecord = {
      eventId: input.eventId,
      eventType: input.eventType,
      actor: input.actor,
      timestamp: nowUtc,
      xpAwarded: 0,
      status: 'skipped_care_action',
      details: 'Issue is a companion care action. Processed separately by Care Action Inbox.',
      ref: input.ref,
    };

    const updatedLedger: ActivityLedgerDocument = {
      ...ledger,
      recentEvents: [skippedRecord, ...ledger.recentEvents].slice(0, MAX_RECENT_EVENTS_RETAINED),
      updatedAt: nowUtc,
    };

    return {
      updatedPet: petState,
      updatedLedger,
      result: {
        success: true,
        xpAwarded: 0,
        status: 'skipped_care_action',
        didLevelUp: false,
        previousLevel: petState.level,
        newLevel: petState.level,
        previousXp: petState.xp,
        newXp: petState.xp,
        evolutionStage: petState.evolutionStage,
        reason: skippedRecord.details,
      },
    };
  }

  // 5. Permanent Deduplication Check
  if (isDuplicateEvent(ledger.processedRegistry, input.eventType, input.eventId, ledger.permanentIndex, archivedCommitShas)) {
    const skippedRecord: ActivityEventRecord = {
      eventId: input.eventId,
      eventType: input.eventType,
      actor: input.actor,
      timestamp: nowUtc,
      xpAwarded: 0,
      status: 'skipped_duplicate',
      details: `Event ${input.eventId} has already been recorded in permanent deduplication index. Replay ignored.`,
      ref: input.ref,
    };

    const updatedLedger: ActivityLedgerDocument = {
      ...ledger,
      recentEvents: [skippedRecord, ...ledger.recentEvents].slice(0, MAX_RECENT_EVENTS_RETAINED),
      updatedAt: nowUtc,
    };

    return {
      updatedPet: petState,
      updatedLedger,
      result: {
        success: true,
        xpAwarded: 0,
        status: 'skipped_duplicate',
        didLevelUp: false,
        previousLevel: petState.level,
        newLevel: petState.level,
        previousXp: petState.xp,
        newXp: petState.xp,
        evolutionStage: petState.evolutionStage,
        reason: skippedRecord.details,
      },
    };
  }

  // 6. Daily Activity XP Cap Enforcement
  const currentDailyAccrued = ledger.dailyAccruedXp[dateKey] ?? 0;
  const remainingBudget = Math.max(0, DAILY_ACTIVITY_XP_CAP - currentDailyAccrued);

  if (remainingBudget <= 0) {
    const skippedRecord: ActivityEventRecord = {
      eventId: input.eventId,
      eventType: input.eventType,
      actor: input.actor,
      timestamp: nowUtc,
      xpAwarded: 0,
      status: 'skipped_daily_cap',
      details: `Daily activity XP cap (${DAILY_ACTIVITY_XP_CAP} XP) reached for ${dateKey}.`,
      ref: input.ref,
    };

    // Record identifier in permanent registry so it is not re-evaluated if resent
    const newRegistry = {
      ...ledger.processedRegistry,
      commitShas: [...ledger.processedRegistry.commitShas],
      issueNumbers: [...ledger.processedRegistry.issueNumbers],
      prOpenedNumbers: [...ledger.processedRegistry.prOpenedNumbers],
      prMergedNumbers: [...ledger.processedRegistry.prMergedNumbers],
      reviewIds: [...ledger.processedRegistry.reviewIds],
    };
    const newPermanent = recordProcessedIdentifier(newRegistry, input.eventType, input.eventId, ledger.permanentIndex);

    const updatedLedger: ActivityLedgerDocument = {
      ...ledger,
      dailyAccruedXp: pruneDailyAccruedXp(ledger.dailyAccruedXp, nowUtc),
      processedRegistry: newRegistry,
      permanentIndex: newPermanent,
      recentEvents: [skippedRecord, ...ledger.recentEvents].slice(0, MAX_RECENT_EVENTS_RETAINED),
      updatedAt: nowUtc,
    };

    return {
      updatedPet: petState,
      updatedLedger,
      result: {
        success: true,
        xpAwarded: 0,
        status: 'skipped_daily_cap',
        didLevelUp: false,
        previousLevel: petState.level,
        newLevel: petState.level,
        previousXp: petState.xp,
        newXp: petState.xp,
        evolutionStage: petState.evolutionStage,
        reason: skippedRecord.details,
      },
    };
  }

  // 7. Award XP (clamped to remaining daily budget)
  const effectiveXp = Math.min(baseReward, remainingBudget);

  // Apply experience progression
  const progression = applyExperience(petState.level, petState.xp, effectiveXp);

  const updatedPet: PetStateDocument = {
    ...petState,
    level: progression.newLevel,
    xp: progression.newXp,
    maxExp: progression.newMaxExp,
    evolutionStage: progression.newEvolutionStage,
    mood: progression.didLevelUp ? 'Energetic' : 'Happy',
    generation: (petState.generation ?? 0) + 1,
    lastInteractionTime: nowUtc,
    updatedAt: nowUtc,
  };

  const newRegistry = {
    ...ledger.processedRegistry,
    commitShas: [...ledger.processedRegistry.commitShas],
    issueNumbers: [...ledger.processedRegistry.issueNumbers],
    prOpenedNumbers: [...ledger.processedRegistry.prOpenedNumbers],
    prMergedNumbers: [...ledger.processedRegistry.prMergedNumbers],
    reviewIds: [...ledger.processedRegistry.reviewIds],
  };
  const newPermanent = recordProcessedIdentifier(newRegistry, input.eventType, input.eventId, ledger.permanentIndex);

  const newDailyAccrued = pruneDailyAccruedXp(
    {
      ...ledger.dailyAccruedXp,
      [dateKey]: currentDailyAccrued + effectiveXp,
    },
    nowUtc
  );

  const rewardedRecord: ActivityEventRecord = {
    eventId: input.eventId,
    eventType: input.eventType,
    actor: input.actor,
    timestamp: nowUtc,
    xpAwarded: effectiveXp,
    status: 'rewarded',
    details: input.details || `Awarded ${effectiveXp} XP for ${input.eventType}`,
    ref: input.ref,
  };

  const updatedLedger: ActivityLedgerDocument = {
    ...ledger,
    generation: (ledger.generation ?? 0) + 1,
    dailyAccruedXp: newDailyAccrued,
    processedRegistry: newRegistry,
    permanentIndex: newPermanent,
    recentEvents: [rewardedRecord, ...ledger.recentEvents].slice(0, MAX_RECENT_EVENTS_RETAINED),
    updatedAt: nowUtc,
  };

  return {
    updatedPet,
    updatedLedger,
    result: {
      success: true,
      xpAwarded: effectiveXp,
      status: 'rewarded',
      didLevelUp: progression.didLevelUp,
      previousLevel: petState.level,
      newLevel: progression.newLevel,
      previousXp: petState.xp,
      newXp: progression.newXp,
      evolutionStage: progression.newEvolutionStage,
      reason: rewardedRecord.details,
    },
  };
}

/**
 * Atomically writes JSON content using a temporary file followed by rename.
 */
export async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.tmp.${path.basename(targetPath)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  );

  const serialized = JSON.stringify(data, null, 2) + '\n';
  await fs.writeFile(tempPath, serialized, 'utf-8');
  await fs.rename(tempPath, targetPath);
}

/**
 * Loads the durable activity archive from disk if present.
 */
export async function loadActivityArchive(baseDir: string): Promise<ActivityArchiveDocument | null> {
  const archivePath = path.join(baseDir, ACTIVITY_ARCHIVE_RELATIVE_PATH);
  try {
    const raw = await fs.readFile(archivePath, 'utf-8');
    return JSON.parse(raw) as ActivityArchiveDocument;
  } catch {
    return null;
  }
}

/**
 * Saves the durable activity archive to disk atomically.
 */
export async function saveActivityArchive(baseDir: string, archive: ActivityArchiveDocument): Promise<void> {
  const archivePath = path.join(baseDir, ACTIVITY_ARCHIVE_RELATIVE_PATH);
  await atomicWriteJson(archivePath, archive);
}

/**
 * Executes full activity processing against on-disk files.
 */
export async function executeActivityProcessing(options: {
  baseDir?: string;
  event: ProcessActivityEventInput;
  nowMs?: number;
  skipSvgRender?: boolean;
  dryRun?: boolean;
  currentPetState?: PetStateDocument;
  currentActivityLedger?: ActivityLedgerDocument;
  currentArchive?: ActivityArchiveDocument;
}): Promise<{
  success: boolean;
  result: ProcessActivityResult;
  petState: PetStateDocument;
  activityLedger: ActivityLedgerDocument;
  activityArchive?: ActivityArchiveDocument;
}> {
  const baseDir = options.baseDir ?? process.cwd();
  const statePath = path.join(baseDir, 'pet', 'state', 'pet.json');
  const activityPath = path.join(baseDir, 'pet', 'ledger', 'activity.json');
  const nowUtc = options.nowMs ? new Date(options.nowMs).toISOString() : new Date().toISOString();

  // 1. Read or use provided pet state
  let petState: PetStateDocument;
  if (options.currentPetState) {
    petState = options.currentPetState;
  } else {
    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      petState = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to load authoritative pet state at ${statePath}: ${(err as Error).message}`);
    }
  }

  // 2. Read or use provided activity ledger
  let activityLedger: ActivityLedgerDocument;
  if (options.currentActivityLedger) {
    activityLedger = options.currentActivityLedger;
  } else {
    try {
      const raw = await fs.readFile(activityPath, 'utf-8');
      activityLedger = JSON.parse(raw);
    } catch {
      activityLedger = initDefaultActivityLedger(petState.generation ?? 1);
    }
  }

  // Ensure permanentIndex exists on ledger
  if (!activityLedger.permanentIndex) {
    activityLedger.permanentIndex = {
      commitShas: [...activityLedger.processedRegistry.commitShas],
      issueIntervals: [],
      prOpenedIntervals: [],
      prMergedIntervals: [],
      reviewIntervals: [],
    };
    for (const n of activityLedger.processedRegistry.issueNumbers) {
      activityLedger.permanentIndex.issueIntervals = addNumberToIntervals(activityLedger.permanentIndex.issueIntervals, n);
    }
    for (const n of activityLedger.processedRegistry.prOpenedNumbers) {
      activityLedger.permanentIndex.prOpenedIntervals = addNumberToIntervals(activityLedger.permanentIndex.prOpenedIntervals, n);
    }
    for (const n of activityLedger.processedRegistry.prMergedNumbers) {
      activityLedger.permanentIndex.prMergedIntervals = addNumberToIntervals(activityLedger.permanentIndex.prMergedIntervals, n);
    }
    for (const n of activityLedger.processedRegistry.reviewIds) {
      activityLedger.permanentIndex.reviewIntervals = addNumberToIntervals(activityLedger.permanentIndex.reviewIntervals, n);
    }
  }

  // 3. Load or use provided activity archive
  let archive: ActivityArchiveDocument;
  if (options.currentArchive) {
    archive = options.currentArchive;
  } else {
    archive = (await loadActivityArchive(baseDir)) ?? initDefaultActivityArchive();
  }

  // 4. Evaluate activity event
  const { updatedPet, updatedLedger, result } = evaluateActivityEvent(
    petState,
    activityLedger,
    options.event,
    nowUtc,
    archive.archivedCommitShas
  );

  // 5. Spillover check: if permanentIndex.commitShas > MAX_ACTIVE_COMMIT_SHAS, archive older commits
  let archiveModified = false;
  if (updatedLedger.permanentIndex && updatedLedger.permanentIndex.commitShas.length > MAX_ACTIVE_COMMIT_SHAS) {
    const excessCount = updatedLedger.permanentIndex.commitShas.length - MAX_ACTIVE_COMMIT_SHAS;
    const toArchive = updatedLedger.permanentIndex.commitShas.slice(0, excessCount);

    const existingSet = new Set(archive.archivedCommitShas.map((s) => s.toLowerCase()));
    for (const sha of toArchive) {
      const lower = sha.toLowerCase();
      if (!existingSet.has(lower)) {
        existingSet.add(lower);
        archive.archivedCommitShas.push(lower);
        archiveModified = true;
      }
    }

    archive.archivedEventCount = archive.archivedCommitShas.length;
    archive.updatedAt = nowUtc;
    updatedLedger.permanentIndex.commitShas = updatedLedger.permanentIndex.commitShas.slice(-MAX_ACTIVE_COMMIT_SHAS);
  }

  // 6. If not dryRun, atomically persist changes
  if (!options.dryRun) {
    await atomicWriteJson(activityPath, updatedLedger);

    if (archiveModified) {
      await saveActivityArchive(baseDir, archive);
    }

    if (result.xpAwarded > 0) {
      await atomicWriteJson(statePath, updatedPet);

      // Render updated SVG & README in lockstep
      if (!options.skipSvgRender) {
        await publishPetSvg({ baseDir }).catch((err) => {
          console.warn('SVG publish notice after activity progression:', (err as Error).message);
        });
      }
    }
  }

  return {
    success: result.success,
    result,
    petState: updatedPet,
    activityLedger: updatedLedger,
    activityArchive: archive,
  };
}
