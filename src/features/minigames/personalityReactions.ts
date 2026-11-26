/**
 * GitHub Profile Pet - Mini-games Personality Reactions Catalog
 * Sprint 5.1B: Interactive Activities, Mini-games & Companion Play System
 */

import type { PersonalityId, BehaviourState } from '../personality/types.ts';
import type { MiniGameId, MiniGameEventReaction, RhythmRating } from './types.ts';

export type MiniGameEventType =
  | 'start'
  | 'catch_star'
  | 'miss_star'
  | 'spark_correct'
  | 'spark_wrong'
  | 'rhythm_hit'
  | 'rhythm_miss'
  | 'game_complete';

export interface GameEventContext {
  gameId: MiniGameId;
  personality: PersonalityId;
  streak?: number;
  score?: number;
  isNewBest?: boolean;
  rating?: RhythmRating;
}

const START_REACTIONS: Record<PersonalityId, string[]> = {
  curious: [
    'Analyzing game parameters... Let’s observe the rules!',
    'A new challenge begins. Let’s map out the optimal strategy.',
    'Tracking velocity and pattern trajectories...',
  ],
  determined: [
    'Focus locked! We aim for operational perfection.',
    'Mission initiated. Keep composure and execute cleanly.',
    'Ready for the test. No concessions on accuracy.',
  ],
  playful: [
    'Game time! Let’s get a giant high score together! 🎉',
    'Yay! I love this activity! Paws ready, let’s go!',
    'Hop, skip, play! Show me your best moves!',
  ],
  calm: [
    'Breathe in, breathe out. Play with an unhurried mind.',
    'Entering the flow state. Let the game unfold naturally.',
    'Gentle focus and calm reflexes will guide us.',
  ],
};

const SUCCESS_REACTIONS: Record<PersonalityId, string[]> = {
  curious: [
    'Pattern recognized! Precise calculation.',
    'Telemetry confirmed: optimal angle and timing!',
    'Data points captured cleanly. Well analyzed!',
  ],
  determined: [
    'Superb execution! Maintain that discipline.',
    'Target acquired! Keep the pressure on.',
    'Flawless hit. That’s how we protect the build!',
  ],
  playful: [
    'WHEEE! You caught it! Best score ever!',
    'Awesome reflex! Tail is wagging at maximum speed!',
    'High score streak! Look at you go!',
  ],
  calm: [
    'A harmonious movement. Fluid and centered.',
    'Effortless precision. Perfectly balanced.',
    'Smooth as water. Beautiful cadence.',
  ],
};

const MISTAKE_REACTIONS: Record<PersonalityId, string[]> = {
  curious: [
    'Interesting deviation! Recalibrating for next attempt...',
    'Timing anomaly observed. We’ll adjust the variance.',
    'No problem! Every anomaly teaches us something.',
  ],
  determined: [
    'Shake it off! Regroup and push forward.',
    'Minor misfire. Regain your stance and attack again.',
    'Warriors don’t fret over a slip. Keep fighting.',
  ],
  playful: [
    'Oopsie! That one was tricky! We’ll catch the next! ❤️',
    'Haha, nearly had it! Let’s try again!',
    'Don’t worry! We’re having fun regardless!',
  ],
  calm: [
    'Every miss is a gentle lesson in stillness. Stay centered.',
    'Let the mistake drift away like a ripple.',
    'Breathe softly. Balance will restore itself.',
  ],
};

const FINISH_HIGH_REACTIONS: Record<PersonalityId, string[]> = {
  curious: [
    'Remarkable metrics! A breakthrough performance logged.',
    'Telemetry indicates peak cognitive precision. Superb run!',
  ],
  determined: [
    'Victory earned! That is standard of a true guardian.',
    'Outstanding discipline! Record shattered with honor.',
  ],
  playful: [
    'NEW BEST SCORE!! Confetti and fireworks everywhere! 🎊',
    'WE DID IT!! Jumping with pure uncontainable joy!',
  ],
  calm: [
    'A truly radiant round. Deep equilibrium achieved.',
    'Exemplary harmony. Growth unfolded with grace.',
  ],
};

const FINISH_STANDARD_REACTIONS: Record<PersonalityId, string[]> = {
  curious: [
    'Round concluded! Diagnostic logs show steady improvement.',
    'Insightful session. Our data pool expands.',
  ],
  determined: [
    'Good round completed. Continuous practice sharpens skill.',
    'Solid effort. Ready to train again whenever called.',
  ],
  playful: [
    'That was so much fun! Can we play again right now?',
    'Good game, teammate! Big cuddles and cheers!',
  ],
  calm: [
    'A tranquil session finished. Feeling centered and refreshed.',
    'Peaceful play restores the spirit nicely.',
  ],
};

export function getMiniGameReaction(
  event: MiniGameEventType,
  ctx: GameEventContext,
  seedIndex?: number
): MiniGameEventReaction {
  const p = ctx.personality || 'curious';
  const pick = (arr: string[]): string => {
    if (!arr || arr.length === 0) return 'Well done!';
    const idx = seedIndex !== undefined ? seedIndex % arr.length : Math.floor(Math.random() * arr.length);
    return arr[idx];
  };

  switch (event) {
    case 'start':
      return {
        reactionText: pick(START_REACTIONS[p]),
        behaviourState: p === 'curious' ? 'head_tilt' : p === 'playful' ? 'playing' : p === 'determined' ? 'training' : 'idle_calm',
        thoughtBubble: `Let's play ${ctx.gameId.replace(/_/g, ' ')}!`,
      };

    case 'catch_star':
    case 'spark_correct':
    case 'rhythm_hit': {
      const isHighStreak = (ctx.streak ?? 0) >= 4;
      const text = pick(SUCCESS_REACTIONS[p]);
      const behaviour: BehaviourState =
        isHighStreak ? 'celebrating' : p === 'playful' ? 'playing' : p === 'curious' ? 'head_tilt' : 'happy';
      return {
        reactionText: text,
        behaviourState: behaviour,
        thoughtBubble: isHighStreak ? `Combo x${ctx.streak}! 🔥` : `Nice hit! ✨`,
      };
    }

    case 'miss_star':
    case 'spark_wrong':
    case 'rhythm_miss': {
      const text = pick(MISTAKE_REACTIONS[p]);
      const behaviour: BehaviourState = p === 'curious' ? 'terminal_pondering' : 'idle_calm';
      return {
        reactionText: text,
        behaviourState: behaviour,
        thoughtBubble: `Keep going! 💪`,
      };
    }

    case 'game_complete': {
      const isHigh = ctx.isNewBest || (ctx.score ?? 0) >= 80;
      const pool = isHigh ? FINISH_HIGH_REACTIONS[p] : FINISH_STANDARD_REACTIONS[p];
      return {
        reactionText: pick(pool),
        behaviourState: isHigh ? 'celebrating' : 'happy',
        thoughtBubble: isHigh ? '🎉 Outstanding Play!' : '✨ Good Game!',
      };
    }

    default:
      return {
        reactionText: 'Enjoying our game together!',
        behaviourState: 'idle_calm',
      };
  }
}
