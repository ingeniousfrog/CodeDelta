import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type TraceAnswer } from '../api/client';

export default function TraceViewPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const candidate = searchParams.get('candidate') ?? '';

  const [branches, setBranches] = useState<string[]>([]);
  const [question, setQuestion] = useState(
    candidate
      ? `Which commit likely introduced issue around ${candidate.slice(0, 7)}? Please trace evidence.`
      : '',
  );
  const [branch, setBranch] = useState('');
  const [commitLimit, setCommitLimit] = useState(50);
  const [includeDiffEvidence, setIncludeDiffEvidence] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceAnswer | null>(null);

  useEffect(() => {
    if (!repoId) return;
    api
      .listBranches(repoId)
      .then((items) => {
        setBranches(items);
        if (!branch) setBranch(items[0] ?? '');
      })
      .catch(() => {
        setBranches([]);
      });
  }, [repoId]);

  async function runTrace() {
    if (!repoId || !question.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.runTrace(repoId, {
        question: question.trim(),
        branch: branch || undefined,
        commitLimit,
        includeDiffEvidence,
      });
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Trace failed');
    } finally {
      setLoading(false);
    }
  }

  function openDelta(base: string, head: string) {
    if (!repoId) return;
    navigate(`/repos/${repoId}/delta?base=${base}&head=${head}`);
  }

  return (
    <div className="page">
      <h1>Trace View</h1>
      <p className="lead">
        Evidence-first commit tracing for issue origin analysis. Candidate commits and conclusions are
        grounded in retrievable evidence.
      </p>

      <div className="card">
        <label htmlFor="trace-question">Issue description</label>
        <textarea
          id="trace-question"
          rows={4}
          placeholder="e.g. When did login redirect start failing after OAuth callback?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="row">
          <label>
            Branch
            <select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Default branch</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label>
            Commit limit
            <select value={String(commitLimit)} onChange={(e) => setCommitLimit(Number(e.target.value))}>
              <option value="30">30</option>
              <option value="50">50</option>
              <option value="80">80</option>
              <option value="120">120</option>
            </select>
          </label>
          <label>
            Diff evidence
            <select
              value={includeDiffEvidence ? 'yes' : 'no'}
              onChange={(e) => setIncludeDiffEvidence(e.target.value === 'yes')}
            >
              <option value="yes">Include</option>
              <option value="no">Skip</option>
            </select>
          </label>
        </div>
        <button type="button" onClick={runTrace} disabled={loading || !question.trim()}>
          {loading ? 'Tracing...' : 'Run Trace'}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {result && (
        <>
          <section className="card">
            <h2>Direct answer</h2>
            <p>{result.directAnswer}</p>
            {result.directAnswerEvidenceRefs?.length ? (
              <p className="hint">Evidence refs: {result.directAnswerEvidenceRefs.join(', ')}</p>
            ) : null}
            <p className="hint">
              Confidence: <strong>{result.confidence}</strong>
            </p>
            {result.mostLikelyCommit && (
              <p>
                Most likely commit: <strong>{result.mostLikelyCommit.shortHash}</strong> —{' '}
                {result.mostLikelyCommit.message}
              </p>
            )}
          </section>

          <section className="card">
            <h2>Candidate commits</h2>
            <ul className="file-list">
              {result.candidates.map((c) => (
                <li key={c.commit.hash}>
                  <strong>{c.commit.shortHash}</strong> — {c.commit.message} (score {c.relevanceScore})
                  <div className="hint">{c.reasons.join(' | ')}</div>
                  {c.impactSummary?.riskTags?.length ? (
                    <div className="hint">risk tags: {c.impactSummary.riskTags.join(', ')}</div>
                  ) : null}
                  {c.previousCommitHash ? (
                    <button
                      className="linkish"
                      type="button"
                      onClick={() => openDelta(c.previousCommitHash as string, c.commit.hash)}
                    >
                      Compare previous → candidate in Delta View
                    </button>
                  ) : (
                    <div className="hint">No previous commit available for Delta comparison.</div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Evidence</h2>
            <ul className="file-list">
              {result.evidence.map((ev) => (
                <li key={ev.id}>
                  [{ev.kind}] {ev.commitHash.slice(0, 7)} — {ev.title}
                  <div className="hint">{ev.detail}</div>
                  {ev.file && result.candidates.find((c) => c.commit.hash === ev.commitHash)?.previousCommitHash && (
                    <button
                      className="linkish"
                      type="button"
                      onClick={() =>
                        openDelta(
                          result.candidates.find((c) => c.commit.hash === ev.commitHash)
                            ?.previousCommitHash as string,
                          ev.commitHash,
                        )
                      }
                    >
                      Open Delta for this evidence
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Impact radius</h2>
            <p className="hint">Files: {result.impactRadius.files.slice(0, 10).join(', ') || 'none'}</p>
            <p className="hint">Symbols: {result.impactRadius.symbols.slice(0, 10).join(', ') || 'none'}</p>
            <p className="hint">
              Entry points: {result.impactRadius.entryPoints.slice(0, 10).join(', ') || 'none'}
            </p>
            <p className="hint">Risk tags: {result.impactRadius.riskTags.join(', ') || 'none'}</p>
          </section>

          <section className="card">
            <h2>Evolution</h2>
            <ul className="file-list">
              {result.evolution.map((s, i) => (
                <li key={`${s.label}-${i}`}>
                  <strong>{s.label}</strong> {s.commitHash ? `(${s.commitHash.slice(0, 7)})` : ''} — {s.summary}
                  {s.evidenceRefs.length > 0 && (
                    <div className="hint">Evidence refs: {s.evidenceRefs.join(', ')}</div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Uncertainty</h2>
            <ul className="file-list">
              {result.uncertainty.length === 0 && <li className="muted">No major uncertainty reported.</li>}
              {result.uncertainty.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
            {result.uncertaintyEvidenceRefs?.length ? (
              <p className="hint">Uncertainty refs: {result.uncertaintyEvidenceRefs.join(', ')}</p>
            ) : null}
            <h3>Suggested next checks</h3>
            <ul className="file-list">
              {result.suggestedNextChecks.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      {!result && !loading && !error && (
        <p className="muted">
          Run trace with a concrete issue question. You can also start from{' '}
          <Link to={`/repos/${repoId}/timeline`}>Commit Timeline</Link>.
        </p>
      )}
    </div>
  );
}
