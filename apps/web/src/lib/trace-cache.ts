import type { TraceAnswer } from '../api/client';

export interface TraceSession {
  question: string;
  branch: string;
  commitLimit: number;
  includeDiffEvidence: boolean;
  result: TraceAnswer;
  savedAt: number;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function storageKey(repoId: string): string {
  return `codedelta.trace.${repoId}`;
}

export function loadTraceSession(repoId: string): TraceSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey(repoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TraceSession;
    if (!parsed?.result || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(storageKey(repoId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveTraceSession(
  repoId: string,
  session: Omit<TraceSession, 'savedAt'>,
): void {
  try {
    const payload: TraceSession = { ...session, savedAt: Date.now() };
    sessionStorage.setItem(storageKey(repoId), JSON.stringify(payload));
  } catch {
    /* quota or private mode */
  }
}

export function clearTraceSession(repoId: string): void {
  try {
    sessionStorage.removeItem(storageKey(repoId));
  } catch {
    /* ignore */
  }
}
