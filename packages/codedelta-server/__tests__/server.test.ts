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
    run('git add README.md && git commit -m "initial commit"', tmpDir);
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
});
