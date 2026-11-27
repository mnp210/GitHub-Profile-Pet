import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANION_THEMES,
  getCompanionTheme,
  getCompanionThemeCssVars,
  normalizeThemeSpecies,
} from '../../src/features/theme/companionTheme.ts';

describe('Centralized Companion Theme System', () => {
  it('defines four distinct companion palettes for cat, dragon, fox, and slime', () => {
    const species = ['cat', 'dragon', 'fox', 'slime'] as const;
    const primaries = new Set<string>();
    const bgBases = new Set<string>();

    for (const id of species) {
      const theme = COMPANION_THEMES[id];
      assert.equal(theme.id, id);
      assert.ok(theme.name.length > 0);
      assert.match(theme.primary, /^#[0-9a-f]{6}$/i);
      assert.match(theme.secondary, /^#[0-9a-f]{6}$/i);
      assert.match(theme.bgBase, /^#[0-9a-f]{6}$/i);
      primaries.add(theme.primary);
      bgBases.add(theme.bgBase);
    }

    assert.equal(primaries.size, 4);
    assert.equal(bgBases.size, 4);
  });

  it('normalizes species aliases and safely falls back to cat', () => {
    assert.equal(normalizeThemeSpecies('shadow_claw'), 'cat');
    assert.equal(normalizeThemeSpecies('ignis_ember'), 'dragon');
    assert.equal(normalizeThemeSpecies('kitsune_sol'), 'fox');
    assert.equal(normalizeThemeSpecies('bloop_matrix'), 'slime');
    assert.equal(normalizeThemeSpecies('unknown_species'), 'cat');
    assert.equal(normalizeThemeSpecies(undefined), 'cat');
  });

  it('produces complete CSS custom properties for any selected companion', () => {
    const dragonTheme = getCompanionTheme('dragon');
    const vars = getCompanionThemeCssVars('dragon');

    assert.equal(vars['--pet-primary'], dragonTheme.primary);
    assert.equal(vars['--pet-secondary'], dragonTheme.secondary);
    assert.equal(vars['--pet-bg-base'], dragonTheme.bgBase);
    assert.equal(vars['--pet-surface'], dragonTheme.surface);
    assert.equal(vars['--pet-border'], dragonTheme.border);
    assert.equal(vars['--pet-text-accent'], dragonTheme.textAccent);
    assert.equal(Object.keys(vars).length, 14);
  });
});
