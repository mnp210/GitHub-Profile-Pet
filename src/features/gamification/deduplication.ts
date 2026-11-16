/**
 * Dual-Layer Ingestion Deduplication Engine
 *
 * Layer 1 (Transport Layer):
 * Deduplicates raw delivery packets using X-GitHub-Delivery UUID for webhooks.
 *
 * Layer 2 (Reward Layer):
 * Deduplicates activity awards using canonical activity identities:
 * Independent of whether activity arrived via webhook or background GraphQL polling.
 */

export interface CommitActivityPayload {
  type: 'commit';
  userId: string;
  repoFullName: string; // e.g. "octocat/hello-world"
  commitSha: string;     // Full 40-char SHA
  timestamp: number;
}

export interface PrMergedActivityPayload {
  type: 'pull_request_merged';
  userId: string;
  repoFullName: string;
  prNumber: number;
  mergeCommitSha: string;
  timestamp: number;
}

export interface IssueClosedActivityPayload {
  type: 'issue_closed';
  userId: string;
  repoFullName: string;
  issueNumber: number;
  timestamp: number;
}

export type SupportedActivity =
  | CommitActivityPayload
  | PrMergedActivityPayload
  | IssueClosedActivityPayload;

/**
 * Generates deterministic canonical activity identity.
 * Format: urn:gh:<type>:<repo>:<unique_identifier>
 */
export function buildCanonicalActivityId(activity: SupportedActivity): string {
  const repo = activity.repoFullName.toLowerCase().trim();
  switch (activity.type) {
    case 'commit':
      return `urn:gh:commit:${repo}:${activity.commitSha.toLowerCase().trim()}`;
    case 'pull_request_merged':
      return `urn:gh:pr:${repo}:${activity.prNumber}:merged:${activity.mergeCommitSha.toLowerCase().trim()}`;
    case 'issue_closed':
      return `urn:gh:issue:${repo}:${activity.issueNumber}:closed`;
  }
}

export interface IngestionEvent {
  transport: 'webhook' | 'graphql_polling';
  deliveryId?: string; // Present only for webhooks (X-GitHub-Delivery)
  activity: SupportedActivity;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  canonicalActivityId: string;
  activityType: string;
  xpAwarded: number;
  satietyAwarded: number;
  transportSource: 'webhook' | 'graphql_polling';
  transportDeliveryId?: string;
  awardedAt: number;
}

export interface RewardIngestionResult {
  success: boolean;
  status: 'awarded' | 'duplicate_delivery' | 'already_awarded';
  canonicalActivityId: string;
  xpAwarded: number;
  satietyAwarded: number;
  message: string;
}

/**
 * Transactional Ingestion Processor (Simulating SQL UNIQUE(user_id, canonical_activity_id))
 */
export class ActivityRewardLedgerProcessor {
  // Layer 1: Transport delivery store (X-GitHub-Delivery)
  private processedDeliveries = new Set<string>();

  // Layer 2: Canonical reward ledger: key = `${userId}::${canonicalActivityId}`
  private rewardLedger = new Map<string, LedgerEntry>();

  /**
   * Evaluates incoming activity through dual-layer deduplication.
   */
  public ingestActivity(event: IngestionEvent, baseReward: { xp: number; satiety: number }): RewardIngestionResult {
    const { transport, deliveryId, activity } = event;
    const canonicalId = buildCanonicalActivityId(activity);

    // LAYER 1: Transport-level deduplication (Webhooks)
    if (transport === 'webhook' && deliveryId) {
      if (this.processedDeliveries.has(deliveryId)) {
        return {
          success: false,
          status: 'duplicate_delivery',
          canonicalActivityId: canonicalId,
          xpAwarded: 0,
          satietyAwarded: 0,
          message: `Ignored duplicate webhook delivery (X-GitHub-Delivery: ${deliveryId}).`,
        };
      }
      this.processedDeliveries.add(deliveryId);
    }

    // LAYER 2: Canonical reward-level deduplication (Enforcing Unique Constraint)
    const compositeKey = `${activity.userId}::${canonicalId}`;
    if (this.rewardLedger.has(compositeKey)) {
      return {
        success: false,
        status: 'already_awarded',
        canonicalActivityId: canonicalId,
        xpAwarded: 0,
        satietyAwarded: 0,
        message: `Activity ${canonicalId} was already rewarded for user ${activity.userId} via an earlier ingestion.`,
      };
    }

    // Atomic Insertion into Ledger
    const entry: LedgerEntry = {
      id: `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      userId: activity.userId,
      canonicalActivityId: canonicalId,
      activityType: activity.type,
      xpAwarded: baseReward.xp,
      satietyAwarded: baseReward.satiety,
      transportSource: transport,
      transportDeliveryId: deliveryId,
      awardedAt: Date.now(),
    };

    this.rewardLedger.set(compositeKey, entry);

    return {
      success: true,
      status: 'awarded',
      canonicalActivityId: canonicalId,
      xpAwarded: baseReward.xp,
      satietyAwarded: baseReward.satiety,
      message: `Successfully rewarded ${baseReward.xp} XP for canonical activity ${canonicalId}.`,
    };
  }

  public getLedgerCount(): number {
    return this.rewardLedger.size;
  }

  public getEntry(userId: string, canonicalId: string): LedgerEntry | undefined {
    return this.rewardLedger.get(`${userId}::${canonicalId}`);
  }
}
