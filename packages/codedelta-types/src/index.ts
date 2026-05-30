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

export interface TraceQuestion {
  repoId: string;
  question: string;
  branch?: string;
  commitLimit?: number;
  includeDiffEvidence?: boolean;
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

export type PanoramaDeltaStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export type PanoramaNodeRole = 'entry' | 'bridge' | 'leaf';

export interface PanoramaNodePosition {
  x: number;
  y: number;
}

export interface PanoramaNode {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  /** Snapshot commit this node was extracted from. */
  commitHash?: string;
  commitShortHash?: string;
  role?: PanoramaNodeRole;
  deltaStatus?: PanoramaDeltaStatus;
  traceHighlight?: boolean;
  pathHighlight?: boolean;
  llmLabel?: string;
  position?: PanoramaNodePosition;
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
    /** Total symbols in the indexed snapshot (context for sparse overviews). */
    snapshotNodeCount?: number;
    /** Entry surfaces included in this overview. */
    entrySurfaceCount?: number;
  };
  extractionMethod?: ExtractionMethod;
  pathConnected?: boolean;
  pathMessage?: string;
}

export interface PanoramaEnrichRequest {
  commit: string;
  nodeIds: string[];
}

export interface PanoramaEnrichResult {
  labels: Record<string, string>;
  nonAuthoritative: true;
}
