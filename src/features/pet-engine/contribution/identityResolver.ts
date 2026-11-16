// src/features/pet-engine/contribution/identityResolver.ts
// Resolves intended GitHub owner handle and enforces immutable numeric identity verification

import {
  IdentityMismatchError,
  MissingOwnerConfigurationError,
  OrganizationAccountError,
  type GitHubContributionSnapshot,
} from './types.ts';

export interface ResolvedOwnerTarget {
  login: string;
  source: 'PET_OWNER_LOGIN' | 'REPOSITORY_OWNER';
}

/**
 * Resolves the candidate GitHub owner login:
 * 1. Uses explicit repository variable PET_OWNER_LOGIN if non-empty.
 * 2. Otherwise falls back to GITHUB_REPOSITORY_OWNER.
 * 3. Fails closed with MissingOwnerConfigurationError if neither is configured.
 */
export function resolveTargetOwner(
  env: Record<string, string | undefined> = process.env
): ResolvedOwnerTarget {
  const explicitLogin = env.PET_OWNER_LOGIN?.trim();
  if (explicitLogin && explicitLogin.length > 0) {
    return {
      login: explicitLogin,
      source: 'PET_OWNER_LOGIN',
    };
  }

  const repoOwner = env.GITHUB_REPOSITORY_OWNER?.trim();
  if (repoOwner && repoOwner.length > 0) {
    return {
      login: repoOwner,
      source: 'REPOSITORY_OWNER',
    };
  }

  throw new MissingOwnerConfigurationError(
    'Unable to resolve target GitHub owner. Set PET_OWNER_LOGIN repository variable or provide GITHUB_REPOSITORY_OWNER.'
  );
}

/**
 * Verifies that the queried snapshot represents a valid personal user and matches the
 * established numeric ownerDatabaseId stored in the contribution ledger.
 *
 * Rules:
 * - Rejects organization accounts (fails closed).
 * - If ledgerOwnerDatabaseId is already initialized, asserts exact numeric match with snapshot.ownerDatabaseId.
 * - Mismatch fails closed immediately (IdentityMismatchError).
 * - Never silently adopts a new numeric ID or alters the ledger.
 */
export function verifyOwnerIdentity(
  snapshot: GitHubContributionSnapshot,
  ledgerOwnerDatabaseId?: number | null
): void {
  // 1. Account type validation
  if (!snapshot.isPersonalAccount) {
    throw new OrganizationAccountError(
      `Account "${snapshot.ownerLogin}" is not an individual personal user account.`
    );
  }

  // 2. Validate numeric identity stability against established ledger
  if (typeof ledgerOwnerDatabaseId === 'number' && ledgerOwnerDatabaseId > 0) {
    if (snapshot.ownerDatabaseId !== ledgerOwnerDatabaseId) {
      throw new IdentityMismatchError(
        `Immutable identity mismatch: queried account "${snapshot.ownerLogin}" has databaseId ${snapshot.ownerDatabaseId}, ` +
          `which does not match established ledger ownerDatabaseId ${ledgerOwnerDatabaseId}. ` +
          `Synchronization aborted to protect repository integrity.`
      );
    }
  }

  // If ledgerOwnerDatabaseId is null/undefined, this is an uninitialized ledger.
  // Verification succeeds in read-only mode without mutating the ledger.
}
