import * as path from 'path';
import { getChangedFilesForRange, git } from '@codedelta/repo-manager';
import type { FileDiffHunk, FileDiffResponse } from '@codedelta/types';
import { RepoRegistry } from '../store/repo-registry';
import { CompareError } from './compare';

function verifyCommit(clonePath: string, hash: string): void {
  try {
    git(['rev-parse', '--verify', hash], { cwd: clonePath });
  } catch {
    throw new CompareError(`Commit not found: ${hash}`, 404);
  }
}

function normalizeRelativeFile(input: string): string {
  const normalized = path.posix.normalize(input.replace(/\\/g, '/'));
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
    throw new CompareError('Invalid file path', 400);
  }
  if (path.isAbsolute(normalized)) {
    throw new CompareError('File must be a repository-relative path', 400);
  }
  return normalized;
}

function parseHunks(patch: string): FileDiffHunk[] {
  const hunks: FileDiffHunk[] = [];
  const lines = patch.split('\n');
  let current: FileDiffHunk | null = null;

  for (const line of lines) {
    const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/);
    if (m) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number(m[1]),
        oldLines: Number(m[2] ?? '1'),
        newStart: Number(m[3]),
        newLines: Number(m[4] ?? '1'),
        header: line,
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) hunks.push(current);
  return hunks;
}

export async function getFileDiff(
  registry: RepoRegistry,
  repoId: string,
  baseHash: string,
  headHash: string,
  fileInput: string,
): Promise<FileDiffResponse> {
  const ref = registry.get(repoId);
  if (!ref) {
    throw new CompareError('Repository not found', 404);
  }

  verifyCommit(ref.clonePath, baseHash);
  verifyCommit(ref.clonePath, headHash);

  const file = normalizeRelativeFile(fileInput);

  const changedFiles = getChangedFilesForRange(ref.clonePath, baseHash, headHash);
  const changed = changedFiles.find((f) => f.path === file || f.oldPath === file);
  if (!changed) {
    throw new CompareError('File not changed in selected range', 404);
  }

  let patch = '';
  try {
    patch = git(['diff', `${baseHash}..${headHash}`, '--', file], {
      cwd: ref.clonePath,
      captureStderr: true,
    });
  } catch {
    throw new CompareError('Diff unavailable for selected file', 422);
  }

  if (!patch.trim()) {
    throw new CompareError('Diff unavailable for selected file', 422);
  }

  return {
    repoId,
    base: baseHash,
    head: headHash,
    file: changed.path,
    status: changed.status,
    patch,
    hunks: parseHunks(patch),
  };
}
