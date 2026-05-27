import type { GraphDiff, ImpactSummary } from '@codedelta/types';

/**
 * Phase 2 TODO: score commit impact from graph diff — changed symbols,
 * edge changes, affected entry points, risk tags.
 */
export function computeImpactScore(
  commitHash: string,
  _diff: GraphDiff,
): ImpactSummary {
  return {
    commitHash,
    score: 0,
    changedSymbols: 0,
    changedEdges: 0,
    affectedModules: [],
    impactedEntryPoints: [],
    riskTags: [],
  };
}
