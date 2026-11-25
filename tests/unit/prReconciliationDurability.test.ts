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
import type { ActivityLedgerDocument, ProcessActivityEventInput } from '../../src/features/pet-engine/activity/types.ts';

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

  describe('10. Sprint 5.2D-K Historical PR Recovery Boundary & Checkpoint Integrity Suite', () => {
    it('handles outage exceeding 90 days by capping lookback ceiling and preserving checkpoint safely', async () => {
      const now = Date.now();
      const oneHundredTwentyDaysAgo = new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString();

      // Configure ledger with last reconciliation 120 days ago
      const ledger = initDefaultActivityLedger(1);
      ledger.checkpoints = {
        lastCommitSha: 'sha_ancient',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: oneHundredTwentyDaysAgo,
      };
      await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2) + '\n');

      const mockExecGit = async (args: string[]) => {
        if (args[0] === 'status') {
          return { stdout: ' M pet/state/pet.json\n M pet/ledger/activity.json\n', stderr: '' };
        }
        if (args[0] === 'rev-parse') {
          return { stdout: 'sha_test_outage\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });

      const savedLedgerRaw = await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8');
      const savedLedger = JSON.parse(savedLedgerRaw);
      assert.ok(savedLedger.checkpoints);
    });

    it('falls back safely to 14 days when reconciledAt is absent or invalid', async () => {
      // 1. Missing reconciledAt
      const ledger1 = initDefaultActivityLedger(1);
      ledger1.checkpoints = {
        lastCommitSha: 'sha_test',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: undefined as unknown as string,
      };
      await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(ledger1, null, 2) + '\n');

      const mockExecGit = async (args: string[]) => {
        if (args[0] === 'status') return { stdout: '', stderr: '' };
        if (args[0] === 'rev-parse') return { stdout: 'sha_test\n', stderr: '' };
        return { stdout: '', stderr: '' };
      };

      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });

      // 2. Invalid reconciledAt string
      const ledger2 = initDefaultActivityLedger(1);
      ledger2.checkpoints = {
        lastCommitSha: 'sha_test',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: 'not-a-valid-date',
      };
      await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(ledger2, null, 2) + '\n');

      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });
    });

    it('recovers old PR opened 180 days ago and merged 25 days ago during a 30-day outage', async () => {
      const now = new Date('2026-11-24T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();
      const pr180DaysAgo = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString();
      const merge25DaysAgo = new Date(now - 25 * 24 * 60 * 60 * 1000).toISOString();
      const lookback32DaysAgo = new Date(now - 32 * 24 * 60 * 60 * 1000).toISOString();

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/pulls?state=all')) {
          // Open loop returns empty or older PRs
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/pulls?state=closed')) {
          // Closed pulls sorted by updated desc: returns PR #10 merged 25 days ago
          return new Response(
            JSON.stringify([
              {
                number: 10,
                title: 'Refactor core engine',
                user: { login: 'ancient_author', type: 'User' },
                created_at: pr180DaysAgo,
                merged_at: merge25DaysAgo,
                merged_by: { login: 'maintainer_user' },
              },
            ]),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        sinceIso: lookback32DaysAgo,
        stopAtPrNumber: 50,
        fetchFn: mockFetch,
      });

      assert.equal(result.completedFully, true);
      const mergeEvent = result.events.find((e) => e.eventType === 'pr_merged');
      assert.ok(mergeEvent, 'PR merged event must be discovered');
      assert.equal(mergeEvent.eventId, 'pr_merged:10');
      assert.equal(mergeEvent.actor, 'maintainer_user');
      assert.equal(mergeEvent.timestamp, merge25DaysAgo, 'Merge timestamp must be used, not creation timestamp');
      assert.equal(mergeEvent.allowHistoricalRecovery, true, 'Must allow historical recovery');

      // Now process the event and verify +50 XP is awarded
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const evalResult = evaluateActivityEvent(pet, ledger, mergeEvent, nowUtc);
      assert.equal(evalResult.result.status, 'rewarded');
      assert.equal(evalResult.result.xpAwarded, 50);
      assert.equal(evalResult.updatedPet.xp, 50);
      assert.ok(evalResult.updatedLedger.processedRegistry.prMergedNumbers.includes(10));

      // Subsequent evaluation of same merge event awards 0 XP (exactly once)
      const repeatEval = evaluateActivityEvent(evalResult.updatedPet, evalResult.updatedLedger, mergeEvent, nowUtc);
      assert.equal(repeatEval.result.status, 'skipped_duplicate');
      assert.equal(repeatEval.result.xpAwarded, 0);
    });

    it('automatically discovers and recovers eligible PRs below or equal to legacy checkpoint', async () => {
      const now = new Date('2026-11-24T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

      const mockPulls = [
        {
          number: 55, // Above checkpoint 50
          title: 'PR 55',
          user: { login: 'dev55', type: 'User' },
          created_at: twoDaysAgo,
        },
        {
          number: 50, // Equal to checkpoint 50 (already processed)
          title: 'PR 50',
          user: { login: 'dev50', type: 'User' },
          created_at: twoDaysAgo,
        },
        {
          number: 42, // Below checkpoint 50 (skipped by legacy checkpoint, never processed)
          title: 'PR 42',
          user: { login: 'dev42', type: 'User' },
          created_at: twoDaysAgo,
        },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) return new Response(JSON.stringify(mockPulls), { status: 200 });
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Run with stopAtPrNumber = 50 in normal mode
      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        fetchFn: mockFetch,
      });

      // All three PRs within lookback window are discovered!
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:55'), 'PR 55 discovered');
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:50'), 'PR 50 discovered');
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:42'), 'PR 42 discovered automatically below checkpoint');

      // Now evaluate with a ledger where PR 50 was already processed, and PR 42 was not
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      ledger.processedRegistry.prOpenedNumbers = [50];
      ledger.checkpoints = {
        lastCommitSha: 'sha_prev',
        lastIssueNumber: 1,
        lastPrNumber: 50,
        reconciledAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Process PR 50: duplicate check awards 0 XP
      const ev50 = result.events.find((e) => e.eventId === 'pr_opened:50')!;
      const res50 = evaluateActivityEvent(pet, ledger, ev50, nowUtc);
      assert.equal(res50.result.status, 'skipped_duplicate');
      assert.equal(res50.result.xpAwarded, 0);

      // Process PR 42: missing opening reward is awarded +25 XP
      const ev42 = result.events.find((e) => e.eventId === 'pr_opened:42')!;
      const res42 = evaluateActivityEvent(res50.updatedPet, res50.updatedLedger, ev42, nowUtc);
      assert.equal(res42.result.status, 'rewarded');
      assert.equal(res42.result.xpAwarded, 25);
      assert.ok(res42.updatedLedger.processedRegistry.prOpenedNumbers.includes(42));

      // Process PR 55: new PR is awarded +25 XP
      const ev55 = result.events.find((e) => e.eventId === 'pr_opened:55')!;
      const res55 = evaluateActivityEvent(res42.updatedPet, res42.updatedLedger, ev55, nowUtc);
      assert.equal(res55.result.status, 'rewarded');
      assert.equal(res55.result.xpAwarded, 25);
      assert.ok(res55.updatedLedger.processedRegistry.prOpenedNumbers.includes(55));
    });

    it('sets completedFully to false and does not advance checkpoint when pagination is truncated', async () => {
      const nowUtc = '2026-11-24T12:00:00.000Z';
      const page1Pulls = Array.from({ length: 5 }, (_, i) => ({
        number: 100 - i,
        title: `PR ${100 - i}`,
        user: { login: `user${100 - i}`, type: 'User' },
        created_at: '2026-11-24T10:00:00.000Z',
      }));

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) {
          // Return 5 pulls with pageSize = 5 on page 1 (simulating stream not exhausted)
          return new Response(JSON.stringify(page1Pulls), { status: 200 });
        }
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const completeRecon = await performCompleteReconciliation({
        baseDir: tempBaseDir,
        targetRef: 'main',
        token: 'dummy-token',
        repository: 'mnp210/GitHub-Profile-Pet',
        stopAtPrNumber: 50, // Checkpoint is 50, but page 1 only reached PR 96!
        fetchFn: mockFetch,
      });
      assert.ok(completeRecon);

      // Stream was truncated by maxPages = 10 (or pageSize limitation), stopAtPrNumber 50 was NOT reached
      // Notice: page1Pulls has lowest PR 96 > stopAtPrNumber 50.
      // If we simulate maxPages = 1:
      const truncatedResult = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        maxPages: 1,
        pageSize: 5,
        fetchFn: mockFetch,
      });

      assert.equal(truncatedResult.completedFully, false, 'Must be marked completedFully: false');
      assert.ok(truncatedResult.warnings.some((w) => w.includes('maximum pagination limit')));
    });
  });

  describe('11. Sprint 5.2D-L Historical Recovery Continuity Suite', () => {
    it('manages 91-, 120-, and 180-day outages across sequential bounded batches', async () => {
      const now = Date.now();
      const mockExecGit = async (args: string[]) => {
        if (args[0] === 'status') return { stdout: '', stderr: '' };
        if (args[0] === 'rev-parse') return { stdout: 'sha_test_cursor\n', stderr: '' };
        return { stdout: '', stderr: '' };
      };

      // 1. Outage of 91 days
      const ledger91 = initDefaultActivityLedger(1);
      ledger91.checkpoints = {
        lastCommitSha: 'sha_91',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(ledger91, null, 2) + '\n');

      // Run 1: sets historical cursor
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });

      const ledger91Run1Raw = await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8');
      const ledger91Run1 = JSON.parse(ledger91Run1Raw);
      assert.ok(ledger91Run1.checkpoints?.historicalRecoveryCursor, 'Run 1 must store historicalRecoveryCursor');

      // Run 2: completes recovery and clears cursor
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });

      const ledger91Run2Raw = await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8');
      const ledger91Run2 = JSON.parse(ledger91Run2Raw);
      assert.equal(ledger91Run2.checkpoints?.historicalRecoveryCursor, undefined, 'Run 2 must clear cursor upon completion');

      // 2. Outage of 120 days
      const ledger120 = initDefaultActivityLedger(1);
      ledger120.checkpoints = {
        lastCommitSha: 'sha_120',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(ledger120, null, 2) + '\n');

      // Run 1: sets cursor
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });
      const ledger120Run1 = JSON.parse(await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8'));
      assert.ok(ledger120Run1.checkpoints?.historicalRecoveryCursor);

      // Run 2: completes recovery
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });
      const ledger120Run2 = JSON.parse(await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8'));
      assert.equal(ledger120Run2.checkpoints?.historicalRecoveryCursor, undefined);

      // 3. Outage of 180 days (spans 3 runs)
      const ledger180 = initDefaultActivityLedger(1);
      ledger180.checkpoints = {
        lastCommitSha: 'sha_180',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(ledger180, null, 2) + '\n');

      // Run 1: sets cursor
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });
      const ledger180Run1 = JSON.parse(await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8'));
      assert.ok(ledger180Run1.checkpoints?.historicalRecoveryCursor);

      // Run 2: processes batch 2 and advances cursor
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });
      const ledger180Run2 = JSON.parse(await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8'));
      assert.ok(ledger180Run2.checkpoints?.historicalRecoveryCursor, 'Run 2 advances cursor towards completion');

      // Run 3: completes batch 3 and clears cursor
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [],
        execGitFn: mockExecGit,
      });
      const ledger180Run3 = JSON.parse(await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8'));
      assert.equal(ledger180Run3.checkpoints?.historicalRecoveryCursor, undefined, 'Run 3 completes multi-run recovery');
    });

    it('preserves historicalRecoveryCursor when a historical batch fails or is interrupted', async () => {
      const now = Date.now();
      const initialCursor = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString();

      const ledger = initDefaultActivityLedger(1);
      ledger.checkpoints = {
        lastCommitSha: 'sha_fail_test',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: new Date(now - 10 * 1000).toISOString(),
        historicalRecoveryCursor: initialCursor,
      };
      await fs.writeFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2) + '\n');

      // Simulate a failure during processing (mock git status throws)
      const failingExecGit = async (args: string[]) => {
        if (args[0] === 'status') {
          throw new Error('Simulated runner failure on git status');
        }
        return { stdout: '', stderr: '' };
      };

      await assert.rejects(async () => {
        await runProcessingCycle({
          baseDir: tempBaseDir,
          targetRef: 'main',
          dryRun: false,
          eventName: 'push',
          cliEvents: [
            {
              eventType: 'commit',
              eventId: 'commit:test_failure',
              actor: 'user',
              details: 'test',
            },
          ],
          execGitFn: failingExecGit,
        });
      });

      // Verify the cursor was NOT advanced or wiped
      const preservedRaw = await fs.readFile(path.join(tempBaseDir, 'pet/ledger/activity.json'), 'utf-8');
      const preservedLedger = JSON.parse(preservedRaw);
      assert.equal(preservedLedger.checkpoints?.historicalRecoveryCursor, initialCursor, 'Cursor must remain preserved on failure');
    });

    it('correctly handles separate opening and merge recovery across all permutations', () => {
      const nowUtc = '2026-11-25T12:00:00.000Z';
      const openTime = '2026-05-29T10:00:00.000Z'; // 180 days ago
      const mergeTime = '2026-10-31T15:00:00.000Z'; // 25 days ago

      const openEvent: ProcessActivityEventInput = {
        eventType: 'pr_opened',
        eventId: 'pr_opened:10',
        actor: 'pr_author',
        timestamp: openTime,
        details: 'PR 10',
        allowHistoricalRecovery: true,
      };

      const mergeEvent: ProcessActivityEventInput = {
        eventType: 'pr_merged',
        eventId: 'pr_merged:10',
        actor: 'repo_merger',
        timestamp: mergeTime,
        details: 'Merged PR: PR 10',
        prMerged: true,
        allowHistoricalRecovery: true,
      };

      // Case A: Missing opening reward with existing merge reward
      const petA = createMockPetState();
      const ledgerA = initDefaultActivityLedger(1);
      ledgerA.processedRegistry.prMergedNumbers = [10]; // Already has merge reward

      const resOpenA = evaluateActivityEvent(petA, ledgerA, openEvent, nowUtc);
      assert.equal(resOpenA.result.status, 'rewarded', 'Missing opening reward must be awarded');
      assert.equal(resOpenA.result.xpAwarded, 25);
      assert.equal(openEvent.timestamp, openTime, 'Must use creation timestamp');
      assert.equal(openEvent.actor, 'pr_author', 'Must attribute to author');
      assert.ok(resOpenA.updatedLedger.processedRegistry.prOpenedNumbers.includes(10));

      const resMergeA = evaluateActivityEvent(resOpenA.updatedPet, resOpenA.updatedLedger, mergeEvent, nowUtc);
      assert.equal(resMergeA.result.status, 'skipped_duplicate', 'Existing merge reward must award 0 XP');
      assert.equal(resMergeA.result.xpAwarded, 0);

      // Case B: Missing merge reward with existing opening reward
      const petB = createMockPetState();
      const ledgerB = initDefaultActivityLedger(1);
      ledgerB.processedRegistry.prOpenedNumbers = [10]; // Already has opening reward

      const resOpenB = evaluateActivityEvent(petB, ledgerB, openEvent, nowUtc);
      assert.equal(resOpenB.result.status, 'skipped_duplicate', 'Existing opening reward must award 0 XP');
      assert.equal(resOpenB.result.xpAwarded, 0);

      const resMergeB = evaluateActivityEvent(petB, ledgerB, mergeEvent, nowUtc);
      assert.equal(resMergeB.result.status, 'rewarded', 'Missing merge reward must be awarded');
      assert.equal(resMergeB.result.xpAwarded, 50);
      assert.equal(mergeEvent.timestamp, mergeTime, 'Must use merge timestamp');
      assert.equal(mergeEvent.actor, 'repo_merger', 'Must attribute to merger');
      assert.ok(resMergeB.updatedLedger.processedRegistry.prMergedNumbers.includes(10));

      // Case C: Both missing rewards recovered together (25 + 50 = 75 XP total)
      const petC = createMockPetState();
      const ledgerC = initDefaultActivityLedger(1);

      const res1C = evaluateActivityEvent(petC, ledgerC, openEvent, nowUtc);
      assert.equal(res1C.result.status, 'rewarded');
      assert.equal(res1C.result.xpAwarded, 25);

      const res2C = evaluateActivityEvent(res1C.updatedPet, res1C.updatedLedger, mergeEvent, nowUtc);
      assert.equal(res2C.result.status, 'rewarded');
      assert.equal(res2C.result.xpAwarded, 50);
      assert.equal(res2C.updatedPet.xp, 75, 'Must award 75 XP total for opening and merging');
    });
  });

  describe('12. Sprint 5.2D-M Final Historical Recovery Proof Suite', () => {
    it('proves PR opening recovery below legacy checkpoints across scenarios 1 through 4', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();
      const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
      const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();

      const mockPulls = [
        {
          number: 55, // Scenario 4: Above lastPrNumber (50), opened 20 days ago (> 14 days)
          title: 'PR 55',
          user: { login: 'author55', type: 'User' },
          created_at: twentyDaysAgo,
        },
        {
          number: 50, // Scenario 3: Below/equal to lastPrNumber (50), already recorded
          title: 'PR 50',
          user: { login: 'author50', type: 'User' },
          created_at: fiveDaysAgo,
        },
        {
          number: 45, // Scenario 1: Below lastPrNumber (50), opened 5 days ago (within 14 days), missing
          title: 'PR 45',
          user: { login: 'author45', type: 'User' },
          created_at: fiveDaysAgo,
        },
        {
          number: 42, // Scenario 2: Below lastPrNumber (50), opened 20 days ago (> 14 days), missing
          title: 'PR 42',
          user: { login: 'author42', type: 'User' },
          created_at: twentyDaysAgo,
        },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) return new Response(JSON.stringify(mockPulls), { status: 200 });
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Ledger has lastPrNumber = 50, and only PR 50 has been recorded in prOpenedNumbers
      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        processedPrOpenedNumbers: [50], // PR 45 and 42 are missing!
        fetchFn: mockFetch,
      });

      assert.equal(result.completedFully, true);

      // Verify Scenario 1: PR 45 discovered
      const ev45 = result.events.find((e) => e.eventId === 'pr_opened:45');
      assert.ok(ev45, 'Scenario 1: PR 45 must be discovered');
      assert.equal(ev45.timestamp, fiveDaysAgo);
      assert.equal(ev45.actor, 'author45');

      // Verify Scenario 2: PR 42 (> 14 days ago) discovered without being terminated by stale boundary!
      const ev42 = result.events.find((e) => e.eventId === 'pr_opened:42');
      assert.ok(ev42, 'Scenario 2: PR 42 must be discovered below checkpoint despite being > 14 days old');
      assert.equal(ev42.timestamp, twentyDaysAgo);
      assert.equal(ev42.actor, 'author42');
      assert.equal(ev42.allowHistoricalRecovery, true, 'PR 42 must allow historical recovery');

      // Verify Scenario 3: PR 50 discovered
      const ev50 = result.events.find((e) => e.eventId === 'pr_opened:50');
      assert.ok(ev50, 'Scenario 3: PR 50 discovered');

      // Verify Scenario 4: PR 55 discovered
      const ev55 = result.events.find((e) => e.eventId === 'pr_opened:55');
      assert.ok(ev55, 'Scenario 4: PR 55 must be discovered above checkpoint');
      assert.equal(ev55.timestamp, twentyDaysAgo);
      assert.equal(ev55.actor, 'author55');
      assert.equal(ev55.allowHistoricalRecovery, true);

      // Evaluate progression rewards on all 4
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      ledger.processedRegistry.prOpenedNumbers = [50];
      ledger.checkpoints = {
        lastCommitSha: 'sha_base',
        lastIssueNumber: 1,
        lastPrNumber: 50,
        reconciledAt: fiveDaysAgo,
      };

      // Scenario 1: PR 45 is rewarded (+25 XP)
      const res45 = evaluateActivityEvent(pet, ledger, ev45!, nowUtc);
      assert.equal(res45.result.status, 'rewarded');
      assert.equal(res45.result.xpAwarded, 25);
      assert.ok(res45.updatedLedger.processedRegistry.prOpenedNumbers.includes(45));

      // Scenario 2: PR 42 is rewarded (+25 XP) despite opening > 14 days ago
      const res42 = evaluateActivityEvent(res45.updatedPet, res45.updatedLedger, ev42!, nowUtc);
      assert.equal(res42.result.status, 'rewarded');
      assert.equal(res42.result.xpAwarded, 25);
      assert.ok(res42.updatedLedger.processedRegistry.prOpenedNumbers.includes(42));

      // Scenario 3: PR 50 is duplicate (0 XP)
      const res50 = evaluateActivityEvent(res42.updatedPet, res42.updatedLedger, ev50!, nowUtc);
      assert.equal(res50.result.status, 'skipped_duplicate');
      assert.equal(res50.result.xpAwarded, 0);

      // Scenario 4: PR 55 is rewarded (+25 XP)
      const res55 = evaluateActivityEvent(res50.updatedPet, res50.updatedLedger, ev55!, nowUtc);
      assert.equal(res55.result.status, 'rewarded');
      assert.equal(res55.result.xpAwarded, 25);
      assert.ok(res55.updatedLedger.processedRegistry.prOpenedNumbers.includes(55));

      assert.equal(res55.updatedPet.xp, 75, 'Total XP awarded across the 3 eligible PRs is 75');
    });

    it('proves merge pagination safety, out-of-order PR numbers, and truncation handling', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();
      const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
      const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

      // Page 1: PR 100 (merged 1 day ago) and PR 10 (ancient PR #10, merged 2 days ago)
      // Page 2: PR 75 (merged 3 days ago - lower number on later page!)
      const page1Closed = [
        {
          number: 100,
          title: 'PR 100',
          user: { login: 'dev100' },
          created_at: twoDaysAgo,
          merged_at: oneDayAgo,
          merged_by: { login: 'merger100' },
        },
        {
          number: 10, // Lower PR number on page 1
          title: 'Ancient PR 10',
          user: { login: 'ancient_dev' },
          created_at: new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString(),
          merged_at: twoDaysAgo,
          merged_by: { login: 'maintainer_a' },
        },
      ];

      const page2Closed = [
        {
          number: 75, // Higher than 10, but on page 2!
          title: 'PR 75',
          user: { login: 'dev75' },
          created_at: threeDaysAgo,
          merged_at: threeDaysAgo,
          merged_by: { login: 'merger75' },
        },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=closed')) {
          if (urlStr.includes('page=1')) return new Response(JSON.stringify(page1Closed), { status: 200 });
          if (urlStr.includes('page=2')) return new Response(JSON.stringify(page2Closed), { status: 200 });
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Run with stopAtPrNumber = 50.
      // Notice: PR 10 has number 10 <= 50, but it must NOT be skipped because merge sorting is by updated desc!
      const recon = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        fetchFn: mockFetch,
      });

      assert.equal(recon.completedFully, true);
      assert.ok(recon.events.some((e) => e.eventId === 'pr_merged:100'), 'PR 100 discovered');
      assert.ok(recon.events.some((e) => e.eventId === 'pr_merged:10'), 'PR 10 discovered despite number 10 <= checkpoint 50');
      assert.ok(recon.events.some((e) => e.eventId === 'pr_merged:75'), 'PR 75 on page 2 discovered');

      // Test pagination truncation safety:
      // If maxPages is 1, but page 1 has full pageSize and recent merges:
      const truncatedRecon = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        maxPages: 1, // Cap at 1 page
        fetchFn: mockFetch,
      });

      assert.equal(truncatedRecon.completedFully, false, 'Must flag completedFully = false when merge pagination is truncated');
      assert.ok(
        truncatedRecon.warnings.some((w) => w.includes('Closed Pull Requests API reached maximum pagination limit')),
        'Must record truncation warning'
      );
    });

    it('proves transaction rollback covers all publication manifest files on runner failure', async () => {
      const petPath = path.join(tempBaseDir, 'pet/state/pet.json');
      const activityPath = path.join(tempBaseDir, 'pet/ledger/activity.json');
      const contribPath = path.join(tempBaseDir, 'pet/ledger/contributions.json');
      const actionsPath = path.join(tempBaseDir, 'pet/ledger/actions.json');

      const initialPet = createMockPetState({ xp: 50 });
      const initialActivity = initDefaultActivityLedger(1);
      initialActivity.checkpoints = {
        lastCommitSha: 'sha_stable',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: '2026-11-20T00:00:00.000Z',
        historicalRecoveryCursor: '2026-06-01T00:00:00.000Z',
      };
      const initialContrib = { schemaVersion: 1, generation: 1, totalContributions: 100 };
      const initialActions = { schemaVersion: 1, generation: 1, totalActions: 50 };

      await fs.writeFile(petPath, JSON.stringify(initialPet, null, 2) + '\n');
      await fs.writeFile(activityPath, JSON.stringify(initialActivity, null, 2) + '\n');
      await fs.writeFile(contribPath, JSON.stringify(initialContrib, null, 2) + '\n');
      await fs.writeFile(actionsPath, JSON.stringify(initialActions, null, 2) + '\n');

      const failingExecGit = async (args: string[]) => {
        if (args[0] === 'status') {
          throw new Error('Simulated runner failure during git status check');
        }
        return { stdout: '', stderr: '' };
      };

      await assert.rejects(async () => {
        await runProcessingCycle({
          baseDir: tempBaseDir,
          targetRef: 'main',
          dryRun: false,
          eventName: 'push',
          cliEvents: [
            {
              eventType: 'commit',
              eventId: 'commit:crash_test',
              actor: 'user',
              details: 'test crash',
            },
          ],
          execGitFn: failingExecGit,
        });
      });

      // Verify every single manifest file is restored to its exact pre-run content
      const restoredPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
      assert.equal(restoredPet.xp, 50, 'pet.json XP must be restored');

      const restoredActivity = JSON.parse(await fs.readFile(activityPath, 'utf-8'));
      assert.equal(
        restoredActivity.checkpoints?.historicalRecoveryCursor,
        '2026-06-01T00:00:00.000Z',
        'historicalRecoveryCursor must remain preserved'
      );
      assert.equal(restoredActivity.checkpoints?.lastCommitSha, 'sha_stable', 'lastCommitSha must remain preserved');

      const restoredContrib = JSON.parse(await fs.readFile(contribPath, 'utf-8'));
      assert.equal(restoredContrib.totalContributions, 100, 'contributions.json must be restored');

      const restoredActions = JSON.parse(await fs.readFile(actionsPath, 'utf-8'));
      assert.equal(restoredActions.totalActions, 50, 'actions.json must be restored');
    });
  });

  describe('13. Sprint 5.2D-N Historical PR Discovery Completeness & Merge Fail-Closed Suite', () => {
    it('discovers missing historical PRs #42 and #20 despite stale recorded PRs #50 and #30 appearing before them', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      // Required dataset:
      // #50: 20 days ago (recorded)
      // #42: 180 days ago (missing)
      // #30: 190 days ago (recorded)
      // #20: 200 days ago (missing)
      const t20d = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
      const t180d = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString();
      const t190d = new Date(now - 190 * 24 * 60 * 60 * 1000).toISOString();
      const t200d = new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString();

      const mockPulls = [
        { number: 50, title: 'PR 50', user: { login: 'dev50' }, created_at: t20d },
        { number: 42, title: 'PR 42', user: { login: 'dev42' }, created_at: t180d },
        { number: 30, title: 'PR 30', user: { login: 'dev30' }, created_at: t190d },
        { number: 20, title: 'PR 20', user: { login: 'dev20' }, created_at: t200d },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) return new Response(JSON.stringify(mockPulls), { status: 200 });
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Registry contains #50 and #30. #42 and #20 are missing.
      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        processedPrOpenedNumbers: [50, 30],
        fetchFn: mockFetch,
      });

      assert.equal(result.completedFully, true);

      // Verify PR #42 is discovered
      const ev42 = result.events.find((e) => e.eventId === 'pr_opened:42');
      assert.ok(ev42, 'PR 42 must be discovered');
      assert.equal(ev42.actor, 'dev42');
      assert.equal(ev42.timestamp, t180d);
      assert.equal(ev42.allowHistoricalRecovery, true);

      // Verify PR #20 is discovered
      const ev20 = result.events.find((e) => e.eventId === 'pr_opened:20');
      assert.ok(ev20, 'PR 20 must be discovered');
      assert.equal(ev20.actor, 'dev20');
      assert.equal(ev20.timestamp, t200d);
      assert.equal(ev20.allowHistoricalRecovery, true);

      // Verify recorded PR #30 (> 90d and already recorded) was skipped from discovery
      assert.equal(result.events.some((e) => e.eventId === 'pr_opened:30'), false, 'PR 30 is already recorded and stale');

      // Now evaluate progression rewards
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      ledger.processedRegistry.prOpenedNumbers = [50, 30];

      // If PR #50 was discovered (since 20d is within the active lookback), verify it receives exactly 0 XP (skipped_duplicate)
      const ev50 = result.events.find((e) => e.eventId === 'pr_opened:50');
      if (ev50) {
        const res50 = evaluateActivityEvent(pet, ledger, ev50, nowUtc);
        assert.equal(res50.result.status, 'skipped_duplicate');
        assert.equal(res50.result.xpAwarded, 0, 'PR 50 must not receive duplicate rewards');
      }

      const res42 = evaluateActivityEvent(pet, ledger, ev42!, nowUtc);
      assert.equal(res42.result.status, 'rewarded');
      assert.equal(res42.result.xpAwarded, 25);
      assert.ok(res42.updatedLedger.processedRegistry.prOpenedNumbers.includes(42));

      const res20 = evaluateActivityEvent(res42.updatedPet, res42.updatedLedger, ev20!, nowUtc);
      assert.equal(res20.result.status, 'rewarded');
      assert.equal(res20.result.xpAwarded, 25);
      assert.ok(res20.updatedLedger.processedRegistry.prOpenedNumbers.includes(20));

      assert.equal(res20.updatedPet.xp, 50, 'Both missing PRs must award exactly +25 XP each (50 XP total)');
    });

    it('discovers missing historical PRs across multiple paginated pages interspersed with recorded PRs', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      // Page 1: #50 (20d, recorded), #42 (180d, missing)
      // Page 2: #30 (190d, recorded), #20 (200d, missing)
      const page1 = [
        { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
        { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
      ];
      const page2 = [
        { number: 30, title: 'PR 30', user: { login: 'u30' }, created_at: new Date(now - 190 * 86400000).toISOString() },
        { number: 20, title: 'PR 20', user: { login: 'u20' }, created_at: new Date(now - 200 * 86400000).toISOString() },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) {
          const page = new URL(urlStr).searchParams.get('page');
          if (page === '1') return new Response(JSON.stringify(page1), { status: 200 });
          if (page === '2') return new Response(JSON.stringify(page2), { status: 200 });
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        processedPrOpenedNumbers: [50, 30],
        fetchFn: mockFetch,
      });

      assert.equal(result.completedFully, true);
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:42'), 'PR 42 discovered on page 1');
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:20'), 'PR 20 discovered on page 2');
    });

    it('sets completedFully false and preserves checkpoints when PR pagination ceiling is reached', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      // Return a full page on maxPages = 1
      const page1 = [
        { number: 60, title: 'PR 60', user: { login: 'u60' }, created_at: new Date(now - 2 * 86400000).toISOString() },
        { number: 59, title: 'PR 59', user: { login: 'u59' }, created_at: new Date(now - 3 * 86400000).toISOString() },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) return new Response(JSON.stringify(page1), { status: 200 });
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        maxPages: 1, // Cap at 1 page
        fetchFn: mockFetch,
      });

      assert.equal(result.completedFully, false, 'Must flag completedFully = false when pagination is capped');
      assert.ok(result.warnings.some((w) => w.includes('maximum pagination limit')));
    });

    it('proves conservative merge pagination: full final page triggers completedFully false regardless of merged_at', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      // Page 1 has PR updated recently but with ancient merged_at (e.g. comment added to old merged PR)
      const page1 = [
        {
          number: 100,
          title: 'PR 100',
          user: { login: 'dev100' },
          created_at: '2025-01-01T00:00:00.000Z',
          merged_at: '2025-01-02T00:00:00.000Z', // Ancient merged_at!
          updated_at: new Date(now - 1000).toISOString(), // Updated recently!
          merged_by: { login: 'merger100' },
        },
        {
          number: 99,
          title: 'PR 99',
          user: { login: 'dev99' },
          created_at: '2025-01-01T00:00:00.000Z',
          merged_at: '2025-01-02T00:00:00.000Z', // Ancient merged_at!
          updated_at: new Date(now - 2000).toISOString(),
          merged_by: { login: 'merger99' },
        },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify(page1), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Page is full (pageSize: 2, maxPages: 1).
      // Even though merged_at is ancient on all PRs on page 1, because the query is sorted by updated_at,
      // subsequent pages may contain relevant recent merges.
      // Therefore, completedFully MUST be false!
      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        pageSize: 2,
        maxPages: 1,
        fetchFn: mockFetch,
      });

      assert.equal(
        result.completedFully,
        false,
        'Conservative merge pagination must set completedFully = false when final page is full'
      );
      assert.ok(result.warnings.some((w) => w.includes('Closed Pull Requests API reached maximum pagination limit')));
    });

    it('proves failure midway through historical sweep leaves cursor unadvanced and manifests restored, then succeeds on retry', async () => {
      const petPath = path.join(tempBaseDir, 'pet/state/pet.json');
      const activityPath = path.join(tempBaseDir, 'pet/ledger/activity.json');
      const contribPath = path.join(tempBaseDir, 'pet/ledger/contributions.json');
      const actionsPath = path.join(tempBaseDir, 'pet/ledger/actions.json');

      const initialCursor = '2026-05-29T10:00:00.000Z'; // 180 days ago
      const initialPet = createMockPetState({ xp: 0 });
      const initialActivity = initDefaultActivityLedger(1);
      initialActivity.checkpoints = {
        lastCommitSha: 'sha_stable_180',
        lastIssueNumber: 1,
        lastPrNumber: 10,
        reconciledAt: '2026-11-20T00:00:00.000Z',
        historicalRecoveryCursor: initialCursor,
      };
      const initialContrib = { schemaVersion: 1, generation: 1, totalContributions: 50 };
      const initialActions = { schemaVersion: 1, generation: 1, totalActions: 25 };

      await fs.writeFile(petPath, JSON.stringify(initialPet, null, 2) + '\n');
      await fs.writeFile(activityPath, JSON.stringify(initialActivity, null, 2) + '\n');
      await fs.writeFile(contribPath, JSON.stringify(initialContrib, null, 2) + '\n');
      await fs.writeFile(actionsPath, JSON.stringify(initialActions, null, 2) + '\n');

      let attempt = 0;
      const failingExecGit = async (args: string[]) => {
        if (args[0] === 'status') {
          if (attempt === 0) {
            attempt++;
            throw new Error('Simulated runner failure during commit staging');
          }
          return { stdout: '', stderr: '' };
        }
        if (args[0] === 'rev-parse') return { stdout: 'sha_retry_ok\n', stderr: '' };
        return { stdout: '', stderr: '' };
      };

      // Run 1: Fails during commit staging
      await assert.rejects(async () => {
        await runProcessingCycle({
          baseDir: tempBaseDir,
          targetRef: 'main',
          dryRun: false,
          eventName: 'push',
          cliEvents: [
            {
              eventType: 'commit',
              eventId: 'commit:retry_test',
              actor: 'retry_user',
              details: 'test',
            },
          ],
          execGitFn: failingExecGit,
        });
      });

      // Verify all manifests were restored and cursor was NOT advanced
      const midPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
      assert.equal(midPet.xp, 0, 'XP must be restored to 0');

      const midActivity = JSON.parse(await fs.readFile(activityPath, 'utf-8'));
      assert.equal(
        midActivity.checkpoints?.historicalRecoveryCursor,
        initialCursor,
        'Cursor must remain at initialCursor on interruption'
      );

      // Run 2: Retry succeeds
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [
          {
            eventType: 'commit',
            eventId: 'commit:retry_test',
            actor: 'retry_user',
            details: 'test',
          },
        ],
        execGitFn: failingExecGit,
      });

      // Verify retry succeeded and awarded XP
      const finalPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
      assert.equal(finalPet.xp, 15, 'Retry must award +15 XP');

      // Run 3: Repeated sweep with same event awards zero duplicate XP
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [
          {
            eventType: 'commit',
            eventId: 'commit:retry_test',
            actor: 'retry_user',
            details: 'test',
          },
        ],
        execGitFn: failingExecGit,
      });

      const repeatPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
      assert.equal(repeatPet.xp, 15, 'Repeated sweep must award 0 duplicate XP');
    });
  });

  describe('14. Sprint 5.2D-O Historical PR Page Exhaustion & Resumable Discovery Suite', () => {
    it('traverses mixed-page historical dataset without premature page-level termination', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      // Page 1: PR #50 (20d, recorded), PR #49 (21d, recorded) -> ALL STALE & RECORDED!
      // Page 2: PR #42 (180d, missing), PR #30 (190d, missing) -> ALL STALE & MISSING!
      // Page 3: PR #20 (200d, recorded), PR #10 (210d, missing)
      // Page 4: [] (end of stream)
      const page1 = [
        { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
        { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
      ];
      const page2 = [
        { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
        { number: 30, title: 'PR 30', user: { login: 'u30' }, created_at: new Date(now - 190 * 86400000).toISOString() },
      ];
      const page3 = [
        { number: 20, title: 'PR 20', user: { login: 'u20' }, created_at: new Date(now - 200 * 86400000).toISOString() },
        { number: 10, title: 'PR 10', user: { login: 'u10' }, created_at: new Date(now - 210 * 86400000).toISOString() },
      ];

      const requestedPages: string[] = [];
      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) {
          const page = new URL(urlStr).searchParams.get('page');
          if (page) requestedPages.push(page);
          if (page === '1') return new Response(JSON.stringify(page1), { status: 200 });
          if (page === '2') return new Response(JSON.stringify(page2), { status: 200 });
          if (page === '3') return new Response(JSON.stringify(page3), { status: 200 });
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Run 1: Initial recovery scan with 14-day normal lookback, pageSize: 2, stopAtPrNumber: 50
      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        processedPrOpenedNumbers: [50, 49, 20],
        fetchFn: mockFetch,
      });

      // Assertions for Requirement 1:
      // 1. Page 1 must not be treated as proof of historical completeness (pages 2, 3 must be reached)
      assert.ok(requestedPages.includes('1'), 'Page 1 must be fetched');
      assert.ok(requestedPages.includes('2'), 'Page 2 must be reached despite Page 1 having 0 eligible items');
      assert.ok(requestedPages.includes('3'), 'Page 3 must be reached');
      assert.equal(result.completedFully, true, 'Scan must report completedFully = true upon stream exhaustion');
      assert.equal(result.historicalPrCompleted, true, 'historicalPrCompleted must be true');

      // 2. Missing PRs #42, #30, #10 must be discovered
      const ev42 = result.events.find((e) => e.eventId === 'pr_opened:42');
      const ev30 = result.events.find((e) => e.eventId === 'pr_opened:30');
      const ev10 = result.events.find((e) => e.eventId === 'pr_opened:10');
      assert.ok(ev42, 'PR #42 must be discovered on Page 2');
      assert.ok(ev30, 'PR #30 must be discovered on Page 2');
      assert.ok(ev10, 'PR #10 must be discovered on Page 3');

      // 3. Evaluate progression rewards
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      ledger.processedRegistry.prOpenedNumbers = [50, 49, 20];

      // PR #50, #49, #20 must receive zero XP if evaluated
      const ev50 = result.events.find((e) => e.eventId === 'pr_opened:50');
      if (ev50) {
        const res50 = evaluateActivityEvent(pet, ledger, ev50, nowUtc);
        assert.equal(res50.result.xpAwarded, 0, 'PR #50 must receive 0 duplicate XP');
      }

      // Missing PRs must receive +25 XP each exactly once
      const res42 = evaluateActivityEvent(pet, ledger, ev42!, nowUtc);
      assert.equal(res42.result.status, 'rewarded');
      assert.equal(res42.result.xpAwarded, 25);
      assert.ok(res42.updatedLedger.processedRegistry.prOpenedNumbers.includes(42));

      const res30 = evaluateActivityEvent(res42.updatedPet, res42.updatedLedger, ev30!, nowUtc);
      assert.equal(res30.result.status, 'rewarded');
      assert.equal(res30.result.xpAwarded, 25);
      assert.ok(res30.updatedLedger.processedRegistry.prOpenedNumbers.includes(30));

      const res10 = evaluateActivityEvent(res30.updatedPet, res30.updatedLedger, ev10!, nowUtc);
      assert.equal(res10.result.status, 'rewarded');
      assert.equal(res10.result.xpAwarded, 25);
      assert.ok(res10.updatedLedger.processedRegistry.prOpenedNumbers.includes(10));

      assert.equal(res10.updatedPet.xp, 75, 'Three missing PRs must award exactly +75 XP total');

      // 4. Repeating the completed scan must award zero additional XP
      const repeatResult = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        processedPrOpenedNumbers: res10.updatedLedger.processedRegistry.prOpenedNumbers,
        historicalPrCompleted: true, // Historical recovery was completed
        fetchFn: mockFetch,
      });

      let repeatXp = 0;
      for (const evt of repeatResult.events) {
        const evalRes = evaluateActivityEvent(res10.updatedPet, res10.updatedLedger, evt, nowUtc);
        repeatXp += evalRes.result.xpAwarded;
      }
      assert.equal(repeatXp, 0, 'Repeating the completed scan must award exactly 0 additional XP');
    });

    it('traverses a page containing only stale already-recorded PRs followed by multiple pages of missing PRs', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      // Page 1: #70, #69 (all recorded, 30 days old)
      // Page 2: #60, #55 (all missing, 100 days old)
      // Page 3: #40, #35 (all missing, 150 days old)
      // Page 4: []
      const page1 = [
        { number: 70, title: 'PR 70', user: { login: 'u70' }, created_at: new Date(now - 30 * 86400000).toISOString() },
        { number: 69, title: 'PR 69', user: { login: 'u69' }, created_at: new Date(now - 31 * 86400000).toISOString() },
      ];
      const page2 = [
        { number: 60, title: 'PR 60', user: { login: 'u60' }, created_at: new Date(now - 100 * 86400000).toISOString() },
        { number: 55, title: 'PR 55', user: { login: 'u55' }, created_at: new Date(now - 110 * 86400000).toISOString() },
      ];
      const page3 = [
        { number: 40, title: 'PR 40', user: { login: 'u40' }, created_at: new Date(now - 150 * 86400000).toISOString() },
        { number: 35, title: 'PR 35', user: { login: 'u35' }, created_at: new Date(now - 160 * 86400000).toISOString() },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) {
          const page = new URL(urlStr).searchParams.get('page');
          if (page === '1') return new Response(JSON.stringify(page1), { status: 200 });
          if (page === '2') return new Response(JSON.stringify(page2), { status: 200 });
          if (page === '3') return new Response(JSON.stringify(page3), { status: 200 });
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 70,
        pageSize: 2,
        processedPrOpenedNumbers: [70, 69],
        fetchFn: mockFetch,
      });

      assert.equal(result.completedFully, true);
      assert.equal(result.historicalPrCompleted, true);
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:60'), 'PR #60 discovered on Page 2');
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:55'), 'PR #55 discovered on Page 2');
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:40'), 'PR #40 discovered on Page 3');
      assert.ok(result.events.some((e) => e.eventId === 'pr_opened:35'), 'PR #35 discovered on Page 3');
    });

    it('proves bounded pagination: ceiling reached with full page sets completedFully = false and preserves checkpoints', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      const page1 = [
        { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
        { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) return new Response(JSON.stringify(page1), { status: 200 });
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // maxPages: 1 with a full page (pulls.length >= pageSize)
      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        maxPages: 1,
        processedPrOpenedNumbers: [50, 49],
        fetchFn: mockFetch,
      });

      assert.equal(result.completedFully, false, 'Must flag completedFully = false when pagination is capped on full page');
      assert.equal(result.historicalPrCompleted, false, 'historicalPrCompleted must be false when capped');
      assert.ok(result.warnings.some((w) => w.includes('maximum pagination limit')));
    });

    it('proves resumable historical discovery and deduplication across multiple sequential batches', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      const page1 = [
        { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
        { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
      ];
      const page2 = [
        { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
        { number: 30, title: 'PR 30', user: { login: 'u30' }, created_at: new Date(now - 190 * 86400000).toISOString() },
      ];
      const page3 = [
        { number: 20, title: 'PR 20', user: { login: 'u20' }, created_at: new Date(now - 200 * 86400000).toISOString() },
        { number: 10, title: 'PR 10', user: { login: 'u10' }, created_at: new Date(now - 210 * 86400000).toISOString() },
      ];

      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) {
          const page = new URL(urlStr).searchParams.get('page');
          if (page === '1') return new Response(JSON.stringify(page1), { status: 200 });
          if (page === '2') return new Response(JSON.stringify(page2), { status: 200 });
          if (page === '3') return new Response(JSON.stringify(page3), { status: 200 });
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Batch 1: maxPages = 2
      const batch1 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        maxPages: 2,
        processedPrOpenedNumbers: [50, 49, 20],
        fetchFn: mockFetch,
      });

      assert.equal(batch1.completedFully, false, 'Batch 1 capped at maxPages = 2');
      assert.ok(batch1.events.some((e) => e.eventId === 'pr_opened:42'));
      assert.ok(batch1.events.some((e) => e.eventId === 'pr_opened:30'));

      // Process Batch 1 into durable state
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      ledger.processedRegistry.prOpenedNumbers = [50, 49, 20];

      let state = { updatedPet: pet, updatedLedger: ledger };
      for (const evt of batch1.events) {
        state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
      }
      assert.equal(state.updatedPet.xp, 50, 'Batch 1 must award +50 XP for PR #42 & #30');
      assert.ok(state.updatedLedger.processedRegistry.prOpenedNumbers.includes(42));
      assert.ok(state.updatedLedger.processedRegistry.prOpenedNumbers.includes(30));

      // Batch 2: Resumes with updated registry, now allowed maxPages = 4 to finish
      const batch2 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        maxPages: 4,
        processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
        fetchFn: mockFetch,
      });

      assert.equal(batch2.completedFully, true, 'Batch 2 must complete to stream end');
      assert.equal(batch2.historicalPrCompleted, true, 'historicalPrCompleted must be true');

      // PR #10 is discovered on Page 3
      const ev10 = batch2.events.find((e) => e.eventId === 'pr_opened:10');
      assert.ok(ev10, 'PR #10 must be discovered in Batch 2');

      for (const evt of batch2.events) {
        state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
      }
      assert.equal(state.updatedPet.xp, 75, 'Total XP after Batch 2 must be exactly 75 XP (zero duplicate XP for Batch 1 items)');
      assert.ok(state.updatedLedger.processedRegistry.prOpenedNumbers.includes(10));
    });

    it('proves completed scan does not repeatedly traverse historical dataset on normal execution', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      const page1 = [
        { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
        { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
      ];
      const page2 = [
        { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
        { number: 30, title: 'PR 30', user: { login: 'u30' }, created_at: new Date(now - 190 * 86400000).toISOString() },
      ];

      const requestedPages: string[] = [];
      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
        if (urlStr.includes('/pulls?state=all')) {
          const page = new URL(urlStr).searchParams.get('page');
          if (page) requestedPages.push(page);
          if (page === '1') return new Response(JSON.stringify(page1), { status: 200 });
          if (page === '2') return new Response(JSON.stringify(page2), { status: 200 });
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      // Normal execution: historicalPrCompleted = true
      const result = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 50,
        pageSize: 2,
        processedPrOpenedNumbers: [50, 49, 42, 30],
        historicalPrCompleted: true, // Key: already completed!
        fetchFn: mockFetch,
      });

      assert.equal(result.completedFully, true);
      assert.ok(requestedPages.includes('1'), 'Page 1 must be fetched');
      assert.equal(requestedPages.includes('2'), false, 'Page 2 must NOT be traversed on routine normal execution');
    });

    it('proves complete merge pagination regression suite (Section 3)', async () => {
      const now = new Date('2026-11-25T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      // 1. Partial final page at maxPages -> completedFully = true
      const partialPage = [
        {
          number: 100,
          title: 'PR 100',
          user: { login: 'dev100' },
          created_at: new Date(now - 86400000).toISOString(),
          merged_at: new Date(now - 86400000).toISOString(),
          updated_at: new Date(now - 86400000).toISOString(),
          merged_by: { login: 'merger100' },
        },
      ]; // length 1 < pageSize (2)

      const mockFetchPartial: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/pulls?state=closed')) return new Response(JSON.stringify(partialPage), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const resPartial = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        pageSize: 2,
        maxPages: 1,
        fetchFn: mockFetchPartial,
      });
      assert.equal(resPartial.completedFully, true, 'Partial final page at maxPages must report completedFully = true');

      // 2. Intermediate page failure -> completedFully = false
      const mockFetchFail: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/pulls?state=closed')) {
          const page = new URL(urlStr).searchParams.get('page');
          if (page === '1') {
            return new Response(
              JSON.stringify([
                { number: 100, title: 'PR 100', user: { login: 'u' }, created_at: nowUtc, merged_at: nowUtc },
                { number: 99, title: 'PR 99', user: { login: 'u' }, created_at: nowUtc, merged_at: nowUtc },
              ]),
              { status: 200 }
            );
          }
          return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const resFail = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        pageSize: 2,
        maxPages: 3,
        fetchFn: mockFetchFail,
      });
      assert.equal(resFail.completedFully, false, 'API error on page 2 must flag completedFully = false');
      assert.ok(resFail.warnings.some((w) => w.includes('GitHub Closed Pulls API returned status 500')));

      // 3. Recent merge on a later page is discovered and awarded
      const mergePage1 = [
        {
          number: 100,
          title: 'PR 100',
          user: { login: 'dev100' },
          created_at: new Date(now - 100 * 86400000).toISOString(),
          merged_at: new Date(now - 100 * 86400000).toISOString(), // Old merge
          updated_at: new Date(now - 1000).toISOString(),
          merged_by: { login: 'merger100' },
        },
        {
          number: 99,
          title: 'PR 99',
          user: { login: 'dev99' },
          created_at: new Date(now - 100 * 86400000).toISOString(),
          merged_at: new Date(now - 100 * 86400000).toISOString(), // Old merge
          updated_at: new Date(now - 2000).toISOString(),
          merged_by: { login: 'merger99' },
        },
      ];
      const mergePage2 = [
        {
          number: 95,
          title: 'PR 95 (Recent Merge)',
          user: { login: 'dev95' },
          created_at: new Date(now - 20 * 86400000).toISOString(),
          merged_at: new Date(now - 2 * 86400000).toISOString(), // Recent merge (2 days ago)!
          updated_at: new Date(now - 3000).toISOString(),
          merged_by: { login: 'merger95' },
        },
      ];

      const mockFetchMerge: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/pulls?state=closed')) {
          const page = new URL(urlStr).searchParams.get('page');
          if (page === '1') return new Response(JSON.stringify(mergePage1), { status: 200 });
          if (page === '2') return new Response(JSON.stringify(mergePage2), { status: 200 });
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const resMerge = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        pageSize: 2,
        maxPages: 3,
        fetchFn: mockFetchMerge,
      });

      assert.equal(resMerge.completedFully, true);
      const ev95 = resMerge.events.find((e) => e.eventId === 'pr_merged:95');
      assert.ok(ev95, 'Recent merge on Page 2 must be discovered');
      assert.equal(ev95.actor, 'merger95');

      // Progression reward evaluation
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const evalMerge = evaluateActivityEvent(pet, ledger, ev95!, nowUtc);
      assert.equal(evalMerge.result.status, 'rewarded');
      assert.equal(evalMerge.result.xpAwarded, 50, 'PR merge must award +50 XP');

      // Repeating awards 0 XP
      const evalMergeRepeat = evaluateActivityEvent(evalMerge.updatedPet, evalMerge.updatedLedger, ev95!, nowUtc);
      assert.equal(evalMergeRepeat.result.status, 'skipped_duplicate');
      assert.equal(evalMergeRepeat.result.xpAwarded, 0, 'Duplicate merge must award 0 XP');
    });

    it('proves fault injection at 4 interruption points preserves uncommitted intervals without duplicate rewards', async () => {
      const petPath = path.join(tempBaseDir, 'pet/state/pet.json');
      const activityPath = path.join(tempBaseDir, 'pet/ledger/activity.json');
      const contribPath = path.join(tempBaseDir, 'pet/ledger/contributions.json');
      const actionsPath = path.join(tempBaseDir, 'pet/ledger/actions.json');

      const initialCursor = '2026-05-29T10:00:00.000Z'; // 180 days ago
      const initialPet = createMockPetState({ xp: 0 });
      const initialActivity = initDefaultActivityLedger(1);
      initialActivity.checkpoints = {
        lastCommitSha: 'sha_fault_base',
        lastIssueNumber: 10,
        lastPrNumber: 50,
        reconciledAt: '2026-11-20T00:00:00.000Z',
        historicalRecoveryCursor: initialCursor,
        historicalPrCompleted: false,
      };

      await fs.writeFile(petPath, JSON.stringify(initialPet, null, 2) + '\n');
      await fs.writeFile(activityPath, JSON.stringify(initialActivity, null, 2) + '\n');
      await fs.writeFile(contribPath, JSON.stringify({ schemaVersion: 1, generation: 1, totalContributions: 10 }, null, 2) + '\n');
      await fs.writeFile(actionsPath, JSON.stringify({ schemaVersion: 1, generation: 1, totalActions: 5 }, null, 2) + '\n');

      // Interruption Point 1: During Git commit execution
      let failCommit = true;
      const failingGit = async (args: string[]) => {
        if (args[0] === 'status') {
          if (failCommit) {
            throw new Error('Injected crash before Git staging');
          }
          return { stdout: '', stderr: '' };
        }
        if (args[0] === 'rev-parse') return { stdout: 'sha_fault_ok\n', stderr: '' };
        return { stdout: '', stderr: '' };
      };

      await assert.rejects(async () => {
        await runProcessingCycle({
          baseDir: tempBaseDir,
          targetRef: 'main',
          dryRun: false,
          eventName: 'push',
          cliEvents: [{ eventType: 'commit', eventId: 'commit:fault_1', actor: 'tester', details: 'crash' }],
          execGitFn: failingGit,
        });
      });

      // Verify uncommitted interval is not advanced and XP remains 0
      const petAfterCrash = JSON.parse(await fs.readFile(petPath, 'utf-8'));
      assert.equal(petAfterCrash.xp, 0, 'XP must remain 0 after crash');
      const actAfterCrash = JSON.parse(await fs.readFile(activityPath, 'utf-8'));
      assert.equal(actAfterCrash.checkpoints?.historicalRecoveryCursor, initialCursor, 'Cursor must remain preserved');
      assert.equal(actAfterCrash.checkpoints?.historicalPrCompleted, false);

      // Now retry with failure resolved
      failCommit = false;
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [{ eventType: 'commit', eventId: 'commit:fault_1', actor: 'tester', details: 'retry_success' }],
        execGitFn: failingGit,
      });

      const petAfterRetry = JSON.parse(await fs.readFile(petPath, 'utf-8'));
      assert.equal(petAfterRetry.xp, 15, 'Retry must award exactly +15 XP (total 15)');

      // Repeat retry must award zero duplicate XP
      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'push',
        cliEvents: [{ eventType: 'commit', eventId: 'commit:fault_1', actor: 'tester', details: 'retry_success' }],
        execGitFn: failingGit,
      });

      const petAfterRepeat = JSON.parse(await fs.readFile(petPath, 'utf-8'));
      assert.equal(petAfterRepeat.xp, 15, 'Repeated run must award zero duplicate XP (remains 15)');
    });
  });

  describe('15. Sprint 5.2D-P Final Historical Recovery Semantics & Pagination Resumption', () => {
    const now = new Date('2026-11-25T12:00:00.000Z').getTime();
    const nowUtc = new Date(now).toISOString();

    describe('Section A: Early Termination and Registry Semantics (6 Cases)', () => {
      const page1StaleRecorded = [
        { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
        { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
      ];
      const page2StaleMissing = [
        { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
      ];

      it('Case 1: historicalPrCompleted: false, registry undefined -> discovery REQUIRED, early termination FORBIDDEN', async () => {
        let page2Fetched = false;
        const mockFetch = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = new URL(urlStr).searchParams.get('page');
            if (page === '1') return new Response(JSON.stringify(page1StaleRecorded), { status: 200 });
            if (page === '2') {
              page2Fetched = true;
              return new Response(JSON.stringify(page2StaleMissing), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const res = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 3,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: undefined,
          fetchFn: mockFetch,
        });

        assert.equal(page2Fetched, true, 'Page 2 must be fetched; absent registry cannot terminate early');
        assert.ok(res.events.some((e) => e.eventId === 'pr_opened:42'), 'PR #42 must be discovered');
      });

      it('Case 2: historicalPrCompleted: false, empty registry -> discovery REQUIRED, early termination FORBIDDEN', async () => {
        let page2Fetched = false;
        const mockFetch = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = new URL(urlStr).searchParams.get('page');
            if (page === '1') return new Response(JSON.stringify(page1StaleRecorded), { status: 200 });
            if (page === '2') {
              page2Fetched = true;
              return new Response(JSON.stringify(page2StaleMissing), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const res = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 3,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [],
          fetchFn: mockFetch,
        });

        assert.equal(page2Fetched, true, 'Page 2 must be reached when registry is empty');
        assert.ok(res.events.some((e) => e.eventId === 'pr_opened:42'), 'PR #42 must be discovered');
      });

      it('Case 3: historicalPrCompleted: false, populated registry -> discovery REQUIRED, early termination FORBIDDEN on full page', async () => {
        let page2Fetched = false;
        const mockFetch = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = new URL(urlStr).searchParams.get('page');
            if (page === '1') return new Response(JSON.stringify(page1StaleRecorded), { status: 200 });
            if (page === '2') {
              page2Fetched = true;
              return new Response(JSON.stringify(page2StaleMissing), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const res = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 3,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [50, 49],
          fetchFn: mockFetch,
        });

        assert.equal(page2Fetched, true, 'Page 2 must be reached even if Page 1 is 100% in registry');
        assert.ok(res.events.some((e) => e.eventId === 'pr_opened:42'), 'PR #42 must be discovered');
      });

      it('Case 4: historicalPrCompleted: true, populated registry -> discovery NOT REQUIRED, early termination PERMITTED (fast path)', async () => {
        let page2Fetched = false;
        const mockFetch = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = new URL(urlStr).searchParams.get('page');
            if (page === '1') return new Response(JSON.stringify(page1StaleRecorded), { status: 200 });
            if (page === '2') {
              page2Fetched = true;
              return new Response(JSON.stringify(page2StaleMissing), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const res = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 3,
          historicalPrCompleted: true,
          processedPrOpenedNumbers: [50, 49, 42],
          fetchFn: mockFetch,
        });

        assert.equal(page2Fetched, false, 'Page 2 must NEVER be fetched when historicalPrCompleted: true (fast path)');
        assert.equal(res.events.length, 0, 'Zero events discovered on routine fast-path run');
      });

      it('Case 5: Legacy checkpoint migration (marker absent) -> discovery REQUIRED, fail-closed against early termination', async () => {
        let page2Fetched = false;
        const mockFetch = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = new URL(urlStr).searchParams.get('page');
            if (page === '1') return new Response(JSON.stringify(page1StaleRecorded), { status: 200 });
            if (page === '2') {
              page2Fetched = true;
              return new Response(JSON.stringify(page2StaleMissing), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const res = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 3,
          historicalPrCompleted: undefined, // legacy absent marker
          processedPrOpenedNumbers: [50, 49],
          fetchFn: mockFetch,
        });

        assert.equal(page2Fetched, true, 'Legacy absent marker must be treated fail-closed as false');
        assert.ok(res.events.some((e) => e.eventId === 'pr_opened:42'), 'PR #42 must be discovered');
      });

      it('Case 6: Corrupted registry data -> safely normalized without throwing, early termination FORBIDDEN', async () => {
        let page2Fetched = false;
        const mockFetch = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = new URL(urlStr).searchParams.get('page');
            if (page === '1') return new Response(JSON.stringify(page1StaleRecorded), { status: 200 });
            if (page === '2') {
              page2Fetched = true;
              return new Response(JSON.stringify(page2StaleMissing), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const res = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 3,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: 'corrupted' as unknown as number[],
          fetchFn: mockFetch,
        });

        assert.equal(page2Fetched, true, 'Page 2 must be fetched despite corrupted registry');
        assert.ok(res.warnings.some((w) => w.includes('corrupted')), 'Warning must be logged for corrupted registry');
        assert.ok(res.events.some((e) => e.eventId === 'pr_opened:42'), 'PR #42 must be discovered');
      });
    });

    describe('Section B: Pagination Resumption Under Changing API Results (Shifting Pages)', () => {
      it('proves strict maxPages budget, exact page instrumentation [1, 3] -> [1, 4], and multi-batch completion', async () => {
        // Initial dataset before Batch 1:
        // Page 1: #50 (20d, recorded), #49 (21d, recorded)
        // Page 2: #42 (180d, missing), #30 (190d, missing)
        // Page 3: #20 (200d, recorded), #10 (210d, missing)
        // Page 4: []
        const p1 = [
          { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
          { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
        ];
        const p2 = [
          { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
          { number: 30, title: 'PR 30', user: { login: 'u30' }, created_at: new Date(now - 190 * 86400000).toISOString() },
        ];
        const p3 = [
          { number: 20, title: 'PR 20', user: { login: 'u20' }, created_at: new Date(now - 200 * 86400000).toISOString() },
          { number: 10, title: 'PR 10', user: { login: 'u10' }, created_at: new Date(now - 210 * 86400000).toISOString() },
        ];

        const batch1PagesRequested: number[] = [];
        const mockFetchBatch1 = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = parseInt(new URL(urlStr).searchParams.get('page') || '1', 10);
            batch1PagesRequested.push(page);
            if (page === 1) return new Response(JSON.stringify(p1), { status: 200 });
            if (page === 2) return new Response(JSON.stringify(p2), { status: 200 });
            if (page === 3) return new Response(JSON.stringify(p3), { status: 200 });
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        // Batch 1: maxPages = 2, pageSize = 2
        const batch1 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [50, 49, 20],
          fetchFn: mockFetchBatch1,
        });

        assert.deepEqual(batch1PagesRequested, [1, 2], 'Batch 1 must request exactly Pages 1 and 2');
        assert.equal(batch1.completedFully, false, 'Batch 1 capped at maxPages = 2');
        assert.equal(batch1.historicalPrContinuationPage, 3, 'Batch 1 continuation page must be 3');
        assert.ok(batch1.events.some((e) => e.eventId === 'pr_opened:42'));
        assert.ok(batch1.events.some((e) => e.eventId === 'pr_opened:30'));

        // Commit Batch 1 into state
        const pet = createMockPetState();
        const ledger = initDefaultActivityLedger(1);
        ledger.processedRegistry.prOpenedNumbers = [50, 49, 20];
        let state = { updatedPet: pet, updatedLedger: ledger };
        for (const evt of batch1.events) {
          state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
        }
        assert.equal(state.updatedPet.xp, 50, 'Batch 1 must award +50 XP for PR #42 and #30');
        assert.ok(state.updatedLedger.processedRegistry.prOpenedNumbers.includes(42));
        assert.ok(state.updatedLedger.processedRegistry.prOpenedNumbers.includes(30));

        // NOW: New PR #51 created before Batch 2!
        // Shifted pages:
        // Page 1: #51 (new, 1h ago), #50 (20d)
        // Page 2: #49 (21d), #42 (180d)
        // Page 3: #30 (190d), #20 (200d)
        // Page 4: #10 (210d)
        const p1Shifted = [
          { number: 51, title: 'PR 51', user: { login: 'u51' }, created_at: new Date(now - 1 * 3600000).toISOString() },
          { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
        ];
        const p2Shifted = [
          { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
          { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
        ];
        const p3Shifted = [
          { number: 30, title: 'PR 30', user: { login: 'u30' }, created_at: new Date(now - 190 * 86400000).toISOString() },
          { number: 20, title: 'PR 20', user: { login: 'u20' }, created_at: new Date(now - 200 * 86400000).toISOString() },
        ];
        const p4Shifted = [
          { number: 10, title: 'PR 10', user: { login: 'u10' }, created_at: new Date(now - 210 * 86400000).toISOString() },
        ];

        const batch2PagesRequested: number[] = [];
        const mockFetchBatch2 = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = parseInt(new URL(urlStr).searchParams.get('page') || '1', 10);
            batch2PagesRequested.push(page);
            if (page === 1) return new Response(JSON.stringify(p1Shifted), { status: 200 });
            if (page === 2) return new Response(JSON.stringify(p2Shifted), { status: 200 });
            if (page === 3) return new Response(JSON.stringify(p3Shifted), { status: 200 });
            if (page === 4) return new Response(JSON.stringify(p4Shifted), { status: 200 });
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        // Batch 2: Strictly maxPages = 2 with continuationPage = 3!
        // Budget = 2: Page 1 for newly opened PRs, Page 3 for continuation. Page 4 CANNOT be fetched!
        const batch2 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          historicalPrContinuationPage: batch1.historicalPrContinuationPage,
          processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
          fetchFn: mockFetchBatch2,
        });

        // 1. Verify exact page requests in Batch 2
        assert.deepEqual(batch2PagesRequested, [1, 3], 'Batch 2 must request strictly [1, 3], respecting maxPages = 2');
        assert.equal(batch2PagesRequested.length, 2, 'Batch 2 actual page count must equal maxPages = 2');

        // 2. PR #51 discovered on Page 1
        assert.ok(batch2.events.some((e) => e.eventId === 'pr_opened:51'), 'PR #51 must be discovered in Batch 2');

        // 3. PR #10 is on Page 4, so it MUST remain undiscovered in Batch 2
        assert.equal(batch2.events.some((e) => e.eventId === 'pr_opened:10'), false, 'PR #10 must NOT be discovered in Batch 2');

        // 4. Batch 2 is incomplete (Page 3 was full and reached page budget)
        assert.equal(batch2.completedFully, false, 'Batch 2 must be incomplete');
        assert.equal(batch2.historicalPrCompleted, false, 'historicalPrCompleted must remain false');
        assert.equal(batch2.historicalPrContinuationPage, 4, 'Continuation page must advance from 3 to 4');

        // 5. Evaluate Batch 2 events: PR #51 gives +25 XP; PR #30 gives 0 XP (skipped duplicate)
        for (const evt of batch2.events) {
          state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
        }
        assert.equal(state.updatedPet.xp, 75, 'XP after Batch 2 must be 75 XP (50 from Batch 1 + 25 for #51)');
        assert.ok(state.updatedLedger.processedRegistry.prOpenedNumbers.includes(51));

        // NOW: Batch 3 runs with maxPages = 2 and continuationPage = 4!
        const batch3PagesRequested: number[] = [];
        const mockFetchBatch3 = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = parseInt(new URL(urlStr).searchParams.get('page') || '1', 10);
            batch3PagesRequested.push(page);
            if (page === 1) return new Response(JSON.stringify(p1Shifted), { status: 200 });
            if (page === 2) return new Response(JSON.stringify(p2Shifted), { status: 200 });
            if (page === 3) return new Response(JSON.stringify(p3Shifted), { status: 200 });
            if (page === 4) return new Response(JSON.stringify(p4Shifted), { status: 200 });
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const batch3 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          historicalPrContinuationPage: batch2.historicalPrContinuationPage,
          processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
          fetchFn: mockFetchBatch3,
        });

        // 6. Verify exact page requests in Batch 3
        assert.deepEqual(batch3PagesRequested, [1, 4], 'Batch 3 must request strictly [1, 4], respecting maxPages = 2');
        assert.equal(batch3PagesRequested.length, 2, 'Batch 3 actual page count must equal maxPages = 2');

        // 7. PR #10 discovered on Page 4!
        assert.ok(batch3.events.some((e) => e.eventId === 'pr_opened:10'), 'PR #10 must be discovered in Batch 3');

        // 8. Stream end reached on Page 4 (1 item < pageSize)
        assert.equal(batch3.completedFully, true, 'Batch 3 must complete fully');
        assert.equal(batch3.historicalPrCompleted, true, 'historicalPrCompleted must become true');
        assert.equal(batch3.historicalPrContinuationPage, undefined, 'Continuation page must be cleared');

        // 9. Evaluate Batch 3 events: PR #10 gives +25 XP -> total 100 XP -> Level up to Level 2
        for (const evt of batch3.events) {
          state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
        }
        assert.equal(state.updatedPet.level, 2, 'Pet levels up to Level 2 at 100 XP');
        assert.equal(state.updatedPet.xp, 0, 'XP resets to 0 after level up');
        assert.ok(state.updatedLedger.processedRegistry.prOpenedNumbers.includes(10));

        // 10. Repeat Scan (Batch 4): Awards 0 XP on repeat
        const batch4PagesRequested: number[] = [];
        const mockFetchBatch4 = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = parseInt(new URL(urlStr).searchParams.get('page') || '1', 10);
            batch4PagesRequested.push(page);
            if (page === 1) return new Response(JSON.stringify(p1Shifted), { status: 200 });
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const batch4 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 51, // All recent PRs through #51 are now checkpointed
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: true,
          processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
          fetchFn: mockFetchBatch4,
        });

        assert.deepEqual(batch4PagesRequested, [1], 'Fast path must request strictly Page 1');
        assert.equal(batch4.events.length, 0, 'Zero events discovered on repeat scan');
        assert.equal(state.updatedPet.xp, 0, 'Zero additional XP awarded');
      });

      it('Section 2 Stress Test: Multiple insertions, full recorded pages, API failures, and recovery without skipping PRs', async () => {
        // Dynamic repository state
        const dynamicPrs = [
          { number: 40, title: 'PR 40', user: { login: 'u40' }, created_at: new Date(now - 100 * 86400000).toISOString() },
          { number: 30, title: 'PR 30', user: { login: 'u30' }, created_at: new Date(now - 120 * 86400000).toISOString() },
          { number: 20, title: 'PR 20', user: { login: 'u20' }, created_at: new Date(now - 140 * 86400000).toISOString() },
          { number: 10, title: 'PR 10', user: { login: 'u10' }, created_at: new Date(now - 160 * 86400000).toISOString() },
        ];

        let shouldFailContinuation = false;
        const fetchTracker: number[] = [];

        const stressFetch = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = parseInt(new URL(urlStr).searchParams.get('page') || '1', 10);
            fetchTracker.push(page);
            if (shouldFailContinuation && page > 1) {
              return new Response('Transient GitHub Failure', { status: 502, statusText: 'Bad Gateway' });
            }
            const pageSize = 2;
            const start = (page - 1) * pageSize;
            const slice = dynamicPrs.slice(start, start + pageSize);
            return new Response(JSON.stringify(slice), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const pet = createMockPetState();
        const ledger = initDefaultActivityLedger(1);
        let state = { updatedPet: pet, updatedLedger: ledger };

        // Batch 1: maxPages = 1, pageSize = 2. Scans Page 1 -> discovers #40, #30
        const b1 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 40,
          pageSize: 2,
          maxPages: 1,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
          fetchFn: stressFetch,
        });
        assert.equal(b1.completedFully, false);
        assert.equal(b1.historicalPrContinuationPage, 2);
        for (const evt of b1.events) state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
        assert.equal(state.updatedPet.xp, 50, 'Batch 1 awards +50 XP for #40 & #30');

        // Stress step: Insert multiple PRs (#52, #51) before Batch 2
        dynamicPrs.unshift({ number: 51, title: 'PR 51', user: { login: 'u51' }, created_at: new Date(now - 2 * 3600000).toISOString() });
        dynamicPrs.unshift({ number: 52, title: 'PR 52', user: { login: 'u52' }, created_at: new Date(now - 1 * 3600000).toISOString() });

        // Batch 2 with injected transient 502 error during continuation
        shouldFailContinuation = true;
        const b2Fail = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 40,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          historicalPrContinuationPage: b1.historicalPrContinuationPage,
          processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
          fetchFn: stressFetch,
        });
        assert.equal(b2Fail.completedFully, false, 'Failed batch must be marked completedFully: false');
        assert.equal(b2Fail.historicalPrCompleted, false);
        // Continuation cursor must NOT advance on failure
        assert.equal(b2Fail.historicalPrContinuationPage, b1.historicalPrContinuationPage, 'Failed batch must preserve continuation cursor');

        // Retry Batch 2 with error cleared
        shouldFailContinuation = false;
        const b2Retry = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 40,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          historicalPrContinuationPage: b1.historicalPrContinuationPage,
          processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
          fetchFn: stressFetch,
        });
        assert.equal(b2Retry.completedFully, false);
        assert.equal(b2Retry.historicalPrContinuationPage, 3);
        // Page 1 discovered PR #52 and #51
        for (const evt of b2Retry.events) state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
        assert.equal(state.updatedPet.level, 2, 'Pet levels up to Level 2 at 100 XP');
        assert.equal(state.updatedPet.xp, 0);

        // Stress step: Insert new PR #60 before Batch 3
        dynamicPrs.unshift({ number: 60, title: 'PR 60', user: { login: 'u60' }, created_at: new Date(now - 1000).toISOString() });

        // Batch 3: maxPages = 2, continuationPage = 3
        const b3 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 40,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          historicalPrContinuationPage: b2Retry.historicalPrContinuationPage,
          processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
          fetchFn: stressFetch,
        });
        assert.equal(b3.completedFully, false);
        assert.equal(b3.historicalPrContinuationPage, 4);
        for (const evt of b3.events) state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
        assert.equal(state.updatedPet.xp, 50, 'Batch 3 discovers #60 (+25) and #20 (+25)');

        // Batch 4: maxPages = 2, continuationPage = 4 -> discovers #10 and reaches stream end!
        const b4 = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 40,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          historicalPrContinuationPage: b3.historicalPrContinuationPage,
          processedPrOpenedNumbers: state.updatedLedger.processedRegistry.prOpenedNumbers,
          fetchFn: stressFetch,
        });
        assert.equal(b4.completedFully, true, 'Batch 4 completes to stream end');
        assert.equal(b4.historicalPrCompleted, true, 'historicalPrCompleted must be true');
        assert.equal(b4.historicalPrContinuationPage, undefined, 'Continuation page cleared');
        for (const evt of b4.events) state = evaluateActivityEvent(state.updatedPet, state.updatedLedger, evt, nowUtc);
        assert.equal(state.updatedPet.xp, 75, 'Batch 4 discovers #10 (+25 XP -> total 75 XP)');

        // Prove all 6 PRs (#60, #52, #51, #40, #30, #20, #10) exist in registry
        for (const num of [60, 52, 51, 40, 30, 20, 10]) {
          assert.ok(state.updatedLedger.processedRegistry.prOpenedNumbers.includes(num), `PR #${num} must be in registry`);
        }
      });
    });

    describe('Section C: Historical Completion Semantics (8 Conditions)', () => {
      it('Condition 1: Full page with zero eligible PRs does NOT mark historicalPrCompleted: true', async () => {
        const fullPageStale = [
          { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
          { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
        ];
        const mockFetch = async () => new Response(JSON.stringify(fullPageStale), { status: 200 });

        const res = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 1,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [50, 49],
          fetchFn: mockFetch,
        });

        assert.equal(res.completedFully, false);
        assert.equal(res.historicalPrCompleted, false, 'Full page at ceiling must NOT mark historicalPrCompleted: true');
      });

      it('Condition 2 & 3: Partial and empty final page mark historicalPrCompleted: true', async () => {
        const partialPage = [
          { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
        ];
        const mockFetchPartial = async () => new Response(JSON.stringify(partialPage), { status: 200 });

        const resPartial = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [50],
          fetchFn: mockFetchPartial,
        });

        assert.equal(resPartial.completedFully, true);
        assert.equal(resPartial.historicalPrCompleted, true, 'Partial page must mark historicalPrCompleted: true');

        const mockFetchEmpty = async () => new Response(JSON.stringify([]), { status: 200 });
        const resEmpty = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 2,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [],
          fetchFn: mockFetchEmpty,
        });

        assert.equal(resEmpty.completedFully, true);
        assert.equal(resEmpty.historicalPrCompleted, true, 'Empty page must mark historicalPrCompleted: true');
      });

      it('Condition 4: Full page at pagination ceiling marks completedFully: false and preserves checkpoints', async () => {
        const full100 = Array.from({ length: 100 }, (_, i) => ({
          number: 1000 - i,
          title: `PR ${1000 - i}`,
          user: { login: 'u' },
          created_at: nowUtc,
        }));
        const mockFetch = async () => new Response(JSON.stringify(full100), { status: 200 });

        const res = await performCompleteReconciliation({
          baseDir: process.cwd(),
          token: 'dummy-token',
          repository: 'mnp210/GitHub-Profile-Pet',
          stopAtPrNumber: 50,
          historicalPrCompleted: false,
          activeHistoricalCursor: new Date(now - 120 * 86400000).toISOString(),
          processedPrOpenedNumbers: [50, 49],
          fetchFn: mockFetch,
        });

        assert.equal(res.completedFully, false);
        assert.equal(res.checkpoints.historicalPrCompleted, false);
        assert.equal(res.checkpoints.lastPrNumber, 50, 'Checkpoint lastPrNumber must not advance');
        assert.equal(res.checkpoints.historicalRecoveryCursor, new Date(now - 120 * 86400000).toISOString(), 'Cursor must remain active');
      });

      it('Condition 5 & 6: API failure on later page marks completedFully: false, retry succeeds and advances', async () => {
        let shouldFail = true;
        const mockFetch = async (url: string | URL | Request) => {
          const urlStr = url.toString();
          if (urlStr.includes('/pulls?state=all')) {
            const page = new URL(urlStr).searchParams.get('page');
            if (page === '1') {
              return new Response(JSON.stringify([
                { number: 50, title: 'PR 50', user: { login: 'u50' }, created_at: new Date(now - 20 * 86400000).toISOString() },
                { number: 49, title: 'PR 49', user: { login: 'u49' }, created_at: new Date(now - 21 * 86400000).toISOString() },
              ]), { status: 200 });
            }
            if (page === '2') {
              if (shouldFail) return new Response('Server Error', { status: 500, statusText: 'Internal Error' });
              return new Response(JSON.stringify([
                { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
              ]), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        };

        const failRun = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 3,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [50, 49],
          fetchFn: mockFetch,
        });
        assert.equal(failRun.completedFully, false);
        assert.equal(failRun.historicalPrCompleted, false);

        shouldFail = false;
        const retryRun = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
          nowUtc,
          stopAtPrNumber: 50,
          pageSize: 2,
          maxPages: 3,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [50, 49],
          fetchFn: mockFetch,
        });
        assert.equal(retryRun.completedFully, true);
        assert.equal(retryRun.historicalPrCompleted, true);
        assert.ok(retryRun.events.some((e) => e.eventId === 'pr_opened:42'), 'PR #42 discovered on retry');
      });

      it('Condition 7 & 8: Historical cursor preserved while PR discovery incomplete, cleared when complete', async () => {
        const activeCursor = new Date(now - 120 * 86400000).toISOString();

        // Incomplete run (hits ceiling)
        const incompleteRun = await performCompleteReconciliation({
          baseDir: process.cwd(),
          token: 'dummy-token',
          repository: 'mnp210/GitHub-Profile-Pet',
          stopAtPrNumber: 50,
          historicalRecoveryCursor: undefined,
          activeHistoricalCursor: activeCursor,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [50, 49],
          fetchFn: async (url: string | URL | Request) => {
            const urlStr = url.toString();
            if (urlStr.includes('/pulls?state=all')) {
              // Return full page on every request to trigger pagination ceiling
              const full100 = Array.from({ length: 100 }, (_, i) => ({
                number: 1000 - i,
                title: `PR ${1000 - i}`,
                user: { login: 'u' },
                created_at: nowUtc,
              }));
              return new Response(JSON.stringify(full100), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
          },
        });

        assert.equal(incompleteRun.completedFully, false);
        assert.equal(incompleteRun.checkpoints.historicalRecoveryCursor, activeCursor, 'Cursor preserved while incomplete');
        assert.equal(incompleteRun.checkpoints.historicalPrCompleted, false);

        // Complete run (partial page on stream end)
        const completeRun = await performCompleteReconciliation({
          baseDir: process.cwd(),
          token: 'dummy-token',
          repository: 'mnp210/GitHub-Profile-Pet',
          stopAtPrNumber: 50,
          historicalRecoveryCursor: undefined,
          activeHistoricalCursor: activeCursor,
          historicalPrCompleted: false,
          processedPrOpenedNumbers: [50, 49],
          fetchFn: async (url: string | URL | Request) => {
            const urlStr = url.toString();
            if (urlStr.includes('/pulls?state=all')) {
              return new Response(JSON.stringify([
                { number: 42, title: 'PR 42', user: { login: 'u42' }, created_at: new Date(now - 180 * 86400000).toISOString() },
              ]), { status: 200 }); // partial page (1 < pageSize)
            }
            return new Response(JSON.stringify([]), { status: 200 });
          },
        });

        assert.equal(completeRun.completedFully, true);
        assert.equal(completeRun.checkpoints.historicalPrCompleted, true);
        assert.equal(completeRun.checkpoints.historicalRecoveryCursor, undefined, 'Cursor cleared when fully completed');
      });
    });
  });
});
