import * as fs from 'fs';
import * as path from 'path';
import type { RepoRef } from '@codedelta/types';
import { expandHome } from './cache-layout';
import { computeRepoId } from './github-clone';
import { git, getDefaultBranch, gitRoot, isGitRepo, RepoNotFoundError } from './git-runner';

export interface ImportLocalOptions {
  /** Require path to exist and be a git repo. */
  validate?: boolean;
}

/** Register a local git repository (no copy — uses the path directly). */
export function importLocalRepo(inputPath: string, options: ImportLocalOptions = {}): RepoRef {
  const expanded = expandHome(inputPath.trim());
  const absPath = path.resolve(expanded);

  if (options.validate !== false) {
    if (!fs.existsSync(absPath)) {
      throw new RepoNotFoundError(`Local path does not exist: ${absPath}`);
    }
    if (!isGitRepo(absPath)) {
      throw new RepoNotFoundError(`Not a git repository: ${absPath}`);
    }
  }

  const root = gitRoot(absPath);
  const normalizedInput = root;
  const repoId = computeRepoId(normalizedInput);
  const defaultBranch = getDefaultBranch(root);

  let remoteUrl: string | undefined;
  try {
    remoteUrl = git(['config', '--get', 'remote.origin.url'], { cwd: root });
  } catch {
    remoteUrl = undefined;
  }

  return {
    id: repoId,
    source: 'local',
    input: inputPath.trim(),
    clonePath: root,
    defaultBranch,
    remoteUrl: remoteUrl || undefined,
    importedAt: new Date().toISOString(),
  };
}
