/**
 * GitHub Profile Pet — Complete-State Pristine Installation Validator (R3.22-01)
 *
 * Implements strict, multi-document validation to verify that a repository
 * contains a genuinely fresh, unplayed installation before establishing baseline
 * or reinitializing a foreign fork.
 *
 * Evaluates the complete state model across all authoritative documents:
 * 1. pet/state/pet.json: generation === 1, level === 1, xp === 0, stage === 'Hatchling', maxExp === 100, no bonus claimed.
 * 2. pet/ledger/actions.json: generation === 1, recentActions empty, highWaterIssueNumber === 0, sparse/retired/unresolved empty, pendingFeedback empty.
 * 3. pet/ledger/contributions.json: generation === 1, accounting maps empty (dailyAccruedXp, dailyHwm, dailyRewardOrdinal, hourlyIncrementUsage, hourlySliceUsage), slices empty, monthlyHistoricalSummary empty, monotonicPublicHwm === 0.
 * 4. Multi-Document Invariant: generation consistency across all documents (pet.generation === contributions.generation === actions.generation === 1).
 * 5. Journal & Lock Hygiene: no active or pending transaction journal (.journal) and no active lock (.lock).
 * 6. Fails closed on any malformed, missing, unreadable, or corrupt state.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ActionLedgerDocument,
  ContributionLedgerDocument,
  PetStateDocument,
} from '../domain/types.ts';
import { validatePetState } from './stateValidator.ts';
import { validateActionLedger, validateContributionLedger } from './ledgerValidator.ts';

export interface PristineValidationOptions {
  allowForeignBaseline?: boolean;
  expectedOwnerDatabaseId?: number;
  expectedOwnerLogin?: string;
  allowActiveLock?: boolean;
  allowActiveJournal?: boolean;
}

export interface PristineValidationResult {
  valid: boolean;
  errors: string[];
  state?: {
    pet: PetStateDocument;
    contributions: ContributionLedgerDocument;
    actions: ActionLedgerDocument;
  };
}

export async function validatePristineInstallation(
  baseDir: string,
  options: PristineValidationOptions = {}
): Promise<PristineValidationResult> {
  const errors: string[] = [];

  const petPath = path.join(baseDir, 'pet', 'state', 'pet.json');
  const contribPath = path.join(baseDir, 'pet', 'ledger', 'contributions.json');
  const actionsPath = path.join(baseDir, 'pet', 'ledger', 'actions.json');
  const journalDir = path.join(baseDir, 'pet', '.journal');
  const lockPath = path.join(baseDir, 'pet', '.lock');

  // 1. Transaction Journal & Concurrency Lock Hygiene Check
  if (!options.allowActiveJournal) {
    try {
      const journalEntries = await fs.readdir(journalDir).catch(() => []);
      if (journalEntries.length > 0) {
        errors.push(
          `Active or uncommitted transaction journal detected in ${journalDir} (${journalEntries.length} entries). Pristine installation cannot have pending transactions.`
        );
      }
    } catch {
      // If readdir fails for reasons other than ENOENT, fail closed
      errors.push(`Failed to inspect transaction journal directory at ${journalDir}.`);
    }
  }

  if (!options.allowActiveLock) {
    try {
      const lockExists = await fs.access(lockPath).then(() => true).catch(() => false);
      if (lockExists) {
        errors.push(`Active lock file detected at ${lockPath}. Pristine installation cannot have active concurrency locks.`);
      }
    } catch {
      // access check handled by then/catch
    }
  }

  // 2. Read and Parse State Documents
  let rawPet: string;
  let rawContrib: string;
  let rawActions: string;

  try {
    rawPet = await fs.readFile(petPath, 'utf-8');
  } catch (err: unknown) {
    return {
      valid: false,
      errors: [`Failed to read pet state document at ${petPath}: ${(err as Error).message}`],
    };
  }

  try {
    rawContrib = await fs.readFile(contribPath, 'utf-8');
  } catch (err: unknown) {
    return {
      valid: false,
      errors: [`Failed to read contribution ledger at ${contribPath}: ${(err as Error).message}`],
    };
  }

  try {
    rawActions = await fs.readFile(actionsPath, 'utf-8');
  } catch (err: unknown) {
    return {
      valid: false,
      errors: [`Failed to read action ledger at ${actionsPath}: ${(err as Error).message}`],
    };
  }

  let petDoc: PetStateDocument;
  let contribDoc: ContributionLedgerDocument;
  let actionsDoc: ActionLedgerDocument;

  try {
    petDoc = JSON.parse(rawPet);
  } catch (err: unknown) {
    errors.push(`Pet state document at ${petPath} is not valid JSON: ${(err as Error).message}`);
    return { valid: false, errors };
  }

  try {
    contribDoc = JSON.parse(rawContrib);
  } catch (err: unknown) {
    errors.push(`Contribution ledger at ${contribPath} is not valid JSON: ${(err as Error).message}`);
    return { valid: false, errors };
  }

  try {
    actionsDoc = JSON.parse(rawActions);
  } catch (err: unknown) {
    errors.push(`Action ledger at ${actionsPath} is not valid JSON: ${(err as Error).message}`);
    return { valid: false, errors };
  }

  // 3. Schema & Type Validation
  const petValidation = validatePetState(petDoc);
  if (!petValidation.valid) {
    errors.push(...petValidation.errors.map((e) => `pet.json: ${e}`));
  }

  const contribValidation = validateContributionLedger(contribDoc);
  if (!contribValidation.valid) {
    errors.push(...contribValidation.errors.map((e) => `contributions.json: ${e}`));
  }

  const actionValidation = validateActionLedger(actionsDoc);
  if (!actionValidation.valid) {
    errors.push(...actionValidation.errors.map((e) => `actions.json: ${e}`));
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 4. Generation Consistency & Initial Generation Check
  const petGen = petDoc.generation;
  const contribGen = contribDoc.generation;
  const actionsGen = actionsDoc.generation;

  if (petGen !== contribGen || contribGen !== actionsGen) {
    errors.push(
      `Generation mismatch across state documents (pet: ${petGen}, contributions: ${contribGen}, actions: ${actionsGen}). State documents must be generation-synchronized.`
    );
  }

  if (petGen !== 1 || contribGen !== 1 || actionsGen !== 1) {
    errors.push(
      `Non-initial generation detected (pet: ${petGen}, contributions: ${contribGen}, actions: ${actionsGen}). A pristine installation must start at generation 1; higher generations represent prior evolutionary lineage.`
    );
  }

  // 5. Complete Pet State Pristine Invariants
  if (petDoc.xp !== 0) {
    errors.push(`Nonzero XP detected in pet state (xp: ${petDoc.xp}). A pristine installation must have 0 XP.`);
  }

  if (petDoc.level !== 1) {
    errors.push(`Non-initial level detected in pet state (level: ${petDoc.level}). A pristine installation must be level 1.`);
  }

  if (petDoc.evolutionStage !== 'Hatchling') {
    errors.push(
      `Advanced evolutionStage detected in pet state ("${petDoc.evolutionStage}"). A pristine installation must be "Hatchling".`
    );
  }

  if (petDoc.lastWelcomeBonusClaimedAt !== null && petDoc.lastWelcomeBonusClaimedAt !== undefined) {
    errors.push(`lastWelcomeBonusClaimedAt is already set ("${String(petDoc.lastWelcomeBonusClaimedAt)}").`);
  }

  if (petDoc.maxExp !== 100) {
    errors.push(`Non-standard maxExp detected (maxExp: ${petDoc.maxExp}). Pristine maxExp must be 100.`);
  }

  // 6. Complete Action Ledger Pristine Invariants
  if (!Array.isArray(actionsDoc.recentActions) || actionsDoc.recentActions.length > 0) {
    errors.push(`Active care action history detected in actions ledger (${actionsDoc.recentActions?.length ?? 0} entries).`);
  }

  const pReg = actionsDoc.processedRequestRegistry;
  if (!pReg) {
    errors.push(`processedRequestRegistry is missing in actions ledger.`);
  } else {
    if (typeof pReg.highWaterIssueNumber !== 'number' || pReg.highWaterIssueNumber !== 0) {
      errors.push(`Nonzero highWaterIssueNumber detected in actions ledger (${pReg.highWaterIssueNumber}).`);
    }
    if (!Array.isArray(pReg.sparseProcessedIssueNumbers) || pReg.sparseProcessedIssueNumbers.length > 0) {
      errors.push(`sparseProcessedIssueNumbers is not empty (${pReg.sparseProcessedIssueNumbers?.length ?? 0} entries).`);
    }
    if (!Array.isArray(pReg.retiredNonActionGaps) || pReg.retiredNonActionGaps.length > 0) {
      errors.push(`retiredNonActionGaps is not empty (${pReg.retiredNonActionGaps?.length ?? 0} entries).`);
    }
    if (!Array.isArray(pReg.unresolvedGaps) || pReg.unresolvedGaps.length > 0) {
      errors.push(`unresolvedGaps is not empty (${pReg.unresolvedGaps?.length ?? 0} entries).`);
    }
  }

  if (Array.isArray(actionsDoc.pendingFeedback) && actionsDoc.pendingFeedback.length > 0) {
    errors.push(`pendingFeedback is not empty in actions ledger (${actionsDoc.pendingFeedback.length} entries).`);
  }

  // 7. Complete Contribution Ledger Pristine Invariants
  if (!Array.isArray(contribDoc.slices) || contribDoc.slices.length > 0) {
    errors.push(`Contribution slices array is not empty (${contribDoc.slices?.length ?? 0} entries).`);
  }

  if (!Array.isArray(contribDoc.monthlyHistoricalSummary) || contribDoc.monthlyHistoricalSummary.length > 0) {
    errors.push(`monthlyHistoricalSummary is not empty (${contribDoc.monthlyHistoricalSummary?.length ?? 0} entries).`);
  }

  if (contribDoc.dailyAccruedXp && Object.keys(contribDoc.dailyAccruedXp).length > 0) {
    errors.push(`dailyAccruedXp contains recorded daily XP (${Object.keys(contribDoc.dailyAccruedXp).join(', ')}).`);
  }

  if (contribDoc.dailyHwm && Object.keys(contribDoc.dailyHwm).length > 0) {
    errors.push(`dailyHwm contains recorded daily high-water marks (${Object.keys(contribDoc.dailyHwm).join(', ')}).`);
  }

  if (contribDoc.dailyRewardOrdinal && Object.keys(contribDoc.dailyRewardOrdinal).length > 0) {
    errors.push(`dailyRewardOrdinal contains recorded daily ordinals (${Object.keys(contribDoc.dailyRewardOrdinal).join(', ')}).`);
  }

  if (contribDoc.hourlyIncrementUsage && Object.keys(contribDoc.hourlyIncrementUsage).length > 0) {
    errors.push(`hourlyIncrementUsage contains recorded usage.`);
  }

  if (contribDoc.hourlySliceUsage && Object.keys(contribDoc.hourlySliceUsage).length > 0) {
    errors.push(`hourlySliceUsage contains recorded usage.`);
  }

  if (contribDoc.monotonicPublicHwm !== undefined && contribDoc.monotonicPublicHwm !== 0) {
    errors.push(`monotonicPublicHwm is nonzero (${contribDoc.monotonicPublicHwm}).`);
  }

  if (contribDoc.lastSyncReceipt !== undefined) {
    errors.push(`lastSyncReceipt is already present in contribution ledger.`);
  }

  // 8. Baseline Specific Invariant Check
  if (!options.allowForeignBaseline) {
    if (contribDoc.installationBaseline !== undefined && contribDoc.installationBaseline !== null) {
      errors.push(`installationBaseline is already present in contribution ledger.`);
    }
  } else {
    // When foreign baseline is allowed for reinitialization:
    // Verify that it actually represents a foreign owner and not the same owner trying to bypass baseline protection
    if (
      options.expectedOwnerDatabaseId !== undefined &&
      typeof contribDoc.ownerDatabaseId === 'number' &&
      contribDoc.ownerDatabaseId === options.expectedOwnerDatabaseId
    ) {
      errors.push(
        `Installation baseline already belongs to the target owner (${contribDoc.ownerDatabaseId}). Cannot reinitialize a baseline for the same owner.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    state: errors.length === 0 ? { pet: petDoc, contributions: contribDoc, actions: actionsDoc } : undefined,
  };
}
