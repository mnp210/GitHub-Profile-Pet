import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  reconcileGitHubApiEvents,
} from '../../src/features/pet-engine/activity/index.ts';

describe('GitHub API Multi-Page Pagination & Reviewer Attribution (Sprint 4.1)', () => {
  it('paginates issues across multiple pages until empty page is reached', async () => {
    const page1Issues = [
      {
        number: 201,
        title: 'Issue from page 1',
        user: { login: 'alice', type: 'User' },
        created_at: new Date().toISOString(),
        labels: [],
      },
      {
        number: 202,
        title: 'Another issue from page 1',
        user: { login: 'bob', type: 'User' },
        created_at: new Date().toISOString(),
        labels: [],
      },
    ];

    const page2Issues = [
      {
        number: 203,
        title: 'Issue from page 2',
        user: { login: 'charlie', type: 'User' },
        created_at: new Date().toISOString(),
        labels: [],
      },
    ];

    let issuePageCalls = 0;

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/issues?')) {
        issuePageCalls++;
        if (urlStr.includes('page=1')) {
          return new Response(JSON.stringify(page1Issues), {
            status: 200,
            headers: { 'x-ratelimit-remaining': '4000', 'x-ratelimit-limit': '5000' },
          });
        }
        if (urlStr.includes('page=2')) {
          return new Response(JSON.stringify(page2Issues), {
            status: 200,
            headers: { 'x-ratelimit-remaining': '3999', 'x-ratelimit-limit': '5000' },
          });
        }
        // page 3 is empty
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'x-ratelimit-remaining': '3998', 'x-ratelimit-limit': '5000' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const result = await reconcileGitHubApiEvents('token', 'owner/repo', {
      pageSize: 2,
      fetchFn: mockFetch,
    });

    assert.ok(issuePageCalls >= 2, `Expected at least 2 page calls, got ${issuePageCalls}`);
    const issueEvents = result.events.filter((e) => e.eventType === 'issue_opened');
    assert.equal(issueEvents.length, 3);
    assert.equal(issueEvents[0].eventId, 'issue:201');
    assert.equal(issueEvents[1].eventId, 'issue:202');
    assert.equal(issueEvents[2].eventId, 'issue:203');
    assert.equal(result.latestIssueNumber, 203);
  });

  it('correctly attributes review XP to the reviewer login, NOT the PR author', async () => {
    const mockPulls = [
      {
        number: 45,
        title: 'Refactor storage subsystem',
        user: { login: 'pr_author_dan', type: 'User' },
        created_at: new Date().toISOString(),
      },
    ];

    const mockReviews = [
      {
        id: 9901,
        state: 'APPROVED',
        user: { login: 'reviewer_elena', type: 'User' },
        submitted_at: new Date().toISOString(),
      },
    ];

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/pulls?') || (urlStr.includes('/pulls') && !urlStr.includes('/reviews'))) {
        return new Response(JSON.stringify(mockPulls), {
          status: 200,
          headers: { 'x-ratelimit-remaining': '4500' },
        });
      }
      if (urlStr.includes('/pulls/45/reviews')) {
        return new Response(JSON.stringify(mockReviews), {
          status: 200,
          headers: { 'x-ratelimit-remaining': '4499' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const result = await reconcileGitHubApiEvents('token', 'owner/repo', {
      fetchFn: mockFetch,
    });

    const reviewEvent = result.events.find((e) => e.eventType === 'review_submitted');
    assert.ok(reviewEvent, 'Review event must be present');
    assert.equal(reviewEvent.actor, 'reviewer_elena', 'XP must be attributed to reviewer, not author');
    assert.notEqual(reviewEvent.actor, 'pr_author_dan', 'XP must NOT be attributed to author');
    assert.equal(reviewEvent.eventId, 'review:9901');
  });

  it('aborts API pagination gracefully when rate limit falls below threshold', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify([{ number: 1, title: 'Bug', user: { login: 'user1' } }]), {
        status: 200,
        headers: { 'x-ratelimit-remaining': '5', 'x-ratelimit-limit': '5000' },
      });
    };

    const result = await reconcileGitHubApiEvents('token', 'owner/repo', {
      fetchFn: mockFetch,
    });

    assert.equal(result.completedFully, false, 'Should mark completedFully as false when rate-limited');
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes('rate limit')));
  });

  it('stops issue pagination when encountering stopAtIssueNumber checkpoint', async () => {
    const mockIssues = [
      {
        number: 305,
        title: 'Newest issue',
        user: { login: 'userA', type: 'User' },
        created_at: new Date().toISOString(),
        labels: [],
      },
      {
        number: 304,
        title: 'Prior issue',
        user: { login: 'userB', type: 'User' },
        created_at: new Date().toISOString(),
        labels: [],
      },
      {
        number: 300, // Checkpoint target
        title: 'Already reconciled issue',
        user: { login: 'userC', type: 'User' },
        created_at: new Date().toISOString(),
        labels: [],
      },
    ];

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/issues?')) {
        return new Response(JSON.stringify(mockIssues), {
          status: 200,
          headers: { 'x-ratelimit-remaining': '4800' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const result = await reconcileGitHubApiEvents('token', 'owner/repo', {
      stopAtIssueNumber: 300,
      fetchFn: mockFetch,
    });

    const issues = result.events.filter((e) => e.eventType === 'issue_opened');
    assert.equal(issues.length, 2);
    assert.equal(issues[0].eventId, 'issue:305');
    assert.equal(issues[1].eventId, 'issue:304');
  });
});
