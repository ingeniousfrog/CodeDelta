import { describe, expect, it } from 'vitest';
import type { ChangedFile, CodingEpisode, CommitInfo, FileDiffHunk } from '@codedelta/types';
import {
  DEFAULT_TRAINING_FILTER_OPTIONS,
  buildAlpacaRows,
  buildCanonicalJsonl,
  buildDpoRows,
  buildRlTaskManifests,
  buildShareGptRows,
  evaluateTrainingInterval,
  extractJsonObject,
  validateReviewOutput,
} from '../src';

function commit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'head',
    shortHash: 'head',
    message: 'add auth retry handling',
    author: 'Test User',
    authorEmail: 'test@example.com',
    date: '2026-07-03T00:00:00.000Z',
    parents: ['base'],
    changedFilesCount: 1,
    ...overrides,
  };
}

function file(path: string, status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { path, status };
}

function hunk(id = 'h1'): FileDiffHunk & { id: string; file: string } {
  return {
    id,
    file: 'src/auth.ts',
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 4,
    header: '@@ -1,2 +1,4 @@',
    lines: ['-export const timeout = 1;', '+export const timeout = 2;'],
  };
}

function episode(overrides: Partial<CodingEpisode> = {}): CodingEpisode {
  return {
    schema_version: 'codedelta.coding_episode.v1',
    repo: { id: 'repo', name: 'repo', language_hints: ['ts'] },
    range: { base: 'base', head: 'head', commit: 'head', parent: 'base' },
    slice: {
      id: 'head:slice-001',
      intent: 'Add retry handling',
      trainable: true,
      trainability_reason: 'single coherent behavior change',
      noise: [],
      files: [{ path: 'src/auth.ts', hunks: [hunk()] }],
    },
    task: {
      instruction: 'Add retry handling to auth requests.',
      constraints: ['Preserve public API'],
      before_summary: 'Auth requests fail immediately.',
      after_summary: 'Auth requests retry transient failures.',
      minimal_context_files: ['src/auth.ts'],
      plan: ['Add retry wrapper', 'Verify errors'],
      verification_command_candidates: ['npm test'],
    },
    solution: {
      patch: 'diff --git a/src/auth.ts b/src/auth.ts\n',
      patch_applies: true,
      changed_files: ['src/auth.ts'],
    },
    quality: { confidence: 0.82, requires_human_review: false, warnings: [] },
    provenance: {
      source: 'git_commit',
      review_provider: 'codex-oauth',
      generated_at: '2026-07-03T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('evaluateTrainingInterval', () => {
  it('skips root commits', () => {
    const result = evaluateTrainingInterval({
      commit: commit({ parents: [] }),
      changedFiles: [file('src/index.ts')],
      diffText: '+export const x = 1;\n',
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('initial_commit');
  });

  it('skips merge commits by default', () => {
    const result = evaluateTrainingInterval({
      commit: commit({ parents: ['a', 'b'] }),
      changedFiles: [file('src/index.ts')],
      diffText: '+export const x = 1;\n',
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('merge_commit');
  });

  it('skips README/docs-only changes when docs are excluded', () => {
    const result = evaluateTrainingInterval({
      commit: commit({ message: 'update README' }),
      changedFiles: [file('README.md'), file('docs/usage.md')],
      diffText: '+docs\n',
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('docs_only');
  });

  it('skips format-only diffs', () => {
    const result = evaluateTrainingInterval({
      commit: commit(),
      changedFiles: [file('src/index.ts')],
      diffText: '-export const x=1;\n+export const x = 1;\n',
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('format_only');
  });

  it('skips rename-only changes', () => {
    const result = evaluateTrainingInterval({
      commit: commit(),
      changedFiles: [file('src/new.ts', 'renamed')],
      diffText: '',
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('rename_only');
  });

  it('skips lockfile-only changes', () => {
    const result = evaluateTrainingInterval({
      commit: commit(),
      changedFiles: [file('package-lock.json')],
      diffText: '+lock\n',
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('lockfile_only');
  });

  it('skips generated/vendor/minified-only changes', () => {
    const result = evaluateTrainingInterval({
      commit: commit(),
      changedFiles: [file('vendor/jquery.min.js')],
      diffText: '+minified\n',
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('generated_or_vendor_only');
  });

  it('skips huge diffs', () => {
    const result = evaluateTrainingInterval({
      commit: commit(),
      changedFiles: [file('src/index.ts')],
      diffText: 'x'.repeat(DEFAULT_TRAINING_FILTER_OPTIONS.maxDiffBytes + 1),
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('huge_diff');
  });

  it('skips commits touching too many unrelated modules', () => {
    const result = evaluateTrainingInterval({
      commit: commit(),
      changedFiles: [
        file('apps/web/a.ts'),
        file('packages/api/b.ts'),
        file('packages/db/c.ts'),
        file('packages/auth/d.ts'),
        file('scripts/e.ts'),
      ],
      diffText: '+change\n',
      options: DEFAULT_TRAINING_FILTER_OPTIONS,
    });
    expect(result.skipReason).toBe('too_many_unrelated_modules');
  });
});

describe('model JSON validation', () => {
  it('extracts fenced JSON', () => {
    expect(extractJsonObject('```json\n{"slices":[]}\n```')).toEqual({ slices: [] });
  });

  it('rejects invented files and hunks', () => {
    const result = validateReviewOutput(
      {
        slices: [
          {
            intent: 'Invented',
            trainable: true,
            trainability_reason: 'bad',
            noise: [],
            files: [{ path: 'src/missing.ts', hunk_ids: ['missing'] }],
            task: {
              instruction: 'Do it',
              constraints: [],
              before_summary: 'before',
              after_summary: 'after',
              minimal_context_files: ['src/missing.ts'],
              plan: [],
              verification_command_candidates: ['npm test'],
            },
          },
        ],
      },
      { allowedFiles: ['src/auth.ts'], hunks: [hunk()] },
    );
    expect(result.ok).toBe(false);
  });

  it('marks overlapping hunk slices unsafe for training', () => {
    const result = validateReviewOutput(
      {
        slices: [
          {
            intent: 'One',
            trainable: true,
            trainability_reason: 'ok',
            noise: [],
            files: [{ path: 'src/auth.ts', hunk_ids: ['h1'] }],
            task: {
              instruction: 'Do one',
              constraints: [],
              before_summary: 'before',
              after_summary: 'after',
              minimal_context_files: ['src/auth.ts'],
              plan: [],
              verification_command_candidates: ['npm test'],
            },
          },
          {
            intent: 'Two',
            trainable: true,
            trainability_reason: 'ok',
            noise: [],
            files: [{ path: 'src/auth.ts', hunk_ids: ['h1'] }],
            task: {
              instruction: 'Do two',
              constraints: [],
              before_summary: 'before',
              after_summary: 'after',
              minimal_context_files: ['src/auth.ts'],
              plan: [],
              verification_command_candidates: ['npm test'],
            },
          },
        ],
      },
      { allowedFiles: ['src/auth.ts'], hunks: [hunk()] },
    );
    expect(result.ok && result.value.slices.every((s) => !s.trainable)).toBe(true);
  });
});

describe('exporters', () => {
  it('canonical JSONL preserves episode fields', () => {
    const jsonl = buildCanonicalJsonl([episode()]);
    expect(JSON.parse(jsonl.trim()).schema_version).toBe('codedelta.coding_episode.v1');
  });

  it('maps Alpaca rows to instruction/input/output', () => {
    const rows = buildAlpacaRows([episode()]);
    expect(rows[0]).toMatchObject({
      instruction: 'Add retry handling to auth requests.',
    });
    expect(rows[0]?.input).toContain('Preserve public API');
    expect(rows[0]?.output).toContain('diff --git');
  });

  it('maps ShareGPT rows to conversations', () => {
    const rows = buildShareGptRows([episode()]);
    expect(rows[0]?.conversations).toEqual([
      expect.objectContaining({ from: 'human' }),
      expect.objectContaining({ from: 'gpt' }),
    ]);
  });

  it('omits DPO rows without real rejected data', () => {
    expect(buildDpoRows([episode()])).toEqual([]);
  });

  it('RL manifests include base commit, context files, verifier candidates, and reference patch', () => {
    const rows = buildRlTaskManifests([episode()]);
    expect(rows[0]).toMatchObject({
      repo_state: { base_commit: 'base' },
      context_files: ['src/auth.ts'],
      verification: ['npm test'],
      reference_solution: { patch: expect.stringContaining('diff --git') },
    });
  });

  it('excludes non-applying patches from SFT exports', () => {
    const rows = buildAlpacaRows([episode({ solution: { patch: 'bad', patch_applies: false, changed_files: ['src/auth.ts'] } })]);
    expect(rows).toEqual([]);
  });
});
