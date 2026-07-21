import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type ChangedFile, type CommitDetail, type CommitInfo, type RepoRef } from '../api/client';
import { Alert, Button, Card, FormField, Mono, PageHeader, Select } from '../components/ui';

export default function TimelinePage() {
  const { t } = useTranslation(['timeline', 'common']);
  const { repoId } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [selected, setSelected] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCommits = useCallback(async (id: string, b: string) => {
    const list = await api.listCommits(id, b);
    setCommits(list);
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

        const initialBranch = searchParams.get('branch') ?? ref.defaultBranch;
        setBranch(branchList.includes(initialBranch) ? initialBranch : (branchList[0] ?? ref.defaultBranch));

        await loadCommits(repoId!, initialBranch);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('common:errors.loadRepoFailed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [repoId, searchParams, loadCommits, t]);

  useEffect(() => {
    if (!repoId || !branch || loading) return;
    loadCommits(repoId, branch).catch((err) => {
      setError(err instanceof Error ? err.message : t('common:errors.loadCommitsFailed'));
    });
  }, [repoId, branch, loading, loadCommits, t]);

  async function selectCommit(hash: string) {
    if (!repoId) return;
    try {
      const detail = await api.getCommit(repoId, hash);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:errors.loadCommitFailed'));
    }
  }

  function openDelta(base: string, head: string) {
    navigate(`/repos/${repoId}/delta?base=${base}&head=${head}`);
  }

  function openPanorama(commitHash: string) {
    navigate(`/repos/${repoId}/panorama?commit=${commitHash}&branch=${encodeURIComponent(branch)}`);
  }

  function openTrace(commitHash: string) {
    navigate(`/repos/${repoId}/trace?candidate=${commitHash}`);
  }

  if (loading) {
    return (
      <div className="page">
        <p className="hint">{t('common:loading')}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <Alert variant="error">{error}</Alert>
      </div>
    );
  }
  if (!repo || !repoId) return null;

  return (
    <div className="page">
      <PageHeader
        title={t('title')}
        description={`${repo.input} · ${repo.source}`}
        actions={
          <FormField label={t('branch')}>
            <Select value={branch} onChange={(e) => setBranch(e.target.value)} style={{ minWidth: 160 }}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </FormField>
        }
      />

      <div className="split-layout">
        <Card style={{ marginBottom: 0, padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('table.hash')}</th>
                <th>{t('table.message')}</th>
                <th>{t('table.author')}</th>
                <th>{t('table.date')}</th>
                <th>{t('table.files')}</th>
              </tr>
            </thead>
            <tbody>
              {commits.map((c) => (
                <tr
                  key={c.hash}
                  className={selected?.hash === c.hash ? 'selected' : ''}
                  onClick={() => selectCommit(c.hash)}
                >
                  <td>
                    <Mono>{c.shortHash}</Mono>
                  </td>
                  <td>{c.message}</td>
                  <td>{c.author}</td>
                  <td>{new Date(c.date).toLocaleString()}</td>
                  <td>{c.changedFilesCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <aside className="sticky-panel">
          {selected ? (
            <>
              <h2>
                <Mono>{selected.shortHash}</Mono>
              </h2>
              <p>{selected.message}</p>
              <dl className="meta-grid">
                <dt>{t('meta.author')}</dt>
                <dd>{selected.author}</dd>
                <dt>{t('meta.date')}</dt>
                <dd>{new Date(selected.date).toLocaleString()}</dd>
                <dt>{t('meta.changedFiles')}</dt>
                <dd>{selected.changedFilesCount}</dd>
              </dl>

              <h3>{t('changedFiles')}</h3>
              <ul className="file-list">
                {selected.changedFiles.map((f: ChangedFile) => (
                  <li key={f.path}>
                    <span className="status-badge">{f.status}</span> {f.path}
                  </li>
                ))}
              </ul>

              <div className="btn-row">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!selected.parents[0]}
                  title={selected.parents[0] ? t('compareParent') : t('rootNoParent')}
                  onClick={() => {
                    if (selected.parents[0]) openDelta(selected.parents[0], selected.hash);
                  }}
                >
                  {t('openDelta')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openTrace(selected.hash)}>
                  {t('openTrace')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openPanorama(selected.hash)}>
                  {t('openPanorama')}
                </Button>
              </div>
            </>
          ) : (
            <p className="hint">{t('selectHint')}</p>
          )}
        </aside>
      </div>

      <p className="footer-note">
        {t('footer')} <Link to="/import">{t('importAgain')}</Link>
      </p>
    </div>
  );
}
