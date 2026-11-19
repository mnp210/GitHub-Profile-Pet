// src/app/api/auth/callback/route.ts
// Handles GitHub App OAuth callback: validates state, exchanges code, retrieves profile, persists user, and creates session

import { constantTimeCompare, encryptToken, generateRandomToken } from '../../../../lib/security/crypto.ts';
import { sanitizeReturnUrl } from '../../../../lib/security/csrf.ts';
import { getGitHubAuthClient } from '../../../../lib/auth/githubAuth.ts';
import { UserRepository } from '../../../../lib/db/repositories/userRepository.ts';
import { SessionRepository } from '../../../../lib/db/repositories/sessionRepository.ts';
import {
  parseCookies,
  formatSessionCookie,
  formatClearOAuthStateCookie,
  formatClearOAuthReturnCookie,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_RETURN_COOKIE_NAME,
} from '../../../../lib/auth/sessionContext.ts';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const receivedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const expectedState = cookies[OAUTH_STATE_COOKIE_NAME];
  const returnUrl = sanitizeReturnUrl(cookies[OAUTH_RETURN_COOKIE_NAME], '/');

  // Base cleanup headers to clear OAuth state cookies on any exit path
  const cleanupHeaders = new Headers();
  cleanupHeaders.append('Set-Cookie', formatClearOAuthStateCookie());
  cleanupHeaders.append('Set-Cookie', formatClearOAuthReturnCookie());

  // 1. Handle provider denial or OAuth errors from GitHub
  if (error) {
    console.warn(`[GitHub OAuth Denied]: ${error} - ${errorDescription}`);
    cleanupHeaders.set('Location', `${url.origin}/?auth_error=${encodeURIComponent(error)}`);
    return new Response(null, { status: 302, headers: cleanupHeaders });
  }

  // 2. Validate state presence and timing-safe match
  if (!code || !receivedState || !expectedState || !constantTimeCompare(receivedState, expectedState)) {
    console.warn('[GitHub OAuth Error]: State mismatch or missing parameters.');
    cleanupHeaders.set('Location', `${url.origin}/?auth_error=invalid_state`);
    return new Response(null, { status: 302, headers: cleanupHeaders });
  }

  try {
    const callbackUrl = process.env.GITHUB_CALLBACK_URL || `${url.origin}/api/auth/callback`;
    const client = getGitHubAuthClient();

    // 3. Exchange authorization code for tokens
    const tokens = await client.exchangeCode(code, callbackUrl);

    // 4. Retrieve user identity from official GitHub API
    const ghUser = await client.fetchUser(tokens.accessToken);
    const githubUserId = String(ghUser.id);

    // 5. Encrypt tokens at rest
    const encAccessToken = encryptToken(tokens.accessToken);
    const encRefreshToken = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;

    const tokenExpiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : null;
    const refreshExpiresAt = tokens.refreshTokenExpiresIn
      ? new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000)
      : null;

    // 6. Account Association anchored on immutable numeric GitHub User ID
    let user = await UserRepository.findByGitHubUserId(githubUserId);

    if (user) {
      // Existing trainer: update username handle if changed
      await UserRepository.updateHandleIfChanged(user.user.id, ghUser.login);
      // Update encrypted tokens
      await UserRepository.updateTokens(
        user.account.id,
        encAccessToken,
        encRefreshToken,
        tokenExpiresAt,
        refreshExpiresAt
      );
    } else {
      // New trainer: atomically create GitHub account, User, Profile, and Shadow Claw
      user = await UserRepository.createTrainer({
        githubUserId,
        username: ghUser.login,
        primaryHandle: ghUser.login,
        displayName: ghUser.name || ghUser.login,
        encryptedAccessToken: encAccessToken,
        encryptedRefreshToken: encRefreshToken,
        tokenExpiresAt,
        refreshExpiresAt,
      });
    }

    // 7. Generate cryptographically random session token and persist SHA-256 hash
    const rawSessionToken = generateRandomToken(32);
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip');
    const userAgent = request.headers.get('user-agent');

    await SessionRepository.createSession({
      userId: user.user.id,
      rawToken: rawSessionToken,
      ipAddress,
      userAgent,
    });

    // 8. Set session cookie and redirect to target destination
    cleanupHeaders.append('Set-Cookie', formatSessionCookie(rawSessionToken));
    cleanupHeaders.set('Location', `${url.origin}${returnUrl}`);

    return new Response(null, {
      status: 302,
      headers: cleanupHeaders,
    });
  } catch (err) {
    console.error('[GitHub Auth Callback Failure]:', (err as Error).message);
    cleanupHeaders.set('Location', `${url.origin}/?auth_error=exchange_failed`);
    return new Response(null, {
      status: 302,
      headers: cleanupHeaders,
    });
  }
}
