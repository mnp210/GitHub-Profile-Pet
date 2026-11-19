/**
 * GitHub Profile Pet - Activity Progression Processor
 *
 * Implements deterministic processing of qualifying repository activities (commits,
 * issues, PRs, merges, reviews), awarding XP, enforcing daily caps, and maintaining
 * an auditable, replay-protected activity ledger.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PetStateDocument } from '../domain/types.ts';
import { applyExperience } from '../transitions/progressionEngine.ts';
import { publishPetSvg } from '../publication/svgPublisher.ts';
import {
  ACTIVITY_LEDGER_SCHEMA_VERSION,
  ACTIVITY_XP_REWARDS,
  DAILY_ACTIVITY_XP_CAP,
  KNOWN_BOT_LOGINS,
  IGNORE_COMMIT_MESSAGE_PATTERNS,
  PET_ACTION_PENDING_LABEL,
  PET_CARE_ACTION_LABEL_PREFIX,
  MAX_RECENT_EVENTS_RETAINED,
} from './constants.ts';
import type {
  ActivityEventRecord,
  ActivityLedgerDocument,
  ActivityProcessedRegistry,
  ActivityType,
  ProcessActivityEventInput,
  ProcessActivityResult,
} from './types.ts';

/**
 * Creates an empty pristine activity ledger.
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
    recentEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Checks whether an actor represents an automated bot or service.
 */
export function isBotActor(actor: string, isBotFlag?: boolean): boolean {
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
 * Checks if an event has already been recorded in the processed deduplication registry.
 */
export function isDuplicateEvent(
  registry: ActivityProcessedRegistry,
  eventType: ActivityType,
  eventId: string
): boolean {
  const cleanId = eventId.trim();

  switch (eventType) {
    case 'commit': {
      // eventId can be "commit:<sha>" or raw "<sha>"
      const sha = cleanId.replace(/^commit:/i, '').toLowerCase();
      return registry.commitShas.some((s) => s.toLowerCase() === sha);
    }
    case 'issue_opened': {
      const num = parseInt(cleanId.replace(/^issue:/i, ''), 10);
      return Number.isInteger(num) && registry.issueNumbers.includes(num);
    }
    case 'pr_opened': {
      const num = parseInt(cleanId.replace(/^pr_opened:/i, '').replace(/^pr:/i, ''), 10);
      return Number.isInteger(num) && registry.prOpenedNumbers.includes(num);
    }
    case 'pr_merged': {
      const num = parseInt(cleanId.replace(/^pr_merged:/i, '').replace(/^pr:/i, ''), 10);
      return Number.isInteger(num) && registry.prMergedNumbers.includes(num);
    }
    case 'review_submitted': {
      const id = parseInt(cleanId.replace(/^review:/i, ''), 10);
      return Number.isInteger(id) && registry.reviewIds.includes(id);
    }
    default:
      return false;
  }
}

/**
 * Records an event identifier into the deduplication registry.
 */
export function recordProcessedIdentifier(
  registry: ActivityProcessedRegistry,
  eventType: ActivityType,
  eventId: string
): void {
  const cleanId = eventId.trim();

  switch (eventType) {
    case 'commit': {
      const sha = cleanId.replace(/^commit:/i, '').toLowerCase();
      if (!registry.commitShas.some((s) => s.toLowerCase() === sha)) {
        registry.commitShas.push(sha);
      }
      break;
    }
    case 'issue_opened': {
      const num = parseInt(cleanId.replace(/^issue:/i, ''), 10);
      if (Number.isInteger(num) && !registry.issueNumbers.includes(num)) {
        registry.issueNumbers.push(num);
      }
      break;
    }
    case 'pr_opened': {
      const num = parseInt(cleanId.replace(/^pr_opened:/i, '').replace(/^pr:/i, ''), 10);
      if (Number.isInteger(num) && !registry.prOpenedNumbers.includes(num)) {
        registry.prOpenedNumbers.push(num);
      }
      break;
    }
    case 'pr_merged': {
      const num = parseInt(cleanId.replace(/^pr_merged:/i, '').replace(/^pr:/i, ''), 10);
      if (Number.isInteger(num) && !registry.prMergedNumbers.includes(num)) {
        registry.prMergedNumbers.push(num);
      }
      break;
    }
    case 'review_submitted': {
      const id = parseInt(cleanId.replace(/^review:/i, ''), 10);
      if (Number.isInteger(id) && !registry.reviewIds.includes(id)) {
        registry.reviewIds.push(id);
      }
      break;
    }
  }
}

/**
 * Pure evaluation function that processes an activity event against state and ledger documents.
 */
export function evaluateActivityEvent(
  petState: PetStateDocument,
  ledger: ActivityLedgerDocument,
  input: ProcessActivityEventInput,
  nowUtc: string = new Date().toISOString()
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

  // 3. Pet Care Action Issue Exclusion
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

  // 4. Duplicate Event Deduplication
  if (isDuplicateEvent(ledger.processedRegistry, input.eventType, input.eventId)) {
    const skippedRecord: ActivityEventRecord = {
      eventId: input.eventId,
      eventType: input.eventType,
      actor: input.actor,
      timestamp: nowUtc,
      xpAwarded: 0,
      status: 'skipped_duplicate',
      details: `Event ${input.eventId} has already been rewarded. Replay ignored.`,
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

  // 5. Daily Activity XP Cap Enforcement
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

    // Record identifier in registry so it is not re-evaluated if resent
    const newRegistry = {
      ...ledger.processedRegistry,
      commitShas: [...ledger.processedRegistry.commitShas],
      issueNumbers: [...ledger.processedRegistry.issueNumbers],
      prOpenedNumbers: [...ledger.processedRegistry.prOpenedNumbers],
      prMergedNumbers: [...ledger.processedRegistry.prMergedNumbers],
      reviewIds: [...ledger.processedRegistry.reviewIds],
    };
    recordProcessedIdentifier(newRegistry, input.eventType, input.eventId);

    const updatedLedger: ActivityLedgerDocument = {
      ...ledger,
      processedRegistry: newRegistry,
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

  // Award XP (clamped to remaining daily budget)
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
  recordProcessedIdentifier(newRegistry, input.eventType, input.eventId);

  const newDailyAccrued = {
    ...ledger.dailyAccruedXp,
    [dateKey]: currentDailyAccrued + effectiveXp,
  };

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
async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
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
 * Executes full activity processing against on-disk files.
 */
export async function executeActivityProcessing(options: {
  baseDir?: string;
  event: ProcessActivityEventInput;
  nowMs?: number;
  skipSvgRender?: boolean;
  dryRun?: boolean;
}): Promise<{
  success: boolean;
  result: ProcessActivityResult;
  petState: PetStateDocument;
  activityLedger: ActivityLedgerDocument;
}> {
  const baseDir = options.baseDir ?? process.cwd();
  const statePath = path.join(baseDir, 'pet', 'state', 'pet.json');
  const activityPath = path.join(baseDir, 'pet', 'ledger', 'activity.json');
  const nowUtc = options.nowMs ? new Date(options.nowMs).toISOString() : new Date().toISOString();

  // 1. Read or initialize pet state
  let petState: PetStateDocument;
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    petState = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to load authoritative pet state at ${statePath}: ${(err as Error).message}`);
  }

  // 2. Read or initialize activity ledger
  let activityLedger: ActivityLedgerDocument;
  try {
    const raw = await fs.readFile(activityPath, 'utf-8');
    activityLedger = JSON.parse(raw);
  } catch {
    // If activity.json does not exist yet, initialize pristine
    activityLedger = initDefaultActivityLedger(petState.generation ?? 1);
  }

  // 3. Evaluate activity
  const { updatedPet, updatedLedger, result } = evaluateActivityEvent(
    petState,
    activityLedger,
    options.event,
    nowUtc
  );

  // 4. If state changed or event was recorded, atomically persist both documents unless dryRun
  if (!options.dryRun) {
    await atomicWriteJson(activityPath, updatedLedger);

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
  };
}
