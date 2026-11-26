/**
 * GitHub Profile Pet - Bonding & Activities Catalog
 * Sprint 5.2B: Companion Bonding & Daily Activities System
 */

import type {
  BondMilestone,
  BondMilestoneId,
  DailyActivity,
  DailyActivityId,
  RotatingChallenge,
  RotatingChallengeId,
} from './types.ts';
import type { PersonalityType } from '../../types/pet.ts';

// ── BONDING MILESTONES ────────────────────────────────────────────────────────

export const BOND_MILESTONES: Record<BondMilestoneId, BondMilestone> = {
  milestone_first_meeting: {
    level: 1,
    id: 'milestone_first_meeting',
    name: 'First Meeting',
    description: 'You and your companion begin your journey together.',
    requiredPoints: 0,
    celebrationTitle: 'New Companionship!',
    celebrationMessage: 'Your pet acknowledges you with gentle warmth.',
  },
  milestone_getting_comfortable: {
    level: 2,
    id: 'milestone_getting_comfortable',
    name: 'Getting Comfortable',
    description: 'Your companion recognizes your presence and shows excitement.',
    requiredPoints: 50,
    celebrationTitle: 'Getting Comfortable!',
    celebrationMessage: 'Your pet purrs softly and nudges closer.',
    rewardCosmeticId: 'companion_badge',
  },
  milestone_trusted_companion: {
    level: 3,
    id: 'milestone_trusted_companion',
    name: 'Trusted Companion',
    description: 'A deep mutual trust has formed through shared care and focus.',
    requiredPoints: 120,
    celebrationTitle: 'Trusted Companion!',
    celebrationMessage: 'Your companion mirrors your determination and shares calm moments.',
    rewardCosmeticId: 'decorative_frame',
  },
  milestone_play_partners: {
    level: 4,
    id: 'milestone_play_partners',
    name: 'Play Partners',
    description: 'Joyful synergy across games, care, and daily milestones.',
    requiredPoints: 220,
    celebrationTitle: 'Incredible Play Partners!',
    celebrationMessage: 'Your pet dances enthusiastically whenever you visit.',
    rewardCosmeticId: 'star_charm',
  },
  milestone_unbreakable_bond: {
    level: 5,
    id: 'milestone_unbreakable_bond',
    name: 'Unbreakable Bond',
    description: 'The pinnacle of developer companionship: lifelong, steadfast solidarity.',
    requiredPoints: 350,
    celebrationTitle: 'Unbreakable Bond!',
    celebrationMessage: 'A radiant harmony connects you and your companion forever.',
    rewardCosmeticId: 'guardian_emblem',
  },
};

export const BOND_MILESTONES_LIST: BondMilestone[] = [
  BOND_MILESTONES.milestone_first_meeting,
  BOND_MILESTONES.milestone_getting_comfortable,
  BOND_MILESTONES.milestone_trusted_companion,
  BOND_MILESTONES.milestone_play_partners,
  BOND_MILESTONES.milestone_unbreakable_bond,
];

export const MAX_BOND_POINTS = 500;

// ── DAILY ACTIVITIES CATALOG ──────────────────────────────────────────────────

export const DAILY_ACTIVITIES_CATALOG: Record<DailyActivityId, DailyActivity> = {
  daily_care_warmth: {
    id: 'daily_care_warmth',
    name: 'Tender Care',
    description: 'Complete 1 care action (Feed, Play, Train, or Rest) to nurture your companion.',
    icon: '🍖',
    targetCount: 1,
    bondPointsReward: 15,
  },
  daily_companion_pet: {
    id: 'daily_companion_pet',
    name: 'Gentle Stroke',
    description: 'Directly stroke or tap your companion 3 times in the pet arena.',
    icon: '✨',
    targetCount: 3,
    bondPointsReward: 15,
  },
  daily_minigame_play: {
    id: 'daily_minigame_play',
    name: 'Playtime Session',
    description: 'Complete 1 companion mini-game session (Star Catcher, Memory Sparks, or Rhythm).',
    icon: '🎮',
    targetCount: 1,
    bondPointsReward: 15,
  },
  daily_wardrobe_style: {
    id: 'daily_wardrobe_style',
    name: 'Styling Session',
    description: 'Visit the Wardrobe and try on or switch any cosmetic item.',
    icon: '👒',
    targetCount: 1,
    bondPointsReward: 15,
  },
  daily_personality_chat: {
    id: 'daily_personality_chat',
    name: 'Kind Observation',
    description: 'Interact with your pet to hear a contextual personality thought.',
    icon: '💬',
    targetCount: 1,
    bondPointsReward: 15,
  },
};

export const DAILY_ACTIVITIES_LIST: DailyActivity[] = Object.values(DAILY_ACTIVITIES_CATALOG);

// ── ROTATING CHALLENGES CATALOG ───────────────────────────────────────────────

export const ROTATING_CHALLENGES_CATALOG: Record<RotatingChallengeId, RotatingChallenge> = {
  challenge_rhythm_flow: {
    id: 'challenge_rhythm_flow',
    name: 'Rhythm Groove',
    description: 'Score 80+ points in Companion Rhythm with your pet.',
    icon: '🎵',
    targetCount: 80,
    bondPointsReward: 25,
  },
  challenge_spark_focus: {
    id: 'challenge_spark_focus',
    name: 'Memory Synapse',
    description: 'Reach Round 3 or higher in Memory Sparks.',
    icon: '🧠',
    targetCount: 3,
    bondPointsReward: 25,
  },
  challenge_starlight_collector: {
    id: 'challenge_starlight_collector',
    name: 'Cosmic Gathering',
    description: 'Score 75+ points in Star Catcher.',
    icon: '⭐',
    targetCount: 75,
    bondPointsReward: 25,
  },
  challenge_triple_care: {
    id: 'challenge_triple_care',
    name: 'Devoted Guardian',
    description: 'Perform 3 care actions today to ensure your companion thrives.',
    icon: '❤️',
    targetCount: 3,
    bondPointsReward: 25,
  },
  challenge_personality_insight: {
    id: 'challenge_personality_insight',
    name: 'Personality Bonding',
    description: 'Engage in 2 care or play sessions matching your companion’s spirit.',
    icon: '🌟',
    targetCount: 2,
    bondPointsReward: 25,
  },
  challenge_fashion_flair: {
    id: 'challenge_fashion_flair',
    name: 'Wardrobe Coordinator',
    description: 'Equip an accessory and an environment background simultaneously.',
    icon: '🎨',
    targetCount: 1,
    bondPointsReward: 25,
  },
  challenge_perfect_day: {
    id: 'challenge_perfect_day',
    name: 'Harmonious Trio',
    description: 'Complete all 3 of today’s daily activities.',
    icon: '🏅',
    targetCount: 3,
    bondPointsReward: 25,
  },
};

export const ROTATING_CHALLENGES_LIST: RotatingChallenge[] = Object.values(ROTATING_CHALLENGES_CATALOG);

// ── PERSONALITY DIALOGUE & REACTIONS ──────────────────────────────────────────

export function getBondingPersonalityDialogue(
  personality: PersonalityType,
  event: 'milestone' | 'daily_complete' | 'challenge_complete',
  contextName?: string
): string {
  switch (personality) {
    case 'curious':
      if (event === 'milestone') {
        return `Fascinating! Our bond reached ${contextName}! Every moment together uncovers new wonders in the cosmos.`;
      }
      if (event === 'challenge_complete') {
        return `Hypothesis proven! We analyzed the challenge and conquered it with brilliant precision!`;
      }
      return `Discovery logged! That daily task brought fresh data and immense happiness to my heart!`;

    case 'determined':
      if (event === 'milestone') {
        return `Steadfast and true! We have achieved ${contextName}. Through discipline and loyalty, our strength is unmatched!`;
      }
      if (event === 'challenge_complete') {
        return `Mission completed! No objective is too daunting when we stand side by side!`;
      }
      return `Another objective secured. Consistent devotion creates enduring victories!`;

    case 'playful':
      if (event === 'milestone') {
        return `WOOHOO! Look at us! ${contextName}! High five! You are the greatest play partner in the whole universe!`;
      }
      if (event === 'challenge_complete') {
        return `That was thrilling! We rocked that challenge! Can we do another victory flip?`;
      }
      return `Yay! That was so much fun! Doing things with you always makes my tail wag!`;

    case 'calm':
      if (event === 'milestone') {
        return `A tranquil dawn breaks upon our path. Reaching ${contextName} fills my spirit with serene gratitude.`;
      }
      if (event === 'challenge_complete') {
        return `In stillness and focus, the challenge has found harmonious completion.`;
      }
      return `A gentle step forward. Your quiet companionship is the greatest comfort.`;

    default:
      return 'Our companion bond grows stronger with each shared moment.';
  }
}
