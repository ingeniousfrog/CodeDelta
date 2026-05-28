import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type ChangedFile, type CommitDetail, type CommitInfo, type RepoRef } from '../api/client';

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

  const loadCommits = useCallback(
    async (id: string, b: string) => {
      const list = await api.listCommits(id, b);
      setCommits(list);
    },
    [],
  );

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

  function openTrace(candidate: string) {
    navigate(`/repos/${repoId}/trace?candidate=${candidate}`);
  }

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;
  if (error) return <div className="page"><div className="alert error">{error}</div></div>;
  if (!repo || !repoId) return null;

  return (
    <div className="page">
      <h1>Commit Timeline</h1>
      <p className="lead">
        <strong>{repo.input}</strong>
        <span className="muted"> · {repo.source}</span>
      </p>

      <div className="toolbar">
        <label>
          Branch
          <select value={branch} onChange={(e) => setBranch(e.target.value)}>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="split">
        <table className="commits-table">
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
                <td><code>{c.shortHash}</code></td>
                <td>{c.message}</td>
                <td>{c.author}</td>
                <td>{new Date(c.date).toLocaleString()}</td>
                <td>{c.changedFilesCount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <aside className="detail-panel">
          {selected ? (
            <>
              <h2>{selected.shortHash}</h2>
              <p>{selected.message}</p>
              <dl className="meta">
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
                    <span className={`status status-${f.status}`}>{f.status[0]?.toUpperCase()}</span>
                    {f.path}
                  </li>
                ))}
              </ul>

              <div className="actions">
                <button
                  type="button"
                  disabled={!selected.parents[0]}
                  title={selected.parents[0] ? 'Compare this commit with its parent' : 'Root commit has no parent'}
                  onClick={() => {
                    if (selected.parents[0]) openDelta(selected.parents[0], selected.hash);
                  }}
                >
                  Compare with previous commit
                </button>
                <button type="button" onClick={() => openTrace(selected.hash)}>
                  Open in Trace View
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Select a commit to view details and quick actions.</p>
          )}
        </aside>
      </div>

      <p className="footer-note">
        Need another repo? <Link to="/import">Import again</Link>
      </p>
    </div>
  );
}
