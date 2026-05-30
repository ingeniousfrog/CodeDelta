import type {
  ChangedFile,
  CodeNode,
  CommitDetail,
  CommitInfo,
  CompareResponse,
  FileDiffResponse,
  GraphDiff,
  ImpactSummary,
  ImportRepoRequest,
  ModelProviderConfig,
  PanoramaEnrichResult,
  PanoramaGraph,
  ProviderKind,
  RepoRef,
  TraceAnswer,
  TraceEvidenceItem,
} from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () =>
    request<{ status: string; product: string; gitAvailable?: boolean }>('/api/health'),

  listRepos: () => request<RepoRef[]>('/api/repos'),

  importRepo: (body: ImportRepoRequest) =>
    request<RepoRef>('/api/repos/import', { method: 'POST', body: JSON.stringify(body) }),

  getRepo: (id: string) => request<RepoRef>(`/api/repos/${id}`),

  listBranches: (id: string) => request<string[]>(`/api/repos/${id}/branches`),

  listCommits: (id: string, branch: string, limit = 50, skip = 0) =>
    request<CommitInfo[]>(
      `/api/repos/${id}/commits?branch=${encodeURIComponent(branch)}&limit=${limit}&skip=${skip}`,
    ),

  getCommit: (id: string, hash: string) =>
    request<CommitDetail>(`/api/repos/${id}/commits/${hash}`),

  compare: (id: string, base: string, head: string) =>
    request<CompareResponse>(
      `/api/repos/${id}/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`,
    ),

  getFileDiff: (id: string, base: string, head: string, file: string) =>
    request<FileDiffResponse>(
      `/api/repos/${id}/diff?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}&file=${encodeURIComponent(file)}`,
    ),

  runTrace: (
    id: string,
    body: { question: string; branch?: string; commitLimit?: number; includeDiffEvidence?: boolean },
  ) =>
    request<TraceAnswer>(`/api/repos/${id}/trace`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getProvider: () => request<ModelProviderConfig>('/api/settings/provider'),

  getCodexAuthStatus: () =>
    request<{
      configured: boolean;
      authMode?: string;
      codexHome: string;
      authPath: string;
      message: string;
      defaultModel?: string;
    }>('/api/settings/provider/codex-status'),

  setProvider: (config: ModelProviderConfig) =>
    request<ModelProviderConfig>('/api/settings/provider', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  getPanorama: (
    id: string,
    params: {
      commit?: string;
      base?: string;
      head?: string;
      root?: string;
      depth?: number;
      maxNodes?: number;
      highlight?: 'trace';
      traceSymbols?: string[];
      traceEntryPoints?: string[];
    },
  ) => {
    const q = new URLSearchParams();
    if (params.commit) q.set('commit', params.commit);
    if (params.base) q.set('base', params.base);
    if (params.head) q.set('head', params.head);
    if (params.root) q.set('root', params.root);
    if (params.depth != null) q.set('depth', String(params.depth));
    if (params.maxNodes != null) q.set('maxNodes', String(params.maxNodes));
    if (params.highlight) q.set('highlight', params.highlight);
    if (params.traceSymbols?.length) q.set('traceSymbols', params.traceSymbols.join(','));
    if (params.traceEntryPoints?.length) q.set('traceEntryPoints', params.traceEntryPoints.join(','));
    return request<PanoramaGraph>(`/api/repos/${id}/panorama?${q.toString()}`);
  },

  enrichPanorama: (id: string, body: { commit: string; nodeIds: string[] }) =>
    request<PanoramaEnrichResult>(`/api/repos/${id}/panorama/enrich`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export type {
  RepoRef,
  CommitInfo,
  CommitDetail,
  ChangedFile,
  CompareResponse,
  FileDiffResponse,
  GraphDiff,
  ImpactSummary,
  TraceAnswer,
  TraceEvidenceItem,
  CodeNode,
  ModelProviderConfig,
  ProviderKind,
  PanoramaGraph,
  PanoramaEnrichResult,
};
