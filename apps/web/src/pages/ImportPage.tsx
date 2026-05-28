import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  FormField,
  PageHeader,
  TextInput,
} from '../components/ui';

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
      <PageHeader
        title="Import Repository"
        description="Import a public GitHub repository or open a local git path. Commits are listed immediately; structural snapshots are built lazily when you compare or trace."
      />

      {error && <Alert variant="error">{error}</Alert>}

      <div className="page-grid-2">
        <Card>
          <CardHeader title="GitHub URL" description="Public repositories only in this version." />
          <FormField label="Repository" htmlFor="github-url">
            <TextInput
              id="github-url"
              type="text"
              placeholder="https://github.com/owner/repo or owner/repo"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              disabled={loading}
            />
          </FormField>
          <Button
            variant="primary"
            disabled={loading || !githubUrl.trim()}
            onClick={() => handleImport('github', githubUrl)}
          >
            {loading ? 'Importing…' : 'Import from GitHub'}
          </Button>
        </Card>

        <Card>
          <CardHeader title="Local path" description="Absolute path to a git repository on this machine." />
          <FormField label="Path" htmlFor="local-path">
            <TextInput
              id="local-path"
              type="text"
              placeholder="/Users/you/projects/my-repo"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              disabled={loading}
            />
          </FormField>
          <Button
            variant="primary"
            disabled={loading || !localPath.trim()}
            onClick={() => handleImport('local', localPath)}
          >
            {loading ? 'Opening…' : 'Open local repository'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
