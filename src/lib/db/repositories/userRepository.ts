// src/lib/db/repositories/userRepository.ts
// Repository for Trainer Accounts, Profiles, and Cascading Account Deletion

import type { PoolClient } from 'pg';
import { getPool } from '../pool.ts';
import { withTransaction } from '../transaction.ts';
import type {
  GitHubAccountRow,
  UserRow,
  UserProfileRow,
  PetStateRow,
  UserAggregateDetails,
} from '../types.ts';

export interface CreateTrainerInput {
  githubUserId: string;
  username: string;
  primaryHandle: string;
  displayName?: string;
  encryptedAccessToken?: string | null;
  encryptedRefreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  hasPrivateScope?: boolean;
}

export class UserRepository {
  /**
   * Atomically provisions a new Trainer account, user entity, profile, and initial pet.
   */
  public static async createTrainer(
    input: CreateTrainerInput,
    client?: PoolClient
  ): Promise<UserAggregateDetails> {
    return withTransaction(async (tx) => {
      // 1. Insert GitHub Account
      const accountRes = await tx.query<GitHubAccountRow>(
        `INSERT INTO github_accounts (
          github_user_id, username, encrypted_access_token, encrypted_refresh_token,
          token_expires_at, refresh_expires_at, has_private_contributions_scope
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;`,
        [
          input.githubUserId,
          input.username,
          input.encryptedAccessToken || null,
          input.encryptedRefreshToken || null,
          input.tokenExpiresAt || null,
          input.refreshExpiresAt || null,
          input.hasPrivateScope || false,
        ]
      );
      const account = accountRes.rows[0];

      // 2. Insert Core User
      const userRes = await tx.query<UserRow>(
        `INSERT INTO users (github_account_id, primary_handle)
        VALUES ($1, $2)
        RETURNING *;`,
        [account.id, input.primaryHandle.toLowerCase().replace(/^@/, '')]
      );
      const user = userRes.rows[0];

      // 3. Insert Profile
      const profileRes = await tx.query<UserProfileRow>(
        `INSERT INTO user_profiles (
          user_id, display_name, sync_private_contributions
        ) VALUES ($1, $2, $3)
        RETURNING *;`,
        [user.id, input.displayName || input.username, input.hasPrivateScope || false]
      );
      const profile = profileRes.rows[0];

      // 4. Insert Default Pet (Shadow Claw, Hatchling)
      const petRes = await tx.query<PetStateRow>(
        `INSERT INTO pet_states (
          user_id, species, name, level, xp, max_exp, evolution_stage, mood,
          energy, hunger, happiness
        ) VALUES ($1, 'cat', 'Shadow Claw', 1, 0, 100, 'Hatchling', 'Focused', 80, 60, 70)
        RETURNING *;`,
        [user.id]
      );
      const pet = petRes.rows[0];

      return { user, account, profile, pet };
    }, client);
  }

  /**
   * Finds a user and their linked details by primary GitHub handle.
   */
  public static async findByPrimaryHandle(
    handle: string,
    client?: PoolClient
  ): Promise<UserAggregateDetails | null> {
    const db = client || getPool();
    const cleanHandle = handle.toLowerCase().replace(/^@/, '');

    const res = await db.query<{
      // user
      u_id: string;
      u_github_account_id: string;
      u_primary_handle: string;
      u_role: 'trainer' | 'admin';
      u_is_suspended: boolean;
      u_created_at: Date;
      u_updated_at: Date;
      // account
      a_id: string;
      a_github_user_id: string;
      a_username: string;
      a_encrypted_access_token: string | null;
      a_encrypted_refresh_token: string | null;
      a_token_expires_at: Date | null;
      a_refresh_expires_at: Date | null;
      a_has_private_scope: boolean;
      a_is_disconnected: boolean;
      a_created_at: Date;
      a_updated_at: Date;
      // profile
      p_id: string;
      p_display_name: string;
      p_bio: string;
      p_timezone: string;
      p_visibility: 'public' | 'unlisted' | 'minimal';
      p_show_streak: boolean;
      p_show_vitals: boolean;
      p_preferred_theme: string;
      p_sync_private: boolean;
      p_updated_at: Date;
      // pet
      pt_id: string;
      pt_species: string;
      pt_name: string;
      pt_level: number;
      pt_xp: number;
      pt_max_exp: number;
      pt_evolution_stage: string;
      pt_mood: string;
      pt_energy: number;
      pt_hunger: number;
      pt_happiness: number;
      pt_last_interacted_at: Date;
      pt_last_welcome_bonus_at: Date | null;
      pt_updated_at: Date;
    }>(
      `SELECT
        u.id AS u_id, u.github_account_id AS u_github_account_id, u.primary_handle AS u_primary_handle,
        u.role AS u_role, u.is_suspended AS u_is_suspended, u.created_at AS u_created_at, u.updated_at AS u_updated_at,
        a.id AS a_id, a.github_user_id AS a_github_user_id, a.username AS a_username,
        a.encrypted_access_token AS a_encrypted_access_token, a.encrypted_refresh_token AS a_encrypted_refresh_token,
        a.token_expires_at AS a_token_expires_at, a.refresh_expires_at AS a_refresh_expires_at,
        a.has_private_contributions_scope AS a_has_private_scope, a.is_disconnected AS a_is_disconnected,
        a.created_at AS a_created_at, a.updated_at AS a_updated_at,
        p.id AS p_id, p.display_name AS p_display_name, p.bio AS p_bio, p.timezone AS p_timezone,
        p.visibility AS p_visibility, p.show_streak AS p_show_streak, p.show_vitals AS p_show_vitals,
        p.preferred_theme AS p_preferred_theme, p.sync_private_contributions AS p_sync_private, p.updated_at AS p_updated_at,
        pt.id AS pt_id, pt.species AS pt_species, pt.name AS pt_name, pt.level AS pt_level, pt.xp AS pt_xp,
        pt.max_exp AS pt_max_exp, pt.evolution_stage AS pt_evolution_stage, pt.mood AS pt_mood,
        pt.energy AS pt_energy, pt.hunger AS pt_hunger, pt.happiness AS pt_happiness,
        pt.last_interacted_at AS pt_last_interacted_at, pt.last_welcome_bonus_at AS pt_last_welcome_bonus_at,
        pt.updated_at AS pt_updated_at
      FROM users u
      JOIN github_accounts a ON a.id = u.github_account_id
      JOIN user_profiles p ON p.user_id = u.id
      JOIN pet_states pt ON pt.user_id = u.id
      WHERE u.primary_handle = $1;`,
      [cleanHandle]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      user: {
        id: row.u_id,
        github_account_id: row.u_github_account_id,
        primary_handle: row.u_primary_handle,
        role: row.u_role,
        is_suspended: row.u_is_suspended,
        created_at: row.u_created_at,
        updated_at: row.u_updated_at,
      },
      account: {
        id: row.a_id,
        github_user_id: row.a_github_user_id,
        username: row.a_username,
        encrypted_access_token: row.a_encrypted_access_token,
        encrypted_refresh_token: row.a_encrypted_refresh_token,
        token_expires_at: row.a_token_expires_at,
        refresh_expires_at: row.a_refresh_expires_at,
        has_private_contributions_scope: row.a_has_private_scope,
        is_disconnected: row.a_is_disconnected,
        created_at: row.a_created_at,
        updated_at: row.a_updated_at,
      },
      profile: {
        id: row.p_id,
        user_id: row.u_id,
        display_name: row.p_display_name,
        bio: row.p_bio,
        timezone: row.p_timezone,
        visibility: row.p_visibility,
        show_streak: row.p_show_streak,
        show_vitals: row.p_show_vitals,
        preferred_theme: row.p_preferred_theme,
        sync_private_contributions: row.p_sync_private,
        updated_at: row.p_updated_at,
      },
      pet: {
        id: row.pt_id,
        user_id: row.u_id,
        species: row.pt_species,
        name: row.pt_name,
        level: row.pt_level,
        xp: row.pt_xp,
        max_exp: row.pt_max_exp,
        evolution_stage: row.pt_evolution_stage,
        mood: row.pt_mood,
        energy: row.pt_energy,
        hunger: row.pt_hunger,
        happiness: row.pt_happiness,
        last_interacted_at: row.pt_last_interacted_at,
        last_welcome_bonus_at: row.pt_last_welcome_bonus_at,
        updated_at: row.pt_updated_at,
      },
    };
  }

  /**
   * Finds a user row by UUID.
   */
  public static async findById(userId: string, client?: PoolClient): Promise<UserRow | null> {
    const db = client || getPool();
    const res = await db.query<UserRow>('SELECT * FROM users WHERE id = $1;', [userId]);
    return res.rows[0] || null;
  }

  /**
   * Handles GitHub username rename: updates primary_handle in users and username in github_accounts.
   */
  public static async updateHandleIfChanged(
    userId: string,
    currentGitHubLogin: string,
    client?: PoolClient
  ): Promise<void> {
    const cleanHandle = currentGitHubLogin.toLowerCase().replace(/^@/, '');
    await withTransaction(async (tx) => {
      const userRes = await tx.query<UserRow>('SELECT * FROM users WHERE id = $1 FOR UPDATE;', [userId]);
      if (userRes.rows.length === 0) return;

      const user = userRes.rows[0];
      if (user.primary_handle !== cleanHandle) {
        await tx.query('UPDATE users SET primary_handle = $1, updated_at = NOW() WHERE id = $2;', [
          cleanHandle,
          userId,
        ]);
        await tx.query(
          'UPDATE github_accounts SET username = $1, updated_at = NOW() WHERE id = $2;',
          [cleanHandle, user.github_account_id]
        );
      }
    }, client);
  }

  /**
   * Finds a user and their linked details by immutable numeric GitHub user ID.
   */
  public static async findByGitHubUserId(
    githubUserId: string,
    client?: PoolClient
  ): Promise<UserAggregateDetails | null> {
    const db = client || getPool();

    const res = await db.query<{
      u_id: string;
      u_github_account_id: string;
      u_primary_handle: string;
      u_role: 'trainer' | 'admin';
      u_is_suspended: boolean;
      u_created_at: Date;
      u_updated_at: Date;
      a_id: string;
      a_github_user_id: string;
      a_username: string;
      a_encrypted_access_token: string | null;
      a_encrypted_refresh_token: string | null;
      a_token_expires_at: Date | null;
      a_refresh_expires_at: Date | null;
      a_has_private_scope: boolean;
      a_is_disconnected: boolean;
      a_created_at: Date;
      a_updated_at: Date;
      p_id: string;
      p_display_name: string;
      p_bio: string;
      p_timezone: string;
      p_visibility: 'public' | 'unlisted' | 'minimal';
      p_show_streak: boolean;
      p_show_vitals: boolean;
      p_preferred_theme: string;
      p_sync_private: boolean;
      p_updated_at: Date;
      pt_id: string;
      pt_species: string;
      pt_name: string;
      pt_level: number;
      pt_xp: number;
      pt_max_exp: number;
      pt_evolution_stage: string;
      pt_mood: string;
      pt_energy: number;
      pt_hunger: number;
      pt_happiness: number;
      pt_last_interacted_at: Date;
      pt_last_welcome_bonus_at: Date | null;
      pt_updated_at: Date;
    }>(
      `SELECT
        u.id AS u_id, u.github_account_id AS u_github_account_id, u.primary_handle AS u_primary_handle,
        u.role AS u_role, u.is_suspended AS u_is_suspended, u.created_at AS u_created_at, u.updated_at AS u_updated_at,
        a.id AS a_id, a.github_user_id AS a_github_user_id, a.username AS a_username,
        a.encrypted_access_token AS a_encrypted_access_token, a.encrypted_refresh_token AS a_encrypted_refresh_token,
        a.token_expires_at AS a_token_expires_at, a.refresh_expires_at AS a_refresh_expires_at,
        a.has_private_contributions_scope AS a_has_private_scope, a.is_disconnected AS a_is_disconnected,
        a.created_at AS a_created_at, a.updated_at AS a_updated_at,
        p.id AS p_id, p.display_name AS p_display_name, p.bio AS p_bio, p.timezone AS p_timezone,
        p.visibility AS p_visibility, p.show_streak AS p_show_streak, p.show_vitals AS p_show_vitals,
        p.preferred_theme AS p_preferred_theme, p.sync_private_contributions AS p_sync_private, p.updated_at AS p_updated_at,
        pt.id AS pt_id, pt.species AS pt_species, pt.name AS pt_name, pt.level AS pt_level, pt.xp AS pt_xp,
        pt.max_exp AS pt_max_exp, pt.evolution_stage AS pt_evolution_stage, pt.mood AS pt_mood,
        pt.energy AS pt_energy, pt.hunger AS pt_hunger, pt.happiness AS pt_happiness,
        pt.last_interacted_at AS pt_last_interacted_at, pt.last_welcome_bonus_at AS pt_last_welcome_bonus_at,
        pt.updated_at AS pt_updated_at
      FROM github_accounts a
      JOIN users u ON u.github_account_id = a.id
      JOIN user_profiles p ON p.user_id = u.id
      JOIN pet_states pt ON pt.user_id = u.id
      WHERE a.github_user_id = $1;`,
      [githubUserId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      user: {
        id: row.u_id,
        github_account_id: row.u_github_account_id,
        primary_handle: row.u_primary_handle,
        role: row.u_role,
        is_suspended: row.u_is_suspended,
        created_at: row.u_created_at,
        updated_at: row.u_updated_at,
      },
      account: {
        id: row.a_id,
        github_user_id: row.a_github_user_id,
        username: row.a_username,
        encrypted_access_token: row.a_encrypted_access_token,
        encrypted_refresh_token: row.a_encrypted_refresh_token,
        token_expires_at: row.a_token_expires_at,
        refresh_expires_at: row.a_refresh_expires_at,
        has_private_contributions_scope: row.a_has_private_scope,
        is_disconnected: row.a_is_disconnected,
        created_at: row.a_created_at,
        updated_at: row.a_updated_at,
      },
      profile: {
        id: row.p_id,
        user_id: row.u_id,
        display_name: row.p_display_name,
        bio: row.p_bio,
        timezone: row.p_timezone,
        visibility: row.p_visibility,
        show_streak: row.p_show_streak,
        show_vitals: row.p_show_vitals,
        preferred_theme: row.p_preferred_theme,
        sync_private_contributions: row.p_sync_private,
        updated_at: row.p_updated_at,
      },
      pet: {
        id: row.pt_id,
        user_id: row.u_id,
        species: row.pt_species,
        name: row.pt_name,
        level: row.pt_level,
        xp: row.pt_xp,
        max_exp: row.pt_max_exp,
        evolution_stage: row.pt_evolution_stage,
        mood: row.pt_mood,
        energy: row.pt_energy,
        hunger: row.pt_hunger,
        happiness: row.pt_happiness,
        last_interacted_at: row.pt_last_interacted_at,
        last_welcome_bonus_at: row.pt_last_welcome_bonus_at,
        updated_at: row.pt_updated_at,
      },
    };
  }

  /**
   * Finds a user and their linked details by internal user ID (UUID).
   */
  public static async findByUserId(
    userId: string,
    client?: PoolClient
  ): Promise<UserAggregateDetails | null> {
    const db = client || getPool();

    const res = await db.query<{
      u_id: string;
      u_github_account_id: string;
      u_primary_handle: string;
      u_role: 'trainer' | 'admin';
      u_is_suspended: boolean;
      u_created_at: Date;
      u_updated_at: Date;
      a_id: string;
      a_github_user_id: string;
      a_username: string;
      a_encrypted_access_token: string | null;
      a_encrypted_refresh_token: string | null;
      a_token_expires_at: Date | null;
      a_refresh_expires_at: Date | null;
      a_has_private_scope: boolean;
      a_is_disconnected: boolean;
      a_created_at: Date;
      a_updated_at: Date;
      p_id: string;
      p_display_name: string;
      p_bio: string;
      p_timezone: string;
      p_visibility: 'public' | 'unlisted' | 'minimal';
      p_show_streak: boolean;
      p_show_vitals: boolean;
      p_preferred_theme: string;
      p_sync_private: boolean;
      p_updated_at: Date;
      pt_id: string;
      pt_species: string;
      pt_name: string;
      pt_level: number;
      pt_xp: number;
      pt_max_exp: number;
      pt_evolution_stage: string;
      pt_mood: string;
      pt_energy: number;
      pt_hunger: number;
      pt_happiness: number;
      pt_last_interacted_at: Date;
      pt_last_welcome_bonus_at: Date | null;
      pt_updated_at: Date;
    }>(
      `SELECT
        u.id AS u_id, u.github_account_id AS u_github_account_id, u.primary_handle AS u_primary_handle,
        u.role AS u_role, u.is_suspended AS u_is_suspended, u.created_at AS u_created_at, u.updated_at AS u_updated_at,
        a.id AS a_id, a.github_user_id AS a_github_user_id, a.username AS a_username,
        a.encrypted_access_token AS a_encrypted_access_token, a.encrypted_refresh_token AS a_encrypted_refresh_token,
        a.token_expires_at AS a_token_expires_at, a.refresh_expires_at AS a_refresh_expires_at,
        a.has_private_contributions_scope AS a_has_private_scope, a.is_disconnected AS a_is_disconnected,
        a.created_at AS a_created_at, a.updated_at AS a_updated_at,
        p.id AS p_id, p.display_name AS p_display_name, p.bio AS p_bio, p.timezone AS p_timezone,
        p.visibility AS p_visibility, p.show_streak AS p_show_streak, p.show_vitals AS p_show_vitals,
        p.preferred_theme AS p_preferred_theme, p.sync_private_contributions AS p_sync_private, p.updated_at AS p_updated_at,
        pt.id AS pt_id, pt.species AS pt_species, pt.name AS pt_name, pt.level AS pt_level, pt.xp AS pt_xp,
        pt.max_exp AS pt_max_exp, pt.evolution_stage AS pt_evolution_stage, pt.mood AS pt_mood,
        pt.energy AS pt_energy, pt.hunger AS pt_hunger, pt.happiness AS pt_happiness,
        pt.last_interacted_at AS pt_last_interacted_at, pt.last_welcome_bonus_at AS pt_last_welcome_bonus_at,
        pt.updated_at AS pt_updated_at
      FROM users u
      JOIN github_accounts a ON a.id = u.github_account_id
      JOIN user_profiles p ON p.user_id = u.id
      JOIN pet_states pt ON pt.user_id = u.id
      WHERE u.id = $1;`,
      [userId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      user: {
        id: row.u_id,
        github_account_id: row.u_github_account_id,
        primary_handle: row.u_primary_handle,
        role: row.u_role,
        is_suspended: row.u_is_suspended,
        created_at: row.u_created_at,
        updated_at: row.u_updated_at,
      },
      account: {
        id: row.a_id,
        github_user_id: row.a_github_user_id,
        username: row.a_username,
        encrypted_access_token: row.a_encrypted_access_token,
        encrypted_refresh_token: row.a_encrypted_refresh_token,
        token_expires_at: row.a_token_expires_at,
        refresh_expires_at: row.a_refresh_expires_at,
        has_private_contributions_scope: row.a_has_private_scope,
        is_disconnected: row.a_is_disconnected,
        created_at: row.a_created_at,
        updated_at: row.a_updated_at,
      },
      profile: {
        id: row.p_id,
        user_id: row.u_id,
        display_name: row.p_display_name,
        bio: row.p_bio,
        timezone: row.p_timezone,
        visibility: row.p_visibility,
        show_streak: row.p_show_streak,
        show_vitals: row.p_show_vitals,
        preferred_theme: row.p_preferred_theme,
        sync_private_contributions: row.p_sync_private,
        updated_at: row.p_updated_at,
      },
      pet: {
        id: row.pt_id,
        user_id: row.u_id,
        species: row.pt_species,
        name: row.pt_name,
        level: row.pt_level,
        xp: row.pt_xp,
        max_exp: row.pt_max_exp,
        evolution_stage: row.pt_evolution_stage,
        mood: row.pt_mood,
        energy: row.pt_energy,
        hunger: row.pt_hunger,
        happiness: row.pt_happiness,
        last_interacted_at: row.pt_last_interacted_at,
        last_welcome_bonus_at: row.pt_last_welcome_bonus_at,
        updated_at: row.pt_updated_at,
      },
    };
  }

  /**
   * Updates encrypted access and refresh tokens for an account, resets disconnect flag, increments token_version,
   * resets token_refresh_status to 'idle', and clears the refresh lease.
   * If expectedOwnerToken is provided, conditionally updates ONLY if token_refresh_owner matches,
   * guaranteeing that a stale worker whose lease expired or was revoked cannot overwrite newer credentials.
   * Returns true if updated; false if the worker's lease was lost.
   */
  public static async updateTokens(
    githubAccountId: string,
    encryptedAccessToken: string,
    encryptedRefreshToken?: string | null,
    tokenExpiresAt?: Date | null,
    refreshExpiresAt?: Date | null,
    expectedOwnerToken?: string | null,
    client?: PoolClient
  ): Promise<boolean> {
    const db = client || getPool();

    if (expectedOwnerToken) {
      const res = await db.query(
        `UPDATE github_accounts
        SET encrypted_access_token = $1,
            encrypted_refresh_token = $2,
            token_expires_at = $3,
            refresh_expires_at = $4,
            is_disconnected = FALSE,
            token_refresh_locked_at = NULL,
            token_refresh_owner = NULL,
            token_refresh_status = 'idle',
            token_refresh_dispatched_at = NULL,
            token_refresh_dispatched_version = NULL,
            token_version = token_version + 1,
            updated_at = NOW()
        WHERE id = $5
          AND token_refresh_owner = $6
        RETURNING token_version;`,
        [
          encryptedAccessToken,
          encryptedRefreshToken || null,
          tokenExpiresAt || null,
          refreshExpiresAt || null,
          githubAccountId,
          expectedOwnerToken,
        ]
      );
      return (res.rowCount ?? 0) > 0;
    }

    const res = await db.query(
      `UPDATE github_accounts
      SET encrypted_access_token = $1,
          encrypted_refresh_token = $2,
          token_expires_at = $3,
          refresh_expires_at = $4,
          is_disconnected = FALSE,
          token_refresh_locked_at = NULL,
          token_refresh_owner = NULL,
          token_refresh_status = 'idle',
          token_refresh_dispatched_at = NULL,
          token_refresh_dispatched_version = NULL,
          token_version = token_version + 1,
          updated_at = NOW()
      WHERE id = $5
      RETURNING token_version;`,
      [
        encryptedAccessToken,
        encryptedRefreshToken || null,
        tokenExpiresAt || null,
        refreshExpiresAt || null,
        githubAccountId,
      ]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Attempts to claim an atomic, short-lived distributed lease for token refresh.
   * Assigns a unique owner identifier (fencing token).
   * Refuses lease acquisition if token_refresh_status is 'ambiguous'.
   * Returns true if the lease was acquired by this ownerToken; false if another caller holds active lease or account is ambiguous.
   */
  public static async acquireTokenRefreshLease(
    githubAccountId: string,
    ownerToken: string,
    leaseTtlSeconds = 30,
    client?: PoolClient
  ): Promise<boolean> {
    const db = client || getPool();
    const res = await db.query(
      `UPDATE github_accounts
      SET token_refresh_locked_at = NOW(),
          token_refresh_owner = $2
      WHERE id = $1
        AND (token_refresh_locked_at IS NULL OR token_refresh_locked_at < NOW() - make_interval(secs => $3))
        AND token_refresh_status != 'ambiguous'
      RETURNING id, token_version, token_refresh_status, token_refresh_dispatched_version;`,
      [githubAccountId, ownerToken, leaseTtlSeconds]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Records atomic pre-dispatch intent before calling GitHub OAuth refresh endpoint.
   * Sets token_refresh_status = 'dispatched' and notes the dispatched token_version.
   */
  public static async markRefreshDispatched(
    githubAccountId: string,
    ownerToken: string,
    tokenVersion: number,
    client?: PoolClient
  ): Promise<boolean> {
    const db = client || getPool();
    const res = await db.query(
      `UPDATE github_accounts
      SET token_refresh_status = 'dispatched',
          token_refresh_dispatched_at = NOW(),
          token_refresh_dispatched_version = $3,
          updated_at = NOW()
      WHERE id = $1
        AND token_refresh_owner = $2;`,
      [githubAccountId, ownerToken, tokenVersion]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Marks an account as in an ambiguous refresh rotation state requiring user reauthorization.
   * Releases lease and prevents automatic re-submission of the potentially consumed refresh token.
   */
  public static async markRefreshAmbiguous(
    githubAccountId: string,
    ownerToken?: string | null,
    client?: PoolClient
  ): Promise<boolean> {
    const db = client || getPool();
    if (ownerToken) {
      const res = await db.query(
        `UPDATE github_accounts
        SET token_refresh_status = 'ambiguous',
            token_refresh_locked_at = NULL,
            token_refresh_owner = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND token_refresh_owner = $2;`,
        [githubAccountId, ownerToken]
      );
      return (res.rowCount ?? 0) > 0;
    }

    const res = await db.query(
      `UPDATE github_accounts
      SET token_refresh_status = 'ambiguous',
          token_refresh_locked_at = NULL,
          token_refresh_owner = NULL,
          updated_at = NOW()
      WHERE id = $1;`,
      [githubAccountId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Releases an active token refresh lease.
   * If ownerToken is provided, only releases if the current lease is owned by ownerToken.
   * A stale worker cannot release another worker's lease.
   */
  public static async releaseTokenRefreshLease(
    githubAccountId: string,
    ownerToken?: string | null,
    client?: PoolClient
  ): Promise<boolean> {
    const db = client || getPool();
    if (ownerToken) {
      const res = await db.query(
        `UPDATE github_accounts
        SET token_refresh_locked_at = NULL,
            token_refresh_owner = NULL
        WHERE id = $1
          AND token_refresh_owner = $2;`,
        [githubAccountId, ownerToken]
      );
      return (res.rowCount ?? 0) > 0;
    }

    const res = await db.query(
      'UPDATE github_accounts SET token_refresh_locked_at = NULL, token_refresh_owner = NULL WHERE id = $1;',
      [githubAccountId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Reads the current GitHub account row directly for fresh token state validation.
   */
  public static async findGitHubAccountById(
    githubAccountId: string,
    client?: PoolClient
  ): Promise<GitHubAccountRow | null> {
    const db = client || getPool();
    const res = await db.query<GitHubAccountRow>(
      'SELECT * FROM github_accounts WHERE id = $1;',
      [githubAccountId]
    );
    return res.rows[0] || null;
  }

  /**
   * Safely disconnects a GitHub account by clearing encrypted tokens and flagging is_disconnected.
   * Retains the user, profile, and pet state intact.
   */
  public static async disconnectGitHubAccount(
    userId: string,
    client?: PoolClient
  ): Promise<boolean> {
    return withTransaction(async (tx) => {
      // Step 1: Lock users first (Lock 0A in global hierarchy) to serialize with worker reconciliation
      const userRes = await tx.query<{ github_account_id: string }>(
        'SELECT github_account_id FROM users WHERE id = $1 FOR UPDATE;',
        [userId]
      );
      if (userRes.rows.length === 0) {
        return false;
      }
      const accountId = userRes.rows[0].github_account_id;

      // Step 2: Lock & update github_accounts (Lock 0B in global hierarchy)
      const res = await tx.query(
        `UPDATE github_accounts
        SET encrypted_access_token = NULL,
            encrypted_refresh_token = NULL,
            token_expires_at = NULL,
            refresh_expires_at = NULL,
            is_disconnected = TRUE,
            updated_at = NOW()
        WHERE id = $1;`,
        [accountId]
      );

      return (res.rowCount ?? 0) > 0;
    }, client);
  }

  /**
   * Explicit Account Deletion Transaction:
   * Guarantees that deleting a user removes the linked github_accounts record
   * (including encrypted OAuth tokens) and all cascaded child records.
   */
  public static async deleteAccountCascade(userId: string, client?: PoolClient): Promise<boolean> {
    return withTransaction(async (tx) => {
      // 1. Fetch github_account_id linked to user
      const userRes = await tx.query<{ github_account_id: string }>(
        'SELECT github_account_id FROM users WHERE id = $1 FOR UPDATE;',
        [userId]
      );

      if (userRes.rows.length === 0) {
        return false;
      }

      const accountId = userRes.rows[0].github_account_id;

      // 2. Delete github_accounts record.
      // Foreign key constraint (users.github_account_id REFERENCES github_accounts(id) ON DELETE CASCADE)
      // automatically cascades to users, user_profiles, pet_states, activity_reward_ledger,
      // daily_sync_states, and care_action_idempotency.
      await tx.query('DELETE FROM github_accounts WHERE id = $1;', [accountId]);

      // 3. Defense-in-depth: Ensure user record is purged if foreign key did not trigger
      await tx.query('DELETE FROM users WHERE id = $1;', [userId]);

      return true;
    }, client);
  }
}
