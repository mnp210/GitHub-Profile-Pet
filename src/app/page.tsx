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
  fetchRemoteReadme,
  updateRemoteReadme,
  ConnectedRepoConfig,
} from '@/lib/storage/gameStateStorage';
import {
  generateReadmeMenuSnippet,
  installReadmeMenu,
  uninstallReadmeMenu,
} from '@/features/pet-engine/publication/readmeMenu';

export default function Home() {
  const [pet, setPet] = useState<PetState>(() => loadLocalPetState());
  const [actionHistory, setActionHistory] = useState<ActionHistoryEntry[]>(() => loadLocalActionHistory());
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState<number>(0);
  const [lastReaction, setLastReaction] = useState<string>('');
  const [feedback, setFeedback] = useState<{
    message: string;
    type: 'success' | 'warning' | 'level_up' | 'info';
    rewardText?: string;
  } | null>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('action');
      if (p && p.toLowerCase().trim() === 'stats') {
        const initialPet = loadLocalPetState();
        return {
          message: `Viewing Pet Stats for ${initialPet.name} from repository README.`,
          type: 'info',
        };
      }
    }
    return null;
  });

  // Audio mute state
  const [isMuted, setIsMuted] = useState<boolean>(() =>
    typeof window !== 'undefined' ? retroAudio.getMuted() : false
  );

  // GitHub Sync & Modal state
  const [repoConfig, setRepoConfig] = useState<ConnectedRepoConfig>(() => {
    const loaded = loadRepoConfig();
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('repo');
      if (p && p.trim()) return { ...loaded, repo: p.trim() };
    }
    return loaded;
  });
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [isCodexModalOpen, setIsCodexModalOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('action')?.toLowerCase().trim() === 'stats';
    }
    return false;
  });
  const [isActionsSyncing, setIsActionsSyncing] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');

  // Pending action routed from external README navigation requiring user confirmation
  const [pendingActionConfirmation, setPendingActionConfirmation] = useState<{
    action: ActionType;
    repo: string;
  } | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const actionParam = params.get('action')?.toLowerCase().trim();
      const repoParam = params.get('repo')?.trim() || loadRepoConfig().repo || 'connected repository';
      if (actionParam && ['feed', 'play', 'train', 'rest', 'pet'].includes(actionParam)) {
        return { action: actionParam as ActionType, repo: repoParam };
      }
    }
    return null;
  });

  // README Pet Menu Integration state
  const [readmeOperationStatus, setReadmeOperationStatus] = useState<string>('');
  const [isReadmeBusy, setIsReadmeBusy] = useState<boolean>(false);

  // Draft inputs for sync modal
  const [draftRepo, setDraftRepo] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('repo');
      if (p && p.trim()) return p.trim();
    }
    return loadRepoConfig().repo || '';
  });
  const [draftToken, setDraftToken] = useState<string>(() => loadRepoConfig().token || '');
  const [isRepoUninitialized, setIsRepoUninitialized] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Initial Load: Read from persistent storage on client mount
  useEffect(() => {
    const initialConfig = loadRepoConfig();

    let activeRepo = initialConfig.repo;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const repoParam = params.get('repo');
      const actionParam = params.get('action');

      if (repoParam && repoParam.trim()) {
        activeRepo = repoParam.trim();
        saveRepoConfig({ ...initialConfig, repo: activeRepo });
      }

      if (actionParam && actionParam.toLowerCase().trim() === 'stats') {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('action');
        window.history.replaceState({}, '', newUrl.toString());
      }
    }

    // Auto-fetch latest state from repository if connected
    if (activeRepo) {
      fetchRemotePetState(activeRepo, initialConfig.token).then((res) => {
        if (res.success && res.pet) {
          setIsRepoUninitialized(false);
          setPet(res.pet);
          saveLocalGameState(res.pet, loadLocalActionHistory());
          setSyncStatusMsg(`Synchronized with ${activeRepo}`);
        } else {
          if (res.uninitialized) {
            setIsRepoUninitialized(true);
          }
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
    } else if (repoConfig.repo && !repoConfig.token) {
      setSyncStatusMsg(`Visitor mode: Action played in local playground. Connect token in ⚡ Sync to dispatch to ${repoConfig.repo}`);
    }
  };

  // Confirm and execute pending action from README link
  const handleConfirmPendingAction = () => {
    if (!pendingActionConfirmation) return;
    const actionToRun = pendingActionConfirmation.action;
    setPendingActionConfirmation(null);

    if (typeof window !== 'undefined') {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('action');
      window.history.replaceState({}, '', newUrl.toString());
    }

    handleAction(actionToRun);
  };

  // Cancel pending action from README link
  const handleCancelPendingAction = () => {
    setPendingActionConfirmation(null);
    if (typeof window !== 'undefined') {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('action');
      window.history.replaceState({}, '', newUrl.toString());
    }
  };

  // Consequence preview dictionary for README action confirmation modal
  const getActionConsequencePreview = (action: ActionType) => {
    switch (action) {
      case 'feed':
        return {
          title: '🍖 Feed Companion',
          changes: ['+24 Satiety', '+10 XP', '-8 Energy'],
          description: 'Restores hunger and awards basic care experience points.',
        };
      case 'play':
        return {
          title: '🎾 Play with Companion',
          changes: ['+18 Joy / Happiness', '+15 XP', '-15 Energy'],
          description: 'Engages companion in energetic play, boosting mood and happiness.',
        };
      case 'train':
        return {
          title: '⚔️ Train Companion',
          changes: ['+25 XP', '+8 Joy', '-22 Energy', '-10 Satiety'],
          description: 'Rigorous training regimen that accelerates level progression.',
        };
      case 'rest':
        return {
          title: '🌙 Rest Companion',
          changes: ['+25 Energy', '-5 Satiety'],
          description: 'Puts companion to sleep to recover vital energy.',
        };
      case 'pet':
        return {
          title: '🐾 Pet Companion',
          changes: ['+10 Joy / Happiness', '+5 XP'],
          description: 'Gentle touch offering affection and reassurance.',
        };
    }
  };

  // Copy README Pet Menu Markdown snippet to clipboard
  const handleCopyReadmeSnippet = async () => {
    const targetRepo = draftRepo.trim() || repoConfig.repo || 'owner/repo';
    const snippet = generateReadmeMenuSnippet({
      repo: targetRepo,
      pet,
    });

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(snippet);
        setReadmeOperationStatus('✅ Copied README Pet Menu snippet to clipboard!');
      } else {
        setReadmeOperationStatus('Clipboard API unavailable in this context.');
      }
    } catch {
      setReadmeOperationStatus('Failed to copy to clipboard.');
    }
  };

  // Install / Update README Pet Menu via GitHub Contents API
  const handleInstallReadmeMenu = async () => {
    const targetRepo = draftRepo.trim() || repoConfig.repo;
    const token = draftToken.trim() || repoConfig.token;

    if (!targetRepo || !token) {
      setReadmeOperationStatus('⚠️ Both repository and token with "Contents: read/write" are required.');
      return;
    }

    setIsReadmeBusy(true);
    setReadmeOperationStatus('Fetching repository README.md...');

    try {
      const fetchRes = await fetchRemoteReadme(targetRepo, token);
      if (!fetchRes.success) {
        setReadmeOperationStatus(`Error fetching README: ${fetchRes.error}`);
        setIsReadmeBusy(false);
        return;
      }

      const existingContent = fetchRes.content ?? '';
      const installRes = installReadmeMenu(existingContent, {
        repo: targetRepo,
        pet,
      });

      if (!installRes.changed) {
        setReadmeOperationStatus('ℹ️ README Pet Menu is already up-to-date!');
        setIsReadmeBusy(false);
        return;
      }

      setReadmeOperationStatus('Committing updated README.md to GitHub...');
      const commitMsg = installRes.installed
        ? 'docs: install interactive pet menu in README [skip ci]'
        : 'docs: update pet menu state in README [skip ci]';

      const updateRes = await updateRemoteReadme(
        targetRepo,
        installRes.content,
        commitMsg,
        fetchRes.sha,
        token
      );

      if (updateRes.success) {
        setReadmeOperationStatus(`🎉 Successfully ${installRes.installed ? 'installed' : 'updated'} Pet Menu in README!`);
      } else {
        setReadmeOperationStatus(`GitHub commit error: ${updateRes.error}`);
      }
    } catch (err) {
      setReadmeOperationStatus(`Failed: ${(err as Error).message}`);
    } finally {
      setIsReadmeBusy(false);
    }
  };

  // Uninstall README Pet Menu via GitHub Contents API
  const handleUninstallReadmeMenu = async () => {
    const targetRepo = draftRepo.trim() || repoConfig.repo;
    const token = draftToken.trim() || repoConfig.token;

    if (!targetRepo || !token) {
      setReadmeOperationStatus('⚠️ Both repository and token with "Contents: read/write" are required.');
      return;
    }

    if (!confirm('Are you sure you want to completely remove the Pet Menu from your README?')) {
      return;
    }

    setIsReadmeBusy(true);
    setReadmeOperationStatus('Fetching repository README.md...');

    try {
      const fetchRes = await fetchRemoteReadme(targetRepo, token);
      if (!fetchRes.success) {
        setReadmeOperationStatus(`Error fetching README: ${fetchRes.error}`);
        setIsReadmeBusy(false);
        return;
      }

      const existingContent = fetchRes.content ?? '';
      const uninstallRes = uninstallReadmeMenu(existingContent);

      if (!uninstallRes.removed) {
        setReadmeOperationStatus('ℹ️ No Pet Menu found in README to remove.');
        setIsReadmeBusy(false);
        return;
      }

      setReadmeOperationStatus('Committing clean README.md to GitHub...');
      const updateRes = await updateRemoteReadme(
        targetRepo,
        uninstallRes.content,
        'docs: uninstall pet menu from README [skip ci]',
        fetchRes.sha,
        token
      );

      if (updateRes.success) {
        setReadmeOperationStatus('🗑️ Successfully removed Pet Menu from README!');
      } else {
        setReadmeOperationStatus(`GitHub commit error: ${updateRes.error}`);
      }
    } catch (err) {
      setReadmeOperationStatus(`Failed: ${(err as Error).message}`);
    } finally {
      setIsReadmeBusy(false);
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
        {/* REPOSITORY STATUS & TRAINER / VISITOR MODE BADGE */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 rounded-xl border border-[#252240] bg-[#0e111a]/90 backdrop-blur text-xs">
          <div className="flex items-center gap-2">
            {repoConfig.repo ? (
              repoConfig.token ? (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
                  <span className="text-slate-300 font-medium">
                    Authorized Trainer:{' '}
                    <span className="font-mono text-purple-300 font-semibold">{repoConfig.repo}</span>
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-600/40 font-semibold">
                    Live Sync Active
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-400" />
                  <span className="text-slate-300 font-medium">
                    Visitor Mode:{' '}
                    <span className="font-mono text-sky-300 font-semibold">{repoConfig.repo}</span>
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-600/40 font-semibold">
                    Interactive Playground (Read-Only)
                  </span>
                </>
              )
            ) : (
              <>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-400" />
                <span className="text-slate-300 font-medium">
                  Local Adventure Mode
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-600/40 font-semibold">
                  Offline Save
                </span>
              </>
            )}
          </div>

          {isRepoUninitialized && (
            <div className="flex items-center gap-1.5 text-amber-300 bg-amber-950/60 border border-amber-600/40 px-2.5 py-1 rounded-lg text-[11px]">
              <span>🐣</span>
              <span>Pet not yet initialized on GitHub. Showing newborn companion.</span>
            </div>
          )}

          {syncStatusMsg && !isRepoUninitialized && (
            <span className="text-[11px] font-mono text-slate-400 truncate max-w-xs sm:max-w-md">
              {syncStatusMsg}
            </span>
          )}
        </div>

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
                  Personal Access Token (Optional for Actions & README Integration)
                </label>
                <input
                  type="password"
                  placeholder="Fine-grained token with 'Issues: Read & Write' and optional 'Contents: Read & Write'"
                  value={draftToken}
                  onChange={(e) => setDraftToken(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090a10] border border-[#2b274c] rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-purple-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  🔒 Zero-token exposure guarantee: Token is stored strictly in your browser session and never sent to any third-party server.
                </p>
              </div>

              {/* PERMISSIONS & SAFETY DOCUMENTATION */}
              <div className="p-2.5 rounded-lg bg-[#0d0f17] border border-[#272344] text-[11px] text-slate-400 space-y-1">
                <p className="font-semibold text-purple-300">🔐 Granular GitHub Permissions Model:</p>
                <p>• <strong>Issues (Read & Write):</strong> Required only for dispatching care action issues to trigger GitHub Actions.</p>
                <p>• <strong>Contents (Read & Write):</strong> Required ONLY if enabling automatic installation/updates to <code>README.md</code>.</p>
              </div>

              {/* README PET MENU INTEGRATION SECTION */}
              <div className="p-3 rounded-xl bg-[#141226] border border-purple-800/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                    <span>📑</span> README Pet Menu Integration
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Markdown / HTML</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Embed an attractive, interactive-navigation Pet Menu in any repository README so visitors can inspect your pet and jump straight into live gameplay!
                </p>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyReadmeSnippet}
                    className="px-2.5 py-1 rounded bg-[#201c38] hover:bg-[#2e2952] border border-purple-700/60 text-[11px] font-semibold text-purple-200 cursor-pointer"
                  >
                    📋 Copy Markdown
                  </button>
                  <button
                    type="button"
                    disabled={isReadmeBusy || !draftToken.trim()}
                    onClick={handleInstallReadmeMenu}
                    className="px-2.5 py-1 rounded bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-[11px] font-bold text-white cursor-pointer"
                    title={draftToken.trim() ? "Install or update README menu directly via GitHub Contents API" : "Requires token with Contents: Read & Write"}
                  >
                    {isReadmeBusy ? 'Updating...' : '🚀 Install / Update in README'}
                  </button>
                  <button
                    type="button"
                    disabled={isReadmeBusy || !draftToken.trim()}
                    onClick={handleUninstallReadmeMenu}
                    className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-800 disabled:opacity-50 disabled:cursor-not-allowed text-[11px] text-rose-300 cursor-pointer"
                    title={draftToken.trim() ? "Completely remove the Pet Menu from README" : "Requires token with Contents: Read & Write"}
                  >
                    🗑️ Uninstall
                  </button>
                </div>

                {readmeOperationStatus && (
                  <div className="p-2 rounded bg-[#0b0c13] border border-purple-800/60 text-[11px] text-purple-200 font-mono">
                    {readmeOperationStatus}
                  </div>
                )}
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

      {/* 5. ACTION CONFIRMATION MODAL (ROUTED FROM README DEEP-LINK) */}
      {pendingActionConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-md bg-[#131124] border-2 border-amber-500 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2d2847] pb-3">
              <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2 font-mono">
                <span>⚡</span> CONFIRM EXTERNAL PET ACTION
              </h3>
              <button
                onClick={handleCancelPendingAction}
                className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-[#1c1833] border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Target Companion:</span>
                <span className="font-bold text-slate-100">
                  {pet.name} ({currentSpeciesMeta.name})
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Target Repository:</span>
                <span className="font-mono text-purple-300">
                  {pendingActionConfirmation.repo}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Requested Action:</span>
                <span className="font-bold text-amber-400 uppercase tracking-wide">
                  {getActionConsequencePreview(pendingActionConfirmation.action).title}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-slate-300">
              <p className="font-semibold text-purple-200">Predicted Consequences:</p>
              <div className="flex flex-wrap gap-1.5">
                {getActionConsequencePreview(pendingActionConfirmation.action).changes.map((c, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-purple-950/80 border border-purple-700/60 text-purple-200 font-mono text-[11px]"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 pt-1">
                {getActionConsequencePreview(pendingActionConfirmation.action).description}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/40 text-[11px] text-amber-200/90 leading-relaxed">
              🔒 <strong>Action Confirmation Safety Policy:</strong> You navigated to this game from a repository README link. Actions will not execute automatically without your explicit confirmation.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2d2847]">
              <button
                type="button"
                onClick={handleCancelPendingAction}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPendingAction}
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-black shadow-lg shadow-amber-600/30 cursor-pointer"
              >
                Confirm & Execute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
