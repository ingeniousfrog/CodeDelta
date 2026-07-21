import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, type RepoRef } from '../api/client';
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
  const { t } = useTranslation(['import', 'common']);
  const navigate = useNavigate();
  const [githubUrl, setGithubUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentRepos, setRecentRepos] = useState<RepoRef[]>([]);

  useEffect(() => {
    api
      .listRepos()
      .then(setRecentRepos)
      .catch(() => setRecentRepos([]));
  }, []);

  async function handleImport(source: 'github' | 'local', input: string) {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const ref = await api.importRepo({ source, input: input.trim() });
      navigate(`/repos/${ref.id}/timeline`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:errors.importFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title={t('title')} description={t('description')} />

      {error && <Alert variant="error">{error}</Alert>}

      {recentRepos.length > 0 && (
        <Card>
          <CardHeader title={t('recentTitle')} description={t('recentDesc')} />
          <ul className="recent-repos-list">
            {recentRepos.map((repo) => (
              <li key={repo.id}>
                <Button
                  variant="secondary"
                  disabled={loading}
                  onClick={() => navigate(`/repos/${repo.id}/timeline`)}
                >
                  {repo.input}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="page-grid-2">
        <Card>
          <CardHeader title={t('githubTitle')} description={t('githubDesc')} />
          <FormField label={t('repoLabel')} htmlFor="github-url">
            <TextInput
              id="github-url"
              type="text"
              placeholder={t('githubPlaceholder')}
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
            {loading ? t('importing') : t('importGithub')}
          </Button>
        </Card>

        <Card>
          <CardHeader title={t('localTitle')} description={t('localDesc')} />
          <FormField label={t('pathLabel')} htmlFor="local-path">
            <TextInput
              id="local-path"
              type="text"
              placeholder={t('localPlaceholder')}
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
            {loading ? t('opening') : t('openLocal')}
          </Button>
        </Card>
      </div>
    </div>
  );
}
