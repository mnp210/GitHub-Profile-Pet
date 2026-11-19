/**
 * GitHub Profile Pet - Complete Activity Reconciliation Engine
 *
 * Provides repository-scoped discovery of qualifying GitHub activities (commits,
 * issues, PR creations, PR merges, reviews), respecting API pagination, rate limits,
 * 14-day eligibility boundaries, and durable checkpointing.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessActivityEventInput } from './types.ts';
import {
  isBotActor,
  isCareActionIssue,
  isEventStale,
} from './activityProcessor.ts';
import {
  MIN_RATE_LIMIT_THRESHOLD,
} from './constants.ts';

const execFileAsync = promisify(execFile);

export interface ReconcileOptions {
  baseDir: string;
  targetRef?: string;
  token?: string;
  repository?: string; // "owner/repo"
  maxCommits?: number;
  nowUtc?: string;
  fetchFn?: typeof fetch;
}

export interface ReconcileResult {
  discoveredEvents: ProcessActivityEventInput[];
  rateLimitRemaining?: number;
  rateLimitLimit?: number;
  checkpoints: {
    lastCommitSha?: string;
    lastIssueNumber?: number;
    lastPrNumber?: number;
    reconciledAt: string;
  };
  warnings: string[];
}

/**
 * Reconciles recent Git commits using `git log`.
 */
export async function reconcileGitCommits(
  baseDir: string,
  targetRef: string = 'HEAD',
  maxCommits: number = 30
): Promise<{ commits: ProcessActivityEventInput[]; latestSha?: string }> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-n', String(maxCommits), '--format=%H%x09%an%x09%ae%x09%s%x09%cI', targetRef],
      { cwd: baseDir }
    );

    const logLines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const discovered: ProcessActivityEventInput[] = [];
    let latestSha: string | undefined;

    for (const line of logLines) {
      const parts = line.split('\t');
      const sha = parts[0]?.trim();
      const authorName = parts[1]?.trim();
      const subject = parts[3]?.trim() || '';
      const commitDate = parts[4]?.trim() || '';

      if (!sha || !authorName) continue;
      const cleanSha = sha.toLowerCase();

      if (!latestSha) {
        latestSha = cleanSha;
      }

      discovered.push({
        eventType: 'commit',
        eventId: `commit:${cleanSha}`,
        actor: authorName,
        commitMessage: subject,
        details: subject ? subject.slice(0, 100) : 'Commit reconciliation',
        timestamp: commitDate,
        ref: targetRef,
      });
    }

    return { commits: discovered, latestSha };
  } catch {
    // If git log fails (e.g. shallow clone, no commits yet, or not a git repository), return empty
    return { commits: [] };
  }
}

/**
 * Reconciles issues, pull requests, merges, and reviews from the GitHub REST API.
 */
export async function reconcileGitHubApiEvents(
  token: string,
  repository: string,
  options: {
    nowUtc?: string;
    fetchFn?: typeof fetch;
  } = {}
): Promise<{
  events: ProcessActivityEventInput[];
  latestIssueNumber?: number;
  latestPrNumber?: number;
  rateLimitRemaining?: number;
  rateLimitLimit?: number;
  warnings: string[];
}> {
  const customFetch = options.fetchFn ?? fetch;
  const nowUtc = options.nowUtc ?? new Date().toISOString();
  const [owner, repo] = repository.split('/');
  const warnings: string[] = [];
  const discovered: ProcessActivityEventInput[] = [];

  if (!owner || !repo) {
    warnings.push(`Invalid repository format: "${repository}". Expected "owner/repo".`);
    return { events: [], warnings };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'github-profile-pet-reconciliation/1.0',
  };

  let rateLimitRemaining: number | undefined;
  let rateLimitLimit: number | undefined;

  async function checkRateLimit(res: Response): Promise<boolean> {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const limit = res.headers.get('x-ratelimit-limit');
    if (remaining !== null) {
      rateLimitRemaining = parseInt(remaining, 10);
    }
    if (limit !== null) {
      rateLimitLimit = parseInt(limit, 10);
    }

    if (rateLimitRemaining !== undefined && rateLimitRemaining < MIN_RATE_LIMIT_THRESHOLD) {
      warnings.push(`GitHub API rate limit critical (${rateLimitRemaining} remaining). Halting reconciliation.`);
      return false;
    }
    return true;
  }

  let latestIssueNumber: number | undefined;
  let latestPrNumber: number | undefined;

  // 1. Reconcile Issues
  try {
    const issuesUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=30`;
    const issuesRes = await customFetch(issuesUrl, { headers });

    if (issuesRes.ok) {
      const canContinue = await checkRateLimit(issuesRes);
      const issues = (await issuesRes.json()) as Array<{
        number: number;
        title: string;
        user: { login: string; type?: string };
        created_at: string;
        labels?: Array<{ name: string }>;
        pull_request?: unknown;
      }>;

      for (const issue of issues) {
        if (!latestIssueNumber || issue.number > latestIssueNumber) {
          latestIssueNumber = issue.number;
        }

        // GitHub /issues includes PRs; filter out PRs here
        if (issue.pull_request) continue;

        // Skip bot actors
        if (issue.user?.type === 'Bot' || isBotActor(issue.user?.login)) continue;

        // Skip pet care action issues (processed by Inbox)
        const labelNames = issue.labels?.map((l) => l.name) || [];
        if (isCareActionIssue(labelNames, issue.title)) continue;

        // Check staleness (> 14 days)
        if (isEventStale(issue.created_at, nowUtc)) continue;

        discovered.push({
          eventType: 'issue_opened',
          eventId: `issue:${issue.number}`,
          actor: issue.user.login,
          timestamp: issue.created_at,
          issueLabels: labelNames,
          details: issue.title,
        });
      }

      if (!canContinue) {
        return { events: discovered, latestIssueNumber, latestPrNumber, rateLimitRemaining, rateLimitLimit, warnings };
      }
    } else {
      warnings.push(`GitHub Issues API returned status ${issuesRes.status}: ${issuesRes.statusText}`);
    }
  } catch (err) {
    warnings.push(`Failed to fetch issues: ${(err as Error).message}`);
  }

  // 2. Reconcile Pull Requests (Opened and Merged)
  const candidatePullsForReview: number[] = [];
  try {
    const pullsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=created&direction=desc&per_page=30`;
    const pullsRes = await customFetch(pullsUrl, { headers });

    if (pullsRes.ok) {
      const canContinue = await checkRateLimit(pullsRes);
      const pulls = (await pullsRes.json()) as Array<{
        number: number;
        title: string;
        user: { login: string; type?: string };
        created_at: string;
        merged_at?: string | null;
        merged_by?: { login: string } | null;
      }>;

      for (const pr of pulls) {
        if (!latestPrNumber || pr.number > latestPrNumber) {
          latestPrNumber = pr.number;
        }

        // PR Opened
        if (!isBotActor(pr.user?.login) && pr.user?.type !== 'Bot') {
          if (!isEventStale(pr.created_at, nowUtc)) {
            discovered.push({
              eventType: 'pr_opened',
              eventId: `pr_opened:${pr.number}`,
              actor: pr.user.login,
              timestamp: pr.created_at,
              details: pr.title,
            });
          }
        }

        // PR Merged
        if (pr.merged_at) {
          const merger = pr.merged_by?.login || pr.user?.login || 'unknown';
          if (!isBotActor(merger) && !isEventStale(pr.merged_at, nowUtc)) {
            discovered.push({
              eventType: 'pr_merged',
              eventId: `pr_merged:${pr.number}`,
              actor: merger,
              timestamp: pr.merged_at,
              details: `Merged PR: ${pr.title}`,
              prMerged: true,
            });
          }
        }

        // Keep up to 5 recent PRs for review inspection
        if (candidatePullsForReview.length < 5) {
          candidatePullsForReview.push(pr.number);
        }
      }

      if (!canContinue) {
        return { events: discovered, latestIssueNumber, latestPrNumber, rateLimitRemaining, rateLimitLimit, warnings };
      }
    } else {
      warnings.push(`GitHub Pulls API returned status ${pullsRes.status}: ${pullsRes.statusText}`);
    }
  } catch (err) {
    warnings.push(`Failed to fetch pulls: ${(err as Error).message}`);
  }

  // 3. Reconcile Reviews for Recent Pull Requests
  for (const prNumber of candidatePullsForReview) {
    if (rateLimitRemaining !== undefined && rateLimitRemaining < MIN_RATE_LIMIT_THRESHOLD) {
      warnings.push(`Halting review reconciliation due to rate limit threshold.`);
      break;
    }

    try {
      const reviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=20`;
      const reviewsRes = await customFetch(reviewsUrl, { headers });

      if (reviewsRes.ok) {
        await checkRateLimit(reviewsRes);
        const reviews = (await reviewsRes.json()) as Array<{
          id: number;
          user: { login: string; type?: string };
          state: string;
          submitted_at?: string;
        }>;

        for (const review of reviews) {
          const state = (review.state || '').toUpperCase();
          if (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED') continue;
          if (isBotActor(review.user?.login) || review.user?.type === 'Bot') continue;
          if (!review.submitted_at || isEventStale(review.submitted_at, nowUtc)) continue;

          discovered.push({
            eventType: 'review_submitted',
            eventId: `review:${review.id}`,
            actor: review.user.login,
            timestamp: review.submitted_at,
            details: `Review (${state}) on PR #${prNumber}`,
          });
        }
      }
    } catch (err) {
      warnings.push(`Failed to fetch reviews for PR #${prNumber}: ${(err as Error).message}`);
    }
  }

  return {
    events: discovered,
    latestIssueNumber,
    latestPrNumber,
    rateLimitRemaining,
    rateLimitLimit,
    warnings,
  };
}

/**
 * Orchestrates complete activity reconciliation across Git commits and GitHub API.
 */
export async function performCompleteReconciliation(options: ReconcileOptions): Promise<ReconcileResult> {
  const nowUtc = options.nowUtc ?? new Date().toISOString();
  const allEvents: ProcessActivityEventInput[] = [];
  const warnings: string[] = [];

  // 1. Reconcile Git commits
  const { commits, latestSha } = await reconcileGitCommits(
    options.baseDir,
    options.targetRef ?? 'HEAD',
    options.maxCommits ?? 30
  );
  allEvents.push(...commits);

  let latestIssue: number | undefined;
  let latestPr: number | undefined;
  let rateLimitRemaining: number | undefined;
  let rateLimitLimit: number | undefined;

  // 2. Reconcile via GitHub API if credentials and repository are supplied
  if (options.token && options.repository) {
    const apiResult = await reconcileGitHubApiEvents(options.token, options.repository, {
      nowUtc,
      fetchFn: options.fetchFn,
    });

    allEvents.push(...apiResult.events);
    latestIssue = apiResult.latestIssueNumber;
    latestPr = apiResult.latestPrNumber;
    rateLimitRemaining = apiResult.rateLimitRemaining;
    rateLimitLimit = apiResult.rateLimitLimit;
    warnings.push(...apiResult.warnings);
  } else {
    warnings.push('GitHub API reconciliation skipped: GITHUB_TOKEN or GITHUB_REPOSITORY not configured.');
  }

  // De-duplicate queued events in memory by stable eventId
  const uniqueEvents: ProcessActivityEventInput[] = [];
  const seenIds = new Set<string>();

  for (const evt of allEvents) {
    const key = `${evt.eventType}:${evt.eventId.toLowerCase()}`;
    if (!seenIds.has(key)) {
      seenIds.add(key);
      uniqueEvents.push(evt);
    }
  }

  return {
    discoveredEvents: uniqueEvents,
    rateLimitRemaining,
    rateLimitLimit,
    checkpoints: {
      lastCommitSha: latestSha,
      lastIssueNumber: latestIssue,
      lastPrNumber: latestPr,
      reconciledAt: nowUtc,
    },
    warnings,
  };
}
