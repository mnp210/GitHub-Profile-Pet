'use client';

import React, { useState } from 'react';
import { PetState, PetSpeciesMeta } from '@/types/pet';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EditIcon, CheckIcon, CloseIcon, PawIcon, HeartIcon, BoltIcon } from '@/components/ui/PixelIcons';

interface PetStatusProps {
  pet: PetState;
  speciesMeta: PetSpeciesMeta;
  onUpdateName: (newName: string) => void;
  streakMultiplier?: number;
}

export const PetStatus: React.FC<PetStatusProps> = ({
  pet,
  speciesMeta,
  onUpdateName,
  streakMultiplier = 1.25,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(pet.name);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (draftName.trim()) {
      onUpdateName(draftName.trim());
      setIsEditingName(false);
    }
  };

  const handleCancelName = () => {
    setDraftName(pet.name);
    setIsEditingName(false);
  };

  return (
    <div className="space-y-4">
      {/* Pet Header & Editable Name */}
      <div className="p-3.5 bg-[#12151b] border border-[#222733] rounded-lg">
        {isEditingName ? (
          <form onSubmit={handleSaveName} className="flex items-center gap-2 mt-1">
            <label htmlFor="pet-name-input" className="sr-only">
              Edit Pet Name
            </label>
            <input
              id="pet-name-input"
              type="text"
              aria-label="Pet Name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={20}
              className="px-2.5 py-1 bg-[#181c24] border border-indigo-500 rounded text-sm font-medium text-slate-100 w-full focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              className="p-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-white cursor-pointer"
              title="Save Name"
              aria-label="Save new pet name"
            >
              <CheckIcon size={14} aria-hidden={true} />
            </button>
            <button
              type="button"
              onClick={handleCancelName}
              className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded text-white cursor-pointer"
              title="Cancel"
              aria-label="Cancel pet renaming"
            >
              <CloseIcon size={14} aria-hidden={true} />
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-slate-100">
                {pet.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setDraftName(pet.name);
                  setIsEditingName(true);
                }}
                className="text-slate-500 hover:text-slate-300 transition-colors p-0.5 cursor-pointer rounded"
                title="Rename Pet"
                aria-label={`Rename ${pet.name}`}
              >
                <EditIcon size={12} aria-hidden={true} />
              </button>
            </div>
            <span className="px-2 py-0.5 bg-[#181c24] text-indigo-400 border border-[#2d3342] rounded text-xs font-medium font-mono">
              Level {pet.level}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 mt-2.5 border-t border-[#222733] pt-2.5">
          <div>
            <span className="text-slate-500">Species: </span>
            <span className="text-slate-200 font-medium">{speciesMeta.name}</span>
          </div>
          <div>
            <span className="text-slate-500">Class: </span>
            <span className="text-slate-200 font-medium">{speciesMeta.title}</span>
          </div>
          <div>
            <span className="text-slate-500">Stage: </span>
            <span className="text-slate-200 font-medium">{pet.evolutionStage}</span>
          </div>
        </div>
      </div>

      {/* Experience Progression Bar */}
      <div className="p-3.5 bg-[#12151b] border border-[#222733] rounded-lg">
        <ProgressBar
          label="Experience (XP)"
          value={pet.xp}
          max={pet.maxExp}
          variant="indigo"
          size="md"
        />
        <div className="text-[11px] text-slate-500 mt-1.5 flex justify-between">
          <span>{pet.maxExp - pet.xp} XP to next level</span>
          <span className="text-slate-400">Streak bonus: {streakMultiplier}x</span>
        </div>
      </div>

      {/* Vital Attributes Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Happiness */}
        <div className="p-3 bg-[#12151b] border border-[#222733] rounded-lg">
          <div className="flex items-center justify-between mb-1.5 text-xs text-rose-400 font-medium">
            <span className="flex items-center gap-1.5">
              <HeartIcon size={13} />
              <span>Happiness</span>
            </span>
            {pet.happiness <= 20 && (
              <span className="text-[10px] text-rose-400 font-medium">Low</span>
            )}
          </div>
          <ProgressBar
            value={pet.happiness}
            max={100}
            variant="green"
            size="sm"
            showPercentage={false}
          />
          <div className="text-[10px] text-right text-slate-500 mt-1 font-mono">{pet.happiness}/100</div>
        </div>

        {/* Energy */}
        <div className="p-3 bg-[#12151b] border border-[#222733] rounded-lg">
          <div className="flex items-center justify-between mb-1.5 text-xs text-amber-400 font-medium">
            <span className="flex items-center gap-1.5">
              <BoltIcon size={13} />
              <span>Energy</span>
            </span>
            {pet.energy < 18 ? (
              <span className="text-[10px] text-amber-400 font-medium">Tired</span>
            ) : null}
          </div>
          <ProgressBar
            value={pet.energy}
            max={100}
            variant="amber"
            size="sm"
            showPercentage={false}
          />
          <div className="text-[10px] text-right text-slate-500 mt-1 font-mono">{pet.energy}/100</div>
        </div>

        {/* Hunger / Satiety */}
        <div className="p-3 bg-[#12151b] border border-[#222733] rounded-lg">
          <div className="flex items-center justify-between mb-1.5 text-xs text-cyan-400 font-medium">
            <span className="flex items-center gap-1.5">
              <PawIcon size={13} />
              <span>Satiety</span>
            </span>
            {pet.hunger >= 100 ? (
              <span className="text-[10px] text-emerald-400 font-medium">Full</span>
            ) : pet.hunger <= 25 ? (
              <span className="text-[10px] text-amber-400 font-medium">Hungry</span>
            ) : null}
          </div>
          <ProgressBar
            value={pet.hunger}
            max={100}
            variant="cyan"
            size="sm"
            showPercentage={false}
          />
          <div className="text-[10px] text-right text-slate-500 mt-1 font-mono">{pet.hunger}/100</div>
        </div>
      </div>
    </div>
  );
};
