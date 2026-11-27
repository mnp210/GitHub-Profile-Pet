'use client';

import React from 'react';
import { SpeciesId, PetSpeciesMeta } from '@/types/pet';
import { PetSprite } from './PetSprite';
import { SPECIES_METADATA } from '@/constants/petData';

interface PetSelectorProps {
  selectedSpecies: SpeciesId;
  onSelectSpecies: (species: SpeciesId) => void;
}

export const PetSelector: React.FC<PetSelectorProps> = ({
  selectedSpecies,
  onSelectSpecies,
}) => {
  const speciesList: PetSpeciesMeta[] = Object.values(SPECIES_METADATA);

  return (
    <div className="w-full max-w-full min-w-0">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {speciesList.map((species) => {
          const isSelected = selectedSpecies === species.id;

          return (
            <button
              key={species.id}
              type="button"
              aria-pressed={isSelected}
              aria-label={`Select ${species.name} (${species.title}), ${species.element}`}
              onClick={() => onSelectSpecies(species.id)}
              className={`relative p-3 flex flex-col items-center justify-between text-left rounded-lg transition-all cursor-pointer min-w-0 ${
                isSelected
                  ? 'bg-[var(--pet-surface-elevated)] border border-[var(--pet-border-accent)] shadow-xs'
                  : 'pet-themed-surface hover:bg-[var(--pet-surface-elevated)] hover:border-[var(--pet-border-accent)]'
              }`}
            >
              {/* Selected Indicator */}
              {isSelected && (
                <div className="absolute top-2 right-2 px-1.5 py-0.2 pet-themed-primary-btn text-[9px] font-semibold rounded uppercase tracking-wider" aria-hidden="true">
                  Active
                </div>
              )}

              {/* Mini Sprite Preview */}
              <div className="h-16 w-16 sm:h-18 sm:w-18 flex items-center justify-center my-1">
                <PetSprite species={species.id} size={54} showShadow={false} />
              </div>

              {/* Name & Subtitle */}
              <div className="w-full text-center mt-1 min-w-0">
                <div className="font-medium text-xs text-slate-100 truncate">
                  {species.name}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {species.title}
                </div>
                <div className={`mt-0.5 text-[10px] font-medium truncate ${isSelected ? 'pet-themed-accent-text' : 'text-slate-400'}`}>
                  {species.element}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
