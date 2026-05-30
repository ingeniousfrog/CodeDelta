import {
  applyTraceHighlight,
  buildDeltaPanoramaGraph,
  buildPanoramaGraph,
  resolveNodeQuery,
  resolvePanoramaBudget,
} from '@codedelta/graph-subgraph';
import { createProvider } from '@codedelta/provider-runtime';
import { git } from '@codedelta/repo-manager';
import {
  getOrBuildSnapshot,
  readAnalyzerVersion,
  resolveMonorepoRoot,
  SnapshotBuildError,
  SnapshotEmptyError,
  SnapshotTimeoutError,
} from '@codedelta/snapshot-manager';
import type {
  CodeNode,
  PanoramaEnrichRequest,
  PanoramaEnrichResult,
  PanoramaGraph,
} from '@codedelta/types';
import { RepoRegistry, SettingsStore } from '../store/repo-registry';

export class PanoramaError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'PanoramaError';
  }
}

export interface PanoramaQuery {
  commit?: string;
  base?: string;
  head?: string;
  root?: string;
  depth?: number;
  maxNodes?: number;
  highlight?: 'trace';
  traceSymbols?: string[];
  traceEntryPoints?: string[];
}

function verifyCommit(clonePath: string, hash: string): void {
  try {
    git(['rev-parse', '--verify', hash], { cwd: clonePath });
  } catch {
    throw new PanoramaError(`Commit not found: ${hash}`, 404);
  }
}

async function loadSnapshot(
  registry: RepoRegistry,
  repoId: string,
  commitHash: string,
) {
  const ref = registry.get(repoId);
  if (!ref) throw new PanoramaError('Repository not found', 404);
  verifyCommit(ref.clonePath, commitHash);

  const cacheRoot = registry.getCacheRoot();
  const analyzerVersion = readAnalyzerVersion(resolveMonorepoRoot());
  try {
    return await getOrBuildSnapshot({
      repoId,
      commitHash,
      clonePath: ref.clonePath,
      cacheRoot,
      analyzerVersion,
    });
  } catch (err: unknown) {
    if (err instanceof SnapshotTimeoutError) throw new PanoramaError(err.message, 504);
    if (err instanceof SnapshotEmptyError) throw new PanoramaError(err.message, 422);
    if (err instanceof SnapshotBuildError) {
      throw new PanoramaError(`Snapshot build failed: ${err.message}`, 500);
    }
    throw new PanoramaError(
      `Snapshot build failed: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

function readSourceSnippet(
  clonePath: string,
  commit: string,
  node: CodeNode,
  contextLines = 3,
): string {
  try {
    const raw = git(['show', `${commit}:${node.filePath}`], { cwd: clonePath });
    const lines = raw.split('\n');
    const start = Math.max(0, node.startLine - 1 - contextLines);
    const end = Math.min(lines.length, node.endLine + contextLines);
    return lines.slice(start, end).join('\n');
  } catch {
    return node.signature ?? node.qualifiedName;
  }
}

export async function getPanorama(
  registry: RepoRegistry,
  repoId: string,
  query: PanoramaQuery,
): Promise<PanoramaGraph> {
  const ref = registry.get(repoId);
  if (!ref) throw new PanoramaError('Repository not found', 404);

  const depth = query.depth ?? 3;
  const maxNodes = query.maxNodes ?? 200;
  const root = query.root?.trim();

  let graph: PanoramaGraph;

  if (query.base && query.head) {
    verifyCommit(ref.clonePath, query.base);
    verifyCommit(ref.clonePath, query.head);
    const [baseSnap, headSnap] = await Promise.all([
      loadSnapshot(registry, repoId, query.base),
      loadSnapshot(registry, repoId, query.head),
    ]);
    graph = buildDeltaPanoramaGraph(repoId, baseSnap, headSnap, {
      rootQuery: root,
      maxDepth: depth,
      maxNodes,
      deltaOnly: true,
      seedEntryPoints: query.traceEntryPoints,
    });
  } else {
    const commit = query.commit?.trim();
    if (!commit) {
      throw new PanoramaError('Query parameter commit or base+head is required', 400);
    }
    const snap = await loadSnapshot(registry, repoId, commit);
    const budget = resolvePanoramaBudget(snap.nodes.length);
    graph = buildPanoramaGraph(repoId, snap, {
      rootQuery: root,
      maxDepth: depth,
      maxNodes: query.maxNodes ?? budget.maxNodes,
      entryLimit: budget.entryLimit,
    });
  }

  if (query.highlight === 'trace' && (query.traceSymbols?.length || query.traceEntryPoints?.length)) {
    const headCommit = query.head ?? query.commit;
    if (!headCommit) return graph;
    const snap = await loadSnapshot(registry, repoId, headCommit);
    const highlighted = applyTraceHighlight(snap, graph.nodes, graph.edges, {
      symbols: query.traceSymbols,
      entryPoints: query.traceEntryPoints,
      symbolQueries: query.traceSymbols,
    });
    graph = {
      ...graph,
      nodes: highlighted.nodes,
      edges: highlighted.edges,
      pathConnected: highlighted.pathConnected,
      pathMessage: highlighted.pathMessage,
    };
  }

  return graph;
}

export async function enrichPanoramaNodes(
  registry: RepoRegistry,
  settings: SettingsStore,
  repoId: string,
  body: PanoramaEnrichRequest,
): Promise<PanoramaEnrichResult> {
  const ref = registry.get(repoId);
  if (!ref) throw new PanoramaError('Repository not found', 404);

  const commit = body.commit?.trim();
  if (!commit) throw new PanoramaError('commit is required', 400);

  const nodeIds = (body.nodeIds ?? []).slice(0, 20);
  if (nodeIds.length === 0) {
    return { labels: {}, nonAuthoritative: true };
  }

  const snap = await loadSnapshot(registry, repoId, commit);
  const provider = createProvider(settings.getProvider());
  if (!provider.isConfigured() || provider.id === 'none') {
    throw new PanoramaError(
      'Configure a Provider in Settings to generate node descriptions (non-authoritative).',
      400,
    );
  }

  const labels: Record<string, string> = {};
  for (const id of nodeIds) {
    const node = snap.nodes.find((n) => n.id === id) ?? resolveNodeQuery(snap, id);
    if (!node) continue;
    const snippet = readSourceSnippet(ref.clonePath, commit, node);
    try {
      const text = await provider.complete({
        system:
          'You label code symbols for a developer panorama graph. Reply with ONE short phrase (under 12 words) describing the symbol role. No markdown.',
        messages: [
          {
            role: 'user',
            content: `Symbol: ${node.qualifiedName}\nKind: ${node.kind}\nFile: ${node.filePath}:${node.startLine}\nSignature: ${node.signature ?? 'n/a'}\n\nSource:\n${snippet}`,
          },
        ],
        temperature: 0.2,
      });
      labels[node.id] = text.trim().slice(0, 120);
    } catch {
      labels[node.id] = node.kind;
    }
  }

  return { labels, nonAuthoritative: true };
}
