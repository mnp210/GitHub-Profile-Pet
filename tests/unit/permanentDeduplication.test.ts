import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  initDefaultActivityLedger,
  evaluateActivityEvent,
  isDuplicateEvent,
  addNumberToIntervals,
  isNumberInIntervals,
  type ActivityArchiveDocument,
} from '../../src/features/pet-engine/activity/index.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';

function createMockPetState(overrides: Partial<PetStateDocument> = {}): PetStateDocument {
  return {
    schemaVersion: 1,
    generation: 1,
    name: 'Shadow Claw',
    species: 'cat',
    level: 1,
    xp: 0,
    maxExp: 100,
    energy: 100,
    energyAccumulator: 0,
    hunger: 100,
    happiness: 100,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-19T12:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-19T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T12:00:00.000Z',
    ...overrides,
  };
}

describe('Permanent Event Deduplication Engine (Sprint 4.0)', () => {
  describe('Range Interval Indexing for Sequential Identifiers', () => {
    it('correctly tracks and checks single numbers', () => {
      const intervals = addNumberToIntervals([], 42);
      assert.deepEqual(intervals, [[42, 42]]);
      assert.equal(isNumberInIntervals(intervals, 42), true);
      assert.equal(isNumberInIntervals(intervals, 41), false);
      assert.equal(isNumberInIntervals(intervals, 43), false);
    });

    it('merges adjacent intervals into contiguous ranges', () => {
      let intervals = addNumberToIntervals([], 1);
      intervals = addNumberToIntervals(intervals, 2);
      intervals = addNumberToIntervals(intervals, 3);
      assert.deepEqual(intervals, [[1, 3]]);

      intervals = addNumberToIntervals(intervals, 5);
      assert.deepEqual(intervals, [[1, 3], [5, 5]]);

      // Bridge the gap
      intervals = addNumberToIntervals(intervals, 4);
      assert.deepEqual(intervals, [[1, 5]]);
    });

    it('compresses thousands of sequential IDs into O(1) space', () => {
      let intervals: [number, number][] = [];
      for (let i = 1; i <= 5000; i++) {
        intervals = addNumberToIntervals(intervals, i);
      }
      assert.deepEqual(intervals, [[1, 5000]]);
      assert.equal(isNumberInIntervals(intervals, 2500), true);
      assert.equal(isNumberInIntervals(intervals, 5001), false);
    });

    it('rejects invalid, zero, or negative numbers gracefully', () => {
      const intervals = addNumberToIntervals([], -5);
      assert.deepEqual(intervals, []);
      const intervalsZero = addNumberToIntervals([], 0);
      assert.deepEqual(intervalsZero, []);
      assert.equal(isNumberInIntervals(intervals, 0), false);
      assert.equal(isNumberInIntervals(intervals, -1), false);
    });
  });

  describe('Replay Protection after > 500 Subsequent Events', () => {
    it('rejects replayed commit SHA even after 600 subsequent commits', () => {
      let pet = createMockPetState();
      let ledger = initDefaultActivityLedger();

      const initialSha = '0123456789abcdef0123456789abcdef01234567';

      // 1. Process initial event
      const firstOutcome = evaluateActivityEvent(pet, ledger, {
        eventType: 'commit',
        eventId: `commit:${initialSha}`,
        actor: 'mnp210',
      });
      assert.equal(firstOutcome.result.status, 'rewarded');
      assert.equal(firstOutcome.result.xpAwarded, 15);
      pet = firstOutcome.updatedPet;
      ledger = firstOutcome.updatedLedger;

      // 2. Process 600 subsequent commits
      for (let i = 1; i <= 600; i++) {
        const hex = i.toString(16).padStart(40, '0');
        const outcome = evaluateActivityEvent(pet, ledger, {
          eventType: 'commit',
          eventId: `commit:${hex}`,
          actor: 'mnp210',
        });
        pet = outcome.updatedPet;
        ledger = outcome.updatedLedger;
      }

      // 3. Replay initial event: must be recognized as duplicate
      const replayOutcome = evaluateActivityEvent(pet, ledger, {
        eventType: 'commit',
        eventId: `commit:${initialSha}`,
        actor: 'mnp210',
      });

      assert.equal(replayOutcome.result.status, 'skipped_duplicate');
      assert.equal(replayOutcome.result.xpAwarded, 0);
      assert.match(replayOutcome.result.reason ?? '', /permanent deduplication index/i);
    });

    it('rejects replayed issue number even after 600 subsequent issues', () => {
      let pet = createMockPetState();
      let ledger = initDefaultActivityLedger();

      const initialIssueNumber = 10;

      // 1. Process initial issue
      const firstOutcome = evaluateActivityEvent(pet, ledger, {
        eventType: 'issue_opened',
        eventId: `issue:${initialIssueNumber}`,
        actor: 'mnp210',
        details: 'Initial bug report',
      });
      assert.equal(firstOutcome.result.status, 'rewarded');
      assert.equal(firstOutcome.result.xpAwarded, 10);
      pet = firstOutcome.updatedPet;
      ledger = firstOutcome.updatedLedger;

      // 2. Process 600 subsequent issues
      for (let i = 11; i <= 610; i++) {
        const outcome = evaluateActivityEvent(pet, ledger, {
          eventType: 'issue_opened',
          eventId: `issue:${i}`,
          actor: 'mnp210',
          details: `Issue ${i}`,
        });
        pet = outcome.updatedPet;
        ledger = outcome.updatedLedger;
      }

      // Active working registry issueNumbers was capped at 500, so 10 was popped from working array
      assert.equal(ledger.processedRegistry.issueNumbers.includes(10), false);
      // But permanentIndex intervals preserved it!
      assert.equal(isNumberInIntervals(ledger.permanentIndex?.issueIntervals, 10), true);

      // 3. Replay initial issue: must be recognized as duplicate
      const replayOutcome = evaluateActivityEvent(pet, ledger, {
        eventType: 'issue_opened',
        eventId: `issue:${initialIssueNumber}`,
        actor: 'mnp210',
      });

      assert.equal(replayOutcome.result.status, 'skipped_duplicate');
      assert.equal(replayOutcome.result.xpAwarded, 0);
    });
  });

  describe('Historical Ledger Archival Replay Protection', () => {
    it('rejects replayed commit SHA that exists in historical activity archive', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();
      const archivedSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

      const archive: ActivityArchiveDocument = {
        schemaVersion: 1,
        archivedCommitShas: [archivedSha],
        archivedEventCount: 1,
        updatedAt: '2026-11-19T00:00:00Z',
      };

      // Ledger active and permanent arrays are empty, but archive has the SHA
      assert.equal(isDuplicateEvent(ledger.processedRegistry, 'commit', archivedSha, ledger.permanentIndex, archive.archivedCommitShas), true);

      const outcome = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventType: 'commit',
          eventId: `commit:${archivedSha}`,
          actor: 'mnp210',
        },
        new Date().toISOString(),
        archive.archivedCommitShas
      );

      assert.equal(outcome.result.status, 'skipped_duplicate');
      assert.equal(outcome.result.xpAwarded, 0);
    });
  });

  describe('Workflow Reruns & State Restoration', () => {
    it('rejects duplicate execution on workflow rerun with identical payload', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      const run1 = evaluateActivityEvent(pet, ledger, {
        eventType: 'pr_opened',
        eventId: 'pr_opened:77',
        actor: 'mnp210',
      });
      assert.equal(run1.result.status, 'rewarded');
      assert.equal(run1.result.xpAwarded, 25);

      // Workflow rerun executes again with the same event payload
      const rerun = evaluateActivityEvent(run1.updatedPet, run1.updatedLedger, {
        eventType: 'pr_opened',
        eventId: 'pr_opened:77',
        actor: 'mnp210',
      });
      assert.equal(rerun.result.status, 'skipped_duplicate');
      assert.equal(rerun.result.xpAwarded, 0);
      assert.equal(rerun.updatedPet.xp, run1.updatedPet.xp);
    });

    it('preserves deduplication when pet state is restored from an older backup', () => {
      const olderPetBackup = createMockPetState({ level: 1, xp: 0, generation: 1 });
      let ledger = initDefaultActivityLedger();

      // Record commit in ledger
      const outcome = evaluateActivityEvent(olderPetBackup, ledger, {
        eventType: 'commit',
        eventId: 'commit:c0ffee1234567890c0ffee1234567890c0ffee12',
        actor: 'mnp210',
      });
      ledger = outcome.updatedLedger;

      // Pet was restored from olderPetBackup (XP: 0), but ledger has the commit
      const replayed = evaluateActivityEvent(olderPetBackup, ledger, {
        eventType: 'commit',
        eventId: 'commit:c0ffee1234567890c0ffee1234567890c0ffee12',
        actor: 'mnp210',
      });

      assert.equal(replayed.result.status, 'skipped_duplicate');
      assert.equal(replayed.result.xpAwarded, 0);
    });
  });
});
