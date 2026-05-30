import { describe, expect, it } from 'vitest';
import type { PanoramaGraph } from '@codedelta/types';
import { buildPanoramaSvg } from '../../apps/web/src/lib/panorama-export';

function sampleGraph(): PanoramaGraph {
  return {
    repoId: 'r1',
    commit: 'abc1234567890',
    commitShortHash: 'abc1234',
    nodes: [
      {
        id: 'n1',
        kind: 'route',
        name: 'GET /',
        qualifiedName: 'GET /',
        filePath: 'src/app.ts',
        startLine: 1,
        endLine: 5,
        commitShortHash: 'abc1234',
        role: 'entry',
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2',
        kind: 'function',
        name: 'handler',
        qualifiedName: 'handler',
        filePath: 'src/app.ts',
        startLine: 10,
        endLine: 20,
        commitShortHash: 'abc1234',
        role: 'leaf',
        position: { x: 0, y: 240 },
      },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2', kind: 'calls' }],
    entryPoints: ['n1'],
    layout: 'layered',
    stats: { nodeCount: 2, edgeCount: 1, truncated: false },
  };
}

describe('buildPanoramaSvg', () => {
  it('produces valid SVG with nodes and edges', () => {
    const svg = buildPanoramaSvg(sampleGraph());
    expect(svg).toContain('<svg');
    expect(svg).toContain('GET /');
    expect(svg).toContain('<path');
    expect(svg).toContain('CodeDelta Panorama');
  });

  it('scales layout when renderScale is set', () => {
    const base = buildPanoramaSvg(sampleGraph());
    const scaled = buildPanoramaSvg(sampleGraph(), { renderScale: 2 });
    const baseW = base.match(/width="(\d+)"/)?.[1];
    const scaledW = scaled.match(/width="(\d+)"/)?.[1];
    expect(Number(scaledW)).toBeGreaterThan(Number(baseW));
  });
});
