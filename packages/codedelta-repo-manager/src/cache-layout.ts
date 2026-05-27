import * as path from 'path';
import * as os from 'os';

const DEFAULT_CACHE_DIR = '.codedelta';

/** Resolve the CodeDelta cache root directory. */
export function getCacheRoot(cwd: string = process.cwd()): string {
  const env = process.env.CODEDELTA_CACHE_DIR;
  if (env) {
    return path.isAbsolute(env) ? env : path.resolve(cwd, env);
  }
  return path.resolve(cwd, DEFAULT_CACHE_DIR);
}

export function getReposDir(cacheRoot: string): string {
  return path.join(cacheRoot, 'repos');
}

export function getRepoClonePath(cacheRoot: string, repoId: string): string {
  return path.join(getReposDir(cacheRoot), repoId);
}

export function getSnapshotsDir(cacheRoot: string): string {
  return path.join(cacheRoot, 'snapshots');
}

export function getRegistryPath(cacheRoot: string): string {
  return path.join(cacheRoot, 'registry.json');
}

export function getSettingsPath(cacheRoot: string): string {
  return path.join(cacheRoot, 'settings.json');
}

export function getWorktreesDir(cacheRoot: string, repoId: string): string {
  return path.join(cacheRoot, 'worktrees', repoId);
}

/** Expand ~ in paths on POSIX systems. */
export function expandHome(input: string): string {
  if (input.startsWith('~/') || input === '~') {
    return path.join(os.homedir(), input.slice(1));
  }
  return input;
}
