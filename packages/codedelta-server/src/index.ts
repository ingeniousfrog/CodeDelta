import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { JobStore } from './jobs';
import { createReposRouter } from './routes/repos';
import { createSettingsRouter } from './routes/settings';
import { createTrainingRouter } from './routes/training';
import { createWikiRouter } from './routes/wiki';
import { RepoRegistry, SettingsStore } from './store/repo-registry';

export interface CreateAppOptions {
  cacheRoot?: string;
  /** Serve built web UI from this directory (desktop / single-port production). */
  staticRoot?: string;
  /** Dev-only: proxy non-API routes to the Vite dev server (e.g. http://localhost:5173). */
  devUiUrl?: string;
}

function apiOnlyLandingHtml(viteUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CodeDelta API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
    code, pre { background: #f4f4f5; padding: 0.15rem 0.35rem; border-radius: 4px; }
    pre { padding: 0.75rem; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>CodeDelta API is running</h1>
  <p>This port serves <code>/api/*</code> only. The React UI is not bundled here in dev mode.</p>
  <p>Start the full dev stack from the repo root:</p>
  <pre>npm run dev:codedelta</pre>
  <p>Then open <a href="${viteUrl}">${viteUrl}</a> (Vite) or enable UI proxy via <code>CODEDELTA_DEV_UI_URL</code> to use this port for the UI too.</p>
</body>
</html>`;
}

function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Resolve cache root from env or desktop defaults. */
export function resolveCacheRoot(): string | undefined {
  const env = process.env.CODEDELTA_CACHE_DIR;
  if (env) {
    return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env);
  }
  if (process.env.CODEDELTA_DESKTOP === '1') {
    const base =
      process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'CodeDelta')
        : process.env.APPDATA
          ? path.join(process.env.APPDATA, 'CodeDelta')
          : path.join(os.homedir(), '.codedelta');
    return base;
  }
  return undefined;
}

export function createApp(options: CreateAppOptions = {}) {
  const registry = new RepoRegistry(options.cacheRoot);
  const settings = new SettingsStore(options.cacheRoot);
  const jobs = new JobStore();

  const app = express();
  app.use(cors());
  app.use(express.json());

  const gitAvailable = isGitAvailable();

  const uiMode = options.staticRoot ? 'static' : options.devUiUrl ? 'dev-proxy' : 'api-only';

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      product: 'CodeDelta',
      gitAvailable,
      servesUi: uiMode !== 'api-only',
      uiMode,
      devUiUrl: options.devUiUrl,
    });
  });

  app.use('/api/repos/:id/wiki', createWikiRouter(registry, settings, jobs));
  app.use('/api/repos/:id/training', createTrainingRouter(registry, settings, jobs));
  app.use('/api/repos', createReposRouter(registry, settings));
  app.use('/api/settings', createSettingsRouter(settings));

  if (options.staticRoot) {
    const staticRoot = path.resolve(options.staticRoot);
    if (!fs.existsSync(path.join(staticRoot, 'index.html'))) {
      console.warn(`CODEDELTA_STATIC_DIR: index.html not found in ${staticRoot}`);
    }
    app.use(express.static(staticRoot));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(staticRoot, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  } else if (options.devUiUrl) {
    app.use(
      createProxyMiddleware({
        target: options.devUiUrl,
        changeOrigin: true,
        ws: true,
      }),
    );
  } else {
    app.get('/', (_req, res) => {
      res.type('html').send(apiOnlyLandingHtml('http://localhost:5173'));
    });
  }

  return { app, registry, settings };
}

export function startServer(port = 3847, options: CreateAppOptions = {}) {
  const { app } = createApp(options);
  return app.listen(port, () => {
    const url = `http://localhost:${port}`;
    if (options.staticRoot) {
      console.log(`CodeDelta API + UI listening on ${url}`);
      return;
    }
    if (options.devUiUrl) {
      console.log(`CodeDelta dev listening on ${url} (UI proxied from ${options.devUiUrl})`);
      console.log(`Open ${url} in your browser.`);
      return;
    }
    console.log(`CodeDelta API listening on ${url}`);
    console.log('Web UI: run Vite separately and open http://localhost:5173');
  });
}

export function resolveServerOptions(): CreateAppOptions {
  const staticDir = process.env.CODEDELTA_STATIC_DIR;
  const devUiUrl = process.env.CODEDELTA_DEV_UI_URL?.trim();
  return {
    cacheRoot: resolveCacheRoot(),
    staticRoot: staticDir ? path.resolve(staticDir) : undefined,
    devUiUrl: devUiUrl || undefined,
  };
}

if (require.main === module) {
  const port = parseInt(process.env.CODEDELTA_PORT ?? '3847', 10);
  startServer(port, resolveServerOptions());
}
