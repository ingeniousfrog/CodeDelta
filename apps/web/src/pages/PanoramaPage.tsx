import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function buildPanoramaRequestKey(
  commit: string,
  depth: number,
  root: string,
  stack: string[],
  traceMode: boolean,
  traceSymbols: string | null,
  traceEntryPoints: string | null,
): string {
  return [
    commit,
    depth,
    root,
    stack.join('>'),
    traceMode ? 'trace' : '',
    traceSymbols ?? '',
    traceEntryPoints ?? '',
  ].join('|');
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

  const lastLoadedKeyRef = useRef('');
  const loadGenerationRef = useRef(0);
  const [refreshToken, setRefreshToken] = useState(0);

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

  const syncPanoramaUrl = useCallback(
    (params: { commit: string; depth: number; branch: string; stack: string[]; root: string }) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('commit', params.commit);
        next.delete('base');
        next.delete('head');
        next.set('depth', String(params.depth));
        if (params.branch) next.set('branch', params.branch);
        else next.delete('branch');
        next.delete('root');
        const path = serializeFocusPath(buildFocusTrail(params.stack, params.root));
        if (path) next.set('focusPath', path);
        else next.delete('focusPath');
        return prev.toString() === next.toString() ? prev : next;
      });
    },
    [setSearchParams],
  );

  const navigateFocus = useCallback(
    (stack: string[], nextRoot: string) => {
      lastLoadedKeyRef.current = '';
      setFocusStack(stack);
      setRoot(nextRoot);
      const activeCommit = resolveCommitFromParams(searchParams, commits);
      if (!activeCommit) return;
      syncPanoramaUrl({
        commit: activeCommit,
        depth: Number(searchParams.get('depth') ?? '3') || 3,
        branch,
        stack,
        root: nextRoot,
      });
    },
    [branch, commits, searchParams, syncPanoramaUrl],
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
        if (!cancelled) setBranches([]);
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

        const urlCommit = searchParams.get('commit')?.trim();
        const head = searchParams.get('head')?.trim();
        const direct = urlCommit || head;
        const resolved =
          direct && (list.some((c) => c.hash === direct) || urlCommit)
            ? direct
            : (list[0]?.hash ?? '');

        if (resolved && resolved !== searchParams.get('commit')) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('commit', resolved);
            return prev.toString() === next.toString() ? prev : next;
          });
        }
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
    const qBranch = searchParams.get('branch');
    if (qBranch && branches.includes(qBranch) && qBranch !== branch) {
      setBranch(qBranch);
    }
  }, [searchParams, branches, branch]);

  useEffect(() => {
    const qDepth = searchParams.get('depth');
    if (qDepth) {
      const parsed = Number(qDepth) || 3;
      if (parsed !== depth) setDepth(parsed);
    }
  }, [searchParams, depth]);

  useEffect(() => {
    const qCommit = resolveCommitFromParams(searchParams, commits);
    if (!repoId || !branch || commits.length === 0 || !qCommit) return;

    const parsedFocus = resolveFocusFromSearchParams(searchParams);
    const qDepth = Number(searchParams.get('depth') ?? '3') || 3;
    const traceSymbols = searchParams.get('traceSymbols');
    const traceEntryPoints = searchParams.get('traceEntryPoints');
    const requestKey = buildPanoramaRequestKey(
      qCommit,
      qDepth,
      parsedFocus.root,
      parsedFocus.stack,
      traceMode,
      traceSymbols,
      traceEntryPoints,
    );

    if (requestKey === lastLoadedKeyRef.current) return;

    if (qCommit !== commit) setCommit(qCommit);
    if (parsedFocus.root !== root || parsedFocus.stack.join('>') !== focusStack.join('>')) {
      setFocusStack(parsedFocus.stack);
      setRoot(parsedFocus.root);
    }

    const gen = ++loadGenerationRef.current;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params: Parameters<typeof api.getPanorama>[1] = {
          commit: qCommit,
          depth: qDepth,
          root: parsedFocus.root.trim() || undefined,
        };
        if (traceMode) {
          params.highlight = 'trace';
          if (traceSymbols) params.traceSymbols = traceSymbols.split(',').filter(Boolean);
          if (traceEntryPoints) params.traceEntryPoints = traceEntryPoints.split(',').filter(Boolean);
        }
        const data = await api.getPanorama(repoId, params);
        if (cancelled || gen !== loadGenerationRef.current) return;
        setGraph(data);
        lastLoadedKeyRef.current = requestKey;
        syncPanoramaUrl({
          commit: qCommit,
          depth: qDepth,
          branch,
          stack: parsedFocus.stack,
          root: parsedFocus.root,
        });
      } catch (err) {
        if (cancelled || gen !== loadGenerationRef.current) return;
        setGraph(null);
        setError(err instanceof Error ? err.message : 'Panorama failed');
      } finally {
        if (!cancelled && gen === loadGenerationRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    repoId,
    branch,
    commits,
    traceMode,
    searchParams.get('commit'),
    searchParams.get('head'),
    searchParams.get('depth'),
    searchParams.get('focusPath'),
    searchParams.get('traceSymbols'),
    searchParams.get('traceEntryPoints'),
    refreshToken,
  ]);

  const handleBranchChange = useCallback(
    (nextBranch: string) => {
      if (!repoId || nextBranch === branch) return;
      lastLoadedKeyRef.current = '';
      setBranch(nextBranch);
      setFocusStack([]);
      setRoot('');
      setGraph(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('branch', nextBranch);
        next.delete('commit');
        next.delete('focusPath');
        return prev.toString() === next.toString() ? prev : next;
      });
    },
    [repoId, branch, setSearchParams],
  );

  const handleCommitChange = useCallback(
    (nextCommit: string) => {
      if (nextCommit === commit) return;
      lastLoadedKeyRef.current = '';
      setFocusStack([]);
      setRoot('');
      setGraph(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (nextCommit) next.set('commit', nextCommit);
        else next.delete('commit');
        next.delete('focusPath');
        return prev.toString() === next.toString() ? prev : next;
      });
    },
    [commit, setSearchParams],
  );

  const handleDepthChange = useCallback(
    (nextDepth: number) => {
      if (nextDepth === depth) return;
      lastLoadedKeyRef.current = '';
      setDepth(nextDepth);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('depth', String(nextDepth));
        return prev.toString() === next.toString() ? prev : next;
      });
    },
    [depth, setSearchParams],
  );

  const handleExpand = useCallback(
    (qualifiedName: string) => {
      navigateFocus(pushFocus(focusStack, root), qualifiedName);
    },
    [focusStack, root, navigateFocus],
  );

  const handleGoBack = useCallback(() => {
    const popped = popFocus(focusStack);
    if (!popped) return;
    navigateFocus(popped.stack, popped.root);
  }, [focusStack, navigateFocus]);

  const handleGoToOverview = useCallback(() => {
    navigateFocus([], '');
  }, [navigateFocus]);

  const focusTrail = useMemo(() => buildFocusTrail(focusStack, root), [focusStack, root]);

  const handleFocusTrailSelect = useCallback(
    (index: number) => {
      const next = focusAtTrailIndex(focusStack, root, index);
      if (!next) return;
      navigateFocus(next.stack, next.root);
    },
    [focusStack, root, navigateFocus],
  );

  const handleFocusEntry = useCallback(
    (qualifiedName: string) => {
      navigateFocus([], qualifiedName);
    },
    [navigateFocus],
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
              if (root.trim()) {
                navigateFocus([], root.trim());
              } else {
                lastLoadedKeyRef.current = '';
                setRefreshToken((t) => t + 1);
              }
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
            {graph?.stats.effectiveDepth && graph.stats.effectiveDepth > depth && (
              <>
                {' · '}
                Overview uses depth {graph.stats.effectiveDepth} on this repo size
              </>
            )}
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
          onFocusEntry={handleFocusEntry}
          onEnrich={handleEnrich}
        />
      </div>
    </div>
  );
}
