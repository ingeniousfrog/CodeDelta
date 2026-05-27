import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type RepoRef } from '../api/client';

export default function DeltaViewPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [searchParams] = useSearchParams();
  const base = searchParams.get('base') ?? '';
  const head = searchParams.get('head') ?? '';

  const [repo, setRepo] = useState<RepoRef | null>(null);

  useEffect(() => {
    if (!repoId) return;
    api.getRepo(repoId).then(setRepo).catch(() => setRepo(null));
  }, [repoId]);

  return (
    <div className="page">
      <h1>Delta View</h1>
      <p className="lead">
        Compare commits and visualize structural code changes — symbols, dependency edges, and
        impact radius. Not a line-level text diff.
      </p>

      <div className="placeholder card">
        <h2>Coming in Phase 2</h2>
        <p>
          Graph snapshot diff is not built yet. Select base and head commits from the{' '}
          <Link to={`/repos/${repoId}/timeline`}>Commit Timeline</Link> to prepare your comparison.
        </p>

        {repo && (
          <dl className="meta">
            <dt>Repository</dt>
            <dd>{repo.input}</dd>
            <dt>Base commit</dt>
            <dd>{base ? <code>{base.slice(0, 12)}</code> : <span className="muted">not selected</span>}</dd>
            <dt>Head commit</dt>
            <dd>{head ? <code>{head.slice(0, 12)}</code> : <span className="muted">not selected</span>}</dd>
          </dl>
        )}

        <p className="hint">
          Delta View will show: changed symbols, changed dependency edges, affected modules,
          impacted entry points, and review suggestions.
        </p>
      </div>
    </div>
  );
}
