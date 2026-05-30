import { describe, expect, it } from 'vitest';
import type { CodeGraphSnapshot } from '@codedelta/types';
import {
  buildCallTree,
  buildDeltaPanoramaGraph,
  buildPanoramaGraph,
  detectEntryPoints,
  findPath,
} from '../src';

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

describe('detectEntryPoints', () => {
  it('prefers route and component nodes', () => {
    const route = node('src/r.ts::GET /api', { kind: 'route', name: 'GET /api' });
    const comp = node('src/App.tsx::App', { kind: 'component' });
    const fn = node('src/util.ts::helper', { isExported: true });
    const snapshot = snap('c1', [fn, comp, route]);
    const entries = detectEntryPoints(snapshot);
    expect(entries[0]).toBe(route.id);
    expect(entries).toContain(comp.id);
  });

  it('includes exported functions with no callers', () => {
    const a = node('src/a.ts::main', { isExported: true });
    const b = node('src/a.ts::helper', { isExported: true });
    const snapshot = snap(
      'c1',
      [a, b],
      [{ source: a.id, target: b.id, kind: 'calls' }],
    );
    const entries = detectEntryPoints(snapshot);
    expect(entries).toContain(a.id);
    expect(entries).not.toContain(b.id);
  });
});

describe('buildCallTree', () => {
  it('expands calls up to maxDepth', () => {
    const a = node('src/a.ts::a');
    const b = node('src/a.ts::b');
    const c = node('src/a.ts::c');
    const snapshot = snap('c1', [a, b, c], [
      { source: a.id, target: b.id, kind: 'calls' },
      { source: b.id, target: c.id, kind: 'calls' },
    ]);
    const tree = buildCallTree(snapshot, a.id, { maxDepth: 2, maxNodes: 50 });
    expect(tree.nodeIds.has(c.id)).toBe(true);
    expect(tree.edges).toHaveLength(2);
  });
});

describe('findPath', () => {
  it('finds shortest call path', () => {
    const a = node('src/a.ts::a');
    const b = node('src/a.ts::b');
    const c = node('src/a.ts::c');
    const snapshot = snap('c1', [a, b, c], [
      { source: a.id, target: b.id, kind: 'calls' },
      { source: b.id, target: c.id, kind: 'calls' },
    ]);
    expect(findPath(snapshot, a.id, c.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('buildPanoramaGraph', () => {
  it('returns positioned nodes', () => {
    const route = node('src/r.ts::GET /', { kind: 'route', name: 'GET /' });
    const handler = node('src/r.ts::handler');
    const snapshot = snap('c1', [route, handler], [
      { source: route.id, target: handler.id, kind: 'references' },
    ]);
    const graph = buildPanoramaGraph('repo1', snapshot, { rootId: route.id, maxDepth: 2 });
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes[0]?.position).toBeDefined();
  });
});

describe('buildDeltaPanoramaGraph', () => {
  it('marks modified nodes in delta panorama', () => {
    const route = node('src/r.ts::GET /', { kind: 'route', name: 'GET /' });
    const handler = node('src/r.ts::handler', { endLine: 10 });
    const handlerMod = node('src/r.ts::handler', { endLine: 20 });
    const base = snap('base', [route, handler], [
      { source: route.id, target: handler.id, kind: 'references' },
    ]);
    const head = snap('head', [route, handlerMod], [
      { source: route.id, target: handlerMod.id, kind: 'references' },
    ]);
    const graph = buildDeltaPanoramaGraph('repo1', base, head, { rootId: route.id });
    const h = graph.nodes.find((n) => n.id === handler.id);
    expect(h?.deltaStatus).toBe('modified');
  });
});
