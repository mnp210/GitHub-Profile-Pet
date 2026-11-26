/**
 * GitHub Profile Pet — Workflow Failure Alerting CLI & Actions Entrypoint
 *
 * Evaluates completed workflow runs, verifies failure conclusions, enforces
 * deduplication against open alert issues, sanitizes diagnostics, and produces
 * or updates GitHub failure tracking issues when FAILURE_ALERTS_ENABLED=true.
 *
 * Usage:
 *   node --experimental-strip-types scripts/alert-workflow-failure.ts [--dry-run]
 *   node --experimental-strip-types scripts/alert-workflow-failure.ts --workflow-name "Pet Activity Progression" --workflow-file pet-activity.yml --run-id 12345 --conclusion failure --dry-run
 */

import * as fs from 'node:fs';
import {
  executeFailureAlert,
  writeStepSummary,
  type FailureAlertExecutionOptions,
} from '../src/features/pet-engine/reporting/index.ts';

interface GitHubWorkflowRunEvent {
  action?: string;
  workflow_run?: {
    id: number;
    name: string;
    path: string;
    head_branch: string;
    head_sha: string;
    event: string;
    conclusion: string; // 'failure', 'timed_out', 'success', 'cancelled', 'skipped'
    html_url: string;
    run_attempt?: number;
    head_repository?: {
      full_name: string;
      fork: boolean;
    };
    repository?: {
      full_name: string;
    };
  };
}

export function parseArgs(args: string[]): {
  workflowName?: string;
  workflowFile?: string;
  runId?: number | string;
  runAttempt?: number | string;
  repository?: string;
  branch?: string;
  headSha?: string;
  eventName?: string;
  conclusion?: string;
  runUrl?: string;
  dryRun: boolean;
  help: boolean;
} {
  let workflowName: string | undefined;
  let workflowFile: string | undefined;
  let runId: number | string | undefined;
  let runAttempt: number | string | undefined;
  let repository: string | undefined;
  let branch: string | undefined;
  let headSha: string | undefined;
  let eventName: string | undefined;
  let conclusion: string | undefined;
  let runUrl: string | undefined;
  let dryRun = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--workflow-name' && i + 1 < args.length) {
      workflowName = args[++i];
    } else if (arg === '--workflow-file' && i + 1 < args.length) {
      workflowFile = args[++i];
    } else if (arg === '--run-id' && i + 1 < args.length) {
      runId = args[++i];
    } else if (arg === '--run-attempt' && i + 1 < args.length) {
      runAttempt = args[++i];
    } else if (arg === '--repository' && i + 1 < args.length) {
      repository = args[++i];
    } else if (arg === '--branch' && i + 1 < args.length) {
      branch = args[++i];
    } else if (arg === '--head-sha' && i + 1 < args.length) {
      headSha = args[++i];
    } else if (arg === '--event-name' && i + 1 < args.length) {
      eventName = args[++i];
    } else if (arg === '--conclusion' && i + 1 < args.length) {
      conclusion = args[++i];
    } else if (arg === '--run-url' && i + 1 < args.length) {
      runUrl = args[++i];
    }
  }

  return {
    workflowName,
    workflowFile,
    runId,
    runAttempt,
    repository,
    branch,
    headSha,
    eventName,
    conclusion,
    runUrl,
    dryRun,
    help,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(`
GitHub Profile Pet — Workflow Failure Alert CLI

Options:
  --workflow-name <name>   Workflow display name (e.g. 'Pet Activity Progression')
  --workflow-file <file>   Workflow filename (e.g. 'pet-activity.yml')
  --run-id <id>            GitHub Actions run ID
  --run-attempt <num>      Run attempt number
  --repository <repo>      Target repository ('owner/repo')
  --branch <branch>        Git branch name
  --head-sha <sha>         Commit SHA
  --event-name <event>     Triggering event name
  --conclusion <status>    Workflow run conclusion ('failure', 'timed_out', 'success')
  --run-url <url>          Direct run URL
  --dry-run                Withhold issue creation (generate payload and search only)
  --help, -h               Show this help message
`);
    process.exit(0);
  }

  // 1. Resolve payload parameters (CLI args override GitHub event payload)
  let workflowName = options.workflowName;
  let workflowFile = options.workflowFile;
  let runId = options.runId;
  let runAttempt = options.runAttempt;
  let repository = options.repository || process.env.GITHUB_REPOSITORY;
  let branch = options.branch || process.env.GITHUB_REF_NAME;
  let headSha = options.headSha || process.env.GITHUB_SHA;
  let eventName = options.eventName;
  let conclusion = options.conclusion;
  let runUrl = options.runUrl;
  let isFork = false;

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      const raw = fs.readFileSync(eventPath, 'utf8');
      const eventJson = JSON.parse(raw) as GitHubWorkflowRunEvent;

      if (eventJson.workflow_run) {
        const wr = eventJson.workflow_run;
        workflowName = workflowName || wr.name;
        workflowFile = workflowFile || wr.path?.replace(/^.*[\\/]/, '');
        runId = runId || wr.id;
        runAttempt = runAttempt || wr.run_attempt || 1;
        repository = repository || wr.repository?.full_name || wr.head_repository?.full_name;
        branch = branch || wr.head_branch;
        headSha = headSha || wr.head_sha;
        eventName = eventName || wr.event;
        conclusion = conclusion || wr.conclusion;
        runUrl = runUrl || wr.html_url;
        isFork = Boolean(wr.head_repository?.fork);
      }
    } catch (err) {
      console.warn(`[FAILURE_ALERT] Could not parse event payload from GITHUB_EVENT_PATH: ${(err as Error).message}`);
    }
  }

  // Fallback defaults
  workflowName = workflowName || 'Unknown Workflow';
  workflowFile = workflowFile || 'workflow.yml';
  runId = runId || '0';
  runAttempt = runAttempt || 1;
  repository = repository || 'unknown/unknown';
  branch = branch || 'main';
  headSha = headSha || 'HEAD';
  eventName = eventName || 'unknown';
  conclusion = conclusion || 'unknown';
  runUrl = runUrl || `https://github.com/${repository}/actions/runs/${runId}`;

  console.log('================================================================');
  console.log('GitHub Profile Pet — Automated Failure Alert Evaluator');
  console.log('================================================================');
  console.log(`Workflow:      ${workflowName} (${workflowFile})`);
  console.log(`Run ID:        ${runId} (Attempt: ${runAttempt})`);
  console.log(`Repository:    ${repository}`);
  console.log(`Branch / SHA:  ${branch} @ ${headSha.slice(0, 8)}`);
  console.log(`Conclusion:    ${conclusion.toUpperCase()}`);
  console.log(`Dry-Run:       ${options.dryRun ? 'YES (Forced)' : 'NO (Governed by FAILURE_ALERTS_ENABLED)'}`);
  console.log('----------------------------------------------------------------');

  const alertOptions: FailureAlertExecutionOptions = {
    workflowName,
    workflowFile,
    runId,
    runAttempt,
    repository,
    branch,
    headSha,
    eventName,
    conclusion,
    runUrl,
    dryRun: options.dryRun,
    isFork,
  };

  const result = await executeFailureAlert(alertOptions);

  console.log(`Result Status: ${result.status}`);
  console.log(`Details:       ${result.message}`);
  console.log(`Fingerprint:   ${result.fingerprint}`);
  if (result.issueNumber) {
    console.log(`Issue Number:  #${result.issueNumber}`);
  }
  if (result.issueUrl) {
    console.log(`Issue URL:     ${result.issueUrl}`);
  }

  // Write step summary for alerting workflow itself
  const summaryLines: string[] = [
    '### 📢 Failure Alerting Execution Summary',
    '',
    `| Parameter | Value |`,
    `| :--- | :--- |`,
    `| **Target Workflow** | \`${workflowName}\` (\`${workflowFile}\`) |`,
    `| **Evaluated Run** | [${runId}](${runUrl}) |`,
    `| **Evaluated Conclusion** | \`${conclusion.toUpperCase()}\` |`,
    `| **Alert Status** | \`${result.status}\` |`,
    `| **Deduplication Fingerprint** | \`${result.fingerprint}\` |`,
  ];

  if (result.issueNumber) {
    summaryLines.push(`| **Target Issue** | #${result.issueNumber} |`);
  }
  summaryLines.push('');
  summaryLines.push(`> [!NOTE]\n> ${result.message}`);
  summaryLines.push('');

  writeStepSummary(summaryLines.join('\n'));

  // Alert evaluator always exits 0 to prevent alert loops
  process.exit(0);
}

if (process.argv[1] && (process.argv[1].endsWith('alert-workflow-failure.ts') || process.argv[1].endsWith('alert-workflow-failure.js'))) {
  main().catch((err: unknown) => {
    console.error('[FAILURE_ALERT_FATAL]', err);
    process.exit(0); // Exit 0 to avoid failure loop
  });
}
