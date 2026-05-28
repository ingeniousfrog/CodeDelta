import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  type ChangedFile,
  type CompareResponse,
  type CommitInfo,
  type FileDiffResponse,
  type RepoRef,
} from '../api/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FormField,
  PageHeader,
  Select,
} from '../components/ui';

type TabId = 'files' | 'symbols' | 'edges' | 'metrics';
type ContributorFactor =
  | 'changedFiles'
  | 'changedSymbols'
  | 'changedEdges'
  | 'affectedNodes'
  | 'riskTags'
  | 'entryPoints';

function contributorLabel(factor: ContributorFactor): string {
  switch (factor) {
    case 'affectedNodes':
      return 'Blast radius';
    case 'entryPoints':
      return 'Entry surface';
    case 'changedEdges':
      return 'Dependency churn';
    case 'changedSymbols':
      return 'Symbol churn';
    case 'riskTags':
      return 'Risk signals';
    case 'changedFiles':
      return 'File spread';
    default:
      return factor;
  }
}

function impactBadgeVariant(severity: string): 'impact-low' | 'impact-medium' | 'impact-high' | 'impact-critical' {
  if (severity === 'critical') return 'impact-critical';
  if (severity === 'high') return 'impact-high';
  if (severity === 'medium') return 'impact-medium';
  return 'impact-low';
}

function priorityClass(priority: 'high' | 'medium' | 'low'): string {
  return `priority-${priority}`;
}

function SymbolTable({
  title,
  rows,
  onOpenFile,
}: {
  title: string;
  rows: Array<{ id: string; kind: string; filePath: string; name: string }>;
  onOpenFile: (filePath: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section style={{ marginTop: '1rem' }}>
      <h3>
        {title} ({rows.length})
      </h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Name</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r) => (
            <tr key={r.id} onClick={() => onOpenFile(r.filePath)}>
              <td>{r.kind}</td>
              <td>{r.name}</td>
              <td className="hint">{r.filePath}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && <p className="hint">Showing 100 of {rows.length}</p>}
      <p className="hint">Symbol click opens file-level diff (symbol-to-hunk mapping planned).</p>
    </section>
  );
}

function DiffModal({
  open,
  data,
  loading,
  error,
  onClose,
}: {
  open: boolean;
  data: FileDiffResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>File diff</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {loading && <p className="hint">Loading diff…</p>}
        {error && <Alert variant="error">{error}</Alert>}
        {data && !loading && (
          <>
            <p>
              <strong>{data.file}</strong> <span className="hint">({data.status})</span>
            </p>
            <pre className="diff-pre">
              {data.patch.split('\n').map((line, idx) => {
                const cls = line.startsWith('+')
                  ? 'diff-line added'
                  : line.startsWith('-')
                    ? 'diff-line removed'
                    : line.startsWith('@@')
                      ? 'diff-line hunk'
                      : 'diff-line';
                return (
                  <div key={idx} className={cls}>
                    {line}
                  </div>
                );
              })}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

export default function DeltaViewPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [base, setBase] = useState(searchParams.get('base') ?? '');
  const [head, setHead] = useState(searchParams.get('head') ?? '');
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('files');

  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<FileDiffResponse | null>(null);

  useEffect(() => {
    if (!repoId) return;
    api
      .getRepo(repoId)
      .then((r) => {
        setRepo(r);
        return api.listCommits(repoId, r.defaultBranch, 80);
      })
      .then(setCommits)
      .catch(() => {
        setRepo(null);
        setCommits([]);
      });
  }, [repoId]);

  const runCompare = useCallback(async () => {
    if (!repoId || !base || !head) return;
    setLoading(true);
    setError(null);
    setSearchParams({ base, head });
    try {
      const data = await api.compare(repoId, base, head);
      setResult(data);
      setTab('files');
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Compare failed');
    } finally {
      setLoading(false);
    }
  }, [repoId, base, head, setSearchParams]);

  useEffect(() => {
    const qBase = searchParams.get('base');
    const qHead = searchParams.get('head');
    if (qBase) setBase(qBase);
    if (qHead) setHead(qHead);
    if (repoId && qBase && qHead) {
      runCompare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, searchParams.get('base'), searchParams.get('head')]);

  async function openFileDiff(filePath: string) {
    if (!repoId || !base || !head) return;
    setDiffOpen(true);
    setDiffLoading(true);
    setDiffError(null);
    setDiffData(null);
    try {
      const data = await api.getFileDiff(repoId, base, head, filePath);
      setDiffData(data);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to load file diff');
    } finally {
      setDiffLoading(false);
    }
  }

  const baseIndex = commits.findIndex((c) => c.hash === base);
  const headIndex = commits.findIndex((c) => c.hash === head);
  const baseOptions = commits.filter((_, idx) => headIndex < 0 || idx > headIndex);
  const headOptions = commits.filter((_, idx) => baseIndex < 0 || idx < baseIndex);
  const visibleTabs: TabId[] = ['files', 'symbols', 'edges', 'metrics'];

  const changedSymbols = useMemo(() => {
    if (!result) return 0;
    return (
      result.graphDiff.summary.symbolsAdded +
      result.graphDiff.summary.symbolsRemoved +
      result.graphDiff.summary.symbolsModified
    );
  }, [result]);

  const fromTrace = searchParams.get('from') === 'trace';
  const severity = result?.impact.explanation?.severity ?? 'low';

  return (
    <div className="page">
      {fromTrace && repoId && (
        <Link to={`/repos/${repoId}/trace`} className="back-link">
          ← Back to Trace results
        </Link>
      )}

      <PageHeader
        title="Delta View"
        description="Commit-to-commit structural review: change scope, risk level, and review priority. Base = before, Head = after."
      />

      {repo && (
        <p className="hint" style={{ marginBottom: '1rem' }}>
          Repository: <strong>{repo.input}</strong>
        </p>
      )}

      <div className="delta-toolbar">
        <FormField label="Base (before / older)">
          <Select value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="">Select commit…</option>
            {baseOptions.map((c) => (
              <option key={c.hash} value={c.hash}>
                {c.shortHash} — {c.message.slice(0, 60)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Head (after / newer)">
          <Select value={head} onChange={(e) => setHead(e.target.value)}>
            <option value="">Select commit…</option>
            {headOptions.map((c) => (
              <option key={c.hash} value={c.hash}>
                {c.shortHash} — {c.message.slice(0, 60)}
              </option>
            ))}
          </Select>
        </FormField>
        <Button variant="primary" onClick={runCompare} disabled={loading || !base || !head}>
          {loading ? 'Comparing…' : 'Compare'}
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {result?.deltaSummary && (
        <Card className="panel-highlight">
          <h2>{result.deltaSummary.title}</h2>
          <ul className="overview-list">
            {result.deltaSummary.overview.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="summary-grid">
            <div>
              <h3>Main areas</h3>
              <ul className="file-list">
                {result.deltaSummary.mainAreas.map((a) => (
                  <li key={a.name}>
                    <strong>{a.name}</strong> — {a.changedSymbols} symbols
                    {a.riskTags.length > 0 && <span className="hint"> ({a.riskTags.join(', ')})</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Risks</h3>
              <ul className="file-list">
                {result.deltaSummary.risks.length === 0 && <li className="hint">No risk tags detected</li>}
                {result.deltaSummary.risks.map((r) => (
                  <li key={r.tag}>
                    <strong>{r.tag}</strong>: {r.reason}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Suggested review order</h3>
              <ul className="file-list">
                {result.deltaSummary.reviewOrder.map((item) => (
                  <li key={item.file}>
                    <Button variant="link" onClick={() => openFileDiff(item.file)}>
                      {item.file}
                    </Button>{' '}
                    <span className={priorityClass(item.priority)}>[{item.priority}]</span>
                    <div className="hint">{item.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {result?.impact && (
        <Card>
          <CardHeader title="Impact" />
          <div className="impact-hero">
            <p className="impact-score">{result.impact.score}</p>
            <Badge variant={impactBadgeVariant(severity)}>{severity} impact</Badge>
          </div>
          <p className="hint">{result.impact.explanation?.summary}</p>
          {result.impact.explanation?.reasons && (
            <ul className="file-list">
              {result.impact.explanation.reasons.slice(0, 3).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {result.impact.explanation?.topContributors &&
            result.impact.explanation.topContributors.length > 0 && (
              <>
                <h3>Main contributors</h3>
                <div className="chip-row">
                  {result.impact.explanation.topContributors.slice(0, 4).map((c) => (
                    <span key={c.factor} className="chip">
                      {contributorLabel(c.factor as ContributorFactor)}: {c.value}
                    </span>
                  ))}
                </div>
              </>
            )}
        </Card>
      )}

      {result && (
        <Card>
          <div className="segmented">
            {visibleTabs.map((t) => (
              <button
                key={t}
                type="button"
                className={tab === t ? 'active' : ''}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'files' && (
            <ul className="file-list">
              {result.graphDiff.changedFiles.map((f: ChangedFile) => (
                <li key={`${f.status}-${f.path}`}>
                  <Button variant="link" onClick={() => openFileDiff(f.path)}>
                    {f.path}
                  </Button>{' '}
                  <span className="status-badge">{f.status}</span>
                </li>
              ))}
            </ul>
          )}

          {tab === 'symbols' && (
            <>
              <SymbolTable title="Added" rows={result.graphDiff.addedNodes} onOpenFile={openFileDiff} />
              <SymbolTable title="Removed" rows={result.graphDiff.removedNodes} onOpenFile={openFileDiff} />
              {result.graphDiff.modifiedNodes.length > 0 && (
                <section style={{ marginTop: '1rem' }}>
                  <h3>Modified ({result.graphDiff.modifiedNodes.length})</h3>
                  <ul className="file-list">
                    {result.graphDiff.modifiedNodes.slice(0, 80).map((m) => (
                      <li key={m.after.id}>
                        <Button variant="link" onClick={() => openFileDiff(m.after.filePath)}>
                          {m.after.filePath}
                        </Button>{' '}
                        — {m.after.name} <span className="hint">({m.changes.join(', ')})</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {tab === 'edges' && (
            <section>
              <h3>Edge changes</h3>
              <p className="hint">
                +{result.graphDiff.addedEdges.length} / −{result.graphDiff.removedEdges.length}
              </p>
              <ul className="file-list">
                {result.graphDiff.addedEdges.slice(0, 40).map((e, i) => (
                  <li key={`a${i}`}>
                    + {e.kind}: {e.source} → {e.target}
                  </li>
                ))}
                {result.graphDiff.removedEdges.slice(0, 40).map((e, i) => (
                  <li key={`r${i}`}>
                    − {e.kind}: {e.source} → {e.target}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === 'metrics' && (
            <dl className="meta-grid">
              <dt>Changed files</dt>
              <dd>{result.graphDiff.changedFiles.length}</dd>
              <dt>Changed symbols</dt>
              <dd>{changedSymbols}</dd>
              <dt>Edge changes</dt>
              <dd>{result.graphDiff.summary.edgesAdded + result.graphDiff.summary.edgesRemoved}</dd>
              <dt>Affected nodes</dt>
              <dd>{result.graphDiff.affectedNodeIds.length}</dd>
              <dt>Base extraction</dt>
              <dd>
                {result.baseMeta.extractionMethod} ({result.baseMeta.nodeCount} nodes)
              </dd>
              <dt>Head extraction</dt>
              <dd>
                {result.headMeta.extractionMethod} ({result.headMeta.nodeCount} nodes)
              </dd>
            </dl>
          )}
        </Card>
      )}

      {!result && !loading && !error && (
        <p className="hint">
          Select base and head commits, or open from{' '}
          <Link to={`/repos/${repoId}/timeline`}>Commit Timeline</Link>.
        </p>
      )}

      <DiffModal
        open={diffOpen}
        data={diffData}
        loading={diffLoading}
        error={diffError}
        onClose={() => setDiffOpen(false)}
      />
    </div>
  );
}
