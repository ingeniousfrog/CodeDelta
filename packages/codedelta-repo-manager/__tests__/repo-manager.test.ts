import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeRepoId,
  getChangedFiles,
  getCommit,
  importLocalRepo,
  listBranches,
  listCommits,
  parseGitHubInput,
} from '../src';

function run(cmd: string, cwd: string): void {
  execFileSync('sh', ['-c', cmd], { cwd, stdio: 'pipe' });
}

describe('codedelta-repo-manager (pure)', () => {
  it('parses GitHub URLs and owner/repo shorthand', () => {
    const a = parseGitHubInput('https://github.com/foo/bar');
    expect(a.owner).toBe('foo');
    expect(a.name).toBe('bar');
    expect(a.normalizedInput).toBe('https://github.com/foo/bar');

    const b = parseGitHubInput('foo/bar');
    expect(b.cloneUrl).toBe('https://github.com/foo/bar.git');
  });

  it('computes stable repo ids', () => {
    const id1 = computeRepoId('https://github.com/foo/bar');
    const id2 = computeRepoId('https://github.com/foo/bar');
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(16);
  });
});

describe('codedelta-repo-manager (git)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedelta-repo-'));
    run('git init -b main', tmpDir);
    run('git config user.email "test@example.com"', tmpDir);
    run('git config user.name "Test User"', tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    run('git add README.md && git commit -m "initial commit"', tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'export const x = 1;\n');
    run('git add src.ts && git commit -m "add src module"', tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports a local repo and lists branches', () => {
    const ref = importLocalRepo(tmpDir);
    expect(ref.source).toBe('local');
    expect(ref.clonePath).toBe(fs.realpathSync(tmpDir));
    expect(ref.defaultBranch).toBe('main');

    const branches = listBranches(ref.clonePath);
    expect(branches).toContain('main');
  });

  it('lists commits with changed file counts', () => {
    const ref = importLocalRepo(tmpDir);
    const commits = listCommits(ref.clonePath, 'main', { limit: 10 });
    expect(commits.length).toBe(2);
    expect(commits[0]?.message).toBe('add src module');
    expect(commits[0]?.changedFilesCount).toBeGreaterThan(0);
    expect(commits[1]?.message).toBe('initial commit');
  });

  it('returns changed files for a commit', () => {
    const ref = importLocalRepo(tmpDir);
    const commits = listCommits(ref.clonePath, 'main', { limit: 1 });
    const hash = commits[0]!.hash;
    const commit = getCommit(ref.clonePath, hash);
    expect(commit.hash).toBe(hash);

    const files = getChangedFiles(ref.clonePath, hash);
    expect(files.some((f) => f.path === 'src.ts')).toBe(true);
  });
});
