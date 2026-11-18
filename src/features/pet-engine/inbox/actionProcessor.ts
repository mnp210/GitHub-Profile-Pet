/**
 * GitHub Profile Pet - Action Inbox Processor
 * Coordinates durable queue draining, transition execution, state persistence,
 * SVG re-rendering, and user feedback comments on GitHub Issues.
 */

import {
  advanceHighWaterMark,
  recordProcessedIssue,
  recordRetiredGap,
} from '../accounting/deduplicationRegistry.ts';
import {
  acquireLock,
  getStatePaths,
  loadRepositoryState,
  recoverRepositoryState,
  saveRepositoryState,
  type CompleteRepositoryState,
  type LockReleaseFn,
} from '../persistence/stateRepository.ts';
import { isValidIsoDateString } from '../validation/stateValidator.ts';
import { publishPetSvg } from '../publication/index.ts';
import { CorruptedCheckpointError } from '../simulation/simulationCheckpoint.ts';
import { executeCareAction } from '../transitions/careTransitions.ts';
import { applyInactivitySimulation } from '../transitions/simulationTransitions.ts';
import type {
  ActionFeedbackRecord,
  CareActionType,
  PetStateDocument,
  TransitionOutcome,
} from '../domain/types.ts';
import {
  deliverFeedbackWithConfirmation,
  getActionFeedbackMarker,
  inspectFeedbackStatus,
  normalizeBotLogin,
} from './feedbackMarker.ts';
import { DefaultGitHubInboxClient } from './gitHubClient.ts';
import { scanPendingActions } from './inboxScanner.ts';
import type {
  ActionExecutionStatus,
  ActionParseResult,
  ActionProcessOutcome,
  GitHubInboxClient,
  InboxProcessingOptions,
  InboxProcessResult,
} from './types.ts';

/**
 * Formats a user-friendly, structured response comment for accepted care actions.
 */
function formatAcceptedComment(params: {
  petName: string;
  actionType: string;
  reaction: string;
  xpGained: number;
  didLevelUp: boolean;
  levelsGained: number;
  newLevel: number;
  evolutionStage: string;
  hunger: number;
  energy: number;
  happiness: number;
  mood: string;
}): string {
  const {
    petName,
    actionType,
    reaction,
    xpGained,
    didLevelUp,
    newLevel,
    evolutionStage,
    hunger,
    energy,
    happiness,
    mood,
  } = params;

  const lines = [
    `### 🐾 Action Accepted: \`${actionType.toUpperCase()}\``,
    '',
    `> *"${reaction}"*`,
    '',
    '| Metric | Value |',
    '| :--- | :--- |',
    `| **Companion** | **${petName}** |`,
    `| **XP Gained** | \`+${xpGained} XP\` |`,
    `| **Level** | **Level ${newLevel}** (${evolutionStage}) |`,
    `| **Satiety (Hunger)** | \`${hunger} / 100\` |`,
    `| **Energy** | \`${energy} / 100\` |`,
    `| **Happiness** | \`${happiness} / 100\` |`,
    `| **Current Mood** | **${mood}** |`,
  ];

  if (didLevelUp) {
    lines.push('', `🎉 **LEVEL UP!** ${petName} advanced to **Level ${newLevel}**!`);
  }

  lines.push('', '---', '_GitHub Profile Pet • Self-Hosted Companion_');
  return lines.join('\n');
}

/**
 * Formats an informative rejection comment.
 */
function formatRejectedComment(params: {
  actionType: string;
  reason: string;
  reaction: string;
}): string {
  const { actionType, reason, reaction } = params;
  return [
    `### ⚠️ Action Rejected: \`${actionType.toUpperCase()}\``,
    '',
    `> *"${reaction}"*`,
    '',
    `**Reason:** ${reason}`,
    '',
    '---',
    '_GitHub Profile Pet • Self-Hosted Companion_',
  ].join('\n');
}

/**
 * Drains and executes pending pet care actions from GitHub Issues.
 *
 * Operational Guarantees:
 * 1. Chronological Processing: Ordered by issue creation timestamp ascending (then issue number ascending).
 * 2. Idempotent Deduplication: Actions recorded in processedRequestRegistry are never re-executed.
 * 3. Non-Mutating Rejection: Rejected or invalid actions leave pet state 100% unaltered.
 * 4. Multi-Document Atomicity: Uses StateRepository journal to guarantee generation parity across documents.
 * 5. Bounded Feedback: Posts informative comments with deterministic bot markers and closes issues with explicit outcome labels.
 * 6. Queue Bound & Deadlines: Enforces batch issue limits and execution time budgets to avoid workflow timeouts and prevent starvation.
 */
export async function processInbox(
  options: InboxProcessingOptions = {}
): Promise<InboxProcessResult> {
  // Fail-closed validation: explicitly configured blank botLogin throws immediately
  if (options.botLogin !== undefined) {
    normalizeBotLogin(options.botLogin);
  }

  const baseDir = options.baseDir ?? process.cwd();
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY ?? 'owner/github-profile-pet';
  const client: GitHubInboxClient =
    options.client ?? new DefaultGitHubInboxClient(process.env.GITHUB_TOKEN || '');
  const timeBudgetMs = options.timeBudgetMs ?? 240_000;
  const maxIssuesPerBatch = options.maxIssuesPerBatch ?? 50;
  const startTime = Date.now();
  const deadlineMs = startTime + timeBudgetMs;
  const nowMs = options.nowMs ?? startTime;

  const paths = getStatePaths(baseDir);
  const ownsLock = !options.existingLock;
  const releaseLock = options.existingLock ?? (await acquireLock(paths.lockPath));

  try {
    // 1. Recover any interrupted transactions from previous runs
    await recoverRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId }).catch(() => {});

    // 2. Load latest authoritative repository state
    const state = await loadRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });

  // 3. Scan and order pending issues from GitHub
  const scan = await scanPendingActions({
    client,
    repository,
    registry: state.actions.processedRequestRegistry,
    maxPages: options.maxPages,
  });

  // Combine all scanned issues and sort in strict chronological order
  const allScannedActions: ActionParseResult[] = [
    ...scan.ineligibleIssues,
    ...scan.eligibleActions,
  ];

  allScannedActions.sort((a, b) => {
    const timeDiff = a.eventTimestampMs - b.eventTimestampMs;
    if (timeDiff !== 0) return timeDiff;
    return a.issueNumber - b.issueNumber;
  });

  const outcomes: ActionProcessOutcome[] = [];
  let acceptedCount = 0;
  let rejectedCount = 0;
  let duplicateCount = 0;
  let quarantinedCount = 0;
  let stateModified = false;
  let savedGeneration: number | undefined;
  let hasMorePending = scan.hasMorePending ?? false;

  async function handleActionFeedback(params: {
    issueNumber: number;
    actionType?: CareActionType;
    status: ActionExecutionStatus;
    commentBody: string;
    marker: string;
    targetLabel: string;
  }): Promise<void> {
    state.actions.pendingFeedback = state.actions.pendingFeedback ?? [];
    const record: ActionFeedbackRecord = {
      issueNumber: params.issueNumber,
      requestId: `issue-${params.issueNumber}`,
      actionType: params.actionType,
      status: params.status,
      generation: state.generation,
      completedAt: new Date(nowMs).toISOString(),
      feedbackDelivered: false,
      feedbackMarker: params.marker,
      feedbackBody: params.commentBody,
      targetLabel: params.targetLabel,
    };

    const existingIdx = state.actions.pendingFeedback.findIndex((p) => p.issueNumber === params.issueNumber);
    if (existingIdx >= 0) {
      state.actions.pendingFeedback[existingIdx] = record;
    } else {
      state.actions.pendingFeedback.push(record);
    }

    if (!options.deferFeedback) {
      const feedbackResult = await deliverFeedbackWithConfirmation({
        client,
        repository,
        issueNumber: params.issueNumber,
        commentBody: params.commentBody,
        expectedMarker: params.marker,
        botLogin: options.botLogin,
        maxPages: options.maxCommentPages,
        deadlineMs,
      });

      if (feedbackResult.delivered) {
        try {
          await client.closeIssue(repository, params.issueNumber, params.targetLabel);
          record.feedbackDelivered = true;
          record.closureConfirmed = true;
          record.deliveredAt = new Date(nowMs).toISOString();
        } catch {
          // If closure throws, do not mark complete
        }
      }
    }
  }

  async function persistCurrentState(): Promise<void> {
    const nextGen = state.generation + 1;
    state.pet.generation = nextGen;
    state.contributions.generation = nextGen;
    state.actions.generation = nextGen;

    await saveRepositoryState(
      baseDir,
      {
        pet: state.pet,
        contributions: state.contributions,
        actions: state.actions,
      },
      {
        expectedGeneration: state.generation,
        existingLock: releaseLock,
      }
    );
    state.generation = nextGen;
    savedGeneration = nextGen;
    stateModified = true;
  }

  // 4. Process all actions in chronological sequence with bounds
  for (let i = 0; i < allScannedActions.length; i++) {
    // Check execution deadline and batch size
    if (Date.now() >= deadlineMs || outcomes.length >= maxIssuesPerBatch) {
      hasMorePending = true;
      break;
    }

    const item = allScannedActions[i];

    // Case A: Duplicate / Already Processed
    if (item.status === 'already_processed') {
      duplicateCount++;
      outcomes.push({
        issueNumber: item.issueNumber,
        actionType: item.actionType,
        status: 'duplicate',
        message: item.rejectionReason ?? 'Action was already processed.',
        reactionText: 'Already completed.',
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
      });

      const marker = getActionFeedbackMarker(item.issueNumber);
      const commentBody = `ℹ️ This pet care action was already processed and committed in a previous transaction.\n\n${marker}`;

      await handleActionFeedback({
        issueNumber: item.issueNumber,
        actionType: item.actionType,
        status: 'duplicate',
        commentBody,
        marker,
        targetLabel: 'pet-action:completed',
      });
      continue;
    }

    // Case B: Pull Request Rejected
    if (item.status === 'pull_request_rejected') {
      rejectedCount++;
      state.actions.processedRequestRegistry = recordRetiredGap(
        state.actions.processedRequestRegistry,
        item.issueNumber
      );
      state.actions.processedRequestRegistry = advanceHighWaterMark(
        state.actions.processedRequestRegistry
      );

      outcomes.push({
        issueNumber: item.issueNumber,
        status: 'rejected',
        message: item.rejectionReason ?? 'Pull Requests cannot be pet care actions.',
        reactionText: 'Invalid resource.',
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
      });

      const marker = getActionFeedbackMarker(item.issueNumber);
      const commentBody = `❌ Pull requests cannot be processed as pet care actions.\n\n${marker}`;

      await handleActionFeedback({
        issueNumber: item.issueNumber,
        status: 'rejected',
        commentBody,
        marker,
        targetLabel: 'pet-action:invalid',
      });
      await persistCurrentState();
      continue;
    }

    // Case C: Edited / Quarantined
    if (item.status === 'edited_quarantined') {
      quarantinedCount++;
      state.actions.processedRequestRegistry = recordRetiredGap(
        state.actions.processedRequestRegistry,
        item.issueNumber
      );
      state.actions.processedRequestRegistry = advanceHighWaterMark(
        state.actions.processedRequestRegistry
      );

      outcomes.push({
        issueNumber: item.issueNumber,
        actionType: item.actionType,
        status: 'quarantined',
        message: item.rejectionReason ?? 'Action quarantined due to post-creation edit.',
        reactionText: 'Payload integrity check failed.',
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
      });

      const marker = getActionFeedbackMarker(item.issueNumber);
      const commentBody = `⚠️ **Action Quarantined:** This issue was edited after its initial submission. To guarantee game state integrity and prevent payload tampering, edited actions are not processed.\n\n${marker}`;

      await handleActionFeedback({
        issueNumber: item.issueNumber,
        actionType: item.actionType,
        status: 'quarantined',
        commentBody,
        marker,
        targetLabel: 'pet-action:quarantine',
      });
      await persistCurrentState();
      continue;
    }

    // Case D: Other Ineligible (malformed, unknown action type)
    if (!item.eligible) {
      rejectedCount++;
      state.actions.processedRequestRegistry = recordRetiredGap(
        state.actions.processedRequestRegistry,
        item.issueNumber
      );
      state.actions.processedRequestRegistry = advanceHighWaterMark(
        state.actions.processedRequestRegistry
      );

      outcomes.push({
        issueNumber: item.issueNumber,
        actionType: item.actionType,
        status: 'rejected',
        message: item.rejectionReason ?? 'Malformed or unknown action payload.',
        reactionText: 'Invalid submission.',
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
      });

      const marker = getActionFeedbackMarker(item.issueNumber);
      const commentBody = `❌ ${item.rejectionReason ?? 'Invalid pet action submission.'}\n\n${marker}`;

      await handleActionFeedback({
        issueNumber: item.issueNumber,
        actionType: item.actionType,
        status: 'rejected',
        commentBody,
        marker,
        targetLabel: item.targetLabel ?? 'pet-action:invalid',
      });
      await persistCurrentState();
      continue;
    }

    // Case E: Eligible Action - Author Authorization Check
    const issueNum = item.issueNumber;
    const actionType = item.actionType!;

    if (
      !options.allowAnyAuthor &&
      options.trustedAuthorId !== undefined &&
      item.authorId !== options.trustedAuthorId
    ) {
      rejectedCount++;
      state.actions.processedRequestRegistry = recordProcessedIssue(
        state.actions.processedRequestRegistry,
        issueNum
      );
      state.actions.processedRequestRegistry = advanceHighWaterMark(
        state.actions.processedRequestRegistry
      );

      const rejMessage = `Unauthorized actor (@${item.authorLogin}, id: ${item.authorId}). Only the designated repository trainer can submit care actions.`;
      const rejOutcome: ActionProcessOutcome = {
        issueNumber: issueNum,
        actionType,
        status: 'rejected',
        message: rejMessage,
        reactionText: 'Strangers cannot command your companion!',
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
      };
      outcomes.push(rejOutcome);

      const marker = getActionFeedbackMarker(issueNum);
      const commentBody = `${formatRejectedComment({
        actionType,
        reason: rejOutcome.message,
        reaction: rejOutcome.reactionText,
      })}\n\n${marker}`;

      await handleActionFeedback({
        issueNumber: issueNum,
        actionType,
        status: 'rejected',
        commentBody,
        marker,
        targetLabel: 'pet-action:unauthorized',
      });
      await persistCurrentState();
      continue;
    }

    // Case F: Eligible Action - Execute Care Transition
    // Step 5 & 6: Calculate elapsed time from durable checkpoint and apply passive simulation transitions
    let simulatedPet = state.pet;
    try {
      const simResult = applyInactivitySimulation(state.pet, item.eventTimestampMs);
      simulatedPet = simResult.nextPetState;
    } catch (simErr) {
      if (simErr instanceof CorruptedCheckpointError) {
        console.error(`[actionProcessor] ${simErr.message}`);
        throw simErr;
      }
      throw simErr;
    }

    // Step 7: Apply requested care action to simulated state
    const transition = executeCareAction({
      pet: simulatedPet,
      action: actionType,
      history: state.actions.recentActions,
      nowMs: item.eventTimestampMs,
      requestId: `issue-${issueNum}`,
    });

    if (transition.outcome.success) {
      acceptedCount++;
      state.pet = transition.nextPetState;
      state.actions.recentActions = transition.nextRecentActions;
      state.actions.processedRequestRegistry = recordProcessedIssue(
        state.actions.processedRequestRegistry,
        issueNum
      );
      state.actions.processedRequestRegistry = advanceHighWaterMark(
        state.actions.processedRequestRegistry
      );

      const accOutcome: ActionProcessOutcome = {
        issueNumber: issueNum,
        actionType,
        status: 'accepted',
        message: 'Action completed successfully.',
        reactionText: transition.outcome.reaction,
        xpGained: transition.outcome.xpGained,
        didLevelUp: transition.outcome.didLevelUp,
        levelsGained: transition.outcome.levelsGained,
        newLevel: transition.nextPetState.level,
        newVitals: {
          hunger: transition.nextPetState.hunger,
          energy: transition.nextPetState.energy,
          happiness: transition.nextPetState.happiness,
          mood: transition.nextPetState.mood,
        },
      };
      outcomes.push(accOutcome);

      const marker = getActionFeedbackMarker(issueNum);
      const commentBody = `${formatAcceptedComment({
        petName: state.pet.name,
        actionType,
        reaction: transition.outcome.reaction,
        xpGained: transition.outcome.xpGained,
        didLevelUp: transition.outcome.didLevelUp,
        levelsGained: transition.outcome.levelsGained,
        newLevel: transition.nextPetState.level,
        evolutionStage: transition.nextPetState.evolutionStage,
        hunger: transition.nextPetState.hunger,
        energy: transition.nextPetState.energy,
        happiness: transition.nextPetState.happiness,
        mood: transition.nextPetState.mood,
      })}\n\n${marker}`;

      await handleActionFeedback({
        issueNumber: issueNum,
        actionType,
        status: 'accepted',
        commentBody,
        marker,
        targetLabel: 'pet-action:completed',
      });
      await persistCurrentState();
    } else {
      // Rejection: Cooldown, Full Hunger, Low Energy, Stale
      rejectedCount++;
      state.actions.processedRequestRegistry = recordProcessedIssue(
        state.actions.processedRequestRegistry,
        issueNum
      );
      state.actions.processedRequestRegistry = advanceHighWaterMark(
        state.actions.processedRequestRegistry
      );

      const rejOutcome: ActionProcessOutcome = {
        issueNumber: issueNum,
        actionType,
        status: 'rejected',
        message: transition.outcome.rejectedReason ?? 'Action rejected by gameplay rules.',
        reactionText: transition.outcome.reaction,
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
      };
      outcomes.push(rejOutcome);

      const marker = getActionFeedbackMarker(issueNum);
      const commentBody = `${formatRejectedComment({
        actionType,
        reason: rejOutcome.message,
        reaction: transition.outcome.reaction,
      })}\n\n${marker}`;

      await handleActionFeedback({
        issueNumber: issueNum,
        actionType,
        status: 'rejected',
        commentBody,
        marker,
        targetLabel: 'pet-action:rejected',
      });
      await persistCurrentState();
    }
  }

  // 5. Re-render and publish latest SVG if state was modified
  if (stateModified) {
    await publishPetSvg({ baseDir }).catch(() => {});
  }

  return {
    scannedCount: allScannedActions.length,
    processedCount: outcomes.length,
    acceptedCount,
    rejectedCount,
    duplicateCount,
    quarantinedCount,
    newHighWaterMark: state.actions.processedRequestRegistry.highWaterIssueNumber,
    queueDrained: !hasMorePending,
    hasMorePending,
    outcomes,
    savedGeneration,
  };
  } finally {
    if (ownsLock) {
      await releaseLock().catch(() => {});
    }
  }
}

export const FEEDBACK_RETENTION_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export interface CompactFeedbackOptions {
  nowMs?: number;
  retentionPeriodMs?: number;
}

export interface CompactFeedbackResult {
  prunedCount: number;
  retainedCount: number;
  records: ActionFeedbackRecord[];
}

const VALID_PRUNING_STATUSES = new Set(['accepted', 'rejected', 'quarantined', 'duplicate']);

/**
 * Checks whether an ActionFeedbackRecord is eligible for safe pruning.
 *
 * Strict Pruning Invariant (R2-A):
 * A record is eligible if and only if ALL conditions hold:
 * 1. feedbackDelivered === true
 * 2. closureConfirmed === true
 * 3. status is present and is a valid terminal status ('accepted' | 'rejected' | 'quarantined' | 'duplicate')
 * 4. deliveredAt exists, is a string, and is a valid ISO date-time string (NO fallback to completedAt)
 * 5. Date.parse(deliveredAt) produces a valid numeric timestamp
 * 6. nowMs - deliveredAtMs >= retentionPeriodMs (boundary rule: >= 7 days, inclusive at 7-day boundary)
 *
 * Fails closed: All other records (pending, deferred, missing closure confirmation, missing deliveredAt,
 * invalid deliveredAt, corrupt) return false and are NEVER pruned.
 */
export function isFeedbackRecordEligibleForPruning(
  record: ActionFeedbackRecord,
  nowMs: number,
  retentionPeriodMs: number = FEEDBACK_RETENTION_PERIOD_MS
): boolean {
  if (typeof record !== 'object' || record === null) {
    return false;
  }

  // 1. Must be durably marked as delivered
  if (record.feedbackDelivered !== true) {
    return false;
  }

  // 2. Closure must be confirmed
  if (record.closureConfirmed !== true) {
    return false;
  }

  // 3. Must have a valid terminal status (not deferred, missing, or unknown)
  if (
    !record.status ||
    typeof record.status !== 'string' ||
    record.status === 'deferred' ||
    !VALID_PRUNING_STATUSES.has(record.status)
  ) {
    return false;
  }

  // 4. Must have a valid delivery timestamp (deliveredAt is strictly required; NO fallback to completedAt)
  if (
    !record.deliveredAt ||
    typeof record.deliveredAt !== 'string' ||
    !isValidIsoDateString(record.deliveredAt)
  ) {
    return false;
  }

  const deliveredAtMs = Date.parse(record.deliveredAt);
  if (Number.isNaN(deliveredAtMs)) {
    return false;
  }

  // 5. Explicit retention boundary check: nowMs - deliveredAtMs >= retentionPeriodMs
  const ageMs = nowMs - deliveredAtMs;
  return ageMs >= retentionPeriodMs;
}

/**
 * Deterministically compacts pendingFeedback records according to the 7-day retention policy.
 * Preserves all unresolved, unconfirmed, deferred, or unconfirmed-closure records.
 * Permanent deduplication in processedRequestRegistry is completely unaffected.
 */
export function compactPendingFeedback(
  records: ActionFeedbackRecord[] | undefined,
  options: CompactFeedbackOptions = {}
): CompactFeedbackResult {
  if (!records || !Array.isArray(records)) {
    return { prunedCount: 0, retainedCount: 0, records: [] };
  }

  const nowMs = options.nowMs ?? Date.now();
  const retentionPeriodMs = options.retentionPeriodMs ?? FEEDBACK_RETENTION_PERIOD_MS;

  const retained: ActionFeedbackRecord[] = [];
  let prunedCount = 0;

  for (const record of records) {
    if (isFeedbackRecordEligibleForPruning(record, nowMs, retentionPeriodMs)) {
      prunedCount++;
    } else {
      retained.push(record);
    }
  }

  return {
    prunedCount,
    retainedCount: retained.length,
    records: retained,
  };
}

export interface DeliverPendingFeedbackOptions {
  baseDir?: string;
  repository?: string;
  client?: GitHubInboxClient;
  botLogin?: string;
  maxCommentPages?: number;
  deadlineMs?: number;
  records?: ActionFeedbackRecord[];
  nowMs?: number;
  persist?: boolean;
  autoCompact?: boolean;
  retentionPeriodMs?: number;
}

export interface DeliverPendingFeedbackResult {
  deliveredCount: number;
  failedCount: number;
  prunedCount: number;
  stateModified: boolean;
  results: Array<{ issueNumber: number; delivered: boolean; error?: string }>;
}

/**
 * Recovers and delivers pending feedback comments and issue closures for durably committed actions.
 * Guarantees idempotency via deterministic bot marker inspection.
 * Durably persists completion status and runs bounded compaction.
 */
export async function deliverPendingFeedback(
  options: DeliverPendingFeedbackOptions = {}
): Promise<DeliverPendingFeedbackResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY ?? 'owner/github-profile-pet';
  const client: GitHubInboxClient =
    options.client ?? new DefaultGitHubInboxClient(process.env.GITHUB_TOKEN || '');
  const nowMs = options.nowMs ?? Date.now();
  const paths = getStatePaths(baseDir);

  let targetRecords: ActionFeedbackRecord[] = [];
  let releaseLock: LockReleaseFn | undefined;
  let loadedState: CompleteRepositoryState | undefined;
  let stateModified = false;

  if (options.records) {
    targetRecords = options.records.filter((r) => !r.feedbackDelivered || !r.closureConfirmed);
  } else {
    try {
      releaseLock = await acquireLock(paths.lockPath);
      await recoverRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId }).catch(() => {});
      loadedState = await loadRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });
      targetRecords = (loadedState.actions.pendingFeedback ?? []).filter(
        (r) => !r.feedbackDelivered || !r.closureConfirmed
      );
    } catch {
      if (releaseLock) await releaseLock().catch(() => {});
      return { deliveredCount: 0, failedCount: 0, prunedCount: 0, stateModified: false, results: [] };
    }
  }

  let deliveredCount = 0;
  let failedCount = 0;
  let prunedCount = 0;
  const results: Array<{ issueNumber: number; delivered: boolean; error?: string }> = [];

  try {
    for (const record of targetRecords) {
      try {
        // Step 1: Inspect existing comments with exact bot login and deterministic marker
        const inspection = await inspectFeedbackStatus({
          client,
          repository,
          issueNumber: record.issueNumber,
          expectedMarker: record.feedbackMarker,
          expectedBotLogin: options.botLogin,
          maxPages: options.maxCommentPages,
          deadlineMs: options.deadlineMs,
        });

        // Fail-closed on incomplete or ambiguous scans
        if (inspection.status === 'incomplete_unknown') {
          failedCount++;
          results.push({
            issueNumber: record.issueNumber,
            delivered: false,
            error: inspection.reason ?? 'Comment inspection was incomplete or ambiguous',
          });
          continue;
        }

        // Step 2: Deliver comment if absent across entire history
        if (inspection.status !== 'confirmed') {
          const delivery = await deliverFeedbackWithConfirmation({
            client,
            repository,
            issueNumber: record.issueNumber,
            commentBody: record.feedbackBody,
            expectedMarker: record.feedbackMarker,
            botLogin: options.botLogin,
            maxPages: options.maxCommentPages,
            deadlineMs: options.deadlineMs,
          });

          if (!delivery.delivered) {
            failedCount++;
            results.push({
              issueNumber: record.issueNumber,
              delivered: false,
              error: delivery.reason ?? 'Failed to deliver feedback comment',
            });
            continue;
          }
        }

        // Step 3: Issue closure and labeling
        try {
          await client.closeIssue(repository, record.issueNumber, record.targetLabel);
        } catch (closeErr) {
          failedCount++;
          results.push({
            issueNumber: record.issueNumber,
            delivered: false,
            error: `Issue closure failed: ${(closeErr as Error).message}`,
          });
          continue;
        }

        // Step 4: Durable delivery completion confirmation
        // Only mark complete when BOTH comment confirmed AND issue closure confirmed
        record.feedbackDelivered = true;
        record.closureConfirmed = true;
        record.deliveredAt = new Date(nowMs).toISOString();
        deliveredCount++;
        stateModified = true;
        results.push({ issueNumber: record.issueNumber, delivered: true });
      } catch (err: unknown) {
        failedCount++;
        results.push({
          issueNumber: record.issueNumber,
          delivered: false,
          error: (err as Error).message,
        });
      }
    }

    // Step 5: Bounded retention compaction (F-B0-02)
    if (options.autoCompact !== false) {
      const recordsToCompact = loadedState
        ? (loadedState.actions.pendingFeedback ?? [])
        : (options.records ?? []);

      if (recordsToCompact.length > 0) {
        const compactRes = compactPendingFeedback(recordsToCompact, {
          nowMs,
          retentionPeriodMs: options.retentionPeriodMs,
        });

        if (compactRes.prunedCount > 0) {
          prunedCount = compactRes.prunedCount;
          stateModified = true;
          if (loadedState) {
            loadedState.actions.pendingFeedback = compactRes.records;
          } else if (options.records) {
            options.records.length = 0;
            options.records.push(...compactRes.records);
          }
        }
      }
    }

    // Step 6: Safe state persistence under lock
    if (stateModified && options.persist !== false) {
      if (!loadedState) {
        try {
          releaseLock = await acquireLock(paths.lockPath);
          await recoverRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });
          loadedState = await loadRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });
          if (options.records) {
            loadedState.actions.pendingFeedback = options.records;
          }
        } catch {
          // If acquiring lock or loading state fails, return current results
        }
      }

      if (loadedState) {
        await saveRepositoryState(
          baseDir,
          {
            pet: loadedState.pet,
            contributions: loadedState.contributions,
            actions: loadedState.actions,
          },
          {
            existingLock: releaseLock,
            expectedGeneration: loadedState.generation,
          }
        );
      }
    }
  } finally {
    if (releaseLock) {
      await releaseLock().catch(() => {});
    }
  }

  return { deliveredCount, failedCount, prunedCount, stateModified, results };
}

export interface CareActionTransactionOptions {
  baseDir?: string;
  action: CareActionType;
  nowMs?: number;
  requestId?: string;
  forcePublish?: boolean;
}

export interface CareActionTransactionResult {
  success: boolean;
  petState: PetStateDocument;
  simulatedSeconds: number;
  transitionOutcome: TransitionOutcome;
  savedGeneration?: number;
  rejectionReason?: string;
}

/**
 * Authoritative single-action transaction processor enforcing strict ordering:
 * 1. Acquire existing repository lock.
 * 2. Recover interrupted journal transactions.
 * 3. Load and validate authoritative state.
 * 4. Capture one UTC timestamp for the operation.
 * 5. Calculate elapsed time from durable checkpoint.
 * 6. Apply existing passive simulation transitions.
 * 7. Apply requested care action to simulated state.
 * 8. Persist resulting pet state, ledgers, and checkpoint through atomic transaction.
 * 9. Release the lock.
 */
export async function executeCareActionTransaction(
  options: CareActionTransactionOptions
): Promise<CareActionTransactionResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const paths = getStatePaths(baseDir);

  // 1. Acquire existing repository lock
  const releaseLock = await acquireLock(paths.lockPath);

  try {
    // 2. Recover interrupted journal transactions
    await recoverRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });

    // 3. Load and validate authoritative state
    const state = await loadRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });

    // 4. Capture one UTC timestamp for the operation
    const nowMs = options.nowMs ?? Date.now();
    const requestId = options.requestId ?? `care-action-${nowMs}`;

    // 5. Calculate elapsed time from durable checkpoint & 6. Apply passive simulation transitions
    const simResult = applyInactivitySimulation(state.pet, nowMs);

    // 7. Apply requested care action to simulated state
    const transition = executeCareAction({
      pet: simResult.nextPetState,
      action: options.action,
      history: state.actions.recentActions,
      nowMs,
      requestId,
    });

    if (!transition.outcome.success) {
      // Rejection: do NOT mutate pet state or advance checkpoint independently
      return {
        success: false,
        petState: state.pet,
        simulatedSeconds: 0,
        transitionOutcome: transition.outcome,
        rejectionReason: transition.outcome.rejectedReason,
      };
    }

    // 8. Persist resulting pet state, ledgers, and checkpoint through existing atomic transaction
    const nextGen = state.generation + 1;
    const persistentPet: PetStateDocument = {
      ...transition.nextPetState,
      generation: nextGen,
    };
    state.contributions.generation = nextGen;
    state.actions.generation = nextGen;
    state.actions.recentActions = transition.nextRecentActions;

    await saveRepositoryState(
      baseDir,
      {
        pet: persistentPet,
        contributions: state.contributions,
        actions: state.actions,
      },
      {
        expectedGeneration: state.generation,
        existingLock: releaseLock,
      }
    );

    // Re-publish SVG
    await publishPetSvg({ baseDir }).catch(() => {});

    return {
      success: true,
      petState: persistentPet,
      simulatedSeconds: simResult.elapsedSeconds,
      transitionOutcome: transition.outcome,
      savedGeneration: nextGen,
    };
  } finally {
    // 9. Release the lock
    await releaseLock();
  }
}
