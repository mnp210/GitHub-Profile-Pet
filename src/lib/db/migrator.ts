// src/lib/db/migrator.ts
// Deterministic database migration runner with schema_migrations tracking

import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import { withTransaction } from './transaction.ts';
import { getPool } from './pool.ts';

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: Date;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface RollbackResult {
  reverted: string | null;
}

/**
 * Ensures the schema_migrations tracking table exists.
 */
export async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Retrieves the list of currently applied migration names.
 */
export async function getAppliedMigrations(client: PoolClient): Promise<string[]> {
  await ensureMigrationTable(client);
  const res = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY id ASC'
  );
  return res.rows.map((row) => row.name);
}

/**
 * Runs all pending migrations in deterministic alphabetical order.
 */
export async function migrateUp(migrationsDir?: string): Promise<MigrationResult> {
  const targetDir = migrationsDir || path.resolve(process.cwd(), 'migrations');

  if (!fs.existsSync(targetDir)) {
    throw new Error(`Migrations directory not found at: ${targetDir}`);
  }

  const allFiles = fs.readdirSync(targetDir);
  const upFiles = allFiles
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);
    const existing = await getAppliedMigrations(client);
    const existingSet = new Set(existing);

    for (const file of upFiles) {
      if (existingSet.has(file)) {
        skipped.push(file);
        continue;
      }

      const filePath = path.join(targetDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      // Execute each migration and its schema_migrations record in an atomic transaction
      await withTransaction(async (txClient) => {
        await txClient.query(sql);
        await txClient.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [file]
        );
      });

      applied.push(file);
    }

    return { applied, skipped };
  } finally {
    client.release();
  }
}

/**
 * Reverts the most recently applied migration using its .down.sql script.
 */
export async function migrateDown(migrationsDir?: string): Promise<RollbackResult> {
  const targetDir = migrationsDir || path.resolve(process.cwd(), 'migrations');

  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);
    const existing = await getAppliedMigrations(client);

    if (existing.length === 0) {
      return { reverted: null };
    }

    const latestMigration = existing[existing.length - 1];
    const baseName = latestMigration.replace(/\.sql$/, '');
    const downFileName = `${baseName}.down.sql`;
    const downFilePath = path.join(targetDir, downFileName);

    if (!fs.existsSync(downFilePath)) {
      throw new Error(`Rollback script not found for ${latestMigration}: ${downFilePath}`);
    }

    const sql = fs.readFileSync(downFilePath, 'utf-8');

    await withTransaction(async (txClient) => {
      await txClient.query(sql);
      await txClient.query('DELETE FROM schema_migrations WHERE name = $1', [latestMigration]);
    });

    return { reverted: latestMigration };
  } finally {
    client.release();
  }
}
