// src/features/pet-engine/contribution/identityResolver.ts
// Resolves intended GitHub owner handle and enforces immutable numeric identity verification

import * as fs from 'node:fs';
import * as path from 'node:path';
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

export interface ResolveOwnerIdentityOptions {
  baseDir?: string;
  env?: Record<string, string | undefined>;
  allowLedgerFallback?: boolean;
}

export interface ResolvedOwnerIdentity {
  login: string;
  databaseId?: number;
  sourceLogin: 'PET_OWNER_LOGIN' | 'REPOSITORY_OWNER' | 'LEDGER';
  sourceDatabaseId?: 'PET_OWNER_DATABASE_ID' | 'REPOSITORY_OWNER_ID' | 'LEDGER';
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
 * Resolves and validates complete owner identity (both username handle and immutable numeric database ID):
 * 1. Resolves login handle from GITHUB_REPOSITORY_OWNER or PET_OWNER_LOGIN.
 *    If both are supplied, validates that PET_OWNER_LOGIN matches GITHUB_REPOSITORY_OWNER.
 * 2. Resolves numeric database ID from GITHUB_REPOSITORY_OWNER_ID or PET_OWNER_DATABASE_ID.
 *    If both are supplied, validates that PET_OWNER_DATABASE_ID matches GITHUB_REPOSITORY_OWNER_ID.
 * 3. Supports safe ledger fallback when reading from an established repository state on disk.
 * 4. Fails closed on any format or identity mismatch.
 */
export function resolveOwnerIdentity(
  options: ResolveOwnerIdentityOptions = {}
): ResolvedOwnerIdentity {
  const env = options.env ?? process.env;
  const baseDir = options.baseDir;
  const allowLedgerFallback = options.allowLedgerFallback !== false;

  let ledgerData: { ownerLogin?: string | null; ownerDatabaseId?: number | null } | undefined;
  if (baseDir && allowLedgerFallback) {
    try {
      const contribPath = path.join(baseDir, 'pet', 'ledger', 'contributions.json');
      if (fs.existsSync(contribPath)) {
        const raw = fs.readFileSync(contribPath, 'utf-8');
        ledgerData = JSON.parse(raw);
      }
    } catch {
      // Ignored: ledger fallback is best-effort when files do not exist or are unreadable
    }
  }

  // 1. Resolve and Validate Login Handle
  let login: string | undefined;
  let sourceLogin: 'PET_OWNER_LOGIN' | 'REPOSITORY_OWNER' | 'LEDGER' | undefined;

  const repoOwner = env.GITHUB_REPOSITORY_OWNER?.trim();
  const explicitLogin = env.PET_OWNER_LOGIN?.trim();

  if (repoOwner && repoOwner.length > 0) {
    if (explicitLogin && explicitLogin.length > 0) {
      if (explicitLogin.toLowerCase() !== repoOwner.toLowerCase()) {
        throw new IdentityMismatchError(
          `Configured PET_OWNER_LOGIN ("${explicitLogin}") does not match authoritative GITHUB_REPOSITORY_OWNER ("${repoOwner}"). Arbitrary repository variables cannot override repository owner.`
        );
      }
    }
    login = repoOwner;
    sourceLogin = 'REPOSITORY_OWNER';
  } else if (explicitLogin && explicitLogin.length > 0) {
    login = explicitLogin;
    sourceLogin = 'PET_OWNER_LOGIN';
  } else if (ledgerData?.ownerLogin && typeof ledgerData.ownerLogin === 'string' && ledgerData.ownerLogin.trim().length > 0) {
    login = ledgerData.ownerLogin.trim();
    sourceLogin = 'LEDGER';
  }

  if (!login || !sourceLogin) {
    throw new MissingOwnerConfigurationError(
      'Unable to resolve target GitHub owner login. Set GITHUB_REPOSITORY_OWNER or PET_OWNER_LOGIN.'
    );
  }

  // 2. Resolve and Validate Numeric Database ID
  let databaseId: number | undefined;
  let sourceDatabaseId: 'PET_OWNER_DATABASE_ID' | 'REPOSITORY_OWNER_ID' | 'LEDGER' | undefined;

  let parsedRepoOwnerId: number | undefined;
  const rawRepoOwnerId = env.GITHUB_REPOSITORY_OWNER_ID?.trim();
  if (rawRepoOwnerId && rawRepoOwnerId.length > 0) {
    const val = parseInt(rawRepoOwnerId, 10);
    if (!Number.isInteger(val) || val <= 0) {
      throw new MissingOwnerConfigurationError(
        `Invalid GITHUB_REPOSITORY_OWNER_ID: must be a positive integer, received "${rawRepoOwnerId}".`
      );
    }
    parsedRepoOwnerId = val;
  }

  let parsedExplicitDbId: number | undefined;
  const rawExplicitDbId = env.PET_OWNER_DATABASE_ID?.trim();
  if (rawExplicitDbId && rawExplicitDbId.length > 0) {
    const val = parseInt(rawExplicitDbId, 10);
    if (!Number.isInteger(val) || val <= 0) {
      throw new MissingOwnerConfigurationError(
        `Invalid PET_OWNER_DATABASE_ID: must be a positive integer, received "${rawExplicitDbId}".`
      );
    }
    parsedExplicitDbId = val;
  }

  if (parsedRepoOwnerId !== undefined && parsedExplicitDbId !== undefined) {
    if (parsedRepoOwnerId !== parsedExplicitDbId) {
      throw new IdentityMismatchError(
        `Configured PET_OWNER_DATABASE_ID (${parsedExplicitDbId}) does not match authoritative GITHUB_REPOSITORY_OWNER_ID (${parsedRepoOwnerId}).`
      );
    }
    databaseId = parsedRepoOwnerId;
    sourceDatabaseId = 'REPOSITORY_OWNER_ID';
  } else if (parsedRepoOwnerId !== undefined) {
    databaseId = parsedRepoOwnerId;
    sourceDatabaseId = 'REPOSITORY_OWNER_ID';
  } else if (parsedExplicitDbId !== undefined) {
    databaseId = parsedExplicitDbId;
    sourceDatabaseId = 'PET_OWNER_DATABASE_ID';
  } else if (
    typeof ledgerData?.ownerDatabaseId === 'number' &&
    Number.isInteger(ledgerData.ownerDatabaseId) &&
    ledgerData.ownerDatabaseId > 0
  ) {
    databaseId = ledgerData.ownerDatabaseId;
    sourceDatabaseId = 'LEDGER';
  }

  return {
    login,
    databaseId,
    sourceLogin,
    sourceDatabaseId,
  };
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
