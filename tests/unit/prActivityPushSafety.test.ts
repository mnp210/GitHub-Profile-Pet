import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  isPrContext,
  isPermittedPushRef,
  runProcessingCycle,
} from '../../scripts/process-activity.ts';
import {
  evaluateActivityEvent,
  initDefaultActivityLedger,
  reconcileGitHubApiEvents,
  DAILY_ACTIVITY_XP_CAP,
  ACTIVITY_XP_REWARDS,
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
    lastInteractionTime: '2026-11-24T12:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-24T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('PR Activity Push Safety & Regression Suite (Sprint 5.2D-I)', () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pr-safety-test-'));
    await fs.mkdir(path.join(tempBaseDir, 'pet/state'), { recursive: true });
    await fs.mkdir(path.join(tempBaseDir, 'pet/ledger'), { recursive: true });
    await fs.mkdir(path.join(tempBaseDir, 'public'), { recursive: true });

    // Seed mock state and ledger files
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

  describe('Ref Classification & PR Context Detection', () => {
    it('identifies PR event names as PR context regardless of ref', () => {
      assert.equal(isPrContext('pull_request', 'main'), true);
      assert.equal(isPrContext('pull_request_review', 'main'), true);
      assert.equal(isPrContext('pull_request', 'refs/heads/main'), true);
    });

    it('identifies PR ref patterns as PR context regardless of event name', () => {
      assert.equal(isPrContext('push', '42/merge'), true);
      assert.equal(isPrContext('manual', 'refs/pull/42/merge'), true);
      assert.equal(isPrContext(undefined, '100/head'), true);
      assert.equal(isPrContext('issues', 'refs/pull/1/head'), true);
    });

    it('identifies standard branch refs as non-PR context', () => {
      assert.equal(isPrContext('push', 'main'), false);
      assert.equal(isPrContext('push', 'refs/heads/main'), false);
      assert.equal(isPrContext('schedule', 'main'), false);
      assert.equal(isPrContext('issues', 'main'), false);
    });

    it('rejects unqualified or PR-targeted refs as permitted push destinations', () => {
      assert.equal(isPermittedPushRef('42/merge'), false);
      assert.equal(isPermittedPushRef('refs/pull/42/merge'), false);
      assert.equal(isPermittedPushRef('42/head'), false);
      assert.equal(isPermittedPushRef(''), false);
      assert.equal(isPermittedPushRef('   '), false);
      assert.equal(isPermittedPushRef('main'), true);
      assert.equal(isPermittedPushRef('refs/heads/main'), true);
      assert.equal(isPermittedPushRef('candidate/playable-virtual-pet-game'), true);
    });
  });

  describe('Requirement 1 & 2: PR-opened events never invoke Git push & no unqualified destination constructed', () => {
    it('never calls git push and does not construct HEAD:<pr>/merge when processing a PR-opened event', async () => {
      const gitCalls: string[][] = [];
      const mockExecGit = async (args: string[]) => {
        gitCalls.push(args);
        return { stdout: '', stderr: '' };
      };

      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: '42/merge',
        dryRun: false,
        eventName: 'pull_request',
        cliEvents: [
          {
            eventType: 'pr_opened',
            eventId: 'pr_opened:42',
            actor: 'octocat',
            details: 'feat: amazing contribution',
          },
        ],
        execGitFn: mockExecGit,
      });

      // Assert no git command was called with 'push'
      const pushCalls = gitCalls.filter((call) => call.includes('push'));
      assert.equal(pushCalls.length, 0, 'No git push must be invoked in PR context');

      // Assert no command contains unqualified PR destination ref
      for (const call of gitCalls) {
        for (const arg of call) {
          assert.equal(arg.includes('HEAD:42/merge'), false, 'Must not construct HEAD:42/merge destination');
          assert.equal(arg.includes('refs/heads/42/merge'), false, 'Must not construct refs/heads/42/merge destination');
        }
      }
    });
  });

  describe('Requirement 3: No PR event can accidentally target main', () => {
    it('never pushes to main even if targetRef is explicitly set to main during a pull_request event', async () => {
      const gitCalls: string[][] = [];
      const mockExecGit = async (args: string[]) => {
        gitCalls.push(args);
        return { stdout: '', stderr: '' };
      };

      await runProcessingCycle({
        baseDir: tempBaseDir,
        targetRef: 'main',
        dryRun: false,
        eventName: 'pull_request',
        cliEvents: [
          {
            eventType: 'pr_opened',
            eventId: 'pr_opened:99',
            actor: 'contributor',
            details: 'fix: patch',
          },
        ],
        execGitFn: mockExecGit,
      });

      const pushCalls = gitCalls.filter((call) => call.includes('push'));
      assert.equal(pushCalls.length, 0, 'PR event must never push to main as a workaround');
    });
  });

  describe('Requirement 4: Eligible PR-opened rewards are not silently lost (Reconciliation Path)', () => {
    it('awards +25 XP when the PR-opened event is picked up during default-branch reconciliation', async () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const timestamp = '2026-11-24T12:00:00.000Z';

      // 1. In PR context, event was deferred.
      // 2. On default branch, reconciliation discovers PR #55
      const { updatedPet, updatedLedger, result } = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventType: 'pr_opened',
          eventId: 'pr_opened:55',
          actor: 'alice',
          details: 'Initial PR creation',
        },
        timestamp
      );

      assert.equal(result.success, true);
      assert.equal(result.status, 'rewarded');
      assert.equal(result.xpAwarded, ACTIVITY_XP_REWARDS.pr_opened);
      assert.equal(result.xpAwarded, 25);
      assert.equal(updatedPet.xp, 25);
      assert.ok(updatedLedger.processedRegistry.prOpenedNumbers.includes(55));
    });
  });

  describe('Requirement 5: Repeated delivery of the same PR event awards no duplicate XP', () => {
    it('returns status duplicate and awards 0 XP on duplicate PR-opened delivery', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const timestamp = '2026-11-24T12:00:00.000Z';

      // First delivery
      const first = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventType: 'pr_opened',
          eventId: 'pr_opened:77',
          actor: 'bob',
          details: 'first PR delivery',
        },
        timestamp
      );
      assert.equal(first.result.status, 'rewarded');
      assert.equal(first.result.xpAwarded, 25);

      // Second delivery (e.g. repeated cron sweep or webhook re-delivery)
      const second = evaluateActivityEvent(
        first.updatedPet,
        first.updatedLedger,
        {
          eventType: 'pr_opened',
          eventId: 'pr_opened:77',
          actor: 'bob',
          details: 'duplicate PR delivery',
        },
        timestamp
      );
      assert.equal(second.result.status, 'skipped_duplicate');
      assert.equal(second.result.xpAwarded, 0);
      assert.equal(second.updatedPet.xp, 25, 'Total XP must not increase on duplicate');
    });
  });

  describe('Requirement 6: PR close-unmerged does not award a merge reward', () => {
    it('does not discover or award merge XP when closed PR has merged_at null', async () => {
      const mockFetch: typeof fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/pulls?state=all')) {
          // Open PRs query
          return new Response(JSON.stringify([]), { status: 200, headers: { 'x-ratelimit-remaining': '5000' } });
        }
        if (urlStr.includes('/pulls?state=closed')) {
          // Closed unmerged PR
          return new Response(
            JSON.stringify([
              {
                number: 101,
                title: 'Rejected PR',
                user: { login: 'rejected_author' },
                created_at: '2026-11-24T10:00:00.000Z',
                merged_at: null, // Unmerged!
                merged_by: null,
              },
            ]),
            { status: 200, headers: { 'x-ratelimit-remaining': '5000' } }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const recon = await reconcileGitHubApiEvents(
        'fake-token',
        'owner/repo',
        {
          fetchFn: mockFetch,
          nowUtc: '2026-11-24T12:00:00.000Z',
        }
      );

      const mergeEvents = recon.events.filter((e) => e.eventType === 'pr_merged');
      assert.equal(mergeEvents.length, 0, 'Unmerged closed PR must produce zero merge events');
    });
  });

  describe('Requirement 7: PR merge processing follows intended reward policy exactly once', () => {
    it('awards +50 XP for PR merge to merger and prevents duplicate merge rewards', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const timestamp = '2026-11-24T13:00:00.000Z';

      const first = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventType: 'pr_merged',
          eventId: 'pr_merged:88',
          actor: 'maintainer1',
          details: 'Merged PR #88',
          prMerged: true,
        },
        timestamp
      );
      assert.equal(first.result.status, 'rewarded');
      assert.equal(first.result.xpAwarded, ACTIVITY_XP_REWARDS.pr_merged);
      assert.equal(first.result.xpAwarded, 50);
      assert.equal(first.updatedPet.xp, 50);
      assert.ok(first.updatedLedger.processedRegistry.prMergedNumbers.includes(88));

      // Re-delivery of the same merge
      const second = evaluateActivityEvent(
        first.updatedPet,
        first.updatedLedger,
        {
          eventType: 'pr_merged',
          eventId: 'pr_merged:88',
          actor: 'maintainer1',
          details: 'Merged PR #88 second delivery',
          prMerged: true,
        },
        timestamp
      );
      assert.equal(second.result.status, 'skipped_duplicate');
      assert.equal(second.result.xpAwarded, 0);
      assert.equal(second.updatedPet.xp, 50);
    });
  });

  describe('Requirement 8: Normal default-branch push still persists successfully', () => {
    it('successfully stages, commits, and pushes to origin/main when running on default branch with token', async () => {
      const gitCalls: string[][] = [];
      const mockExecGit = async (args: string[]) => {
        gitCalls.push(args);
        if (args[0] === 'status') {
          return { stdout: ' M pet/state/pet.json\n M pet/ledger/activity.json\n', stderr: '' };
        }
        if (args[0] === 'rev-parse') {
          return { stdout: 'commit_sha_12345\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const prevToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'test-token-123';
      try {
        await runProcessingCycle({
          baseDir: tempBaseDir,
          targetRef: 'main',
          dryRun: false,
          eventName: 'push',
          cliEvents: [
            {
              eventType: 'commit',
              eventId: 'commit:abc1234567890',
              actor: 'developer1',
              commitMessage: 'feat: add feature',
              ref: 'refs/heads/main',
            },
          ],
          execGitFn: mockExecGit,
        });

        const pushCall = gitCalls.find((call) => call[0] === 'push');
        assert.ok(pushCall, 'Git push must be invoked on normal default branch run');
        assert.deepEqual(pushCall, ['push', 'origin', 'HEAD:main'], 'Must push HEAD:main on default branch');
      } finally {
        process.env.GITHUB_TOKEN = prevToken;
      }
    });
  });

  describe('Requirement 9: Push failure does not produce a false success result', () => {
    it('propagates the push error and does not report success when git push fails', async () => {
      const mockExecGit = async (args: string[]) => {
        if (args[0] === 'status') {
          return { stdout: ' M pet/state/pet.json\n M pet/ledger/activity.json\n', stderr: '' };
        }
        if (args[0] === 'rev-parse') {
          return { stdout: 'commit_sha_fail\n', stderr: '' };
        }
        if (args[0] === 'push') {
          throw new Error('Connection refused / remote rejected');
        }
        return { stdout: '', stderr: '' };
      };

      const prevToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'test-token-123';
      try {
        await assert.rejects(
          async () => {
            await runProcessingCycle({
              baseDir: tempBaseDir,
              targetRef: 'main',
              dryRun: false,
              eventName: 'push',
              cliEvents: [
                {
                  eventType: 'commit',
                  eventId: 'commit:def4567890123',
                  actor: 'developer1',
                  commitMessage: 'feat: push error test',
                  ref: 'refs/heads/main',
                },
              ],
              execGitFn: mockExecGit,
            });
          },
          /Connection refused \/ remote rejected/,
          'Must reject with the underlying git push error'
        );
      } finally {
        process.env.GITHUB_TOKEN = prevToken;
      }
    });
  });

  describe('Requirement 10: Existing actor validation & 300 XP/UTC-day cap remain intact', () => {
    it('rejects bot actors from earning activity XP', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const timestamp = '2026-11-24T12:00:00.000Z';

      const botResult = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventType: 'pr_opened',
          eventId: 'pr_opened:999',
          actor: 'dependabot[bot]',
          isBot: true,
          details: 'automated bump',
        },
        timestamp
      );

      assert.equal(botResult.result.status, 'skipped_bot');
      assert.equal(botResult.result.xpAwarded, 0);
      assert.equal(botResult.updatedPet.xp, 0);
    });

    it('enforces the 300 XP per repository per UTC day cap', () => {
      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const dateKey = '2026-11-24';
      const timestamp = `${dateKey}T10:00:00.000Z`;

      // Pre-seed ledger with 290 XP on this day
      ledger.dailyAccruedXp[dateKey] = 290;

      // PR opened event normally awards 25 XP, but only 10 XP remains before reaching 300 cap
      const partialResult = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventType: 'pr_opened',
          eventId: 'pr_opened:201',
          actor: 'hardworking_dev',
          details: 'PR taking it to the cap',
        },
        timestamp
      );

      assert.equal(partialResult.result.status, 'rewarded');
      assert.equal(partialResult.result.xpAwarded, 10, 'Must truncate XP award to reach exactly 300 cap');
      assert.equal(partialResult.updatedLedger.dailyAccruedXp[dateKey], DAILY_ACTIVITY_XP_CAP);

      // Subsequent event on the same day must be capped (0 XP)
      const cappedResult = evaluateActivityEvent(
        partialResult.updatedPet,
        partialResult.updatedLedger,
        {
          eventType: 'pr_opened',
          eventId: 'pr_opened:202',
          actor: 'hardworking_dev',
          details: 'PR over the cap',
        },
        timestamp
      );

      assert.equal(cappedResult.result.status, 'skipped_daily_cap');
      assert.equal(cappedResult.result.xpAwarded, 0);
      assert.equal(cappedResult.updatedLedger.dailyAccruedXp[dateKey], 300);
    });
  });

  describe('5. Workflow Least-Privilege Separation & Unmerged PR Discovery (Gate B1)', () => {
    it('enforces read-only workflow baseline and isolates contents:write away from PR events', async () => {
      const workflowPath = path.resolve(process.cwd(), '.github/workflows/pet-activity.yml');
      const yaml = await fs.readFile(workflowPath, 'utf-8');

      // Must never use pull_request_target
      assert.equal(yaml.includes('pull_request_target'), false, 'pull_request_target must never be used');

      // Split into workflow header, validate-pr-activity job, and progress-activity job
      const [headerSection, restAfterPrJob] = yaml.split('  validate-pr-activity:');
      assert.ok(headerSection && restAfterPrJob, 'validate-pr-activity job must exist');
      const [prJobSection, trustedJobSection] = restAfterPrJob.split('  progress-activity:');
      assert.ok(prJobSection && trustedJobSection, 'progress-activity job must exist');

      // 1. Workflow-level permissions must be read-only (no contents: write at top level)
      // and pull_request must include synchronize so updated PR revisions are validated
      assert.match(headerSection, /pull_request:\s*\r?\n\s+types:\s*\[.*opened.*synchronize.*\]/);
      assert.match(headerSection, /permissions:\s*\r?\n\s+contents:\s*read/);
      assert.equal(/contents:\s*write/.test(headerSection), false, 'Workflow-level permissions must not grant contents: write');

      // 2. PR validation job must be strictly read-only, with no persisted credentials or GITHUB_TOKEN exposure
      assert.match(prJobSection, /github\.event_name == 'pull_request' \|\| github\.event_name == 'pull_request_review'/);
      assert.match(prJobSection, /permissions:\s*\r?\n\s+contents:\s*read/);
      assert.equal(/contents:\s*write/.test(prJobSection), false, 'PR validation job must not have contents: write');
      assert.match(prJobSection, /persist-credentials:\s*false/);
      assert.equal(prJobSection.includes('secrets.GITHUB_TOKEN'), false, 'PR validation job must not reference secrets.GITHUB_TOKEN');
      assert.match(prJobSection, /--dry-run/);

      // 3. Trusted reconciliation job must explicitly exclude pull_request and pull_request_review
      assert.match(trustedJobSection, /github\.event_name != 'pull_request'/);
      assert.match(trustedJobSection, /github\.event_name != 'pull_request_review'/);
      assert.match(trustedJobSection, /permissions:\s*\r?\n\s+contents:\s*write/);
    });

    it('discovers an opened-but-unmerged PR during default-branch reconciliation without requiring a merge event', async () => {
      const now = new Date('2026-11-26T12:00:00.000Z').getTime();
      const nowUtc = new Date(now).toISOString();

      const mockFetch = async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls?state=all')) {
          return new Response(
            JSON.stringify([
              {
                number: 77,
                title: 'Open feature PR without merge',
                state: 'open',
                user: { login: 'contributor_dev' },
                created_at: new Date(now - 3600_000).toISOString(),
                merged_at: null,
              },
            ]),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      };

      const recon = await reconcileGitHubApiEvents('dummy-token', 'mnp210/GitHub-Profile-Pet', {
        nowUtc,
        stopAtPrNumber: 76,
        historicalPrCompleted: true,
        processedPrOpenedNumbers: [76],
        fetchFn: mockFetch,
      });

      assert.equal(recon.events.length, 1);
      assert.equal(recon.events[0].eventType, 'pr_opened');
      assert.equal(recon.events[0].eventId, 'pr_opened:77');

      const pet = createMockPetState();
      const ledger = initDefaultActivityLedger(1);
      const evalRes = evaluateActivityEvent(pet, ledger, recon.events[0], nowUtc);
      assert.equal(evalRes.result.status, 'rewarded');
      assert.equal(evalRes.result.xpAwarded, 25);
      assert.ok(evalRes.updatedLedger.processedRegistry.prOpenedNumbers.includes(77));
      assert.equal(evalRes.updatedLedger.processedRegistry.prMergedNumbers.length, 0);
    });
  });
});
