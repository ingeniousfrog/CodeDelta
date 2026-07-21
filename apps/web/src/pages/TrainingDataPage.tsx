import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const FORMAT_VALUES: TrainingExportFormat[] = ['canonical', 'alpaca', 'sharegpt', 'dpo', 'rl'];

const DEFAULT_FORMATS: Record<TrainingExportFormat, boolean> = {
  canonical: true,
  alpaca: false,
  sharegpt: false,
  dpo: false,
  rl: false,
};

const STEP_I18N_KEYS: Record<string, 'steps.starting' | 'steps.ready' | 'steps.failed' | 'steps.idle'> = {
  'Starting export': 'steps.starting',
  Ready: 'steps.ready',
  Failed: 'steps.failed',
  Idle: 'steps.idle',
};

function selectedFormats(formats: Record<TrainingExportFormat, boolean>): TrainingExportFormat[] {
  const selected = FORMAT_VALUES.filter((value) => formats[value]);
  return selected.length ? selected : ['canonical'];
}

function artifactLabel(artifact: TrainingExportArtifact): string {
  return `${(artifact.bytes / 1024).toFixed(1)} KB`;
}

function commitIndex(commits: CommitInfo[], hash: string): number {
  return commits.findIndex((commit) => commit.hash === hash);
}

function newerThan(commits: CommitInfo[], hash: string): CommitInfo[] {
  const index = commitIndex(commits, hash);
  return index < 0 ? commits : commits.filter((_, i) => i < index);
}

function olderThan(commits: CommitInfo[], hash: string): CommitInfo[] {
  const index = commitIndex(commits, hash);
  return index < 0 ? commits : commits.filter((_, i) => i > index);
}

export default function TrainingDataPage() {
  const { t } = useTranslation(['training', 'common']);
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

  const translateStep = useCallback(
    (step: string) => {
      const key = STEP_I18N_KEYS[step];
      return key ? t(key) : step;
    },
    [t],
  );

  const loadCommits = useCallback(async (id: string, selectedBranch: string) => {
    const list = await api.listCommits(id, selectedBranch, 100);
    setCommits(list);
    setHead((current) => current || list[0]?.hash || '');
    setBase((current) => current || list[1]?.hash || '');
  }, []);

  function setBeforeCommit(hash: string) {
    setBase(hash);
    const beforeIndex = commitIndex(commits, hash);
    const afterIndex = commitIndex(commits, head);
    if (beforeIndex >= 0 && afterIndex >= beforeIndex) {
      setHead(commits[beforeIndex - 1]?.hash ?? '');
    }
  }

  function setAfterCommit(hash: string) {
    setHead(hash);
    const afterIndex = commitIndex(commits, hash);
    const beforeIndex = commitIndex(commits, base);
    if (afterIndex >= 0 && beforeIndex <= afterIndex) {
      setBase(commits[afterIndex + 1]?.hash ?? '');
    }
  }

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
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('errors.loadPage'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [repoId, loadCommits, t]);

  useEffect(() => {
    if (!repoId || !branch || loading) return;
    setBase('');
    setHead('');
    loadCommits(repoId, branch).catch((err) => {
      setError(err instanceof Error ? err.message : t('errors.loadCommits'));
    });
  }, [repoId, branch, loading, loadCommits, t]);

  useEffect(() => {
    if (!repoId || !exportId || status?.state === 'ready' || status?.state === 'error') return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.getTrainingExportStatus(repoId, exportId);
        setStatus(next);
        if (next.state === 'ready') setRunning(false);
        if (next.state === 'error') {
          setRunning(false);
          setError(next.error ?? t('errors.exportFailed'));
        }
      } catch (err) {
        setRunning(false);
        setError(err instanceof Error ? err.message : t('errors.pollFailed'));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [repoId, exportId, status?.state, t]);

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
    loadArtifacts().catch((err) => setError(err instanceof Error ? err.message : t('errors.loadArtifacts')));
    return () => {
      cancelled = true;
    };
  }, [repoId, exportId, status?.state, t]);

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
      setStatus({
        state: 'generating',
        exportId: result.exportId,
        jobId: result.jobId,
        currentStep: 'Starting export',
        episodes: 0,
        skipped: 0,
      });
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : t('errors.startFailed'));
    }
  }

  async function copyCanonical() {
    try {
      await navigator.clipboard.writeText(canonicalText);
      setCopied(true);
    } catch {
      setError(t('errors.clipboard'));
    }
  }

  const jsonlPreviewText = useMemo(() => {
    if (canonicalText) return canonicalText;
    if (status?.state === 'generating') return t('preview.generating');
    if (status?.state === 'ready' && artifacts.length === 0) return t('preview.loadingArtifacts');
    const hasCanonicalArtifact = artifacts.some((artifact) => artifact.format === 'canonical');
    if (status?.state === 'ready' && artifacts.length > 0 && !hasCanonicalArtifact) {
      return t('preview.noCanonicalSelected');
    }
    if (status?.state === 'ready') return t('preview.noRows');
    return t('preview.startHint');
  }, [canonicalText, status?.state, artifacts, t]);

  if (loading) {
    return (
      <div className="page">
        <p className="hint">{t('common:loading')}</p>
      </div>
    );
  }
  if (error && !repo) return <div className="page"><Alert variant="error">{error}</Alert></div>;
  if (!repo || !repoId) return null;

  const canStart = mode === 'history' || (Boolean(base) && Boolean(head));
  const progress =
    status?.totalIntervals != null && status.completedIntervals != null
      ? `${status.completedIntervals}/${status.totalIntervals}`
      : status?.state ?? t('idle');
  const rawStep =
    status?.currentStep ??
    (status?.state === 'ready'
      ? 'Ready'
      : status?.state === 'error'
        ? 'Failed'
        : running
          ? 'Starting export'
          : 'Idle');
  const currentStep = translateStep(rawStep);
  const jsonlPreviewClassName = canonicalText
    ? 'training-jsonl-box'
    : 'training-jsonl-box training-jsonl-box--empty';
  const beforeOptions = olderThan(commits, head);
  const afterOptions = newerThan(commits, base);

  return (
    <div className="page">
      <PageHeader title={t('title')} description={`${repo.input} · ${repo.source}`} />

      {error && <Alert variant="error">{error}</Alert>}
      {copied && <Alert variant="success">{t('copied')}</Alert>}

      <div className="split-layout">
        <div>
          <Card>
            <CardHeader title={t('source')} />
            <div className="training-mode-row">
              <Button variant={mode === 'range' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('range')}>
                {t('range')}
              </Button>
              <Button variant={mode === 'history' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('history')}>
                {t('history')}
              </Button>
            </div>

            <FormField label={t('branch')}>
              <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
            </FormField>

            {mode === 'range' && (
              <div className="training-range-grid">
                <FormField label={t('before')}>
                  <Select value={base} onChange={(e) => setBeforeCommit(e.target.value)}>
                    {beforeOptions.map((commit) => (
                      <option key={commit.hash} value={commit.hash}>
                        {commit.shortHash} · {commit.message}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={t('after')}>
                  <Select value={head} onChange={(e) => setAfterCommit(e.target.value)}>
                    {afterOptions.map((commit) => (
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
            <CardHeader title={t('filters')} />
            <div className="training-filter-grid">
              <FormField label={t('maxChangedFiles')}>
                <TextInput type="number" min={1} value={maxChangedFiles} onChange={(e) => setMaxChangedFiles(Number(e.target.value))} />
              </FormField>
              <FormField label={t('maxDiffBytes')}>
                <TextInput type="number" min={1} value={maxDiffBytes} onChange={(e) => setMaxDiffBytes(Number(e.target.value))} />
              </FormField>
              <FormField label={t('maxUnrelatedModules')}>
                <TextInput type="number" min={1} value={maxUnrelatedModules} onChange={(e) => setMaxUnrelatedModules(Number(e.target.value))} />
              </FormField>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={includeMergeCommits} onChange={(e) => setIncludeMergeCommits(e.target.checked)} />
              {t('includeMerge')}
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={includeDocsOnly} onChange={(e) => setIncludeDocsOnly(e.target.checked)} />
              {t('includeDocs')}
            </label>
          </Card>

          <Card>
            <CardHeader title={t('formats')} />
            <div className="training-format-grid">
              {FORMAT_VALUES.map((value) => (
                <label key={value} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={formats[value]}
                    onChange={(e) => setFormats({ ...formats, [value]: e.target.checked })}
                  />
                  {t(`formatLabels.${value}`)}
                </label>
              ))}
            </div>
            <Button variant="primary" disabled={!canStart || running} onClick={startExport}>
              {running ? t('exporting') : t('startExport')}
            </Button>
          </Card>
        </div>

        <aside className="sticky-panel">
          <h2>{t('status')}</h2>
          <p>
            <Badge variant={status?.state === 'ready' ? 'success' : status?.state === 'generating' ? 'accent' : 'default'}>
              {status?.state ?? t('idle')}
            </Badge>
          </p>
          <dl className="meta-grid">
            <dt>{t('step')}</dt>
            <dd className="training-status-step">{currentStep}</dd>
            {status?.currentCommit && (
              <>
                <dt>{t('commit')}</dt>
                <dd><Mono>{status.currentCommit}</Mono></dd>
              </>
            )}
            <dt>{t('progress')}</dt>
            <dd>{progress}</dd>
            <dt>{t('slices')}</dt>
            <dd>{status?.episodes ?? 0}</dd>
            <dt>{t('skipped')}</dt>
            <dd>{status?.skipped ?? 0}</dd>
            {exportId && (
              <>
                <dt>{t('export')}</dt>
                <dd><Mono>{exportId.slice(0, 8)}</Mono></dd>
              </>
            )}
          </dl>

          {artifacts.length > 0 && (
            <>
              <h3>{t('artifacts')}</h3>
              <ul className="file-list">
                {artifacts.map((artifact) => (
                  <li key={`${artifact.format}-${artifact.path}`}>
                    <span className="status-badge">{artifact.format}</span> {artifactLabel(artifact)}
                    {artifact.format !== 'manifest' && (
                      <a
                        className="btn-link training-download-link"
                        href={api.trainingExportDownloadUrl(repoId, exportId as string, artifact.format)}
                      >
                        {t('download')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {canonicalText && (
            <Button variant="secondary" size="sm" onClick={copyCanonical}>
              {t('copyCanonical')}
            </Button>
          )}

          <section className="training-jsonl-preview">
            <h3>{t('jsonlPreview')}</h3>
            <pre className={jsonlPreviewClassName}>{jsonlPreviewText}</pre>
          </section>
        </aside>
      </div>
    </div>
  );
}
