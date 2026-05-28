import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type TraceAnswer } from '../api/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FormField,
  Mono,
  PageHeader,
  Select,
  TextArea,
} from '../components/ui';
import type { TraceEvidenceItem } from '../types';
import { clearTraceSession, loadTraceSession, saveTraceSession } from '../lib/trace-cache';

const EVIDENCE_KIND_LABEL: Record<string, string> = {
  'commit-message': 'Commit message',
  'changed-file': 'Changed file',
  'changed-symbol': 'Changed symbol',
  'edge-change': 'Dependency edge',
  'risk-tag': 'Risk tag',
  'entry-point': 'Entry point',
  'code-diff': 'Code diff',
  'delta-summary': 'Delta summary',
  'delta-unavailable': 'Delta unavailable',
};

const EVOLUTION_LABEL: Record<string, string> = {
  before: 'Before',
  candidate: 'Candidate',
  after: 'After',
  current: 'Current',
};

function confidenceHint(level: string): string {
  switch (level) {
    case 'high':
      return 'Strong match to your question; verify in Delta View first.';
    case 'medium':
      return 'Moderate signals; cross-check candidates and diffs.';
    default:
      return 'Weak or short history; treat as directional only.';
  }
}

function formatProviderNote(result: TraceAnswer): string | null {
  const p = result.provider;
  if (!p?.used) return null;
  if (p.nonAuthoritativeText) {
    return 'Model output failed validation; showing deterministic analysis only.';
  }
  return `Refined with ${p.type}${p.model ? ` (${p.model})` : ''}; evidence and Delta verification remain authoritative.`;
}

function groupEvidenceByCommit(evidence: TraceEvidenceItem[]): Map<string, TraceEvidenceItem[]> {
  const map = new Map<string, TraceEvidenceItem[]>();
  for (const ev of evidence) {
    const list = map.get(ev.commitHash) ?? [];
    list.push(ev);
    map.set(ev.commitHash, list);
  }
  return map;
}

export default function TraceViewPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const candidate = searchParams.get('candidate') ?? '';

  const [branches, setBranches] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [branch, setBranch] = useState('');
  const [commitLimit, setCommitLimit] = useState(50);
  const [includeDiffEvidence, setIncludeDiffEvidence] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceAnswer | null>(null);
  const [restored, setRestored] = useState(false);

  const persist = useCallback(
    (next: TraceAnswer, q: string, b: string, limit: number, diffEv: boolean) => {
      if (!repoId) return;
      saveTraceSession(repoId, {
        question: q,
        branch: b,
        commitLimit: limit,
        includeDiffEvidence: diffEv,
        result: next,
      });
    },
    [repoId],
  );

  useEffect(() => {
    if (!repoId) return;
    const cached = loadTraceSession(repoId);
    if (cached) {
      setQuestion(cached.question);
      setBranch(cached.branch);
      setCommitLimit(cached.commitLimit);
      setIncludeDiffEvidence(cached.includeDiffEvidence);
      setResult(cached.result);
      setRestored(true);
    } else if (candidate) {
      setQuestion(`Which commit likely introduced an issue related to ${candidate.slice(0, 7)}?`);
    }
  }, [repoId, candidate]);

  useEffect(() => {
    if (!repoId) return;
    api
      .listBranches(repoId)
      .then((items) => {
        setBranches(items);
        setBranch((prev) => prev || items[0] || '');
      })
      .catch(() => setBranches([]));
  }, [repoId]);

  async function runTrace() {
    if (!repoId || !question.trim()) return;
    setLoading(true);
    setError(null);
    setRestored(false);
    try {
      const data = await api.runTrace(repoId, {
        question: question.trim(),
        branch: branch || undefined,
        commitLimit,
        includeDiffEvidence,
      });
      setResult(data);
      persist(data, question.trim(), branch, commitLimit, includeDiffEvidence);
    } catch (err) {
      setResult(null);
      if (repoId) clearTraceSession(repoId);
      setError(err instanceof Error ? err.message : 'Trace failed');
    } finally {
      setLoading(false);
    }
  }

  function openDelta(base: string, head: string) {
    if (!repoId) return;
    if (result) {
      persist(result, question, branch, commitLimit, includeDiffEvidence);
    }
    navigate(`/repos/${repoId}/delta?base=${base}&head=${head}&from=trace`);
  }

  const topCandidate = result?.candidates[0];
  const providerNote = result ? formatProviderNote(result) : null;
  const evidenceByCommit = useMemo(
    () => (result ? groupEvidenceByCommit(result.evidence) : new Map()),
    [result],
  );

  const userFacingUncertainty = useMemo(() => {
    if (!result) return [];
    return result.uncertainty.filter(
      (u) => !u.startsWith('Provider failed') && !u.startsWith('Provider output rejected'),
    );
  }, [result]);

  const providerWarnings = useMemo(() => {
    if (!result) return [];
    return result.uncertainty.filter(
      (u) => u.startsWith('Provider failed') || u.startsWith('Provider output rejected'),
    );
  }, [result]);

  return (
    <div className="page">
      <PageHeader
        title="Trace View"
        description="Find commits that may have introduced a behavior change from your description, with evidence you can verify in Delta View."
      />

      {restored && result && (
        <Alert variant="success">Restored your previous trace results (navigation-safe).</Alert>
      )}

      <Card>
        <FormField label="Issue description" htmlFor="trace-question">
          <TextArea
            id="trace-question"
            rows={3}
            placeholder="e.g. When did login redirect start failing after the OAuth callback?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </FormField>
        <div className="form-row">
          <FormField label="Branch">
            <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Default branch</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Commits to scan">
            <Select value={String(commitLimit)} onChange={(e) => setCommitLimit(Number(e.target.value))}>
              <option value="30">30</option>
              <option value="50">50</option>
              <option value="80">80</option>
              <option value="120">120</option>
            </Select>
          </FormField>
          <FormField label="Include diff evidence">
            <Select
              value={includeDiffEvidence ? 'yes' : 'no'}
              onChange={(e) => setIncludeDiffEvidence(e.target.value === 'yes')}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </FormField>
        </div>
        <div className="btn-row">
          <Button variant="primary" onClick={runTrace} disabled={loading || !question.trim()}>
            {loading ? 'Tracing…' : 'Run trace'}
          </Button>
          {result && (
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setRestored(false);
                if (repoId) clearTraceSession(repoId);
              }}
            >
              Clear results
            </Button>
          )}
        </div>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {result && (
        <>
          <Card className="panel-highlight">
            <CardHeader title="Conclusion" />
            <div className="trace-summary-layout">
              <div>
                <p className="trace-direct-answer">{result.directAnswer}</p>
                <p className="hint">{confidenceHint(result.confidence)}</p>
                {result.mostLikelyCommit && (
                  <p style={{ marginTop: '0.75rem' }}>
                    <Mono>{result.mostLikelyCommit.shortHash}</Mono>
                    <span className="hint"> — {result.mostLikelyCommit.message}</span>
                  </p>
                )}
                {providerNote && <p className="hint" style={{ marginTop: '0.5rem' }}>{providerNote}</p>}
              </div>
              <div className="trace-summary-aside">
                <Badge variant="accent">Confidence: {result.confidence}</Badge>
                {topCandidate?.previousCommitHash && result.mostLikelyCommit && (
                  <Button
                    variant="primary"
                    onClick={() => openDelta(topCandidate.previousCommitHash!, result.mostLikelyCommit!.hash)}
                  >
                    Verify in Delta View
                  </Button>
                )}
              </div>
            </div>
            {providerWarnings.length > 0 && (
              <Alert variant="warning" title="AI assist unavailable">
                <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                  {providerWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <p className="form-hint" style={{ marginTop: '0.5rem' }}>
                  Candidates and evidence below are still valid. Ensure <code className="mono">codex login</code>{' '}
                  works on this machine, then restart <code className="mono">npm run dev:codedelta</code> and retry.
                </p>
              </Alert>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Candidate commits"
              description="Higher score means stronger lexical/structural signals — not guaranteed root cause."
            />
            <ul className="candidate-list">
              {result.candidates.map((c, idx) => (
                <li key={c.commit.hash} className={`candidate-item ${idx === 0 ? 'candidate-item-top' : ''}`}>
                  <div className="candidate-head">
                    <span className="candidate-rank">#{idx + 1}</span>
                    <strong>
                      <Mono>{c.commit.shortHash}</Mono>
                    </strong>
                    <span className="candidate-score">Score {c.relevanceScore}</span>
                  </div>
                  <p>{c.commit.message}</p>
                  <p className="hint">{c.reasons.join(' · ')}</p>
                  {c.changedFiles.length > 0 && (
                    <p className="hint">
                      Files: {c.changedFiles
                        .slice(0, 5)
                        .map((f) => f.path)
                        .join(', ')}
                      {c.changedFiles.length > 5 ? ` (+${c.changedFiles.length - 5} more)` : ''}
                    </p>
                  )}
                  {c.previousCommitHash ? (
                    <Button variant="link" onClick={() => openDelta(c.previousCommitHash!, c.commit.hash)}>
                      Compare parent → this commit in Delta
                    </Button>
                  ) : (
                    <p className="hint">No parent commit for structural comparison.</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <details className="card details-card">
            <summary>Change timeline</summary>
            <div className="details-body">
              <ul className="file-list">
                {result.evolution.map((s, i) => (
                  <li key={`${s.label}-${i}`}>
                    <strong>{EVOLUTION_LABEL[s.label] ?? s.label}</strong>
                    {s.commitHash ? ` (${s.commitHash.slice(0, 7)})` : ''} — {s.summary}
                  </li>
                ))}
              </ul>
            </div>
          </details>

          <details className="card details-card">
            <summary>
              Impact overview ({result.impactRadius.files.length} files · {result.impactRadius.symbols.length}{' '}
              symbols)
            </summary>
            <div className="details-body">
              <p className="hint">Risk tags: {result.impactRadius.riskTags.join(', ') || 'none'}</p>
              <p className="hint">
                Entry points: {result.impactRadius.entryPoints.slice(0, 8).join(', ') || 'none detected'}
              </p>
            </div>
          </details>

          {(userFacingUncertainty.length > 0 || result.suggestedNextChecks.length > 0) && (
            <details className="card details-card" open>
              <summary>Uncertainty and next steps</summary>
              <div className="details-body">
                {userFacingUncertainty.length > 0 && (
                  <ul className="file-list">
                    {userFacingUncertainty.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                )}
                {result.suggestedNextChecks.length > 0 && (
                  <>
                    <h3>Suggested checks</h3>
                    <ul className="file-list">
                      {result.suggestedNextChecks.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </details>
          )}

          <details className="card details-card">
            <summary>Evidence details ({result.evidence.length} items)</summary>
            <div className="details-body">
              <p className="hint">Each item maps to a commit. Open Delta for code-level verification.</p>
              {Array.from(evidenceByCommit.entries()).map(([hash, items]: [string, TraceEvidenceItem[]]) => (
                <div key={hash} className="evidence-group">
                  <h3>
                    <Mono>{hash.slice(0, 7)}</Mono>
                  </h3>
                  <ul className="file-list">
                    {items.map((ev) => (
                      <li key={ev.id}>
                        <span className="evidence-kind">{EVIDENCE_KIND_LABEL[ev.kind] ?? ev.kind}</span>
                        {' — '}
                        {ev.title}
                        {ev.file && <span className="hint"> ({ev.file})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      {!result && !loading && !error && (
        <p className="hint">
          Enter a specific question and run trace. You can also start from{' '}
          <Link to={`/repos/${repoId}/timeline`}>Commit Timeline</Link>.
        </p>
      )}
    </div>
  );
}
