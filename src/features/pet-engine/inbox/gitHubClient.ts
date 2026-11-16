/**
 * GitHub Profile Pet - GitHub REST API Inbox Client
 * Communicates with GitHub's REST API using standard fetch and ephemeral GITHUB_TOKEN.
 */

import type {
  GitHubInboxClient,
  GitHubIssue,
  GitHubIssueComment,
  PendingIssuesPageResult,
} from './types.ts';

export class DefaultGitHubInboxClient implements GitHubInboxClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token.trim();
    this.baseUrl = (baseUrl ?? process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<{ status: number; data: T }> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'GitHub-Profile-Pet-Inbox/1.0',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const status = response.status;
      let data: T;
      if (status === 204) {
        data = null as unknown as T;
      } else {
        const text = await response.text();
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = text as unknown as T;
        }
      }

      return { status, data };
    } catch (err: unknown) {
      // Redact token from error messages
      const safeMessage = (err as Error).message.replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[REDACTED_TOKEN]');
      throw new Error(`GitHub API request failed: ${safeMessage}`);
    }
  }

  /**
   * Discovers all open issues with label 'pet-action:pending' sorted chronologically.
   * Supports bounded pagination with configurable page size and max page bounds.
   */
  async listPendingIssues(
    repo: string,
    options?: { page?: number; perPage?: number; maxPages?: number }
  ): Promise<PendingIssuesPageResult> {
    const cleanRepo = repo.replace(/^\/+|\/+$/g, '');
    const perPage = Math.min(Math.max(options?.perPage ?? 100, 1), 100);
    const maxPages = Math.max(options?.maxPages ?? 5, 1);
    const startPage = Math.max(options?.page ?? 1, 1);

    const allIssues: GitHubIssue[] = [];
    let currentPage = startPage;
    let hasMore = false;

    while (currentPage < startPage + maxPages) {
      const endpoint = `/repos/${cleanRepo}/issues?state=open&labels=pet-action:pending&sort=created&direction=asc&page=${currentPage}&per_page=${perPage}`;
      try {
        const res = await this.request<GitHubIssue[]>(endpoint, { method: 'GET' });
        if (res.status !== 200 || !Array.isArray(res.data)) {
          if (currentPage === startPage) {
            throw new Error(`Failed to list pending issues (HTTP ${res.status}): ${JSON.stringify(res.data)}`);
          }
          // On later page failure, return what we have so far and flag hasMore
          hasMore = true;
          break;
        }

        const validIssues = res.data.filter((item) => item && !item.pull_request);
        allIssues.push(...validIssues);

        if (res.data.length < perPage) {
          hasMore = false;
          break;
        }

        currentPage++;
      } catch (err) {
        if (currentPage === startPage) {
          throw err;
        }
        hasMore = true;
        break;
      }
    }

    if (currentPage >= startPage + maxPages && allIssues.length >= maxPages * perPage) {
      hasMore = true;
    }

    return {
      issues: allIssues,
      hasMore,
      pageCount: currentPage - startPage,
    };
  }

  /**
   * Lists comments for a specific issue with bounded pagination.
   */
  async listIssueComments(
    repo: string,
    issueNumber: number,
    options?: { page?: number; perPage?: number }
  ): Promise<GitHubIssueComment[]> {
    const cleanRepo = repo.replace(/^\/+|\/+$/g, '');
    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 100;
    const endpoint = `/repos/${cleanRepo}/issues/${issueNumber}/comments?page=${page}&per_page=${perPage}`;

    const res = await this.request<GitHubIssueComment[]>(endpoint, { method: 'GET' });
    if (res.status === 200 && Array.isArray(res.data)) {
      return res.data;
    }
    if (res.status === 403 || res.status === 429) {
      throw new Error(
        `GitHub API rate limit exceeded (HTTP ${res.status}) while listing comments for issue #${issueNumber}`
      );
    }
    throw new Error(
      `Failed to list comments for issue #${issueNumber}: HTTP ${res.status}`
    );
  }

  /**
   * Retrieves individual issue or pull request details by number to inspect gap status.
   */
  async getIssue(repo: string, issueNumber: number): Promise<{ status: number; issue?: GitHubIssue }> {
    const cleanRepo = repo.replace(/^\/+|\/+$/g, '');
    const endpoint = `/repos/${cleanRepo}/issues/${issueNumber}`;

    const res = await this.request<GitHubIssue>(endpoint, { method: 'GET' });
    if (res.status === 200) {
      return { status: 200, issue: res.data };
    }
    return { status: res.status };
  }

  /**
   * Posts an outcome comment on the target issue.
   */
  async commentIssue(repo: string, issueNumber: number, comment: string): Promise<void> {
    const cleanRepo = repo.replace(/^\/+|\/+$/g, '');
    const endpoint = `/repos/${cleanRepo}/issues/${issueNumber}/comments`;

    const res = await this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify({ body: comment }),
    });

    if (res.status !== 201) {
      throw new Error(`Failed to comment on issue #${issueNumber} (HTTP ${res.status})`);
    }
  }

  /**
   * Closes an issue and optionally applies an outcome label.
   */
  async closeIssue(repo: string, issueNumber: number, labelToAdd?: string): Promise<void> {
    const cleanRepo = repo.replace(/^\/+|\/+$/g, '');
    const endpoint = `/repos/${cleanRepo}/issues/${issueNumber}`;

    const res = await this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to close issue #${issueNumber} (HTTP ${res.status})`);
    }

    if (labelToAdd) {
      await this.addLabels(cleanRepo, issueNumber, [labelToAdd]);
      await this.removeLabel(cleanRepo, issueNumber, 'pet-action:pending').catch(() => {});
    }
  }

  /**
   * Adds labels to an issue.
   */
  async addLabels(repo: string, issueNumber: number, labels: string[]): Promise<void> {
    const cleanRepo = repo.replace(/^\/+|\/+$/g, '');
    const endpoint = `/repos/${cleanRepo}/issues/${issueNumber}/labels`;

    const res = await this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify({ labels }),
    });

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Failed to add labels to issue #${issueNumber} (HTTP ${res.status})`);
    }
  }

  /**
   * Removes a label from an issue.
   */
  async removeLabel(repo: string, issueNumber: number, label: string): Promise<void> {
    const cleanRepo = repo.replace(/^\/+|\/+$/g, '');
    const endpoint = `/repos/${cleanRepo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`;

    const res = await this.request(endpoint, { method: 'DELETE' });
    if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
      throw new Error(`Failed to remove label '${label}' from issue #${issueNumber} (HTTP ${res.status})`);
    }
  }
}
