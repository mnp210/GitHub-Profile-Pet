// src/app/api/auth/session/route.ts
// Returns active session metadata, validity, and expiry details

import { parseCookies, SESSION_COOKIE_NAME } from '../../../../lib/auth/sessionContext.ts';
import { SessionRepository } from '../../../../lib/db/repositories/sessionRepository.ts';

export async function GET(request: Request): Promise<Response> {
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const rawToken = cookies[SESSION_COOKIE_NAME];

  if (!rawToken) {
    return Response.json({
      authenticated: false,
      session: null,
    });
  }

  const activeContext = await SessionRepository.findActiveSession(rawToken);

  if (!activeContext) {
    return Response.json({
      authenticated: false,
      session: null,
    });
  }

  return Response.json({
    authenticated: true,
    session: {
      id: activeContext.session.id,
      userId: activeContext.user.id,
      handle: activeContext.user.primary_handle,
      createdAt: activeContext.session.created_at,
      expiresAt: activeContext.session.expires_at,
      lastActiveAt: activeContext.session.last_active_at,
    },
  });
}
