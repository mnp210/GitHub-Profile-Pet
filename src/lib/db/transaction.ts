// src/lib/db/transaction.ts
// Atomic PostgreSQL transaction management with guaranteed rollback and client release

import type { PoolClient } from 'pg';
import { getPool } from './pool.ts';
import { wrapDatabaseError } from './errors.ts';

export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

/**
 * Executes a callback within a managed PostgreSQL transaction.
 * Automatically handles BEGIN, COMMIT, ROLLBACK on error, and client release.
 */
export async function withTransaction<T>(
  callback: TransactionCallback<T>,
  existingClient?: PoolClient
): Promise<T> {
  // If an existing transaction client is supplied, reuse it without a new BEGIN/COMMIT block
  if (existingClient) {
    try {
      return await callback(existingClient);
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[Database Transaction] Rollback failure:', (rollbackError as Error).message);
    }
    throw wrapDatabaseError(error);
  } finally {
    client.release();
  }
}
