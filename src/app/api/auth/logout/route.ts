// src/app/api/auth/logout/route.ts
// Revokes the current persistent session and clears session cookies

import { verifyRequestOrigin } from '../../../../lib/security/csrf.ts';
import { parseCookies, formatClearSessionCookie, SESSION_COOKIE_NAME } from '../../../../lib/auth/sessionContext.ts';
import { SessionRepository } from '../../../../lib/db/repositories/sessionRepository.ts';

export async function POST(request: Request): Promise<Response> {
  // 1. Origin verification
  const originCheck = verifyRequestOrigin(request);
  if (!originCheck.valid) {
    return Response.json({ error: originCheck.reason }, { status: 403 });
  }

  // 2. Extract session token strictly from secure HttpOnly cookie
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const rawToken = cookies[SESSION_COOKIE_NAME];

  // 3. Revoke session in database
  if (rawToken) {
    await SessionRepository.revokeSession(rawToken);
  }

  // 4. Return cleared cookie header
  const headers = new Headers();
  headers.append('Set-Cookie', formatClearSessionCookie());

  return Response.json(
    { success: true, message: 'Logged out successfully' },
    { headers }
  );
}
