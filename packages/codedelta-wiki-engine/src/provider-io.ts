import type { WikiEvidenceItem, WikiSectionKind } from '@codedelta/types';
import type { WikiSectionContext } from './page';

/** Pull a JSON object from raw model text (handles ```json fences). */
export function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function filterCitationIds(ids: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && allowed.has(id)))];
}

// ---------------------------------------------------------------------------
// Wiki page narrative
// ---------------------------------------------------------------------------

export function buildWikiPageSystemPrompt(): string {
  return [
    'You write a developer wiki page for one area of a codebase, for CodeDelta Wiki.',
    'Use ONLY the symbols, files, signatures, and source snippets provided in the user message.',
    'Never invent APIs, files, symbols, or behavior that is not visible in the input.',
    'Return strict JSON only (no markdown fences), matching this schema:',
    '{',
    '  "narrative": string,   // markdown body: what this area does, how its pieces fit together',
    '  "citationIds": string[] // evidence ids (sym-…) that ground the narrative',
    '}',
    'The narrative should be 2-6 short markdown sections; reference symbols with backticks.',
    'Every claim about a specific symbol must be backed by a citation id from the input evidence list.',
    'If the input is too thin to describe the area, keep the narrative short and factual.',
  ].join('\n');
}

export function buildWikiPageUserPayload(context: WikiSectionContext): string {
  return JSON.stringify(
    {
      section: {
        id: context.section.id,
        title: context.section.title,
        kind: context.section.kind,
        area: context.section.area,
        fileCount: context.section.files.length,
      },
      readmeExcerpt: context.readmeExcerpt,
      evidence: context.evidence.map((e) => ({
        id: e.id,
        symbol: e.symbol,
        kind: e.kind,
        signature: e.detail.length > 200 ? `${e.detail.slice(0, 200)}…` : e.detail,
        file: e.file,
        lines: e.startLine !== undefined ? `${e.startLine}-${e.endLine}` : undefined,
      })),
      sourceSnippets: context.sourceSnippets.map(({ node, snippet }) => ({
        evidenceId: `sym-${node.id}`,
        symbol: node.qualifiedName,
        file: node.filePath,
        source: snippet.length > 2000 ? `${snippet.slice(0, 2000)}…` : snippet,
      })),
    },
    null,
    2,
  );
}

export interface ValidatedWikiPage {
  narrative: string;
  citationIds: string[];
}

export function validateWikiPageOutput(
  raw: unknown,
  evidence: WikiEvidenceItem[],
): { ok: true; value: ValidatedWikiPage } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Provider output is not a JSON object' };
  }
  const parsed = raw as { narrative?: unknown; citationIds?: unknown };
  const narrative = typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '';
  if (!narrative) {
    return { ok: false, reason: 'Provider output has no narrative' };
  }
  if (narrative.length > 20000) {
    return { ok: false, reason: 'Provider narrative exceeds size limit' };
  }
  const allowed = new Set(evidence.map((e) => e.id));
  const citationIds = filterCitationIds(parsed.citationIds, allowed);
  return { ok: true, value: { narrative, citationIds } };
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

export function buildWikiAskSystemPrompt(): string {
  return [
    'You answer questions about a codebase for CodeDelta Wiki, grounded in structural evidence.',
    'Use ONLY the evidence items (symbols, call paths, source snippets, repository overview) provided in the user message.',
    'Never invent files, symbols, call relationships, or behavior.',
    'For vague questions with only entry-point / overview evidence, explain what you can from that context and suggest concrete symbols or files to ask about next.',
    'Return strict JSON only (no markdown fences), matching this schema:',
    '{',
    '  "answer": string,        // markdown; reference symbols with backticks',
    '  "citationIds": string[], // evidence ids that ground the answer',
    '  "confidence": "low" | "medium" | "high"',
    '}',
    'Every factual claim must cite evidence ids from the input list.',
    'If the evidence does not answer the question, say so explicitly and use confidence "low".',
  ].join('\n');
}

export interface ValidatedWikiAsk {
  answer: string;
  citationIds: string[];
  confidence: 'low' | 'medium' | 'high';
}

export function validateWikiAskOutput(
  raw: unknown,
  evidence: WikiEvidenceItem[],
): { ok: true; value: ValidatedWikiAsk } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Provider output is not a JSON object' };
  }
  const parsed = raw as { answer?: unknown; citationIds?: unknown; confidence?: unknown };
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  if (!answer) {
    return { ok: false, reason: 'Provider output has no answer' };
  }
  if (answer.length > 20000) {
    return { ok: false, reason: 'Provider answer exceeds size limit' };
  }
  const allowed = new Set(evidence.map((e) => e.id));
  const citationIds = filterCitationIds(parsed.citationIds, allowed);
  const confidence =
    parsed.confidence === 'low' || parsed.confidence === 'medium' || parsed.confidence === 'high'
      ? parsed.confidence
      : 'low';
  return { ok: true, value: { answer, citationIds, confidence } };
}

/** Human-readable section kind label (used in deterministic answers). */
export function sectionKindLabel(kind: WikiSectionKind): string {
  switch (kind) {
    case 'overview':
      return 'Overview';
    case 'architecture':
      return 'Architecture';
    default:
      return 'Module';
  }
}
