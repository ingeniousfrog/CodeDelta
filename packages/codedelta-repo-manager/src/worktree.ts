import * as fs from 'fs';
import * as path from 'path';
import { getWorktreesDir } from './cache-layout';
import { git } from './git-runner';

export interface WorktreeOptions {
  cacheRoot: string;
  repoId: string;
}

/**
 * Create a detached worktree at a specific commit for snapshot indexing.
 * Phase 2: used by snapshot-manager.
 */
export function createWorktree(
  clonePath: string,
  commitHash: string,
  dest: string,
): string {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    try {
      git(['worktree', 'remove', '--force', dest], { cwd: clonePath });
    } catch {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }

  git(['worktree', 'add', '--detach', dest, commitHash], { cwd: clonePath, captureStderr: true });
  return dest;
}

/** Default worktree path for a repo commit. */
export function worktreePath(options: WorktreeOptions, commitHash: string): string {
  return path.join(getWorktreesDir(options.cacheRoot, options.repoId), commitHash.slice(0, 12));
}

/** Remove a worktree directory. */
export function removeWorktree(clonePath: string, worktreeDir: string): void {
  if (!fs.existsSync(worktreeDir)) return;
  try {
    git(['worktree', 'remove', '--force', worktreeDir], { cwd: clonePath });
  } catch {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
}
