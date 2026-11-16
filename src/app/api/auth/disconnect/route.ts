// src/app/api/auth/disconnect/route.ts
// Safely disconnects the GitHub account by attempting upstream grant revocation and purging stored OAuth tokens

import { verifyRequestOrigin } from '../../../../lib/security/csrf.ts';
import { resolveServerUser } from '../../../../lib/auth/sessionContext.ts';
import { UserRepository } from '../../../../lib/db/repositories/userRepository.ts';
import { getGitHubAuthClient } from '../../../../lib/auth/githubAuth.ts';
import { decryptToken } from '../../../../lib/security/crypto.ts';

export async function POST(request: Request): Promise<Response> {
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

  // 3. Attempt upstream GitHub grant revocation before local credential purge
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
    console.warn('[Disconnect Upstream Warning]:', upstreamError);
  }

  // 4. Purge stored tokens and set is_disconnected in database
  const disconnected = await UserRepository.disconnectGitHubAccount(userContext.userId);

  if (!disconnected) {
    return Response.json(
      { error: 'Failed to disconnect GitHub account or account not found.' },
      { status: 404 }
    );
  }

  const message = upstreamRevoked
    ? 'GitHub account disconnected and authorization grant revoked.'
    : 'GitHub account disconnected locally and stored credentials purged. Upstream revocation could not be confirmed. Please verify your authorized apps in GitHub Settings (https://github.com/settings/applications).';

  return Response.json({
    success: true,
    upstreamRevoked,
    upstreamError,
    message,
  });
}
