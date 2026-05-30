import dagre from '@dagrejs/dagre';
import { computeGraphDiff } from '@codedelta/graph-diff';
import type {
  CodeEdge,
  CodeGraphSnapshot,
  CodeNode,
  GraphDiff,
  PanoramaDeltaStatus,
  PanoramaEdge,
  PanoramaGraph,
  PanoramaNode,
  PanoramaNodeRole,
} from '@codedelta/types';

export interface DetectEntryPointsOptions {
  limit?: number;
}

export interface BuildCallTreeOptions {
  maxDepth?: number;
  maxNodes?: number;
  edgeKinds?: string[];
}

export interface BuildPanoramaOptions {
  rootId?: string;
  rootQuery?: string;
  maxDepth?: number;
  maxNodes?: number;
  entryLimit?: number;
  edgeKinds?: string[];
  /** When set, only keep branches touching changed nodes/edges. */
  deltaOnly?: boolean;
}

export interface TraceHighlightInput {
  symbols?: string[];
  entryPoints?: string[];
  /** Resolve qualified names to node ids when possible. */
  symbolQueries?: string[];
}

const DEFAULT_EDGE_KINDS = ['calls', 'references'];

function nodeMap(snapshot: CodeGraphSnapshot): Map<string, CodeNode> {
  return new Map(snapshot.nodes.map((n) => [n.id, n]));
}

function edgeId(edge: Pick<CodeEdge, 'source' | 'target' | 'kind'>): string {
  return `${edge.source}|${edge.target}|${edge.kind}`;
}

function buildOutgoing(
  edges: CodeEdge[],
  kinds: Set<string>,
): Map<string, Array<{ edge: CodeEdge; target: string }>> {
  const adj = new Map<string, Array<{ edge: CodeEdge; target: string }>>();
  for (const edge of edges) {
    if (!kinds.has(edge.kind)) continue;
    const list = adj.get(edge.source) ?? [];
    list.push({ edge, target: edge.target });
    adj.set(edge.source, list);
  }
  return adj;
}

function buildIncoming(
  edges: CodeEdge[],
  kinds: Set<string>,
): Map<string, Set<string>> {
  const callers = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!kinds.has(edge.kind)) continue;
    const set = callers.get(edge.target) ?? new Set<string>();
    set.add(edge.source);
    callers.set(edge.target, set);
  }
  return callers;
}

function entryPriority(node: CodeNode): number {
  if (node.kind === 'route') return 0;
  if (node.kind === 'component') return 1;
  if (node.isExported && (node.kind === 'function' || node.kind === 'method')) return 2;
  return 99;
}

export function resolvePanoramaBudget(snapshotNodeCount: number): {
  maxNodes: number;
  entryLimit: number;
  minPerRootNodes: number;
  overviewDepthBonus: number;
  sparseExpandLimit: number;
} {
  if (snapshotNodeCount >= 8000) {
    return { maxNodes: 600, entryLimit: 20, minPerRootNodes: 56, overviewDepthBonus: 1, sparseExpandLimit: 18 };
  }
  if (snapshotNodeCount >= 3000) {
    return { maxNodes: 480, entryLimit: 16, minPerRootNodes: 48, overviewDepthBonus: 1, sparseExpandLimit: 16 };
  }
  if (snapshotNodeCount >= 1000) {
    return { maxNodes: 360, entryLimit: 12, minPerRootNodes: 40, overviewDepthBonus: 1, sparseExpandLimit: 14 };
  }
  if (snapshotNodeCount >= 300) {
    return { maxNodes: 280, entryLimit: 10, minPerRootNodes: 32, overviewDepthBonus: 0, sparseExpandLimit: 12 };
  }
  return { maxNodes: 200, entryLimit: 6, minPerRootNodes: 28, overviewDepthBonus: 0, sparseExpandLimit: 10 };
}

/**
 * Heuristic entry detection aligned with impact-score entry surface.
 */
export function detectEntryPoints(
  snapshot: CodeGraphSnapshot,
  options: DetectEntryPointsOptions = {},
): string[] {
  const limit = options.limit ?? 12;
  const kinds = new Set(DEFAULT_EDGE_KINDS);
  const callers = buildIncoming(snapshot.edges, kinds);
  const candidates: CodeNode[] = [];

  for (const node of snapshot.nodes) {
    const p = entryPriority(node);
    if (p === 99) continue;
    if (p <= 1) {
      candidates.push(node);
      continue;
    }
    const inbound = callers.get(node.id);
    if (!inbound || inbound.size === 0) {
      candidates.push(node);
    }
  }

  candidates.sort((a, b) => {
    const pa = entryPriority(a);
    const pb = entryPriority(b);
    if (pa !== pb) return pa - pb;
    return a.qualifiedName.localeCompare(b.qualifiedName);
  });

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const node of candidates) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ids.push(node.id);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function resolveNodeQuery(snapshot: CodeGraphSnapshot, query: string): CodeNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const exact = snapshot.nodes.filter(
    (n) => n.id === query || n.qualifiedName === query || n.name === query,
  );
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    exact.sort((a, b) => entryPriority(a) - entryPriority(b));
    return exact[0]!;
  }

  const partial = snapshot.nodes.filter(
    (n) =>
      n.qualifiedName.toLowerCase().includes(q) ||
      n.name.toLowerCase() === q ||
      n.filePath.toLowerCase().includes(q),
  );
  if (partial.length === 0) return null;
  partial.sort((a, b) => entryPriority(a) - entryPriority(b));
  return partial[0]!;
}

export interface CallTreeResult {
  nodeIds: Set<string>;
  edges: CodeEdge[];
  truncated: boolean;
  roles: Map<string, PanoramaNodeRole>;
}

export function buildCallTree(
  snapshot: CodeGraphSnapshot,
  rootId: string,
  options: BuildCallTreeOptions = {},
): CallTreeResult {
  const maxDepth = options.maxDepth ?? 3;
  const maxNodes = options.maxNodes ?? 200;
  const edgeKinds = new Set(options.edgeKinds ?? DEFAULT_EDGE_KINDS);
  const nodes = nodeMap(snapshot);
  if (!nodes.has(rootId)) {
    return { nodeIds: new Set(), edges: [], truncated: false, roles: new Map() };
  }

  const outgoing = buildOutgoing(snapshot.edges, edgeKinds);
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const collected: CodeEdge[] = [];
  const roles = new Map<string, PanoramaNodeRole>();
  let truncated = false;

  roles.set(rootId, 'entry');
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (nodeIds.has(id)) continue;
    if (nodeIds.size >= maxNodes) {
      truncated = true;
      break;
    }
    if (!nodes.has(id)) continue;

    nodeIds.add(id);
    if (depth >= maxDepth) continue;

    for (const { edge, target } of outgoing.get(id) ?? []) {
      const eid = edgeId(edge);
      if (!edgeKeys.has(eid)) {
        edgeKeys.add(eid);
        collected.push(edge);
      }
      if (!nodeIds.has(target) && nodeIds.size + queue.length < maxNodes) {
        if (!roles.has(target)) {
          roles.set(target, depth + 1 >= maxDepth ? 'leaf' : 'bridge');
        }
        queue.push({ id: target, depth: depth + 1 });
      } else if (nodeIds.size >= maxNodes) {
        truncated = true;
      }
    }
  }

  for (const id of nodeIds) {
    if (id === rootId) continue;
    const hasOut = (outgoing.get(id) ?? []).some(({ target }) => nodeIds.has(target));
    if (!hasOut) roles.set(id, 'leaf');
  }

  return { nodeIds, edges: collected, truncated, roles };
}

/** When an entry tree is mostly a lone route/mount, pull in reference targets + one call hop. */
export function expandSparseEntryTree(
  snapshot: CodeGraphSnapshot,
  tree: CallTreeResult,
  rootId: string,
  options: { maxExtra?: number; edgeKinds?: string[] } = {},
): CallTreeResult {
  const sparseThreshold = 4;
  if (tree.nodeIds.size >= sparseThreshold) return tree;

  const maxExtra = options.maxExtra ?? 12;
  const edgeKinds = new Set(options.edgeKinds ?? DEFAULT_EDGE_KINDS);
  const outgoing = buildOutgoing(snapshot.edges, edgeKinds);
  const extraTargets = new Set<string>();

  for (const { target } of outgoing.get(rootId) ?? []) {
    if (!tree.nodeIds.has(target)) extraTargets.add(target);
  }

  for (const id of tree.nodeIds) {
    if (id === rootId) continue;
    for (const { target } of outgoing.get(id) ?? []) {
      if (!tree.nodeIds.has(target)) extraTargets.add(target);
    }
  }

  const toAdd = [...extraTargets].slice(0, maxExtra);
  if (toAdd.length === 0) return tree;

  const perTarget = Math.max(6, Math.floor(maxExtra / Math.max(1, toAdd.length)));
  const extraTrees = toAdd.map((id) =>
    buildCallTree(snapshot, id, { maxDepth: 2, maxNodes: perTarget, edgeKinds: options.edgeKinds }),
  );
  return mergeTrees([tree, ...extraTrees]);
}

function buildEntryCatalog(
  snapshot: CodeGraphSnapshot,
  entryIds: string[],
  graphNodeIds: Set<string>,
): Array<{ id: string; qualifiedName: string; kind: string; inGraph: boolean }> {
  const nodes = nodeMap(snapshot);
  return entryIds.map((id) => {
    const node = nodes.get(id);
    return {
      id,
      qualifiedName: node?.qualifiedName ?? id,
      kind: node?.kind ?? 'function',
      inGraph: graphNodeIds.has(id),
    };
  });
}

export function findPath(
  snapshot: CodeGraphSnapshot,
  fromId: string,
  toId: string,
  edgeKinds: string[] = ['calls'],
): string[] | null {
  if (fromId === toId) return [fromId];
  const kinds = new Set(edgeKinds);
  const outgoing = buildOutgoing(snapshot.edges, kinds);
  const prev = new Map<string, string | null>();
  const queue = [fromId];
  prev.set(fromId, null);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toId) {
      const path: string[] = [];
      let cur: string | null = toId;
      while (cur) {
        path.unshift(cur);
        cur = prev.get(cur) ?? null;
      }
      return path;
    }
    for (const { target } of outgoing.get(current) ?? []) {
      if (prev.has(target)) continue;
      prev.set(target, current);
      queue.push(target);
    }
  }
  return null;
}

function toPanoramaNode(node: CodeNode, role?: PanoramaNodeRole, commitHash?: string): PanoramaNode {
  const short = commitHash ? commitHash.slice(0, 7) : undefined;
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualifiedName,
    filePath: node.filePath,
    startLine: node.startLine,
    endLine: node.endLine,
    signature: node.signature,
    commitHash,
    commitShortHash: short,
    role,
  };
}

function toPanoramaEdge(edge: CodeEdge): PanoramaEdge {
  const synthesizedBy =
    edge.provenance === 'heuristic' && edge.metadata && typeof edge.metadata.synthesizedBy === 'string'
      ? edge.metadata.synthesizedBy
      : undefined;
  return {
    id: edgeId(edge),
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    line: edge.line,
    provenance: edge.provenance,
    synthesizedBy,
  };
}

function mergeTrees(trees: CallTreeResult[]): CallTreeResult {
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const edges: CodeEdge[] = [];
  const roles = new Map<string, PanoramaNodeRole>();
  let truncated = false;

  for (const tree of trees) {
    if (tree.truncated) truncated = true;
    for (const id of tree.nodeIds) nodeIds.add(id);
    for (const [id, role] of tree.roles) {
      const existing = roles.get(id);
      if (!existing || role === 'entry') roles.set(id, role);
    }
    for (const edge of tree.edges) {
      const eid = edgeId(edge);
      if (!edgeKeys.has(eid)) {
        edgeKeys.add(eid);
        edges.push(edge);
      }
    }
  }
  return { nodeIds, edges, truncated, roles };
}

function filterDeltaRelevant(
  graph: { nodes: PanoramaNode[]; edges: PanoramaEdge[] },
): { nodes: PanoramaNode[]; edges: PanoramaEdge[] } {
  const changedNodeIds = new Set(
    graph.nodes.filter((n) => n.deltaStatus && n.deltaStatus !== 'unchanged').map((n) => n.id),
  );
  const changedEdgeIds = new Set(
    graph.edges.filter((e) => e.deltaStatus && e.deltaStatus !== 'unchanged').map((e) => e.id),
  );
  if (changedNodeIds.size === 0 && changedEdgeIds.size === 0) {
    return graph;
  }

  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const out = adj.get(e.source) ?? [];
    out.push(e.target);
    adj.set(e.source, out);
    const inList = adj.get(e.target) ?? [];
    inList.push(e.source);
    adj.set(e.target, inList);
  }

  const keep = new Set<string>(changedNodeIds);
  const queue = [...changedNodeIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (!keep.has(next)) {
        keep.add(next);
        queue.push(next);
      }
    }
  }

  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

export function applyDeltaOverlay(
  nodes: PanoramaNode[],
  edges: PanoramaEdge[],
  diff: GraphDiff,
  headCommitHash?: string,
): { nodes: PanoramaNode[]; edges: PanoramaEdge[] } {
  const addedIds = new Set(diff.addedNodes.map((n) => n.id));
  const removedIds = new Set(diff.removedNodes.map((n) => n.id));
  const modifiedIds = new Set(diff.modifiedNodes.map((m) => m.after.id));
  const addedEdgeIds = new Set(diff.addedEdges.map((e) => edgeId(e)));
  const removedEdgeIds = new Set(diff.removedEdges.map((e) => edgeId(e)));

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const removed of diff.removedNodes) {
    if (!nodeById.has(removed.id)) {
      nodes.push({
        ...toPanoramaNode(removed, 'leaf', headCommitHash),
        deltaStatus: 'removed',
      });
    }
  }

  const nextNodes = nodes.map((n) => {
    let deltaStatus: PanoramaDeltaStatus = 'unchanged';
    if (addedIds.has(n.id)) deltaStatus = 'added';
    else if (removedIds.has(n.id)) deltaStatus = 'removed';
    else if (modifiedIds.has(n.id)) deltaStatus = 'modified';
    return { ...n, deltaStatus };
  });

  const nextEdges = edges.map((e) => {
    let deltaStatus: 'added' | 'removed' | 'unchanged' = 'unchanged';
    if (addedEdgeIds.has(e.id)) deltaStatus = 'added';
    else if (removedEdgeIds.has(e.id)) deltaStatus = 'removed';
    return { ...e, deltaStatus };
  });

  for (const removed of diff.removedEdges) {
    const id = edgeId(removed);
    if (!nextEdges.some((e) => e.id === id)) {
      nextEdges.push({ ...toPanoramaEdge(removed), deltaStatus: 'removed' });
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}

export function applyTraceHighlight(
  snapshot: CodeGraphSnapshot,
  nodes: PanoramaNode[],
  edges: PanoramaEdge[],
  input: TraceHighlightInput,
): { nodes: PanoramaNode[]; edges: PanoramaEdge[]; pathNodeIds: string[]; pathConnected: boolean; pathMessage?: string } {
  const highlightIds = new Set<string>();
  const queries = [
    ...(input.symbols ?? []),
    ...(input.entryPoints ?? []),
    ...(input.symbolQueries ?? []),
  ];

  for (const q of queries) {
    const node = resolveNodeQuery(snapshot, q);
    if (node) highlightIds.add(node.id);
    for (const n of snapshot.nodes) {
      if (n.qualifiedName === q || n.name === q) highlightIds.add(n.id);
    }
  }

  const entryIds = nodes.filter((n) => n.role === 'entry').map((n) => n.id);
  const targetIds = [...highlightIds].filter((id) => nodes.some((n) => n.id === id));

  let pathNodeIds: string[] = [];
  let pathConnected = false;
  let pathMessage: string | undefined;

  if (entryIds.length > 0 && targetIds.length > 0) {
    outer: for (const entry of entryIds) {
      for (const target of targetIds) {
        if (entry === target) {
          pathNodeIds = [entry];
          pathConnected = true;
          break outer;
        }
        const path = findPath(snapshot, entry, target);
        if (path && path.length > 0) {
          pathNodeIds = path;
          pathConnected = true;
          break outer;
        }
      }
    }
    if (!pathConnected) {
      pathMessage = 'Trace evidence symbols are in the graph but no call path connects them to the shown entry points.';
    }
  }

  const pathSet = new Set(pathNodeIds);
  const nextNodes = nodes.map((n) => ({
    ...n,
    traceHighlight: highlightIds.has(n.id),
    pathHighlight: pathSet.has(n.id),
  }));

  const pathEdgeIds = new Set<string>();
  for (let i = 0; i < pathNodeIds.length - 1; i++) {
    const from = pathNodeIds[i]!;
    const to = pathNodeIds[i + 1]!;
    for (const e of edges) {
      if (e.source === from && e.target === to) pathEdgeIds.add(e.id);
    }
  }

  const nextEdges = edges.map((e) => ({
    ...e,
    pathHighlight: pathEdgeIds.has(e.id),
  }));

  return { nodes: nextNodes, edges: nextEdges, pathNodeIds, pathConnected, pathMessage };
}

function collectForest(
  entryId: string,
  allNodes: PanoramaNode[],
  edges: PanoramaEdge[],
): { nodes: PanoramaNode[]; edges: PanoramaEdge[] } {
  const nodeIds = new Set<string>();
  const queue = [entryId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (nodeIds.has(id)) continue;
    if (!allNodes.some((n) => n.id === id)) continue;
    nodeIds.add(id);
    for (const edge of edges) {
      if (edge.source === id && allNodes.some((n) => n.id === edge.target)) {
        queue.push(edge.target);
      }
    }
  }
  return {
    nodes: allNodes.filter((n) => nodeIds.has(n.id)),
    edges: edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
  };
}

function layoutForest(nodes: PanoramaNode[], edges: PanoramaEdge[]): PanoramaNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 90, ranksep: 140, marginx: 60, marginy: 60 });

  const width = 360;
  const height = 188;

  for (const node of nodes) {
    g.setNode(node.id, { width, height });
  }
  for (const edge of edges) {
    if (nodes.some((n) => n.id === edge.source) && nodes.some((n) => n.id === edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const laid = g.node(node.id);
    if (!laid) return node;
    return {
      ...node,
      position: {
        x: laid.x - width / 2,
        y: laid.y - height / 2,
      },
    };
  });
}

export function layoutPanorama(
  nodes: PanoramaNode[],
  edges: PanoramaEdge[],
  entryPointIds?: string[],
): PanoramaNode[] {
  if (nodes.length === 0) return nodes;

  const nodeWidth = 360;
  const entries =
    entryPointIds?.filter((id) => nodes.some((n) => n.id === id)) ??
    nodes.filter((n) => n.role === 'entry').map((n) => n.id);

  if (entries.length <= 1) {
    return layoutForest(nodes, edges);
  }

  const positioned = new Map<string, PanoramaNode>();
  let xOffset = 0;
  const forestGap = 120;

  for (const entryId of entries) {
    const forest = collectForest(entryId, nodes, edges);
    if (forest.nodes.length === 0) continue;

    const laid = layoutForest(forest.nodes, forest.edges);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const n of laid) {
      const x = n.position?.x ?? 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + nodeWidth);
    }
    const shift = Number.isFinite(minX) ? xOffset - minX : xOffset;

    for (const n of laid) {
      positioned.set(n.id, {
        ...n,
        position: {
          x: (n.position?.x ?? 0) + shift,
          y: n.position?.y ?? 0,
        },
      });
    }

    xOffset += (Number.isFinite(maxX) && Number.isFinite(minX) ? maxX - minX : nodeWidth) + forestGap;
  }

  return nodes.map((n) => positioned.get(n.id) ?? n);
}

export function buildPanoramaGraph(
  repoId: string,
  snapshot: CodeGraphSnapshot,
  options: BuildPanoramaOptions = {},
): PanoramaGraph {
  const maxDepth = options.maxDepth ?? 3;
  const budget = resolvePanoramaBudget(snapshot.nodes.length);
  const maxNodes = options.maxNodes ?? budget.maxNodes;
  const entryLimit = options.entryLimit ?? budget.entryLimit;
  const edgeKinds = options.edgeKinds ?? DEFAULT_EDGE_KINDS;
  const nodesById = nodeMap(snapshot);
  const isOverview = !options.rootId && !options.rootQuery;
  const effectiveDepth = isOverview ? maxDepth + budget.overviewDepthBonus : maxDepth;

  let tree: CallTreeResult;
  let entryPoints: string[] = [];
  let catalogEntryIds: string[] = [];

  if (options.rootId) {
    entryPoints = [options.rootId];
    tree = buildCallTree(snapshot, options.rootId, { maxDepth: effectiveDepth, maxNodes, edgeKinds });
  } else if (options.rootQuery) {
    const resolved = resolveNodeQuery(snapshot, options.rootQuery);
    if (!resolved) {
      return {
        repoId,
        commit: snapshot.commitHash,
        nodes: [],
        edges: [],
        entryPoints: [],
        layout: 'layered',
        stats: { nodeCount: 0, edgeCount: 0, truncated: false },
      };
    }
    entryPoints = [resolved.id];
    tree = buildCallTree(snapshot, resolved.id, { maxDepth: effectiveDepth, maxNodes, edgeKinds });
  } else {
    catalogEntryIds = detectEntryPoints(snapshot, { limit: entryLimit });
    entryPoints = catalogEntryIds;
    const perRootBudget = Math.max(
      budget.minPerRootNodes,
      Math.floor(maxNodes / Math.max(1, entryPoints.length)),
    );
    const trees = entryPoints.map((rootId) => {
      let sub = buildCallTree(snapshot, rootId, {
        maxDepth: effectiveDepth,
        maxNodes: perRootBudget,
        edgeKinds,
      });
      sub = expandSparseEntryTree(snapshot, sub, rootId, {
        maxExtra: budget.sparseExpandLimit,
        edgeKinds,
      });
      return sub;
    });
    tree = mergeTrees(trees);
  }

  let panoramaNodes: PanoramaNode[] = [...tree.nodeIds]
    .map((id) => {
      const node = nodesById.get(id);
      if (!node) return null;
      return toPanoramaNode(node, tree.roles.get(id), snapshot.commitHash);
    })
    .filter((n): n is PanoramaNode => n !== null);

  let panoramaEdges: PanoramaEdge[] = tree.edges.map(toPanoramaEdge);

  if (options.deltaOnly) {
    const filtered = filterDeltaRelevant({ nodes: panoramaNodes, edges: panoramaEdges });
    panoramaNodes = filtered.nodes;
    panoramaEdges = filtered.edges;
  }

  panoramaNodes = layoutPanorama(panoramaNodes, panoramaEdges, entryPoints);

  const entryCatalog =
    catalogEntryIds.length > 0
      ? buildEntryCatalog(snapshot, catalogEntryIds, tree.nodeIds)
      : undefined;

  return {
    repoId,
    commit: snapshot.commitHash,
    commitShortHash: snapshot.commitHash.slice(0, 7),
    nodes: panoramaNodes,
    edges: panoramaEdges,
    entryPoints,
    entryCatalog,
    layout: 'layered',
    stats: {
      nodeCount: panoramaNodes.length,
      edgeCount: panoramaEdges.length,
      truncated: tree.truncated,
      snapshotNodeCount: snapshot.nodes.length,
      entrySurfaceCount: entryPoints.length,
      effectiveDepth,
    },
    extractionMethod: snapshot.metadata?.extractionMethod,
  };
}

export function buildDeltaPanoramaGraph(
  repoId: string,
  base: CodeGraphSnapshot,
  head: CodeGraphSnapshot,
  options: BuildPanoramaOptions & {
    seedEntryPoints?: string[];
  } = {},
): PanoramaGraph {
  const diff = computeGraphDiff({ base, head });
  const seedIds: string[] = [];

  if (options.rootId) {
    seedIds.push(options.rootId);
  } else if (options.rootQuery) {
    const resolved = resolveNodeQuery(head, options.rootQuery);
    if (resolved) seedIds.push(resolved.id);
  } else if (options.seedEntryPoints?.length) {
    for (const q of options.seedEntryPoints) {
      const resolved = resolveNodeQuery(head, q);
      if (resolved) seedIds.push(resolved.id);
    }
  }

  if (seedIds.length === 0) {
    const impacted = new Set<string>();
    for (const n of diff.addedNodes) impacted.add(n.id);
    for (const n of diff.modifiedNodes) impacted.add(n.after.id);
    for (const id of diff.affectedNodeIds.slice(0, 20)) impacted.add(id);
    for (const node of head.nodes) {
      if (impacted.has(node.id) && entryPriority(node) <= 2) {
        seedIds.push(node.id);
      }
    }
  }

  if (seedIds.length === 0) {
    const budget = resolvePanoramaBudget(head.nodes.length);
    seedIds.push(...detectEntryPoints(head, { limit: options.entryLimit ?? budget.entryLimit }));
  }

  const budget = resolvePanoramaBudget(head.nodes.length);
  const uniqueSeeds = [...new Set(seedIds)].slice(0, options.entryLimit ?? budget.entryLimit);
  const perRootBudget = Math.max(
    40,
    Math.floor((options.maxNodes ?? budget.maxNodes) / Math.max(1, uniqueSeeds.length)),
  );
  const trees = uniqueSeeds.map((rootId) =>
    buildCallTree(head, rootId, {
      maxDepth: options.maxDepth ?? 3,
      maxNodes: perRootBudget,
      edgeKinds: options.edgeKinds ?? DEFAULT_EDGE_KINDS,
    }),
  );
  const tree = mergeTrees(trees);
  const nodesById = nodeMap(head);

  let panoramaNodes: PanoramaNode[] = [...tree.nodeIds]
    .map((id) => {
      const node = nodesById.get(id);
      if (!node) return null;
      return toPanoramaNode(node, tree.roles.get(id), head.commitHash);
    })
    .filter((n): n is PanoramaNode => n !== null);

  let panoramaEdges: PanoramaEdge[] = tree.edges.map(toPanoramaEdge);
  const overlaid = applyDeltaOverlay(panoramaNodes, panoramaEdges, diff, head.commitHash);
  panoramaNodes = overlaid.nodes;
  panoramaEdges = overlaid.edges;

  if (options.deltaOnly !== false) {
    const filtered = filterDeltaRelevant({ nodes: panoramaNodes, edges: panoramaEdges });
    panoramaNodes = filtered.nodes;
    panoramaEdges = filtered.edges;
  }

  panoramaNodes = layoutPanorama(panoramaNodes, panoramaEdges, uniqueSeeds);

  return {
    repoId,
    base: base.commitHash,
    head: head.commitHash,
    commit: head.commitHash,
    commitShortHash: head.commitHash.slice(0, 7),
    nodes: panoramaNodes,
    edges: panoramaEdges,
    entryPoints: uniqueSeeds,
    layout: 'layered',
    stats: {
      nodeCount: panoramaNodes.length,
      edgeCount: panoramaEdges.length,
      truncated: tree.truncated,
      snapshotNodeCount: head.nodes.length,
      entrySurfaceCount: uniqueSeeds.length,
    },
    extractionMethod: head.metadata?.extractionMethod,
  };
}

export { computeGraphDiff };
