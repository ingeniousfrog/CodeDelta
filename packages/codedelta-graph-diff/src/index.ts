import type { CodeGraphSnapshot, GraphDiff } from '@codedelta/types';

export interface DiffOptions {
  base: CodeGraphSnapshot;
  head: CodeGraphSnapshot;
}

/**
 * Phase 2 TODO: compare two snapshots by qualifiedName+kind (nodes)
 * and (source,target,kind) (edges); compute affected nodes via BFS.
 */
export function computeGraphDiff(_options: DiffOptions): GraphDiff {
  throw new Error('graph-diff: not implemented (Phase 2)');
}
