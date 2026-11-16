'use client';

import React, { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PetDisplay } from '@/components/pet/PetDisplay';
import { PetSelector } from '@/components/pet/PetSelector';
import { PetStatus } from '@/components/pet/PetStatus';
import { PetEvolution } from '@/components/pet/PetEvolution';
import { ActivitySummary } from '@/components/dashboard/ActivitySummary';
import { ActivityCalendar } from '@/components/dashboard/ActivityCalendar';
import { AchievementsView } from '@/components/dashboard/AchievementsView';
import { SettingsView } from '@/components/dashboard/SettingsView';
import { PixelPanel } from '@/components/ui/PixelPanel';
import { INITIAL_PET_STATE, SPECIES_METADATA } from '@/constants/petData';
import { PetState, SpeciesId } from '@/types/pet';
import {
  executePetAction,
  ActionResult,
} from '@/features/gamification/gameplay';
import {
  type ActionHistoryEntry,
  type ActionType,
  getRewardMultiplier,
} from '@/features/gamification/rewards';
import { getUpdatedMilestones } from '@/features/gamification/progression';

export default function Home() {
  const [pet, setPet] = useState<PetState>(INITIAL_PET_STATE);
  const [actionHistory, setActionHistory] = useState<ActionHistoryEntry[]>([]);
  const [feedback, setFeedback] = useState<{
    message: string;
    type: 'success' | 'warning' | 'level_up';
    rewardText?: string;
  } | null>(null);

  const currentSpeciesMeta = SPECIES_METADATA[pet.species];

  const handleSelectSpecies = (speciesId: SpeciesId) => {
    const meta = SPECIES_METADATA[speciesId];
    setPet((prev) => ({
      ...prev,
      species: speciesId,
      name: `${meta.name}`,
    }));
  };

  const handleUpdateName = (newName: string) => {
    setPet((prev) => ({
      ...prev,
      name: newName,
    }));
  };

  const handleResetPet = () => {
    setPet(INITIAL_PET_STATE);
    setActionHistory([]);
    setFeedback(null);
  };

  const handleAction = (action: ActionType) => {
    const nowMs = Date.now();
    const result: ActionResult = executePetAction({
      pet,
      action,
      history: actionHistory,
      nowMs,
    });

    if (!result.success) {
      setFeedback({
        message: result.rejectedReason || 'Action could not be completed.',
        type: 'warning',
      });
      return;
    }

    setPet(result.updatedPet);
    setActionHistory(result.updatedHistory);

    let rewardText = '';
    if (result.reward) {
      const parts: string[] = [];
      if (result.reward.expGained > 0) parts.push(`+${result.reward.expGained} XP`);
      if (result.reward.happinessGained > 0) parts.push(`+${result.reward.happinessGained} Joy`);
      if (result.reward.hungerGained > 0) parts.push(`+${result.reward.hungerGained} Sat`);
      if (result.reward.energyCost > 0) parts.push(`-${result.reward.energyCost}⚡`);
      if (action === 'rest') parts.push('+25⚡');
      rewardText = `${parts.join(' ')} (${result.reward.percentageDisplay}%)`;
    }

    setFeedback({
      message: result.didLevelUp
        ? `⭐ Level Up! ${result.updatedPet.name} reached Level ${result.updatedPet.level}!`
        : `${result.reaction}`,
      type: result.didLevelUp ? 'level_up' : 'success',
      rewardText,
    });
  };

  // Last action timestamp determines diminishing multiplier state
  const lastActionTimestamp = actionHistory.length > 0
    ? actionHistory[actionHistory.length - 1].timestamp
    : 0;
  const nextPetMultiplier = getRewardMultiplier(actionHistory, 'pet', lastActionTimestamp || 0);

  // Dynamic evolution milestones based on current pet level
  const dynamicMilestones = getUpdatedMilestones(pet.level).map((m) => ({
    stage: m.stage,
    title: m.title,
    requiredLevel: m.requiredLevel,
    description: m.description,
    unlocked: m.unlocked,
    perks: [
      m.stage === 1 ? 'Summoned Base Sprite' : '',
      m.stage === 2 ? 'Glowing pixel aura' : '',
      m.stage === 3 ? 'Aura flare & audio resonances' : '',
      m.stage === 4 ? 'Celestial crown & max stats' : '',
    ].filter(Boolean),
  }));

  return (
    <AppShell>
      {({ currentTab, account, setAccount }) => (
        <>
          {/* Action Feedback Banner */}
          {feedback && (
            <div
              className={`mb-4 p-3 rounded-lg border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 transition-all ${
                feedback.type === 'level_up'
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  : feedback.type === 'warning'
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
                  : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/30 border border-current">
                  {feedback.type === 'level_up'
                    ? 'Level Up'
                    : feedback.type === 'warning'
                    ? 'Notice'
                    : 'Interaction'}
                </span>
                <span className="font-medium">{feedback.message}</span>
              </div>
              {feedback.rewardText && (
                <div className="text-[11px] font-semibold text-slate-300 font-mono self-end sm:self-auto">
                  {feedback.rewardText}
                </div>
              )}
            </div>
          )}

          {/* TAB 1: OVERVIEW */}
          {currentTab === 'overview' && (
            <div className="space-y-6 min-w-0 max-w-full w-full">
              {/* Pet Stage & Core Attributes (2-column layout) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start min-w-0 max-w-full w-full">
                {/* Left: Pet Arena & Species Switcher */}
                <div className="lg:col-span-5 space-y-4 min-w-0 max-w-full w-full">
                  <PixelPanel
                    title="Virtual Companion"
                    subtitle="Interactive Arena"
                    badge="Active"
                    badgeColor="green"
                  >
                    <PetDisplay
                      pet={pet}
                      speciesMeta={currentSpeciesMeta}
                      onExecuteAction={handleAction}
                      rewardMultiplierText={`Next Pet: ${nextPetMultiplier.percentageDisplay}% reward`}
                    />
                  </PixelPanel>

                  <PixelPanel
                    title="Choose Companion"
                    subtitle="Select Species"
                    badge="4 Species"
                    badgeColor="slate"
                  >
                    <PetSelector
                      selectedSpecies={pet.species}
                      onSelectSpecies={handleSelectSpecies}
                    />
                  </PixelPanel>
                </div>

                {/* Right: Companion Telemetry & Evolution Track */}
                <div className="lg:col-span-7 space-y-4 min-w-0 max-w-full w-full">
                  <PixelPanel
                    title="Companion Vitals & Status"
                    subtitle="Progression Telemetry"
                    badge="Simulated"
                    badgeColor="slate"
                  >
                    <PetStatus
                      pet={pet}
                      speciesMeta={currentSpeciesMeta}
                      onUpdateName={handleUpdateName}
                    />
                  </PixelPanel>

                  <PixelPanel
                    title="Evolution Roadmap"
                    subtitle="Unlock Milestones"
                    badge="Progression"
                    badgeColor="slate"
                  >
                    <PetEvolution
                      currentLevel={pet.level}
                      milestones={dynamicMilestones}
                    />
                  </PixelPanel>
                </div>
              </div>

              {/* GitHub Activity Metrics Summary */}
              <PixelPanel
                title="Activity Overview"
                subtitle="GitHub Streak Telemetry"
                badge="Simulated"
                badgeColor="slate"
              >
                <ActivitySummary />
              </PixelPanel>

              {/* Contribution Calendar Heatmap */}
              <PixelPanel
                title="Contribution Matrix"
                subtitle="6-Month History"
                badge="Simulated"
                badgeColor="slate"
              >
                <ActivityCalendar />
              </PixelPanel>
            </div>
          )}

          {/* TAB 2: MY PETS */}
          {currentTab === 'pets' && (
            <div className="space-y-6">
              <PixelPanel
                title="Companion Catalog"
                subtitle="Adopt and customize your coding partner"
                badge="4 Species"
                badgeColor="slate"
              >
                <div className="space-y-6">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Choose and nurture your primary GitHub coding companion. Each species resonates with distinct developer habits and evolves unique visual forms as your commit streaks grow.
                  </p>

                  <PetSelector
                    selectedSpecies={pet.species}
                    onSelectSpecies={handleSelectSpecies}
                  />

                  {/* Deep dive card on selected species */}
                  <div className="p-5 bg-[#0c0e12] border border-[#222733] rounded-lg grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                    <div className="flex flex-col items-center justify-center p-4 bg-[#12151b] border border-[#222733] rounded-lg">
                      <PetDisplay
                        pet={pet}
                        speciesMeta={currentSpeciesMeta}
                        onExecuteAction={handleAction}
                        rewardMultiplierText={`Next Pet: ${nextPetMultiplier.percentageDisplay}% reward`}
                      />
                    </div>

                    <div className="md:col-span-2 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-slate-100">
                          {currentSpeciesMeta.name}
                        </span>
                        <span className="text-xs text-slate-400">
                          ({currentSpeciesMeta.title})
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed">
                        {currentSpeciesMeta.description}
                      </p>

                      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#222733] text-xs">
                        <div>
                          <span className="text-slate-500 font-medium block text-[11px]">
                            Affinity
                          </span>
                          <span className="text-slate-200">{currentSpeciesMeta.element}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 font-medium block text-[11px]">
                            Rarity Grade
                          </span>
                          <span className="text-slate-200">{currentSpeciesMeta.rarity}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 font-medium block text-[11px]">
                            Favored Workflow
                          </span>
                          <span className="text-slate-200">{currentSpeciesMeta.favoredActivity}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 font-medium block text-[11px]">
                            Temperament
                          </span>
                          <span className="text-slate-200">{currentSpeciesMeta.personality}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </PixelPanel>
            </div>
          )}

          {/* TAB 3: ACTIVITY */}
          {currentTab === 'activity' && (
            <div className="space-y-6">
              <PixelPanel
                title="Activity Dashboard"
                subtitle="Streak & Contribution Tracking"
                badge="Simulated"
                badgeColor="slate"
              >
                <ActivitySummary />
              </PixelPanel>

              <PixelPanel
                title="Contribution Matrix"
                subtitle="Calendar History"
                badge="Simulated"
                badgeColor="slate"
              >
                <ActivityCalendar />
              </PixelPanel>
            </div>
          )}

          {/* TAB 4: ACHIEVEMENTS */}
          {currentTab === 'achievements' && (
            <div className="space-y-6">
              <PixelPanel
                title="Achievements & Feats"
                subtitle="Progression milestones unlocked by coding activity"
                badge="Demo"
                badgeColor="slate"
              >
                <AchievementsView />
              </PixelPanel>
            </div>
          )}

          {/* TAB 5: SETTINGS */}
          {currentTab === 'settings' && (
            <div className="space-y-6">
              <PixelPanel
                title="Settings & Integrations"
                subtitle="Platform preferences and profile distribution"
                badge="Configuration"
                badgeColor="slate"
              >
                <SettingsView
                  onResetPet={handleResetPet}
                  account={account}
                  onToggleConnection={() => {
                    setAccount((prev) => {
                      if (prev.status !== 'disconnected') {
                        return { status: 'disconnected' };
                      }
                      return {
                        status: 'demo',
                        profile: {
                          username: 'octocat-trainer',
                          displayName: 'The Octocat Trainer',
                          profileUrl: 'https://github.com/octocat',
                        },
                        lastSyncedAt: new Date().toISOString(),
                      };
                    });
                  }}
                />
              </PixelPanel>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
