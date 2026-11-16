'use client';

import React, { useState } from 'react';
import { PetState, PetSpeciesMeta } from '@/types/pet';
import { PetSprite } from './PetSprite';
import { PixelButton } from '@/components/ui/PixelButton';
import { HeartIcon, BoltIcon, ActivityIcon, MoonIcon } from '@/components/ui/PixelIcons';
import type { ActionType } from '@/features/gamification/rewards';

interface PetDisplayProps {
  pet: PetState;
  speciesMeta: PetSpeciesMeta;
  onExecuteAction?: (action: ActionType) => void;
  rewardMultiplierText?: string;
}

export const PetDisplay: React.FC<PetDisplayProps> = ({
  pet,
  speciesMeta,
  onExecuteAction,
  rewardMultiplierText,
}) => {
  const [clickEffect, setClickEffect] = useState<{ id: number; x: number; y: number; text: string; colorClass?: string }[]>([]);

  const triggerVisualEffect = (x: number, y: number, text: string, colorClass = 'text-slate-200') => {
    const newEffect = { id: Date.now() + Math.random(), x, y, text, colorClass };
    setClickEffect((prev) => [...prev.slice(-3), newEffect]);

    setTimeout(() => {
      setClickEffect((prev) => prev.filter((item) => item.id !== newEffect.id));
    }, 1200);
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    triggerVisualEffect(x, y, 'Purr~', 'text-pink-300');
    if (onExecuteAction) {
      onExecuteAction('pet');
    }
  };

  const getMoodColor = () => {
    switch (pet.mood) {
      case 'Energetic':
        return 'text-amber-400 bg-amber-950/40 border-amber-800/40';
      case 'Resting':
        return 'text-indigo-300 bg-indigo-950/40 border-indigo-800/40';
      case 'Curious':
        return 'text-cyan-300 bg-cyan-950/40 border-cyan-800/40';
      default:
        return 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40';
    }
  };

  return (
    <div className="relative flex flex-col items-center w-full">
      {/* Interactive Arena Stage */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Interactive pet arena stage. Press Enter or Space to pet your companion."
        onClick={handleStageClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            triggerVisualEffect(140, 140, 'Purr~', 'text-pink-300');
            if (onExecuteAction) {
              onExecuteAction('pet');
            }
          }
        }}
        className="relative w-full aspect-4/3 max-h-[300px] bg-[#0c0e12] border border-[#222733] rounded-lg p-4 flex flex-col items-center justify-between select-none cursor-pointer overflow-hidden group focus-visible:border-indigo-500"
        title="Click or press Enter to interact with your pet"
      >
        {/* Subtle background radial gradient */}
        <div className="absolute inset-0 bg-radial from-transparent via-transparent to-black/40 pointer-events-none" />

        {/* Top Habitat Header */}
        <div className="relative z-10 w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-[#181c24] text-slate-300 border border-[#2d3342]">
              {speciesMeta.element}
            </span>
            <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-[#181c24] text-slate-400 border border-[#222733]">
              {speciesMeta.rarity}
            </span>
          </div>

          <div className={`px-2 py-0.5 text-[10px] font-medium rounded border ${getMoodColor()}`}>
            Mood: {pet.mood}
          </div>
        </div>

        {/* Floating Interaction Text Particles */}
        {clickEffect.map((effect) => (
          <div
            key={effect.id}
            style={{ left: effect.x, top: effect.y }}
            className={`absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-1/2 font-medium text-xs ${effect.colorClass} drop-shadow-md animate-bounce`}
          >
            {effect.text}
          </div>
        ))}

        {/* Centered Pet Sprite */}
        <div className={`relative z-10 my-auto flex flex-col items-center justify-center transition-transform group-hover:scale-102 ${pet.mood === 'Resting' ? 'opacity-80' : ''}`}>
          <PetSprite species={pet.species} size={160} />
        </div>

        {/* Stage Pedestal Platform */}
        <div className="relative z-10 w-full flex flex-col items-center">
          <div className="w-36 md:w-48 h-1.5 bg-[#181c24] rounded-full border border-[#222733]" />
          <div className="text-[10px] text-slate-500 mt-1.5 flex items-center justify-between w-full px-1">
            <span>Click stage to pet</span>
            {rewardMultiplierText && (
              <span className="text-slate-400 font-medium">{rewardMultiplierText}</span>
            )}
          </div>
        </div>
      </div>

      {/* Quick Action Interaction Bar with 4 Actions: Pet, Train, Feed, Rest */}
      <div className="w-full mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <PixelButton
          size="sm"
          variant="secondary"
          onClick={() => {
            triggerVisualEffect(80, 140, 'Petting...', 'text-pink-300');
            onExecuteAction?.('pet');
          }}
          icon={<HeartIcon size={13} aria-hidden={true} />}
          aria-label="Pet companion (Happiness and XP)"
        >
          Pet
        </PixelButton>

        <PixelButton
          size="sm"
          variant="secondary"
          disabled={pet.energy < 18}
          onClick={() => {
            triggerVisualEffect(140, 100, 'Training!', 'text-amber-300');
            onExecuteAction?.('train');
          }}
          icon={<BoltIcon size={13} aria-hidden={true} />}
          aria-label="Train companion (Requires 18 Energy)"
        >
          Train (-18⚡)
        </PixelButton>

        <PixelButton
          size="sm"
          variant="secondary"
          disabled={pet.hunger >= 100}
          onClick={() => {
            triggerVisualEffect(200, 140, 'Feeding...', 'text-cyan-300');
            onExecuteAction?.('feed');
          }}
          icon={<ActivityIcon size={13} aria-hidden={true} />}
          aria-label="Feed commit (Satiety and XP)"
        >
          Feed
        </PixelButton>

        <PixelButton
          size="sm"
          variant="secondary"
          onClick={() => {
            triggerVisualEffect(150, 160, 'Resting...', 'text-indigo-300');
            onExecuteAction?.('rest');
          }}
          icon={<MoonIcon size={13} aria-hidden={true} />}
          aria-label="Rest companion (+25 Energy, 0 XP)"
        >
          Rest (+25⚡)
        </PixelButton>
      </div>
    </div>
  );
};
