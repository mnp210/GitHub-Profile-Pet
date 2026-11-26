'use client';

import React, { useState } from 'react';
import { PetState, PetSpeciesMeta } from '@/types/pet';
import { PetSprite, SpriteAnimationState } from './PetSprite';
import { retroAudio } from '@/lib/audio/retroAudio';
import type { ActionType } from '@/features/gamification/rewards';
import { getPersonalityProfile } from '@/features/personality/personalities';
import { mapBehaviourToSpriteState } from '@/features/personality/behaviourEngine';
import type { BehaviourState } from '@/features/personality/types';
import type { EquippedCosmetics } from '@/features/progression/types';
import { CosmeticAccessoryOverlay } from '@/components/cosmetics/CosmeticAccessoryOverlay';
import { CosmeticEffectLayer } from '@/components/cosmetics/CosmeticEffectLayer';
import { EnvironmentBackground } from '@/components/cosmetics/EnvironmentBackground';
import { CompanionDecorationOverlay } from '@/components/cosmetics/CompanionDecorationOverlay';

interface ParticleEffect {
  id: number;
  x: number;
  y: number;
  text: string;
  colorClass?: string;
  icon?: string;
}

interface PetDisplayProps {
  pet: PetState;
  speciesMeta: PetSpeciesMeta;
  onExecuteAction: (action: ActionType) => void;
  cooldownRemainingSeconds?: number;
  lastReaction?: string;
  isActionsSyncing?: boolean;
  thoughtBubble?: string;
  currentBehaviour?: string;
  onOpenMiniGames?: (defaultGameId?: string) => void;
  equippedCosmetics?: EquippedCosmetics;
  onOpenWardrobe?: () => void;
  onOpenBonding?: () => void;
  onDirectStroke?: () => void;
  bondLevel?: number;
  bondPoints?: number;
}

export const PetDisplay: React.FC<PetDisplayProps> = ({
  pet,
  speciesMeta,
  onExecuteAction,
  cooldownRemainingSeconds = 0,
  lastReaction,
  isActionsSyncing = false,
  thoughtBubble,
  currentBehaviour,
  onOpenMiniGames,
  equippedCosmetics,
  onOpenWardrobe,
  onOpenBonding,
  onDirectStroke,
  bondLevel = 1,
  bondPoints = 0,
}) => {
  const [particles, setParticles] = useState<ParticleEffect[]>([]);
  const [animationState, setAnimationState] = useState<SpriteAnimationState>('idle');
  const personalityProfile = getPersonalityProfile(pet.personality, pet.species);

  // Spawn visual particle on interaction
  const triggerParticle = (x: number, y: number, text: string, colorClass = 'text-pink-300', icon?: string) => {
    const newParticle: ParticleEffect = {
      id: Date.now() + Math.random(),
      x,
      y,
      text,
      colorClass,
      icon,
    };

    setParticles((prev) => [...prev.slice(-5), newParticle]);

    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== newParticle.id));
    }, 1400);
  };

  const handlePetDirectClick = () => {
    const pId = pet.personality || 'curious';
    const clickText =
      pId === 'curious'
        ? 'Tilt~'
        : pId === 'determined'
        ? 'Nod!'
        : pId === 'playful'
        ? 'Bounce!'
        : 'Ripple~';
    triggerParticle(150, 100, clickText, 'text-pink-400', '❤️');
    const animState =
      pId === 'curious' ? 'curious' : pId === 'playful' ? 'playing' : 'happy';
    setAnimationState(animState);
    retroAudio.playPurr();
    onExecuteAction('pet');
    onDirectStroke?.();
    setTimeout(() => setAnimationState('idle'), 800);
  };

  const handleActionClick = (action: ActionType) => {
    retroAudio.playClick();
    if (action === 'feed') {
      triggerParticle(160, 90, '+24 Satiety', 'text-amber-300', '🍖');
      setAnimationState('eating');
      retroAudio.playEat();
    } else if (action === 'play') {
      triggerParticle(160, 90, '+16 Happiness', 'text-cyan-300', '🎾');
      setAnimationState('playing');
      retroAudio.playPlay();
    } else if (action === 'train') {
      triggerParticle(160, 80, '+30 XP (-18⚡)', 'text-indigo-300', '⚔️');
      setAnimationState('training');
      retroAudio.playTrain();
    } else if (action === 'rest') {
      triggerParticle(160, 100, '+25 Energy', 'text-purple-300', '🌙');
      setAnimationState('sleeping');
      retroAudio.playRest();
    } else if (action === 'pet') {
      triggerParticle(160, 90, '+12 Happiness', 'text-pink-400', '❤️');
      setAnimationState('happy');
      retroAudio.playPurr();
      onDirectStroke?.();
    }

    onExecuteAction(action);
    setTimeout(() => setAnimationState('idle'), 1000);
  };

  const getMoodBadgeColor = () => {
    switch (pet.mood) {
      case 'Energetic':
        return 'text-amber-300 bg-amber-950/60 border-amber-500/40';
      case 'Resting':
        return 'text-indigo-300 bg-indigo-950/60 border-indigo-500/40';
      case 'Curious':
        return 'text-cyan-300 bg-cyan-950/60 border-cyan-500/40';
      default:
        return 'text-emerald-300 bg-emerald-950/60 border-emerald-500/40';
    }
  };

  return (
    <div className="relative flex flex-col items-center w-full max-w-full">
      {/* ARENA CONTAINER */}
      <div className="relative w-full aspect-16/10 sm:aspect-16/9 min-h-[300px] max-h-[380px] bg-gradient-to-b from-[#090b10] via-[#10131f] to-[#0c0e16] border-2 border-[#2b274c] rounded-2xl p-4 flex flex-col items-center justify-between select-none overflow-hidden shadow-2xl shadow-indigo-950/40">
        {/* Environment Backdrop Layer */}
        <EnvironmentBackground environmentId={equippedCosmetics?.environment ?? 'void_chamber'} />

        {/* Companion Decoration Layer */}
        <CompanionDecorationOverlay decorationId={equippedCosmetics?.decoration ?? null} />

        {/* TOP STATUS BAR: Element, Rarity, Mood & Cooldown Timer */}
        <div className="relative z-10 w-full flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#19152b] text-purple-200 border border-purple-800/50 shadow-sm">
              {speciesMeta.element}
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#141224] text-slate-400 border border-slate-700/50">
              {speciesMeta.rarity}
            </span>
            {isActionsSyncing && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-indigo-950 text-indigo-300 border border-indigo-700 animate-pulse">
                ⚡ Syncing Actions
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 text-[10px] font-bold rounded-md border font-mono ${personalityProfile.badgeBg}`}
              title={`Personality Archetype: ${personalityProfile.name}`}
            >
              {personalityProfile.name.split(' ')[0]}
            </span>
            {cooldownRemainingSeconds > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-950/80 text-amber-300 border border-amber-600/60 animate-pulse font-mono">
                ⏳ Cooldown: {cooldownRemainingSeconds}s
              </span>
            )}
            <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-md border shadow-sm ${getMoodBadgeColor()}`}>
              Mood: {pet.mood}
            </span>
          </div>
        </div>

        {/* FLOATING ACTION PARTICLES */}
        {particles.map((p) => (
          <div
            key={p.id}
            style={{ left: `${p.x}px`, top: `${p.y}px` }}
            className={`absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-1/2 font-bold text-sm ${p.colorClass} drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] animate-bounce flex items-center gap-1`}
          >
            {p.icon && <span>{p.icon}</span>}
            <span>{p.text}</span>
          </div>
        ))}

        {/* REACTION OR LIVING THOUGHT BUBBLE */}
        {(lastReaction || thoughtBubble) && (
          <div className="relative z-20 max-w-[85%] bg-[#1a172e]/90 border border-purple-500/30 rounded-xl px-3 py-1.5 text-center text-xs text-purple-200 shadow-lg backdrop-blur-sm animate-fade-in mt-1">
            <span className="italic font-medium">&ldquo;{lastReaction || thoughtBubble}&rdquo;</span>
          </div>
        )}

        {/* CENTERED PET SPRITE ARENA */}
        <div className="relative z-10 my-auto flex flex-col items-center justify-center">
          {/* Visual Effect Layer */}
          <CosmeticEffectLayer effectId={equippedCosmetics?.effect ?? null} />

          {/* Base Pet Sprite */}
          <PetSprite
            species={pet.species}
            personality={pet.personality}
            size={180}
            animationState={
              animationState === 'idle' && currentBehaviour
                ? mapBehaviourToSpriteState(currentBehaviour as BehaviourState)
                : animationState
            }
            evolutionStage={pet.evolutionStage}
            onClick={handlePetDirectClick}
          />

          {/* Accessory Layer Overlaid directly on Sprite */}
          <CosmeticAccessoryOverlay
            accessoryId={equippedCosmetics?.accessory ?? null}
            species={pet.species}
            size={180}
          />
        </div>

        {/* ARCANE PEDESTAL PLATFORM */}
        <div className="relative z-10 w-full flex flex-col items-center">
          <div className="w-48 sm:w-64 h-2.5 bg-gradient-to-r from-transparent via-[#312a59] to-transparent rounded-full border-t border-purple-500/40 shadow-[0_0_15px_rgba(147,51,234,0.3)]" />
          <div className="text-[11px] text-purple-300/70 mt-1 flex items-center justify-between w-full px-2">
            <span>✨ Tap companion to stroke</span>
            <span className="font-mono text-purple-400 font-semibold">{pet.name}</span>
          </div>
        </div>
      </div>

      {/* 5 GAMEPLAY ACTION CONTROLS */}
      <div className="w-full mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {/* 1. FEED */}
        <button
          onClick={() => handleActionClick('feed')}
          disabled={pet.hunger >= 100}
          className={`relative p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all text-xs font-bold shadow-md ${
            pet.hunger >= 100
              ? 'opacity-40 bg-[#12131a] border-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-[#181629] border-[#38315d] text-amber-200 hover:bg-[#231f3d] hover:border-amber-500/60 active:scale-95'
          }`}
          title="Feed companion: +24 Satiety, +10 XP"
        >
          <span className="text-xl">🍖</span>
          <span>Feed</span>
          <span className="text-[10px] text-amber-400 font-normal font-mono">+24 Sat</span>
        </button>

        {/* 2. PLAY */}
        <button
          onClick={() => handleActionClick('play')}
          disabled={pet.energy < 10}
          className={`relative p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all text-xs font-bold shadow-md ${
            pet.energy < 10
              ? 'opacity-40 bg-[#12131a] border-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-[#181629] border-[#38315d] text-cyan-200 hover:bg-[#231f3d] hover:border-cyan-500/60 active:scale-95'
          }`}
          title="Play with companion: +16 Happiness, -10 Energy, +15 XP"
        >
          <span className="text-xl">🎾</span>
          <span>Play</span>
          <span className="text-[10px] text-cyan-400 font-normal font-mono">+16 Joy (-10⚡)</span>
        </button>

        {/* 3. TRAIN */}
        <button
          onClick={() => handleActionClick('train')}
          disabled={pet.energy < 18}
          className={`relative p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all text-xs font-bold shadow-md ${
            pet.energy < 18
              ? 'opacity-40 bg-[#12131a] border-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-[#181629] border-[#38315d] text-indigo-200 hover:bg-[#231f3d] hover:border-indigo-500/60 active:scale-95'
          }`}
          title="Train companion: +30 XP, -18 Energy"
        >
          <span className="text-xl">⚔️</span>
          <span>Train</span>
          <span className="text-[10px] text-indigo-400 font-normal font-mono">+30 XP (-18⚡)</span>
        </button>

        {/* 4. REST */}
        <button
          onClick={() => handleActionClick('rest')}
          className="relative p-3 rounded-xl border border-[#38315d] bg-[#181629] text-purple-200 hover:bg-[#231f3d] hover:border-purple-500/60 active:scale-95 flex flex-col items-center justify-center gap-1 transition-all text-xs font-bold shadow-md"
          title="Rest companion: Restores energy to full"
        >
          <span className="text-xl">🌙</span>
          <span>Rest</span>
          <span className="text-[10px] text-purple-400 font-normal font-mono">+25⚡ (0 XP)</span>
        </button>

        {/* 5. PET */}
        <button
          onClick={() => handleActionClick('pet')}
          className="relative p-3 rounded-xl border border-[#38315d] bg-[#181629] text-pink-200 hover:bg-[#231f3d] hover:border-pink-500/60 active:scale-95 col-span-2 sm:col-span-1 flex flex-col items-center justify-center gap-1 transition-all text-xs font-bold shadow-md"
          title="Stroke pet: +12 Happiness, +6 XP"
        >
          <span className="text-xl">🐾</span>
          <span>Pet</span>
          <span className="text-[10px] text-pink-400 font-normal font-mono">+12 Joy (+6 XP)</span>
        </button>
      </div>

      {/* COMPANION ACTIVITY, WARDROBE & BONDING LAUNCHERS */}
      <div className="w-full mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {onOpenMiniGames && (
          <button
            onClick={() => onOpenMiniGames()}
            className="py-2 px-2.5 rounded-xl bg-gradient-to-r from-purple-950/80 to-indigo-950/80 hover:from-purple-900/90 hover:to-indigo-900/90 border border-purple-500/40 hover:border-purple-400 text-purple-200 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-[0.99] cursor-pointer"
            title="Launch interactive companion mini-games"
            aria-label="Open Companion Play Zone"
          >
            <span className="text-base">🎮</span>
            <span>Play Zone</span>
          </button>
        )}

        {onOpenWardrobe && (
          <button
            onClick={() => onOpenWardrobe()}
            className="py-2 px-2.5 rounded-xl bg-gradient-to-r from-indigo-950/80 to-pink-950/80 hover:from-indigo-900/90 hover:to-pink-900/90 border border-indigo-500/40 hover:border-indigo-400 text-indigo-200 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-[0.99] cursor-pointer"
            title="Open Wardrobe & Achievements Vault"
            aria-label="Open Wardrobe and Achievements Vault"
          >
            <span className="text-base">✨</span>
            <span>Wardrobe</span>
          </button>
        )}

        {onOpenBonding && (
          <button
            onClick={() => onOpenBonding()}
            className="py-2 px-2.5 rounded-xl bg-gradient-to-r from-pink-950/80 to-purple-950/80 hover:from-pink-900/90 hover:to-purple-900/90 border border-pink-500/40 hover:border-pink-400 text-pink-200 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-[0.99] cursor-pointer"
            title={`Open Companion Bonding & Daily Focus (${bondPoints} Pts)`}
            aria-label="Open Companion Bonding & Daily Focus"
          >
            <span className="text-base">🤝</span>
            <span>Bond (Lvl {bondLevel})</span>
          </button>
        )}
      </div>
    </div>
  );
};
