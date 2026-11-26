'use client';

import React, { useState } from 'react';
import type {
  ProgressionState,
  CosmeticId,
  CosmeticCategory,
  CosmeticMetadata,
} from '@/features/progression/types';
import {
  RARITY_COLORS,
  getCosmeticsByCategory,
} from '@/features/progression/cosmeticsCatalog';
import { equipCosmetic, unequipCosmetic, resetCosmeticsToDefault } from '@/features/progression/engine';
import { PetSprite } from '@/components/pet/PetSprite';
import { CosmeticAccessoryOverlay } from './CosmeticAccessoryOverlay';
import { CosmeticEffectLayer } from './CosmeticEffectLayer';
import { EnvironmentBackground } from './EnvironmentBackground';
import { CompanionDecorationOverlay } from './CompanionDecorationOverlay';
import type { PetState, PetSpeciesMeta } from '@/types/pet';
import { retroAudio } from '@/lib/audio/retroAudio';

interface WardrobeViewProps {
  pet: PetState;
  speciesMeta: PetSpeciesMeta;
  progression: ProgressionState;
  onUpdateProgression: (next: ProgressionState) => void;
}

export const WardrobeView: React.FC<WardrobeViewProps> = ({
  pet,
  speciesMeta,
  progression,
  onUpdateProgression,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<CosmeticCategory>('accessory');
  // Temporary preview overrides active equipped item until equipped or dismissed
  const [previewCosmetic, setPreviewCosmetic] = useState<CosmeticMetadata | null>(null);

  // Compute active preview equipped state
  const effectiveEquipped = {
    ...progression.equipped,
    ...(previewCosmetic ? { [previewCosmetic.category]: previewCosmetic.id } : {}),
  };

  const currentCategoryItems = getCosmeticsByCategory(selectedCategory);

  const handleSelectCosmetic = (item: CosmeticMetadata) => {
    retroAudio.playClick();
    setPreviewCosmetic(item);
  };

  const handleEquip = (cosmeticId: CosmeticId) => {
    retroAudio.playClick();
    const res = equipCosmetic(progression, cosmeticId);
    if (!res.error) {
      onUpdateProgression(res.nextState);
      setPreviewCosmetic(null);
    }
  };

  const handleUnequip = (category: CosmeticCategory) => {
    retroAudio.playClick();
    const next = unequipCosmetic(progression, category);
    onUpdateProgression(next);
    if (previewCosmetic?.category === category) {
      setPreviewCosmetic(null);
    }
  };

  const handleReset = () => {
    retroAudio.playClick();
    const next = resetCosmeticsToDefault(progression);
    onUpdateProgression(next);
    setPreviewCosmetic(null);
  };

  const isItemEquipped = (id: CosmeticId, cat: CosmeticCategory) => {
    return progression.equipped[cat] === id;
  };

  const isItemOwned = (id: CosmeticId) => {
    return progression.inventory.includes(id);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full font-mono text-slate-100">
      {/* ── LEFT: COMPANION LIVE PREVIEW ARENA ─────────────────────────────────── */}
      <div className="flex flex-col items-center w-full lg:w-80 shrink-0">
        <div className="relative w-full aspect-square max-w-[320px] rounded-2xl border-2 border-[#3b3267] p-4 flex flex-col items-center justify-between overflow-hidden shadow-2xl">
          {/* Environment backdrop */}
          <EnvironmentBackground environmentId={effectiveEquipped.environment} />

          {/* Top Preview Status */}
          <div className="relative z-10 w-full flex items-center justify-between text-[10px] font-bold">
            <span className="px-2 py-0.5 rounded bg-black/60 border border-slate-700 text-purple-300">
              {pet.name} · {speciesMeta.name}
            </span>
            <span className="px-2 py-0.5 rounded bg-black/60 border border-slate-700 text-amber-300 capitalize">
              {pet.personality || 'curious'}
            </span>
          </div>

          {/* Centered Pet Sprite with Overlay Layers */}
          <div className="relative z-10 my-auto flex items-center justify-center">
            {/* Visual Effect Layer */}
            <CosmeticEffectLayer effectId={effectiveEquipped.effect} />

            {/* Base Pet Sprite */}
            <PetSprite
              species={pet.species}
              personality={pet.personality}
              size={160}
              evolutionStage={pet.evolutionStage}
            />

            {/* Accessory Layer Overlaid directly on Sprite */}
            <CosmeticAccessoryOverlay
              accessoryId={effectiveEquipped.accessory}
              species={pet.species}
              size={160}
            />
          </div>

          {/* Companion Decoration Layer */}
          <CompanionDecorationOverlay decorationId={effectiveEquipped.decoration} />

          {/* Bottom Podium */}
          <div className="relative z-10 w-full flex flex-col items-center">
            <div className="w-40 h-2 bg-gradient-to-r from-transparent via-[#4c3e88] to-transparent rounded-full border-t border-purple-400/40" />
            <div className="text-[10px] text-purple-300/80 mt-1">
              {previewCosmetic ? (
                <span className="text-cyan-300 font-bold animate-pulse">
                  Previewing: {previewCosmetic.name}
                </span>
              ) : (
                <span>Current Appearance</span>
              )}
            </div>
          </div>
        </div>

        {/* Preview Actions / Reset */}
        <div className="w-full max-w-[320px] mt-3 flex items-center gap-2">
          {previewCosmetic && isItemOwned(previewCosmetic.id) && !isItemEquipped(previewCosmetic.id, previewCosmetic.category) && (
            <button
              onClick={() => handleEquip(previewCosmetic.id)}
              className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-95"
            >
              Equip Item
            </button>
          )}

          {previewCosmetic && isItemEquipped(previewCosmetic.id, previewCosmetic.category) && (
            <button
              onClick={() => handleUnequip(previewCosmetic.category)}
              className="flex-1 py-2 px-3 rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-200 font-bold text-xs uppercase tracking-wider transition-all active:scale-95"
            >
              Unequip
            </button>
          )}

          {previewCosmetic && (
            <button
              onClick={() => setPreviewCosmetic(null)}
              className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all"
              title="Clear Preview"
            >
              Clear
            </button>
          )}

          <button
            onClick={handleReset}
            className="py-2 px-3 rounded-lg bg-[#181628] hover:bg-[#25223d] border border-slate-700 text-slate-400 hover:text-slate-200 text-xs font-bold transition-all ml-auto"
            title="Reset all cosmetics to default"
          >
            Reset Default
          </button>
        </div>
      </div>

      {/* ── RIGHT: CATEGORY NAVIGATION & ITEM GRID ───────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Category Tab Bar */}
        <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2 mb-4 overflow-x-auto">
          {(['accessory', 'effect', 'environment', 'decoration'] as CosmeticCategory[]).map((cat) => {
            const count = getCosmeticsByCategory(cat).length;
            const isSelected = selectedCategory === cat;
            const labels: Record<CosmeticCategory, string> = {
              accessory: 'Accessories',
              effect: 'Effects',
              environment: 'Environments',
              decoration: 'Decorations',
            };
            return (
              <button
                key={cat}
                onClick={() => {
                  retroAudio.playClick();
                  setSelectedCategory(cat);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-purple-900/60 text-purple-200 border border-purple-500 shadow-sm'
                    : 'bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                <span>{labels[cat]}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Item Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[480px] overflow-y-auto pr-1">
          {currentCategoryItems.map((item) => {
            const owned = isItemOwned(item.id);
            const equipped = isItemEquipped(item.id, item.category);
            const isPreviewing = previewCosmetic?.id === item.id;
            const rarity = RARITY_COLORS[item.rarity] || RARITY_COLORS.common;

            return (
              <div
                key={item.id}
                onClick={() => handleSelectCosmetic(item)}
                className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                  equipped
                    ? 'bg-[#181a33] border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                    : isPreviewing
                    ? 'bg-[#1e1b38] border-purple-400'
                    : owned
                    ? 'bg-[#0f1424] border-slate-700/80 hover:border-purple-400/60'
                    : 'bg-[#0b0e17] border-slate-800/80 opacity-70 hover:opacity-90'
                }`}
              >
                <div>
                  {/* Card Header: Icon, Name & Rarity */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl p-1.5 rounded-lg bg-black/40 border border-slate-800">
                        {item.icon}
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                          {item.name}
                          {equipped && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500 uppercase">
                              Active
                            </span>
                          )}
                        </h4>
                        <span
                          className={`inline-block px-1.5 py-0.2 text-[9px] font-bold uppercase rounded border ${rarity.bg} ${rarity.text} ${rarity.border}`}
                        >
                          {item.rarity}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Description */}
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-2">
                    {item.description}
                  </p>
                </div>

                {/* Card Footer: Unlock Requirement or Equip Trigger */}
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  {owned ? (
                    <div className="flex items-center gap-2 w-full justify-between">
                      <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                        ✓ In Wardrobe
                      </span>
                      {equipped ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnequip(item.category);
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                        >
                          Unequip
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEquip(item.id);
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
                        >
                          Equip
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="w-full text-[10px] text-slate-500">
                      <span className="font-bold text-slate-400">Unlock: </span>
                      <span>{item.unlockRequirement}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
