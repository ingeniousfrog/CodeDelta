import type { ChangedFile, CodeEdge, CodeGraphSnapshot, CodeNode, GraphDiff } from '@codedelta/types';

export interface DiffOptions {
  base: CodeGraphSnapshot;
  head: CodeGraphSnapshot;
  /** Git-level file changes between commits (optional). */
  changedFiles?: ChangedFile[];
}

function nodeKey(node: CodeNode): string {
  return node.id;
}

function edgeKey(edge: CodeEdge): string {
  return `${edge.source}|${edge.target}|${edge.kind}`;
}

function detectNodeChanges(before: CodeNode, after: CodeNode): string[] {
  const changes: string[] = [];
  if (before.signature !== after.signature) changes.push('signature');
  if (before.startLine !== after.startLine) changes.push('startLine');
  if (before.endLine !== after.endLine) changes.push('endLine');
  if (before.isExported !== after.isExported) changes.push('isExported');
  if (before.name !== after.name) changes.push('name');
  return changes;
}

function buildNodeMap(nodes: CodeNode[]): Map<string, CodeNode> {
  const map = new Map<string, CodeNode>();
  for (const n of nodes) {
    map.set(nodeKey(n), n);
  }
  return map;
}

function buildEdgeMap(edges: CodeEdge[]): Map<string, CodeEdge> {
  const map = new Map<string, CodeEdge>();
  for (const e of edges) {
    map.set(edgeKey(e), e);
  }
  return map;
}

const TRAVERSAL_KINDS = new Set(['calls', 'imports']);

/**
 * BFS from changed nodes over head snapshot edges (calls + imports).
 */
export function computeAffectedNodeIds(
  head: CodeGraphSnapshot,
  changedIds: Set<string>,
): string[] {
  const adj = new Map<string, string[]>();
  for (const edge of head.edges) {
    if (!TRAVERSAL_KINDS.has(edge.kind)) continue;
    const out = adj.get(edge.source) ?? [];
    out.push(edge.target);
    adj.set(edge.source, out);
    const inList = adj.get(edge.target) ?? [];
    inList.push(edge.source);
    adj.set(edge.target, inList);
  }

  const affected = new Set<string>();
  const queue = [...changedIds];
  for (const id of queue) {
    affected.add(id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current) ?? [];
    for (const next of neighbors) {
      if (!affected.has(next)) {
        affected.add(next);
        queue.push(next);
      }
    }
  }

  return Array.from(affected).sort();
}

/**
 * Compare two graph snapshots (commit-to-commit structural delta).
 */
export function computeGraphDiff(options: DiffOptions): GraphDiff {
  const { base, head, changedFiles = [] } = options;

  const baseMap = buildNodeMap(base.nodes);
  const headMap = buildNodeMap(head.nodes);

  const addedNodes: CodeNode[] = [];
  const removedNodes: CodeNode[] = [];
  const modifiedNodes: GraphDiff['modifiedNodes'] = [];

  for (const [key, node] of headMap) {
    if (!baseMap.has(key)) {
      addedNodes.push(node);
    }
  }

  for (const [key, node] of baseMap) {
    if (!headMap.has(key)) {
      removedNodes.push(node);
    }
  }

  for (const [key, after] of headMap) {
    const before = baseMap.get(key);
    if (!before) continue;
    const changes = detectNodeChanges(before, after);
    if (changes.length > 0) {
      modifiedNodes.push({ before, after, changes });
    }
  }

  const baseEdges = buildEdgeMap(base.edges);
  const headEdges = buildEdgeMap(head.edges);

  const addedEdges: CodeEdge[] = [];
  const removedEdges: CodeEdge[] = [];

  for (const [key, edge] of headEdges) {
    if (!baseEdges.has(key)) addedEdges.push(edge);
  }
  for (const [key, edge] of baseEdges) {
    if (!headEdges.has(key)) removedEdges.push(edge);
  }

  const changedIds = new Set<string>([
    ...addedNodes.map((n) => n.id),
    ...removedNodes.map((n) => n.id),
    ...modifiedNodes.map((m) => m.after.id),
  ]);
  for (const e of addedEdges) {
    changedIds.add(e.source);
    changedIds.add(e.target);
  }
  for (const e of removedEdges) {
    changedIds.add(e.source);
    changedIds.add(e.target);
  }

  const affectedNodeIds = computeAffectedNodeIds(head, changedIds);

  return {
    baseCommit: base.commitHash,
    headCommit: head.commitHash,
    addedNodes,
    removedNodes,
    modifiedNodes,
    addedEdges,
    removedEdges,
    affectedNodeIds,
    changedFiles,
    summary: {
      symbolsAdded: addedNodes.length,
      symbolsRemoved: removedNodes.length,
      symbolsModified: modifiedNodes.length,
      edgesAdded: addedEdges.length,
      edgesRemoved: removedEdges.length,
    },
  };
}
