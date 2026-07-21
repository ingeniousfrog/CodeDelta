import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['trace', 'common']);
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

  const evidenceKindLabel = useCallback(
    (kind: string) => t(`evidenceKinds.${kind}`, { defaultValue: kind }),
    [t],
  );

  const evolutionLabel = useCallback(
    (label: string) => t(`evolution.${label}`, { defaultValue: label }),
    [t],
  );

  const confidenceHint = useCallback(
    (level: string) => {
      switch (level) {
        case 'high':
          return t('confidenceHints.high');
        case 'medium':
          return t('confidenceHints.medium');
        default:
          return t('confidenceHints.low');
      }
    },
    [t],
  );

  const formatProviderNote = useCallback(
    (traceResult: TraceAnswer): string | null => {
      const p = traceResult.provider;
      if (!p?.used) return null;
      if (p.nonAuthoritativeText) {
        return t('providerFailed');
      }
      return t('providerRefined', {
        type: p.type,
        model: p.model ? ` (${p.model})` : '',
      });
    },
    [t],
  );

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
      setQuestion(t('candidateQuestion', { shortHash: candidate.slice(0, 7) }));
    }
  }, [repoId, candidate, t]);

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
      setError(err instanceof Error ? err.message : t('common:errors.traceFailed'));
    } finally {
      setLoading(false);
    }
  }

  function openDelta(baseHash: string, headHash: string) {
    if (!repoId) return;
    if (result) {
      persist(result, question, branch, commitLimit, includeDiffEvidence);
    }
    navigate(`/repos/${repoId}/delta?base=${baseHash}&head=${headHash}&from=trace`);
  }

  function openPanorama(_baseHash: string, headHash: string) {
    if (!repoId) return;
    if (result) {
      persist(result, question, branch, commitLimit, includeDiffEvidence);
    }
    const symbols = result?.impactRadius.symbols.slice(0, 12).join(',') ?? '';
    const entryPoints = result?.impactRadius.entryPoints.slice(0, 8).join(',') ?? '';
    const q = new URLSearchParams({
      commit: headHash,
      highlight: 'trace',
      from: 'trace',
    });
    if (branch) q.set('branch', branch);
    if (symbols) q.set('traceSymbols', symbols);
    if (entryPoints) q.set('traceEntryPoints', entryPoints);
    navigate(`/repos/${repoId}/panorama?${q.toString()}`);
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
      <PageHeader title={t('title')} description={t('description')} />

      {restored && result && (
        <Alert variant="success">{t('restored')}</Alert>
      )}

      <Card>
        <FormField label={t('questionLabel')} htmlFor="trace-question">
          <TextArea
            id="trace-question"
            rows={3}
            placeholder={t('questionPlaceholder')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </FormField>
        <div className="form-row">
          <FormField label={t('branch')}>
            <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{t('defaultBranch')}</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('commitLimit')}>
            <Select value={String(commitLimit)} onChange={(e) => setCommitLimit(Number(e.target.value))}>
              <option value="30">30</option>
              <option value="50">50</option>
              <option value="80">80</option>
              <option value="120">120</option>
            </Select>
          </FormField>
          <FormField label={t('includeDiff')}>
            <Select
              value={includeDiffEvidence ? 'yes' : 'no'}
              onChange={(e) => setIncludeDiffEvidence(e.target.value === 'yes')}
            >
              <option value="yes">{t('yes')}</option>
              <option value="no">{t('no')}</option>
            </Select>
          </FormField>
        </div>
        <div className="btn-row">
          <Button variant="primary" onClick={runTrace} disabled={loading || !question.trim()}>
            {loading ? t('tracing') : t('runTrace')}
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
              {t('clearResults')}
            </Button>
          )}
        </div>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {result && (
        <>
          <Card className="panel-highlight">
            <CardHeader title={t('conclusion')} />
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
                <Badge variant="accent">{t('confidence', { level: result.confidence })}</Badge>
                {topCandidate?.previousCommitHash && result.mostLikelyCommit && (
                  <>
                    <Button
                      variant="primary"
                      onClick={() => openDelta(topCandidate.previousCommitHash!, result.mostLikelyCommit!.hash)}
                    >
                      {t('verifyDelta')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        openPanorama(topCandidate.previousCommitHash!, result.mostLikelyCommit!.hash)
                      }
                    >
                      {t('viewPanorama')}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {providerWarnings.length > 0 && (
              <Alert variant="warning" title={t('aiUnavailable')}>
                <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                  {providerWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <p className="form-hint" style={{ marginTop: '0.5rem' }}>
                  {t('aiUnavailableHint')}
                </p>
              </Alert>
            )}
          </Card>

          <Card>
            <CardHeader title={t('candidatesTitle')} description={t('candidatesDesc')} />
            <ul className="candidate-list">
              {result.candidates.map((c, idx) => (
                <li key={c.commit.hash} className={`candidate-item ${idx === 0 ? 'candidate-item-top' : ''}`}>
                  <div className="candidate-head">
                    <span className="candidate-rank">#{idx + 1}</span>
                    <strong>
                      <Mono>{c.commit.shortHash}</Mono>
                    </strong>
                    <span className="candidate-score">{t('score', { score: c.relevanceScore })}</span>
                  </div>
                  <p>{c.commit.message}</p>
                  <p className="hint">{c.reasons.join(' · ')}</p>
                  {c.changedFiles.length > 0 && (
                    <p className="hint">
                      {t('files')}{' '}
                      {c.changedFiles
                        .slice(0, 5)
                        .map((f) => f.path)
                        .join(', ')}
                      {c.changedFiles.length > 5
                        ? ` ${t('moreFiles', { count: c.changedFiles.length - 5 })}`
                        : ''}
                    </p>
                  )}
                  {c.previousCommitHash ? (
                    <>
                      <Button variant="link" onClick={() => openDelta(c.previousCommitHash!, c.commit.hash)}>
                        {t('compareInDelta')}
                      </Button>
                      <Button variant="link" onClick={() => openPanorama(c.previousCommitHash!, c.commit.hash)}>
                        {t('viewPanorama')}
                      </Button>
                    </>
                  ) : (
                    <p className="hint">{t('noParent')}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <details className="card details-card">
            <summary>{t('changeTimeline')}</summary>
            <div className="details-body">
              <ul className="file-list">
                {result.evolution.map((s, i) => (
                  <li key={`${s.label}-${i}`}>
                    <strong>{evolutionLabel(s.label)}</strong>
                    {s.commitHash ? ` (${s.commitHash.slice(0, 7)})` : ''} — {s.summary}
                  </li>
                ))}
              </ul>
            </div>
          </details>

          <details className="card details-card">
            <summary>
              {t('impactOverview', {
                files: result.impactRadius.files.length,
                symbols: result.impactRadius.symbols.length,
              })}
            </summary>
            <div className="details-body">
              <p className="hint">
                {t('riskTags', {
                  tags: result.impactRadius.riskTags.join(', ') || t('none'),
                })}
              </p>
              <p className="hint">
                {t('entryPoints', {
                  points: result.impactRadius.entryPoints.slice(0, 8).join(', ') || t('noneDetected'),
                })}
              </p>
            </div>
          </details>

          {(userFacingUncertainty.length > 0 || result.suggestedNextChecks.length > 0) && (
            <details className="card details-card" open>
              <summary>{t('uncertainty')}</summary>
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
                    <h3>{t('suggestedChecks')}</h3>
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
            <summary>{t('evidenceDetails', { count: result.evidence.length })}</summary>
            <div className="details-body">
              <p className="hint">{t('evidenceHint')}</p>
              {Array.from(evidenceByCommit.entries()).map(([hash, items]: [string, TraceEvidenceItem[]]) => (
                <div key={hash} className="evidence-group">
                  <h3>
                    <Mono>{hash.slice(0, 7)}</Mono>
                  </h3>
                  <ul className="file-list">
                    {items.map((ev) => (
                      <li key={ev.id}>
                        <span className="evidence-kind">{evidenceKindLabel(ev.kind)}</span>
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
          {t('emptyHint')}{' '}
          <Link to={`/repos/${repoId}/timeline`}>{t('commitTimeline')}</Link>.
        </p>
      )}
    </div>
  );
}
