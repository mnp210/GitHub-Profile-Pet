import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRouteFromSearch,
  buildDeepLinkUrl,
  type DeepLinkScreen,
} from '../../src/features/navigation/deepLinks.ts';

describe('Deep-Link Routing Contract', () => {
  it('resolves all six canonical menu destinations cleanly', () => {
    const cases: Array<[string, DeepLinkScreen]> = [
      ['care', 'care'],
      ['playzone', 'playzone'],
      ['wardrobe', 'wardrobe'],
      ['bond', 'bond'],
      ['achievements', 'achievements'],
      ['stats', 'stats'],
    ];

    for (const [param, expected] of cases) {
      const resolved = resolveRouteFromSearch(
        `?repo=mnp210%2FGitHub-Profile-Pet&action=${param}`
      );
      assert.equal(resolved.screen, expected);
      assert.equal(resolved.pendingCareAction, null);
      assert.equal(resolved.repo, 'mnp210/GitHub-Profile-Pet');
      assert.equal(resolved.isExplicitAction, true);
    }
  });

  it('supports case-insensitive and alias route parameters', () => {
    assert.equal(resolveRouteFromSearch('?action=PLAY-ZONE').screen, 'playzone');
    assert.equal(resolveRouteFromSearch('?action=Profile').screen, 'stats');
    assert.equal(resolveRouteFromSearch('?action=WARDROBE').screen, 'wardrobe');
  });

  it('preserves backwards compatibility for care confirmation actions (feed, play, train, rest, pet)', () => {
    for (const careAction of ['feed', 'play', 'train', 'rest', 'pet'] as const) {
      const resolved = resolveRouteFromSearch(
        `?repo=mnp210%2FGitHub-Profile-Pet&action=${careAction}`
      );
      assert.equal(resolved.screen, 'care');
      assert.equal(resolved.pendingCareAction, careAction);
      assert.equal(resolved.repo, 'mnp210/GitHub-Profile-Pet');
      assert.equal(resolved.isExplicitAction, true);
    }
  });

  it('safely falls back to care homepage for unknown, empty, or missing actions', () => {
    for (const search of [
      '',
      '?repo=mnp210%2FGitHub-Profile-Pet',
      '?repo=mnp210%2FGitHub-Profile-Pet&action=',
      '?repo=mnp210%2FGitHub-Profile-Pet&action=unknown_tab',
    ]) {
      const resolved = resolveRouteFromSearch(search);
      assert.equal(resolved.screen, 'care');
      assert.equal(resolved.pendingCareAction, null);
      assert.equal(resolved.isExplicitAction, false);
    }
  });

  it('builds deep-link URLs preserving repo and supporting Back/Forward transitions', () => {
    const startUrl = 'https://mnp210.github.io/GitHub-Profile-Pet/?repo=mnp210%2FGitHub-Profile-Pet';
    const wardrobeUrl = buildDeepLinkUrl(startUrl, 'wardrobe');
    assert.equal(
      wardrobeUrl,
      'https://mnp210.github.io/GitHub-Profile-Pet/?repo=mnp210%2FGitHub-Profile-Pet&action=wardrobe'
    );
    assert.equal(resolveRouteFromSearch(new URL(wardrobeUrl).search).screen, 'wardrobe');

    const achievementsUrl = buildDeepLinkUrl(wardrobeUrl, 'achievements');
    assert.equal(
      achievementsUrl,
      'https://mnp210.github.io/GitHub-Profile-Pet/?repo=mnp210%2FGitHub-Profile-Pet&action=achievements'
    );
    assert.equal(resolveRouteFromSearch(new URL(achievementsUrl).search).screen, 'achievements');

    // Simulating Back to care
    const careUrl = buildDeepLinkUrl(achievementsUrl, 'care');
    assert.equal(resolveRouteFromSearch(new URL(careUrl).search).screen, 'care');
    assert.equal(new URL(careUrl).searchParams.get('repo'), 'mnp210/GitHub-Profile-Pet');
  });

  it('injects fallbackRepo when repo parameter is absent from current URL', () => {
    const url = buildDeepLinkUrl(
      'https://mnp210.github.io/GitHub-Profile-Pet/',
      'bond',
      'mnp210/GitHub-Profile-Pet'
    );
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('repo'), 'mnp210/GitHub-Profile-Pet');
    assert.equal(parsed.searchParams.get('action'), 'bond');
  });
});
