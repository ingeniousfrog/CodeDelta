import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src';

function run(cmd: string, cwd: string): void {
  execFileSync('sh', ['-c', cmd], { cwd, stdio: 'pipe' });
}

describe('codedelta-server (no git)', () => {
  it('returns health check', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedelta-server-'));
    const cacheRoot = path.join(tmpDir, '.codedelta');
    const { app } = createApp({ cacheRoot });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.product).toBe('CodeDelta');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns provider settings with none default', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedelta-server-'));
    const cacheRoot = path.join(tmpDir, '.codedelta');
    const { app } = createApp({ cacheRoot });
    const res = await request(app).get('/api/settings/provider');
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('none');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('codedelta-server (git)', () => {
  let tmpDir: string;
  let cacheRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedelta-server-'));
    cacheRoot = path.join(tmpDir, '.codedelta');
    run('git init -b main', tmpDir);
    run('git config user.email "test@example.com"', tmpDir);
    run('git config user.name "Test User"', tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const base = 1;\n');
    run('git add README.md index.ts && git commit -m "initial commit"', tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports local repo and lists commits', async () => {
    const { app } = createApp({ cacheRoot });
    const importRes = await request(app)
      .post('/api/repos/import')
      .send({ source: 'local', input: tmpDir });
    expect(importRes.status).toBe(201);
    expect(importRes.body.id).toBeTruthy();

    const repoId = importRes.body.id as string;
    const commitsRes = await request(app).get(`/api/repos/${repoId}/commits`);
    expect(commitsRes.status).toBe(200);
    expect(commitsRes.body.length).toBe(1);
    expect(commitsRes.body[0].message).toBe('initial commit');
  });

  it('compares two commits', async () => {
    fs.writeFileSync(path.join(tmpDir, 'auth.ts'), 'export function login() {}\n');
    run('git add auth.ts && git commit -m "add auth"', tmpDir);

    const hashes = execFileSync('git', ['log', '--format=%H', '-2'], {
      cwd: tmpDir,
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    const head = hashes[0]!;
    const base = hashes[1]!;

    const { app } = createApp({ cacheRoot });
    const importRes = await request(app)
      .post('/api/repos/import')
      .send({ source: 'local', input: tmpDir });
    const repoId = importRes.body.id as string;

    const compareRes = await request(app).get(
      `/api/repos/${repoId}/compare?base=${base}&head=${head}`,
    );
    expect(compareRes.status).toBe(200);
    expect(compareRes.body.graphDiff).toBeDefined();
    expect(compareRes.body.impact.score).toBeGreaterThanOrEqual(0);
    expect(compareRes.body.base.type).toBe('commit');

    const diffRes = await request(app).get(
      `/api/repos/${repoId}/diff?base=${base}&head=${head}&file=${encodeURIComponent('auth.ts')}`,
    );
    expect(diffRes.status).toBe(200);
    expect(diffRes.body.file).toBe('auth.ts');
    expect(typeof diffRes.body.patch).toBe('string');
    expect(Array.isArray(diffRes.body.hunks)).toBe(true);

  });

  it('traces commits in no-ai mode with evidence', async () => {
    fs.writeFileSync(path.join(tmpDir, 'auth.ts'), 'export function login() {}\n');
    run('git add auth.ts && git commit -m "add auth callback handler"', tmpDir);

    const { app } = createApp({ cacheRoot });
    const importRes = await request(app).post('/api/repos/import').send({ source: 'local', input: tmpDir });
    const repoId = importRes.body.id as string;

    const traceRes = await request(app).post(`/api/repos/${repoId}/trace`).send({
      question: 'when did auth callback handler change?',
      commitLimit: 20,
      includeDiffEvidence: true,
    });

    expect(traceRes.status).toBe(200);
    expect(traceRes.body.question).toContain('auth callback');
    expect(Array.isArray(traceRes.body.candidates)).toBe(true);
    expect(Array.isArray(traceRes.body.evidence)).toBe(true);
    expect(traceRes.body.provider.used).toBe(false);
  });
});
