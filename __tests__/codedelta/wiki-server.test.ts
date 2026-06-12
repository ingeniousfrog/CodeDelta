import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../packages/codedelta-server/src';

function run(cmd: string, cwd: string): void {
  execFileSync('sh', ['-c', cmd], { cwd, stdio: 'pipe' });
}

async function waitForWikiReady(
  app: ReturnType<typeof createApp>['app'],
  repoId: string,
  commit: string,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/repos/${repoId}/wiki/status?commit=${commit}`);
    expect(res.status).toBe(200);
    if (res.body.state === 'ready') return res.body;
    if (res.body.state === 'error') {
      throw new Error(`wiki generation failed: ${res.body.error}`);
    }
    if (Date.now() > deadline) throw new Error('timed out waiting for wiki generation');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('codedelta-server wiki (none provider, deterministic path)', () => {
  let tmpDir: string;
  let cacheRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedelta-wiki-'));
    cacheRoot = path.join(tmpDir, '.codedelta');
    run('git init -b main', tmpDir);
    run('git config user.email "test@example.com"', tmpDir);
    run('git config user.name "Test User"', tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# wiki demo\n\n![badge](docs/badge.png)\n\nDemo repository for wiki tests.\n');
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    // 1x1 PNG
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'badge.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'auth.ts'),
      [
        'export function login(user: string): boolean {',
        '  return validate(user);',
        '}',
        '',
        'export function validate(user: string): boolean {',
        '  return user.length > 0;',
        '}',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'server.ts'),
      [
        "import { login } from './auth';",
        '',
        'export function handleRequest(user: string): string {',
        "  return login(user) ? 'ok' : 'denied';",
        '}',
        '',
      ].join('\n'),
    );
    run('git add . && git commit -m "initial commit"', tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates a wiki, serves toc/pages, and answers ask deterministically', async () => {
    const { app } = createApp({ cacheRoot });
    const importRes = await request(app).post('/api/repos/import').send({ source: 'local', input: tmpDir });
    expect(importRes.status).toBe(201);
    const repoId = importRes.body.id as string;
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).trim();

    // Status before generation.
    const absent = await request(app).get(`/api/repos/${repoId}/wiki/status?commit=${commit}`);
    expect(absent.status).toBe(200);
    expect(absent.body.state).toBe('absent');

    // TOC before generation → 404 guidance.
    const earlyToc = await request(app).get(`/api/repos/${repoId}/wiki/toc?commit=${commit}`);
    expect(earlyToc.status).toBe(404);

    // Kick off generation (background job).
    const gen = await request(app).post(`/api/repos/${repoId}/wiki/generate?commit=${commit}`);
    expect([200, 202]).toContain(gen.status);

    const ready = await waitForWikiReady(app, repoId, commit);
    expect(ready.llmUsed).toBe(false);

    // Re-generate on a ready wiki is a no-op.
    const regen = await request(app).post(`/api/repos/${repoId}/wiki/generate?commit=${commit}`);
    expect(regen.status).toBe(200);
    expect(regen.body.status).toBe('ready');

    // TOC: overview + architecture first, then module sections.
    const toc = await request(app).get(`/api/repos/${repoId}/wiki/toc?commit=${commit}`);
    expect(toc.status).toBe(200);
    const sections = toc.body.sections as Array<{ id: string; kind: string }>;
    expect(sections[0].id).toBe('overview');
    expect(sections[1].id).toBe('architecture');
    expect(sections.length).toBeGreaterThanOrEqual(2);

    // Overview page: markdown with README excerpt, citations array present.
    const overview = await request(app).get(
      `/api/repos/${repoId}/wiki/page?commit=${commit}&section=overview`,
    );
    expect(overview.status).toBe(200);
    expect(overview.body.markdown).toContain('# Overview');
    expect(overview.body.markdown).toContain('/wiki/asset?');
    expect(overview.body.markdown).toContain(encodeURIComponent('docs/badge.png'));
    expect(overview.body.markdown).toContain('Demo repository for wiki tests.');
    expect(Array.isArray(overview.body.citations)).toBe(true);

    const asset = await request(app).get(
      `/api/repos/${repoId}/wiki/asset?commit=${commit}&path=${encodeURIComponent('docs/badge.png')}`,
    );
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toMatch(/image\/png/);
    expect(asset.body.length).toBeGreaterThan(0);

    // Every TOC section has a retrievable page.
    for (const section of sections) {
      const page = await request(app).get(
        `/api/repos/${repoId}/wiki/page?commit=${commit}&section=${section.id}`,
      );
      expect(page.status).toBe(200);
      expect(typeof page.body.markdown).toBe('string');
      expect(page.body.markdown.length).toBeGreaterThan(0);
    }

    // Unknown section → 404.
    const missing = await request(app).get(
      `/api/repos/${repoId}/wiki/page?commit=${commit}&section=nope`,
    );
    expect(missing.status).toBe(404);

    // Ask without provider: deterministic answer grounded in matched symbols.
    const ask = await request(app)
      .post(`/api/repos/${repoId}/wiki/ask`)
      .send({ commit, question: 'how does login validate the user?' });
    expect(ask.status).toBe(200);
    expect(ask.body.provider.used).toBe(false);
    expect(ask.body.answer).toContain('login');
    expect(Array.isArray(ask.body.citations)).toBe(true);
    expect(Array.isArray(ask.body.evidence)).toBe(true);
    expect(ask.body.evidence.length).toBeGreaterThan(0);

    // Ask validation errors.
    const noQuestion = await request(app).post(`/api/repos/${repoId}/wiki/ask`).send({ commit });
    expect(noQuestion.status).toBe(400);
    const noCommit = await request(app)
      .post(`/api/repos/${repoId}/wiki/ask`)
      .send({ question: 'anything' });
    expect(noCommit.status).toBe(400);
  }, 180_000);

  it('rejects generate without commit and unknown repo', async () => {
    const { app } = createApp({ cacheRoot });
    const importRes = await request(app).post('/api/repos/import').send({ source: 'local', input: tmpDir });
    const repoId = importRes.body.id as string;

    const noCommit = await request(app).post(`/api/repos/${repoId}/wiki/generate`);
    expect(noCommit.status).toBe(400);

    const badRepo = await request(app).post(`/api/repos/does-not-exist/wiki/generate?commit=abc`);
    expect(badRepo.status).toBe(404);
  });
});
