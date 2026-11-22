import type { SpeciesId } from '../../types/pet.ts';
import type { ActionType } from './rewards.ts';

export type ReactionTrigger = ActionType | 'level_up' | 'exhausted' | 'full';

export const SPECIES_REACTIONS: Record<SpeciesId, Record<ReactionTrigger, string>> = {
  cat: {
    pet: 'Purrs contentedly and rubs its fuzzy void ears against your cursor.',
    play: 'Chases an arcane laser pointer across the terminal and pounces with joy!',
    train: 'Hones void claws on your terminal logs with lethal agility!',
    feed: 'Nibbles a byte-sized salmon commit and grooms whiskers.',
    rest: 'Curls into a snug pixelated orb and dozes quietly.',
    level_up: 'Void aura flares with purple starlight — level up!',
    exhausted: 'Y locality depleted... too tired to train. Needs rest!',
    full: 'Turned up its nose — belly full of merge treats.',
  },
  dragon: {
    pet: 'Puffs a warm ember smoke-ring and leans into your hand.',
    play: 'Leaps into the air catching floating ember orbs with playful glee!',
    train: 'Practices blazing flame breath against stale git branches!',
    feed: 'Gnashes happily on a spicy flame-roasted commit banquet.',
    rest: 'Slumbers atop a warm pile of merged pull requests.',
    level_up: 'Draconic wings expand with roaring celestial fury!',
    exhausted: 'Ember breath is sputtering out... let the dragon rest!',
    full: 'Smokes gently and shakes head — hoard is completely full.',
  },
  fox: {
    pet: 'Yips playfully and swishes its voluminous bushy tail.',
    play: 'Pounces playfully on a digital tumbleweed with boundless cheer!',
    train: 'Darts nimbly through rapid code review obstacle courses!',
    feed: 'Crunches golden solar berries with sparkling eyes.',
    rest: 'Tucks bushy tail over snout and drifts into serene sleep.',
    level_up: 'Nine-tail solar radiance blazes with ascended wisdom!',
    exhausted: 'Pant... pant... paws are heavy. Needs a restorative nap!',
    full: 'Buries remaining snack in the cache — already well fed.',
  },
  slime: {
    pet: 'Jiggles warmly with iridescent gelatinous bubbles.',
    play: 'Bounces like a joyful superball, emitting harmonic chimes!',
    train: 'Splashes matrix gel into rigorous tactical shapes!',
    feed: 'Absorbs green bug-fix pellets and swells happily.',
    rest: 'Settles into a calm, translucent resting puddle.',
    level_up: 'Core matrix crystal resonates — cellular ascension!',
    exhausted: 'Gel turned watery and unstable. Requires rest to solidify!',
    full: 'Gel surface tension maxed out — cannot absorb more.',
  },
};

export function getSpeciesReaction(species: SpeciesId, trigger: ReactionTrigger): string {
  const speciesReactions = SPECIES_REACTIONS[species] || SPECIES_REACTIONS.cat;
  return speciesReactions[trigger] || 'The companion acknowledges your action.';
}
