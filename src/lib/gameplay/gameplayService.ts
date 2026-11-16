// src/lib/gameplay/gameplayService.ts
// Server-authoritative gameplay service for pet actions, rewards, cooldowns, and idempotency

import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction.ts';
import { getPool } from '../db/pool.ts';
import type { PetStateRow, CareActionIdempotencyRow } from '../db/types.ts';
import { LedgerRepository } from '../db/repositories/ledgerRepository.ts';
import { determineEvolutionStage } from '../db/repositories/petRepository.ts';
import type { ActionHistoryEntry, ActionType, CalculatedReward } from '../../features/gamification/rewards.ts';
import {
  ACTION_COOLDOWN_MS,
  calculateActionReward,
} from '../../features/gamification/rewards.ts';
import {
  addExperience,
  clampVital,
  deriveMood,
} from '../../features/gamification/progression.ts';
import { applyRestAction } from '../../features/gamification/recovery.ts';
import { getSpeciesReaction } from '../../features/gamification/speciesReactions.ts';
import type { PetMood, PetState, SpeciesId } from '../../types/pet.ts';

export const TRAINING_ENERGY_COST = 18;
export const MAX_SATIETY_LIMIT = 100;

export interface GameplaySuccessResult {
  success: true;
  isRetry: boolean;
  action: ActionType;
  clientActionId: string;
  pet: PetState;
  reward: CalculatedReward;
  didLevelUp: boolean;
  levelsGained: number;
  reaction: string;
}

export interface GameplayRejectedResult {
  success: false;
  isRetry: boolean;
  action: ActionType;
  clientActionId: string;
  rejectedReason: string;
  reaction: string;
  cooldownRemainingMs?: number;
  currentPet?: PetState;
}

export type GameplayActionResult = GameplaySuccessResult | GameplayRejectedResult;

export class GameplayService {
  /**
   * Executes a server-authoritative care action (train, feed, rest, pet) within an atomic database transaction.
   */
  public static async handleAction(params: {
    userId: string;
    action: ActionType;
    clientActionId: string;
    nowMs?: number;
    client?: PoolClient;
  }): Promise<GameplayActionResult> {
    const { userId, action, clientActionId, client } = params;
    const nowMs = params.nowMs || Date.now();

    return withTransaction(async (tx) => {
      // 1. Idempotency Check: if this clientActionId was already executed, return original result
      const existingActionRes = await tx.query<CareActionIdempotencyRow>(
        'SELECT * FROM care_action_idempotency WHERE user_id = $1 AND client_action_id = $2 FOR UPDATE;',
        [userId, clientActionId]
      );

      if (existingActionRes.rows.length > 0) {
        const existing = existingActionRes.rows[0];
        if (existing.response_payload) {
          return {
            ...(existing.response_payload as unknown as GameplaySuccessResult),
            isRetry: true,
          };
        }
      }

      // 2. Lock and retrieve current Pet State
      const petRes = await tx.query<PetStateRow>(
        'SELECT * FROM pet_states WHERE user_id = $1 FOR UPDATE;',
        [userId]
      );

      if (petRes.rows.length === 0) {
        return {
          success: false,
          isRetry: false,
          action,
          clientActionId,
          rejectedReason: `No pet found for user ${userId}.`,
          reaction: 'A mysterious silence echoes...',
        };
      }

      const petRow = petRes.rows[0];
      const currentPetState: PetState = {
        name: petRow.name,
        species: petRow.species as SpeciesId,
        level: petRow.level,
        xp: petRow.xp,
        maxExp: petRow.max_exp,
        mood: petRow.mood as PetMood,
        evolutionStage: petRow.evolution_stage,
        hunger: petRow.hunger,
        happiness: petRow.happiness,
        energy: petRow.energy,
      };

      // 3. Server-side Action Cooldown Enforcement (800ms)
      const lastActionRes = await tx.query<{ executed_at: Date }>(
        'SELECT executed_at FROM care_action_idempotency WHERE user_id = $1 ORDER BY executed_at DESC LIMIT 1;',
        [userId]
      );

      if (lastActionRes.rows.length > 0) {
        const lastExecutedMs = new Date(lastActionRes.rows[0].executed_at).getTime();
        const elapsedMs = nowMs - lastExecutedMs;

        if (elapsedMs < ACTION_COOLDOWN_MS) {
          const remainingMs = ACTION_COOLDOWN_MS - elapsedMs;
          return {
            success: false,
            isRetry: false,
            action,
            clientActionId,
            rejectedReason: `Action Cooldown: Please wait ${Math.ceil(remainingMs / 100) / 10}s before next action.`,
            reaction: 'Paws are busy — catch your breath!',
            cooldownRemainingMs: remainingMs,
            currentPet: currentPetState,
          };
        }
      }

      // 4. Pre-condition Action Validations
      if (action === 'train' && petRow.energy < TRAINING_ENERGY_COST) {
        return {
          success: false,
          isRetry: false,
          action,
          clientActionId,
          rejectedReason: `Insufficient Energy: Training requires ${TRAINING_ENERGY_COST} energy (currently ${petRow.energy}). Use REST first.`,
          reaction: getSpeciesReaction(petRow.species as SpeciesId, 'exhausted'),
          currentPet: currentPetState,
        };
      }

      if (action === 'feed' && petRow.hunger >= MAX_SATIETY_LIMIT) {
        return {
          success: false,
          isRetry: false,
          action,
          clientActionId,
          rejectedReason: `Satiety Full: Pet is at maximum fullness (${petRow.hunger}/${MAX_SATIETY_LIMIT}). Train or play to build appetite.`,
          reaction: getSpeciesReaction(petRow.species as SpeciesId, 'full'),
          currentPet: currentPetState,
        };
      }

      // 5. Query Recent Action History from Database for Diminishing Returns (60s rolling window)
      const rollingCutoff = new Date(nowMs - 60_000);
      const historyRes = await tx.query<{ action_type: string; executed_at: Date }>(
        'SELECT action_type, executed_at FROM care_action_idempotency WHERE user_id = $1 AND executed_at >= $2 ORDER BY executed_at ASC;',
        [userId, rollingCutoff]
      );

      const history: ActionHistoryEntry[] = historyRes.rows.map((row) => ({
        action: row.action_type as ActionType,
        timestamp: new Date(row.executed_at).getTime(),
      }));

      // Calculate Diminishing Returns
      const reward = calculateActionReward(action, history, nowMs);

      // 6. Calculate Vitals & Recovery Changes
      let newEnergy = petRow.energy;
      let newHunger = petRow.hunger;
      let newHappiness = petRow.happiness;

      if (action === 'rest') {
        const restResult = applyRestAction(petRow.energy);
        newEnergy = restResult.newEnergy;
        newHappiness = clampVital(petRow.happiness + reward.happinessGained);
      } else {
        newEnergy = clampVital(petRow.energy - reward.energyCost);
        newHunger = clampVital(petRow.hunger + reward.hungerGained);
        newHappiness = clampVital(petRow.happiness + reward.happinessGained);
      }

      // 7. Experience, Leveling & Evolution Progression
      const expResult = addExperience(petRow.level, petRow.xp, reward.expGained);
      const newEvolutionStage = determineEvolutionStage(expResult.newLevel);
      const newMood = deriveMood({
        energy: newEnergy,
        hunger: newHunger,
        happiness: newHappiness,
      });

      const reaction = expResult.didLevelUp
        ? getSpeciesReaction(petRow.species as SpeciesId, 'level_up')
        : getSpeciesReaction(petRow.species as SpeciesId, action);

      // 8. Atomically Update pet_states
      const updatedPetRes = await tx.query<PetStateRow>(
        `UPDATE pet_states SET
          level = $1, xp = $2, max_exp = $3, evolution_stage = $4, mood = $5,
          energy = $6, hunger = $7, happiness = $8,
          last_interacted_at = NOW(), updated_at = NOW()
        WHERE user_id = $9
        RETURNING *;`,
        [
          expResult.newLevel,
          expResult.newXp,
          expResult.maxExp,
          newEvolutionStage,
          newMood,
          newEnergy,
          newHunger,
          newHappiness,
          userId,
        ]
      );
      const updatedRow = updatedPetRes.rows[0];

      const updatedPetState: PetState = {
        name: updatedRow.name,
        species: updatedRow.species as SpeciesId,
        level: updatedRow.level,
        xp: updatedRow.xp,
        maxExp: updatedRow.max_exp,
        mood: updatedRow.mood as PetMood,
        evolutionStage: updatedRow.evolution_stage,
        hunger: updatedRow.hunger,
        happiness: updatedRow.happiness,
        energy: updatedRow.energy,
      };

      // 9. Append to Activity Reward Ledger if XP was awarded
      if (reward.expGained > 0) {
        const canonicalActivityId = `urn:pet:action:${userId}:${clientActionId}`;
        await LedgerRepository.appendEntry(
          {
            userId,
            canonicalActivityId,
            activityType: `care_action_${action}`,
            xpAwarded: reward.expGained,
            satietyAwarded: reward.hungerGained,
            ruleVersion: 1,
          },
          tx
        );
      }

      // 10. Construct Final Success Payload
      const responsePayload: GameplaySuccessResult = {
        success: true,
        isRetry: false,
        action,
        clientActionId,
        pet: updatedPetState,
        reward,
        didLevelUp: expResult.didLevelUp,
        levelsGained: expResult.levelsGained,
        reaction,
      };

      // 11. Persist Idempotency Record with Serialized Response Payload
      await tx.query(
        `INSERT INTO care_action_idempotency (user_id, client_action_id, action_type, response_payload, executed_at)
        VALUES ($1, $2, $3, $4, $5);`,
        [userId, clientActionId, action, JSON.stringify(responsePayload), new Date(nowMs)]
      );

      return responsePayload;
    }, client);
  }

  /**
   * Retrieves the current authoritative pet state for an authenticated user.
   */
  public static async getPetState(userId: string): Promise<PetState | null> {
    const pool = getPool();
    const res = await pool.query<PetStateRow>(
      'SELECT * FROM pet_states WHERE user_id = $1;',
      [userId]
    );

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      name: row.name,
      species: row.species as SpeciesId,
      level: row.level,
      xp: row.xp,
      maxExp: row.max_exp,
      mood: row.mood as PetMood,
      evolutionStage: row.evolution_stage,
      hunger: row.hunger,
      happiness: row.happiness,
      energy: row.energy,
    };
  }
}
