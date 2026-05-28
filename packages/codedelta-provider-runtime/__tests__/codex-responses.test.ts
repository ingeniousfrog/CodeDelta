import { describe, expect, it } from 'vitest';
import { extractResponsesText } from '../src/codex-responses';

describe('extractResponsesText', () => {
  it('reads output_text shortcut', () => {
    expect(extractResponsesText({ output_text: ' hello ' })).toBe('hello');
  });

  it('reads message output blocks', () => {
    expect(
      extractResponsesText({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'line one' }],
          },
        ],
      }),
    ).toBe('line one');
  });

  it('returns null for empty payload', () => {
    expect(extractResponsesText({})).toBeNull();
  });
});
