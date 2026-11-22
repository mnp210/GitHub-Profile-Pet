# Sprint 5.1A — State Schema & Migration Assessment

## 1. Schema Definition

To support personality archetypes while ensuring 100% backward and forward compatibility, `pet/schemas/pet.schema.json` was augmented with an optional `"personality"` field under `"properties"`:

```json
    "personality": {
      "type": "string",
      "enum": ["curious", "playful", "calm", "determined"]
    }
```

Because `"required"` was left strictly unchanged and `"additionalProperties"` is `false`, existing documents without `"personality"` remain completely valid according to Draft 2020-12 rules.

---

## 2. Domain Types Extension

In `src/features/pet-engine/domain/types.ts`:
```typescript
export type PersonalityType = 'curious' | 'playful' | 'calm' | 'determined';

export interface PetStateDocument {
  schemaVersion: number;
  generation: number;
  name: string;
  species: PetSpecies;
  level: number;
  xp: number;
  maxExp: number;
  energy: number;
  energyAccumulator: number;
  hunger: number;
  hungerDecayAccumulator?: number;
  happiness: number;
  happinessDecayAccumulator?: number;
  mood: PetMood;
  personality?: PersonalityType;
  evolutionStage: EvolutionStage;
  // ...
}
```

In `src/types/pet.ts`:
```typescript
export interface PetState {
  name: string;
  species: SpeciesId;
  level: number;
  xp: number;
  maxExp: number;
  mood: PetMood;
  personality?: PersonalityType;
  behaviourState?: string;
  evolutionStage: string;
  hunger: number;
  happiness: number;
  energy: number;
}
```

---

## 3. Validator Verification

In `src/features/pet-engine/validation/stateValidator.ts`:
```typescript
export const VALID_PERSONALITIES: Set<PersonalityType> = new Set([
  'curious',
  'playful',
  'calm',
  'determined',
]);

if (obj.personality !== undefined) {
  if (typeof obj.personality !== 'string' || !VALID_PERSONALITIES.has(obj.personality as PersonalityType)) {
    errors.push(`Invalid personality: received ${String(obj.personality)}.`);
  }
}
```

---

## 4. Seamless Migration & Fallback Matrix

Existing pet save data from local storage or remote repositories upgrades transparently without user intervention:

| Storage Source | Prior State | Sprint 5.1A Upgraded State | Fallback Logic |
| :--- | :--- | :--- | :--- |
| `localStorage` (`gh_pet_game_state_v1`) | `{ species: 'cat' }` | `{ species: 'cat', personality: 'curious' }` | `getDefaultPersonalityForSpecies('cat')` |
| `localStorage` (`gh_pet_game_state_v1`) | `{ species: 'dragon' }` | `{ species: 'dragon', personality: 'determined' }` | `getDefaultPersonalityForSpecies('dragon')` |
| Authoritative remote `pet/state/pet.json` | Undefined `personality` | Mapped to `curious` in client memory | Read-only backward compatibility |
| Explicit custom selection | `{ personality: 'calm' }` | `{ personality: 'calm' }` | Preserved across page reloads |

**Production Impact:** **Zero.** Production `pet/state/pet.json` remains pristine and untouched.
