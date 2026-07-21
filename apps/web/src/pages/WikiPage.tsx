import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

function chatStorageKey(repoId: string, commit: string, locale: string): string {
  return `codedelta-wiki-chat-${repoId}-${commit}-${locale}`;
}

function loadChat(repoId: string, commit: string, locale: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(chatStorageKey(repoId, commit, locale));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveChat(repoId: string, commit: string, locale: string, messages: ChatMessage[]): void {
  try {
    sessionStorage.setItem(chatStorageKey(repoId, commit, locale), JSON.stringify(messages.slice(-30)));
  } catch {
    // sessionStorage full/unavailable — chat just won't persist.
  }
}

export default function WikiPage() {
  const { t, i18n } = useTranslation(['wiki', 'common']);
  const locale = i18n.language === 'zh-Hans' ? 'zh-Hans' : 'en';
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
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('common:errors.loadRepoFailed'));
        }
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
      const s = await api.getWikiStatus(repoId, commit, locale);
      setStatus(s);
      if (s.state === 'ready') {
        const tocData = await api.getWikiToc(repoId, commit, locale);
        setToc(tocData);
      } else {
        setToc(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadStatusFailed'));
    }
  }, [repoId, commit, locale, t]);

  useEffect(() => {
    setStatus(null);
    setToc(null);
    setPage(null);
    setError(null);
    if (repoId && commit) {
      setMessages(loadChat(repoId, commit, locale));
      refreshStatus();
    }
  }, [repoId, commit, locale, refreshStatus]);

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
      .getWikiPage(repoId, commit, section.id, locale)
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('loadPageFailed'));
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, commit, toc, activeSection, locale, t]);

  const handleGenerate = useCallback(async () => {
    if (!repoId || !commit) return;
    setError(null);
    try {
      await api.generateWiki(repoId, commit, locale);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('generateFailed'));
    }
  }, [repoId, commit, locale, refreshStatus, t]);

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
      const result = await api.askWiki(repoId, { commit, question: q, history, locale });
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
      saveChat(repoId, commit, locale, withAnswer);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('unknownError');
      const withError: ChatMessage[] = [
        ...withUser,
        { role: 'assistant', content: t('askFailed', { message }) },
      ];
      setMessages(withError);
      saveChat(repoId, commit, locale, withError);
    } finally {
      setAsking(false);
    }
  }, [repoId, commit, question, asking, messages, locale, t]);

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
      <PageHeader title={t('title')} description={t('description')} />

      <Card>
        <div className="wiki-toolbar">
          <FormField label={t('commit')}>
            <Select value={commit} onChange={(e) => setCommit(e.target.value)}>
              <option value="">{t('selectCommit')}</option>
              {commits.map((c) => (
                <option key={c.hash} value={c.hash}>
                  {c.shortHash} — {c.message.slice(0, 60)}
                </option>
              ))}
            </Select>
          </FormField>
          {!ready && (
            <Button variant="primary" onClick={handleGenerate} disabled={!commit || generating}>
              {generating ? t('generating') : t('generate')}
            </Button>
          )}
          {ready && (
            <p className="hint wiki-meta-hint">
              {t('generatedAt', {
                when: status?.generatedAt ? new Date(status.generatedAt).toLocaleString() : '',
              })}
              {status?.llmUsed ? t('withLlm') : t('structuralOnly')}
            </p>
          )}
        </div>
        {generating && (
          <p className="hint">
            {t('building', {
              done: status?.completedSections ?? 0,
              total: status?.totalSections ?? '…',
              current: status?.currentSection ? ` — ${status.currentSection}` : '',
            })}
          </p>
        )}
        {selectedCommit && (
          <p className="hint">
            {t('snapshot', {
              hash: selectedCommit.shortHash,
              message: selectedCommit.message.slice(0, 80),
            })}
          </p>
        )}
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {!ready && !generating && !error && (
        <p className="hint">
          {t('emptyHintBefore')}{' '}
          <Link to="/settings/provider">{t('providerSettings')}</Link>{' '}
          {t('emptyHintAfter')}
          {' '}
          {t('localeHint')}
        </p>
      )}

      {ready && toc && (
        <div className="wiki-layout">
          <aside className="wiki-toc">
            <Card>
              <h3>{t('contents')}</h3>
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
              {pageLoading && <p className="hint">{t('loadingPage')}</p>}
              {!pageLoading && page && <WikiMarkdown markdown={page.markdown} />}
              {!pageLoading && page && page.citations.length > 0 && (
                <details className="wiki-citations">
                  <summary>{t('symbolsReferenced', { count: page.citations.length })}</summary>
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
              <h3>{t('askTitle')}</h3>
              <div className="wiki-chat">
                {messages.length === 0 && (
                  <p className="hint">
                    {t('askEmptyBefore')}{' '}
                    <Link to="/settings/provider">{t('providerSettings')}</Link>{' '}
                    {t('askEmptyAfter')}
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
                      <p className="hint">{t('confidence', { level: m.confidence })}</p>
                    )}
                  </div>
                ))}
                {asking && <p className="hint">{t('thinking')}</p>}
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
                  placeholder={t('askPlaceholder')}
                  rows={3}
                />
                <Button variant="primary" onClick={handleAsk} disabled={asking || !question.trim()}>
                  {asking ? t('asking') : t('ask')}
                </Button>
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
