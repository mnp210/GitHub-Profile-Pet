import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ActivityRewardLedgerProcessor,
  buildCanonicalActivityId,
  type CommitActivityPayload,
} from '../../src/features/gamification/deduplication.ts';

describe('Dual-Layer Activity Deduplication Engine', () => {
  it('generates consistent canonical identities across transports', () => {
    const commit: CommitActivityPayload = {
      type: 'commit',
      userId: 'octocat_123',
      repoFullName: 'OctoCat/Hello-World',
      commitSha: '6dcb09b5b57875f334f61aebed695e2e4193db5e',
      timestamp: 1700000000,
    };

    const canonicalId = buildCanonicalActivityId(commit);
    assert.equal(
      canonicalId,
      'urn:gh:commit:octocat/hello-world:6dcb09b5b57875f334f61aebed695e2e4193db5e'
    );
  });

  it('awards XP strictly once when the same commit arrives via both Webhook and GraphQL Polling', () => {
    const ledger = new ActivityRewardLedgerProcessor();
    const commit: CommitActivityPayload = {
      type: 'commit',
      userId: 'octocat_123',
      repoFullName: 'octocat/hello-world',
      commitSha: 'a1b2c3d4e5f67890123456789abcdef012345678',
      timestamp: 1700001000,
    };

    // 1. First arrival via Webhook (with X-GitHub-Delivery)
    const webhookResult = ledger.ingestActivity(
      {
        transport: 'webhook',
        deliveryId: '72d3162e-cc78-11e3-81ab-4c9367dc0958',
        activity: commit,
      },
      { xp: 25, satiety: 10 }
    );

    assert.equal(webhookResult.success, true);
    assert.equal(webhookResult.status, 'awarded');
    assert.equal(webhookResult.xpAwarded, 25);
    assert.equal(ledger.getLedgerCount(), 1);

    // 2. Second arrival via periodic background GraphQL Polling (no delivery ID)
    const pollingResult = ledger.ingestActivity(
      {
        transport: 'graphql_polling',
        activity: commit,
      },
      { xp: 25, satiety: 10 }
    );

    assert.equal(pollingResult.success, false);
    assert.equal(pollingResult.status, 'already_awarded');
    assert.equal(pollingResult.xpAwarded, 0);
    assert.equal(pollingResult.satietyAwarded, 0);
    assert.match(pollingResult.message, /already rewarded/);

    // Ledger still has exactly 1 entry
    assert.equal(ledger.getLedgerCount(), 1);
  });

  it('rejects retried webhook deliveries at the transport layer using X-GitHub-Delivery', () => {
    const ledger = new ActivityRewardLedgerProcessor();
    const commit: CommitActivityPayload = {
      type: 'commit',
      userId: 'octocat_123',
      repoFullName: 'octocat/hello-world',
      commitSha: 'f1e2d3c4b5a67890123456789abcdef012345678',
      timestamp: 1700002000,
    };

    // First attempt
    const res1 = ledger.ingestActivity(
      {
        transport: 'webhook',
        deliveryId: 'delivery-uuid-999',
        activity: commit,
      },
      { xp: 25, satiety: 10 }
    );
    assert.equal(res1.status, 'awarded');
    assert.equal(res1.xpAwarded, 25);

    // Retried delivery with identical X-GitHub-Delivery
    const res2 = ledger.ingestActivity(
      {
        transport: 'webhook',
        deliveryId: 'delivery-uuid-999',
        activity: commit,
      },
      { xp: 25, satiety: 10 }
    );
    assert.equal(res2.status, 'duplicate_delivery');
    assert.equal(res2.xpAwarded, 0);
  });

  it('permits distinct commits on the same repository to be rewarded independently', () => {
    const ledger = new ActivityRewardLedgerProcessor();
    const commitA: CommitActivityPayload = {
      type: 'commit',
      userId: 'octocat_123',
      repoFullName: 'octocat/hello-world',
      commitSha: '1111111111111111111111111111111111111111',
      timestamp: 1700003000,
    };
    const commitB: CommitActivityPayload = {
      type: 'commit',
      userId: 'octocat_123',
      repoFullName: 'octocat/hello-world',
      commitSha: '2222222222222222222222222222222222222222',
      timestamp: 1700003005,
    };

    const resA = ledger.ingestActivity(
      { transport: 'webhook', deliveryId: 'del-1', activity: commitA },
      { xp: 25, satiety: 10 }
    );
    const resB = ledger.ingestActivity(
      { transport: 'webhook', deliveryId: 'del-2', activity: commitB },
      { xp: 15, satiety: 5 }
    );

    assert.equal(resA.status, 'awarded');
    assert.equal(resB.status, 'awarded');
    assert.equal(resA.xpAwarded, 25);
    assert.equal(resB.xpAwarded, 15);
    assert.equal(ledger.getLedgerCount(), 2);
  });
});
