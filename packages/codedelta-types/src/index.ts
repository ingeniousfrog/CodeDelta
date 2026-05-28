/**
 * CodeDelta shared type definitions.
 */

/** Stable repo identifier: first 16 chars of sha256(normalizedSource). */
export interface RepoRef {
  id: string;
  source: 'github' | 'local';
  /** Original input: GitHub URL or local absolute path. */
  input: string;
  /** Normalized clone directory: .codedelta/repos/<id> */
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
  insertions?: number;
  deletions?: number;
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
  provenance?: string;
  metadata?: Record<string, unknown>;
}

export type DeltaSource = {
  type: 'commit';
  commitHash: string;
  label?: string;
};

export type ExtractionMethod = 'codegraph' | 'fallback';

export interface SnapshotMetadata {
  extractionMethod: ExtractionMethod;
  durationMs?: number;
  warnings?: string[];
}

export interface CodeGraphSnapshot {
  repoId: string;
  commitHash: string;
  analyzerVersion: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  nodes: CodeNode[];
  edges: CodeEdge[];
  files: string[];
  metadata?: SnapshotMetadata;
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

export type ImpactSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ImpactExplanation {
  severity: ImpactSeverity;
  summary: string;
  reasons: string[];
  topContributors: Array<{
    factor: 'changedFiles' | 'changedSymbols' | 'changedEdges' | 'affectedNodes' | 'riskTags' | 'entryPoints';
    value: number;
    weight: number;
    contribution: number;
  }>;
}

export interface ImpactSummary {
  commitHash: string;
  score: number;
  changedSymbols: number;
  changedEdges: number;
  affectedModules: string[];
  impactedEntryPoints: string[];
  riskTags: string[];
  explanation?: ImpactExplanation;
}

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

export interface CandidateCommit {
  commit: CommitInfo;
  relevanceScore: number;
  reasons: string[];
  matchedFiles: string[];
  matchedSymbols: string[];
}

export interface TraceAnswer {
  question: string;
  mostLikelyCommit?: CommitInfo;
  candidateCommits: CandidateCommit[];
  evidenceChain: string[];
  impactRadius?: ImpactSummary;
  evolution: { beginning?: string; middle?: string; final?: string };
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  checked: string[];
  cannotConfirm: string[];
  providerUsed: string;
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

export interface CommitDetail extends CommitInfo {
  changedFiles: ChangedFile[];
}

export interface ImportRepoRequest {
  source: 'github' | 'local';
  input: string;
}
