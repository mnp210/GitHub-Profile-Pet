// src/lib/auth/githubAuth.ts
// GitHub App User-to-Server OAuth 2.0 authorization, token exchange, user identity, and grant revocation

export interface GitHubTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null; // Seconds until access token expires (typically 28,800 for GitHub App)
  refreshTokenExpiresIn?: number | null; // Seconds until refresh token expires (typically 15,811,200 / 6 months)
  tokenType: string;
  scope: string;
}

export interface GitHubUserProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GitHubAuthClient {
  exchangeCode(code: string, redirectUri: string): Promise<GitHubTokens>;
  fetchUser(accessToken: string): Promise<GitHubUserProfile>;
  revokeGrant(accessToken: string): Promise<{ success: boolean; status: number; error?: string }>;
  refreshToken?(refreshToken: string): Promise<GitHubTokens>;
}

/**
 * Standard Production GitHub Auth Client executing real HTTPS requests against GitHub APIs.
 */
class ProductionGitHubAuthClient implements GitHubAuthClient {
  public async exchangeCode(code: string, redirectUri: string): Promise<GitHubTokens> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is missing from server environment.');
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'GitHub-Profile-Pet',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`GitHub token exchange HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
    }

    if (!data.access_token) {
      throw new Error('GitHub token exchange did not return an access_token.');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
      refreshTokenExpiresIn:
        typeof data.refresh_token_expires_in === 'number' ? data.refresh_token_expires_in : null,
      tokenType: data.token_type || 'bearer',
      scope: data.scope || '',
    };
  }

  public async refreshToken(refreshToken: string): Promise<GitHubTokens> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is missing from server environment.');
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'GitHub-Profile-Pet',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`GitHub token refresh HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`GitHub OAuth refresh error: ${data.error_description || data.error}`);
    }

    if (!data.access_token) {
      throw new Error('GitHub token refresh did not return an access_token.');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
      refreshTokenExpiresIn:
        typeof data.refresh_token_expires_in === 'number' ? data.refresh_token_expires_in : null,
      tokenType: data.token_type || 'bearer',
      scope: data.scope || '',
    };
  }

  public async fetchUser(accessToken: string): Promise<GitHubUserProfile> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'GitHub-Profile-Pet',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user from GitHub API: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (typeof data.id !== 'number' || typeof data.login !== 'string') {
      throw new Error('Invalid or malformed user identity payload from GitHub API.');
    }

    return {
      id: data.id,
      login: data.login,
      name: data.name || null,
      avatar_url: data.avatar_url || '',
    };
  }

  public async revokeGrant(accessToken: string): Promise<{ success: boolean; status: number; error?: string }> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return { success: false, status: 500, error: 'Missing GitHub App credentials for upstream revocation.' };
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
      // 3-second strict network timeout as defined in Stage 2.0C Section 4.1
      const response = await fetch(`https://api.github.com/applications/${clientId}/grant`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'GitHub-Profile-Pet',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal: AbortSignal.timeout(3_000),
      });

      // 204 No Content indicates success; 404 Not Found indicates grant was already revoked/expired
      if (response.status === 204 || response.status === 404) {
        return { success: true, status: response.status };
      }

      return {
        success: false,
        status: response.status,
        error: `GitHub revocation returned unexpected HTTP status: ${response.status}`,
      };
    } catch (err) {
      return {
        success: false,
        status: 504,
        error: `Upstream grant revocation timed out or network error: ${(err as Error).message}`,
      };
    }
  }
}

// Active client instance (mockable in testing)
let activeClient: GitHubAuthClient = new ProductionGitHubAuthClient();

export function setGitHubAuthClient(client: GitHubAuthClient): void {
  activeClient = client;
}

export function resetGitHubAuthClient(): void {
  activeClient = new ProductionGitHubAuthClient();
}

export function getGitHubAuthClient(): GitHubAuthClient {
  return activeClient;
}

/**
 * Builds the GitHub OAuth authorization URL for standard zero-permission identity authentication.
 */
export function buildGitHubAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);

  // Default: zero scopes requested
  if (params.scope) {
    url.searchParams.set('scope', params.scope);
  }

  return url.toString();
}
