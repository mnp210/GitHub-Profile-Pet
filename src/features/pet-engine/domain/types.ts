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

export type ForfeitureReason = 'daily_cap_exhausted' | 'whole_increment_overflow';

export interface InstallationBaselineMetadata {
  completed: boolean;
  installedAt: string;     // ISO-8601 UTC
  baselineDateUtc: string; // YYYY-MM-DD UTC
  initialCounts: {
    yesterday: number;
    today: number;
  };
}

export interface SyncReceipt {
  timestamp: string;       // ISO-8601 UTC
  status: 'success' | 'noop' | 'provider_failure' | 'rate_limited';
  incrementsProcessed: number;
  notes?: string;
}

export interface ContributionSlice {
  sliceId: string;
  syncDate: string;        // YYYY-MM-DD UTC
  dailyOrdinal?: number;   // 1-based sequential increment ordinal within syncDate
  discoveredAt: string;    // ISO-8601 UTC
  units: number;           // Observed units in this slice (strictly 1 for Phase 3C2 increments)
  status: SliceStatus;
  rewardedXp: number;
  rewardedSatiety: number;
  expiryAt: string;        // ISO-8601 UTC (syncDate midnight + 48h)
  evaluatedAt: string | null; // ISO-8601 UTC or null if not yet evaluated
  forfeitureReason?: ForfeitureReason;
}

export interface MonthlyHistoricalSummary {
  month: string;           // YYYY-MM
  totalObservedUnits: number;
  rewardedUnits: number;
  forfeitedUnits: number;
  expiredUnits: number;
  rewardedXp: number;
  rewardedSatiety?: number;
}

export interface ContributionLedgerDocument {
  schemaVersion: number;
  generation: number;
  ownerDatabaseId?: number;
  ownerLogin?: string;
  installationBaseline?: InstallationBaselineMetadata;
  dailyHwm?: Record<string, number>;           // YYYY-MM-DD -> peak public contribution count
  dailyRewardOrdinal?: Record<string, number>;  // YYYY-MM-DD -> monotonic post-installation ordinal counter
  lastSyncReceipt?: SyncReceipt;
  dailyAccruedXp: Record<string, number>;      // YYYY-MM-DD -> XP accrued (max 300)
  hourlyIncrementUsage?: Record<string, number>; // YYYY-MM-DDTHH -> evaluated increments (max 5)
  hourlySliceUsage?: Record<string, number>;    // Legacy backward-compat: YYYY-MM-DDTHH -> slices rewarded
  monotonicPublicHwm?: number;                 // Legacy backward-compat: scalar lifetime HWM
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

export interface ActionFeedbackRecord {
  issueNumber: number;
  requestId: string;
  actionType?: CareActionType;
  status: 'accepted' | 'rejected' | 'quarantined' | 'duplicate' | 'deferred';
  generation: number;
  completedAt: string;
  feedbackDelivered: boolean;
  feedbackMarker: string;
  feedbackBody: string;
  targetLabel?: string;
  deliveredAt?: string;
  closureConfirmed?: boolean;
}

export interface ActionLedgerDocument {
  schemaVersion: number;
  generation: number;
  recentActions: RecentActionEntry[];
  processedRequestRegistry: ProcessedRequestRegistry;
  pendingFeedback?: ActionFeedbackRecord[];
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
