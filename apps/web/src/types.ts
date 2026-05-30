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

export type PanoramaDeltaStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export interface PanoramaNode {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  commitHash?: string;
  commitShortHash?: string;
  role?: 'entry' | 'bridge' | 'leaf';
  deltaStatus?: PanoramaDeltaStatus;
  traceHighlight?: boolean;
  pathHighlight?: boolean;
  llmLabel?: string;
  position?: { x: number; y: number };
}

export interface PanoramaEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  line?: number;
  provenance?: string;
  synthesizedBy?: string;
  deltaStatus?: 'added' | 'removed' | 'unchanged';
  pathHighlight?: boolean;
}

export interface PanoramaGraph {
  repoId: string;
  commit?: string;
  commitShortHash?: string;
  base?: string;
  head?: string;
  nodes: PanoramaNode[];
  edges: PanoramaEdge[];
  entryPoints: string[];
  layout: 'tree' | 'layered';
  stats: {
    nodeCount: number;
    edgeCount: number;
    truncated: boolean;
    snapshotNodeCount?: number;
    entrySurfaceCount?: number;
  };
  extractionMethod?: 'codegraph' | 'fallback';
  pathConnected?: boolean;
  pathMessage?: string;
}

export interface PanoramaEnrichResult {
  labels: Record<string, string>;
  nonAuthoritative: true;
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

export interface TraceQuestion {
  repoId: string;
  question: string;
  branch?: string;
  commitLimit?: number;
  includeDiffEvidence?: boolean;
}

export type TraceEvidenceKind =
  | 'commit-message'
  | 'changed-file'
  | 'changed-symbol'
  | 'edge-change'
  | 'risk-tag'
  | 'entry-point'
  | 'code-diff'
  | 'delta-summary'
  | 'delta-unavailable';

export interface TraceEvidenceItem {
  id: string;
  kind: TraceEvidenceKind;
  commitHash: string;
  title: string;
  detail: string;
  file?: string;
  symbol?: string;
  score?: number;
}

export interface TraceCandidateCommit {
  commit: CommitInfo;
  relevanceScore: number;
  reasons: string[];
  matchedTerms: string[];
  changedFiles: ChangedFile[];
  impactSummary?: ImpactSummary;
  deltaSummary?: DeltaSummary;
  previousCommitHash?: string;
}

export interface TraceEvolutionState {
  label: 'before' | 'candidate' | 'after' | 'current';
  commitHash?: string;
  summary: string;
  evidenceRefs: string[];
}

export interface TraceAnswer {
  question: string;
  directAnswer: string;
  directAnswerEvidenceRefs?: string[];
  mostLikelyCommit?: CommitInfo;
  candidates: TraceCandidateCommit[];
  evidence: TraceEvidenceItem[];
  impactRadius: {
    files: string[];
    symbols: string[];
    entryPoints: string[];
    riskTags: string[];
  };
  evolution: TraceEvolutionState[];
  confidence: 'low' | 'medium' | 'high';
  uncertainty: string[];
  uncertaintyEvidenceRefs?: string[];
  suggestedNextChecks: string[];
  provider?: {
    type: string;
    model?: string;
    used: boolean;
    nonAuthoritativeText?: string;
  };
}
