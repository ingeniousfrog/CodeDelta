import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function ImportPage() {
  const navigate = useNavigate();
  const [githubUrl, setGithubUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport(source: 'github' | 'local', input: string) {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const ref = await api.importRepo({ source, input: input.trim() });
      navigate(`/repos/${ref.id}/timeline`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1>Import Repository</h1>
      <p className="lead">
        Import a public GitHub repository or open a local git path. CodeDelta lists commits first
        and builds structural graph snapshots only when you analyze them.
      </p>

      {error && <div className="alert error">{error}</div>}

      <section className="card">
        <h2>GitHub URL</h2>
        <p className="hint">Public repositories only in this version.</p>
        <div className="row">
          <input
            type="text"
            placeholder="https://github.com/owner/repo or owner/repo"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            disabled={loading}
          />
          <button
            type="button"
            disabled={loading || !githubUrl.trim()}
            onClick={() => handleImport('github', githubUrl)}
          >
            {loading ? 'Importing…' : 'Import from GitHub'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Local Path</h2>
        <p className="hint">Absolute path to a git repository on this machine.</p>
        <div className="row">
          <input
            type="text"
            placeholder="/Users/you/projects/my-repo"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            disabled={loading}
          />
          <button
            type="button"
            disabled={loading || !localPath.trim()}
            onClick={() => handleImport('local', localPath)}
          >
            {loading ? 'Opening…' : 'Open Local Repo'}
          </button>
        </div>
      </section>
    </div>
  );
}
