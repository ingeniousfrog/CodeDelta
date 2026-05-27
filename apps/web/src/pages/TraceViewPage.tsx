import { useParams, useSearchParams } from 'react-router-dom';

export default function TraceViewPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [searchParams] = useSearchParams();
  const candidate = searchParams.get('candidate') ?? '';

  return (
    <div className="page">
      <h1>Trace View</h1>
      <p className="lead">
        Describe a bug, behavior change, or architecture question. CodeDelta traces candidate
        commits with evidence — without inventing facts.
      </p>

      <div className="card">
        <label htmlFor="issue">Issue description</label>
        <textarea
          id="issue"
          rows={5}
          placeholder="e.g. When did the login redirect start failing after OAuth callback?"
          disabled
        />
        <button type="button" disabled className="mt">
          Run Trace (Phase 3)
        </button>
      </div>

      <div className="placeholder card">
        <h2>Coming in Phase 3</h2>
        <p>
          Trace View will retrieve candidate commits from messages, changed files, and structural
          diffs, then produce an evidence-grounded answer with confidence and uncertainty.
        </p>
        {candidate && (
          <p>
            Candidate context from timeline: <code>{candidate.slice(0, 12)}</code>
          </p>
        )}
        {!repoId && <p className="muted">Import a repository first.</p>}
      </div>
    </div>
  );
}
