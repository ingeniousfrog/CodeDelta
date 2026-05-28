import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type TraceAnswer } from '../api/client';
import type { TraceEvidenceItem } from '../types';
import { clearTraceSession, loadTraceSession, saveTraceSession } from '../lib/trace-cache';

const EVIDENCE_KIND_LABEL: Record<string, string> = {
  'commit-message': '提交说明',
  'changed-file': '变更文件',
  'changed-symbol': '变更符号',
  'edge-change': '依赖边',
  'risk-tag': '风险标签',
  'entry-point': '入口点',
  'code-diff': '可查看 diff',
  'delta-summary': '结构摘要',
  'delta-unavailable': 'Delta 不可用',
};

const EVOLUTION_LABEL: Record<string, string> = {
  before: '变更前',
  candidate: '候选引入',
  after: '之后',
  current: '当前分支',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

function confidenceHint(level: string): string {
  switch (level) {
    case 'high':
      return '与问题描述匹配度较高，建议优先在 Delta View 验证该提交。';
    case 'medium':
      return '存在一定信号，建议结合候选列表与 diff 交叉确认。';
    default:
      return '历史较短或信号较弱，结论仅供参考，请多看证据与 diff。';
  }
}

function formatProviderNote(result: TraceAnswer): string | null {
  const p = result.provider;
  if (!p?.used) return null;
  if (p.nonAuthoritativeText) {
    return '模型输出未通过校验，页面展示的是确定性分析结果。';
  }
  return `已使用 ${p.type}${p.model ? ` (${p.model})` : ''} 辅助润色结论；证据仍以结构比对为准。`;
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
      setQuestion(`哪个提交最可能引入与 ${candidate.slice(0, 7)} 相关的问题？`);
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
      setError(err instanceof Error ? err.message : 'Trace 失败');
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
    <div className="page trace-page">
      <h1>Trace View</h1>
      <p className="lead">
        根据你的问题描述，在提交历史里找出<strong>最可能引入变更的 commit</strong>，并给出可验证的证据。点击「在
        Delta 中验证」可查看该提交相对父提交的结构 diff。
      </p>

      {restored && result && (
        <div className="alert success trace-restored-banner">
          已恢复上次的 Trace 结果（从 Delta 或其他页面返回不会丢失）。
        </div>
      )}

      <div className="card">
        <label htmlFor="trace-question">问题描述</label>
        <textarea
          id="trace-question"
          rows={3}
          placeholder="例如：登录回调后跳转失败是从哪次提交开始的？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="row">
          <label>
            分支
            <select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">默认分支</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label>
            扫描提交数
            <select value={String(commitLimit)} onChange={(e) => setCommitLimit(Number(e.target.value))}>
              <option value="30">30</option>
              <option value="50">50</option>
              <option value="80">80</option>
              <option value="120">120</option>
            </select>
          </label>
          <label>
            附带 diff 证据
            <select
              value={includeDiffEvidence ? 'yes' : 'no'}
              onChange={(e) => setIncludeDiffEvidence(e.target.value === 'yes')}
            >
              <option value="yes">是</option>
              <option value="no">否</option>
            </select>
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary-btn" onClick={runTrace} disabled={loading || !question.trim()}>
            {loading ? '分析中…' : '开始 Trace'}
          </button>
          {result && (
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setRestored(false);
                if (repoId) clearTraceSession(repoId);
              }}
            >
              清除结果
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {result && (
        <>
          <section className="card trace-summary-card">
            <h2>结论</h2>
            <p className="trace-direct-answer">{result.directAnswer}</p>
            <div className="trace-meta-row">
              <span>
                置信度：<strong>{CONFIDENCE_LABEL[result.confidence] ?? result.confidence}</strong>
              </span>
              <span className="hint">{confidenceHint(result.confidence)}</span>
            </div>
            {result.mostLikelyCommit && (
              <div className="trace-likely-commit">
                <strong>{result.mostLikelyCommit.shortHash}</strong>
                <span className="muted"> — {result.mostLikelyCommit.message}</span>
                {topCandidate?.previousCommitHash && (
                  <button
                    type="button"
                    className="primary-btn trace-delta-cta"
                    onClick={() => openDelta(topCandidate.previousCommitHash!, result.mostLikelyCommit!.hash)}
                  >
                    在 Delta 中验证此提交
                  </button>
                )}
              </div>
            )}
            {providerNote && <p className="hint">{providerNote}</p>}
            {providerWarnings.length > 0 && (
              <div className="alert error trace-provider-warn">
                <strong>AI 辅助未生效</strong>
                <ul>
                  {providerWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <p className="hint">
                  下方候选与证据仍可用。请确认本机可运行 <code>codex login</code>、终端能访问
                  chatgpt.com，然后<strong>重启 dev:codedelta</strong> 再试；若仍失败，看错误里是否含
                  ETIMEDOUT / ENOTFOUND 等代码。
                </p>
              </div>
            )}
          </section>

          <section className="card">
            <h2>候选提交（按相关度）</h2>
            <p className="hint">分数越高表示与问题描述的字面/结构信号越接近，不等于 100% 根因。</p>
            <ul className="trace-candidate-list">
              {result.candidates.map((c, idx) => (
                <li key={c.commit.hash} className={idx === 0 ? 'trace-candidate-top' : ''}>
                  <div className="trace-candidate-head">
                    <span className="trace-rank">#{idx + 1}</span>
                    <strong>{c.commit.shortHash}</strong>
                    <span className="trace-score">相关度 {c.relevanceScore}</span>
                  </div>
                  <p>{c.commit.message}</p>
                  <p className="hint">{c.reasons.join(' · ')}</p>
                  {c.changedFiles.length > 0 && (
                    <p className="hint">
                      变更文件：{c.changedFiles.slice(0, 5).map((f) => f.path).join(', ')}
                      {c.changedFiles.length > 5 ? ` 等 ${c.changedFiles.length} 个` : ''}
                    </p>
                  )}
                  {c.previousCommitHash ? (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => openDelta(c.previousCommitHash!, c.commit.hash)}
                    >
                      在 Delta 中对比：父提交 → 该提交
                    </button>
                  ) : (
                    <p className="hint">无父提交，无法做 previous → candidate 对比。</p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <details className="card trace-details">
            <summary>变更时间线</summary>
            <ul className="file-list">
              {result.evolution.map((s, i) => (
                <li key={`${s.label}-${i}`}>
                  <strong>{EVOLUTION_LABEL[s.label] ?? s.label}</strong>
                  {s.commitHash ? ` (${s.commitHash.slice(0, 7)})` : ''} — {s.summary}
                </li>
              ))}
            </ul>
          </details>

          <details className="card trace-details">
            <summary>
              影响范围概览（{result.impactRadius.files.length} 文件 ·{' '}
              {result.impactRadius.symbols.length} 符号）
            </summary>
            <p className="hint">
              风险标签：{result.impactRadius.riskTags.join(', ') || '无'}
            </p>
            <p className="hint">
              入口点：{result.impactRadius.entryPoints.slice(0, 8).join(', ') || '未检测到'}
            </p>
          </details>

          {(userFacingUncertainty.length > 0 || result.suggestedNextChecks.length > 0) && (
            <details className="card trace-details" open>
              <summary>不确定性与建议</summary>
              {userFacingUncertainty.length > 0 && (
                <ul className="file-list">
                  {userFacingUncertainty.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              )}
              {result.suggestedNextChecks.length > 0 && (
                <>
                  <h3>建议下一步</h3>
                  <ul className="file-list">
                    {result.suggestedNextChecks.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          )}

          <details className="card trace-details">
            <summary>证据明细（{result.evidence.length} 条，供核对）</summary>
            <p className="hint">每条证据对应一个 commit；需要代码级细节时请用 Delta 打开 diff。</p>
            {Array.from(evidenceByCommit.entries()).map(([hash, items]: [string, TraceEvidenceItem[]]) => (
              <div key={hash} className="trace-evidence-group">
                <h3>{hash.slice(0, 7)}</h3>
                <ul className="file-list compact">
                  {items.map((ev) => (
                    <li key={ev.id}>
                      <span className="trace-ev-kind">{EVIDENCE_KIND_LABEL[ev.kind] ?? ev.kind}</span>
                      {' — '}
                      {ev.title}
                      {ev.file && <span className="muted"> ({ev.file})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </>
      )}

      {!result && !loading && !error && (
        <p className="muted">
          输入具体问题后点击「开始 Trace」。也可从{' '}
          <Link to={`/repos/${repoId}/timeline`}>Commit Timeline</Link> 进入并带上候选 commit。
        </p>
      )}
    </div>
  );
}
