import { buildCallTree, detectEntryPoints } from '@codedelta/graph-subgraph';
import type { CodeEdge, CodeGraphSnapshot, CodeNode } from '@codedelta/types';
import { areaForFile } from './toc';

function escapeLabel(label: string): string {
  return label.replace(/"/g, '#quot;');
}

function synthesizedBy(edge: CodeEdge): string | undefined {
  if (edge.provenance !== 'heuristic') return undefined;
  const by = edge.metadata?.synthesizedBy;
  return typeof by === 'string' ? by : 'synthesized';
}

/**
 * Module-level dependency diagram: aggregates imports/calls edges between
 * directory areas. Fully deterministic — every edge exists in the graph.
 */
export function mermaidModuleGraph(
  snapshot: CodeGraphSnapshot,
  options: { maxAreas?: number; maxEdges?: number } = {},
): string {
  const maxAreas = options.maxAreas ?? 16;
  const maxEdges = options.maxEdges ?? 30;

  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const areaWeight = new Map<string, number>();
  const edgeWeight = new Map<string, number>();

  for (const edge of snapshot.edges) {
    if (edge.kind !== 'imports' && edge.kind !== 'calls') continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const from = areaForFile(source.filePath);
    const to = areaForFile(target.filePath);
    if (from === to) continue;
    areaWeight.set(from, (areaWeight.get(from) ?? 0) + 1);
    areaWeight.set(to, (areaWeight.get(to) ?? 0) + 1);
    const key = `${from}\u0000${to}`;
    edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1);
  }

  const keptAreas = new Set(
    [...areaWeight.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxAreas)
      .map(([area]) => area),
  );

  const ids = new Map<string, string>();
  let counter = 0;
  const idFor = (area: string): string => {
    let id = ids.get(area);
    if (!id) {
      id = `a${counter++}`;
      ids.set(area, id);
    }
    return id;
  };

  const lines: string[] = ['flowchart LR'];
  const edges = [...edgeWeight.entries()]
    .filter(([key]) => {
      const [from, to] = key.split('\u0000');
      return keptAreas.has(from) && keptAreas.has(to);
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxEdges);

  if (edges.length === 0) return '';

  const declared = new Set<string>();
  for (const [key, weight] of edges) {
    const [from, to] = key.split('\u0000');
    for (const area of [from, to]) {
      const id = idFor(area);
      if (!declared.has(id)) {
        declared.add(id);
        lines.push(`  ${id}["${escapeLabel(area)}"]`);
      }
    }
    lines.push(`  ${idFor(from)} -->|"${weight}"| ${idFor(to)}`);
  }

  return lines.join('\n');
}

/**
 * Call-flow diagram from real graph edges, rooted at the given entry points.
 * Synthesized (heuristic) edges are labeled with their synthesizer.
 */
export function mermaidCallFlow(
  snapshot: CodeGraphSnapshot,
  rootIds: string[],
  options: { maxDepth?: number; maxNodes?: number } = {},
): string {
  const maxDepth = options.maxDepth ?? 2;
  const maxNodes = options.maxNodes ?? 36;

  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const includedNodes = new Set<string>();
  const includedEdges: CodeEdge[] = [];
  const seenEdge = new Set<string>();

  for (const rootId of rootIds) {
    if (includedNodes.size >= maxNodes) break;
    const tree = buildCallTree(snapshot, rootId, {
      maxDepth,
      maxNodes: Math.max(8, Math.floor(maxNodes / Math.max(1, rootIds.length))),
    });
    for (const id of tree.nodeIds) {
      if (includedNodes.size >= maxNodes) break;
      includedNodes.add(id);
    }
    for (const edge of tree.edges) {
      const key = `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;
      if (seenEdge.has(key)) continue;
      if (!includedNodes.has(edge.source) || !includedNodes.has(edge.target)) continue;
      seenEdge.add(key);
      includedEdges.push(edge);
    }
  }

  if (includedNodes.size === 0 || includedEdges.length === 0) return '';

  const ids = new Map<string, string>();
  let counter = 0;
  const idFor = (nodeId: string): string => {
    let id = ids.get(nodeId);
    if (!id) {
      id = `n${counter++}`;
      ids.set(nodeId, id);
    }
    return id;
  };

  const label = (node: CodeNode): string => escapeLabel(node.name || node.qualifiedName);

  const lines: string[] = ['flowchart TD'];
  for (const nodeId of includedNodes) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    lines.push(`  ${idFor(nodeId)}["${label(node)}"]`);
  }
  for (const edge of includedEdges) {
    const synth = synthesizedBy(edge);
    const edgeLabel = synth ? `${edge.kind} · ${synth}` : edge.kind;
    lines.push(`  ${idFor(edge.source)} -->|"${escapeLabel(edgeLabel)}"| ${idFor(edge.target)}`);
  }

  return lines.join('\n');
}

/** Architecture diagram: call flow from the snapshot's detected entry points. */
export function mermaidArchitecture(
  snapshot: CodeGraphSnapshot,
  options: { entryLimit?: number; maxDepth?: number; maxNodes?: number } = {},
): string {
  const roots = detectEntryPoints(snapshot, { limit: options.entryLimit ?? 6 });
  if (roots.length === 0) return '';
  return mermaidCallFlow(snapshot, roots, {
    maxDepth: options.maxDepth ?? 2,
    maxNodes: options.maxNodes ?? 36,
  });
}
