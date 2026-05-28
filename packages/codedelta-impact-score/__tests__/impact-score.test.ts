import { describe, expect, it } from 'vitest';
import type { CodeGraphSnapshot, GraphDiff } from '@codedelta/types';
import { __private, computeImpactScore } from '../src';

function minimalDiff(overrides: Partial<GraphDiff> = {}): GraphDiff {
  return {
    baseCommit: 'base',
    headCommit: 'head',
    addedNodes: [],
    removedNodes: [],
    modifiedNodes: [],
    addedEdges: [],
    removedEdges: [],
    affectedNodeIds: [],
    changedFiles: [],
    summary: {
      symbolsAdded: 0,
      symbolsRemoved: 0,
      symbolsModified: 0,
      edgesAdded: 0,
      edgesRemoved: 0,
    },
    ...overrides,
  };
}

function makeHeadSnapshot(totalNodes = 300): CodeGraphSnapshot {
  return {
    repoId: 'r',
    commitHash: 'head',
    analyzerVersion: 'test',
    createdAt: new Date().toISOString(),
    nodeCount: totalNodes,
    edgeCount: 0,
    files: [],
    nodes: Array.from({ length: totalNodes }, (_, i) => ({
      id: `n${i}`,
      kind: i < 40 ? 'function' : i < 70 ? 'component' : 'method',
      name: `node${i}`,
      qualifiedName: `q.node${i}`,
      filePath: i < 100 ? `src/mod${i % 10}/file.ts` : `src/core/file${i}.ts`,
      language: 'typescript',
      startLine: 1,
      endLine: 2,
      isExported: i < 40,
    })),
    edges: [],
  };
}

describe('computeImpactScore', () => {
  it('returns higher score for more changes', () => {
    const head = makeHeadSnapshot();
    const low = computeImpactScore('head', minimalDiff());
    const high = computeImpactScore(
      'head',
      minimalDiff({
        changedFiles: [{ path: 'src/auth/login.ts', status: 'modified' }],
        addedNodes: [
          {
            id: 'src/auth/login.ts::handleLogin',
            kind: 'function',
            name: 'handleLogin',
            qualifiedName: 'src/auth/login.ts::handleLogin',
            filePath: 'src/auth/login.ts',
            language: 'typescript',
            startLine: 1,
            endLine: 20,
          },
        ],
        summary: {
          symbolsAdded: 1,
          symbolsRemoved: 0,
          symbolsModified: 0,
          edgesAdded: 2,
          edgesRemoved: 0,
        },
        affectedNodeIds: ['src/auth/login.ts::handleLogin'],
      }),
      head,
    );
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('detects auth risk tag from paths', () => {
    const diff = minimalDiff({
      changedFiles: [{ path: 'src/auth/session.ts', status: 'modified' }],
      addedNodes: [
        {
          id: 'src/auth/session.ts::refresh',
          kind: 'function',
          name: 'refresh',
          qualifiedName: 'src/auth/session.ts::refresh',
          filePath: 'src/auth/session.ts',
          language: 'typescript',
          startLine: 1,
          endLine: 5,
        },
      ],
      summary: { symbolsAdded: 1, symbolsRemoved: 0, symbolsModified: 0, edgesAdded: 0, edgesRemoved: 0 },
    });
    const impact = computeImpactScore('head', diff);
    expect(impact.riskTags).toContain('auth');
  });

  it('clamps score to 0-100', () => {
    const diff = minimalDiff({
      changedFiles: Array.from({ length: 50 }, (_, i) => ({
        path: `src/f${i}.ts`,
        status: 'modified' as const,
      })),
      summary: {
        symbolsAdded: 100,
        symbolsRemoved: 100,
        symbolsModified: 50,
        edgesAdded: 200,
        edgesRemoved: 200,
      },
      affectedNodeIds: Array.from({ length: 500 }, (_, i) => `n${i}`),
    });
    const impact = computeImpactScore('head', diff);
    expect(impact.score).toBeLessThanOrEqual(100);
    expect(impact.score).toBeGreaterThanOrEqual(0);
  });

  it('provides explanation and severity label', () => {
    const head = makeHeadSnapshot();
    const impact = computeImpactScore(
      'head',
      minimalDiff({
        changedFiles: [{ path: 'src/api/routes.ts', status: 'modified' }],
        summary: {
          symbolsAdded: 30,
          symbolsRemoved: 10,
          symbolsModified: 20,
          edgesAdded: 40,
          edgesRemoved: 20,
        },
        affectedNodeIds: Array.from({ length: 50 }, (_, i) => `n${i}`),
      }),
      head,
    );
    expect(impact.explanation).toBeDefined();
    expect(impact.explanation?.reasons.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high', 'critical']).toContain(impact.explanation?.severity);
  });

  it('does not saturate to 100 for medium-large diffs', () => {
    const head = makeHeadSnapshot();
    const impact = computeImpactScore(
      'head',
      minimalDiff({
        changedFiles: [
          { path: 'README.md', status: 'modified' },
          { path: 'src-tauri/src/store/mod.rs', status: 'modified' },
        ],
        summary: {
          symbolsAdded: 80,
          symbolsRemoved: 20,
          symbolsModified: 50,
          edgesAdded: 180,
          edgesRemoved: 85,
        },
        affectedNodeIds: Array.from({ length: 157 }, (_, i) => `n${i}`),
      }),
      head,
    );
    expect(impact.score).toBeLessThan(100);
    expect(impact.score).toBeGreaterThanOrEqual(35);
  });

  it('prefers wider blast radius over same-size edit', () => {
    const head = makeHeadSnapshot(400);
    const sameChangeShape = {
      changedFiles: [{ path: 'src/core/a.ts', status: 'modified' as const }],
      summary: {
        symbolsAdded: 10,
        symbolsRemoved: 5,
        symbolsModified: 5,
        edgesAdded: 15,
        edgesRemoved: 10,
      },
    };

    const narrow = computeImpactScore(
      'head',
      minimalDiff({
        ...sameChangeShape,
        affectedNodeIds: Array.from({ length: 10 }, (_, i) => `n${i}`),
      }),
      head,
    );
    const wide = computeImpactScore(
      'head',
      minimalDiff({
        ...sameChangeShape,
        affectedNodeIds: Array.from({ length: 180 }, (_, i) => `n${i}`),
      }),
      head,
    );

    expect(wide.score).toBeGreaterThan(narrow.score);
  });

  it('maps severity thresholds correctly', () => {
    expect(__private.severityFromScore(20)).toBe('low');
    expect(__private.severityFromScore(40)).toBe('medium');
    expect(__private.severityFromScore(70)).toBe('high');
    expect(__private.severityFromScore(90)).toBe('critical');
  });
});
