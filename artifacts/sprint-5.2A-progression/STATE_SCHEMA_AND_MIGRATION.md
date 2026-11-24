# Sprint 5.2A — State Schema & Migration Specifications

## 1. Schema Versioning

- **Current Version:** `1` (`CURRENT_PROGRESSION_SCHEMA_VERSION = 1`).
- **Primary Storage Key:** `gh_pet_progression_state_v1` in browser `localStorage`.
- **Save File Compatibility:** Backward-compatible integration into `exportSaveData()` and `importSaveData()`.

---

## 2. Backward Compatibility & Defaulting Invariants

1. **Legacy Save Files (v0 without progression):**
   - When importing a legacy JSON save file lacking a `progression` field, `importSaveData()` succeeds and returns `progression: undefined`.
   - The application safely calls `loadProgressionState()` which initializes default version 1 state with `void_chamber` in inventory and zero achievements.
2. **Missing Fields Recovery:**
   - Any missing sub-object (`equipped`, `achievements`, `stats`) is filled with safe default values by `migrateProgressionState()`.
3. **Inventory Sanitization:**
   - Unknown cosmetic IDs (e.g., from future versions or manual file tampering) are discarded.
   - `void_chamber` is guaranteed to exist in the inventory.
4. **Equipped Slots Validation:**
   - An equipped item MUST exist in `COSMETICS_CATALOG` AND be owned in `inventory`.
   - If an unowned or unknown item is found in an equipped slot, that slot is cleared to `null` (or `'void_chamber'` for environment).
5. **Stats Clamping:**
   - All numerical counters are sanitized to non-negative integers $\ge 0$.
   - Distinct session dates are validated against the `YYYY-MM-DD` ISO date pattern.
