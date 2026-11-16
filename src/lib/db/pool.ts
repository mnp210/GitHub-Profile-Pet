// src/lib/db/pool.ts
// Bounded PostgreSQL Connection Pool Management

import pg from 'pg';
import type { PoolConfig, Pool } from 'pg';
import { getDatabaseConfig, maskConnectionString } from './config.ts';
import { wrapDatabaseError } from './errors.ts';

const { Pool: PgPool } = pg;

// Parse DATE columns (OID 1082) as raw 'YYYY-MM-DD' strings to prevent timezone shifting
pg.types.setTypeParser(1082, (val: string) => val);

let poolInstance: Pool | null = null;

/**
 * Initializes and returns the singleton connection pool.
 */
export function getPool(): Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const config = getDatabaseConfig();

  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.maxConnections,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    ssl: config.ssl,
  };

  poolInstance = new PgPool(poolConfig);

  poolInstance.on('error', (err) => {
    // Ignore routine connection drops during pool/server shutdown
    if (err.message.includes('ECONNRESET') || err.message.includes('Connection terminated')) {
      return;
    }
    console.error('[Database Pool Error] Unexpected idle client error:', err.message);
  });

  return poolInstance;
}

/**
 * Safely closes the pool and all active client connections during shutdown or tests.
 */
export async function closePool(): Promise<void> {
  if (poolInstance) {
    try {
      await poolInstance.end();
    } catch (error) {
      console.error('[Database Pool Close Error]:', (error as Error).message);
    } finally {
      poolInstance = null;
    }
  }
}

/**
 * Simple ping health-check to verify database connectivity.
 */
export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const pool = getPool();
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } finally {
      client.release();
    }
  } catch (err) {
    const wrapped = wrapDatabaseError(err);
    return { ok: false, latencyMs: Date.now() - start, error: wrapped.message };
  }
}

export { maskConnectionString };
