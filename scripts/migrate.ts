// scripts/migrate.ts
// CLI entrypoint for running database migrations

import { migrateUp, migrateDown } from '../src/lib/db/migrator.ts';
import { closePool } from '../src/lib/db/pool.ts';

async function main() {
  const command = process.argv[2] || 'up';

  console.log(`[Database Migration] Executing command: ${command}`);

  try {
    if (command === 'up') {
      const result = await migrateUp();
      console.log(`[Database Migration] Migrations applied (${result.applied.length}):`, result.applied);
      if (result.skipped.length > 0) {
        console.log(`[Database Migration] Already up to date (${result.skipped.length}):`, result.skipped);
      }
    } else if (command === 'down') {
      const result = await migrateDown();
      if (result.reverted) {
        console.log(`[Database Migration] Successfully rolled back: ${result.reverted}`);
      } else {
        console.log('[Database Migration] No migrations to revert.');
      }
    } else {
      console.error(`[Database Migration] Unknown command: "${command}". Use "up" or "down".`);
      process.exit(1);
    }
  } catch (err) {
    console.error('[Database Migration Failed]:', (err as Error).message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
