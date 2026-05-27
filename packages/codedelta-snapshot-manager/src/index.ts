import type { CodeGraphSnapshot } from '@codedelta/types';

export interface BuildSnapshotOptions {
  repoId: string;
  commitHash: string;
  clonePath: string;
  cacheRoot: string;
  analyzerVersion: string;
}

/**
 * Phase 2 TODO: checkout commit via worktree, run CodeGraph.init + exportGraph,
 * cache under .codedelta/snapshots/<repoId>/<hash>/.
 */
export async function buildSnapshot(_options: BuildSnapshotOptions): Promise<CodeGraphSnapshot> {
  throw new Error('snapshot-manager: not implemented (Phase 2)');
}

/** Phase 2 TODO: load cached snapshot JSON if present. */
export async function loadSnapshot(
  _cacheRoot: string,
  _repoId: string,
  _commitHash: string,
  _analyzerVersion: string,
): Promise<CodeGraphSnapshot | null> {
  return null;
}

/** Phase 2 TODO: persist snapshot to cache. */
export async function saveSnapshot(
  _cacheRoot: string,
  _snapshot: CodeGraphSnapshot,
): Promise<void> {
  throw new Error('snapshot-manager: not implemented (Phase 2)');
}
