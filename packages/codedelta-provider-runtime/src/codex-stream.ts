import { extractResponsesText } from './codex-responses';

/** Parse Codex /responses SSE (stream must be true). */
export function parseResponsesSseChunk(buffer: string): {
  remainder: string;
  events: unknown[];
} {
  const events: unknown[] = [];
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.replace(/^data:\s*/, '');
    if (!payload || payload === '[DONE]') continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* skip malformed chunk */
    }
  }
  return { remainder, events };
}

export function applyResponsesEvents(
  events: unknown[],
  state: { streamed: string; completed: unknown | null },
): void {
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const e = event as Record<string, unknown>;
    if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') {
      state.streamed += e.delta;
    } else if (e.type === 'response.completed' && e.response) {
      state.completed = e.response;
    }
  }
}

export function finalizeResponsesText(state: {
  streamed: string;
  completed: unknown | null;
}): string {
  const streamedTrimmed = state.streamed.trim();
  if (streamedTrimmed) return streamedTrimmed;
  if (state.completed) {
    const fromCompleted = extractResponsesText(state.completed);
    if (fromCompleted) return fromCompleted;
  }
  return '';
}

export async function readResponsesSseStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state = { streamed: '', completed: null as unknown | null };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseResponsesSseChunk(buffer);
    buffer = parsed.remainder;
    applyResponsesEvents(parsed.events, state);
  }

  if (buffer.trim()) {
    const parsed = parseResponsesSseChunk(`${buffer}\n`);
    applyResponsesEvents(parsed.events, state);
  }

  return finalizeResponsesText(state);
}
