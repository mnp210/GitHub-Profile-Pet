'use client';

import React, { useState, useEffect, useRef } from 'react';
import { PetDisplay } from '@/components/pet/PetDisplay';
import { PetSelector } from '@/components/pet/PetSelector';
import { PetStatus } from '@/components/pet/PetStatus';
import { PetEvolution } from '@/components/pet/PetEvolution';
import { INITIAL_PET_STATE, SPECIES_METADATA } from '@/constants/petData';
import { PetState, SpeciesId } from '@/types/pet';
import { executePetAction, ActionResult } from '@/features/gamification/gameplay';
import { type ActionHistoryEntry, type ActionType, ACTION_COOLDOWN_MS } from '@/features/gamification/rewards';
import { getUpdatedMilestones } from '@/features/gamification/progression';
import { retroAudio } from '@/lib/audio/retroAudio';
import {
  loadLocalPetState,
  loadLocalActionHistory,
  saveLocalGameState,
  loadRepoConfig,
  saveRepoConfig,
  fetchRemotePetState,
  dispatchGitHubActionIssue,
  exportSaveData,
  importSaveData,
  ConnectedRepoConfig,
} from '@/lib/storage/gameStateStorage';

export default function Home() {
  const [pet, setPet] = useState<PetState>(INITIAL_PET_STATE);
  const [actionHistory, setActionHistory] = useState<ActionHistoryEntry[]>([]);
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState<number>(0);
  const [lastReaction, setLastReaction] = useState<string>('');
  const [feedback, setFeedback] = useState<{
    message: string;
    type: 'success' | 'warning' | 'level_up' | 'info';
    rewardText?: string;
  } | null>(null);

  // Audio mute state
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // GitHub Sync & Modal state
  const [repoConfig, setRepoConfig] = useState<ConnectedRepoConfig>({ repo: '', syncToActions: false });
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [isCodexModalOpen, setIsCodexModalOpen] = useState<boolean>(false);
  const [isActionsSyncing, setIsActionsSyncing] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');

  // Draft inputs for sync modal
  const [draftRepo, setDraftRepo] = useState<string>('');
  const [draftToken, setDraftToken] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Initial Load: Read from persistent storage on client mount
  useEffect(() => {
    const loadedPet = loadLocalPetState();
    const loadedHistory = loadLocalActionHistory();
    const loadedConfig = loadRepoConfig();

    setPet(loadedPet);
    setActionHistory(loadedHistory);
    setRepoConfig(loadedConfig);
    setDraftRepo(loadedConfig.repo || '');
    setDraftToken(loadedConfig.token || '');
    setIsMuted(retroAudio.getMuted());

    // Auto-fetch latest state from repository if connected
    if (loadedConfig.repo) {
      setSyncStatusMsg('Fetching latest state from GitHub...');
      fetchRemotePetState(loadedConfig.repo, loadedConfig.token).then((res) => {
        if (res.success && res.pet) {
          setPet(res.pet);
          saveLocalGameState(res.pet, loadedHistory);
          setSyncStatusMsg(`Synchronized with ${loadedConfig.repo}`);
        } else {
          setSyncStatusMsg(res.error || 'Using local adventure save.');
        }
      });
    }
  }, []);

  // 2. Cooldown timer countdown interval
  useEffect(() => {
    const interval = setInterval(() => {
      const lastEntry = actionHistory.length > 0 ? actionHistory[actionHistory.length - 1] : null;
      if (!lastEntry) {
        setCooldownRemainingSec(0);
        return;
      }

      const elapsed = Date.now() - lastEntry.timestamp;
      const remainingMs = Math.max(0, ACTION_COOLDOWN_MS - elapsed);
      const remainingSec = Math.ceil(remainingMs / 1000);
      setCooldownRemainingSec(remainingSec);
    }, 500);

    return () => clearInterval(interval);
  }, [actionHistory]);

  const currentSpeciesMeta = SPECIES_METADATA[pet.species] || SPECIES_METADATA.cat;

  // Toggle Sound Effects
  const handleToggleSound = () => {
    const muted = retroAudio.toggleMute();
    setIsMuted(muted);
  };

  // Switch Companion Species
  const handleSelectSpecies = (speciesId: SpeciesId) => {
    const meta = SPECIES_METADATA[speciesId];
    retroAudio.playClick();
    const updated = {
      ...pet,
      species: speciesId,
      name: `${meta.name}`,
    };
    setPet(updated);
    saveLocalGameState(updated, actionHistory);
  };

  // Rename Companion
  const handleUpdateName = (newName: string) => {
    const updated = {
      ...pet,
      name: newName,
    };
    setPet(updated);
    saveLocalGameState(updated, actionHistory);
  };

  // Reset Companion
  const handleResetPet = () => {
    if (confirm('Are you sure you want to reset your companion to Level 1?')) {
      setPet(INITIAL_PET_STATE);
      setActionHistory([]);
      setFeedback(null);
      setLastReaction('');
      saveLocalGameState(INITIAL_PET_STATE, []);
      retroAudio.playRest();
    }
  };

  // Core Gameplay Interaction
  const handleAction = (action: ActionType) => {
    const nowMs = Date.now();

    // Call deterministic rules engine
    const result: ActionResult = executePetAction({
      pet,
      action,
      history: actionHistory,
      nowMs,
      cooldownMs: ACTION_COOLDOWN_MS,
    });

    if (!result.success) {
      retroAudio.playError();
      setFeedback({
        message: result.rejectedReason || 'Action could not be completed.',
        type: 'warning',
      });
      return;
    }

    // Update state and save immediately
    setPet(result.updatedPet);
    setActionHistory(result.updatedHistory);
    setLastReaction(result.reaction);
    saveLocalGameState(result.updatedPet, result.updatedHistory);

    let rewardText = '';
    if (result.reward) {
      const parts: string[] = [];
      if (result.reward.expGained > 0) parts.push(`+${result.reward.expGained} XP`);
      if (result.reward.happinessGained > 0) parts.push(`+${result.reward.happinessGained} Joy`);
      if (result.reward.hungerGained > 0) parts.push(`+${result.reward.hungerGained} Sat`);
      if (result.reward.energyCost > 0) parts.push(`-${result.reward.energyCost}⚡`);
      if (action === 'rest') parts.push('+25⚡');
      rewardText = parts.join(' ');
    }

    if (result.didLevelUp) {
      retroAudio.playLevelUp();
      setFeedback({
        message: `⭐ LEVEL UP! ${result.updatedPet.name} reached Level ${result.updatedPet.level}!`,
        type: 'level_up',
        rewardText,
      });
    } else {
      setFeedback({
        message: result.reaction,
        type: 'success',
        rewardText,
      });
    }

    // If connected to GitHub Actions with a token, dispatch action issue in background
    if (repoConfig.repo && repoConfig.token && repoConfig.syncToActions) {
      setIsActionsSyncing(true);
      dispatchGitHubActionIssue(repoConfig.repo, action, repoConfig.token).then((res) => {
        setIsActionsSyncing(false);
        if (res.success) {
          setSyncStatusMsg(`⚡ Care action recorded in GitHub Issue #${res.issueNumber}`);
        } else {
          console.warn('GitHub Action sync notice:', res.error);
        }
      });
    }
  };

  // Save Config in Modal
  const handleSaveSyncConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const config: ConnectedRepoConfig = {
      repo: draftRepo.trim(),
      token: draftToken.trim() || undefined,
      syncToActions: Boolean(draftRepo.trim() && draftToken.trim()),
    };

    saveRepoConfig(config);
    setRepoConfig(config);
    setSyncStatusMsg('Verifying connection...');

    if (config.repo) {
      const res = await fetchRemotePetState(config.repo, config.token);
      if (res.success && res.pet) {
        setPet(res.pet);
        saveLocalGameState(res.pet, actionHistory);
        setSyncStatusMsg(`Connected & synced with ${config.repo}!`);
      } else {
        setSyncStatusMsg(`Connected, but could not load pet.json: ${res.error}`);
      }
    } else {
      setSyncStatusMsg('Switched to Local Adventure Mode.');
    }
    setIsSyncModalOpen(false);
  };

  // Export Save File
  const handleExportSave = () => {
    const dataStr = exportSaveData(pet, actionHistory);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `github-profile-pet-${pet.name.toLowerCase().replace(/\s+/g, '-')}-save.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Import Save File
  const handleImportSave = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = importSaveData(content);
      if (res.success && res.pet) {
        setPet(res.pet);
        if (res.history) setActionHistory(res.history);
        saveLocalGameState(res.pet, res.history || []);
        setFeedback({ message: 'Save file imported successfully!', type: 'info' });
        retroAudio.playPurr();
      } else {
        alert(res.error || 'Failed to import save file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

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
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col items-center antialiased w-full max-w-full overflow-x-hidden selection:bg-purple-600 selection:text-white">
      {/* 1. TOP RETRO GAME NAVIGATION BAR */}
      <header className="sticky top-0 z-40 w-full bg-[#0a0d14]/95 backdrop-blur-md border-b border-[#252240] px-4 py-3 flex items-center justify-between shadow-lg shadow-purple-950/20">
        {/* Left Brand & Active Companion Title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center text-lg shadow-md border border-purple-400/40">
            🐾
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wide text-purple-200">
                GitHub Profile Pet
              </h1>
              <span className="hidden sm:inline-block px-1.5 py-0.2 text-[9px] font-bold rounded bg-purple-950/70 text-purple-300 border border-purple-600/40 uppercase">
                Playable Edition
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              {pet.name} <span className="text-purple-400 font-bold">• Lvl {pet.level} {pet.evolutionStage}</span>
            </p>
          </div>
        </div>

        {/* Right Navigation & Utility Controls */}
        <div className="flex items-center gap-2">
          {/* Audio Mute/Unmute */}
          <button
            onClick={handleToggleSound}
            className={`p-1.5 sm:px-2.5 sm:py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              isMuted
                ? 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                : 'bg-purple-950/60 border-purple-700/50 text-purple-200 hover:bg-purple-900/60'
            }`}
            title={isMuted ? 'Sound is Muted (Click to Unmute)' : 'Sound is Active (Click to Mute)'}
          >
            <span>{isMuted ? '🔇' : '🔊'}</span>
            <span className="hidden md:inline">{isMuted ? 'Muted' : 'Sound ON'}</span>
          </button>

          {/* Evolution Codex */}
          <button
            onClick={() => setIsCodexModalOpen(true)}
            className="px-2.5 py-1 rounded-lg border border-[#3b3464] bg-[#161328] hover:bg-[#231f3f] text-purple-200 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            title="Evolution Milestones & Stage Codex"
          >
            <span>📜</span>
            <span className="hidden sm:inline">Codex</span>
          </button>

          {/* GitHub Sync Button */}
          <button
            onClick={() => setIsSyncModalOpen(true)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              repoConfig.repo
                ? 'bg-indigo-950/80 border-indigo-500/60 text-indigo-200 hover:bg-indigo-900/80'
                : 'bg-[#181a24] border-slate-700 text-slate-300 hover:bg-[#242735]'
            }`}
            title="GitHub Repository Sync Settings"
          >
            <span>⚡</span>
            <span className="hidden sm:inline font-mono">
              {repoConfig.repo ? repoConfig.repo.split('/')[1] || 'Sync' : 'Connect Repo'}
            </span>
          </button>
        </div>
      </header>

      {/* 2. MAIN GAME CONTAINER */}
      <main className="flex-1 w-full max-w-[1140px] px-3 sm:px-6 py-4 sm:py-6 space-y-5">
        {/* ACTION FEEDBACK NOTIFICATION BANNER */}
        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 transition-all animate-fade-in shadow-md ${
              feedback.type === 'level_up'
                ? 'bg-gradient-to-r from-amber-950/90 to-purple-950/90 border-amber-500 text-amber-200 shadow-amber-500/10'
                : feedback.type === 'warning'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : feedback.type === 'info'
                ? 'bg-cyan-950/80 border-cyan-700 text-cyan-200'
                : 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-bold text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/40 border border-current">
                {feedback.type === 'level_up'
                  ? '⭐ Level Up'
                  : feedback.type === 'warning'
                  ? 'Notice'
                  : 'Interaction'}
              </span>
              <span className="font-medium">{feedback.message}</span>
            </div>
            {feedback.rewardText && (
              <span className="text-[11px] font-bold text-amber-300 font-mono self-end sm:self-auto bg-black/30 px-2 py-0.5 rounded">
                {feedback.rewardText}
              </span>
            )}
          </div>
        )}

        {/* PRIMARY 2-COLUMN GAME LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT: THE INTERACTIVE PET ARENA (DOMINANT VIEW) */}
          <div className="lg:col-span-7 space-y-4">
            <PetDisplay
              pet={pet}
              speciesMeta={currentSpeciesMeta}
              onExecuteAction={handleAction}
              cooldownRemainingSeconds={cooldownRemainingSec}
              lastReaction={lastReaction}
              isActionsSyncing={isActionsSyncing}
            />

            {/* RECENT ACTION LEDGER LOG */}
            <div className="p-3.5 bg-[#0f1118] border border-[#232038] rounded-xl shadow-md">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                  <span>📜</span> Interaction Ledger
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {actionHistory.length} Recorded Actions
                </span>
              </div>

              {actionHistory.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2 text-center">
                  No interactions yet. Tap your companion or choose an action above!
                </p>
              ) : (
                <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                  {actionHistory.slice(-5).reverse().map((entry, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-[#151722] border border-[#222536]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="capitalize font-semibold text-purple-200">
                          {entry.action === 'feed' && '🍖 Feed'}
                          {entry.action === 'play' && '🎾 Play'}
                          {entry.action === 'train' && '⚔️ Train'}
                          {entry.action === 'rest' && '🌙 Rest'}
                          {entry.action === 'pet' && '🐾 Pet'}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: COMPANION TELEMETRY, VITALS & COMPANION PICKER */}
          <div className="lg:col-span-5 space-y-4">
            {/* VITALS & ATTRIBUTES HUD */}
            <div className="p-4 bg-[#0f1118] border border-[#232038] rounded-xl shadow-md space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                  <span>📊</span> Telemetry & Vitals
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60 font-mono">
                  {pet.evolutionStage}
                </span>
              </div>

              <PetStatus
                pet={pet}
                speciesMeta={currentSpeciesMeta}
                onUpdateName={handleUpdateName}
              />
            </div>

            {/* CHOOSE COMPANION SPECIES */}
            <div className="p-4 bg-[#0f1118] border border-[#232038] rounded-xl shadow-md space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                  <span>🐾</span> Companion Guild
                </span>
                <span className="text-[10px] text-slate-500">4 Species Available</span>
              </div>

              <PetSelector
                selectedSpecies={pet.species}
                onSelectSpecies={handleSelectSpecies}
              />
            </div>

            {/* SAVE & BACKUP CONTROLS */}
            <div className="p-3 bg-[#0d0f14] border border-[#1d1f2b] rounded-xl flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span>💾</span> Local Save
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportSave}
                  className="px-2 py-1 rounded bg-[#181c26] hover:bg-[#252c3c] border border-slate-700 text-[11px] text-slate-200 cursor-pointer"
                  title="Export your companion save to a .json file"
                >
                  Export Save
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-1 rounded bg-[#181c26] hover:bg-[#252c3c] border border-slate-700 text-[11px] text-slate-200 cursor-pointer"
                  title="Import a previously saved .json file"
                >
                  Import
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportSave}
                  className="hidden"
                />
                <button
                  onClick={handleResetPet}
                  className="px-2 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800 text-[11px] text-rose-300 cursor-pointer"
                  title="Reset companion to Level 1"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 3. GITHUB SYNC & REPOSITORY SETTINGS MODAL */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-[#12141d] border-2 border-[#38335d] rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#25233c] pb-3">
              <h3 className="text-sm font-bold text-purple-200 flex items-center gap-2">
                <span>⚡</span> GitHub Repository Synchronization
              </h3>
              <button
                onClick={() => setIsSyncModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Connect your self-hosted GitHub Profile Pet repository to synchronize your live virtual companion and publish SVG badge updates directly to your profile README!
            </p>

            <form onSubmit={handleSaveSyncConfig} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-purple-300 mb-1">
                  GitHub Repository (owner/repo)
                </label>
                <input
                  type="text"
                  placeholder="e.g. mnp210/GitHub-Profile-Pet-Test"
                  value={draftRepo}
                  onChange={(e) => setDraftRepo(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090a10] border border-[#2b274c] rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-purple-300 mb-1">
                  Personal Access Token (Optional for Actions Dispatch)
                </label>
                <input
                  type="password"
                  placeholder="Fine-grained token with 'Issues: Read and Write'"
                  value={draftToken}
                  onChange={(e) => setDraftToken(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090a10] border border-[#2b274c] rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-purple-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  🔒 Zero-token exposure guarantee: Token is stored strictly in your browser session and never sent to any third-party server.
                </p>
              </div>

              {syncStatusMsg && (
                <div className="p-2.5 rounded-lg bg-[#181628] border border-purple-800/40 text-[11px] text-purple-300">
                  {syncStatusMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#25233c]">
                <button
                  type="button"
                  onClick={() => setIsSyncModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 text-xs font-bold text-white shadow-md shadow-purple-900/50 cursor-pointer"
                >
                  Save & Connect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. EVOLUTION STAGES CODEX MODAL */}
      {isCodexModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg bg-[#12141d] border-2 border-[#38335d] rounded-2xl p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#25233c] pb-3">
              <h3 className="text-sm font-bold text-purple-200 flex items-center gap-2">
                <span>📜</span> Companion Evolution Codex
              </h3>
              <button
                onClick={() => setIsCodexModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <PetEvolution
              milestones={dynamicMilestones}
              currentLevel={pet.level}
            />

            <div className="pt-2 border-t border-[#25233c] text-right">
              <button
                onClick={() => setIsCodexModalOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 text-xs font-bold text-white cursor-pointer"
              >
                Close Codex
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
