import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  reconcileGitHubApiEvents,
  performCompleteReconciliation,
} from '../../src/features/pet-engine/activity/index.ts';

describe('Complete Activity Reconciliation Suite (Sprint 4.0)', () => {
  it('reconciles qualifying issues while filtering bots and care actions', async () => {
    const mockIssuesResponse = [
      {
        number: 101,
        title: 'Regular user bug report',
        user: { login: 'octocat', type: 'User' },
        created_at: new Date().toISOString(),
        labels: [{ name: 'bug' }],
      },
      {
        number: 102,
        title: 'pet: feed action',
        user: { login: 'octocat', type: 'User' },
        created_at: new Date().toISOString(),
        labels: [{ name: 'pet-action:pending' }],
      },
      {
        number: 103,
        title: 'Dependabot bump',
        user: { login: 'dependabot[bot]', type: 'Bot' },
        created_at: new Date().toISOString(),
      },
    ];

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/issues')) {
        return new Response(JSON.stringify(mockIssuesResponse), {
          status: 200,
          headers: { 'x-ratelimit-remaining': '4900', 'x-ratelimit-limit': '5000' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const result = await reconcileGitHubApiEvents('fake-token', 'mnp210/GitHub-Profile-Pet-Test', {
      fetchFn: mockFetch,
    });

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].eventType, 'issue_opened');
    assert.equal(result.events[0].eventId, 'issue:101');
    assert.equal(result.events[0].actor, 'octocat');
    assert.equal(result.latestIssueNumber, 103);
  });

  it('reconciles PR opened and PR merged with distinct events', async () => {
    const now = new Date().toISOString();
    const mockPullsResponse = [
      {
        number: 42,
        title: 'Add awesome feature',
        user: { login: 'alice', type: 'User' },
        created_at: now,
        merged_at: now,
        merged_by: { login: 'bob' },
      },
    ];

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/pulls?') || urlStr.endsWith('/pulls')) {
        return new Response(JSON.stringify(mockPullsResponse), {
          status: 200,
          headers: { 'x-ratelimit-remaining': '4900' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const result = await reconcileGitHubApiEvents('fake-token', 'mnp210/GitHub-Profile-Pet-Test', {
      fetchFn: mockFetch,
    });

    // PR #42 produced both pr_opened and pr_merged
    const opened = result.events.find((e) => e.eventType === 'pr_opened');
    const merged = result.events.find((e) => e.eventType === 'pr_merged');

    assert.ok(opened);
    assert.equal(opened.eventId, 'pr_opened:42');
    assert.equal(opened.actor, 'alice');

    assert.ok(merged);
    assert.equal(merged.eventId, 'pr_merged:42');
    assert.equal(merged.actor, 'bob');
  });

  it('reconciles qualifying reviews and ignores unapproved/pending states', async () => {
    const now = new Date().toISOString();
    const mockPulls = [
      {
        number: 88,
        title: 'Core architectural change',
        user: { login: 'alice', type: 'User' },
        created_at: now,
        merged_at: null,
      },
    ];
    const mockReviews = [
      { id: 1001, user: { login: 'carol', type: 'User' }, state: 'APPROVED', submitted_at: now },
      { id: 1002, user: { login: 'dave', type: 'User' }, state: 'COMMENTED', submitted_at: now },
      { id: 1003, user: { login: 'eve', type: 'User' }, state: 'CHANGES_REQUESTED', submitted_at: now },
    ];

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/reviews')) {
        return new Response(JSON.stringify(mockReviews), { status: 200 });
      }
      if (urlStr.includes('/pulls')) {
        return new Response(JSON.stringify(mockPulls), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const result = await reconcileGitHubApiEvents('fake-token', 'mnp210/GitHub-Profile-Pet-Test', {
      fetchFn: mockFetch,
    });

    const reviews = result.events.filter((e) => e.eventType === 'review_submitted');
    assert.equal(reviews.length, 2); // 1001 (APPROVED) and 1003 (CHANGES_REQUESTED), COMMENTED excluded
    assert.equal(reviews[0].eventId, 'review:1001');
    assert.equal(reviews[1].eventId, 'review:1003');
  });

  it('yields gracefully without error when rate limit threshold is hit', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-limit': '5000' },
      });
    };

    const result = await reconcileGitHubApiEvents('fake-token', 'mnp210/GitHub-Profile-Pet-Test', {
      fetchFn: mockFetch,
    });

    assert.equal(result.rateLimitRemaining, 3);
    assert.ok(result.warnings.some((w) => w.includes('rate limit critical')));
  });

  it('handles unauthenticated/offline environments safely without crashing', async () => {
    const recon = await performCompleteReconciliation({
      baseDir: process.cwd(),
      // No token or repository provided
    });

    assert.ok(recon.warnings.some((w) => w.includes('GITHUB_TOKEN or GITHUB_REPOSITORY not configured')));
    assert.ok(Array.isArray(recon.discoveredEvents));
    assert.ok(recon.checkpoints.reconciledAt);
  });
});
