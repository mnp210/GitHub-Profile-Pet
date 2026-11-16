// src/lib/github/tokenManager.ts
// Secure token retrieval, automatic refresh rotation, in-process promise coalescing, and distributed lease serialization

import crypto from 'node:crypto';
import type { GitHubAccountRow } from '../db/types.ts';
import { decryptToken, encryptToken } from '../security/crypto.ts';
import { getGitHubAuthClient } from '../auth/githubAuth.ts';
import { UserRepository } from '../db/repositories/userRepository.ts';

export class GitHubAccountDisconnectedError extends Error {
  constructor(message = 'GitHub account is disconnected. Please reconnect your account.') {
    super(message);
    this.name = 'GitHubAccountDisconnectedError';
  }
}

export class GitHubMissingCredentialsError extends Error {
  constructor(message = 'GitHub account has no stored credentials.') {
    super(message);
    this.name = 'GitHubMissingCredentialsError';
  }
}

export class GitHubTokenExpiredError extends Error {
  constructor(message = 'GitHub credentials have expired and cannot be refreshed.') {
    super(message);
    this.name = 'GitHubTokenExpiredError';
  }
}

export class GitHubTokenRefreshError extends Error {
  constructor(message = 'Failed to refresh GitHub access token.') {
    super(message);
    this.name = 'GitHubTokenRefreshError';
  }
}

export class GitHubReauthorizationRequiredError extends GitHubTokenRefreshError {
  constructor(
    message = 'GitHub credentials require reauthorization due to an ambiguous token rotation attempt.'
  ) {
    super(message);
    this.name = 'GitHubReauthorizationRequiredError';
  }
}

/**
 * 5-minute safety buffer before token expiration to prevent clock-skew failures.
 */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * In-process promise coalescing map.
 * Guarantees that concurrent refresh calls within the same Node.js process share a single Promise.
 */
const inFlightRefreshes = new Map<string, Promise<string>>();

/**
 * Executes a serialized token refresh for a specific GitHub account.
 * Implements double-checked locking, distributed lease acquisition, pre-dispatch tracking,
 * and fail-closed ambiguous state protection.
 */
async function executeSerializedRefresh(initialAccount: GitHubAccountRow): Promise<string> {
  const accountId = initialAccount.id;

  // 1. Fast path: Re-read account to check if another caller already refreshed it
  const currentAccount = await UserRepository.findGitHubAccountById(accountId);
  if (!currentAccount) {
    throw new GitHubMissingCredentialsError('GitHub account was removed during refresh.');
  }

  if (currentAccount.is_disconnected) {
    throw new GitHubAccountDisconnectedError();
  }

  // If the account was previously marked ambiguous, fail closed immediately
  if (currentAccount.token_refresh_status === 'ambiguous') {
    throw new GitHubReauthorizationRequiredError(
      'GitHub credentials require reauthorization due to an ambiguous token rotation attempt.'
    );
  }

  const now = Date.now();
  const tokenExpiresAt = currentAccount.token_expires_at ? new Date(currentAccount.token_expires_at).getTime() : null;
  if (tokenExpiresAt !== null && now + TOKEN_EXPIRY_BUFFER_MS < tokenExpiresAt && currentAccount.encrypted_access_token) {
    return decryptToken(currentAccount.encrypted_access_token);
  }

  // 2. Validate refresh token viability before requesting lock
  if (!currentAccount.encrypted_refresh_token) {
    throw new GitHubTokenExpiredError('GitHub access token has expired and no refresh token is stored.');
  }

  if (currentAccount.refresh_expires_at && new Date(currentAccount.refresh_expires_at).getTime() <= now) {
    throw new GitHubTokenExpiredError('GitHub refresh token has expired. Please reauthorize the application.');
  }

  // 3. Attempt to acquire the distributed lease with unique fencing token (30-second TTL)
  const maxAttempts = 25; // 25 * 200ms = 5 seconds max wait
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ownerToken = crypto.randomUUID();
    const hasLease = await UserRepository.acquireTokenRefreshLease(accountId, ownerToken, 30);

    if (hasLease) {
      // Lease acquired! We are the sole worker performing refresh
      try {
        const lockedAccount = await UserRepository.findGitHubAccountById(accountId);
        if (!lockedAccount) {
          throw new GitHubMissingCredentialsError('GitHub account was removed during refresh.');
        }

        const currentVersion = lockedAccount.token_version ?? 1;

        // SCENARIO 1: Process pause after upstream success / unconfirmed lease expiry
        // If a previous worker marked this exact token_version as dispatched and let the lease expire,
        // GitHub may have already rotated the token. Re-submitting the old token would cause token-family revocation!
        if (
          lockedAccount.token_refresh_status === 'dispatched' &&
          lockedAccount.token_refresh_dispatched_version === currentVersion
        ) {
          await UserRepository.markRefreshAmbiguous(accountId, ownerToken).catch(() => {});
          throw new GitHubReauthorizationRequiredError(
            'Previous token refresh attempt was dispatched but unconfirmed before lease expired. Reauthorization required to prevent refresh token reuse.'
          );
        }

        let plainRefreshToken: string;
        try {
          plainRefreshToken = decryptToken(lockedAccount.encrypted_refresh_token!);
        } catch {
          throw new GitHubTokenRefreshError('Failed to decrypt stored GitHub refresh token.');
        }

        const authClient = getGitHubAuthClient();
        if (typeof authClient.refreshToken !== 'function') {
          throw new GitHubTokenRefreshError('Active GitHub authentication client does not implement refreshToken.');
        }

        // PRE-DISPATCH INTENT: Mark status = 'dispatched' for this generation
        const markedDispatched = await UserRepository.markRefreshDispatched(accountId, ownerToken, currentVersion);
        if (!markedDispatched) {
          throw new GitHubTokenRefreshError('Failed to record dispatch intent; lease ownership lost.');
        }

        // UPSTREAM REFRESH (Executed outside any DB transaction)
        let newTokens;
        try {
          newTokens = await authClient.refreshToken(plainRefreshToken);
        } catch (upstreamErr) {
          // SCENARIO 2: Ambiguous upstream outcome (network timeout, dropped connection, or 5xx)
          // GitHub may have processed the request and rotated the token.
          // To prevent token replay, mark account ambiguous and fail closed.
          await UserRepository.markRefreshAmbiguous(accountId, ownerToken).catch(() => {});
          const sanitized = (upstreamErr as Error).message.replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[REDACTED]');
          throw new GitHubReauthorizationRequiredError(
            `Upstream token rotation failed or timed out: ${sanitized}. Reauthorization required to prevent token replay.`
          );
        }

        const newEncryptedAccess = encryptToken(newTokens.accessToken);
        const newEncryptedRefresh = newTokens.refreshToken
          ? encryptToken(newTokens.refreshToken)
          : lockedAccount.encrypted_refresh_token;

        const newTokenExpiresAt = newTokens.expiresIn
          ? new Date(Date.now() + newTokens.expiresIn * 1000)
          : null;

        const newRefreshExpiresAt = newTokens.refreshTokenExpiresIn
          ? new Date(Date.now() + newTokens.refreshTokenExpiresIn * 1000)
          : lockedAccount.refresh_expires_at;

        // SCENARIO 4: Successful refresh, attempt persistence
        let persisted = false;
        try {
          persisted = await UserRepository.updateTokens(
            accountId,
            newEncryptedAccess,
            newEncryptedRefresh,
            newTokenExpiresAt,
            newRefreshExpiresAt,
            ownerToken
          );
        } catch (dbErr) {
          // Database write failed (Scenario 4)
          await UserRepository.markRefreshAmbiguous(accountId, ownerToken).catch(() => {});
          throw new GitHubReauthorizationRequiredError(
            `GitHub credentials rotated upstream but database persistence failed: ${(dbErr as Error).message}. Reauthorization required.`
          );
        }

        if (!persisted) {
          // Stale worker fencing: lease expired or was taken over by another worker during slow operation.
          // Check if winning worker already persisted a newer token generation
          const freshAccount = await UserRepository.findGitHubAccountById(accountId);
          const freshExpires = freshAccount?.token_expires_at
            ? new Date(freshAccount.token_expires_at).getTime()
            : null;
          if (
            freshAccount &&
            (freshAccount.token_version ?? 1) > currentVersion &&
            freshExpires !== null &&
            Date.now() + TOKEN_EXPIRY_BUFFER_MS < freshExpires &&
            freshAccount.encrypted_access_token
          ) {
            return decryptToken(freshAccount.encrypted_access_token);
          }

          // If no newer token was persisted, this rotation attempt was lost
          await UserRepository.markRefreshAmbiguous(accountId, ownerToken).catch(() => {});
          throw new GitHubReauthorizationRequiredError(
            'Token refresh lease was invalidated by a concurrent worker before persistence could be confirmed. Reauthorization required.'
          );
        }

        return newTokens.accessToken;
      } catch (err) {
        if (err instanceof GitHubReauthorizationRequiredError) {
          throw err;
        }
        // Release lease conditionally: only if this worker still holds it
        await UserRepository.releaseTokenRefreshLease(accountId, ownerToken).catch(() => {});
        if (err instanceof GitHubTokenRefreshError) {
          throw err;
        }
        const sanitizedError = (err as Error).message.replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[REDACTED]');
        throw new GitHubTokenRefreshError(`Upstream token refresh failed: ${sanitizedError}`);
      }
    }

    // Lease not acquired: another process is performing the refresh. Wait and poll.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const pollAccount = await UserRepository.findGitHubAccountById(accountId);
    if (!pollAccount) {
      throw new GitHubMissingCredentialsError('GitHub account was removed during refresh.');
    }

    if (pollAccount.token_refresh_status === 'ambiguous') {
      throw new GitHubReauthorizationRequiredError(
        'GitHub credentials require reauthorization due to an ambiguous token rotation attempt.'
      );
    }

    const pollExpiresAt = pollAccount.token_expires_at ? new Date(pollAccount.token_expires_at).getTime() : null;
    if (pollExpiresAt !== null && Date.now() + TOKEN_EXPIRY_BUFFER_MS < pollExpiresAt && pollAccount.encrypted_access_token) {
      // The other process finished and persisted fresh credentials!
      return decryptToken(pollAccount.encrypted_access_token);
    }
  }

  throw new GitHubTokenRefreshError('Timed out waiting for concurrent token refresh operation.');
}

/**
 * Obtains a valid, plaintext GitHub access token for the given account.
 * Automatically triggers token refresh using rotated refresh tokens when expiring or expired.
 * Never leaks token strings or ciphertext in error messages.
 * Guarantees in-process and distributed concurrency serialization per account.
 */
export async function getValidAccessToken(account: GitHubAccountRow): Promise<string> {
  if (account.is_disconnected) {
    throw new GitHubAccountDisconnectedError();
  }

  if (!account.encrypted_access_token) {
    throw new GitHubMissingCredentialsError();
  }

  // Fast-path: fail closed immediately if account is marked ambiguous
  if (account.token_refresh_status === 'ambiguous') {
    throw new GitHubReauthorizationRequiredError(
      'GitHub account is in an ambiguous token rotation state. Reauthorization is required to prevent token replay.'
    );
  }

  const now = Date.now();
  const tokenExpiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : null;
  const isExpiredOrExpiringSoon = tokenExpiresAt !== null && now + TOKEN_EXPIRY_BUFFER_MS >= tokenExpiresAt;

  // If token is still fresh, decrypt and return immediately
  if (!isExpiredOrExpiringSoon) {
    try {
      return decryptToken(account.encrypted_access_token);
    } catch {
      throw new GitHubMissingCredentialsError('Failed to decrypt stored GitHub access token.');
    }
  }

  // Token is expired or expiring soon: coalesce in-flight refreshes per account
  let refreshPromise = inFlightRefreshes.get(account.id);
  if (!refreshPromise) {
    refreshPromise = executeSerializedRefresh(account).finally(() => {
      inFlightRefreshes.delete(account.id);
    });
    inFlightRefreshes.set(account.id, refreshPromise);
  }

  return refreshPromise;
}
