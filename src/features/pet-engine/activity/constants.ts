/**
 * GitHub Profile Pet - Activity Progression Constants
 *
 * Centrally defines balanced XP rewards, daily caps, and bot/automation exclusion rules.
 */

import type { ActivityType } from './types.ts';

export const ACTIVITY_LEDGER_SCHEMA_VERSION = 1;

/**
 * Centrally defined XP rewards for qualifying repository activities.
 */
export const ACTIVITY_XP_REWARDS: Record<ActivityType, number> = {
  commit: 15,          // 15 XP per unique human commit
  issue_opened: 10,    // 10 XP per unique human issue created
  pr_opened: 25,       // 25 XP per unique pull request created
  pr_merged: 50,       // 50 XP completion reward when a PR is merged
  review_submitted: 20,// 20 XP per substantive review submitted
};

/**
 * Maximum activity XP that can be earned in a single UTC calendar day.
 * Protects game economy and prevents rapid automated grinding.
 */
export const DAILY_ACTIVITY_XP_CAP = 300;

/**
 * Known bot logins and substrings to exclude from activity progression.
 */
export const KNOWN_BOT_LOGINS = [
  'github-actions[bot]',
  'github-actions',
  'dependabot[bot]',
  'dependabot',
  'coderabbitai[bot]',
  'coderabbitai',
  'renovate[bot]',
  'renovate',
  'greenkeeper[bot]',
  'snyk-bot',
  'vercel[bot]',
] as const;

/**
 * Commit message patterns that indicate automation or CI-skipping commits.
 */
export const IGNORE_COMMIT_MESSAGE_PATTERNS = [
  /\[skip ci\]/i,
  /\[ci skip\]/i,
  /^pet:\s/i,
  /^chore\(pet\):/i,
  /auto-update pet svg/i,
  /^docs:\s(install|update)\spet\smenu/i,
  /^Merge pull request/i,
  /^Merge branch/i,
] as const;

/**
 * Issue label prefix for pet care actions (which are handled by Inbox processor, not activity XP).
 */
export const PET_CARE_ACTION_LABEL_PREFIX = 'pet:';
export const PET_ACTION_PENDING_LABEL = 'pet-action:pending';

/**
 * Maximum number of recent event records retained in the activity ledger.
 */
export const MAX_RECENT_EVENTS_RETAINED = 100;

/**
 * Maximum number of processed identifiers retained per category in the deduplication registry.
 * Prevents unbounded array growth while safely guarding recent replay boundaries.
 */
export const MAX_REGISTRY_ENTRIES = 500;

/**
 * Maximum lookback age in days for activity event eligibility.
 * Events older than 14 days UTC are rejected as stale, allowing safe bounded pruning of older registry entries.
 */
export const MAX_ACTIVITY_AGE_DAYS = 14;

/**
 * Maximum number of daily accrued XP records retained (in days).
 * Daily records older than 30 days are pruned during state transitions.
 */
export const MAX_DAILY_ACCRUED_DAYS = 30;
