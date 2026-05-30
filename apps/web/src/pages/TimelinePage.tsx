import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type ChangedFile, type CommitDetail, type CommitInfo, type RepoRef } from '../api/client';
import { Alert, Button, Card, FormField, Mono, PageHeader, Select } from '../components/ui';

export default function TimelinePage() {
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
          setError(err instanceof Error ? err.message : 'Failed to load repository');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [repoId, searchParams, loadCommits]);

  useEffect(() => {
    if (!repoId || !branch || loading) return;
    loadCommits(repoId, branch).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load commits');
    });
  }, [repoId, branch, loading, loadCommits]);

  async function selectCommit(hash: string) {
    if (!repoId) return;
    try {
      const detail = await api.getCommit(repoId, hash);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commit');
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
        <p className="hint">Loading…</p>
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
        title="Commit Timeline"
        description={`${repo.input} · ${repo.source}`}
        actions={
          <FormField label="Branch">
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
                <th>Hash</th>
                <th>Message</th>
                <th>Author</th>
                <th>Date</th>
                <th>Files</th>
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
                <dt>Author</dt>
                <dd>{selected.author}</dd>
                <dt>Date</dt>
                <dd>{new Date(selected.date).toLocaleString()}</dd>
                <dt>Changed files</dt>
                <dd>{selected.changedFilesCount}</dd>
              </dl>

              <h3>Changed files</h3>
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
                  title={selected.parents[0] ? 'Compare with parent commit' : 'Root commit has no parent'}
                  onClick={() => {
                    if (selected.parents[0]) openDelta(selected.parents[0], selected.hash);
                  }}
                >
                  Open in Delta View
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openTrace(selected.hash)}>
                  Open in Trace View
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openPanorama(selected.hash)}>
                  Open in Panorama
                </Button>
              </div>
            </>
          ) : (
            <p className="hint">Select a commit to view details and quick actions.</p>
          )}
        </aside>
      </div>

      <p className="footer-note">
        Need another repository? <Link to="/import">Import again</Link>
      </p>
    </div>
  );
}
