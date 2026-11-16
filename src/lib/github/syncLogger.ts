// src/lib/github/syncLogger.ts
// Privacy-safe structured logging for GitHub sync requests, retry cycles, and reconciliation outcomes

import { redactSensitiveData } from './graphqlClient.ts';

export interface SyncLogContext {
  correlationId?: string;
  userId?: string;
  requestSequence?: number | null;
  attempt?: number;
  failureCategory?: string;
  statusCode?: number;
  rateLimit?: {
    kind: 'primary' | 'secondary';
    resetAt?: string | null;
    retryAfterSeconds?: number | null;
  };
  reconciliationOutcome?: {
    highWaterMark: number;
    newlyObserved: number;
    rewarded: number;
    forfeited: number;
    pending: number;
    xpAwarded: number;
  };
  transactionStatus?: 'committed' | 'rolled_back';
  apiStatus?: number;
  apiErrorCode?: string;
  [key: string]: unknown;
}

export type LogLevel = 'info' | 'warn' | 'error';
export type LogHandler = (level: LogLevel, event: string, context?: SyncLogContext) => void;

let customLogHandler: LogHandler | null = null;

export function setSyncLogHandler(handler: LogHandler | null): void {
  customLogHandler = handler;
}

function sanitizeContext(context?: SyncLogContext): SyncLogContext | undefined {
  if (!context) return undefined;
  const sanitized: SyncLogContext = {};

  for (const [key, val] of Object.entries(context)) {
    if (typeof val === 'string') {
      sanitized[key] = redactSensitiveData(val);
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = JSON.parse(redactSensitiveData(JSON.stringify(val)));
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

function defaultLogHandler(level: LogLevel, event: string, context?: SyncLogContext): void {
  const sanitized = sanitizeContext(context);
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    event,
    ...sanitized,
  };

  const line = `[ContributionSync] ${JSON.stringify(entry)}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    // Info logs can be enabled in production or silenced in quiet test runs
    if (process.env.DEBUG_SYNC === 'true') {
      console.log(line);
    }
  }
}

export const syncLogger = {
  info(event: string, context?: SyncLogContext): void {
    if (customLogHandler) {
      customLogHandler('info', event, sanitizeContext(context));
    } else {
      defaultLogHandler('info', event, context);
    }
  },

  warn(event: string, context?: SyncLogContext): void {
    if (customLogHandler) {
      customLogHandler('warn', event, sanitizeContext(context));
    } else {
      defaultLogHandler('warn', event, context);
    }
  },

  error(event: string, context?: SyncLogContext): void {
    if (customLogHandler) {
      customLogHandler('error', event, sanitizeContext(context));
    } else {
      defaultLogHandler('error', event, context);
    }
  },
};
