/** Codex ChatGPT backend (same surface as Codex CLI). */
export const CODEX_BACKEND_BASE_URL = 'https://chatgpt.com/backend-api/codex';

export function extractResponsesText(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;

  if (typeof root.output_text === 'string' && root.output_text.trim()) {
    return root.output_text.trim();
  }

  const output = root.output;
  if (!Array.isArray(output)) return null;

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.type !== 'message' || !Array.isArray(row.content)) continue;
    for (const block of row.content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'output_text' && typeof b.text === 'string' && b.text.trim()) {
        parts.push(b.text.trim());
      }
    }
  }
  return parts.length > 0 ? parts.join('\n').trim() : null;
}
