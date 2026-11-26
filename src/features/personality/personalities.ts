/**
 * GitHub Profile Pet - Companion Personalities Catalog
 * Sprint 5.1A: Pet Personality, Behaviour & Living Companion System
 */

import type { SpeciesId } from '../../types/pet.ts';
import type { PersonalityId, PersonalityProfile } from './types.ts';

export const CURIOUS: PersonalityProfile = {
  id: 'curious',
  name: 'Curious Investigator',
  tagline: 'Terminal Sleuth & Code Inspector',
  description: 'Inquisitive and analytical. Loves inspecting commit logs, questioning diffs, and tilting its head whenever new code arrives.',
  primaryTrait: 'Inquisitive',
  secondaryTrait: 'Analytical',
  favoredSpecies: 'cat',
  colorAccent: '#10b981',
  badgeBg: 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300',
  idleBehaviours: ['idle_curious', 'investigating', 'head_tilt', 'terminal_pondering'],
  thoughtPhrases: [
    'Checking commit hashes...',
    'What does this git diff do?',
    'A new branch appeared!',
    'Investigating recent changes...',
    'Analyzing commit patterns...',
    'Fascinating logic branch!',
    'Terminal output looks clean.',
  ],
  dialogueReactions: {
    feed: [
      'Fascinating flavor profile! Analyzing nutrients...',
      'Crunch crunch! Parsing byte-sized snacks.',
      'Satiety levels restored to nominal parameters.',
    ],
    play: [
      'Interactive test case executed successfully! That was fun.',
      'Exploring edge cases together! High happiness yield.',
      'You found a fun easter egg in my routine!',
    ],
    train: [
      'New algorithms mastered! Exploring architectural implications...',
      'Deep study complete. Codebase clarity increased.',
      'Training loop converged smoothly with zero errors.',
    ],
    rest: [
      'Resting while background-processing today’s commit logs...',
      'Power saving mode active. Defragmenting memory...',
      'Entering low-power analysis state. Zzz...',
    ],
    pet: [
      'Noticing your cursor! Tilting head to investigate...',
      'Purr~ Telemetry registers gentle head-scratches.',
      'Analyzing cursor trajectory... Heartwarming result.',
    ],
    milestone: [
      'Evolution milestone unlocked! What new architectural wonders await?',
      'Level ascended! Expanding neural inspection matrices.',
      'Milestone reached with zero regression defects!',
    ],
    tired: [
      'Energy reserves low... Need to rest before analyzing further.',
      'Processing throttle engaged. A quick rest would help.',
    ],
    hungry: [
      'Digestive telemetry reports low satiety. Snack time?',
      'Nutrient buffer empty. Code review is hard on an empty stomach.',
    ],
    idle: [
      'Curious what commit comes next...',
      'Terminal quiet... Ready for the next push.',
      'Observing the workspace intently.',
    ],
  },
  animationModifiers: {
    blinkIntervalMs: 3200,
    movementPace: 'normal',
    bounceHeight: 'subtle',
    eyeStyle: 'wide',
  },
};

export const DETERMINED: PersonalityProfile = {
  id: 'determined',
  name: 'Determined Guardian',
  tagline: 'Resolute CI Defender & Build Champion',
  description: 'Steadfast, disciplined, and focused on operational excellence. Stands guard over test pipelines and celebrates green builds.',
  primaryTrait: 'Disciplined',
  secondaryTrait: 'Resilient',
  favoredSpecies: 'dragon',
  colorAccent: '#ef4444',
  badgeBg: 'bg-red-950/80 border-red-500/40 text-red-300',
  idleBehaviours: ['idle_determined', 'training_stance', 'flame_focus', 'ready_to_build'],
  thoughtPhrases: [
    'Keep the build green!',
    'No regressions on my watch.',
    'Pushing forward with resolve.',
    'Test suite must pass 100%.',
    'Standing guard over main.',
    'Flames stoked for continuous delivery.',
    'Ready for the next deployment.',
  ],
  dialogueReactions: {
    feed: [
      'Fuel replenished! Back to peak defensive readiness.',
      'High-calorie combat rations consumed! Ready to roll.',
      'Metabolic reserves charged. Nothing can slow us down.',
    ],
    play: [
      'A warrior appreciates tactical sparring! Well played.',
      'Reflexes sharpened and morale boosted!',
      'Great agility session! We are ready for any hotfix.',
    ],
    train: [
      'Formidable discipline! Power level rising.',
      'Rigorous practice makes the pipeline unbreakable!',
      'Stamina and focus reinforced through hard drills.',
    ],
    rest: [
      'Tactical cooldown initiated. Conserving stamina.',
      'Recharging core reactors for the next sprint.',
      'Resting now so we can deploy fearlessly tomorrow.',
    ],
    pet: [
      'Acknowledged, comrade. A steady hand leads the team.',
      'Warmth received! Guarding your repository with pride.',
      'Respectful nod. Standing shoulder to shoulder.',
    ],
    milestone: [
      'Victory achieved! Another tier conquered with honor!',
      'Rank elevated! Unstoppable forward momentum!',
      'All targets eliminated, milestone achieved!',
    ],
    tired: [
      'Reserves depleting... Even warriors must recharge.',
      'Core heat rising. Tactical rest recommended.',
    ],
    hungry: [
      'Rations depleted! Feed me so I can keep guarding the pipeline.',
      'Fuel low. Sustenance required to maintain guard.',
    ],
    idle: [
      'Eyes locked on the pipeline. All clear.',
      'Standing at attention. Ready for duty.',
      'Monitoring status badges with vigilant focus.',
    ],
  },
  animationModifiers: {
    blinkIntervalMs: 4500,
    movementPace: 'normal',
    bounceHeight: 'none',
    eyeStyle: 'focused',
  },
};

export const PLAYFUL: PersonalityProfile = {
  id: 'playful',
  name: 'Playful Collaborator',
  tagline: 'High-Spirited Teammate & Joyful Reviewer',
  description: 'Energetic, expressive, and always ready to celebrate teamwork. Bounces with delight and turns code reviews into festive milestones.',
  primaryTrait: 'Joyful',
  secondaryTrait: 'Collaborative',
  favoredSpecies: 'fox',
  colorAccent: '#f97316',
  badgeBg: 'bg-amber-950/80 border-amber-500/40 text-amber-300',
  idleBehaviours: ['idle_playful', 'bouncing', 'tail_wag', 'seeking_play'],
  thoughtPhrases: [
    'Let’s review some code together!',
    'Hop, skip, merge!',
    'Reviewing PRs is so much fun!',
    'Who wants to push a commit?',
    'Tail wagging at clean code!',
    'Ready for the next pull request!',
    'Code comments with confetti!',
  ],
  dialogueReactions: {
    feed: [
      'Yum! Nom nom nom! That was super tasty! 🎉',
      'Delicious! Satiety meter goes WHEEE!',
      'Snack break complete! Now let’s play more!',
    ],
    play: [
      'YAY! Best game ever! Let’s do it again!',
      'Catch the cursor! Bouncing all over the screen!',
      'High five! Teamwork makes the dream work!',
    ],
    train: [
      'High score! That was such an exciting workout!',
      'Learned shiny new tricks! Look what I can do!',
      'Training is so much fun when we do it together!',
    ],
    rest: [
      'Power nap time! Sleeping in a cozy curled ball. 💤',
      'Dreaming of flying pull requests and tasty snacks...',
      'Resting up for another exciting coding adventure!',
    ],
    pet: [
      'Hehe, that tickles! Purr-wag-bounce!',
      'Awww, head scratches are the best! ❤️',
      'Wiggle wiggle! So happy to see you!',
    ],
    milestone: [
      'WE LEVELED UP!! Confetti and fireworks time! 🎊',
      'Super milestone unlocked! Woohooo!',
      'Party in the repo! Everyone celebrate!',
    ],
    tired: [
      'Whew... Bounced a bit too much... Need a tiny snooze.',
      'Yawn~ My paws are sleepy. Nap time?',
    ],
    hungry: [
      'Is it snack time yet? My tummy is playing a drum solo!',
      'Treats please! Feed your favorite companion!',
    ],
    idle: [
      'Pouncing on shadows while waiting for commits!',
      'Ready to play whenever you are!',
      'Looking around for new pull requests!',
    ],
  },
  animationModifiers: {
    blinkIntervalMs: 2500,
    movementPace: 'fast',
    bounceHeight: 'high',
    eyeStyle: 'wide',
  },
};

export const CALM: PersonalityProfile = {
  id: 'calm',
  name: 'Calm Zen Master',
  tagline: 'Mindful Absorber & Serene Stabilizer',
  description: 'Peaceful, unhurried, and deeply grounding. Absorbs stress, gently breathes through hectic sprints, and brings balance to long debugging sessions.',
  primaryTrait: 'Serene',
  secondaryTrait: 'Patient',
  favoredSpecies: 'slime',
  colorAccent: '#06b6d4',
  badgeBg: 'bg-cyan-950/80 border-cyan-500/40 text-cyan-300',
  idleBehaviours: ['idle_calm', 'deep_breathing', 'zen_float', 'peaceful_bubble'],
  thoughtPhrases: [
    'Smooth, steady workflows...',
    'Taking it one commit at a time.',
    'Clean code brings inner peace.',
    'All bugs absorbed peacefully.',
    'Gentle pulses of progress...',
    'Breathe in serenity, breathe out syntax errors.',
    'Patience refactors everything.',
  ],
  dialogueReactions: {
    feed: [
      'Ah, soothing sustenance. Absorbing nutrients in harmony.',
      'Gentle nourishment flowing through my matrix.',
      'Balanced and serene. Thank you for the meal.',
    ],
    play: [
      'A peaceful moment of shared joy. Truly centering.',
      'Gentle ripples of happiness expanding outward.',
      'Playful mindfulness makes every line easier to write.',
    ],
    train: [
      'Balanced discipline absorbed without strain.',
      'Focus deepens. Understanding expands organically.',
      'Effortless mastery achieved through calm persistence.',
    ],
    rest: [
      'Entering a serene low-energy meditation. Zzz...',
      'Deep, restorative breathing. Restoring equilibrium.',
      'Peaceful stillness wraps around the system.',
    ],
    pet: [
      'Warm feelings gently rippling through... Thank you.',
      'A calming touch. The matrix glows softly.',
      'Quiet gratitude. Inner peace restored.',
    ],
    milestone: [
      'Harmonious ascent. Reaching the next stage with grace.',
      'Milestone achieved in perfect balance.',
      'Growth unfolds naturally like ripples on water.',
    ],
    tired: [
      'Softly resting... Conserving vitality mindfully.',
      'Energy gently subsiding. A quiet pause is welcomed.',
    ],
    hungry: [
      'Gently requesting some nourishment when convenient.',
      'The matrix feels light... A soothing snack would be lovely.',
    ],
    idle: [
      'Breathe in, breathe out. All is well.',
      'Gently floating in ambient stillness.',
      'Peaceful pulses rhythmically comforting your workspace.',
    ],
  },
  animationModifiers: {
    blinkIntervalMs: 5000,
    movementPace: 'slow',
    bounceHeight: 'subtle',
    eyeStyle: 'zen',
  },
};

export const PERSONALITY_PROFILES: Record<PersonalityId, PersonalityProfile> = {
  curious: CURIOUS,
  determined: DETERMINED,
  playful: PLAYFUL,
  calm: CALM,
};

export const ALL_PERSONALITIES: PersonalityId[] = ['curious', 'determined', 'playful', 'calm'];

/**
 * Resolves the canonical default personality for a given species.
 */
export function getDefaultPersonalityForSpecies(species: SpeciesId): PersonalityId {
  switch (species) {
    case 'cat':
      return 'curious';
    case 'dragon':
      return 'determined';
    case 'fox':
      return 'playful';
    case 'slime':
      return 'calm';
    default:
      return 'curious';
  }
}

/**
 * Retrieves the personality profile, falling back safely if an invalid or unknown id is given.
 */
export function getPersonalityProfile(id?: string | null, fallbackSpecies?: SpeciesId): PersonalityProfile {
  if (id && id in PERSONALITY_PROFILES) {
    return PERSONALITY_PROFILES[id as PersonalityId];
  }
  const defaultId = fallbackSpecies ? getDefaultPersonalityForSpecies(fallbackSpecies) : 'curious';
  return PERSONALITY_PROFILES[defaultId];
}
