/**
 * GitHub Profile Pet - Activity Multi-Document Transaction Journal
 *
 * Guarantees atomic, crash-safe persistence across pet.json, activity.json,
 * and activity_archive.json.
 *
 * Protocol:
 * 1. Prepare: Stage all modified documents into `.activity_tx/staged/`.
 * 2. Commit Point: Atomically write `tx.json` with `status: "committed"`.
 * 3. Apply: Rename each staged document to its destination path.
 * 4. Cleanup: Remove `.activity_tx/`.
 *
 * Crash Recovery:
 * - Crash during Prepare (no tx.json or status !== 'committed'):
 *     Roll back: remove `.activity_tx/`. All source files remain 100% untouched.
 * - Crash during Apply (status === 'committed'):
 *     Roll forward: complete the pending renames and remove `.activity_tx/`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ActivityTxEntry {
  targetPath: string;
  data: unknown;
}

export interface ActivityTxManifest {
  txId: string;
  status: 'preparing' | 'committed';
  files: string[];
  timestamp: string;
}

export const ACTIVITY_TX_DIR = 'pet/ledger/.activity_tx';

/**
 * Checks for and recovers any pending transaction from an interrupted run.
 * Completely idempotent.
 */
export async function recoverActivityTransaction(baseDir: string): Promise<boolean> {
  const txDir = path.join(baseDir, ACTIVITY_TX_DIR);
  const txMetaPath = path.join(txDir, 'tx.json');
  const stagedDir = path.join(txDir, 'staged');

  try {
    const raw = await fs.readFile(txMetaPath, 'utf-8');
    const meta = JSON.parse(raw) as ActivityTxManifest;

    if (meta.status === 'committed') {
      // Roll forward: finish applying any staged files
      for (const targetRelPath of meta.files) {
        const stagedPath = path.join(stagedDir, targetRelPath);
        const finalPath = path.join(baseDir, targetRelPath);

        try {
          await fs.access(stagedPath);
          await fs.mkdir(path.dirname(finalPath), { recursive: true });
          await fs.rename(stagedPath, finalPath);
        } catch {
          // If already moved, continue
        }
      }
    }
  } catch {
    // If tx.json does not exist or is unparseable, this was uncommitted
  }

  // Cleanup transaction directory
  try {
    await fs.rm(txDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Executes an atomic multi-document transaction across state, ledger, and archive files.
 */
export async function executeActivityTransaction(
  baseDir: string,
  entries: ActivityTxEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  const txDir = path.join(baseDir, ACTIVITY_TX_DIR);
  const stagedDir = path.join(txDir, 'staged');
  const txMetaPath = path.join(txDir, 'tx.json');

  // Clean any stale transaction directory first
  await recoverActivityTransaction(baseDir);

  await fs.mkdir(stagedDir, { recursive: true });

  const relFilePaths: string[] = [];

  // 1. Stage all documents
  for (const entry of entries) {
    const relPath = path.relative(baseDir, entry.targetPath).replace(/\\/g, '/');
    relFilePaths.push(relPath);

    const stagedPath = path.join(stagedDir, relPath);
    await fs.mkdir(path.dirname(stagedPath), { recursive: true });
    const tempStaged = `${stagedPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;

    const serialized = JSON.stringify(entry.data, null, 2) + '\n';
    await fs.writeFile(tempStaged, serialized, 'utf-8');
    await fs.rename(tempStaged, stagedPath);
  }

  // 2. Atomic Commit Point: Write tx.json with status: "committed"
  const manifest: ActivityTxManifest = {
    txId: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'committed',
    files: relFilePaths,
    timestamp: new Date().toISOString(),
  };

  const tempMeta = `${txMetaPath}.tmp`;
  await fs.writeFile(tempMeta, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  await fs.rename(tempMeta, txMetaPath);

  // 3. Apply: Rename staged files to final destination paths
  for (const entry of entries) {
    const relPath = path.relative(baseDir, entry.targetPath).replace(/\\/g, '/');
    const stagedPath = path.join(stagedDir, relPath);
    await fs.mkdir(path.dirname(entry.targetPath), { recursive: true });
    await fs.rename(stagedPath, entry.targetPath);
  }

  // 4. Cleanup transaction directory
  await fs.rm(txDir, { recursive: true, force: true }).catch(() => {});
}
