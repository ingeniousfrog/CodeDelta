import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type CommitInfo, type PanoramaGraph } from '../api/client';
import PanoramaGraphView from '../components/PanoramaGraphView';
import {
  buildFocusTrail,
  focusAtTrailIndex,
  popFocus,
  pushFocus,
  resolveFocusFromSearchParams,
  serializeFocusPath,
} from '../lib/panorama-focus';
import { Alert, Button, Card, FormField, PageHeader, Select } from '../components/ui';

function resolveCommitFromParams(
  searchParams: URLSearchParams,
  commits: CommitInfo[],
): string {
  const direct = searchParams.get('commit')?.trim();
  if (direct) return direct;
  const head = searchParams.get('head')?.trim();
  if (head) return head;
  return commits[0]?.hash ?? '';
}

function orphanCommitOption(hash: string): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message: 'Outside current branch history',
    author: '',
    authorEmail: '',
    date: '',
    parents: [],
    changedFilesCount: 0,
  };
}

export default function PanoramaPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commit, setCommit] = useState('');
  const initialFocus = resolveFocusFromSearchParams(searchParams);
  const [root, setRoot] = useState(initialFocus.root);
  const [focusStack, setFocusStack] = useState<string[]>(initialFocus.stack);
  const [depth, setDepth] = useState(Number(searchParams.get('depth') ?? '3') || 3);
  const [graph, setGraph] = useState<PanoramaGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const traceMode = searchParams.get('highlight') === 'trace';
  const fromTrace = searchParams.get('from') === 'trace';
  const fromDelta = searchParams.get('from') === 'delta';

  const commitsForSelect = useMemo(() => {
    if (!commit || commits.some((c) => c.hash === commit)) return commits;
    return [orphanCommitOption(commit), ...commits];
  }, [commits, commit]);

  const selectedCommit = useMemo(
    () => commitsForSelect.find((c) => c.hash === commit),
    [commitsForSelect, commit],
  );

  const parentCommit = selectedCommit?.parents[0];

  const loadPanorama = useCallback(
    async (opts?: {
      rootOverride?: string;
      commitOverride?: string;
      stackOverride?: string[];
      depthOverride?: number;
      resetStack?: boolean;
    }) => {
      if (!repoId) return;
      const useRoot = opts?.rootOverride !== undefined ? opts.rootOverride : root;
      const useCommit = opts?.commitOverride ?? commit;
      const useDepth = opts?.depthOverride ?? depth;
      let useStack = opts?.stackOverride ?? focusStack;

      if (!useCommit) {
        setError('Select a commit to analyze.');
        return;
      }

      if (opts?.resetStack) {
        useStack = [];
        setFocusStack([]);
      }

      setLoading(true);
      setError(null);
      try {
        const params: Parameters<typeof api.getPanorama>[1] = {
          commit: useCommit,
          depth: useDepth,
          root: useRoot.trim() || undefined,
        };
        if (traceMode) {
          params.highlight = 'trace';
          const symbols = searchParams.get('traceSymbols');
          const entryPoints = searchParams.get('traceEntryPoints');
          if (symbols) params.traceSymbols = symbols.split(',').filter(Boolean);
          if (entryPoints) params.traceEntryPoints = entryPoints.split(',').filter(Boolean);
        }
        const data = await api.getPanorama(repoId, params);
        setGraph(data);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('commit', useCommit);
          next.delete('base');
          next.delete('head');
          next.set('depth', String(useDepth));
          if (branch) next.set('branch', branch);
          else next.delete('branch');
          next.delete('root');
          const path = serializeFocusPath(buildFocusTrail(useStack, useRoot));
          if (path) next.set('focusPath', path);
          else next.delete('focusPath');
          return next;
        });
      } catch (err) {
        setGraph(null);
        setError(err instanceof Error ? err.message : 'Panorama failed');
      } finally {
        setLoading(false);
      }
    },
    [repoId, commit, root, focusStack, depth, branch, traceMode, searchParams, setSearchParams],
  );

  useEffect(() => {
    if (!repoId) return;
    let cancelled = false;

    (async () => {
      try {
        const r = await api.getRepo(repoId);
        if (cancelled) return;

        const branchList = await api.listBranches(repoId);
        if (cancelled) return;
        setBranches(branchList);

        const fromUrl = searchParams.get('branch');
        const initialBranch =
          fromUrl && branchList.includes(fromUrl)
            ? fromUrl
            : branchList.includes(r.defaultBranch)
              ? r.defaultBranch
              : (branchList[0] ?? r.defaultBranch);
        setBranch(initialBranch);
      } catch {
        if (!cancelled) {
          setBranches([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  useEffect(() => {
    if (!repoId || !branch) return;
    let cancelled = false;

    api
      .listCommits(repoId, branch, 80)
      .then((list) => {
        if (cancelled) return;
        setCommits(list);
        const fromUrl = resolveCommitFromParams(searchParams, list);
        setCommit((prev) => {
          if (fromUrl && (list.some((c) => c.hash === fromUrl) || searchParams.get('commit'))) {
            return fromUrl;
          }
          if (prev && list.some((c) => c.hash === prev)) return prev;
          return list[0]?.hash ?? '';
        });
      })
      .catch(() => {
        if (!cancelled) setCommits([]);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, branch]);

  useEffect(() => {
    const qDepth = searchParams.get('depth');
    if (qDepth) setDepth(Number(qDepth) || 3);

    const qBranch = searchParams.get('branch');
    if (qBranch && branches.includes(qBranch) && qBranch !== branch) {
      setBranch(qBranch);
      return;
    }

    const qCommit = resolveCommitFromParams(searchParams, commits);
    if (!repoId || commits.length === 0 || !qCommit) return;

    const parsedFocus = resolveFocusFromSearchParams(searchParams);
    const urlPath = searchParams.get('focusPath') ?? '';
    const currentPath = serializeFocusPath(buildFocusTrail(focusStack, root)) ?? '';

    if (qCommit === commit && parsedFocus.root === root && urlPath === currentPath && graph) {
      return;
    }

    if (qCommit !== commit) setCommit(qCommit);
    setFocusStack(parsedFocus.stack);
    setRoot(parsedFocus.root);

    loadPanorama({
      commitOverride: qCommit,
      rootOverride: parsedFocus.root,
      stackOverride: parsedFocus.stack,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    repoId,
    commits.length,
    branch,
    searchParams.get('focusPath'),
    searchParams.get('commit'),
    searchParams.get('head'),
    searchParams.get('depth'),
    searchParams.get('branch'),
  ]);

  const handleBranchChange = useCallback(
    async (nextBranch: string) => {
      if (!repoId || nextBranch === branch) return;
      setBranch(nextBranch);
      setFocusStack([]);
      setRoot('');
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('branch', nextBranch);
        next.delete('focusPath');
        return next;
      });
      try {
        const list = await api.listCommits(repoId, nextBranch, 80);
        setCommits(list);
        const tip = list[0]?.hash ?? '';
        setCommit(tip);
        if (tip) {
          await loadPanorama({
            commitOverride: tip,
            rootOverride: '',
            stackOverride: [],
            resetStack: true,
          });
        } else {
          setGraph(null);
        }
      } catch {
        setCommits([]);
        setCommit('');
        setGraph(null);
      }
    },
    [repoId, branch, loadPanorama, setSearchParams],
  );

  const handleCommitChange = useCallback(
    (nextCommit: string) => {
      setCommit(nextCommit);
      setFocusStack([]);
      setRoot('');
      if (nextCommit) {
        loadPanorama({
          commitOverride: nextCommit,
          rootOverride: '',
          stackOverride: [],
          resetStack: true,
        });
      } else {
        setGraph(null);
      }
    },
    [loadPanorama],
  );

  const handleDepthChange = useCallback(
    (nextDepth: number) => {
      setDepth(nextDepth);
      if (commit) {
        loadPanorama({ commitOverride: commit, depthOverride: nextDepth });
      }
    },
    [commit, loadPanorama],
  );

  const handleExpand = useCallback(
    (qualifiedName: string) => {
      const newStack = pushFocus(focusStack, root);
      setFocusStack(newStack);
      setRoot(qualifiedName);
      loadPanorama({ rootOverride: qualifiedName, stackOverride: newStack });
    },
    [focusStack, root, loadPanorama],
  );

  const handleGoBack = useCallback(() => {
    const popped = popFocus(focusStack);
    if (!popped) return;
    setFocusStack(popped.stack);
    setRoot(popped.root);
    loadPanorama({ rootOverride: popped.root, stackOverride: popped.stack });
  }, [focusStack, loadPanorama]);

  const handleGoToOverview = useCallback(() => {
    setFocusStack([]);
    setRoot('');
    loadPanorama({ rootOverride: '', stackOverride: [], resetStack: true });
  }, [loadPanorama]);

  const focusTrail = useMemo(() => buildFocusTrail(focusStack, root), [focusStack, root]);

  const handleFocusTrailSelect = useCallback(
    (index: number) => {
      const next = focusAtTrailIndex(focusStack, root, index);
      if (!next) return;
      setFocusStack(next.stack);
      setRoot(next.root);
      loadPanorama({ rootOverride: next.root, stackOverride: next.stack });
    },
    [focusStack, root, loadPanorama],
  );

  async function handleEnrich(nodeIds: string[]) {
    if (!repoId || !commit) return;
    setEnriching(true);
    try {
      const { labels } = await api.enrichPanorama(repoId, { commit, nodeIds });
      setGraph((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          nodes: prev.nodes.map((n) => ({
            ...n,
            llmLabel: labels[n.id] ?? n.llmLabel,
          })),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrich failed');
    } finally {
      setEnriching(false);
    }
  }

  const deltaHref =
    repoId && commit
      ? `/repos/${repoId}/delta?head=${commit}${parentCommit ? `&base=${parentCommit}` : ''}&from=panorama`
      : null;

  return (
    <div className="page page--panorama">
      {fromTrace && repoId && (
        <Link to={`/repos/${repoId}/trace`} className="back-link">
          ← Back to Trace results
        </Link>
      )}
      {fromDelta && repoId && (
        <Link to={`/repos/${repoId}/delta?base=${searchParams.get('base') ?? ''}&head=${commit}`} className="back-link">
          ← Back to Delta View
        </Link>
      )}

      <PageHeader title="Panorama" />

      <p className="hint panorama-intro">
        Call-flow graph at one commit. Drill down with <em>Expand from here</em>; the URL keeps your path.{' '}
        {deltaHref && (
          <>
            <Link to={deltaHref}>Delta View</Link> colors changes;{' '}
          </>
        )}
        {repoId && <Link to={`/repos/${repoId}/trace`}>Trace</Link>} opens here from a candidate commit.
      </p>

      <Card className="panorama-controls-card">
        <div className="panorama-controls">
          <FormField label="Branch">
            <Select value={branch} onChange={(e) => handleBranchChange(e.target.value)} disabled={!branch}>
              {!branch && <option value="">Loading…</option>}
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Commit">
            <Select value={commit} onChange={(e) => handleCommitChange(e.target.value)}>
              <option value="">Select commit…</option>
              {commitsForSelect.map((c) => (
                <option key={c.hash} value={c.hash}>
                  {c.shortHash} — {c.message.slice(0, 55)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Call depth">
            <Select value={String(depth)} onChange={(e) => handleDepthChange(Number(e.target.value))}>
              <option value="2">2 hops</option>
              <option value="3">3 hops</option>
              <option value="4">4 hops</option>
              <option value="5">5 hops</option>
            </Select>
          </FormField>

          <FormField label="Focus symbol (optional)">
            <input
              className="input"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              placeholder="e.g. GET /api/users or MainActivity.onCreate"
            />
          </FormField>

          <Button
            variant="primary"
            onClick={() => {
              setFocusStack([]);
              loadPanorama({ rootOverride: root.trim(), stackOverride: [], resetStack: true });
            }}
            disabled={loading || !commit}
          >
            {loading ? 'Loading…' : root.trim() ? 'Apply focus' : 'Refresh'}
          </Button>
        </div>
        {selectedCommit && (
          <p className="hint panorama-commit-hint">
            {branch && (
              <>
                Branch <strong>{branch}</strong>
                {' · '}
              </>
            )}
            Snapshot <strong>{selectedCommit.shortHash}</strong> · {selectedCommit.message.slice(0, 80)}
          </p>
        )}
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="panorama-workspace">
        <PanoramaGraphView
          graph={graph}
          loading={loading}
          error={error}
          enriching={enriching}
          focusTrail={focusTrail}
          onFocusTrailSelect={handleFocusTrailSelect}
          canGoBack={focusStack.length > 0}
          canGoToOverview={root.trim().length > 0}
          onGoBack={handleGoBack}
          onGoToOverview={handleGoToOverview}
          onContinueTrace={handleExpand}
          onEnrich={handleEnrich}
        />
      </div>
    </div>
  );
}
