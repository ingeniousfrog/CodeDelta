import { describe, expect, it } from 'vitest';
import type { GraphDiff, ImpactSummary } from '@codedelta/types';
import { buildDeltaSummary } from '../src';

const diff: GraphDiff = {
  baseCommit: 'a',
  headCommit: 'b',
  addedNodes: [
    {
      id: 'src/auth/login.ts::login',
      kind: 'function',
      name: 'login',
      qualifiedName: 'src/auth/login.ts::login',
      filePath: 'src/auth/login.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 20,
    },
  ],
  removedNodes: [],
  modifiedNodes: [],
  addedEdges: [],
  removedEdges: [],
  affectedNodeIds: ['src/auth/login.ts::login'],
  changedFiles: [{ path: 'src/auth/login.ts', status: 'modified' }],
  summary: {
    symbolsAdded: 1,
    symbolsRemoved: 0,
    symbolsModified: 0,
    edgesAdded: 0,
    edgesRemoved: 0,
  },
};

const impact: ImpactSummary = {
  commitHash: 'b',
  score: 30,
  changedSymbols: 1,
  changedEdges: 0,
  affectedModules: ['src/auth'],
  impactedEntryPoints: [],
  riskTags: ['auth'],
};

describe('buildDeltaSummary', () => {
  it('builds deterministic summary sections', () => {
    const summary = buildDeltaSummary(diff, impact);
    expect(summary.metrics.changedFiles).toBe(1);
    expect(summary.metrics.changedSymbols).toBe(1);
    expect(summary.mainAreas[0]?.name).toBe('src/auth');
    expect(summary.risks[0]?.tag).toBe('auth');
    expect(summary.reviewOrder[0]?.file).toBe('src/auth/login.ts');
  });
});
