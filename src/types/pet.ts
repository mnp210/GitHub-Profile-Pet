export type SpeciesId = 'cat' | 'dragon' | 'fox' | 'slime';

export type PetMood = 'Energetic' | 'Happy' | 'Focused' | 'Curious' | 'Resting';

export type PersonalityType = 'curious' | 'playful' | 'calm' | 'determined';

export interface EvolutionMilestone {
  stage: number;
  title: string;
  requiredLevel: number;
  description: string;
  unlocked: boolean;
  perks: string[];
}

export interface PetSpeciesMeta {
  id: SpeciesId;
  name: string;
  title: string;
  element: string;
  rarity: 'Common' | 'Rare' | 'Epic' | 'Legendary';
  description: string;
  personality: string;
  favoredActivity: string;
  primaryColor: string;
  accentColor: string;
}

export interface PetState {
  name: string;
  species: SpeciesId;
  level: number;
  xp: number;
  maxExp: number;
  mood: PetMood;
  personality?: PersonalityType;
  behaviourState?: string;
  evolutionStage: string;
  hunger: number; // 0-100
  happiness: number; // 0-100
  energy: number; // 0-100
}
