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
  ProviderKind,
  RepoRef,
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
  health: () => request<{ status: string; product: string }>('/api/health'),

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

  getProvider: () => request<ModelProviderConfig>('/api/settings/provider'),

  setProvider: (config: ModelProviderConfig) =>
    request<ModelProviderConfig>('/api/settings/provider', {
      method: 'PUT',
      body: JSON.stringify(config),
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
  CodeNode,
  ModelProviderConfig,
  ProviderKind,
};
