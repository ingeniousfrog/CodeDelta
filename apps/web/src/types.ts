/** Mirror of @codedelta/types for the web client (no workspace TS project refs). */

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
