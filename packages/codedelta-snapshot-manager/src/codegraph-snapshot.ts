import * as fs from 'fs';
import * as path from 'path';
import type { CodeGraphSnapshot, SnapshotMetadata } from '@codedelta/types';
import { loadCodeGraph, type CodeGraphInstance } from './codegraph-loader';
import { SnapshotBuildError } from './errors';
import { buildIdMap, normalizeEdges, normalizeNodes, type RawEdge, type RawNode } from './semantic-id';

function toRepoRelativePath(projectRoot: string, maybePath: string): string {
  const normalized = maybePath.replace(/\\/g, '/');
  const rootNorm = projectRoot.replace(/\\/g, '/');
  if (normalized.startsWith(rootNorm + '/')) {
    return normalized.slice(rootNorm.length + 1);
  }
  const rel = path.relative(projectRoot, maybePath).replace(/\\/g, '/');
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  return normalized;
}

function normalizeQualifiedName(projectRoot: string, qualifiedName: string): string {
  const rootNorm = projectRoot.replace(/\\/g, '/');
  return qualifiedName.replaceAll(`${rootNorm}/`, '');
}

export async function buildCodeGraphSnapshot(
  projectRoot: string,
  repoId: string,
  commitHash: string,
  analyzerVersion: string,
): Promise<CodeGraphSnapshot> {
  const start = Date.now();
  const CodeGraph = loadCodeGraph();
  const resolved = path.resolve(projectRoot);

  let cg: CodeGraphInstance | undefined;
  try {
    if (CodeGraph.isInitialized(resolved)) {
      cg = await CodeGraph.open(resolved, { sync: false });
    } else {
      cg = await CodeGraph.init(resolved, { index: true });
    }

    const exported = cg.exportGraph();
    const rawNodes: RawNode[] = exported.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      name: n.name,
      qualifiedName: normalizeQualifiedName(resolved, n.qualifiedName),
      filePath: toRepoRelativePath(resolved, n.filePath),
      language: n.language,
      startLine: n.startLine,
      endLine: n.endLine,
      signature: n.signature,
      isExported: n.isExported,
    }));

    const idMap = buildIdMap(rawNodes);
    const rawEdges: RawEdge[] = exported.edges.map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
      line: e.line,
      provenance: e.provenance,
      metadata: e.metadata,
    }));

    const nodes = normalizeNodes(rawNodes);
    const edges = normalizeEdges(rawEdges, idMap);

    const metadata: SnapshotMetadata = {
      extractionMethod: 'codegraph',
      durationMs: Date.now() - start,
    };

    return {
      repoId,
      commitHash,
      analyzerVersion,
      createdAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
      files: exported.files.map((f) => toRepoRelativePath(resolved, f)),
      metadata,
    };
  } catch (err) {
    throw new SnapshotBuildError(
      `CodeGraph snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  } finally {
    try {
      cg?.close();
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(path.join(resolved, '.codegraph'))) {
        cg?.uninitialize();
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
