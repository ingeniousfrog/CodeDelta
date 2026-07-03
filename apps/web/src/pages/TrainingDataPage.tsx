import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  api,
  type CommitInfo,
  type RepoRef,
  type TrainingExportArtifact,
  type TrainingExportFormat,
  type TrainingExportMode,
  type TrainingExportStatus,
} from '../api/client';
import { Alert, Badge, Button, Card, CardHeader, FormField, Mono, PageHeader, Select, TextInput } from '../components/ui';

const FORMAT_OPTIONS: Array<{ value: TrainingExportFormat; label: string }> = [
  { value: 'canonical', label: 'Canonical JSONL' },
  { value: 'alpaca', label: 'Alpaca SFT' },
  { value: 'sharegpt', label: 'ShareGPT SFT' },
  { value: 'dpo', label: 'DPO' },
  { value: 'rl', label: 'RL manifest' },
];

const DEFAULT_FORMATS: Record<TrainingExportFormat, boolean> = {
  canonical: true,
  alpaca: false,
  sharegpt: false,
  dpo: false,
  rl: false,
};

function selectedFormats(formats: Record<TrainingExportFormat, boolean>): TrainingExportFormat[] {
  const selected = FORMAT_OPTIONS.filter((option) => formats[option.value]).map((option) => option.value);
  return selected.length ? selected : ['canonical'];
}

function artifactLabel(artifact: TrainingExportArtifact): string {
  return `${artifact.format} · ${(artifact.bytes / 1024).toFixed(1)} KB`;
}

function parsePreview(jsonl: string): Array<{ id: string; instruction: string; files: string }> {
  return jsonl
    .split('\n')
    .filter(Boolean)
    .slice(0, 5)
    .map((line, index) => {
      try {
        const row = JSON.parse(line) as {
          slice?: { id?: string };
          task?: { instruction?: string; minimal_context_files?: string[] };
        };
        return {
          id: row.slice?.id ?? `row-${index + 1}`,
          instruction: row.task?.instruction ?? 'Episode',
          files: row.task?.minimal_context_files?.join(', ') ?? '',
        };
      } catch {
        return { id: `row-${index + 1}`, instruction: 'Unparseable JSONL row', files: '' };
      }
    });
}

export default function TrainingDataPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [mode, setMode] = useState<TrainingExportMode>('range');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [formats, setFormats] = useState<Record<TrainingExportFormat, boolean>>(DEFAULT_FORMATS);
  const [maxChangedFiles, setMaxChangedFiles] = useState(30);
  const [maxDiffBytes, setMaxDiffBytes] = useState(200000);
  const [maxUnrelatedModules, setMaxUnrelatedModules] = useState(4);
  const [includeMergeCommits, setIncludeMergeCommits] = useState(false);
  const [includeDocsOnly, setIncludeDocsOnly] = useState(false);
  const [exportId, setExportId] = useState<string | null>(null);
  const [status, setStatus] = useState<TrainingExportStatus | null>(null);
  const [artifacts, setArtifacts] = useState<TrainingExportArtifact[]>([]);
  const [canonicalText, setCanonicalText] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewRows = useMemo(() => parsePreview(canonicalText), [canonicalText]);

  const loadCommits = useCallback(async (id: string, selectedBranch: string) => {
    const list = await api.listCommits(id, selectedBranch, 100);
    setCommits(list);
    setHead((current) => current || list[0]?.hash || '');
    setBase((current) => current || list[1]?.hash || list[0]?.parents[0] || '');
  }, []);

  useEffect(() => {
    if (!repoId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const ref = await api.getRepo(repoId!);
        if (cancelled) return;
        setRepo(ref);
        const branchList = await api.listBranches(repoId!);
        if (cancelled) return;
        setBranches(branchList);
        const initialBranch = branchList.includes(ref.defaultBranch)
          ? ref.defaultBranch
          : (branchList[0] ?? ref.defaultBranch);
        setBranch(initialBranch);
        await loadCommits(repoId!, initialBranch);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load training data page');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [repoId, loadCommits]);

  useEffect(() => {
    if (!repoId || !branch || loading) return;
    setBase('');
    setHead('');
    loadCommits(repoId, branch).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load commits');
    });
  }, [repoId, branch, loading, loadCommits]);

  useEffect(() => {
    if (!repoId || !exportId || status?.state === 'ready' || status?.state === 'error') return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.getTrainingExportStatus(repoId, exportId);
        setStatus(next);
        if (next.state === 'ready') setRunning(false);
        if (next.state === 'error') {
          setRunning(false);
          setError(next.error ?? 'Training export failed');
        }
      } catch (err) {
        setRunning(false);
        setError(err instanceof Error ? err.message : 'Failed to poll export status');
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [repoId, exportId, status?.state]);

  useEffect(() => {
    if (!repoId || !exportId || status?.state !== 'ready') return;
    let cancelled = false;
    async function loadArtifacts() {
      const list = await api.listTrainingExportArtifacts(repoId!, exportId!);
      if (cancelled) return;
      setArtifacts(list);
      if (list.some((artifact) => artifact.format === 'canonical')) {
        const text = await api.downloadTrainingExport(repoId!, exportId!, 'canonical');
        if (!cancelled) setCanonicalText(text);
      }
    }
    loadArtifacts().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load artifacts'));
    return () => {
      cancelled = true;
    };
  }, [repoId, exportId, status?.state]);

  async function startExport() {
    if (!repoId) return;
    setError(null);
    setCopied(false);
    setCanonicalText('');
    setArtifacts([]);
    setRunning(true);
    try {
      const result = await api.startTrainingExport(repoId, {
        mode,
        branch,
        base: mode === 'range' ? base : undefined,
        head: mode === 'range' ? head : undefined,
        formats: selectedFormats(formats),
        filters: {
          maxChangedFiles,
          maxDiffBytes,
          maxUnrelatedModules,
          includeMergeCommits,
          includeDocsOnly,
        },
      });
      setExportId(result.exportId);
      setStatus({ state: 'generating', exportId: result.exportId, jobId: result.jobId });
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : 'Failed to start export');
    }
  }

  async function copyCanonical() {
    try {
      await navigator.clipboard.writeText(canonicalText);
      setCopied(true);
    } catch {
      setError('Clipboard copy failed');
    }
  }

  if (loading) return <div className="page"><p className="hint">Loading…</p></div>;
  if (error && !repo) return <div className="page"><Alert variant="error">{error}</Alert></div>;
  if (!repo || !repoId) return null;

  const canStart = mode === 'history' || (Boolean(base) && Boolean(head));
  const progress =
    status?.totalIntervals && status.completedIntervals != null
      ? `${status.completedIntervals}/${status.totalIntervals}`
      : status?.state ?? 'idle';

  return (
    <div className="page">
      <PageHeader title="Training Data" description={`${repo.input} · ${repo.source}`} />

      {error && <Alert variant="error">{error}</Alert>}
      {copied && <Alert variant="success">Canonical JSONL copied.</Alert>}

      <div className="split-layout">
        <div>
          <Card>
            <CardHeader title="Source" />
            <div className="training-mode-row">
              <Button variant={mode === 'range' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('range')}>
                Range
              </Button>
              <Button variant={mode === 'history' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('history')}>
                History
              </Button>
            </div>

            <FormField label="Branch">
              <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
            </FormField>

            {mode === 'range' && (
              <div className="training-range-grid">
                <FormField label="Base">
                  <Select value={base} onChange={(e) => setBase(e.target.value)}>
                    {commits.map((commit) => (
                      <option key={commit.hash} value={commit.hash}>
                        {commit.shortHash} · {commit.message}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Head">
                  <Select value={head} onChange={(e) => setHead(e.target.value)}>
                    {commits.map((commit) => (
                      <option key={commit.hash} value={commit.hash}>
                        {commit.shortHash} · {commit.message}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Filters" />
            <div className="training-filter-grid">
              <FormField label="Max changed files">
                <TextInput type="number" min={1} value={maxChangedFiles} onChange={(e) => setMaxChangedFiles(Number(e.target.value))} />
              </FormField>
              <FormField label="Max diff bytes">
                <TextInput type="number" min={1} value={maxDiffBytes} onChange={(e) => setMaxDiffBytes(Number(e.target.value))} />
              </FormField>
              <FormField label="Max unrelated modules">
                <TextInput type="number" min={1} value={maxUnrelatedModules} onChange={(e) => setMaxUnrelatedModules(Number(e.target.value))} />
              </FormField>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={includeMergeCommits} onChange={(e) => setIncludeMergeCommits(e.target.checked)} />
              Include merge commits
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={includeDocsOnly} onChange={(e) => setIncludeDocsOnly(e.target.checked)} />
              Include docs-only commits
            </label>
          </Card>

          <Card>
            <CardHeader title="Formats" />
            <div className="training-format-grid">
              {FORMAT_OPTIONS.map((option) => (
                <label key={option.value} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={formats[option.value]}
                    onChange={(e) => setFormats({ ...formats, [option.value]: e.target.checked })}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <Button variant="primary" disabled={!canStart || running} onClick={startExport}>
              {running ? 'Exporting…' : 'Start export'}
            </Button>
          </Card>
        </div>

        <aside className="sticky-panel">
          <h2>Status</h2>
          <p>
            <Badge variant={status?.state === 'ready' ? 'success' : status?.state === 'generating' ? 'accent' : 'default'}>
              {status?.state ?? 'idle'}
            </Badge>
          </p>
          <dl className="meta-grid">
            <dt>Progress</dt>
            <dd>{progress}</dd>
            <dt>Episodes</dt>
            <dd>{status?.episodes ?? 0}</dd>
            <dt>Skipped</dt>
            <dd>{status?.skipped ?? 0}</dd>
            {exportId && (
              <>
                <dt>Export</dt>
                <dd><Mono>{exportId.slice(0, 8)}</Mono></dd>
              </>
            )}
          </dl>

          {artifacts.length > 0 && (
            <>
              <h3>Artifacts</h3>
              <ul className="file-list">
                {artifacts.map((artifact) => (
                  <li key={`${artifact.format}-${artifact.path}`}>
                    <span className="status-badge">{artifact.format}</span> {artifactLabel(artifact)}
                    {artifact.format !== 'manifest' && (
                      <a
                        className="btn-link training-download-link"
                        href={api.trainingExportDownloadUrl(repoId, exportId as string, artifact.format)}
                      >
                        Download
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {canonicalText && (
            <Button variant="secondary" size="sm" onClick={copyCanonical}>
              Copy canonical JSONL
            </Button>
          )}
        </aside>
      </div>

      {previewRows.length > 0 && (
        <Card>
          <CardHeader title="Preview" />
          <table className="data-table">
            <thead>
              <tr>
                <th>Slice</th>
                <th>Instruction</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.id}>
                  <td><Mono>{row.id}</Mono></td>
                  <td>{row.instruction}</td>
                  <td>{row.files}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
