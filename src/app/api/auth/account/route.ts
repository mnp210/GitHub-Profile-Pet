// src/app/api/auth/account/route.ts
// Handles full cascading account deletion with upstream GitHub App grant revocation attempt

import { verifyRequestOrigin } from '../../../../lib/security/csrf.ts';
import { resolveServerUser, formatClearSessionCookie } from '../../../../lib/auth/sessionContext.ts';
import { UserRepository } from '../../../../lib/db/repositories/userRepository.ts';
import { getGitHubAuthClient } from '../../../../lib/auth/githubAuth.ts';
import { decryptToken } from '../../../../lib/security/crypto.ts';

export async function DELETE(request: Request): Promise<Response> {
  // 1. Origin verification
  const originCheck = verifyRequestOrigin(request);
  if (!originCheck.valid) {
    return Response.json({ error: originCheck.reason }, { status: 403 });
  }

  // 2. Resolve authenticated user
  const userContext = await resolveServerUser(request);
  if (!userContext) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  // 3. Attempt upstream GitHub grant revocation before local purge (Stage 2.0C Section 4)
  let upstreamRevoked = false;
  let upstreamError: string | undefined;

  try {
    const trainer = await UserRepository.findByPrimaryHandle(userContext.handle);
    if (trainer?.account.encrypted_access_token) {
      const plainAccessToken = decryptToken(trainer.account.encrypted_access_token);
      const client = getGitHubAuthClient();
      const revokeResult = await client.revokeGrant(plainAccessToken);
      upstreamRevoked = revokeResult.success;
      upstreamError = revokeResult.error;
    } else {
      // No token to revoke (already disconnected or clean)
      upstreamRevoked = true;
    }
  } catch (err) {
    upstreamRevoked = false;
    upstreamError = (err as Error).message;
    console.warn('[Account Deletion Upstream Warning]:', upstreamError);
  }

  // 4. Execute atomic local purge
  // Cascades and removes github_accounts, users, user_profiles, pet_states,
  // user_sessions, activity_reward_ledger, daily_sync_states, care_action_idempotency
  const deleted = await UserRepository.deleteAccountCascade(userContext.userId);

  if (!deleted) {
    return Response.json(
      { error: 'User account not found or already deleted.' },
      { status: 404 }
    );
  }

  // 5. Clear session cookie
  const headers = new Headers();
  headers.append('Set-Cookie', formatClearSessionCookie());

  const message = upstreamRevoked
    ? 'Account and GitHub grant successfully deleted.'
    : 'Account deleted locally. Upstream revocation could not be confirmed. Please verify your authorized apps in GitHub Settings (https://github.com/settings/applications).';

  return Response.json(
    {
      success: true,
      upstreamRevoked,
      upstreamError,
      message,
    },
    { headers }
  );
}
