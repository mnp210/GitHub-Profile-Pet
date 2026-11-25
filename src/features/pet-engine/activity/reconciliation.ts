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
  MAX_ACTIVITY_AGE_DAYS,
  MIN_RATE_LIMIT_THRESHOLD,
} from './constants.ts';

const execFileAsync = promisify(execFile);

export interface GitCommitReconcileOptions {
  baseDir: string;
  targetRef?: string;
  maxCommits?: number;
  sinceIso?: string;
  stopAtSha?: string;
  execFn?: (cmd: string, args: string[], options: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;
}

export interface ReconcileOptions {
  baseDir: string;
  targetRef?: string;
  token?: string;
  repository?: string; // "owner/repo"
  maxCommits?: number;
  sinceIso?: string;
  stopAtSha?: string;
  stopAtIssueNumber?: number;
  stopAtPrNumber?: number;
  historicalRecoveryCursor?: string;
  activeHistoricalCursor?: string;
  processedPrOpenedNumbers?: number[];
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
    historicalRecoveryCursor?: string;
  };
  warnings: string[];
  completedFully: boolean;
}

/**
 * Reconciles Git commits within the activity lookback window using `git log`.
 * Supports full-history window scanning and stopping at the previous checkpoint commit SHA.
 */
export async function reconcileGitCommits(
  options: GitCommitReconcileOptions
): Promise<{ commits: ProcessActivityEventInput[]; latestSha?: string; hitCheckpoint: boolean; totalExamined: number; hasMoreCommits: boolean }> {
  const targetRef = options.targetRef ?? 'HEAD';
  const maxCommits = options.maxCommits ?? 5000;
  const sinceIso =
    options.sinceIso ??
    new Date(Date.now() - MAX_ACTIVITY_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const stopSha = options.stopAtSha?.trim().toLowerCase();

  const gitArgs = [
    'log',
    `-n`,
    String(maxCommits),
    `--since=${sinceIso}`,
    '--format=%H%x09%an%x09%ae%x09%s%x09%cI',
    targetRef,
  ];

  try {
    const exec = options.execFn ?? execFileAsync;
    const { stdout } = await exec('git', gitArgs, { cwd: options.baseDir });
    const logLines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const discovered: ProcessActivityEventInput[] = [];
    let latestSha: string | undefined;
    let hitCheckpoint = false;
    let totalExamined = 0;

    for (const line of logLines) {
      totalExamined++;
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

      // If we encounter the checkpoint SHA from a previous successful run, stop traversing older history
      if (stopSha && cleanSha === stopSha) {
        hitCheckpoint = true;
        break;
      }

      // Check bot actors
      if (isBotActor(authorName)) {
        continue;
      }

      // Check ignored commit messages
      const isIgnored =
        /\[(?:skip ci|ci skip)\]/i.test(subject) ||
        /^pet: (?:update state|record activity)/i.test(subject);
      if (isIgnored) {
        continue;
      }

      // Check staleness
      if (commitDate && isEventStale(commitDate)) {
        continue;
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

    const hasMoreCommits = logLines.length >= maxCommits && !hitCheckpoint;
    return { commits: discovered, latestSha, hitCheckpoint, totalExamined, hasMoreCommits };
  } catch {
    // If git log fails (e.g. empty repository or shallow clone without history), return empty safely
    return { commits: [], hitCheckpoint: false, totalExamined: 0, hasMoreCommits: false };
  }
}

/**
 * Reconciles issues, pull requests, merges, and reviews from the GitHub REST API
 * using resilient loop-based pagination, rate-limit awareness, and stop thresholds.
 */
export async function reconcileGitHubApiEvents(
  token: string,
  repository: string,
  options: {
    nowUtc?: string;
    sinceIso?: string;
    stopAtIssueNumber?: number;
    stopAtPrNumber?: number;
    processedPrOpenedNumbers?: number[];
    maxPages?: number;
    pageSize?: number;
    fetchFn?: typeof fetch;
  } = {}
): Promise<{
  events: ProcessActivityEventInput[];
  latestIssueNumber?: number;
  latestPrNumber?: number;
  rateLimitRemaining?: number;
  rateLimitLimit?: number;
  warnings: string[];
  completedFully: boolean;
}> {
  const customFetch = options.fetchFn ?? fetch;
  const nowUtc = options.nowUtc ?? new Date().toISOString();
  const lookbackDays = options.sinceIso
    ? Math.max(MAX_ACTIVITY_AGE_DAYS, Math.ceil((new Date(nowUtc).getTime() - new Date(options.sinceIso).getTime()) / (24 * 60 * 60 * 1000)))
    : MAX_ACTIVITY_AGE_DAYS;
  const maxPages = options.maxPages ?? 10;
  const pageSize = options.pageSize ?? 100;
  const [owner, repo] = repository.split('/');
  const warnings: string[] = [];
  const discovered: ProcessActivityEventInput[] = [];
  let completedFully = true;

  if (!owner || !repo) {
    warnings.push(`Invalid repository format: "${repository}". Expected "owner/repo".`);
    return { events: [], warnings, completedFully: false };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'github-profile-pet-reconciliation/2.0',
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
      completedFully = false;
      return false;
    }
    return true;
  }

  let latestIssueNumber: number | undefined;
  let latestPrNumber: number | undefined;

  // 1. Paginated Issue Reconciliation
  issueLoop: for (let page = 1; page <= maxPages; page++) {
    try {
      const issuesUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=${pageSize}&page=${page}`;
      const issuesRes = await customFetch(issuesUrl, { headers });

      if (!issuesRes.ok) {
        warnings.push(`GitHub Issues API returned status ${issuesRes.status}: ${issuesRes.statusText}`);
        completedFully = false;
        break;
      }

      const canContinue = await checkRateLimit(issuesRes);
      const issues = (await issuesRes.json()) as Array<{
        number: number;
        title: string;
        user: { login: string; type?: string };
        created_at: string;
        labels?: Array<{ name: string }>;
        pull_request?: unknown;
      }>;

      if (!Array.isArray(issues) || issues.length === 0) {
        break; // End of issues stream
      }

      let lowestIssueOnPage: number | undefined;
      for (const issue of issues) {
        if (!latestIssueNumber || issue.number > latestIssueNumber) {
          latestIssueNumber = issue.number;
        }
        if (!lowestIssueOnPage || issue.number < lowestIssueOnPage) {
          lowestIssueOnPage = issue.number;
        }

        // Check if we hit checkpoint issue number
        if (options.stopAtIssueNumber && issue.number <= options.stopAtIssueNumber) {
          break issueLoop;
        }

        // GitHub /issues includes PRs; filter out PRs here
        if (issue.pull_request) continue;

        // Skip bot actors
        if (issue.user?.type === 'Bot' || isBotActor(issue.user?.login)) continue;

        // Skip pet care action issues (processed by Inbox)
        const labelNames = issue.labels?.map((l) => l.name) || [];
        if (isCareActionIssue(labelNames, issue.title)) continue;

        const isUncheckpointed = options.stopAtIssueNumber !== undefined && issue.number > options.stopAtIssueNumber;
        const isStale = isEventStale(issue.created_at, nowUtc, lookbackDays);

        if (isStale && !isUncheckpointed) {
          break issueLoop; // Since sorted descending by created_at, older issues are all stale
        }

        discovered.push({
          eventType: 'issue_opened',
          eventId: `issue:${issue.number}`,
          actor: issue.user.login,
          timestamp: issue.created_at,
          issueLabels: labelNames,
          details: issue.title,
        });
      }

      if (!canContinue || issues.length < pageSize) {
        break;
      }

      if (page === maxPages && issues.length >= pageSize) {
        if (!options.stopAtIssueNumber || (lowestIssueOnPage !== undefined && lowestIssueOnPage > options.stopAtIssueNumber)) {
          warnings.push(`GitHub Issues API reached pagination limit (${maxPages} pages). Additional uncheckpointed issues remain unprocessed.`);
          completedFully = false;
        }
        break;
      }
    } catch (err) {
      warnings.push(`Failed to fetch issues on page ${page}: ${(err as Error).message}`);
      completedFully = false;
      break;
    }
  }

  // 2. Paginated Pull Request Reconciliation (Opened & Merged)
  const candidatePullsForReview: number[] = [];

  // 2a. PRs Opened (sorted by created desc)
  prOpenLoop: for (let page = 1; page <= maxPages; page++) {
    try {
      const pullsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=created&direction=desc&per_page=${pageSize}&page=${page}`;
      const pullsRes = await customFetch(pullsUrl, { headers });

      if (!pullsRes.ok) {
        warnings.push(`GitHub Pulls API returned status ${pullsRes.status}: ${pullsRes.statusText}`);
        completedFully = false;
        break;
      }

      const canContinue = await checkRateLimit(pullsRes);
      const pulls = (await pullsRes.json()) as Array<{
        number: number;
        title: string;
        user: { login: string; type?: string };
        created_at: string;
        merged_at?: string | null;
        merged_by?: { login: string } | null;
      }>;

      if (!Array.isArray(pulls) || pulls.length === 0) {
        break;
      }

      let lowestPrOnPage: number | undefined;
      for (const pr of pulls) {
        if (!latestPrNumber || pr.number > latestPrNumber) {
          latestPrNumber = pr.number;
        }
        if (!lowestPrOnPage || pr.number < lowestPrOnPage) {
          lowestPrOnPage = pr.number;
        }

        // PR Opened
        if (!isBotActor(pr.user?.login) && pr.user?.type !== 'Bot') {
          const isAboveCheckpoint = options.stopAtPrNumber !== undefined && pr.number > options.stopAtPrNumber;
          const isMissingFromRegistry =
            options.processedPrOpenedNumbers !== undefined && !options.processedPrOpenedNumbers.includes(pr.number);
          const isUncheckpointed = isAboveCheckpoint || isMissingFromRegistry;
          const isStale = isEventStale(pr.created_at, nowUtc, lookbackDays);
          const isOlderThanNormalWindow = isEventStale(pr.created_at, nowUtc, MAX_ACTIVITY_AGE_DAYS);

          if (!isUncheckpointed && isStale) {
            break prOpenLoop;
          }

          discovered.push({
            eventType: 'pr_opened',
            eventId: `pr_opened:${pr.number}`,
            actor: pr.user.login,
            timestamp: pr.created_at,
            details: pr.title,
            allowHistoricalRecovery: isUncheckpointed || isOlderThanNormalWindow,
          });

          if (candidatePullsForReview.length < 20) {
            candidatePullsForReview.push(pr.number);
          }
        }
      }

      if (!canContinue || pulls.length < pageSize) {
        break;
      }

      if (page === maxPages && pulls.length >= pageSize) {
        if (!options.stopAtPrNumber || (lowestPrOnPage !== undefined && lowestPrOnPage > options.stopAtPrNumber)) {
          warnings.push(`GitHub Pull Requests API reached maximum pagination limit (${maxPages} pages). Additional uncheckpointed PRs remain unprocessed.`);
          completedFully = false;
        }
        break;
      }
    } catch (err) {
      warnings.push(`Failed to fetch pulls on page ${page}: ${(err as Error).message}`);
      completedFully = false;
      break;
    }
  }

  // 2b. PRs Merged (sorted by updated desc for closed PRs)
  prMergeLoop: for (let page = 1; page <= maxPages; page++) {
    try {
      const closedUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${pageSize}&page=${page}`;
      const closedRes = await customFetch(closedUrl, { headers });

      if (!closedRes.ok) {
        warnings.push(`GitHub Closed Pulls API returned status ${closedRes.status}`);
        completedFully = false;
        break;
      }

      const canContinue = await checkRateLimit(closedRes);
      const closedPulls = (await closedRes.json()) as Array<{
        number: number;
        title: string;
        user: { login: string; type?: string };
        created_at: string;
        merged_at?: string | null;
        merged_by?: { login: string } | null;
      }>;

      if (!Array.isArray(closedPulls) || closedPulls.length === 0) {
        break;
      }

      for (const pr of closedPulls) {
        if (pr.merged_at) {
          // Verify correct merger attribution
          const merger = pr.merged_by?.login || pr.user?.login || 'unknown';
          const isStaleAgainstLookback = isEventStale(pr.merged_at, nowUtc, lookbackDays);
          const isOlderThanNormalWindow = isEventStale(pr.merged_at, nowUtc, MAX_ACTIVITY_AGE_DAYS);
          const isUncheckpointed = options.stopAtPrNumber !== undefined && pr.number > options.stopAtPrNumber;
          if (!isBotActor(merger) && (!isStaleAgainstLookback || isUncheckpointed)) {
            discovered.push({
              eventType: 'pr_merged',
              eventId: `pr_merged:${pr.number}`,
              actor: merger,
              timestamp: pr.merged_at,
              details: `Merged PR: ${pr.title}`,
              prMerged: true,
              allowHistoricalRecovery: isOlderThanNormalWindow || isUncheckpointed,
            });
          }
        }
      }

      if (!canContinue || closedPulls.length < pageSize) {
        break;
      }

      if (page === maxPages && closedPulls.length >= pageSize) {
        const lastPr = closedPulls[closedPulls.length - 1];
        const lastPrStale = lastPr?.merged_at ? isEventStale(lastPr.merged_at, nowUtc, lookbackDays) : false;
        if (!lastPrStale) {
          warnings.push(
            `GitHub Closed Pull Requests API reached maximum pagination limit (${maxPages} pages). Additional recent merged PRs remain unprocessed.`
          );
          completedFully = false;
        }
        break;
      }
    } catch (err) {
      warnings.push(`Failed to fetch merged pulls on page ${page}: ${(err as Error).message}`);
      completedFully = false;
      break;
    }
  }

  // 3. Paginated Reviews for Active Pull Requests
  for (const prNumber of candidatePullsForReview) {
    if (rateLimitRemaining !== undefined && rateLimitRemaining < MIN_RATE_LIMIT_THRESHOLD) {
      warnings.push(`Halting review reconciliation due to rate limit threshold.`);
      completedFully = false;
      break;
    }

    try {
      const reviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`;
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

          // Crucial attribution: reviewer is the actor, not the PR author!
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
      completedFully = false;
    }
  }

  return {
    events: discovered,
    latestIssueNumber,
    latestPrNumber,
    rateLimitRemaining,
    rateLimitLimit,
    warnings,
    completedFully,
  };
}

/**
 * Orchestrates complete activity reconciliation across Git commits and GitHub API.
 */
export async function performCompleteReconciliation(options: ReconcileOptions): Promise<ReconcileResult> {
  const nowUtc = options.nowUtc ?? new Date().toISOString();
  const allEvents: ProcessActivityEventInput[] = [];
  const warnings: string[] = [];
  let completedFully = true;

  // 1. Reconcile Git commits within the lookback window
  const gitCommitResult = await reconcileGitCommits({
    baseDir: options.baseDir,
    targetRef: options.targetRef ?? 'HEAD',
    maxCommits: options.maxCommits ?? 5000,
    sinceIso: options.sinceIso,
    stopAtSha: options.stopAtSha,
  });
  allEvents.push(...gitCommitResult.commits);

  if (gitCommitResult.hasMoreCommits) {
    completedFully = false;
    warnings.push(
      `Git commit reconciliation reached maximum commit boundary (${options.maxCommits ?? 5000}) without reaching checkpoint. Traversal was truncated.`
    );
  }

  let latestIssue: number | undefined;
  let latestPr: number | undefined;
  let rateLimitRemaining: number | undefined;
  let rateLimitLimit: number | undefined;

  // 2. Reconcile via GitHub API if credentials and repository are supplied
  if (options.token && options.repository) {
    const apiResult = await reconcileGitHubApiEvents(options.token, options.repository, {
      nowUtc,
      sinceIso: options.sinceIso,
      stopAtIssueNumber: options.stopAtIssueNumber,
      stopAtPrNumber: options.stopAtPrNumber,
      processedPrOpenedNumbers: options.processedPrOpenedNumbers,
      fetchFn: options.fetchFn,
    });

    allEvents.push(...apiResult.events);
    latestIssue = apiResult.latestIssueNumber;
    latestPr = apiResult.latestPrNumber;
    rateLimitRemaining = apiResult.rateLimitRemaining;
    rateLimitLimit = apiResult.rateLimitLimit;
    warnings.push(...apiResult.warnings);
    if (!apiResult.completedFully) {
      completedFully = false;
    }
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
      lastCommitSha: completedFully ? gitCommitResult.latestSha : options.stopAtSha,
      lastIssueNumber: completedFully ? latestIssue : options.stopAtIssueNumber,
      lastPrNumber: completedFully ? latestPr : options.stopAtPrNumber,
      reconciledAt: completedFully ? nowUtc : (options.sinceIso ?? nowUtc),
      historicalRecoveryCursor: completedFully ? options.historicalRecoveryCursor : options.activeHistoricalCursor,
    },
    warnings,
    completedFully,
  };
}
