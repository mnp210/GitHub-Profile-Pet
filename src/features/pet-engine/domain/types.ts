/**
 * GitHub Profile Pet - Pet Engine Domain Types
 * Strictly implements Sprint 2.7.4 GitHub-Native Specification
 */

export type PetSpecies =
  | 'cat'
  | 'dragon'
  | 'fox'
  | 'slime'
  | 'shadow_claw'
  | 'ignis_ember'
  | 'kitsune_sol'
  | 'bloop_matrix';

export type PetMood = 'Energetic' | 'Happy' | 'Focused' | 'Curious' | 'Resting';

export type EvolutionStage = 'Hatchling' | 'Juvenile' | 'Ascended' | 'Celestial';

export interface PetStateDocument {
  schemaVersion: number;
  generation: number;
  name: string;
  species: PetSpecies;
  level: number;
  xp: number;
  maxExp: number;
  energy: number;     // Clamped integer 0-100
  energyAccumulator: number; // Persistent fractional recovery accumulator in [0, 1)
  hunger: number;     // Clamped integer 0-100 (represents satiety)
  hungerDecayAccumulator?: number;    // Persistent fractional decay accumulator in [0, 1)
  happiness: number;  // Clamped 0-100
  happinessDecayAccumulator?: number; // Persistent fractional decay accumulator in [0, 1)
  mood: PetMood;
  evolutionStage: EvolutionStage;
  lastInteractionTime: string;      // ISO-8601 UTC
  lastOfflineResolutionTime: string; // ISO-8601 UTC
  lastSimulatedAt?: string;          // ISO-8601 UTC (Phase 3C1 durable simulation checkpoint)
  lastWelcomeBonusClaimedAt: string | null; // ISO-8601 UTC or null
  updatedAt: string;                // ISO-8601 UTC
}

export type SliceStatus = 'rewarded' | 'forfeited' | 'pending' | 'expired';

export interface ContributionSlice {
  sliceId: string;
  syncDate: string;        // YYYY-MM-DD UTC
  discoveredAt: string;    // ISO-8601 UTC
  units: number;           // Observed units in this slice
  status: SliceStatus;
  rewardedXp: number;
  rewardedSatiety: number;
  expiryAt: string;        // ISO-8601 UTC (syncDate midnight + 48h)
  evaluatedAt: string;     // ISO-8601 UTC
}

export interface MonthlyHistoricalSummary {
  month: string;           // YYYY-MM
  totalObservedUnits: number;
  rewardedUnits: number;
  forfeitedUnits: number;
  expiredUnits: number;
  rewardedXp: number;
}

export interface ContributionLedgerDocument {
  schemaVersion: number;
  generation: number;
  monotonicPublicHwm: number;
  dailyAccruedXp: Record<string, number>;    // YYYY-MM-DD -> XP accrued
  hourlySliceUsage: Record<string, number>;  // YYYY-MM-DDTHH -> slices rewarded
  slices: ContributionSlice[];
  monthlyHistoricalSummary: MonthlyHistoricalSummary[];
}

export type CareActionType = 'feed' | 'train' | 'rest' | 'pet';

export interface RecentActionEntry {
  action: CareActionType;
  timestamp: number; // UTC ms
  requestId: string; // e.g. "issue-42"
}

export interface ProcessedRequestRegistry {
  highWaterIssueNumber: number;
  sparseProcessedIssueNumbers: number[];
  retiredNonActionGaps: number[];
  unresolvedGaps: number[];
}

export interface ActionLedgerDocument {
  schemaVersion: number;
  generation: number;
  recentActions: RecentActionEntry[];
  processedRequestRegistry: ProcessedRequestRegistry;
}

export type ClassificationType =
  | 'retired_pr'
  | 'retired_non_pet_issue'
  | 'active_or_processed_pet_action'
  | 'retired_deleted_410'
  | 'unresolved_ambiguous_404'
  | 'unresolved_rate_limited'
  | 'unresolved_server_error'
  | 'unresolved_incomplete_pagination';

export interface GapClassificationResult {
  classification: ClassificationType;
  isEligibleForHwmAdvancement: boolean;
  targetRegistryCollection: 'retiredNonActionGaps' | 'sparseProcessedIssueNumbers' | 'unresolvedGaps';
  rationale: string;
}

export interface TransitionOutcome {
  success: boolean;
  rejectedReason?: string;
  reaction: string;
  xpGained: number;
  didLevelUp: boolean;
  levelsGained: number;
  diminishingMultiplier: number;
}
