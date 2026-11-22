/**
 * GitHub Profile Pet - Automated Failure Alerting & Deduplication Service
 *
 * Implements deterministic duplicate issue prevention, sanitized diagnostic
 * reporting, and workflow recovery lifecycle management for GitHub Actions.
 *
 * Requirements:
 * - Disabled by default (FAILURE_ALERTS_ENABLED=false)
 * - Deterministic deduplication key: repository + workflow_file + failure_category
 * - Redacts secrets and sanitizes untrusted Markdown
 * - Reuses Sprint 5.0A reporting utilities
 * - Decoupled client interface for 100% offline testability
 */

import { sanitizeSecrets, escapeMarkdown } from './stepSummary.ts';

export const ALERT_LABEL_DEFAULT = 'alert:workflow-failure';
export const ALERT_CATEGORY_WORKFLOW_FAILURE = 'workflow_failure';

export interface AlertFingerprintParams {
  repository: string;
  workflowFile: string;
  category?: string;
}

/**
 * Generates a deterministic deduplication fingerprint string.
 * Format: "owner/repo:workflow_file:category"
 */
export function createAlertFingerprint(params: AlertFingerprintParams): string {
  const { repository, workflowFile, category = ALERT_CATEGORY_WORKFLOW_FAILURE } = params;
  const cleanRepo = repository.trim().toLowerCase();
  const cleanFile = workflowFile.trim().replace(/^.*[\\/]/, '').toLowerCase();
  const cleanCategory = category.trim().toLowerCase();
  return `${cleanRepo}:${cleanFile}:${cleanCategory}`;
}

/**
 * Embeds the machine-readable fingerprint into an HTML comment.
 */
export function formatFingerprintComment(fingerprint: string): string {
  return `<!-- FAILURE_ALERT_FINGERPRINT:${fingerprint} -->`;
}

/**
 * Extracts a machine-readable fingerprint from issue or comment body text.
 */
export function extractAlertFingerprint(bodyText: string): string | null {
  if (!bodyText) return null;
  const match = bodyText.match(/<!--\s*FAILURE_ALERT_FINGERPRINT:([^\s>]+)\s*-->/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Formats a clean, professional, sanitized GitHub issue title.
 */
export function formatFailureIssueTitle(params: { workflowName: string; runId: number | string }): string {
  const sanitizedName = sanitizeSecrets(params.workflowName)
    .replace(/[\r\n\t]/g, ' ')
    .trim();
  return `[Workflow Failure] ${sanitizedName} — Run ${params.runId}`;
}

export interface FailureAlertPayloadParams {
  workflowName: string;
  workflowFile: string;
  runId: number | string;
  runAttempt?: number | string;
  repository: string;
  branch: string;
  headSha: string;
  eventName: string;
  failureTimeIso: string;
  runUrl: string;
  conclusion: string;
  failureSummary?: string;
  diagnosticContext?: Record<string, string | number | boolean | undefined>;
  category?: string;
}

/**
 * Formats the full Markdown issue body for a new failure alert.
 */
export function formatFailureIssueBody(params: FailureAlertPayloadParams): string {
  const fingerprint = createAlertFingerprint({
    repository: params.repository,
    workflowFile: params.workflowFile,
    category: params.category,
  });

  const lines: string[] = [
    '### 🚨 GitHub Profile Pet — Workflow Failure Report',
    '',
    'A maintained production workflow has encountered a failure during execution.',
    '',
    '#### Execution Metadata',
    '',
    '| Field | Value |',
    '| :--- | :--- |',
    `| **Workflow** | \`${escapeMarkdown(params.workflowName)}\` |`,
    `| **Workflow File** | \`${escapeMarkdown(params.workflowFile)}\` |`,
    `| **Run ID** | [${params.runId}](${params.runUrl}) |`,
    `| **Run Attempt** | ${params.runAttempt} |`,
    `| **Repository** | \`${escapeMarkdown(params.repository)}\` |`,
    `| **Branch** | \`${escapeMarkdown(params.branch)}\` |`,
    `| **Commit** | \`${escapeMarkdown(params.headSha)}\` |`,
    `| **Triggering Event** | \`${escapeMarkdown(params.eventName)}\` |`,
    `| **Failure Time** | \`${params.failureTimeIso}\` |`,
    `| **Execution Conclusion** | \`${escapeMarkdown(params.conclusion.toUpperCase())}\` |`,
    '',
    '#### Failure Summary',
    '',
  ];

  if (params.failureSummary) {
    lines.push(`> [!WARNING]`);
    lines.push(`> ${escapeMarkdown(params.failureSummary)}`);
    lines.push('');
  } else {
    lines.push('_The workflow terminated with a non-zero exit status or timeout. Inspect execution logs for step details._');
    lines.push('');
  }

  if (params.diagnosticContext && Object.keys(params.diagnosticContext).length > 0) {
    lines.push('#### Diagnostic Context');
    lines.push('');
    lines.push('| Parameter | Value |');
    lines.push('| :--- | :--- |');
    for (const [key, val] of Object.entries(params.diagnosticContext)) {
      if (val !== undefined) {
        lines.push(`| **${escapeMarkdown(key)}** | \`${escapeMarkdown(String(val))}\` |`);
      }
    }
    lines.push('');
  }

  lines.push('#### Recovery Checklist');
  lines.push('');
  lines.push(`- [ ] Inspect failed workflow logs: [View Execution Logs](${params.runUrl})`);
  lines.push('- [ ] Identify failing step or preflight assertion.');
  lines.push('- [ ] Determine whether failure is transient (network timeout) or persistent (schema mismatch / conflict).');
  lines.push('- [ ] Confirm whether any state transaction completed or rolled back (`pet/ledger/activity-journal.json`).');
  lines.push('- [ ] Confirm whether re-running the workflow is safe.');
  lines.push('- [ ] Close this issue once workflow recovery has been confirmed.');
  lines.push('');
  lines.push(formatFingerprintComment(fingerprint));

  return lines.join('\n');
}

/**
 * Formats a concise comment posted to an existing open failure issue upon repeated failure.
 */
export function formatFailureUpdateComment(params: FailureAlertPayloadParams): string {
  const fingerprint = createAlertFingerprint({
    repository: params.repository,
    workflowFile: params.workflowFile,
    category: params.category,
  });

  const lines: string[] = [
    '### 🔄 Repeated Workflow Failure Detected',
    '',
    `An additional failure has occurred for this active incident during run [${params.runId}](${params.runUrl}) (attempt ${params.runAttempt}) on branch \`${escapeMarkdown(params.branch)}\` at \`${params.failureTimeIso}\`.`,
    '',
    '| Field | Value |',
    '| :--- | :--- |',
    `| **Run ID** | [${params.runId}](${params.runUrl}) |`,
    `| **Attempt** | ${params.runAttempt} |`,
    `| **Commit** | \`${escapeMarkdown(params.headSha)}\` |`,
    `| **Conclusion** | \`${escapeMarkdown(params.conclusion.toUpperCase())}\` |`,
    '',
  ];

  if (params.failureSummary) {
    lines.push(`> [!NOTE]\n> ${escapeMarkdown(params.failureSummary)}`);
    lines.push('');
  }

  lines.push(formatFingerprintComment(fingerprint));
  return lines.join('\n');
}

export interface RecoveryNoticeParams {
  workflowName: string;
  workflowFile: string;
  runId: number | string;
  repository: string;
  branch: string;
  headSha: string;
  recoveryTimeIso: string;
  runUrl: string;
  category?: string;
}

/**
 * Formats a recovery notification comment when a previously failing workflow succeeds.
 */
export function formatRecoveryComment(params: RecoveryNoticeParams): string {
  const fingerprint = createAlertFingerprint({
    repository: params.repository,
    workflowFile: params.workflowFile,
    category: params.category,
  });

  const lines: string[] = [
    '### ✅ Workflow Execution Recovered',
    '',
    `The workflow **${escapeMarkdown(params.workflowName)}** has completed successfully during run [${params.runId}](${params.runUrl}) on branch \`${escapeMarkdown(params.branch)}\` at \`${params.recoveryTimeIso}\`.`,
    '',
    `**Verified Commit:** \`${escapeMarkdown(params.headSha)}\``,
    '',
    '> [!TIP]',
    '> The active incident appears resolved. Please inspect logs and close this issue if recovery is confirmed.',
    '',
    formatFingerprintComment(fingerprint),
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// GitHub API Client Interface & Implementation
// ---------------------------------------------------------------------------

export interface AlertGitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  html_url?: string;
  labels?: Array<{ name: string } | string>;
}

export interface GitHubAlertClient {
  findOpenIssueByFingerprint(repository: string, fingerprint: string): Promise<AlertGitHubIssue | null>;
  createIssue(repository: string, params: { title: string; body: string; labels: string[] }): Promise<AlertGitHubIssue>;
  addComment(repository: string, issueNumber: number, body: string): Promise<{ id: number; html_url?: string }>;
}

export class DefaultGitHubAlertClient implements GitHubAlertClient {
  private token: string;
  private apiBase: string;

  constructor(options: { token: string; apiBase?: string }) {
    this.token = options.token;
    this.apiBase = (options.apiBase || 'https://api.github.com').replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiBase}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'User-Agent': 'GitHub-Profile-Pet-FailureAlert/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers as Record<string, string>),
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`GitHub API error HTTP ${res.status} on ${options.method || 'GET'} ${endpoint}: ${errText}`);
    }
    return res.json() as Promise<T>;
  }

  async findOpenIssueByFingerprint(repository: string, fingerprint: string): Promise<AlertGitHubIssue | null> {
    const targetFingerprint = fingerprint.toLowerCase();
    // 1. Fetch recent open issues labeled with alert label
    const endpoint = `/repos/${repository}/issues?state=open&per_page=100`;
    let issues: AlertGitHubIssue[] = [];
    try {
      issues = await this.request<AlertGitHubIssue[]>(endpoint, { method: 'GET' });
    } catch (err) {
      console.warn(`[FAILURE_ALERT] Failed to query open issues from GitHub API: ${(err as Error).message}`);
      return null;
    }

    for (const issue of issues) {
      if (issue.body) {
        const fp = extractAlertFingerprint(issue.body);
        if (fp === targetFingerprint) {
          return issue;
        }
      }
    }
    return null;
  }

  async createIssue(repository: string, params: { title: string; body: string; labels: string[] }): Promise<AlertGitHubIssue> {
    const endpoint = `/repos/${repository}/issues`;
    try {
      return await this.request<AlertGitHubIssue>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          labels: params.labels,
        }),
      });
    } catch (err) {
      // If label failed (e.g. 422 Unprocessable Entity due to missing label), retry without label
      if ((err as Error).message.includes('422')) {
        console.warn('[FAILURE_ALERT] Issue creation failed with label. Retrying without labels...');
        return await this.request<AlertGitHubIssue>(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: params.title,
            body: params.body,
          }),
        });
      }
      throw err;
    }
  }

  async addComment(repository: string, issueNumber: number, body: string): Promise<{ id: number; html_url?: string }> {
    const endpoint = `/repos/${repository}/issues/${issueNumber}/comments`;
    return await this.request<{ id: number; html_url?: string }>(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  }
}

// ---------------------------------------------------------------------------
// Failure Alert Orchestrator
// ---------------------------------------------------------------------------

export type AlertExecutionStatus =
  | 'CREATED_NEW_ISSUE'
  | 'UPDATED_EXISTING_ISSUE'
  | 'POSTED_RECOVERY_COMMENT'
  | 'NOOP_SUCCESS'
  | 'SKIPPED_CONCLUSION'
  | 'DISABLED'
  | 'DRY_RUN'
  | 'IGNORED_FORK'
  | 'ERROR';

export interface FailureAlertExecutionOptions {
  workflowName: string;
  workflowFile: string;
  runId: number | string;
  runAttempt?: number | string;
  repository: string;
  branch: string;
  headSha: string;
  eventName: string;
  conclusion: string; // 'failure', 'timed_out', 'success', 'cancelled', 'skipped'
  runUrl?: string;
  failureSummary?: string;
  diagnosticContext?: Record<string, string | number | boolean | undefined>;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
  isFork?: boolean;
  client?: GitHubAlertClient;
  nowIso?: string;
}

export interface FailureAlertExecutionResult {
  status: AlertExecutionStatus;
  message: string;
  fingerprint: string;
  issueNumber?: number;
  issueUrl?: string;
  commentId?: number;
  payload?: {
    title?: string;
    body?: string;
  };
  error?: Error;
}

/**
 * Main alerting workflow evaluation engine.
 */
export async function executeFailureAlert(
  options: FailureAlertExecutionOptions
): Promise<FailureAlertExecutionResult> {
  const env = options.env || process.env;
  const nowIso = options.nowIso || new Date().toISOString();
  const runAttempt = options.runAttempt || 1;
  const runUrl = options.runUrl || `https://github.com/${options.repository}/actions/runs/${options.runId}`;
  const conclusion = (options.conclusion || '').toLowerCase().trim();

  const fingerprint = createAlertFingerprint({
    repository: options.repository,
    workflowFile: options.workflowFile,
  });

  // 1. Guard against fork PR privilege escalation
  if (options.isFork) {
    return {
      status: 'IGNORED_FORK',
      message: 'Alert ignored: event originated from a fork repository.',
      fingerprint,
    };
  }

  // 2. Filter non-alertable conclusions
  const isFailure = conclusion === 'failure' || conclusion === 'timed_out';
  const isSuccess = conclusion === 'success';

  if (!isFailure && !isSuccess) {
    return {
      status: 'SKIPPED_CONCLUSION',
      message: `Alert skipped for non-qualifying workflow conclusion: '${conclusion}'.`,
      fingerprint,
    };
  }

  // 3. Activation Guard (Disabled by Default: FAILURE_ALERTS_ENABLED=false)
  const isEnabled = (env.FAILURE_ALERTS_ENABLED || '').toLowerCase().trim() === 'true';
  const isDryRun = options.dryRun || !isEnabled;

  // 4. Client initialization
  const token = (env.GITHUB_TOKEN || '').trim();
  const client: GitHubAlertClient = options.client || new DefaultGitHubAlertClient({ token });

  // 5. Handle Workflow Recovery on Success
  if (isSuccess) {
    if (isDryRun) {
      return {
        status: options.dryRun ? 'DRY_RUN' : 'DISABLED',
        message: 'Recovery check completed in dry-run/disabled mode. Zero external mutations performed.',
        fingerprint,
      };
    }

    try {
      const existingIssue = await client.findOpenIssueByFingerprint(options.repository, fingerprint);
      if (existingIssue) {
        const commentBody = formatRecoveryComment({
          workflowName: options.workflowName,
          workflowFile: options.workflowFile,
          runId: options.runId,
          repository: options.repository,
          branch: options.branch,
          headSha: options.headSha,
          recoveryTimeIso: nowIso,
          runUrl,
        });

        const comment = await client.addComment(options.repository, existingIssue.number, commentBody);
        return {
          status: 'POSTED_RECOVERY_COMMENT',
          message: `Posted recovery comment to existing open alert issue #${existingIssue.number}.`,
          fingerprint,
          issueNumber: existingIssue.number,
          commentId: comment.id,
          issueUrl: existingIssue.html_url,
        };
      }

      return {
        status: 'NOOP_SUCCESS',
        message: 'Workflow succeeded and no active alert issue exists.',
        fingerprint,
      };
    } catch (err) {
      console.warn(`[FAILURE_ALERT] Error during recovery check: ${(err as Error).message}`);
      return {
        status: 'ERROR',
        message: `Recovery check encountered an API error: ${(err as Error).message}`,
        fingerprint,
        error: err as Error,
      };
    }
  }

  // 6. Handle Genuine Failure (conclusion === 'failure' || conclusion === 'timed_out')
  const payloadParams: FailureAlertPayloadParams = {
    workflowName: options.workflowName,
    workflowFile: options.workflowFile,
    runId: options.runId,
    runAttempt,
    repository: options.repository,
    branch: options.branch,
    headSha: options.headSha,
    eventName: options.eventName,
    failureTimeIso: nowIso,
    runUrl,
    conclusion,
    failureSummary: options.failureSummary,
    diagnosticContext: options.diagnosticContext,
  };

  const title = formatFailureIssueTitle({
    workflowName: options.workflowName,
    runId: options.runId,
  });
  const body = formatFailureIssueBody(payloadParams);

  if (isDryRun) {
    const reason = options.dryRun ? 'Explicit --dry-run active' : 'FAILURE_ALERTS_ENABLED is false or unset';
    return {
      status: options.dryRun ? 'DRY_RUN' : 'DISABLED',
      message: `Alert payload generated successfully (${reason}). Issue creation withheld.`,
      fingerprint,
      payload: { title, body },
    };
  }

  // 7. Perform Active Deduplicated Issue Search & Creation
  try {
    const existingIssue = await client.findOpenIssueByFingerprint(options.repository, fingerprint);

    if (existingIssue) {
      // Deduplicated: Update existing issue with comment
      const updateBody = formatFailureUpdateComment(payloadParams);
      const comment = await client.addComment(options.repository, existingIssue.number, updateBody);

      return {
        status: 'UPDATED_EXISTING_ISSUE',
        message: `Deduplicated repeated failure against active issue #${existingIssue.number}.`,
        fingerprint,
        issueNumber: existingIssue.number,
        commentId: comment.id,
        issueUrl: existingIssue.html_url,
        payload: { title, body: updateBody },
      };
    }

    // First failure: Create new tracking issue
    let newIssue: AlertGitHubIssue;
    try {
      newIssue = await client.createIssue(options.repository, {
        title,
        body,
        labels: [ALERT_LABEL_DEFAULT],
      });
    } catch (createErr) {
      if ((createErr as Error).message?.includes('422')) {
        console.warn('[FAILURE_ALERT] Issue creation failed with label (HTTP 422). Retrying without labels...');
        newIssue = await client.createIssue(options.repository, {
          title,
          body,
          labels: [],
        });
      } else {
        throw createErr;
      }
    }

    return {
      status: 'CREATED_NEW_ISSUE',
      message: `Created new alert issue #${newIssue.number} for workflow failure.`,
      fingerprint,
      issueNumber: newIssue.number,
      issueUrl: newIssue.html_url,
      payload: { title, body },
    };
  } catch (err) {
    console.warn(`[FAILURE_ALERT] Failure alerting encountered an API error: ${(err as Error).message}`);
    return {
      status: 'ERROR',
      message: `Failed to deliver failure alert: ${(err as Error).message}`,
      fingerprint,
      error: err as Error,
    };
  }
}
