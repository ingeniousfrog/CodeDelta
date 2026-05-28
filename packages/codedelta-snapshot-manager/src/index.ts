import * as fs from 'fs';
import * as path from 'path';
import {
  createWorktree,
  removeWorktree,
  worktreePath,
} from '@codedelta/repo-manager';
import type { CodeGraphSnapshot } from '@codedelta/types';
import { buildCodeGraphSnapshot } from './codegraph-snapshot';
import { readAnalyzerVersion, resolveMonorepoRoot, snapshotFilePath } from './cache-paths';
import {
  SnapshotBuildError,
  SnapshotEmptyError,
  SnapshotTimeoutError,
  SnapshotTooLargeError,
} from './errors';
import { buildFallbackSnapshot } from './fallback-extractor';

export * from './errors';
export { buildFallbackSnapshot } from './fallback-extractor';
export { readAnalyzerVersion, resolveMonorepoRoot, snapshotFilePath } from './cache-paths';

export interface GetOrBuildSnapshotOptions {
  repoId: string;
  commitHash: string;
  clonePath: string;
  cacheRoot: string;
  analyzerVersion?: string;
}

function maxNodes(): number {
  return parseInt(process.env.CODEDELTA_SNAPSHOT_MAX_NODES ?? '50000', 10);
}

function timeoutMs(): number {
  return parseInt(process.env.CODEDELTA_SNAPSHOT_TIMEOUT_MS ?? '120000', 10);
}

function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SnapshotTimeoutError()), ms);
    fn()
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

export async function loadSnapshot(
  cacheRoot: string,
  repoId: string,
  commitHash: string,
  analyzerVersion: string,
): Promise<CodeGraphSnapshot | null> {
  const filePath = snapshotFilePath(cacheRoot, repoId, commitHash, analyzerVersion);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CodeGraphSnapshot;
    if (raw.analyzerVersion !== analyzerVersion) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function saveSnapshot(
  cacheRoot: string,
  snapshot: CodeGraphSnapshot,
): Promise<void> {
  const filePath = snapshotFilePath(
    cacheRoot,
    snapshot.repoId,
    snapshot.commitHash,
    snapshot.analyzerVersion,
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

function assertSnapshotSize(snapshot: CodeGraphSnapshot): void {
  const limit = maxNodes();
  if (snapshot.nodeCount > limit) {
    throw new SnapshotTooLargeError(
      `Snapshot exceeds node limit (${snapshot.nodeCount} > ${limit})`,
      snapshot.nodeCount,
    );
  }
}

async function buildFreshSnapshot(
  options: GetOrBuildSnapshotOptions,
  analyzerVersion: string,
): Promise<CodeGraphSnapshot> {
  const { repoId, commitHash, clonePath, cacheRoot } = options;
  const wtDir = worktreePath({ cacheRoot, repoId }, commitHash);

  createWorktree(clonePath, commitHash, wtDir);

  try {
    let snapshot: CodeGraphSnapshot;

    try {
      snapshot = await withTimeout(timeoutMs(), () =>
        buildCodeGraphSnapshot(wtDir, repoId, commitHash, analyzerVersion),
      );
    } catch (err) {
      if (err instanceof SnapshotTimeoutError) throw err;
      snapshot = buildFallbackSnapshot(wtDir, repoId, commitHash, analyzerVersion);
      if (err instanceof SnapshotBuildError) {
        snapshot.metadata = {
          extractionMethod: 'fallback',
          durationMs: snapshot.metadata?.durationMs,
          warnings: [
            ...(snapshot.metadata?.warnings ?? []),
            `CodeGraph failed: ${err.message}`,
          ],
        };
      }
    }

    if (snapshot.nodeCount === 0 && snapshot.files.length === 0) {
      throw new SnapshotEmptyError();
    }

    assertSnapshotSize(snapshot);
    return snapshot;
  } finally {
    removeWorktree(clonePath, wtDir);
  }
}

/**
 * Load cached snapshot or build via worktree + CodeGraph (fallback to TS/JS scan).
 */
export async function getOrBuildSnapshot(
  options: GetOrBuildSnapshotOptions,
): Promise<CodeGraphSnapshot> {
  const analyzerVersion =
    options.analyzerVersion ?? readAnalyzerVersion(resolveMonorepoRoot());

  const cached = await loadSnapshot(
    options.cacheRoot,
    options.repoId,
    options.commitHash,
    analyzerVersion,
  );
  if (cached) return cached;

  try {
    const snapshot = await buildFreshSnapshot(options, analyzerVersion);
    await saveSnapshot(options.cacheRoot, snapshot);
    return snapshot;
  } catch (err) {
    // Warm-up race guard: first compare can transiently fail on cold parser/runtime init.
    // Retry once before surfacing an error.
    if (err instanceof SnapshotEmptyError || err instanceof SnapshotTimeoutError) {
      const snapshot = await buildFreshSnapshot(options, analyzerVersion);
      await saveSnapshot(options.cacheRoot, snapshot);
      return snapshot;
    }
    throw err;
  }
}
