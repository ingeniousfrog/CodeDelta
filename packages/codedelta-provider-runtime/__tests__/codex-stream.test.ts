import { describe, expect, it } from 'vitest';
import {
  applyResponsesEvents,
  finalizeResponsesText,
  parseResponsesSseChunk,
} from '../src/codex-stream';

describe('codex-stream', () => {
  it('parses delta events from SSE lines', () => {
    const chunk =
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n' +
      'data: {"type":"response.output_text.delta","delta":" world"}\n';
    const { remainder, events } = parseResponsesSseChunk(chunk);
    expect(remainder).toBe('');
    const state = { streamed: '', completed: null };
    applyResponsesEvents(events, state);
    expect(finalizeResponsesText(state)).toBe('Hello world');
  });

  it('falls back to completed response payload', () => {
    const state = { streamed: '', completed: null };
    applyResponsesEvents(
      [
        {
          type: 'response.completed',
          response: { output_text: 'done' },
        },
      ],
      state,
    );
    expect(finalizeResponsesText(state)).toBe('done');
  });
});
