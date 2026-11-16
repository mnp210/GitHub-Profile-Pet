// src/lib/db/repositories/sessionRepository.ts
// Repository for Persistent Server-Side Sessions with SHA-256 Token Hashing

import type { PoolClient } from 'pg';
import { getPool } from '../pool.ts';
import { hashSessionToken } from '../../security/crypto.ts';
import type {
  UserSessionRow,
  UserRow,
  GitHubAccountRow,
  UserProfileRow,
  PetStateRow,
} from '../types.ts';

export const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface CreateSessionInput {
  userId: string;
  rawToken: string;
  ttlSeconds?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ActiveSessionContext {
  session: UserSessionRow;
  user: UserRow;
  account: GitHubAccountRow;
  profile: UserProfileRow;
  pet: PetStateRow;
}

export class SessionRepository {
  /**
   * Persists a new user session storing only the SHA-256 hash of the token.
   */
  public static async createSession(
    input: CreateSessionInput,
    client?: PoolClient
  ): Promise<UserSessionRow> {
    const db = client || getPool();
    const tokenHash = hashSessionToken(input.rawToken);
    const ttl = input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const res = await db.query<UserSessionRow>(
      `INSERT INTO user_sessions (
        user_id, session_token_hash, expires_at, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *;`,
      [input.userId, tokenHash, expiresAt, input.ipAddress || null, input.userAgent || null]
    );

    return res.rows[0];
  }

  /**
   * Validates a raw session token and resolves the authenticated trainer context.
   * Checks expiration and ensures the session has not been revoked.
   */
  public static async findActiveSession(
    rawToken: string,
    client?: PoolClient
  ): Promise<ActiveSessionContext | null> {
    if (!rawToken || typeof rawToken !== 'string') {
      return null;
    }

    const db = client || getPool();
    const tokenHash = hashSessionToken(rawToken);

    const res = await db.query<{
      s_id: string;
      s_user_id: string;
      s_session_token_hash: string;
      s_expires_at: Date;
      s_created_at: Date;
      s_last_active_at: Date;
      s_revoked_at: Date | null;
      s_ip_address: string | null;
      s_user_agent: string | null;
      // User
      u_id: string;
      u_github_account_id: string;
      u_primary_handle: string;
      u_role: 'trainer' | 'admin';
      u_is_suspended: boolean;
      u_created_at: Date;
      u_updated_at: Date;
      // Account
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
      // Profile
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
      // Pet
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
        s.id AS s_id, s.user_id AS s_user_id, s.session_token_hash AS s_session_token_hash,
        s.expires_at AS s_expires_at, s.created_at AS s_created_at, s.last_active_at AS s_last_active_at,
        s.revoked_at AS s_revoked_at, s.ip_address AS s_ip_address, s.user_agent AS s_user_agent,
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
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      JOIN github_accounts a ON a.id = u.github_account_id
      JOIN user_profiles p ON p.user_id = u.id
      JOIN pet_states pt ON pt.user_id = u.id
      WHERE s.session_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_suspended = FALSE;`,
      [tokenHash]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];

    return {
      session: {
        id: row.s_id,
        user_id: row.s_user_id,
        session_token_hash: row.s_session_token_hash,
        expires_at: row.s_expires_at,
        created_at: row.s_created_at,
        last_active_at: row.s_last_active_at,
        revoked_at: row.s_revoked_at,
        ip_address: row.s_ip_address,
        user_agent: row.s_user_agent,
      },
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
   * Throttled activity touch (updates last_active_at if > 5 minutes have elapsed).
   */
  public static async touchSession(sessionId: string, client?: PoolClient): Promise<void> {
    const db = client || getPool();
    await db.query(
      `UPDATE user_sessions
      SET last_active_at = NOW()
      WHERE id = $1
        AND last_active_at < NOW() - INTERVAL '5 minutes';`,
      [sessionId]
    );
  }

  /**
   * Revokes a session immediately by raw token.
   */
  public static async revokeSession(rawToken: string, client?: PoolClient): Promise<boolean> {
    const db = client || getPool();
    const tokenHash = hashSessionToken(rawToken);

    const res = await db.query(
      `UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE session_token_hash = $1
        AND revoked_at IS NULL;`,
      [tokenHash]
    );

    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Revokes all active sessions for a user (e.g. security reset or password change).
   */
  public static async revokeAllUserSessions(userId: string, client?: PoolClient): Promise<number> {
    const db = client || getPool();
    const res = await db.query(
      `UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL;`,
      [userId]
    );
    return res.rowCount ?? 0;
  }
}
