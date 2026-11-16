// src/lib/db/config.ts
// Configuration for PostgreSQL connection and pool management

export interface DatabaseConfig {
  connectionString: string;
  maxConnections: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl: boolean | { rejectUnauthorized: boolean };
}

/**
 * Masks database connection string to prevent leaking passwords in logs or traces.
 */
export function maskConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = '********';
    }
    return url.toString();
  } catch {
    return '[REDACTED_DATABASE_URL]';
  }
}

/**
 * Resolves database configuration from environment variables.
 * Bounded pool maximum is 10 connections.
 */
export function getDatabaseConfig(): DatabaseConfig {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const sslExplicit = process.env.DATABASE_SSL;
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';

  let ssl: boolean | { rejectUnauthorized: boolean } = false;

  if (isProduction || sslExplicit === 'true') {
    ssl = { rejectUnauthorized };
  }

  // Maximum connection limit bounded to 10
  const parsedMax = parseInt(process.env.DATABASE_MAX_CONNECTIONS || '10', 10);
  const maxConnections = Math.max(1, Math.min(10, isNaN(parsedMax) ? 10 : parsedMax));

  return {
    connectionString,
    maxConnections,
    idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECT_TIMEOUT_MS || '5000', 10),
    ssl,
  };
}
