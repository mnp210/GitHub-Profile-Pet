// src/lib/db/types.ts
// Database row types and entity representations

export interface GitHubAccountRow {
  id: string;
  github_user_id: string;
  username: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expires_at: Date | null;
  refresh_expires_at: Date | null;
  has_private_contributions_scope: boolean;
  is_disconnected: boolean;
  token_refresh_locked_at?: Date | null;
  token_refresh_owner?: string | null;
  token_version?: number;
  token_refresh_status?: 'idle' | 'dispatched' | 'ambiguous';
  token_refresh_dispatched_at?: Date | null;
  token_refresh_dispatched_version?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserRow {
  id: string;
  github_account_id: string;
  primary_handle: string;
  role: 'trainer' | 'admin';
  is_suspended: boolean;
  next_snapshot_sequence?: number;
  created_at: Date;
  updated_at: Date;
}

export interface UserProfileRow {
  id: string;
  user_id: string;
  display_name: string;
  bio: string;
  timezone: string;
  visibility: 'public' | 'unlisted' | 'minimal';
  show_streak: boolean;
  show_vitals: boolean;
  preferred_theme: string;
  sync_private_contributions: boolean;
  updated_at: Date;
}

export interface PetStateRow {
  id: string;
  user_id: string;
  species: string;
  name: string;
  level: number;
  xp: number;
  max_exp: number;
  evolution_stage: string;
  mood: string;
  energy: number;
  hunger: number;
  happiness: number;
  last_interacted_at: Date;
  last_welcome_bonus_at: Date | null;
  updated_at: Date;
}

export interface ActivityRewardLedgerRow {
  id: string;
  user_id: string;
  canonical_activity_id: string;
  activity_type: string;
  xp_awarded: number;
  satiety_awarded: number;
  rule_version: number;
  awarded_at: Date;
}

export interface DailySyncStateRow {
  id: string;
  user_id: string;
  sync_date: string; // ISO date string YYYY-MM-DD
  total_contributions_recorded: number;
  latest_observed_contributions?: number;
  latest_observed_at?: Date | string | null;
  latest_request_sequence?: number;
  latest_payload_hash?: string | null;
  total_contributions_rewarded: number;
  total_contributions_forfeited: number;
  pending_contribution_increments: number;
  daily_activity_xp_awarded: number;
  hourly_window_start: Date;
  hourly_increments_processed: number;
  last_synced_at: Date;
}

export type IncrementSliceStatus = 'pending' | 'rewarded' | 'forfeited' | 'expired';

export interface ContributionIncrementSliceRow {
  id: string;
  user_id: string;
  sync_date: string | Date;
  canonical_slice_id: string;
  slice_start: number;
  slice_end: number;
  increment_count: number;
  status: IncrementSliceStatus;
  request_sequence: number;
  payload_hash?: string | null;
  created_at: Date;
  processed_at?: Date | null;
}

export interface CareActionIdempotencyRow {
  id: string;
  user_id: string;
  client_action_id: string;
  action_type: string;
  response_payload: Record<string, unknown> | null;
  executed_at: Date;
}

export interface UserSessionRow {
  id: string;
  user_id: string;
  session_token_hash: string;
  expires_at: Date;
  created_at: Date;
  last_active_at: Date;
  revoked_at: Date | null;
  ip_address: string | null;
  user_agent: string | null;
}

export interface UserAggregateDetails {
  user: UserRow;
  account: GitHubAccountRow;
  profile: UserProfileRow;
  pet: PetStateRow;
}
