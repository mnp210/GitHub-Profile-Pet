// src/app/api/auth/me/route.ts
// Returns the currently authenticated user identity, pet status, and profile metadata

import { resolveServerUser, parseCookies, SESSION_COOKIE_NAME } from '../../../../lib/auth/sessionContext.ts';
import { SessionRepository } from '../../../../lib/db/repositories/sessionRepository.ts';
import { UserRepository } from '../../../../lib/db/repositories/userRepository.ts';
import { PetRepository } from '../../../../lib/db/repositories/petRepository.ts';

export async function GET(request: Request): Promise<Response> {
  const userContext = await resolveServerUser(request);

  if (!userContext) {
    return Response.json(
      { authenticated: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  // Attempt to resolve rich session details
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const rawToken = cookies[SESSION_COOKIE_NAME];

  if (rawToken) {
    const activeSession = await SessionRepository.findActiveSession(rawToken);
    if (activeSession) {
      return Response.json({
        authenticated: true,
        authSource: 'session',
        user: {
          id: activeSession.user.id,
          primaryHandle: activeSession.user.primary_handle,
          role: activeSession.user.role,
        },
        account: {
          githubUserId: activeSession.account.github_user_id,
          username: activeSession.account.username,
          hasPrivateContributionsScope: activeSession.account.has_private_contributions_scope,
          isDisconnected: activeSession.account.is_disconnected,
        },
        profile: {
          displayName: activeSession.profile.display_name,
          bio: activeSession.profile.bio,
          preferredTheme: activeSession.profile.preferred_theme,
        },
        pet: {
          id: activeSession.pet.id,
          name: activeSession.pet.name,
          species: activeSession.pet.species,
          level: activeSession.pet.level,
          xp: activeSession.pet.xp,
          maxExp: activeSession.pet.max_exp,
          evolutionStage: activeSession.pet.evolution_stage,
          mood: activeSession.pet.mood,
          energy: activeSession.pet.energy,
          hunger: activeSession.pet.hunger,
          happiness: activeSession.pet.happiness,
        },
        session: {
          id: activeSession.session.id,
          expiresAt: activeSession.session.expires_at,
          lastActiveAt: activeSession.session.last_active_at,
        },
      });
    }
  }

  // Fallback for test_isolated contexts
  const user = await UserRepository.findById(userContext.userId);
  const pet = await PetRepository.findByUserId(userContext.userId);

  return Response.json({
    authenticated: true,
    authSource: userContext.authSource,
    user: {
      id: userContext.userId,
      primaryHandle: userContext.handle,
      role: user?.role || 'trainer',
    },
    pet: pet
      ? {
          id: pet.id,
          name: pet.name,
          species: pet.species,
          level: pet.level,
          xp: pet.xp,
          maxExp: pet.max_exp,
          evolutionStage: pet.evolution_stage,
          mood: pet.mood,
          energy: pet.energy,
          hunger: pet.hunger,
          happiness: pet.happiness,
        }
      : null,
  });
}
