// src/app/api/auth/login/route.ts
// Initiates GitHub App OAuth 2.0 authorization flow with cryptographically random state

import { generateRandomToken } from '../../../../lib/security/crypto.ts';
import { sanitizeReturnUrl } from '../../../../lib/security/csrf.ts';
import {
  buildGitHubAuthorizationUrl,
} from '../../../../lib/auth/githubAuth.ts';
import {
  formatOAuthStateCookie,
  formatOAuthReturnCookie,
} from '../../../../lib/auth/sessionContext.ts';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawReturnUrl = url.searchParams.get('returnUrl');
  const returnUrl = sanitizeReturnUrl(rawReturnUrl, '/');

  // Generate 256-bit cryptographic state
  const state = generateRandomToken(32);

  const clientId = process.env.GITHUB_CLIENT_ID || 'dummy_client_id';
  const callbackUrl =
    process.env.GITHUB_CALLBACK_URL || `${url.origin}/api/auth/callback`;

  // Default: zero extra scopes requested (public trainer identity only)
  const authUrl = buildGitHubAuthorizationUrl({
    clientId,
    redirectUri: callbackUrl,
    state,
  });

  const headers = new Headers();
  headers.set('Location', authUrl);
  headers.append('Set-Cookie', formatOAuthStateCookie(state));
  headers.append('Set-Cookie', formatOAuthReturnCookie(returnUrl));

  // 302 Found redirect to GitHub authorization page
  return new Response(null, {
    status: 302,
    headers,
  });
}
