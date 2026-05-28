import type { CodeEdge, CodeNode } from '@codedelta/types';

export interface RawNode {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  signature?: string;
  isExported?: boolean;
}

export interface RawEdge {
  source: string;
  target: string;
  kind: string;
  line?: number;
  provenance?: string;
  metadata?: Record<string, unknown>;
}

/** Stable semantic key for diff (qualifiedName preferred). */
export function toSemanticId(node: Pick<RawNode, 'qualifiedName' | 'filePath' | 'kind' | 'name'>): string {
  if (node.qualifiedName) return node.qualifiedName;
  return `${node.filePath}::${node.kind}::${node.name}`;
}

export function normalizeNodes(raw: RawNode[]): CodeNode[] {
  const seen = new Map<string, CodeNode>();
  for (const n of raw) {
    const id = toSemanticId(n);
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      kind: n.kind,
      name: n.name,
      qualifiedName: n.qualifiedName || id,
      filePath: n.filePath,
      language: n.language,
      startLine: n.startLine,
      endLine: n.endLine,
      signature: n.signature,
      isExported: n.isExported,
    });
  }
  return Array.from(seen.values());
}

export function normalizeEdges(raw: RawEdge[], idMap: Map<string, string>): CodeEdge[] {
  const edges: CodeEdge[] = [];
  const seen = new Set<string>();

  for (const e of raw) {
    const source = idMap.get(e.source) ?? e.source;
    const target = idMap.get(e.target) ?? e.target;
    const key = `${source}|${target}|${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      source,
      target,
      kind: e.kind,
      line: e.line,
      provenance: e.provenance,
      metadata: e.metadata,
    });
  }
  return edges;
}

/** Build CodeGraph internal id → semantic id map. */
export function buildIdMap(raw: RawNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of raw) {
    map.set(n.id, toSemanticId(n));
  }
  return map;
}
