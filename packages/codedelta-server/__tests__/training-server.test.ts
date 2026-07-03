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

async function waitForReady(app: ReturnType<typeof createApp>['app'], repoId: string, exportId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await request(app).get(`/api/repos/${repoId}/training/exports/${exportId}/status`);
    if (res.body.state === 'ready' || res.body.state === 'error') return res;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return request(app).get(`/api/repos/${repoId}/training/exports/${exportId}/status`);
}

describe('training export server API', () => {
  let tmpDir: string;
  let cacheRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedelta-training-server-'));
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

  it('rejects export start when provider is not configured', async () => {
    const { app } = createApp({ cacheRoot });
    const importRes = await request(app).post('/api/repos/import').send({ source: 'local', input: tmpDir });
    const repoId = importRes.body.id as string;

    const res = await request(app).post(`/api/repos/${repoId}/training/export`).send({
      mode: 'history',
      formats: ['canonical'],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Provider');
  });

  it('starts a history export job, records skipped commits, lists artifacts, and downloads JSONL', async () => {
    fs.appendFileSync(path.join(tmpDir, 'README.md'), '\nUsage docs\n');
    run('git add README.md && git commit -m "update README"', tmpDir);

    const { app } = createApp({ cacheRoot });
    await request(app).put('/api/settings/provider').send({
      kind: 'openai-compatible',
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1:1',
      model: 'test-model',
    });
    const importRes = await request(app).post('/api/repos/import').send({ source: 'local', input: tmpDir });
    const repoId = importRes.body.id as string;

    const start = await request(app).post(`/api/repos/${repoId}/training/export`).send({
      mode: 'history',
      branch: 'main',
      formats: ['canonical', 'alpaca', 'sharegpt', 'dpo', 'rl'],
    });
    expect(start.status).toBe(202);
    expect(start.body.exportId).toBeTruthy();

    const status = await waitForReady(app, repoId, start.body.exportId as string);
    expect(status.status).toBe(200);
    expect(status.body.state).toBe('ready');
    expect(status.body.skipped).toBeGreaterThanOrEqual(1);

    const artifacts = await request(app).get(`/api/repos/${repoId}/training/exports/${start.body.exportId}/artifacts`);
    expect(artifacts.status).toBe(200);
    expect(artifacts.body.some((a: { format: string }) => a.format === 'manifest')).toBe(true);
    expect(artifacts.body.some((a: { format: string }) => a.format === 'canonical')).toBe(true);

    const canonical = await request(app).get(
      `/api/repos/${repoId}/training/exports/${start.body.exportId}/download?format=canonical`,
    );
    expect(canonical.status).toBe(200);
    expect(canonical.header['content-type']).toContain('application/x-ndjson');

    const manifestPath = path.join(cacheRoot, 'training', repoId, 'exports', start.body.exportId, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      skipped: Array<{ skip_reason: string }>;
      artifacts: Array<{ format: string }>;
    };
    expect(manifest.skipped.some((s) => s.skip_reason === 'docs_only')).toBe(true);
    expect(manifest.artifacts.some((a) => a.format === 'dpo')).toBe(true);
  }, 15000);
});
