/**
 * FALLBACK extractor — minimal TS/JS structural scan when CodeGraph is unavailable.
 * TODO: replace with full CodeGraph integration + incremental indexFiles.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CodeGraphSnapshot, SnapshotMetadata } from '@codedelta/types';
import { normalizeEdges, normalizeNodes, type RawEdge, type RawNode, toSemanticId } from './semantic-id';

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

const EXPORT_FN = /export\s+(?:async\s+)?function\s+(\w+)/g;
const EXPORT_CONST = /export\s+const\s+(\w+)/g;
const EXPORT_CLASS = /export\s+class\s+(\w+)/g;
const EXPORT_DEFAULT_FN = /export\s+default\s+function\s+(\w+)?/g;
const IMPORT_FROM = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
const REACT_COMPONENT = /(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)/g;

function walkDir(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, files);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function relPath(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, '/');
}

function addSymbol(
  nodes: RawNode[],
  filePath: string,
  kind: string,
  name: string,
  line: number,
  isExported: boolean,
): void {
  const qualifiedName = `${filePath}::${name}`;
  nodes.push({
    id: qualifiedName,
    kind,
    name,
    qualifiedName,
    filePath,
    language: filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? 'tsx' : 'typescript',
    startLine: line,
    endLine: line,
    isExported,
  });
}

function isRouteFile(filePath: string): boolean {
  return (
    filePath.includes('/app/') ||
    filePath.includes('/pages/') ||
    filePath.endsWith('/route.ts') ||
    filePath.endsWith('/route.tsx')
  );
}

export function buildFallbackSnapshot(
  projectRoot: string,
  repoId: string,
  commitHash: string,
  analyzerVersion: string,
): CodeGraphSnapshot {
  const start = Date.now();
  const nodes: RawNode[] = [];
  const rawEdges: RawEdge[] = [];
  const absFiles = walkDir(projectRoot);
  const files = absFiles.map((f) => relPath(projectRoot, f));

  for (const abs of absFiles) {
    const filePath = relPath(projectRoot, abs);
    const content = fs.readFileSync(abs, 'utf8');
    const lines = content.split('\n');

    if (isRouteFile(filePath)) {
      addSymbol(nodes, filePath, 'route', path.basename(filePath), 1, true);
    }

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      let m: RegExpExecArray | null;

      EXPORT_FN.lastIndex = 0;
      while ((m = EXPORT_FN.exec(line)) !== null) {
        addSymbol(nodes, filePath, 'function', m[1]!, lineNo, true);
      }

      EXPORT_CLASS.lastIndex = 0;
      while ((m = EXPORT_CLASS.exec(line)) !== null) {
        addSymbol(nodes, filePath, 'class', m[1]!, lineNo, true);
      }

      EXPORT_CONST.lastIndex = 0;
      while ((m = EXPORT_CONST.exec(line)) !== null) {
        addSymbol(nodes, filePath, 'constant', m[1]!, lineNo, true);
      }

      REACT_COMPONENT.lastIndex = 0;
      while ((m = REACT_COMPONENT.exec(line)) !== null) {
        addSymbol(nodes, filePath, 'component', m[1]!, lineNo, true);
      }

      IMPORT_FROM.lastIndex = 0;
      while ((m = IMPORT_FROM.exec(line)) !== null) {
        const target = m[1]!;
        const fileNodeId = `${filePath}::module`;
        if (!nodes.some((n) => n.qualifiedName === fileNodeId)) {
          nodes.push({
            id: fileNodeId,
            kind: 'module',
            name: path.basename(filePath),
            qualifiedName: fileNodeId,
            filePath,
            language: 'typescript',
            startLine: 1,
            endLine: 1,
          });
        }
        rawEdges.push({
          source: fileNodeId,
          target: `${target}::module`,
          kind: 'imports',
          line: lineNo,
          provenance: 'heuristic',
        });
      }
    });
  }

  const normalized = normalizeNodes(nodes);
  const idMap = new Map<string, string>();
  for (const n of nodes) {
    idMap.set(n.id, toSemanticId(n));
  }
  const edges = normalizeEdges(rawEdges, idMap);

  const metadata: SnapshotMetadata = {
    extractionMethod: 'fallback',
    durationMs: Date.now() - start,
    warnings: ['CodeGraph unavailable or failed; using minimal TS/JS fallback extractor'],
  };

  return {
    repoId,
    commitHash,
    analyzerVersion,
    createdAt: new Date().toISOString(),
    nodeCount: normalized.length,
    edgeCount: edges.length,
    nodes: normalized,
    edges,
    files,
    metadata,
  };
}
