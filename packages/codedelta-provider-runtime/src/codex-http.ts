const CODEX_REQUEST_TIMEOUT_MS = 120_000;
const CODEX_MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Surface undici/Node fetch root cause (often hidden behind "fetch failed"). */
export function formatNetworkError(err: unknown, context: string): string {
  if (!(err instanceof Error)) {
    return `${context}: ${String(err)}`;
  }
  const parts = [err.message || 'fetch failed'];
  const cause = err.cause;
  if (cause instanceof Error) {
    parts.push(cause.message);
    const code = (cause as NodeJS.ErrnoException).code;
    if (code) parts.push(`(${code})`);
  }
  return `${context}: ${parts.join(' — ')}`;
}

async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${formatNetworkError(err, 'Request timed out')} (${timeoutMs / 1000}s)`);
    }
    throw new Error(formatNetworkError(err, 'Network request failed'));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with timeout + one retry for transient Codex/network failures. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number; retries?: number },
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? CODEX_REQUEST_TIMEOUT_MS;
  const retries = options?.retries ?? CODEX_MAX_RETRIES;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetchOnce(url, init, timeoutMs);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries - 1) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  throw lastError ?? new Error('Network request failed');
}
