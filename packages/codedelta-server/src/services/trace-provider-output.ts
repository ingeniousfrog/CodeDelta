import type { TraceCandidateCommit, TraceEvidenceItem } from '@codedelta/types';

export type ProviderTraceConfidence = 'low' | 'medium' | 'high';

export interface ProviderTraceJson {
  directAnswer?: string;
  directAnswerEvidenceRefs?: string[];
  mostLikelyCommitHash?: string | null;
  confidence?: ProviderTraceConfidence | string;
  evolution?: Array<{
    label?: string;
    commitHash?: string;
    summary?: string;
    evidenceRefs?: string[];
  }>;
  uncertainty?: string[];
  uncertaintyEvidenceRefs?: string[];
  suggestedNextChecks?: string[];
}

export interface ValidatedProviderTrace {
  directAnswer?: string;
  directAnswerEvidenceRefs: string[];
  mostLikelyCommitHash?: string;
  confidence?: ProviderTraceConfidence;
  evolution: Array<{
    label: 'before' | 'candidate' | 'after' | 'current';
    commitHash?: string;
    summary: string;
    evidenceRefs: string[];
  }>;
  uncertainty: string[];
  uncertaintyEvidenceRefs: string[];
  suggestedNextChecks: string[];
}

export interface ValidateProviderOptions {
  candidates: TraceCandidateCommit[];
  evidence: TraceEvidenceItem[];
  allCommitHashes: string[];
}

const EVOLUTION_LABELS = new Set(['before', 'candidate', 'after', 'current']);

/** Pull JSON object from raw model text (handles ```json fences). */
export function extractJsonFromModelText(raw: string): unknown | null {
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

function filterEvidenceRefs(ids: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === 'string' && allowed.has(id));
}

function isConfidence(v: unknown): v is ProviderTraceConfidence {
  return v === 'low' || v === 'medium' || v === 'high';
}

/**
 * Validate and sanitize provider JSON against known candidates and evidence.
 * Drops out-of-scope fields; never invents commits or evidence ids.
 */
export function validateProviderTraceOutput(
  raw: unknown,
  options: ValidateProviderOptions,
): { ok: true; value: ValidatedProviderTrace } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Provider output is not a JSON object' };
  }

  const parsed = raw as ProviderTraceJson;
  const allowedEvidence = new Set(options.evidence.map((e) => e.id));
  const allowedCommits = new Set(options.allCommitHashes);
  const candidateHashes = new Set(options.candidates.map((c) => c.commit.hash));

  const directAnswer =
    typeof parsed.directAnswer === 'string' && parsed.directAnswer.trim()
      ? parsed.directAnswer.trim()
      : undefined;

  const directAnswerEvidenceRefs = filterEvidenceRefs(parsed.directAnswerEvidenceRefs, allowedEvidence);

  let mostLikelyCommitHash: string | undefined;
  if (parsed.mostLikelyCommitHash === null || parsed.mostLikelyCommitHash === undefined) {
    mostLikelyCommitHash = undefined;
  } else if (typeof parsed.mostLikelyCommitHash === 'string' && candidateHashes.has(parsed.mostLikelyCommitHash)) {
    mostLikelyCommitHash = parsed.mostLikelyCommitHash;
  } else if (typeof parsed.mostLikelyCommitHash === 'string') {
    return { ok: false, reason: 'mostLikelyCommitHash is not in candidate set' };
  }

  const confidence = isConfidence(parsed.confidence) ? parsed.confidence : undefined;

  const evolution: ValidatedProviderTrace['evolution'] = [];
  if (Array.isArray(parsed.evolution)) {
    for (const step of parsed.evolution) {
      if (!step || typeof step !== 'object') continue;
      const label = typeof step.label === 'string' ? step.label : '';
      if (!EVOLUTION_LABELS.has(label)) continue;
      const summary = typeof step.summary === 'string' ? step.summary.trim() : '';
      if (!summary) continue;
      let commitHash: string | undefined;
      if (typeof step.commitHash === 'string' && allowedCommits.has(step.commitHash)) {
        commitHash = step.commitHash;
      }
      evolution.push({
        label: label as ValidatedProviderTrace['evolution'][number]['label'],
        commitHash,
        summary,
        evidenceRefs: filterEvidenceRefs(step.evidenceRefs, allowedEvidence),
      });
    }
  }

  const uncertainty = Array.isArray(parsed.uncertainty)
    ? parsed.uncertainty.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    : [];

  const uncertaintyEvidenceRefs = filterEvidenceRefs(parsed.uncertaintyEvidenceRefs, allowedEvidence);

  const suggestedNextChecks = Array.isArray(parsed.suggestedNextChecks)
    ? parsed.suggestedNextChecks.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];

  if (!directAnswer && !mostLikelyCommitHash && evolution.length === 0) {
    return { ok: false, reason: 'Provider JSON contained no usable fields after validation' };
  }

  return {
    ok: true,
    value: {
      directAnswer,
      directAnswerEvidenceRefs,
      mostLikelyCommitHash,
      confidence,
      evolution,
      uncertainty,
      uncertaintyEvidenceRefs,
      suggestedNextChecks,
    },
  };
}

export function buildTraceProviderSystemPrompt(): string {
  return [
    'You are an evidence-grounded release investigator for CodeDelta Trace View.',
    'Use ONLY the commits and evidence items provided in the user message.',
    'Never invent commits, files, symbols, behavior, or evidence ids.',
    'Return strict JSON only (no markdown), matching this schema:',
    '{',
    '  "directAnswer": string,',
    '  "directAnswerEvidenceRefs": string[],',
    '  "mostLikelyCommitHash": string | null,',
    '  "confidence": "low" | "medium" | "high",',
    '  "evolution": [{ "label": "before"|"candidate"|"after"|"current", "commitHash"?: string, "summary": string, "evidenceRefs": string[] }],',
    '  "uncertainty": string[],',
    '  "uncertaintyEvidenceRefs": string[],',
    '  "suggestedNextChecks": string[]',
    '}',
    'Every conclusion must cite evidenceRefs that exist in the input evidence list.',
    'If evidence is insufficient, say so in uncertainty and keep confidence low.',
  ].join('\n');
}
