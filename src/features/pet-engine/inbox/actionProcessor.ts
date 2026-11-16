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
} from '../persistence/stateRepository.ts';
import { publishPetSvg } from '../publication/index.ts';
import { CorruptedCheckpointError } from '../simulation/simulationCheckpoint.ts';
import { executeCareAction } from '../transitions/careTransitions.ts';
import { applyInactivitySimulation } from '../transitions/simulationTransitions.ts';
import type { CareActionType, PetStateDocument, TransitionOutcome } from '../domain/types.ts';
import {
  deliverFeedbackWithConfirmation,
  getActionFeedbackMarker,
  normalizeBotLogin,
} from './feedbackMarker.ts';
import { DefaultGitHubInboxClient } from './gitHubClient.ts';
import { scanPendingActions } from './inboxScanner.ts';
import type {
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

      // Feedback recovery: only comment if matching bot feedback has not yet been delivered
      const marker = getActionFeedbackMarker(item.issueNumber);
      const commentBody = `ℹ️ This pet care action was already processed and committed in a previous transaction.\n\n${marker}`;

      const feedbackResult = await deliverFeedbackWithConfirmation({
        client,
        repository,
        issueNumber: item.issueNumber,
        commentBody,
        expectedMarker: marker,
        botLogin: options.botLogin,
        maxPages: options.maxCommentPages,
        deadlineMs,
      });

      if (feedbackResult.delivered) {
        await client
          .closeIssue(repository, item.issueNumber, 'pet-action:completed')
          .catch(() => {});
      }
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
      await persistCurrentState();

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

      const feedbackResult = await deliverFeedbackWithConfirmation({
        client,
        repository,
        issueNumber: item.issueNumber,
        commentBody,
        expectedMarker: marker,
        botLogin: options.botLogin,
        maxPages: options.maxCommentPages,
        deadlineMs,
      });

      if (feedbackResult.delivered) {
        await client
          .closeIssue(repository, item.issueNumber, 'pet-action:invalid')
          .catch(() => {});
      }
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
      await persistCurrentState();

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

      const feedbackResult = await deliverFeedbackWithConfirmation({
        client,
        repository,
        issueNumber: item.issueNumber,
        commentBody,
        expectedMarker: marker,
        botLogin: options.botLogin,
        maxPages: options.maxCommentPages,
        deadlineMs,
      });

      if (feedbackResult.delivered) {
        await client
          .closeIssue(repository, item.issueNumber, 'pet-action:quarantine')
          .catch(() => {});
      }
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
      await persistCurrentState();

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

      const feedbackResult = await deliverFeedbackWithConfirmation({
        client,
        repository,
        issueNumber: item.issueNumber,
        commentBody,
        expectedMarker: marker,
        botLogin: options.botLogin,
        maxPages: options.maxCommentPages,
        deadlineMs,
      });

      if (feedbackResult.delivered) {
        await client
          .closeIssue(repository, item.issueNumber, item.targetLabel ?? 'pet-action:invalid')
          .catch(() => {});
      }
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
      await persistCurrentState();

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

      const feedbackResult = await deliverFeedbackWithConfirmation({
        client,
        repository,
        issueNumber: issueNum,
        commentBody,
        expectedMarker: marker,
        botLogin: options.botLogin,
        maxPages: options.maxCommentPages,
        deadlineMs,
      });

      if (feedbackResult.delivered) {
        await client
          .closeIssue(repository, issueNum, 'pet-action:unauthorized')
          .catch(() => {});
      }
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
      await persistCurrentState();

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

      const feedbackResult = await deliverFeedbackWithConfirmation({
        client,
        repository,
        issueNumber: issueNum,
        commentBody,
        expectedMarker: marker,
        botLogin: options.botLogin,
        maxPages: options.maxCommentPages,
        deadlineMs,
      });

      if (feedbackResult.delivered) {
        await client
          .closeIssue(repository, issueNum, 'pet-action:completed')
          .catch(() => {});
      }
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
      await persistCurrentState();

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

      const feedbackResult = await deliverFeedbackWithConfirmation({
        client,
        repository,
        issueNumber: issueNum,
        commentBody,
        expectedMarker: marker,
        botLogin: options.botLogin,
        maxPages: options.maxCommentPages,
        deadlineMs,
      });

      if (feedbackResult.delivered) {
        await client
          .closeIssue(repository, issueNum, 'pet-action:rejected')
          .catch(() => {});
      }
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
