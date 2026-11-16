// tests/pet-engine/dependencyIsolation.test.ts
// Dependency boundary verification suite demonstrating zero transitive coupling to legacy database dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

function extractLocalImports(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  // Match both single-line and multi-line import/export statements
  const importRegex = /(?:import|export)\s+[\s\S]*?from\s+['"](.*?)['"]/g;
  const rawImports: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(content)) !== null) {
    rawImports.push(m[1]);
  }
  return rawImports;
}

interface TransitiveTrace {
  visitedFiles: string[];
  externalPackages: string[];
  dbReferences: string[];
}

function traceTransitiveDependencies(entryFilePath: string, repoRoot: string): TransitiveTrace {
  const visited = new Set<string>();
  const externalPackages = new Set<string>();
  const dbReferences: string[] = [];

  function traverse(currentPath: string, chain: string[]): void {
    const resolvedPath = path.resolve(currentPath);
    if (visited.has(resolvedPath)) return;
    visited.add(resolvedPath);

    const relPath = path.relative(repoRoot, resolvedPath).replace(/\\/g, '/');

    // Check if path penetrates legacy database or centralized sync boundaries
    if (relPath.includes('src/lib/db') || relPath.includes('src/lib/sync')) {
      dbReferences.push(`${relPath} (via chain: ${chain.concat(relPath).join(' -> ')})`);
    }

    const currentDir = path.dirname(resolvedPath);
    const imports = extractLocalImports(resolvedPath);

    for (const imp of imports) {
      if (imp.startsWith('.')) {
        let target = path.resolve(currentDir, imp);
        if (!target.endsWith('.ts') && !target.endsWith('.js') && !target.endsWith('.json')) {
          if (fs.existsSync(target + '.ts')) target = target + '.ts';
          else if (fs.existsSync(target + '/index.ts')) target = target + '/index.ts';
        }
        traverse(target, chain.concat(relPath));
      } else if (!imp.startsWith('node:')) {
        externalPackages.add(imp);
      }
    }
  }

  traverse(entryFilePath, []);

  return {
    visitedFiles: Array.from(visited),
    externalPackages: Array.from(externalPackages),
    dbReferences,
  };
}

describe('GitHub Contribution Diagnostic — Dependency Isolation Suite (Phase 3C2.1-V.5.1)', () => {
  const repoRoot = process.cwd();
  const probeScriptPath = path.join(repoRoot, 'scripts', 'probe-github-contributions.ts');
  const contributionIndexPath = path.join(repoRoot, 'src', 'features', 'pet-engine', 'contribution', 'index.ts');

  it('verifies probe script dependency tree contains zero legacy DB modules', () => {
    const trace = traceTransitiveDependencies(probeScriptPath, repoRoot);

    assert.strictEqual(
      trace.dbReferences.length,
      0,
      `Expected zero references to legacy db or sync modules, but found:\n${trace.dbReferences.join('\n')}`
    );

    assert.ok(
      !trace.externalPackages.includes('pg'),
      `Transitive dependency tree must not contain package 'pg'`
    );

    // Verify all visited files are strictly under scripts/ or src/features/pet-engine/contribution/
    for (const file of trace.visitedFiles) {
      const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
      const isAllowed =
        rel.startsWith('scripts/probe-github-contributions.ts') ||
        rel.startsWith('src/features/pet-engine/contribution/');

      assert.ok(
        isAllowed,
        `Unexpected file in probe script dependency tree: ${rel}`
      );
    }
  });

  it('verifies contribution package entry point index.ts contains zero legacy DB modules', () => {
    const trace = traceTransitiveDependencies(contributionIndexPath, repoRoot);

    assert.strictEqual(
      trace.dbReferences.length,
      0,
      `Expected zero db references in contribution package, but found:\n${trace.dbReferences.join('\n')}`
    );

    assert.ok(
      !trace.externalPackages.includes('pg'),
      `Contribution package must not depend on package 'pg'`
    );
  });

  it('verifies probe script starts in Node 22 without ERR_MODULE_NOT_FOUND', () => {
    // When run without GITHUB_TOKEN, the script must reach process.env.GITHUB_TOKEN validation
    // and exit with code 1 after logging the missing token error, rather than crashing on module resolution.
    try {
      execFileSync(
        process.execPath,
        ['--experimental-strip-types', probeScriptPath],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            GITHUB_TOKEN: '',
          },
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      assert.fail('Probe script should exit with code 1 when GITHUB_TOKEN is omitted');
    } catch (err: unknown) {
      const execError = err as { status: number; stderr: string; stdout: string };
      assert.strictEqual(execError.status, 1);
      assert.ok(
        !execError.stderr.includes('ERR_MODULE_NOT_FOUND'),
        `Probe script failed with ERR_MODULE_NOT_FOUND:\n${execError.stderr}`
      );
      assert.ok(
        !execError.stderr.includes('Cannot find package'),
        `Probe script failed to find package:\n${execError.stderr}`
      );
      assert.ok(
        execError.stderr.includes('GITHUB_TOKEN environment variable is required'),
        `Expected missing GITHUB_TOKEN error message, got:\n${execError.stderr}`
      );
    }
  });
});
