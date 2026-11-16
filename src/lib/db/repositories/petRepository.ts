// src/lib/db/repositories/petRepository.ts
// Repository for Virtual Pet State, Vitals Clamping, and Action Idempotency

import type { PoolClient } from 'pg';
import { getPool } from '../pool.ts';
import { withTransaction } from '../transaction.ts';
import type { PetStateRow, CareActionIdempotencyRow } from '../types.ts';
import type { ActionHistoryEntry, ActionType } from '../../../features/gamification/rewards.ts';

export interface VitalsUpdate {
  energy?: number;
  hunger?: number;
  happiness?: number;
  mood?: string;
  lastInteractedAt?: Date;
  lastWelcomeBonusAt?: Date | null;
}

export interface ExperienceResult {
  previousLevel: number;
  newLevel: number;
  currentXp: number;
  maxExp: number;
  evolutionStage: string;
  leveledUp: boolean;
  totalXpAdded: number;
}

export function determineEvolutionStage(level: number): string {
  if (level >= 50) return 'Mythic';
  if (level >= 25) return 'Ascendant';
  if (level >= 10) return 'Juvenile';
  return 'Hatchling';
}

export class PetRepository {
  /**
   * Retrieves pet state for a given user.
   */
  public static async findByUserId(
    userId: string,
    client?: PoolClient
  ): Promise<PetStateRow | null> {
    const db = client || getPool();
    const res = await db.query<PetStateRow>(
      'SELECT * FROM pet_states WHERE user_id = $1;',
      [userId]
    );
    return res.rows[0] || null;
  }

  /**
   * Atomically updates pet vitals, enforcing [0, 100] bounds.
   */
  public static async updateVitals(
    userId: string,
    updates: VitalsUpdate,
    client?: PoolClient
  ): Promise<PetStateRow> {
    return withTransaction(async (tx) => {
      const petRes = await tx.query<PetStateRow>(
        'SELECT * FROM pet_states WHERE user_id = $1 FOR UPDATE;',
        [userId]
      );
      if (petRes.rows.length === 0) {
        throw new Error(`Pet not found for user ${userId}`);
      }
      const pet = petRes.rows[0];

      const energy = updates.energy !== undefined
        ? Math.max(0, Math.min(100, Math.round(updates.energy)))
        : pet.energy;
      const hunger = updates.hunger !== undefined
        ? Math.max(0, Math.min(100, Math.round(updates.hunger)))
        : pet.hunger;
      const happiness = updates.happiness !== undefined
        ? Math.max(0, Math.min(100, Math.round(updates.happiness)))
        : pet.happiness;
      const mood = updates.mood || pet.mood;
      const lastInteractedAt = updates.lastInteractedAt || pet.last_interacted_at;
      const lastWelcomeBonusAt = updates.lastWelcomeBonusAt !== undefined
        ? updates.lastWelcomeBonusAt
        : pet.last_welcome_bonus_at;

      const updatedRes = await tx.query<PetStateRow>(
        `UPDATE pet_states SET
          energy = $1, hunger = $2, happiness = $3, mood = $4,
          last_interacted_at = $5, last_welcome_bonus_at = $6, updated_at = NOW()
        WHERE user_id = $7
        RETURNING *;`,
        [energy, hunger, happiness, mood, lastInteractedAt, lastWelcomeBonusAt, userId]
      );
      return updatedRes.rows[0];
    }, client);
  }

  /**
   * Applies experience points to the pet with overflow leveling mechanics:
   * MaxXP(L) = L * 100
   */
  public static async applyExperience(
    userId: string,
    xpDelta: number,
    client?: PoolClient
  ): Promise<ExperienceResult> {
    if (xpDelta <= 0) {
      const pet = await this.findByUserId(userId, client);
      if (!pet) throw new Error(`Pet not found for user ${userId}`);
      return {
        previousLevel: pet.level,
        newLevel: pet.level,
        currentXp: pet.xp,
        maxExp: pet.max_exp,
        evolutionStage: pet.evolution_stage,
        leveledUp: false,
        totalXpAdded: 0,
      };
    }

    return withTransaction(async (tx) => {
      const petRes = await tx.query<PetStateRow>(
        'SELECT * FROM pet_states WHERE user_id = $1 FOR UPDATE;',
        [userId]
      );
      if (petRes.rows.length === 0) {
        throw new Error(`Pet not found for user ${userId}`);
      }
      const pet = petRes.rows[0];
      const previousLevel = pet.level;

      let level = pet.level;
      let xp = pet.xp + xpDelta;
      let maxExp = level * 100;
      let leveledUp = false;

      // Handle multiple level-ups and XP carryover
      while (xp >= maxExp) {
        xp -= maxExp;
        level += 1;
        maxExp = level * 100;
        leveledUp = true;
      }

      const evolutionStage = determineEvolutionStage(level);

      await tx.query(
        `UPDATE pet_states SET
          level = $1, xp = $2, max_exp = $3, evolution_stage = $4, updated_at = NOW()
        WHERE user_id = $5;`,
        [level, xp, maxExp, evolutionStage, userId]
      );

      return {
        previousLevel,
        newLevel: level,
        currentXp: xp,
        maxExp,
        evolutionStage,
        leveledUp,
        totalXpAdded: xpDelta,
      };
    }, client);
  }

  /**
   * Finds an existing care action by composite key (user_id, client_action_id).
   */
  public static async findCareAction(
    userId: string,
    clientActionId: string,
    client?: PoolClient
  ): Promise<CareActionIdempotencyRow | null> {
    const db = client || getPool();
    const res = await db.query<CareActionIdempotencyRow>(
      'SELECT * FROM care_action_idempotency WHERE user_id = $1 AND client_action_id = $2;',
      [userId, clientActionId]
    );
    return res.rows[0] || null;
  }

  /**
   * Retrieves the timestamp of the most recent care action for cooldown validation.
   */
  public static async getLastCareActionTimestamp(
    userId: string,
    client?: PoolClient
  ): Promise<number | null> {
    const db = client || getPool();
    const res = await db.query<{ executed_at: Date }>(
      'SELECT executed_at FROM care_action_idempotency WHERE user_id = $1 ORDER BY executed_at DESC LIMIT 1;',
      [userId]
    );
    return res.rows[0] ? new Date(res.rows[0].executed_at).getTime() : null;
  }

  /**
   * Retrieves recent action history within a rolling window (default 60,000ms) for diminishing returns calculation.
   */
  public static async getRecentCareActionHistory(
    userId: string,
    windowMs: number = 60_000,
    client?: PoolClient
  ): Promise<ActionHistoryEntry[]> {
    const db = client || getPool();
    const cutoffDate = new Date(Date.now() - windowMs);
    const res = await db.query<{ action_type: string; executed_at: Date }>(
      'SELECT action_type, executed_at FROM care_action_idempotency WHERE user_id = $1 AND executed_at >= $2 ORDER BY executed_at ASC;',
      [userId, cutoffDate]
    );
    return res.rows.map((row) => ({
      action: row.action_type as ActionType,
      timestamp: new Date(row.executed_at).getTime(),
    }));
  }

  /**
   * Records a client care action with per-user composite idempotency and optional response payload:
   * UNIQUE (user_id, client_action_id)
   */
  public static async recordCareActionIdempotent(
    userId: string,
    clientActionId: string,
    actionType: string,
    responsePayload?: Record<string, unknown> | null,
    client?: PoolClient
  ): Promise<{ isDuplicate: boolean; actionId: string | null }> {
    const db = client || getPool();

    const res = await db.query<{ id: string }>(
      `INSERT INTO care_action_idempotency (user_id, client_action_id, action_type, response_payload)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, client_action_id) DO NOTHING
      RETURNING id;`,
      [userId, clientActionId, actionType, responsePayload ? JSON.stringify(responsePayload) : null]
    );

    if (res.rows.length === 0) {
      return { isDuplicate: true, actionId: null };
    }

    return { isDuplicate: false, actionId: res.rows[0].id };
  }
}
