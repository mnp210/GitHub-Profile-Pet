/**
 * GitHub Profile Pet — Administrator Authorization for Personal and Organization Repositories (R3.22-02)
 *
 * Enforces strict authorization separation:
 * 1. Repository Owner Identity (ownerLogin, ownerDatabaseId): source of repo ownership and contributions.
 * 2. Triggering Actor Identity (actorLogin, actorId): individual executing the workflow dispatch.
 * 3. Administrative Authorization: whether the actor is authorized to initialize or administer this repository.
 * 4. Trusted Interaction Author (trustedAuthorId): author authorized to dispatch pet care actions.
 *
 * Rules:
 * - Personal Repository (actor == repoOwner or actorId == repoOwnerId):
 *   The personal owner is authorized. Collaborators or third parties are strictly rejected.
 * - Organization Repository (repoOwner != actor and repoOwnerId != actorId):
 *   Organization owner ID is NEVER confused with the administrator's individual user ID.
 *   Actor must be verified as an organization administrator via:
 *   a) Explicit repository variable PET_ADMIN_DATABASE_ID (and/or PET_ADMIN_LOGIN) matching actorId, OR
 *   b) Authenticated GitHub API collaborator permission check returning permission === 'admin'.
 *   If neither method verifies administrative authority, or on any API error, fails closed.
 */

export class AdminAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminAuthorizationError';
  }
}

export interface AdminAuthorizationOptions {
  repository: string;
  repositoryOwner: string;
  repositoryOwnerId?: number;
  actor: string;
  actorId?: number;
  confirmOwner?: string;
  env?: Record<string, string | undefined>;
  token?: string;
  apiPermissionFetcher?: (
    repo: string,
    username: string,
    token: string
  ) => Promise<{ permission: string | null; error?: string }>;
}

export interface AdminAuthorizationResult {
  authorized: boolean;
  isOrganization: boolean;
  actorLogin: string;
  actorId: number;
  repositoryOwnerLogin: string;
  repositoryOwnerId?: number;
  method: 'PERSONAL_OWNER' | 'CONFIGURED_ADMIN_ID' | 'API_ADMIN_PERMISSION';
  details: string;
}

/**
 * Default permission fetcher calling GitHub REST API
 */
export async function fetchGitHubCollaboratorPermission(
  repo: string,
  username: string,
  token: string
): Promise<{ permission: string | null; error?: string }> {
  try {
    const url = `https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(username)}/permission`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'GitHub-Profile-Pet-Admin-Auth',
      },
    });

    if (!response.ok) {
      return {
        permission: null,
        error: `GitHub API returned HTTP ${response.status} (${response.statusText}) for collaborator permission query.`,
      };
    }

    const payload = (await response.json()) as { permission?: string; role_name?: string };
    const permission = payload.permission ?? payload.role_name ?? null;
    return { permission };
  } catch (err: unknown) {
    return {
      permission: null,
      error: `Failed to query collaborator permission from GitHub API: ${(err as Error).message}`,
    };
  }
}

/**
 * Validates administrator authorization for establishing baseline or administering pet runtime.
 * Fails closed on any ambiguity or permission mismatch.
 */
export async function verifyAdministratorAuthorization(
  options: AdminAuthorizationOptions
): Promise<AdminAuthorizationResult> {
  const env = options.env ?? process.env;

  const actorLogin = (options.actor ?? env.GITHUB_ACTOR ?? '').trim();
  const repoOwnerLogin = (options.repositoryOwner ?? env.GITHUB_REPOSITORY_OWNER ?? '').trim();
  const repoFullName = (options.repository ?? env.GITHUB_REPOSITORY ?? '').trim();

  if (!actorLogin) {
    throw new AdminAuthorizationError('Missing actor identity: GITHUB_ACTOR or actor option is required.');
  }

  if (!repoOwnerLogin) {
    throw new AdminAuthorizationError(
      'Missing repository owner identity: GITHUB_REPOSITORY_OWNER or repositoryOwner option is required.'
    );
  }

  // 1. Resolve and validate numeric actor ID
  let actorId = options.actorId;
  if (actorId === undefined) {
    const rawActorId = env.GITHUB_ACTOR_ID?.trim();
    if (rawActorId && rawActorId.length > 0) {
      const parsed = parseInt(rawActorId, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        actorId = parsed;
      }
    }
  }

  if (actorId === undefined || !Number.isInteger(actorId) || actorId <= 0) {
    throw new AdminAuthorizationError(
      `Invalid or missing numeric actor ID (${String(actorId)}). A positive integer actor ID is required.`
    );
  }

  // 2. Resolve numeric repository owner ID if available
  let repoOwnerId = options.repositoryOwnerId;
  if (repoOwnerId === undefined) {
    const rawRepoOwnerId = env.GITHUB_REPOSITORY_OWNER_ID?.trim();
    if (rawRepoOwnerId && rawRepoOwnerId.length > 0) {
      const parsed = parseInt(rawRepoOwnerId, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        repoOwnerId = parsed;
      }
    }
  }

  // 3. Determine Personal Repository vs Organization Repository
  const isPersonalLoginMatch = actorLogin.toLowerCase() === repoOwnerLogin.toLowerCase();
  const isPersonalIdMatch = repoOwnerId !== undefined && actorId === repoOwnerId;

  if (isPersonalLoginMatch || isPersonalIdMatch) {
    // Both login and ID must agree if both are known
    if (repoOwnerId !== undefined && actorId !== repoOwnerId) {
      throw new AdminAuthorizationError(
        `Actor login matches repository owner ("${actorLogin}"), but actor numeric ID (${actorId}) does not match repository owner ID (${repoOwnerId}). Identity mismatch; failing closed.`
      );
    }
    if (!isPersonalLoginMatch && isPersonalIdMatch) {
      throw new AdminAuthorizationError(
        `Actor numeric ID matches repository owner (${actorId}), but actor login ("${actorLogin}") does not match repository owner login ("${repoOwnerLogin}"). Identity mismatch; failing closed.`
      );
    }

    // Verify confirmation input if supplied
    if (options.confirmOwner !== undefined && options.confirmOwner.trim().length > 0) {
      if (options.confirmOwner.trim().toLowerCase() !== repoOwnerLogin.toLowerCase()) {
        throw new AdminAuthorizationError(
          `Confirmation mismatch: confirm_owner ("${options.confirmOwner}") does not match repository owner ("${repoOwnerLogin}").`
        );
      }
    }

    return {
      authorized: true,
      isOrganization: false,
      actorLogin,
      actorId,
      repositoryOwnerLogin: repoOwnerLogin,
      repositoryOwnerId: repoOwnerId,
      method: 'PERSONAL_OWNER',
      details: `Authorized as personal repository owner @${actorLogin} (databaseId: ${actorId}).`,
    };
  }

  // 4. Organization Repository Handling
  // At this point, actor is NOT the repository owner.
  // Verify confirmation input if supplied: must match repo owner (org) or configured pet trainer
  if (options.confirmOwner !== undefined && options.confirmOwner.trim().length > 0) {
    const trimmedConfirm = options.confirmOwner.trim().toLowerCase();
    const trainerLogin = (env.PET_OWNER_LOGIN ?? '').trim().toLowerCase();
    const isConfirmValid =
      trimmedConfirm === repoOwnerLogin.toLowerCase() || (trainerLogin.length > 0 && trimmedConfirm === trainerLogin);
    if (!isConfirmValid) {
      throw new AdminAuthorizationError(
        `Confirmation mismatch for organization repository: confirm_owner ("${options.confirmOwner}") must match organization ("${repoOwnerLogin}")${trainerLogin ? ` or configured trainer ("${trainerLogin}")` : ''}.`
      );
    }
  }

  // Check Mechanism A: Explicit PET_ADMIN_DATABASE_ID / PET_ADMIN_LOGIN
  const rawAdminDbId = env.PET_ADMIN_DATABASE_ID?.trim();
  const rawAdminLogin = env.PET_ADMIN_LOGIN?.trim();

  if (rawAdminDbId && rawAdminDbId.length > 0) {
    const parsedAdminDbId = parseInt(rawAdminDbId, 10);
    if (!Number.isInteger(parsedAdminDbId) || parsedAdminDbId <= 0) {
      throw new AdminAuthorizationError(
        `Configured PET_ADMIN_DATABASE_ID ("${rawAdminDbId}") is invalid: must be a positive integer.`
      );
    }

    if (actorId !== parsedAdminDbId) {
      throw new AdminAuthorizationError(
        `Actor numeric ID (${actorId}) does not match configured administrator PET_ADMIN_DATABASE_ID (${parsedAdminDbId}) for organization repository "${repoFullName}".`
      );
    }

    if (rawAdminLogin && rawAdminLogin.length > 0) {
      if (actorLogin.toLowerCase() !== rawAdminLogin.toLowerCase()) {
        throw new AdminAuthorizationError(
          `Actor login ("${actorLogin}") does not match configured administrator PET_ADMIN_LOGIN ("${rawAdminLogin}").`
        );
      }
    }

    return {
      authorized: true,
      isOrganization: true,
      actorLogin,
      actorId,
      repositoryOwnerLogin: repoOwnerLogin,
      repositoryOwnerId: repoOwnerId,
      method: 'CONFIGURED_ADMIN_ID',
      details: `Authorized as configured organization administrator @${actorLogin} (databaseId: ${actorId}) matching PET_ADMIN_DATABASE_ID (${parsedAdminDbId}).`,
    };
  }

  // Check Mechanism B: GitHub API Permission Check
  const token = (options.token ?? env.GITHUB_TOKEN)?.trim();
  const fetcher = options.apiPermissionFetcher ?? fetchGitHubCollaboratorPermission;

  if (token && repoFullName) {
    const permResult = await fetcher(repoFullName, actorLogin, token);
    if (permResult.error) {
      throw new AdminAuthorizationError(
        `Organization administrator verification failed for @${actorLogin}: ${permResult.error}`
      );
    }

    if (permResult.permission === 'admin') {
      return {
        authorized: true,
        isOrganization: true,
        actorLogin,
        actorId,
        repositoryOwnerLogin: repoOwnerLogin,
        repositoryOwnerId: repoOwnerId,
        method: 'API_ADMIN_PERMISSION',
        details: `Authorized via verified GitHub API admin permission for @${actorLogin} on "${repoFullName}".`,
      };
    }

    throw new AdminAuthorizationError(
      `Access denied: Actor @${actorLogin} has "${permResult.permission ?? 'no'}" permission on organization repository "${repoFullName}". Administrator ("admin") permission is strictly required to establish baseline or administer pet runtime.`
    );
  }

  // If neither Mechanism A nor Mechanism B succeeded, fail closed
  throw new AdminAuthorizationError(
    `Unauthorized actor @${actorLogin} (databaseId: ${actorId}) on organization repository "${repoFullName}". Set PET_ADMIN_DATABASE_ID repository variable or provide GITHUB_TOKEN with repository access to verify admin permission.`
  );
}
