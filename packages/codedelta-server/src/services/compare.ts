import { buildDeltaSummary } from '@codedelta/delta-summary';
import { computeGraphDiff } from '@codedelta/graph-diff';
import { computeImpactScore } from '@codedelta/impact-score';
import { git, getChangedFilesForRange } from '@codedelta/repo-manager';
import {
  getOrBuildSnapshot,
  readAnalyzerVersion,
  resolveMonorepoRoot,
  SnapshotBuildError,
  SnapshotEmptyError,
  SnapshotTimeoutError,
  SnapshotTooLargeError,
} from '@codedelta/snapshot-manager';
import type { CompareResponse } from '@codedelta/types';
import { RepoRegistry } from '../store/repo-registry';

export class CompareError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CompareError';
  }
}

function verifyCommit(clonePath: string, hash: string): void {
  try {
    git(['rev-parse', '--verify', hash], { cwd: clonePath });
  } catch {
    throw new CompareError(`Commit not found: ${hash}`, 404);
  }
}

export async function compareCommits(
  registry: RepoRegistry,
  repoId: string,
  baseHash: string,
  headHash: string,
): Promise<CompareResponse> {
  const ref = registry.get(repoId);
  if (!ref) {
    throw new CompareError('Repository not found', 404);
  }

  verifyCommit(ref.clonePath, baseHash);
  verifyCommit(ref.clonePath, headHash);

  const cacheRoot = registry.getCacheRoot();
  const analyzerVersion = readAnalyzerVersion(resolveMonorepoRoot());

  const snapshotOpts = {
    repoId,
    clonePath: ref.clonePath,
    cacheRoot,
    analyzerVersion,
  };

  let baseSnap;
  let headSnap;
  try {
    baseSnap = await getOrBuildSnapshot({ ...snapshotOpts, commitHash: baseHash });
    headSnap = await getOrBuildSnapshot({ ...snapshotOpts, commitHash: headHash });
  } catch (err: unknown) {
    if (err instanceof SnapshotTimeoutError) {
      throw new CompareError(err.message, 504);
    }
    if (err instanceof SnapshotTooLargeError) {
      throw new CompareError(err.message, 413);
    }
    if (err instanceof SnapshotEmptyError) {
      throw new CompareError(
        'Repository produced an empty structural graph. This can happen when fallback extraction cannot parse the language yet. Please retry compare once; if it persists, use TS/JS repo or enable full CodeGraph extraction support for this language.',
        422,
      );
    }
    if (err instanceof SnapshotBuildError) {
      throw new CompareError(`Snapshot build failed: ${err.message}`, 500);
    }
    throw new CompareError(
      `Snapshot build failed: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }

  const changedFiles = getChangedFilesForRange(ref.clonePath, baseHash, headHash);
  const graphDiff = computeGraphDiff({
    base: baseSnap,
    head: headSnap,
    changedFiles,
  });

  const impact = computeImpactScore(headHash, graphDiff, headSnap);
  const deltaSummary = buildDeltaSummary(graphDiff, impact);

  return {
    repoId,
    base: { type: 'commit', commitHash: baseHash, label: baseHash.slice(0, 7) },
    head: { type: 'commit', commitHash: headHash, label: headHash.slice(0, 7) },
    graphDiff,
    impact,
    deltaSummary,
    baseMeta: {
      nodeCount: baseSnap.nodeCount,
      edgeCount: baseSnap.edgeCount,
      extractionMethod: baseSnap.metadata?.extractionMethod ?? 'fallback',
    },
    headMeta: {
      nodeCount: headSnap.nodeCount,
      edgeCount: headSnap.edgeCount,
      extractionMethod: headSnap.metadata?.extractionMethod ?? 'fallback',
    },
  };
}
