import type { PetState } from '../../types/pet.ts';
import { INITIAL_PET_STATE } from '../../constants/petData.ts';
import type { ActionHistoryEntry, ActionType } from '../../features/gamification/rewards.ts';
import { getDefaultPersonalityForSpecies } from '../../features/personality/personalities.ts';

const LOCAL_STORAGE_PET_KEY = 'gh_pet_game_state_v1';
const LOCAL_STORAGE_HISTORY_KEY = 'gh_pet_action_history_v1';
const LOCAL_STORAGE_REPO_KEY = 'gh_pet_connected_repo_v1';
const LOCAL_STORAGE_TOKEN_KEY = 'gh_pet_access_token_v1';

import type { ProgressionState } from '../../features/progression/types.ts';
import { migrateProgressionState } from '../../features/progression/persistence.ts';
import type { BondingState } from '../../features/bonding/types.ts';
import { migrateBondingState } from '../../features/bonding/persistence.ts';

export interface ConnectedRepoConfig {
  repo: string; // e.g. "mnp210/GitHub-Profile-Pet-Test"
  token?: string; // Optional user personal access token
  syncToActions: boolean;
  enableReadmeMenu?: boolean;
  lastSyncedAt?: string;
}

export interface GamePersistenceData {
  pet: PetState;
  history: ActionHistoryEntry[];
  exportedAt: string;
  version: number;
  progression?: ProgressionState;
  bonding?: BondingState;
}

/**
 * Loads the active pet state from localStorage or falls back to INITIAL_PET_STATE.
 */
export function loadLocalPetState(): PetState {
  if (typeof window === 'undefined') return INITIAL_PET_STATE;

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PET_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.level === 'number' && typeof parsed.name === 'string') {
        const species = normalizeSpeciesId(parsed.species || 'cat');
        return {
          ...parsed,
          species,
          personality: parsed.personality || getDefaultPersonalityForSpecies(species),
        } as PetState;
      }
    }
  } catch (err) {
    console.warn('Failed to load local pet state from storage:', err);
  }

  return INITIAL_PET_STATE;
}

/**
 * Loads recent action history for diminishing returns and cooldown tracking.
 */
export function loadLocalActionHistory(): ActionHistoryEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as ActionHistoryEntry[];
      }
    }
  } catch (err) {
    console.warn('Failed to load local action history from storage:', err);
  }

  return [];
}

/**
 * Saves pet state and action history to localStorage.
 */
export function saveLocalGameState(pet: PetState, history: ActionHistoryEntry[]): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(LOCAL_STORAGE_PET_KEY, JSON.stringify(pet));
    localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(history.slice(-30)));
  } catch (err) {
    console.error('Failed to save pet state to localStorage:', err);
  }
}

/**
 * Loads connected GitHub repository configuration.
 * Note: Personal Access Tokens are NEVER loaded from localStorage to protect against credential leakage.
 */
export function loadRepoConfig(): ConnectedRepoConfig {
  if (typeof window === 'undefined') {
    return { repo: '', syncToActions: false };
  }

  // Security Hardening: Purge any legacy token from localStorage
  try {
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }

  const repo = localStorage.getItem(LOCAL_STORAGE_REPO_KEY) || '';

  return {
    repo,
    token: undefined, // Purely in-memory per session
    syncToActions: false,
  };
}

/**
 * Saves connected GitHub repository configuration.
 * Note: Personal Access Tokens are NEVER written to localStorage.
 */
export function saveRepoConfig(config: ConnectedRepoConfig): void {
  if (typeof window === 'undefined') return;

  if (config.repo) {
    localStorage.setItem(LOCAL_STORAGE_REPO_KEY, config.repo.trim());
  } else {
    localStorage.removeItem(LOCAL_STORAGE_REPO_KEY);
  }

  // Security Hardening: Never write PAT to localStorage
  try {
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

/**
 * Fetches authoritative pet state from a GitHub repository's `pet/state/pet.json`.
 */
export async function fetchRemotePetState(repo: string, token?: string): Promise<{
  success: boolean;
  pet?: PetState;
  uninitialized?: boolean;
  error?: string;
}> {
  if (!repo || !repo.includes('/')) {
    return { success: false, error: 'Invalid repository format. Expected "owner/repo".' };
  }

  try {
    const cleanRepo = repo.trim();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3.raw',
    };

    if (token) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${cleanRepo}/contents/pet/state/pet.json?t=${Date.now()}`,
      { headers }
    );

    if (!response.ok) {
      // Fallback to raw content URL if public repo
      const rawRes = await fetch(
        `https://raw.githubusercontent.com/${cleanRepo}/main/pet/state/pet.json?t=${Date.now()}`
      );
      if (rawRes.ok) {
        const petData = await rawRes.json();
        return { success: true, pet: mapRemotePetToLocal(petData) };
      }

      const isNotFound = response.status === 404 || rawRes.status === 404;
      return {
        success: false,
        uninitialized: isNotFound,
        error: isNotFound
          ? `Repository ${cleanRepo} has not initialized a pet yet (pet/state/pet.json not found).`
          : `GitHub API error: HTTP ${response.status}`,
      };
    }

    const petData = await response.json();
    return { success: true, pet: mapRemotePetToLocal(petData) };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

function mapRemotePetToLocal(raw: Record<string, unknown>): PetState {
  const species = normalizeSpeciesId((raw.species as string) || 'cat');
  return {
    name: (raw.name as string) || 'Shadow Claw',
    species,
    level: typeof raw.level === 'number' ? raw.level : 1,
    xp: typeof raw.xp === 'number' ? raw.xp : 0,
    maxExp: typeof raw.maxExp === 'number' ? raw.maxExp : 100,
    energy: typeof raw.energy === 'number' ? raw.energy : 100,
    hunger: typeof raw.hunger === 'number' ? raw.hunger : 100,
    happiness: typeof raw.happiness === 'number' ? raw.happiness : 100,
    mood: (raw.mood as PetState['mood']) || 'Happy',
    personality: (raw.personality as PetState['personality']) || getDefaultPersonalityForSpecies(species),
    evolutionStage: (raw.evolutionStage as PetState['evolutionStage']) || 'Hatchling',
  };
}

function normalizeSpeciesId(species: string): PetState['species'] {
  switch (species) {
    case 'shadow_claw':
    case 'cat':
      return 'cat';
    case 'ignis_ember':
    case 'dragon':
      return 'dragon';
    case 'kitsune_sol':
    case 'fox':
      return 'fox';
    case 'bloop_matrix':
    case 'slime':
      return 'slime';
    default:
      return 'cat';
  }
}

/**
 * Dispatches a real pet action as a GitHub issue to trigger the repository's GitHub Actions workflow.
 */
export async function dispatchGitHubActionIssue(
  repo: string,
  action: ActionType,
  token: string
): Promise<{ success: boolean; issueNumber?: number; error?: string }> {
  if (!repo || !token) {
    return { success: false, error: 'Repository and Token are required to dispatch GitHub Actions.' };
  }

  try {
    const cleanRepo = repo.trim();
    const actionLabel = `pet:${action}`;
    const payload = {
      title: `pet: ${action}`,
      body: `Automated care interaction submitted from GitHub Profile Pet playable web companion.\n\nAction: **${action.toUpperCase()}**\nTimestamp: ${new Date().toISOString()}`,
      labels: ['pet-action:pending', actionLabel],
    };

    const response = await fetch(`https://api.github.com/repos/${cleanRepo}/issues`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${token.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'Authentication failed (HTTP 401): Invalid or expired personal access token.' };
      }
      if (response.status === 403) {
        return { success: false, error: 'Permission denied (HTTP 403): Token lacks write permission or issues are disabled on this repository.' };
      }
      if (response.status === 404) {
        return { success: false, error: `Repository not found or token lacks access (HTTP 404): ${cleanRepo}` };
      }
      const errBody = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errBody.message || `GitHub error HTTP ${response.status}`,
      };
    }

    const issueData = await response.json();
    return { success: true, issueNumber: issueData.number };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Fetches the raw content and git blob SHA of a repository's README.md via GitHub Contents API.
 */
export async function fetchRemoteReadme(
  repo: string,
  token?: string
): Promise<{ success: boolean; content?: string; sha?: string; error?: string }> {
  if (!repo || !repo.includes('/')) {
    return { success: false, error: 'Invalid repository format. Expected "owner/repo".' };
  }

  try {
    const cleanRepo = repo.trim();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${cleanRepo}/contents/README.md?t=${Date.now()}`,
      { headers }
    );

    if (response.status === 404) {
      return { success: true, content: '', sha: undefined };
    }

    if (!response.ok) {
      return { success: false, error: `GitHub API error: HTTP ${response.status}` };
    }

    const data = await response.json();
    const base64Content = (data.content || '').replace(/\s/g, '');
    let decoded = '';
    try {
      decoded = decodeURIComponent(escape(atob(base64Content)));
    } catch {
      decoded = atob(base64Content);
    }

    return {
      success: true,
      content: decoded,
      sha: data.sha,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Updates or creates the repository's README.md via GitHub Contents API.
 * Requires `Contents: read/write` permissions.
 */
export async function updateRemoteReadme(
  repo: string,
  content: string,
  commitMessage: string,
  sha: string | undefined,
  token: string
): Promise<{ success: boolean; commitSha?: string; error?: string }> {
  if (!repo || !token) {
    return { success: false, error: 'Repository and Token are required to update README.' };
  }

  try {
    const cleanRepo = repo.trim();
    let encoded = '';
    try {
      encoded = btoa(unescape(encodeURIComponent(content)));
    } catch {
      encoded = btoa(content);
    }

    const payload: { message: string; content: string; sha?: string } = {
      message: commitMessage,
      content: encoded,
    };
    if (sha) {
      payload.sha = sha;
    }

    const response = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/README.md`, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${token.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'Authentication failed (HTTP 401): Invalid or expired personal access token.' };
      }
      if (response.status === 403) {
        return { success: false, error: 'Permission denied (HTTP 403): Token lacks write permission or issues are disabled on this repository.' };
      }
      if (response.status === 404) {
        return { success: false, error: `Repository not found or token lacks access (HTTP 404): ${cleanRepo}` };
      }
      const errBody = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errBody.message || `GitHub error HTTP ${response.status}`,
      };
    }

    const resData = await response.json();
    return {
      success: true,
      commitSha: resData.commit?.sha,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Exports pet state and progress to a downloadable JSON string.
 */
export function exportSaveData(
  pet: PetState,
  history: ActionHistoryEntry[],
  progression?: ProgressionState,
  bonding?: BondingState
): string {
  const data: GamePersistenceData = {
    pet,
    history,
    progression,
    bonding,
    exportedAt: new Date().toISOString(),
    version: 1,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Imports pet state and progress from an uploaded JSON string.
 */
export function importSaveData(jsonString: string): {
  success: boolean;
  pet?: PetState;
  history?: ActionHistoryEntry[];
  progression?: ProgressionState;
  bonding?: BondingState;
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString) as GamePersistenceData;
    if (!parsed || !parsed.pet || typeof parsed.pet.level !== 'number') {
      return { success: false, error: 'Invalid save file format.' };
    }
    return {
      success: true,
      pet: parsed.pet,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      progression: parsed.progression ? migrateProgressionState(parsed.progression) : undefined,
      bonding: parsed.bonding ? migrateBondingState(parsed.bonding) : undefined,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
