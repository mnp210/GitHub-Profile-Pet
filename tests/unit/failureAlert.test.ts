import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAlertFingerprint,
  formatFingerprintComment,
  extractAlertFingerprint,
  formatFailureIssueTitle,
  formatFailureIssueBody,
  formatFailureUpdateComment,
  formatRecoveryComment,
  executeFailureAlert,
  type GitHubAlertClient,
  type AlertGitHubIssue,
  type FailureAlertExecutionOptions,
} from '../../src/features/pet-engine/reporting/failureAlert.ts';

// In-memory mock GitHub API Client for offline deterministic testing
class MockGitHubAlertClient implements GitHubAlertClient {
  public issues: AlertGitHubIssue[] = [];
  public comments: Array<{ issueNumber: number; body: string }> = [];
  public simulateNetworkError = false;
  public simulateLabelError = false;

  async findOpenIssueByFingerprint(repository: string, fingerprint: string): Promise<AlertGitHubIssue | null> {
    if (this.simulateNetworkError) {
      throw new Error('Simulated network timeout querying issues');
    }
    const targetFp = fingerprint.toLowerCase();
    for (const issue of this.issues) {
      if (issue.state === 'open' && issue.body) {
        const fp = extractAlertFingerprint(issue.body);
        if (fp === targetFp) {
          return issue;
        }
      }
    }
    return null;
  }

  async createIssue(repository: string, params: { title: string; body: string; labels: string[] }): Promise<AlertGitHubIssue> {
    if (this.simulateNetworkError) {
      throw new Error('Simulated network error on issue creation');
    }
    if (this.simulateLabelError && params.labels.length > 0) {
      throw new Error('GitHub API error HTTP 422: Label does not exist');
    }

    const newIssue: AlertGitHubIssue = {
      number: this.issues.length + 101,
      title: params.title,
      body: params.body,
      state: 'open',
      html_url: `https://github.com/${repository}/issues/${this.issues.length + 101}`,
      labels: params.labels,
    };
    this.issues.push(newIssue);
    return newIssue;
  }

  async addComment(repository: string, issueNumber: number, body: string): Promise<{ id: number; html_url?: string }> {
    if (this.simulateNetworkError) {
      throw new Error('Simulated network error on comment addition');
    }
    const id = this.comments.length + 1;
    this.comments.push({ issueNumber, body });
    return {
      id,
      html_url: `https://github.com/${repository}/issues/${issueNumber}#issuecomment-${id}`,
    };
  }
}

describe('Automated Failure Alerting & Deduplication Engine (Sprint 5.0C)', () => {
  const baseOptions: FailureAlertExecutionOptions = {
    workflowName: 'Pet Activity Progression',
    workflowFile: 'pet-activity.yml',
    runId: 45042048859,
    runAttempt: 1,
    repository: 'mnp210/GitHub-Profile-Pet',
    branch: 'main',
    headSha: '3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52',
    eventName: 'push',
    conclusion: 'failure',
    failureSummary: 'Preflight Check Failed (F-01): Git collision during push',
    diagnosticContext: {
      stage: 'git_publication',
      retriesExhausted: 3,
    },
    env: {
      FAILURE_ALERTS_ENABLED: 'true',
      GITHUB_TOKEN: 'mock_token',
    },
  };

  describe('Deterministic Fingerprinting & Identification', () => {
    it('generates consistent lowercase fingerprint across different casing and paths', () => {
      const fp1 = createAlertFingerprint({
        repository: 'mnp210/GitHub-Profile-Pet',
        workflowFile: '.github/workflows/pet-activity.yml',
      });
      const fp2 = createAlertFingerprint({
        repository: 'MNP210/github-profile-pet',
        workflowFile: 'pet-activity.yml',
      });
      assert.equal(fp1, 'mnp210/github-profile-pet:pet-activity.yml:workflow_failure');
      assert.equal(fp1, fp2);
    });

    it('generates distinct fingerprints for different workflow files', () => {
      const fpActivity = createAlertFingerprint({
        repository: 'mnp210/GitHub-Profile-Pet',
        workflowFile: 'pet-activity.yml',
      });
      const fpPublisher = createAlertFingerprint({
        repository: 'mnp210/GitHub-Profile-Pet',
        workflowFile: 'pet-publisher.yml',
      });
      assert.notEqual(fpActivity, fpPublisher);
    });

    it('embeds and extracts fingerprint from Markdown comment body', () => {
      const fp = 'mnp210/github-profile-pet:pet-activity.yml:workflow_failure';
      const comment = formatFingerprintComment(fp);
      const text = `Some issue text\n\n${comment}\n\nFooter details`;
      const extracted = extractAlertFingerprint(text);
      assert.equal(extracted, fp);
    });

    it('formats failure update and recovery comments with valid fingerprint and details', () => {
      const update = formatFailureUpdateComment({
        ...baseOptions,
        failureTimeIso: '2026-11-22T20:30:00.000Z',
        runUrl: 'https://example.com/run-2',
        runAttempt: 2,
      });
      assert.match(update, /Repeated Workflow Failure Detected/);
      assert.match(update, /<!-- FAILURE_ALERT_FINGERPRINT:mnp210\/github-profile-pet:pet-activity.yml:workflow_failure -->/);

      const recovery = formatRecoveryComment({
        workflowName: baseOptions.workflowName,
        workflowFile: baseOptions.workflowFile,
        runId: 999999,
        repository: baseOptions.repository,
        branch: baseOptions.branch,
        headSha: baseOptions.headSha,
        recoveryTimeIso: '2026-11-22T21:00:00.000Z',
        runUrl: 'https://example.com/run-recovery',
      });
      assert.match(recovery, /Workflow Execution Recovered/);
      assert.match(recovery, /The active incident appears resolved/);
      assert.match(recovery, /<!-- FAILURE_ALERT_FINGERPRINT:mnp210\/github-profile-pet:pet-activity.yml:workflow_failure -->/);
    });
  });

  describe('Security & Sanitization Safeguards', () => {
    it('redacts tokens and bearer credentials from issue title and body', () => {
      const dirtyOptions = {
        ...baseOptions,
        workflowName: 'Push with ghp_123456789012345678901234567890123456',
        failureSummary: 'Failed using Bearer secret_bearer_token_longer_than_20_chars',
      };
      const title = formatFailureIssueTitle({
        workflowName: dirtyOptions.workflowName,
        runId: dirtyOptions.runId,
      });
      const body = formatFailureIssueBody({
        ...dirtyOptions,
        failureTimeIso: '2026-11-22T20:00:00.000Z',
        runUrl: 'https://example.com/run',
      });

      assert.doesNotMatch(title, /ghp_/);
      assert.match(title, /\*\*\*REDACTED\*\*\*/);
      assert.doesNotMatch(body, /secret_bearer_token/);
      assert.match(body, /Bearer \*\*\*REDACTED\*\*\*/);
    });

    it('escapes Markdown pipes and HTML brackets in diagnostic context and summary', () => {
      const body = formatFailureIssueBody({
        ...baseOptions,
        failureSummary: '<script>alert("xss")</script> | Broken table | row',
        diagnosticContext: {
          rawOutput: '<malformed_xml> | value',
        },
        failureTimeIso: '2026-11-22T20:00:00.000Z',
        runUrl: 'https://example.com/run',
      });

      assert.doesNotMatch(body, /<script>/);
      assert.match(body, /&lt;script&gt;/);
      assert.match(body, /\\\|/);
    });

    it('blocks execution when event originates from a foreign fork (Fork PR Guard)', async () => {
      const client = new MockGitHubAlertClient();
      const result = await executeFailureAlert({
        ...baseOptions,
        isFork: true,
        client,
      });

      assert.equal(result.status, 'IGNORED_FORK');
      assert.equal(client.issues.length, 0);
    });
  });

  describe('Activation Boundary & Dry-Run Controls', () => {
    it('disables issue creation when FAILURE_ALERTS_ENABLED is missing or unset', async () => {
      const client = new MockGitHubAlertClient();
      const result = await executeFailureAlert({
        ...baseOptions,
        env: {}, // Missing FAILURE_ALERTS_ENABLED
        client,
      });

      assert.equal(result.status, 'DISABLED');
      assert.equal(client.issues.length, 0);
      assert.ok(result.payload?.title);
      assert.ok(result.payload?.body);
    });

    it('disables issue creation when FAILURE_ALERTS_ENABLED is "false"', async () => {
      const client = new MockGitHubAlertClient();
      const result = await executeFailureAlert({
        ...baseOptions,
        env: { FAILURE_ALERTS_ENABLED: 'false' },
        client,
      });

      assert.equal(result.status, 'DISABLED');
      assert.equal(client.issues.length, 0);
    });

    it('withholds issue creation when dryRun option is explicitly true', async () => {
      const client = new MockGitHubAlertClient();
      const result = await executeFailureAlert({
        ...baseOptions,
        dryRun: true,
        client,
      });

      assert.equal(result.status, 'DRY_RUN');
      assert.equal(client.issues.length, 0);
      assert.ok(result.payload?.title);
      assert.ok(result.payload?.body);
    });
  });

  describe('Workflow Conclusion Filtering', () => {
    it('ignores cancelled workflow runs without creating issues', async () => {
      const client = new MockGitHubAlertClient();
      const result = await executeFailureAlert({
        ...baseOptions,
        conclusion: 'cancelled',
        client,
      });

      assert.equal(result.status, 'SKIPPED_CONCLUSION');
      assert.equal(client.issues.length, 0);
    });

    it('ignores skipped workflow runs without creating issues', async () => {
      const client = new MockGitHubAlertClient();
      const result = await executeFailureAlert({
        ...baseOptions,
        conclusion: 'skipped',
        client,
      });

      assert.equal(result.status, 'SKIPPED_CONCLUSION');
      assert.equal(client.issues.length, 0);
    });

    it('treats timed_out conclusions as qualifying failures', async () => {
      const client = new MockGitHubAlertClient();
      const result = await executeFailureAlert({
        ...baseOptions,
        conclusion: 'timed_out',
        client,
      });

      assert.equal(result.status, 'CREATED_NEW_ISSUE');
      assert.equal(client.issues.length, 1);
      assert.match(client.issues[0].title, /Pet Activity Progression/);
    });
  });

  describe('Deduplication & Lifecycle State Machine', () => {
    it('creates exactly 1 issue on initial failure, and updates existing issue on subsequent failure', async () => {
      const client = new MockGitHubAlertClient();

      // 1. Initial Failure
      const firstResult = await executeFailureAlert({
        ...baseOptions,
        runId: 1001,
        client,
      });
      assert.equal(firstResult.status, 'CREATED_NEW_ISSUE');
      assert.equal(client.issues.length, 1);
      const openIssue = client.issues[0];
      assert.equal(openIssue.number, 101);

      // 2. Repeated Failure of the same workflow (Deduplication)
      const secondResult = await executeFailureAlert({
        ...baseOptions,
        runId: 1002,
        runAttempt: 2,
        client,
      });
      assert.equal(secondResult.status, 'UPDATED_EXISTING_ISSUE');
      assert.equal(secondResult.issueNumber, 101);
      assert.equal(client.issues.length, 1); // No new issue created!
      assert.equal(client.comments.length, 1); // Comment appended to issue 101
      assert.match(client.comments[0].body, /Repeated Workflow Failure Detected/);
      assert.match(client.comments[0].body, /run \[1002\]/i);
    });

    it('creates distinct issues for two different workflows failing concurrently', async () => {
      const client = new MockGitHubAlertClient();

      // Failure in Pet Activity
      const resActivity = await executeFailureAlert({
        ...baseOptions,
        workflowName: 'Pet Activity Progression',
        workflowFile: 'pet-activity.yml',
        runId: 1001,
        client,
      });

      // Failure in Pet Publisher
      const resPublisher = await executeFailureAlert({
        ...baseOptions,
        workflowName: 'Pet SVG Publication',
        workflowFile: 'pet-publisher.yml',
        runId: 1002,
        client,
      });

      assert.equal(resActivity.status, 'CREATED_NEW_ISSUE');
      assert.equal(resPublisher.status, 'CREATED_NEW_ISSUE');
      assert.equal(client.issues.length, 2);
      assert.notEqual(resActivity.issueNumber, resPublisher.issueNumber);
    });

    it('allows a new failure alert if a previous historical issue has been closed', async () => {
      const client = new MockGitHubAlertClient();

      // 1. Initial Failure
      await executeFailureAlert({
        ...baseOptions,
        runId: 1001,
        client,
      });
      assert.equal(client.issues.length, 1);

      // 2. Operator closes the issue
      client.issues[0].state = 'closed';

      // 3. New Independent Failure occurs
      const newFailureResult = await executeFailureAlert({
        ...baseOptions,
        runId: 1005,
        client,
      });

      assert.equal(newFailureResult.status, 'CREATED_NEW_ISSUE');
      assert.equal(client.issues.length, 2);
      assert.equal(newFailureResult.issueNumber, 102);
    });

    it('posts recovery comment when an open issue exists and workflow succeeds', async () => {
      const client = new MockGitHubAlertClient();

      // 1. Initial Failure creates issue
      await executeFailureAlert({
        ...baseOptions,
        runId: 1001,
        client,
      });
      assert.equal(client.issues.length, 1);

      // 2. Workflow subsequently succeeds
      const recoveryResult = await executeFailureAlert({
        ...baseOptions,
        runId: 1002,
        conclusion: 'success',
        client,
      });

      assert.equal(recoveryResult.status, 'POSTED_RECOVERY_COMMENT');
      assert.equal(client.issues.length, 1);
      assert.equal(client.comments.length, 1);
      assert.match(client.comments[0].body, /Workflow Execution Recovered/);
      assert.match(client.comments[0].body, /run \[1002\]/i);
    });

    it('performs zero noise NOOP on workflow success when no open alert issue exists', async () => {
      const client = new MockGitHubAlertClient();

      const result = await executeFailureAlert({
        ...baseOptions,
        runId: 1001,
        conclusion: 'success',
        client,
      });

      assert.equal(result.status, 'NOOP_SUCCESS');
      assert.equal(client.issues.length, 0);
      assert.equal(client.comments.length, 0);
    });
  });

  describe('Resilience & Error Fault Tolerance', () => {
    it('safely handles GitHub API failures without crashing', async () => {
      const client = new MockGitHubAlertClient();
      client.simulateNetworkError = true;

      const result = await executeFailureAlert({
        ...baseOptions,
        client,
      });

      assert.equal(result.status, 'ERROR');
      assert.match(result.message, /Failed to deliver failure alert/);
    });

    it('retries issue creation without labels if repository label creation fails with HTTP 422', async () => {
      const client = new MockGitHubAlertClient();
      client.simulateLabelError = true;

      const result = await executeFailureAlert({
        ...baseOptions,
        client,
      });

      assert.equal(result.status, 'CREATED_NEW_ISSUE');
      assert.equal(client.issues.length, 1);
    });
  });
});
