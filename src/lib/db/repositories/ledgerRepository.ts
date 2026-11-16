// src/lib/db/repositories/ledgerRepository.ts
// Append-only auditable reward ledger for GitHub activity and care actions

import type { PoolClient } from 'pg';
import { getPool } from '../pool.ts';
import type { ActivityRewardLedgerRow } from '../types.ts';

export interface AppendLedgerInput {
  userId: string;
  canonicalActivityId: string;
  activityType: string;
  xpAwarded: number;
  satietyAwarded?: number;
  ruleVersion?: number;
}

export class LedgerRepository {
  /**
   * Appends an immutable reward transaction into the ledger.
   * Enforces UNIQUE (user_id, canonical_activity_id).
   */
  public static async appendEntry(
    input: AppendLedgerInput,
    client?: PoolClient
  ): Promise<ActivityRewardLedgerRow> {
    const db = client || getPool();

    const res = await db.query<ActivityRewardLedgerRow>(
      `INSERT INTO activity_reward_ledger (
        user_id, canonical_activity_id, activity_type, xp_awarded,
        satiety_awarded, rule_version
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;`,
      [
        input.userId,
        input.canonicalActivityId,
        input.activityType,
        input.xpAwarded,
        input.satietyAwarded || 0,
        input.ruleVersion || 1,
      ]
    );

    return res.rows[0];
  }

  /**
   * Finds a ledger entry by user ID and canonical activity ID.
   */
  public static async findByCanonicalId(
    userId: string,
    canonicalActivityId: string,
    client?: PoolClient
  ): Promise<ActivityRewardLedgerRow | null> {
    const db = client || getPool();

    const res = await db.query<ActivityRewardLedgerRow>(
      `SELECT * FROM activity_reward_ledger
      WHERE user_id = $1 AND canonical_activity_id = $2;`,
      [userId, canonicalActivityId]
    );

    return res.rows[0] || null;
  }

  /**
   * Retrieves recent ledger history ordered by awarded_at DESC.
   */
  public static async getRecentHistory(
    userId: string,
    limit: number = 20,
    client?: PoolClient
  ): Promise<ActivityRewardLedgerRow[]> {
    const db = client || getPool();

    const res = await db.query<ActivityRewardLedgerRow>(
      `SELECT * FROM activity_reward_ledger
      WHERE user_id = $1
      ORDER BY awarded_at DESC
      LIMIT $2;`,
      [userId, limit]
    );

    return res.rows;
  }

  /**
   * Calculates total XP awarded to a user for a specific UTC date.
   */
  public static async getDailyTotal(
    userId: string,
    dateIso: string,
    client?: PoolClient
  ): Promise<number> {
    const db = client || getPool();

    const res = await db.query<{ total: string | null }>(
      `SELECT SUM(xp_awarded) as total
      FROM activity_reward_ledger
      WHERE user_id = $1 AND DATE(awarded_at AT TIME ZONE 'UTC') = $2::DATE;`,
      [userId, dateIso]
    );

    return parseInt(res.rows[0]?.total || '0', 10);
  }
}
