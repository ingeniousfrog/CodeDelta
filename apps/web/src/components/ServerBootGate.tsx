import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Alert, Button } from './ui';

type BootState = 'waiting' | 'ready' | 'failed';

const MAX_ATTEMPTS = 24;
const INITIAL_DELAY_MS = 200;

export function ServerBootGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const [state, setState] = useState<BootState>('waiting');
  const [gitAvailable, setGitAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const poll = useCallback(async () => {
    try {
      const health = await api.health();
      setGitAvailable(health.gitAvailable !== false);
      setState('ready');
      setError(null);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (state !== 'waiting') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function run(tryIndex: number) {
      const ok = await poll();
      if (cancelled) return;
      if (ok) return;
      if (tryIndex >= MAX_ATTEMPTS) {
        setState('failed');
        setError(t('boot.unreachable'));
        return;
      }
      setAttempt(tryIndex + 1);
      const delay = Math.min(INITIAL_DELAY_MS * 1.4 ** tryIndex, 3000);
      timer = setTimeout(() => run(tryIndex + 1), delay);
    }

    void run(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll, state, t]);

  async function retry() {
    setState('waiting');
    setAttempt(0);
    setError(null);
    const ok = await poll();
    if (!ok) {
      setState('failed');
      setError(t('boot.stillUnreachable'));
    }
  }

  if (state === 'waiting') {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <h1 className="boot-title">CodeDelta</h1>
          <p className="boot-message">{t('boot.starting')}</p>
          <p className="boot-hint muted">
            {attempt > 0 ? t('boot.waitingAttempt', { attempt }) : t('boot.connecting')}
          </p>
        </div>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <h1 className="boot-title">CodeDelta</h1>
          {error && <Alert variant="error">{error}</Alert>}
          <Button variant="primary" onClick={() => void retry()}>
            {t('boot.retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {!gitAvailable && (
        <div className="boot-git-banner" role="status">
          {t('boot.gitMissing')}
        </div>
      )}
      {children}
    </>
  );
}
