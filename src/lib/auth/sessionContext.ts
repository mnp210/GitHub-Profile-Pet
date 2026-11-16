// src/lib/auth/sessionContext.ts
// Trusted server-side user identity resolution, session cookie management, and test isolation

import { UserRepository } from '../db/repositories/userRepository.ts';
import { SessionRepository, DEFAULT_SESSION_TTL_SECONDS } from '../db/repositories/sessionRepository.ts';

export const SESSION_COOKIE_NAME = 'pet_session';
export const OAUTH_STATE_COOKIE_NAME = 'pet_oauth_state';
export const OAUTH_RETURN_COOKIE_NAME = 'pet_oauth_return';

export interface AuthenticatedUserContext {
  userId: string;
  handle: string;
  authSource: 'session' | 'test_isolated';
  sessionId?: string;
}

/**
 * Parses a standard HTTP Cookie header string into key-value pairs.
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [rawKey, ...rawVal] = pair.trim().split('=');
    if (rawKey) {
      cookies[rawKey.trim()] = decodeURIComponent(rawVal.join('=').trim());
    }
  }
  return cookies;
}

/**
 * Formats a secure Set-Cookie header for the persistent user session.
 */
export function formatSessionCookie(
  rawToken: string,
  maxAgeSeconds = DEFAULT_SESSION_TTL_SECONDS
): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Formats a Set-Cookie header that clears the user session cookie.
 */
export function formatClearSessionCookie(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Formats a short-lived HTTP-only cookie for OAuth state validation (10 minutes TTL).
 */
export function formatOAuthStateCookie(state: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Clears the OAuth state cookie.
 */
export function formatClearOAuthStateCookie(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${OAUTH_STATE_COOKIE_NAME}=`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Formats a short-lived HTTP-only cookie for post-auth return destination (10 minutes TTL).
 */
export function formatOAuthReturnCookie(returnUrl: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${OAUTH_RETURN_COOKIE_NAME}=${encodeURIComponent(returnUrl)}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Clears the OAuth return cookie.
 */
export function formatClearOAuthReturnCookie(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${OAUTH_RETURN_COOKIE_NAME}=`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Resolves the authenticated user identity strictly from trusted server-side context.
 * 
 * Hierarchy:
 * 1. Persistent session resolution via session cookie or Authorization Bearer header.
 * 2. Explicit isolated development/test identity (strictly disabled in production).
 * 
 * Never accepts client-provided user IDs from request payloads.
 */
export async function resolveServerUser(request: Request): Promise<AuthenticatedUserContext | null> {
  const isProduction = process.env.NODE_ENV === 'production';

  // 1. Session Token Extraction strictly from secure HttpOnly cookie
  let rawSessionToken: string | null = null;

  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies[SESSION_COOKIE_NAME]) {
      rawSessionToken = cookies[SESSION_COOKIE_NAME];
    }
  }

  // 2. Validate session against PostgreSQL if token is present
  if (rawSessionToken) {
    try {
      const activeContext = await SessionRepository.findActiveSession(rawSessionToken);
      if (activeContext) {
        // Asynchronously touch session without blocking critical request path
        SessionRepository.touchSession(activeContext.session.id).catch(() => {});

        return {
          userId: activeContext.user.id,
          handle: activeContext.user.primary_handle,
          authSource: 'session',
          sessionId: activeContext.session.id,
        };
      }
    } catch (err) {
      console.error('[Session Verification Error]:', (err as Error).message);
    }
  }

  // 3. Test Identity Resolution (Strictly prohibited in production)
  // CRITICAL SECURITY INVARIANT: Production MUST fail closed if a valid session does not exist.
  if (isProduction) {
    return null;
  }

  const testHandle = request.headers.get('x-test-trainer-handle');
  if (testHandle) {
    const trainer = await UserRepository.findByPrimaryHandle(testHandle);
    if (trainer) {
      return {
        userId: trainer.user.id,
        handle: trainer.user.primary_handle,
        authSource: 'test_isolated',
      };
    }
  }

  const testUserId = request.headers.get('x-test-user-id');
  if (testUserId) {
    const user = await UserRepository.findById(testUserId);
    if (user) {
      return {
        userId: user.id,
        handle: user.primary_handle,
        authSource: 'test_isolated',
      };
    }
  }

  return null;
}
