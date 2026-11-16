// src/lib/gameplay/validation.ts
// Request payload validation for gameplay care actions

import type { ActionType } from '../../features/gamification/rewards.ts';

export interface CareActionRequestPayload {
  action: ActionType;
  clientActionId: string;
}

export interface ValidationSuccess {
  valid: true;
  data: CareActionRequestPayload;
}

export interface ValidationError {
  valid: false;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationError;

const ALLOWED_ACTIONS: Set<ActionType> = new Set(['train', 'feed', 'rest', 'pet']);

/**
 * Validates incoming care action request payload.
 */
export function validateCareActionPayload(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Request body must be a valid JSON object.' };
  }

  const payload = raw as Record<string, unknown>;

  // Reject unexpected attempt to supply user identity in body
  if ('userId' in payload || 'user_id' in payload) {
    // We ignore or warn, but enforce that client cannot override user identity
  }

  if (typeof payload.action !== 'string' || !ALLOWED_ACTIONS.has(payload.action as ActionType)) {
    return {
      valid: false,
      error: `Invalid action "${payload.action}". Allowed actions are: ${Array.from(ALLOWED_ACTIONS).join(', ')}.`,
    };
  }

  if (typeof payload.clientActionId !== 'string' || payload.clientActionId.trim() === '') {
    return { valid: false, error: 'Missing or empty "clientActionId". Must be a non-empty unique string.' };
  }

  if (payload.clientActionId.length > 64) {
    return { valid: false, error: '"clientActionId" exceeds maximum length of 64 characters.' };
  }

  return {
    valid: true,
    data: {
      action: payload.action as ActionType,
      clientActionId: payload.clientActionId.trim(),
    },
  };
}
