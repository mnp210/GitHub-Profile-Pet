import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANION_THEMES,
  getCompanionTheme,
  getCompanionThemeCssVars,
  normalizeThemeSpecies,
} from '../../src/features/theme/companionTheme.ts';
import { applyVisitorCompanionOverride } from '../../src/lib/storage/gameStateStorage.ts';
import type { PetState, SpeciesId } from '../../src/types/pet.ts';

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

  it('preserves visitor companion selection over canonical repo sync without altering progression or Trainer Mode', () => {
    const canonicalCat: PetState = {
      name: 'Shadow Claw',
      species: 'cat',
      level: 5,
      xp: 225,
      maxExp: 500,
      mood: 'Happy',
      evolutionStage: 'Juvenile',
      hunger: 97,
      happiness: 40,
      energy: 100,
      personality: 'curious',
    };

    // Visitor Mode: applies selected companion while preserving canonical vitals/progression
    const overridden = applyVisitorCompanionOverride(canonicalCat, 'dragon', false);
    assert.equal(overridden.species, 'dragon');
    assert.equal(overridden.name, 'Ignis Ember');
    assert.equal(overridden.personality, 'determined');
    assert.equal(overridden.level, 5);
    assert.equal(overridden.xp, 225);
    assert.equal(overridden.hunger, 97);

    // Trainer Mode: canonical repository pet remains authoritative
    const trainerPet = applyVisitorCompanionOverride(canonicalCat, 'dragon', true);
    assert.equal(trainerPet.species, 'cat');
    assert.equal(trainerPet.name, 'Shadow Claw');

    // Invalid / null selection: falls back safely to canonical pet
    const invalidPet = applyVisitorCompanionOverride(
      canonicalCat,
      'invalid_species' as SpeciesId,
      false
    );
    assert.equal(invalidPet.species, 'cat');
    assert.equal(applyVisitorCompanionOverride(canonicalCat, null, false).species, 'cat');
  });
});
