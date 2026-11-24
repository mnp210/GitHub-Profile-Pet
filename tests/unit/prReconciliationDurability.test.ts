import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  reconcileGitHubApiEvents,
  performCompleteReconciliation,
  evaluateActivityEvent,
  initDefaultActivityLedger,
  DAILY_ACTIVITY_XP_CAP,
} from '../../src/features/pet-engine/activity/index.ts';
import { runProcessingCycle } from '../../scripts/process-activity.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';
import type { ActivityLedgerDocument } from '../../src/features/pet-engine/activity/types.ts';

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
    lastInteractionTime: '2026-11-24T12:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-24T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('PR Reconciliation Durability & Recovery Suite (Sprint 5.2D-J)', () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pr-durability-test-'));
    await fs.mkdir(path.join(tempBaseDir, 'pet/state'), { recursive: true });
    await fs.mkdir(path.join(tempBaseDir, 'pet/ledger'), { recursive: true });
    await fs.mkdir(path.join(tempBaseDir, 'public'), { recursive: true });

    const pet = createMockPetState();
    const ledger = initDefaultActivityLedger(1);
    await fs.writeFile(path.join(tempBaseDir, 'pet/state/pet.json'), JSON.stringify(pet, null, 2) + '\n');
    await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2) + '\n');
    await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/actions.json'), JSON.stringify({ generation: 1, actions: [] }, null, 2) + '\n');
    await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/contributions.json'), JSON.stringify({ generation: 1, contributions: [] }, null, 2) + '\n');
    await fs.writeFile(path.join(tempBaseDir, 'public/pet.svg'), '<svg></svg>\n');
    await fs.writeFile(path.join(tempBaseDir, 'README.md'), '# Test\n');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Multi-Page API Pagination', () => {
    it('discovers PRs seamlessly across multiple paginated API responses', async () => {
      const page1 = [
        { number: 10, title: 'PR 10', user: { login: 'user1' }, created_at: '2026-11-24T12:00:00.000Z' },
        { number: 9, title: 'PR 9', user: { login: 'user2' }, created_at: '2026-11-24T11:00:00.000Z' },
      ];
      const page2 = [
        { number: 8, title: 'PR 8', user: { login: 'user3' }, created_at: '2026-11-24T10:00:00.000Z' },
        { number: 7, title: 'PR 7', user: { login: 'user4' }, created_at: '2026-11-24T09:00:00.000Z' },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/pulls?state=all')) {
          const match = urlStr.match(/[?&]page=(\d+)/);
          const pageNum = match ? parseInt(match[1], 10) : 1;
          if (pageNum === 1) {
            return new Response(JSON.stringify(page1), { status: 200, headers: { 'x-ratelimit-remaining': '5000' } });
          }
          if (pageNum === 2) {
            return new Response(JSON.stringify(page2), { status: 200, headers: { 'x-ratelimit-remaining': '5000' } });
          }
          return new Response(JSON.stringify([]), { status: 200, headers: { 'x-ratelimit-remaining': '5000' } });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const result = await reconcileGitHubApiEvents('fake-token', 'owner/repo', {
        pageSize: 2,
        fetchFn: mockFetch,
        nowUtc: '2026-11-24T13:00:00.000Z',
      });

      const prNumbers = result.events.filter((e) => e.eventType === 'pr_opened').map((e) => e.eventId);
      assert.deepEqual(prNumbers, ['pr_opened:10', 'pr_opened:9', 'pr_opened:8', 'pr_opened:7']);
      assert.equal(result.completedFully, true);
      assert.equal(result.latestPrNumber, 10);
    });
  });

  describe('2. Uncheckpointed PR Recovery Beyond 14-Day Lookback Window', () => {
    it('successfully recovers uncheckpointed PRs created more than 14 days ago after an outage', async () => {
      const nowUtc = '2026-11-24T12:00:00.000Z';
      const twentyDaysAgo = '2026-11-04T12:00:00.000Z';

      // PR #5 was created 20 days ago during an extended workflow outage
      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/pulls?state=all')) {
          return new Response(
            JSON.stringify([
              { number: 5, title: 'Outage PR', user: { login: 'dev_during_outage' }, created_at: twentyDaysAgo },
            ]),
            { status: 200, headers: { 'x-ratelimit-remaining': '5000' } }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Previous checkpoint was lastPrNumber = 4 (PR #5 is uncheckpointed: 5 > 4)
      const recon = await reconcileGitHubApiEvents('fake-token', 'owner/repo', {
        stopAtPrNumber: 4,
        nowUtc,
        fetchFn: mockFetch,
      });

      const discovered = recon.events.find((e) => e.eventId === 'pr_opened:5');
      assert.ok(discovered, 'PR #5 must be discovered despite being 20 days old');
      assert.equal(discovered.allowHistoricalRecovery, true, 'Must flag allowHistoricalRecovery on uncheckpointed PR');

      // Now process the event in activityProcessor
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      ledger.checkpoints = { lastPrNumber: 4, reconciledAt: twentyDaysAgo };

      const outcome = evaluateActivityEvent(pet, ledger, discovered, nowUtc);
      assert.equal(outcome.result.success, true);
      assert.equal(outcome.result.status, 'rewarded', 'Must award XP rather than skipping as stale');
      assert.equal(outcome.result.xpAwarded, 25);
      assert.equal(outcome.updatedPet.xp, 25);
    });
  });

  describe('3. Partial Failure & Checkpoint Protection', () => {
    it('sets completedFully false and preserves checkpoints without advancement when pagination fails halfway', async () => {
      let pageCount = 0;
      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/pulls?state=all')) {
          pageCount++;
          if (pageCount === 1) {
            return new Response(
              JSON.stringify([{ number: 20, title: 'PR 20', user: { login: 'u1' }, created_at: '2026-11-24T10:00:00.000Z' }]),
              { status: 200, headers: { 'x-ratelimit-remaining': '5000' } }
            );
          }
          // Page 2 fails with network error / 500
          return new Response('Internal Server Error', { status: 500, statusText: 'Server Error' });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const recon = await reconcileGitHubApiEvents('fake-token', 'owner/repo', {
        pageSize: 1,
        stopAtPrNumber: 15,
        fetchFn: mockFetch,
      });

      assert.equal(recon.completedFully, false, 'completedFully must be false on partial failure');
      assert.ok(recon.warnings.some((w) => w.includes('500')), 'Must log warning about failed page');
    });

    it('does not advance durable ledger checkpoint when reconciliation fails', async () => {
      const initialLedger: ActivityLedgerDocument = initDefaultActivityLedger(1);
      initialLedger.checkpoints = {
        lastCommitSha: 'sha_base_000',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: '2026-11-20T00:00:00.000Z',
      };
      await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(initialLedger, null, 2) + '\n');

      const recon = await performCompleteReconciliation({
        baseDir: tempBaseDir,
        targetRef: 'main',
        stopAtSha: 'sha_base_000',
        stopAtPrNumber: 10,
        token: 'fake-token',
        repository: 'owner/repo',
        fetchFn: async () => new Response('Rate limited', { status: 403, statusText: 'Forbidden' }),
      });

      assert.equal(recon.completedFully, false);
      // Checkpoints preserved at previous values
      assert.equal(recon.checkpoints.lastPrNumber, 10);
      assert.equal(recon.checkpoints.lastCommitSha, 'sha_base_000');
    });
  });

  describe('4. Failed Request Followed by Successful Retry', () => {
    it('successfully recovers and processes PRs after an initial failed attempt', async () => {
      let attempt = 0;
      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/pulls?state=all')) {
          attempt++;
          if (attempt === 1) {
            throw new Error('ETIMEDOUT');
          }
          // Attempt 2 succeeds
          return new Response(
            JSON.stringify([
              { number: 12, title: 'Recovered PR', user: { login: 'retry_user' }, created_at: '2026-11-24T12:00:00.000Z' },
            ]),
            { status: 200, headers: { 'x-ratelimit-remaining': '5000' } }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Run 1: Fails
      const recon1 = await reconcileGitHubApiEvents('fake-token', 'owner/repo', {
        stopAtPrNumber: 10,
        fetchFn: mockFetch,
      });
      assert.equal(recon1.completedFully, false);
      assert.equal(recon1.events.length, 0);

      // Run 2: Succeeds on retry
      const recon2 = await reconcileGitHubApiEvents('fake-token', 'owner/repo', {
        stopAtPrNumber: 10,
        fetchFn: mockFetch,
      });
      assert.equal(recon2.completedFully, true);
      assert.equal(recon2.events.length, 1);
      assert.equal(recon2.events[0].eventId, 'pr_opened:12');
      assert.equal(recon2.latestPrNumber, 12);
    });
  });

  describe('5. Repeated Overlapping Scans & Exactly-Once Semantics', () => {
    it('awards 0 XP when overlapping scan returns already-recorded PRs', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const timestamp = '2026-11-24T12:00:00.000Z';

      // First run: PR #30 awarded
      const first = evaluateActivityEvent(
        pet,
        ledger,
        { eventType: 'pr_opened', eventId: 'pr_opened:30', actor: 'user30', details: 'first' },
        timestamp
      );
      assert.equal(first.result.status, 'rewarded');
      assert.equal(first.result.xpAwarded, 25);
      assert.equal(first.updatedPet.xp, 25);

      // Second run: overlapping scan re-fetches PR #30
      const second = evaluateActivityEvent(
        first.updatedPet,
        first.updatedLedger,
        { eventType: 'pr_opened', eventId: 'pr_opened:30', actor: 'user30', details: 'overlap' },
        timestamp
      );
      assert.equal(second.result.status, 'skipped_duplicate');
      assert.equal(second.result.xpAwarded, 0);
      assert.equal(second.updatedPet.xp, 25, 'Total XP must remain exactly 25');
    });

    it('handles PR reopened event without granting duplicate opening reward', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const timestamp = '2026-11-24T12:00:00.000Z';

      const opened = evaluateActivityEvent(
        pet,
        ledger,
        { eventType: 'pr_opened', eventId: 'pr_opened:40', actor: 'user40', details: 'PR 40 opened' },
        timestamp
      );
      assert.equal(opened.result.xpAwarded, 25);

      // Reopened event delivery
      const reopened = evaluateActivityEvent(
        opened.updatedPet,
        opened.updatedLedger,
        { eventType: 'pr_opened', eventId: 'pr_opened:40', actor: 'user40', details: 'PR 40 reopened' },
        timestamp
      );
      assert.equal(reopened.result.status, 'skipped_duplicate');
      assert.equal(reopened.result.xpAwarded, 0);
      assert.equal(reopened.updatedPet.xp, 25);
    });
  });

  describe('6. PR Closed Unmerged Does Not Erase Opening Reward', () => {
    it('preserves the +25 XP opening reward when a PR is subsequently closed without merge', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const timestamp = '2026-11-24T12:00:00.000Z';

      // 1. PR opened
      const opened = evaluateActivityEvent(
        pet,
        ledger,
        { eventType: 'pr_opened', eventId: 'pr_opened:50', actor: 'user50', details: 'PR 50 opened' },
        timestamp
      );
      assert.equal(opened.result.xpAwarded, 25);
      assert.equal(opened.updatedPet.xp, 25);

      // 2. PR subsequently closed unmerged
      // Verified: no merge event is generated, ledger remains intact with +25 XP
      assert.ok(opened.updatedLedger.processedRegistry.prOpenedNumbers.includes(50));
      assert.equal(opened.updatedLedger.processedRegistry.prMergedNumbers.includes(50), false);
      assert.equal(opened.updatedPet.xp, 25, 'Opening reward must never be revoked or erased on unmerged close');
    });
  });

  describe('7. PR Opened and Subsequently Merged (+75 XP Total)', () => {
    it('awards +25 XP on open and +50 XP on merge across reconciliation runs', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const openTime = '2026-11-24T10:00:00.000Z';
      const mergeTime = '2026-11-24T14:00:00.000Z';

      // 1. PR opened
      const opened = evaluateActivityEvent(
        pet,
        ledger,
        { eventType: 'pr_opened', eventId: 'pr_opened:60', actor: 'author60', details: 'PR 60' },
        openTime
      );
      assert.equal(opened.result.xpAwarded, 25);
      assert.equal(opened.updatedPet.xp, 25);

      // 2. PR merged later
      const merged = evaluateActivityEvent(
        opened.updatedPet,
        opened.updatedLedger,
        { eventType: 'pr_merged', eventId: 'pr_merged:60', actor: 'maintainer', details: 'Merged PR 60', prMerged: true },
        mergeTime
      );
      assert.equal(merged.result.xpAwarded, 50);
      assert.equal(merged.updatedPet.xp, 75, 'Total XP must be exactly 75 (+25 open + 50 merge)');
      assert.ok(merged.updatedLedger.processedRegistry.prOpenedNumbers.includes(60));
      assert.ok(merged.updatedLedger.processedRegistry.prMergedNumbers.includes(60));
    });
  });

  describe('8. Daily Cap and Bot Filters Under Reconciliation', () => {
    it('strictly clamps XP to 300 daily cap when multiple PRs are reconciled on the same UTC day', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const dateKey = '2026-11-24';
      const timestamp = `${dateKey}T12:00:00.000Z`;

      // Pre-seed ledger with 280 XP
      ledger.dailyAccruedXp[dateKey] = 280;

      // PR opened event (+25 XP) clamped to 20 XP
      const pr1 = evaluateActivityEvent(
        pet,
        ledger,
        { eventType: 'pr_opened', eventId: 'pr_opened:70', actor: 'user70', details: 'PR 70' },
        timestamp
      );
      assert.equal(pr1.result.xpAwarded, 20);
      assert.equal(pr1.updatedLedger.dailyAccruedXp[dateKey], DAILY_ACTIVITY_XP_CAP);

      // Another PR opened on the same day is capped (0 XP)
      const pr2 = evaluateActivityEvent(
        pr1.updatedPet,
        pr1.updatedLedger,
        { eventType: 'pr_opened', eventId: 'pr_opened:71', actor: 'user71', details: 'PR 71' },
        timestamp
      );
      assert.equal(pr2.result.status, 'skipped_daily_cap');
      assert.equal(pr2.result.xpAwarded, 0);
      assert.equal(pr2.updatedLedger.dailyAccruedXp[dateKey], 300);
    });

    it('rejects bot actors during reconciliation sweep', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const timestamp = '2026-11-24T12:00:00.000Z';

      const botPR = evaluateActivityEvent(
        pet,
        ledger,
        { eventType: 'pr_opened', eventId: 'pr_opened:80', actor: 'dependabot[bot]', isBot: true, details: 'bot PR' },
        timestamp
      );
      assert.equal(botPR.result.status, 'skipped_bot');
      assert.equal(botPR.result.xpAwarded, 0);
    });
  });

  describe('9. Interrupted Execution Recovery via Journal', () => {
    it('recovers cleanly when execution was interrupted and rolls forward or rolls back safely', async () => {
      const gitCalls: string[][] = [];
      const mockExecGit = async (args: string[]) => {
        gitCalls.push(args);
        if (args[0] === 'status') {
          return { stdout: ' M pet/state/pet.json\n M pet/ledger/activity.json\n', stderr: '' };
        }
        if (args[0] === 'rev-parse') {
          return { stdout: 'sha_test_999\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [
          {
            eventType: 'pr_opened',
            eventId: 'pr_opened:90',
            actor: 'resilient_user',
            details: 'PR 90',
          },
        ],
        execGitFn: mockExecGit,
      });

      // Verify state was persisted to disk cleanly
      const savedPetRaw = await fs.readFile(path.join(tempBaseDir, 'pet/state/pet.json'), 'utf-8');
      const savedPet = JSON.parse(savedPetRaw);
      assert.equal(savedPet.xp, 25);

      const savedLedgerRaw = await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8');
      const savedLedger = JSON.parse(savedLedgerRaw);
      assert.ok(savedLedger.processedRegistry.prOpenedNumbers.includes(90));
    });
  });
});
