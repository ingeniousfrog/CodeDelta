import { describe, expect, it } from 'vitest';
import type { CodeGraphSnapshot } from '@codedelta/types';
import { computeGraphDiff } from '../src';

function snap(
  commitHash: string,
  nodes: CodeGraphSnapshot['nodes'],
  edges: CodeGraphSnapshot['edges'] = [],
): CodeGraphSnapshot {
  return {
    repoId: 'test',
    commitHash,
    analyzerVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    files: [...new Set(nodes.map((n) => n.filePath))],
  };
}

function node(
  id: string,
  overrides: Partial<CodeGraphSnapshot['nodes'][0]> = {},
): CodeGraphSnapshot['nodes'][0] {
  return {
    id,
    kind: 'function',
    name: id.split('::').pop() ?? id,
    qualifiedName: id,
    filePath: id.split('::')[0] ?? 'src/a.ts',
    language: 'typescript',
    startLine: 1,
    endLine: 10,
    ...overrides,
  };
}

describe('computeGraphDiff', () => {
  it('detects added and removed nodes', () => {
    const base = snap('base', [node('src/a.ts::foo')]);
    const head = snap('head', [node('src/a.ts::bar')]);
    const diff = computeGraphDiff({ base, head });
    expect(diff.addedNodes).toHaveLength(1);
    expect(diff.removedNodes).toHaveLength(1);
    expect(diff.addedNodes[0]?.id).toBe('src/a.ts::bar');
  });

  it('treats same semantic id with line change as modified', () => {
    const base = snap('base', [node('src/a.ts::foo', { startLine: 1, endLine: 5 })]);
    const head = snap('head', [node('src/a.ts::foo', { startLine: 1, endLine: 12 })]);
    const diff = computeGraphDiff({ base, head });
    expect(diff.modifiedNodes).toHaveLength(1);
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.modifiedNodes[0]?.changes).toContain('endLine');
  });

  it('detects edge changes', () => {
    const n1 = node('src/a.ts::a');
    const n2 = node('src/a.ts::b');
    const base = snap('base', [n1, n2], []);
    const head = snap('head', [n1, n2], [{ source: n1.id, target: n2.id, kind: 'calls' }]);
    const diff = computeGraphDiff({ base, head });
    expect(diff.addedEdges).toHaveLength(1);
    expect(diff.summary.edgesAdded).toBe(1);
  });

  it('computes affected nodes via BFS', () => {
    const a = node('src/a.ts::a');
    const b = node('src/a.ts::b');
    const c = node('src/a.ts::c');
    const base = snap('base', [a, b, c], [
      { source: b.id, target: c.id, kind: 'calls' },
    ]);
    const head = snap('head', [a, b, c], [
      { source: a.id, target: b.id, kind: 'calls' },
      { source: b.id, target: c.id, kind: 'calls' },
    ]);
    const diff = computeGraphDiff({ base, head });
    expect(diff.addedEdges.length).toBeGreaterThan(0);
    expect(diff.affectedNodeIds).toContain(a.id);
    expect(diff.affectedNodeIds).toContain(b.id);
  });
});
