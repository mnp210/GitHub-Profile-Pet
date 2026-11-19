import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadRepoConfig,
  saveRepoConfig,
  dispatchGitHubActionIssue,
  updateRemoteReadme,
  exportSaveData,
} from '../../src/lib/storage/gameStateStorage.ts';
import type { PetState } from '../../src/types/pet.ts';

// Mock localStorage for Node.js test environment
const mockStorage = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

(globalThis as unknown as { localStorage: typeof fakeLocalStorage }).localStorage = fakeLocalStorage;
(globalThis as unknown as { window: unknown }).window = globalThis;

const mockPet: PetState = {
  name: 'Shadow Claw',
  species: 'cat',
  level: 3,
  xp: 45,
  maxExp: 150,
  energy: 80,
  hunger: 90,
  happiness: 95,
  mood: 'Happy',
  evolutionStage: 'Juvenile',
};

describe('Token and Authorization Security Hardening', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  describe('Zero-Token Persistence in localStorage', () => {
    it('never persists Personal Access Tokens into localStorage during saveRepoConfig', () => {
      saveRepoConfig({
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        token: 'ghp_secretTokenThatMustNeverBePersisted1234567890',
        syncToActions: true,
      });

      // Repo should be saved, but token must NOT be in localStorage
      assert.equal(mockStorage.get('gh_pet_connected_repo_v1'), 'mnp210/GitHub-Profile-Pet-Test');
      assert.equal(mockStorage.get('gh_pet_access_token_v1'), undefined);
    });

    it('actively purges any legacy token found in localStorage during loadRepoConfig', () => {
      // Simulate legacy insecure state where a token was left in storage
      mockStorage.set('gh_pet_connected_repo_v1', 'mnp210/GitHub-Profile-Pet-Test');
      mockStorage.set('gh_pet_access_token_v1', 'ghp_legacyInsecureToken');

      const config = loadRepoConfig();

      assert.equal(config.repo, 'mnp210/GitHub-Profile-Pet-Test');
      assert.equal(config.token, undefined);
      // Legacy token must have been actively purged
      assert.equal(mockStorage.get('gh_pet_access_token_v1'), undefined);
    });
  });

  describe('Credential Leakage Protection in Persisted Artifacts', () => {
    it('ensures exported save files never contain credentials or tokens', () => {
      const exportedJson = exportSaveData(mockPet, []);
      const parsed = JSON.parse(exportedJson);

      assert.equal(parsed.pet.name, 'Shadow Claw');
      assert.equal(parsed.token, undefined);
      assert.equal(exportedJson.includes('ghp_'), false);
      assert.equal(exportedJson.includes('Bearer'), false);
    });
  });

  describe('Authorization Failure Integrity & Fail-Closed Behavior', () => {
    it('fails closed when dispatching an action without a token', async () => {
      const res = await dispatchGitHubActionIssue('mnp210/GitHub-Profile-Pet-Test', 'feed', '');
      assert.equal(res.success, false);
      assert.match(res.error || '', /required/i);
    });

    it('fails closed when updating README without a token', async () => {
      const res = await updateRemoteReadme('mnp210/GitHub-Profile-Pet-Test', '# README', 'docs: update', undefined, '');
      assert.equal(res.success, false);
      assert.match(res.error || '', /required/i);
    });

    it('never leaks token plaintext in error messages on simulated authorization failure', async () => {
      const secretToken = 'ghp_superSecretToken9999999999';

      // Mock global fetch to return 401 Unauthorized
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });

      try {
        const res = await dispatchGitHubActionIssue('mnp210/GitHub-Profile-Pet-Test', 'feed', secretToken);
        assert.equal(res.success, false);
        assert.match(res.error || '', /HTTP 401/);
        // CRITICAL: Error message must not contain the sensitive token
        assert.equal(res.error?.includes(secretToken), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns explicit permission denied message on HTTP 403 without claiming success', async () => {
      const secretToken = 'ghp_superSecretToken8888888888';

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });

      try {
        const res = await updateRemoteReadme('mnp210/GitHub-Profile-Pet-Test', '# Menu', 'docs: menu', undefined, secretToken);
        assert.equal(res.success, false);
        assert.match(res.error || '', /HTTP 403/);
        assert.equal(res.error?.includes(secretToken), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
