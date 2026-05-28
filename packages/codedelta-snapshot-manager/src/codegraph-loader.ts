import * as path from 'path';
import { resolveMonorepoRoot } from './cache-paths';

export interface CodeGraphInstance {
  exportGraph(): {
    nodes: Array<{
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
    }>;
    edges: Array<{
      source: string;
      target: string;
      kind: string;
      line?: number;
      provenance?: string;
      metadata?: Record<string, unknown>;
    }>;
    files: string[];
  };
  close(): void;
  uninitialize(): void;
}

export interface CodeGraphConstructor {
  init(
    projectRoot: string,
    options?: { index?: boolean; onProgress?: (p: unknown) => void },
  ): Promise<CodeGraphInstance>;
  open(projectRoot: string, options?: { sync?: boolean }): Promise<CodeGraphInstance>;
  isInitialized(projectRoot: string): boolean;
  uninitialize?(projectRoot: string): void;
}

export function loadCodeGraph(): CodeGraphConstructor {
  const root = resolveMonorepoRoot();
  const distPath = path.join(root, 'dist', 'index.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(distPath);
  const CodeGraph = mod.default ?? mod.CodeGraph ?? mod;
  return CodeGraph as CodeGraphConstructor;
}
