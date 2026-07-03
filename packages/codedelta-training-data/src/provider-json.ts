import type { TrainingDiffHunk, TrainingTask } from '@codedelta/types';

export interface ProviderReviewSliceInput {
  intent?: unknown;
  trainable?: unknown;
  trainability_reason?: unknown;
  noise?: unknown;
  files?: unknown;
  task?: unknown;
}

export interface ProviderReviewOutput {
  slices?: unknown;
}

export interface ValidatedReviewSlice {
  intent: string;
  trainable: boolean;
  trainability_reason: string;
  noise: string[];
  files: Array<{ path: string; hunks: TrainingDiffHunk[] }>;
  task: TrainingTask;
  warnings: string[];
}

export interface ValidatedReviewOutput {
  slices: ValidatedReviewSlice[];
}

export interface ValidateReviewOutputOptions {
  allowedFiles: string[];
  hunks: TrainingDiffHunk[];
}

export interface ReviewPromptPayload {
  commit: {
    hash: string;
    message: string;
    parent: string;
  };
  changedFiles: string[];
  hunks: TrainingDiffHunk[];
  diff: string;
  graphSummary?: unknown;
}

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

export function buildReviewSystemPrompt(): string {
  return [
    'You are CodeDelta Training Data Export, an evidence-grounded code-review slicer.',
    'Use ONLY the commit metadata, changed files, hunks, graph summary, and diff provided by the user.',
    'Return strict JSON only, with no markdown fences and no explanation outside JSON.',
    'Schema:',
    '{',
    '  "slices": [',
    '    {',
    '      "intent": string,',
    '      "trainable": boolean,',
    '      "trainability_reason": string,',
    '      "noise": string[],',
    '      "files": [{ "path": string, "hunk_ids": string[] }],',
    '      "task": {',
    '        "instruction": string,',
    '        "constraints": string[],',
    '        "before_summary": string,',
    '        "after_summary": string,',
    '        "minimal_context_files": string[],',
    '        "plan": string[],',
    '        "verification_command_candidates": string[]',
    '      }',
    '    }',
    '  ]',
    '}',
    'Never invent file paths or hunk ids. If the change is noisy or unsuitable, set trainable false.',
  ].join('\n');
}

export function buildReviewUserPayload(payload: ReviewPromptPayload): string {
  return JSON.stringify(payload, null, 2);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseTask(value: unknown, allowedFiles: Set<string>): TrainingTask | null {
  if (!value || typeof value !== 'object') return null;
  const task = value as Record<string, unknown>;
  const instruction = nonEmptyString(task.instruction);
  const before = nonEmptyString(task.before_summary);
  const after = nonEmptyString(task.after_summary);
  if (!instruction || !before || !after) return null;

  return {
    instruction,
    constraints: stringArray(task.constraints),
    before_summary: before,
    after_summary: after,
    minimal_context_files: stringArray(task.minimal_context_files).filter((file) => allowedFiles.has(file)),
    plan: stringArray(task.plan),
    verification_command_candidates: stringArray(task.verification_command_candidates),
  };
}

function parseFiles(
  value: unknown,
  allowedFiles: Set<string>,
  hunkById: Map<string, TrainingDiffHunk>,
): Array<{ path: string; hunks: TrainingDiffHunk[] }> | null {
  if (!Array.isArray(value)) return null;
  const files: Array<{ path: string; hunks: TrainingDiffHunk[] }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const filePath = nonEmptyString(record.path);
    if (!filePath || !allowedFiles.has(filePath)) return null;
    const hunkIds = stringArray(record.hunk_ids);
    const hunks = hunkIds.map((id) => hunkById.get(id)).filter((h): h is TrainingDiffHunk => Boolean(h));
    if (hunks.length !== hunkIds.length || hunks.some((h) => h.file !== filePath)) return null;
    files.push({ path: filePath, hunks });
  }
  return files.length > 0 ? files : null;
}

export function validateReviewOutput(
  raw: unknown,
  options: ValidateReviewOutputOptions,
): { ok: true; value: ValidatedReviewOutput } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Provider output is not a JSON object' };
  }
  const parsed = raw as ProviderReviewOutput;
  if (!Array.isArray(parsed.slices)) {
    return { ok: false, reason: 'Provider output is missing slices' };
  }

  const allowedFiles = new Set(options.allowedFiles);
  const hunkById = new Map(options.hunks.map((h) => [h.id, h]));
  const hunkUseCount = new Map<string, number>();
  const slices: ValidatedReviewSlice[] = [];

  for (const rawSlice of parsed.slices) {
    if (!rawSlice || typeof rawSlice !== 'object') continue;
    const slice = rawSlice as ProviderReviewSliceInput;
    const intent = nonEmptyString(slice.intent);
    const reason = nonEmptyString(slice.trainability_reason);
    const task = parseTask(slice.task, allowedFiles);
    const files = parseFiles(slice.files, allowedFiles, hunkById);
    if (!intent || !reason || !task || !files) {
      return { ok: false, reason: 'Provider slice references unknown files or hunks' };
    }
    for (const file of files) {
      for (const hunk of file.hunks) {
        hunkUseCount.set(hunk.id, (hunkUseCount.get(hunk.id) ?? 0) + 1);
      }
    }
    slices.push({
      intent,
      trainable: slice.trainable === true,
      trainability_reason: reason,
      noise: stringArray(slice.noise),
      files,
      task,
      warnings: [],
    });
  }

  if (slices.length === 0) {
    return { ok: false, reason: 'Provider output contains no valid slices' };
  }

  const overlapIds = new Set(
    Array.from(hunkUseCount.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  );
  if (overlapIds.size === 0) {
    return { ok: true, value: { slices } };
  }

  return {
    ok: true,
    value: {
      slices: slices.map((slice) => ({
        ...slice,
        trainable: false,
        trainability_reason: `${slice.trainability_reason}; overlaps another slice`,
        warnings: [...slice.warnings, `Overlapping hunk ids: ${Array.from(overlapIds).join(', ')}`],
      })),
    },
  };
}
