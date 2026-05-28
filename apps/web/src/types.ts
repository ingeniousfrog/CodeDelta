/** Mirror of @codedelta/types for the web client. */

export interface RepoRef {
  id: string;
  source: 'github' | 'local';
  input: string;
  clonePath: string;
  defaultBranch: string;
  remoteUrl?: string;
  importedAt: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  parents: string[];
  changedFilesCount: number;
  impactScore?: number;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  oldPath?: string;
}

export interface CodeNode {
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

export interface CodeEdge {
  source: string;
  target: string;
  kind: string;
  line?: number;
}

export interface GraphDiff {
  baseCommit: string;
  headCommit: string;
  addedNodes: CodeNode[];
  removedNodes: CodeNode[];
  modifiedNodes: Array<{ before: CodeNode; after: CodeNode; changes: string[] }>;
  addedEdges: CodeEdge[];
  removedEdges: CodeEdge[];
  affectedNodeIds: string[];
  changedFiles: ChangedFile[];
  summary: {
    symbolsAdded: number;
    symbolsRemoved: number;
    symbolsModified: number;
    edgesAdded: number;
    edgesRemoved: number;
  };
}

export type ImpactSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ImpactSummary {
  commitHash: string;
  score: number;
  changedSymbols: number;
  changedEdges: number;
  affectedModules: string[];
  impactedEntryPoints: string[];
  riskTags: string[];
  explanation?: {
    severity: ImpactSeverity;
    summary: string;
    reasons: string[];
    topContributors: Array<{
      factor: 'changedFiles' | 'changedSymbols' | 'changedEdges' | 'affectedNodes' | 'riskTags' | 'entryPoints';
      value: number;
      weight: number;
      contribution: number;
    }>;
  };
}

export interface DeltaSummary {
  title: string;
  overview: string[];
  mainAreas: Array<{
    name: string;
    files: string[];
    changedSymbols: number;
    riskTags: string[];
  }>;
  risks: Array<{
    tag: string;
    reason: string;
    files: string[];
  }>;
  reviewOrder: Array<{
    file: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  metrics: {
    changedFiles: number;
    changedSymbols: number;
    edgeChanges: number;
    affectedNodes: number;
  };
}

export type DeltaSource = {
  type: 'commit';
  commitHash: string;
  label?: string;
};

export type ExtractionMethod = 'codegraph' | 'fallback';

export interface CompareResponse {
  repoId: string;
  base: DeltaSource;
  head: DeltaSource;
  graphDiff: GraphDiff;
  impact: ImpactSummary;
  deltaSummary?: DeltaSummary;
  baseMeta: { nodeCount: number; edgeCount: number; extractionMethod: ExtractionMethod };
  headMeta: { nodeCount: number; edgeCount: number; extractionMethod: ExtractionMethod };
}

export interface FileDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: string[];
}

export interface FileDiffResponse {
  repoId: string;
  base: string;
  head: string;
  file: string;
  status: ChangedFile['status'];
  patch: string;
  hunks: FileDiffHunk[];
}

export interface CommitDetail extends CommitInfo {
  changedFiles: ChangedFile[];
}

export interface ImportRepoRequest {
  source: 'github' | 'local';
  input: string;
}

export type ProviderKind =
  | 'codex-oauth'
  | 'openai'
  | 'openai-compatible'
  | 'anthropic'
  | 'ollama'
  | 'none';

export interface ModelProviderConfig {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  oauthToken?: string;
}
