/**
 * GitHub Profile Pet - Atomic File Writer
 * Writes files using temporary files and atomic renames to prevent partial or corrupted file writes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function atomicWriteFile(
  targetPath: string,
  content: string
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const randomSuffix = Math.random().toString(36).substring(2, 9);
  const tempPath = `${targetPath}.${Date.now()}.${randomSuffix}.tmp`;

  try {
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup error if temp file was not created
    }
    throw error;
  }
}
