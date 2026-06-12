import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  type CommitInfo,
  type WikiAskAnswer,
  type WikiPageContent,
  type WikiStatus,
  type WikiToc,
} from '../api/client';
import WikiMarkdown from '../components/WikiMarkdown';
import { Alert, Button, Card, FormField, PageHeader, Select } from '../components/ui';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: WikiAskAnswer['citations'];
  confidence?: WikiAskAnswer['confidence'];
  providerUsed?: boolean;
}

function chatStorageKey(repoId: string, commit: string): string {
  return `codedelta-wiki-chat-${repoId}-${commit}`;
}

function loadChat(repoId: string, commit: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(chatStorageKey(repoId, commit));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveChat(repoId: string, commit: string, messages: ChatMessage[]): void {
  try {
    sessionStorage.setItem(chatStorageKey(repoId, commit), JSON.stringify(messages.slice(-30)));
  } catch {
    // sessionStorage full/unavailable — chat just won't persist.
  }
}

export default function WikiPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commit, setCommit] = useState(searchParams.get('commit') ?? '');
  const [status, setStatus] = useState<WikiStatus | null>(null);
  const [toc, setToc] = useState<WikiToc | null>(null);
  const [page, setPage] = useState<WikiPageContent | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const activeSection = searchParams.get('section') ?? 'overview';
  const pollRef = useRef<number | null>(null);

  // Bootstrap: repo → default branch commits; pick commit from URL or head.
  useEffect(() => {
    if (!repoId) return;
    let cancelled = false;
    (async () => {
      try {
        const repo = await api.getRepo(repoId);
        const list = await api.listCommits(repoId, repo.defaultBranch, 80);
        if (cancelled) return;
        setCommits(list);
        setCommit((prev) => prev || (searchParams.get('commit') ?? list[0]?.hash ?? ''));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load repository');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  // Keep URL in sync with the selected commit.
  useEffect(() => {
    if (!commit) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('commit', commit);
      return prev.toString() === next.toString() ? prev : next;
    });
  }, [commit, setSearchParams]);

  const refreshStatus = useCallback(async () => {
    if (!repoId || !commit) return;
    try {
      const s = await api.getWikiStatus(repoId, commit);
      setStatus(s);
      if (s.state === 'ready') {
        const t = await api.getWikiToc(repoId, commit);
        setToc(t);
      } else {
        setToc(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wiki status');
    }
  }, [repoId, commit]);

  useEffect(() => {
    setStatus(null);
    setToc(null);
    setPage(null);
    setError(null);
    if (repoId && commit) {
      setMessages(loadChat(repoId, commit));
      refreshStatus();
    }
  }, [repoId, commit, refreshStatus]);

  // Poll while generating.
  useEffect(() => {
    if (status?.state !== 'generating') {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current === null) {
      pollRef.current = window.setInterval(refreshStatus, 2000);
    }
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.state, refreshStatus]);

  // Load the active section page when toc is ready.
  useEffect(() => {
    if (!repoId || !commit || !toc) return;
    const section = toc.sections.find((s) => s.id === activeSection) ?? toc.sections[0];
    if (!section) return;
    let cancelled = false;
    setPageLoading(true);
    api
      .getWikiPage(repoId, commit, section.id)
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load wiki page');
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, commit, toc, activeSection]);

  const handleGenerate = useCallback(async () => {
    if (!repoId || !commit) return;
    setError(null);
    try {
      await api.generateWiki(repoId, commit);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start wiki generation');
    }
  }, [repoId, commit, refreshStatus]);

  const handleAsk = useCallback(async () => {
    if (!repoId || !commit || !question.trim() || asking) return;
    const q = question.trim();
    setQuestion('');
    setAsking(true);
    const withUser: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(withUser);
    try {
      const history = withUser
        .slice(-7, -1)
        .map((m) => ({ role: m.role, content: m.content }));
      const result = await api.askWiki(repoId, { commit, question: q, history });
      const withAnswer: ChatMessage[] = [
        ...withUser,
        {
          role: 'assistant',
          content: result.answer,
          citations: result.citations,
          confidence: result.confidence,
          providerUsed: result.provider.used,
        },
      ];
      setMessages(withAnswer);
      saveChat(repoId, commit, withAnswer);
    } catch (err) {
      const withError: ChatMessage[] = [
        ...withUser,
        { role: 'assistant', content: `Ask failed: ${err instanceof Error ? err.message : 'unknown error'}` },
      ];
      setMessages(withError);
      saveChat(repoId, commit, withError);
    } finally {
      setAsking(false);
    }
  }, [repoId, commit, question, asking, messages]);

  const selectSection = useCallback(
    (sectionId: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('section', sectionId);
        return next;
      });
    },
    [setSearchParams],
  );

  const selectedCommit = useMemo(() => commits.find((c) => c.hash === commit), [commits, commit]);

  const generating = status?.state === 'generating';
  const ready = status?.state === 'ready';

  return (
    <div className="page">
      <PageHeader
        title="Wiki"
        description="Graph-grounded documentation for this repository at a specific commit. Diagrams come from real call/import edges; answers cite symbols you can verify."
      />

      <Card>
        <div className="wiki-toolbar">
          <FormField label="Commit">
            <Select value={commit} onChange={(e) => setCommit(e.target.value)}>
              <option value="">Select commit…</option>
              {commits.map((c) => (
                <option key={c.hash} value={c.hash}>
                  {c.shortHash} — {c.message.slice(0, 60)}
                </option>
              ))}
            </Select>
          </FormField>
          {!ready && (
            <Button variant="primary" onClick={handleGenerate} disabled={!commit || generating}>
              {generating ? 'Generating…' : 'Generate Wiki'}
            </Button>
          )}
          {ready && (
            <p className="hint wiki-meta-hint">
              Generated {status?.generatedAt ? new Date(status.generatedAt).toLocaleString() : ''} ·{' '}
              {status?.llmUsed ? 'with LLM narration' : 'structural only (no LLM configured)'}
            </p>
          )}
        </div>
        {generating && (
          <p className="hint">
            Building wiki: {status?.completedSections ?? 0}/{status?.totalSections ?? '…'} sections
            {status?.currentSection ? ` — ${status.currentSection}` : ''}. First run also builds the
            commit snapshot, which can take a while on large repositories.
          </p>
        )}
        {selectedCommit && (
          <p className="hint">
            Snapshot <strong>{selectedCommit.shortHash}</strong> · {selectedCommit.message.slice(0, 80)}
          </p>
        )}
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {!ready && !generating && !error && (
        <p className="hint">
          No wiki for this commit yet. Generate one to get an overview, architecture diagrams from the
          structural graph, and per-module pages. Without a configured provider you still get the
          structural wiki; configure one in <Link to="/settings/provider">Provider Settings</Link> for
          narrated pages and Ask answers.
        </p>
      )}

      {ready && toc && (
        <div className="wiki-layout">
          <aside className="wiki-toc">
            <Card>
              <h3>Contents</h3>
              <ul className="wiki-toc-list">
                {toc.sections.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={s.id === activeSection ? 'wiki-toc-link active' : 'wiki-toc-link'}
                      onClick={() => selectSection(s.id)}
                    >
                      {s.title}
                      {s.kind === 'module' && <span className="hint"> ({s.symbolCount})</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </aside>

          <section className="wiki-content">
            <Card>
              {pageLoading && <p className="hint">Loading page…</p>}
              {!pageLoading && page && <WikiMarkdown markdown={page.markdown} />}
              {!pageLoading && page && page.citations.length > 0 && (
                <details className="wiki-citations">
                  <summary>Symbols referenced on this page ({page.citations.length})</summary>
                  <ul>
                    {page.citations.map((c) => (
                      <li key={c.id}>
                        {c.symbol ? (
                          <Link
                            to={`/repos/${repoId}/panorama?commit=${commit}&root=${encodeURIComponent(c.symbol)}&from=wiki`}
                          >
                            <code>{c.symbol}</code>
                          </Link>
                        ) : (
                          <code>{c.file}</code>
                        )}{' '}
                        <span className="hint">
                          {c.file}
                          {c.startLine !== undefined ? ` L${c.startLine}–L${c.endLine}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          </section>

          <aside className="wiki-ask">
            <Card>
              <h3>Ask this repo</h3>
              <div className="wiki-chat">
                {messages.length === 0 && (
                  <p className="hint">
                    Ask in natural language — answers use your configured LLM provider, grounded in
                    the structural graph (symbols, call paths, README). Configure one in{' '}
                    <Link to="/settings/provider">Provider Settings</Link> if Ask is disabled.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`wiki-chat-msg wiki-chat-msg--${m.role}`}>
                    {m.role === 'assistant' ? <WikiMarkdown markdown={m.content} /> : <p>{m.content}</p>}
                    {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                      <ul className="wiki-chat-citations">
                        {m.citations.slice(0, 8).map((c) => (
                          <li key={c.id}>
                            {c.symbol ? (
                              <Link
                                to={`/repos/${repoId}/panorama?commit=${commit}&root=${encodeURIComponent(c.symbol)}&from=wiki`}
                              >
                                <code>{c.symbol}</code>
                              </Link>
                            ) : (
                              <code>{c.file}</code>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.role === 'assistant' && m.confidence && (
                      <p className="hint">confidence: {m.confidence}</p>
                    )}
                  </div>
                ))}
                {asking && <p className="hint">Thinking…</p>}
              </div>
              <div className="wiki-ask-input">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAsk();
                    }
                  }}
                  placeholder="e.g. How does compare build snapshots?"
                  rows={3}
                />
                <Button variant="primary" onClick={handleAsk} disabled={asking || !question.trim()}>
                  {asking ? 'Asking…' : 'Ask'}
                </Button>
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
