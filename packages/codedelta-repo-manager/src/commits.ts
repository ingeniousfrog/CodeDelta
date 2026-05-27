import type { ChangedFile, CommitDetail, CommitInfo } from '@codedelta/types';
import { git } from './git-runner';

export interface ListCommitsOptions {
  limit?: number;
  skip?: number;
}

interface GitLogEntry {
  commit: string;
  parents: string;
  author: string;
  authorEmail: string;
  date: string;
  subject: string;
}

/** Resolve branch/ref to a revision git accepts. */
export function resolveRef(clonePath: string, branch: string): string {
  // Bare repos use refs/heads/* directly
  try {
    return git(['rev-parse', '--verify', branch], { cwd: clonePath });
  } catch {
    return git(['rev-parse', '--verify', `origin/${branch}`], { cwd: clonePath });
  }
}

/** List commits for a branch with pagination. */
export function listCommits(
  clonePath: string,
  branch: string,
  options: ListCommitsOptions = {},
): CommitInfo[] {
  const limit = options.limit ?? 50;
  const skip = options.skip ?? 0;
  const ref = resolveRef(clonePath, branch);

  const format = [
    '%H',
    '%P',
    '%an',
    '%ae',
    '%aI',
    '%s',
  ].join('%x1f');

  const args = [
    'log',
    ref,
    `--max-count=${limit}`,
    `--skip=${skip}`,
    `--format=${format}`,
  ];

  const output = git(args, { cwd: clonePath });
  if (!output) return [];

  const entries: GitLogEntry[] = output.split('\n').filter(Boolean).map((line) => {
    const [commit, parents, author, authorEmail, date, subject] = line.split('\x1f');
    return {
      commit: commit ?? '',
      parents: parents ?? '',
      author: author ?? '',
      authorEmail: authorEmail ?? '',
      date: date ?? '',
      subject: subject ?? '',
    };
  });

  return entries.map((e) => {
    const changedFilesCount = countChangedFiles(clonePath, e.commit);
    return {
      hash: e.commit,
      shortHash: e.commit.slice(0, 7),
      message: e.subject,
      author: e.author,
      authorEmail: e.authorEmail,
      date: e.date,
      parents: e.parents ? e.parents.split(' ').filter(Boolean) : [],
      changedFilesCount,
    };
  });
}

/** Get metadata for a single commit. */
export function getCommit(clonePath: string, hash: string): CommitInfo {
  const format = ['%H', '%P', '%an', '%ae', '%aI', '%s'].join('%x1f');
  const line = git(['show', '-s', `--format=${format}`, hash], { cwd: clonePath });
  const [commit, parents, author, authorEmail, date, subject] = line.split('\x1f');

  return {
    hash: commit ?? hash,
    shortHash: (commit ?? hash).slice(0, 7),
    message: subject ?? '',
    author: author ?? '',
    authorEmail: authorEmail ?? '',
    date: date ?? '',
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    changedFilesCount: countChangedFiles(clonePath, commit ?? hash),
  };
}

/** Get commit with changed files list. */
export function getCommitDetail(clonePath: string, hash: string): CommitDetail {
  const commit = getCommit(clonePath, hash);
  const changedFiles = getChangedFiles(clonePath, hash);
  return { ...commit, changedFiles };
}

/** Count files changed in a commit (root commits return 0). */
export function countChangedFiles(clonePath: string, hash: string): number {
  try {
    const out = git(
      ['diff-tree', '--no-commit-id', '-r', '--name-only', hash],
      { cwd: clonePath },
    );
    if (!out) return 0;
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

const STATUS_MAP: Record<string, ChangedFile['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'modified',
};

/** List files changed in a single commit. */
export function getChangedFiles(clonePath: string, hash: string): ChangedFile[] {
  try {
    const out = git(
      ['diff-tree', '--no-commit-id', '-r', '-M', '--name-status', hash],
      { cwd: clonePath },
    );
    if (!out) return [];
    return parseNameStatus(out);
  } catch {
    return [];
  }
}

/** List files changed between two commits. */
export function getChangedFilesForRange(
  clonePath: string,
  base: string,
  head: string,
): ChangedFile[] {
  const out = git(['diff', '--name-status', `${base}..${head}`], { cwd: clonePath });
  if (!out) return [];
  return parseNameStatus(out);
}

function parseNameStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of output.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const statusCode = parts[0]?.charAt(0) ?? 'M';
    const status = STATUS_MAP[statusCode] ?? 'modified';

    if (status === 'renamed' || status === 'copied') {
      const oldPath = parts[1];
      const newPath = parts[2];
      if (newPath) {
        files.push({ path: newPath, status, oldPath });
      }
    } else if (parts[1]) {
      files.push({ path: parts[1], status });
    }
  }
  return files;
}

/** List branch names (local + remote, deduplicated). */
export function listBranches(clonePath: string): string[] {
  const branches = new Set<string>();

  try {
    const local = git(['branch', '--format=%(refname:short)'], { cwd: clonePath });
    for (const b of local.split('\n').filter(Boolean)) {
      branches.add(b);
    }
  } catch {
    // bare repo may not have local branches named simply
  }

  try {
    const remote = git(['branch', '-r', '--format=%(refname:short)'], { cwd: clonePath });
    for (const b of remote.split('\n').filter(Boolean)) {
      const name = b.replace(/^origin\//, '');
      if (name !== 'HEAD' && !name.includes('HEAD')) {
        branches.add(name);
      }
    }
  } catch {
    // ignore
  }

  return Array.from(branches).sort();
}
