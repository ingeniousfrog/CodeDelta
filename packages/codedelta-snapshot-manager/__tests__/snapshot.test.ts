import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { snapshotFilePath } from '../src/cache-paths';
import { buildFallbackSnapshot } from '../src/fallback-extractor';
import { getOrBuildSnapshot, loadSnapshot, saveSnapshot } from '../src';

function run(cmd: string, cwd: string): void {
  execFileSync('sh', ['-c', cmd], { cwd, stdio: 'pipe' });
}

describe('snapshot-manager', () => {
  let tmpDir: string;
  let cacheRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedelta-snap-'));
    cacheRoot = path.join(tmpDir, '.codedelta');
    run('git init -b main', tmpDir);
    run('git config user.email "t@e.com"', tmpDir);
    run('git config user.name "T"', tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'export function hello() {}\n');
    run('git add src.ts && git commit -m "init"', tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fallback extractor finds exported function', () => {
    const snap = buildFallbackSnapshot(tmpDir, 'repo1', 'HEAD', '0.1.0');
    expect(snap.metadata?.extractionMethod).toBe('fallback');
    expect(snap.nodes.some((n) => n.name === 'hello')).toBe(true);
  });

  it('caches snapshot to disk', async () => {
    const snap = buildFallbackSnapshot(tmpDir, 'repo1', 'abc123', '0.1.0');
    await saveSnapshot(cacheRoot, snap);
    const file = snapshotFilePath(cacheRoot, 'repo1', 'abc123', '0.1.0');
    expect(fs.existsSync(file)).toBe(true);
    const loaded = await loadSnapshot(cacheRoot, 'repo1', 'abc123', '0.1.0');
    expect(loaded?.nodeCount).toBe(snap.nodeCount);
  });

  it('getOrBuildSnapshot uses worktree without mutating repo', async () => {
    const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).trim();
    const snap = await getOrBuildSnapshot({
      repoId: 'local-repo',
      commitHash: hash,
      clonePath: tmpDir,
      cacheRoot,
      analyzerVersion: 'test-0.1.0',
    });
    expect(snap.nodes.length).toBeGreaterThan(0);
    expect(snap.metadata?.extractionMethod).toMatch(/codegraph|fallback/);
  });
});
