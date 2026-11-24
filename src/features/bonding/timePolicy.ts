/**
 * GitHub Profile Pet - Bonding Time & Reset Policy
 * Sprint 5.2B: Companion Bonding & Daily Activities System
 *
 * Implements deterministic UTC calendar day boundaries and stable daily/rotating selection.
 */

import type { DailyActivityId, RotatingChallengeId } from './types.ts';
import { DAILY_ACTIVITIES_LIST, ROTATING_CHALLENGES_LIST } from './bondingCatalog.ts';

/**
 * Returns the current date in UTC format 'YYYY-MM-DD'.
 */
export function getTodayUtcDateString(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Simple deterministic hash for string date keys.
 */
function hashDateString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Deterministically selects exactly 3 daily activities for a given UTC calendar date.
 */
export function getDailyActivitiesForDate(dateKey: string): DailyActivityId[] {
  const hash = hashDateString(dateKey);
  const total = DAILY_ACTIVITIES_LIST.length; // 5

  // Pick 3 unique items using deterministic offset
  const selected: DailyActivityId[] = [];
  const offset = hash % total;

  for (let i = 0; i < 3; i++) {
    const idx = (offset + i * 2) % total;
    const item = DAILY_ACTIVITIES_LIST[idx].id;
    if (!selected.includes(item)) {
      selected.push(item);
    }
  }

  // Fallback if collision occurred
  for (const act of DAILY_ACTIVITIES_LIST) {
    if (selected.length >= 3) break;
    if (!selected.includes(act.id)) {
      selected.push(act.id);
    }
  }

  return selected.slice(0, 3);
}

/**
 * Deterministically selects the active rotating challenge for a given UTC calendar date.
 */
export function getRotatingChallengeForDate(dateKey: string): {
  challengeId: RotatingChallengeId;
  rotationKey: string;
} {
  const hash = hashDateString(dateKey);
  const idx = hash % ROTATING_CHALLENGES_LIST.length;
  return {
    challengeId: ROTATING_CHALLENGES_LIST[idx].id,
    rotationKey: dateKey,
  };
}
