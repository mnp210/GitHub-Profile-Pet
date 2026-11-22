import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateActivityEvent,
  initDefaultActivityLedger,
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

describe('Activity Progression Engine - Unit Tests', () => {
  const timestamp = '2026-11-19T14:00:00.000Z';

  describe('Commit Activity & Deduplication', () => {
    it('awards 15 XP for a unique qualifying commit', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();
      const sha = 'e8b3a7f45109c314052bf31899a7e6b7c53d1029';

      const { updatedPet, updatedLedger, result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: sha,
          eventType: 'commit',
          actor: 'developer1',
          commitMessage: 'feat: implement shiny new feature',
          ref: 'refs/heads/main',
        },
        timestamp
      );

      assert.equal(result.success, true);
      assert.equal(result.status, 'rewarded');
      assert.equal(result.xpAwarded, 15);
      assert.equal(updatedPet.xp, 15);
      assert.equal(updatedPet.level, 1);
      assert.equal(updatedLedger.dailyAccruedXp['2026-11-19'], 15);
      assert.ok(updatedLedger.processedRegistry.commitShas.includes(sha.toLowerCase()));
    });

    it('rejects duplicate commit SHA and awards 0 XP', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();
      const sha = 'e8b3a7f45109c314052bf31899a7e6b7c53d1029';

      const firstPass = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: sha,
          eventType: 'commit',
          actor: 'developer1',
          commitMessage: 'feat: first run',
        },
        timestamp
      );

      assert.equal(firstPass.result.xpAwarded, 15);

      // Re-run with the exact same commit SHA
      const secondPass = evaluateActivityEvent(
        firstPass.updatedPet,
        firstPass.updatedLedger,
        {
          eventId: sha,
          eventType: 'commit',
          actor: 'developer1',
          commitMessage: 'feat: replayed push event',
        },
        timestamp
      );

      assert.equal(secondPass.result.success, true);
      assert.equal(secondPass.result.status, 'skipped_duplicate');
      assert.equal(secondPass.result.xpAwarded, 0);
      assert.equal(secondPass.updatedPet.xp, 15);
      assert.equal(secondPass.updatedLedger.dailyAccruedXp['2026-11-19'], 15);
    });
  });

  describe('Issue Creation & Care Action Exclusion', () => {
    it('awards 10 XP for a regular issue creation', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      const { updatedPet, updatedLedger, result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: '42',
          eventType: 'issue_opened',
          actor: 'developer1',
          details: 'bug: navigation bar glitch on mobile',
          issueLabels: ['bug', 'frontend'],
        },
        timestamp
      );

      assert.equal(result.status, 'rewarded');
      assert.equal(result.xpAwarded, 10);
      assert.equal(updatedPet.xp, 10);
      assert.ok(updatedLedger.processedRegistry.issueNumbers.includes(42));
    });

    it('skips pet care action issues with pet-action:pending label', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      const { updatedPet, result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: '43',
          eventType: 'issue_opened',
          actor: 'developer1',
          details: 'pet: feed',
          issueLabels: ['pet-action:pending'],
        },
        timestamp
      );

      assert.equal(result.status, 'skipped_care_action');
      assert.equal(result.xpAwarded, 0);
      assert.equal(updatedPet.xp, 0);
    });

    it('skips pet care action issues with "pet: " title prefix even without label', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      const { result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: '44',
          eventType: 'issue_opened',
          actor: 'developer1',
          details: 'pet: play with ball',
          issueLabels: [],
        },
        timestamp
      );

      assert.equal(result.status, 'skipped_care_action');
      assert.equal(result.xpAwarded, 0);
    });
  });

  describe('Pull Request Lifecycle: Opened (25 XP) & Merged (50 XP)', () => {
    it('awards 25 XP on PR opened and 50 XP on PR merged for the same PR number (75 XP total)', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();
      const prNumber = '101';

      // 1. PR Opened
      const openedStep = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: prNumber,
          eventType: 'pr_opened',
          actor: 'contributorA',
          details: 'feat: add audio synthesizer',
        },
        timestamp
      );

      assert.equal(openedStep.result.status, 'rewarded');
      assert.equal(openedStep.result.xpAwarded, 25);
      assert.equal(openedStep.updatedPet.xp, 25);
      assert.ok(openedStep.updatedLedger.processedRegistry.prOpenedNumbers.includes(101));
      assert.equal(openedStep.updatedLedger.processedRegistry.prMergedNumbers.includes(101), false);

      // 2. PR Merged
      const mergedStep = evaluateActivityEvent(
        openedStep.updatedPet,
        openedStep.updatedLedger,
        {
          eventId: prNumber,
          eventType: 'pr_merged',
          actor: 'maintainer1',
          details: 'Merged PR #101 into main',
        },
        timestamp
      );

      assert.equal(mergedStep.result.status, 'rewarded');
      assert.equal(mergedStep.result.xpAwarded, 50);
      assert.equal(mergedStep.updatedPet.xp, 75); // 25 + 50 = 75 XP
      assert.ok(mergedStep.updatedLedger.processedRegistry.prOpenedNumbers.includes(101));
      assert.ok(mergedStep.updatedLedger.processedRegistry.prMergedNumbers.includes(101));

      // 3. Duplicate PR Merged replay
      const duplicateMerge = evaluateActivityEvent(
        mergedStep.updatedPet,
        mergedStep.updatedLedger,
        {
          eventId: prNumber,
          eventType: 'pr_merged',
          actor: 'maintainer1',
        },
        timestamp
      );

      assert.equal(duplicateMerge.result.status, 'skipped_duplicate');
      assert.equal(duplicateMerge.result.xpAwarded, 0);
      assert.equal(duplicateMerge.updatedPet.xp, 75);
    });
  });

  describe('Code Review Activity (20 XP)', () => {
    it('awards 20 XP for substantive review submission', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      const { updatedPet, updatedLedger, result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: '9001',
          eventType: 'review_submitted',
          actor: 'seniorReviewer',
          details: 'Approved with architecture feedback',
        },
        timestamp
      );

      assert.equal(result.status, 'rewarded');
      assert.equal(result.xpAwarded, 20);
      assert.equal(updatedPet.xp, 20);
      assert.ok(updatedLedger.processedRegistry.reviewIds.includes(9001));
    });

    it('rejects duplicate review ID', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      const first = evaluateActivityEvent(
        pet,
        ledger,
        { eventId: '9001', eventType: 'review_submitted', actor: 'seniorReviewer' },
        timestamp
      );
      const second = evaluateActivityEvent(
        first.updatedPet,
        first.updatedLedger,
        { eventId: '9001', eventType: 'review_submitted', actor: 'seniorReviewer' },
        timestamp
      );

      assert.equal(second.result.status, 'skipped_duplicate');
      assert.equal(second.result.xpAwarded, 0);
    });
  });

  describe('Bot & Commit Message Filtering', () => {
    it('filters out bot actors (dependabot[bot], github-actions[bot], etc.)', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      const botCases = [
        { actor: 'dependabot[bot]', isBot: false },
        { actor: 'github-actions[bot]', isBot: false },
        { actor: 'renovate[bot]', isBot: false },
        { actor: 'custom-actor', isBot: true },
      ];

      for (const b of botCases) {
        const { result, updatedPet } = evaluateActivityEvent(
          pet,
          ledger,
          {
            eventId: `commit-${b.actor}`,
            eventType: 'commit',
            actor: b.actor,
            isBot: b.isBot,
          },
          timestamp
        );

        assert.equal(result.status, 'skipped_bot');
        assert.equal(result.xpAwarded, 0);
        assert.equal(updatedPet.xp, 0);
      }
    });

    it('filters out commits with [skip ci], [ci skip], or pet automated messages', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      const skipMessages = [
        'chore: release v1.0.0 [skip ci]',
        'docs: update notes [ci skip]',
        'pet: update state generation 5',
        'Auto-update pet SVG and README menu',
      ];

      for (const msg of skipMessages) {
        const { result, updatedPet } = evaluateActivityEvent(
          pet,
          ledger,
          {
            eventId: `sha-${msg.slice(0, 10)}`,
            eventType: 'commit',
            actor: 'humanDeveloper',
            commitMessage: msg,
          },
          timestamp
        );

        assert.equal(result.status, 'skipped_bot');
        assert.equal(result.xpAwarded, 0);
        assert.equal(updatedPet.xp, 0);
      }
    });
  });

  describe('Daily XP Cap & Boundary Clamping', () => {
    it('clamps XP when approaching daily cap and skips once cap is reached', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      // Seed ledger with 290 accrued XP today
      ledger.dailyAccruedXp['2026-11-19'] = 290;

      // Event is a PR creation (normally 25 XP). Budget remaining: 300 - 290 = 10 XP.
      const clampedPass = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: '201',
          eventType: 'pr_opened',
          actor: 'developer1',
        },
        timestamp
      );

      assert.equal(clampedPass.result.status, 'rewarded');
      assert.equal(clampedPass.result.xpAwarded, 10); // Clamped from 25 to 10
      assert.equal(clampedPass.updatedLedger.dailyAccruedXp['2026-11-19'], 300);

      // Next event when cap is completely filled (300)
      const cappedPass = evaluateActivityEvent(
        clampedPass.updatedPet,
        clampedPass.updatedLedger,
        {
          eventId: '202',
          eventType: 'commit',
          actor: 'developer1',
          commitMessage: 'fix: late night patch',
        },
        timestamp
      );

      assert.equal(cappedPass.result.status, 'skipped_daily_cap');
      assert.equal(cappedPass.result.xpAwarded, 0);
      assert.equal(cappedPass.updatedLedger.dailyAccruedXp['2026-11-19'], 300);
    });

    it('resets daily cap on a new date (UTC)', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      ledger.dailyAccruedXp['2026-11-19'] = 300; // Cap reached yesterday

      // Activity on next day
      const nextDayPass = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: '301',
          eventType: 'commit',
          actor: 'developer1',
          commitMessage: 'feat: next day work',
        },
        '2026-11-20T09:00:00.000Z'
      );

      assert.equal(nextDayPass.result.status, 'rewarded');
      assert.equal(nextDayPass.result.xpAwarded, 15);
      assert.equal(nextDayPass.updatedLedger.dailyAccruedXp['2026-11-20'], 15);
      assert.equal(nextDayPass.updatedLedger.dailyAccruedXp['2026-11-19'], 300);
    });
  });

  describe('Level Progression & Evolution Transitions', () => {
    it('advances level and triggers evolution when crossing thresholds', () => {
      // Level 1, 95/100 XP -> adding 15 XP pushes to 110 XP -> Level 2
      const pet = createMockPetState({ level: 1, xp: 95, maxExp: 100, evolutionStage: 'Hatchling' });
      const ledger = initDefaultActivityLedger();

      const { updatedPet, result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: '9999',
          eventType: 'commit',
          actor: 'developer1',
          commitMessage: 'feat: push over level boundary',
        },
        timestamp
      );

      assert.equal(result.didLevelUp, true);
      assert.equal(result.previousLevel, 1);
      assert.equal(result.newLevel, 2);
      assert.equal(updatedPet.level, 2);
      assert.equal(updatedPet.mood, 'Energetic');
    });
  });

  describe('Bounded Retention & Staleness Protection', () => {
    it('rejects events older than 14 days as skipped_stale with 0 XP', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();
      const oldTimestamp = '2026-11-01T00:00:00.000Z'; // 18 days before timestamp (2026-11-19)

      const { updatedPet, result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: 'old-commit-sha-12345',
          eventType: 'commit',
          actor: 'developer1',
          timestamp: oldTimestamp,
          commitMessage: 'feat: very old commit',
        },
        timestamp
      );

      assert.equal(result.status, 'skipped_stale');
      assert.equal(result.xpAwarded, 0);
      assert.equal(updatedPet.xp, 0);
    });

    it('accepts events within the 14-day window', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();
      const recentTimestamp = '2026-11-17T00:00:00.000Z'; // 2 days before timestamp

      const { updatedPet, result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: 'recent-commit-sha-67890',
          eventType: 'commit',
          actor: 'developer1',
          timestamp: recentTimestamp,
          commitMessage: 'feat: recent commit',
        },
        timestamp
      );

      assert.equal(result.status, 'rewarded');
      assert.equal(result.xpAwarded, 15);
      assert.equal(updatedPet.xp, 15);
    });

    it('prunes daily accrued XP entries older than 30 days', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger();

      // Seed with an old date (45 days ago) and a recent date (2 days ago)
      ledger.dailyAccruedXp['2026-10-01'] = 200;
      ledger.dailyAccruedXp['2026-11-17'] = 150;

      const { updatedLedger } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: 'commit-today',
          eventType: 'commit',
          actor: 'developer1',
        },
        timestamp
      );

      // '2026-10-01' should be pruned; '2026-11-17' and today '2026-11-19' should exist
      assert.equal(updatedLedger.dailyAccruedXp['2026-10-01'], undefined);
      assert.equal(updatedLedger.dailyAccruedXp['2026-11-17'], 150);
      assert.equal(updatedLedger.dailyAccruedXp['2026-11-19'], 15);
    });
  });
});
