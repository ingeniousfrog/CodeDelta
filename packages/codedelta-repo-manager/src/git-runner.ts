import { execFileSync } from 'child_process';

export class GitCommandError extends Error {
  constructor(
    message: string,
    public readonly command: string[],
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitCommandError';
  }
}

export class RepoNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoNotFoundError';
  }
}

export class InvalidGitHubUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGitHubUrlError';
  }
}

export interface GitRunOptions {
  cwd: string;
  /** When true, stderr is included in thrown GitCommandError. */
  captureStderr?: boolean;
}

/** Run a git command and return stdout trimmed. */
export function git(args: string[], options: GitRunOptions): string {
  try {
    const out = execFileSync('git', args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', options.captureStderr ? 'pipe' : 'ignore'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return out.trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const stderr = e.stderr?.toString?.() ?? '';
    throw new GitCommandError(
      `git ${args.join(' ')} failed: ${stderr || e.message || 'unknown error'}`,
      ['git', ...args],
      stderr,
    );
  }
}

/** Return true when path is inside a git working tree. */
export function isGitRepo(dir: string): boolean {
  try {
    git(['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/** Absolute path to the git working tree root. */
export function gitRoot(dir: string): string {
  return git(['rev-parse', '--show-toplevel'], { cwd: dir });
}

/** Default branch name for a clone. */
export function getDefaultBranch(clonePath: string): string {
  try {
    const symref = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: clonePath });
    const match = symref.match(/refs\/remotes\/origin\/(.+)/);
    if (match?.[1]) return match[1];
  } catch {
    // fall through
  }

  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: clonePath });
  } catch {
    return 'main';
  }
}
