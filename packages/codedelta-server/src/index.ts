import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import express from 'express';
import cors from 'cors';
import { createReposRouter } from './routes/repos';
import { createSettingsRouter } from './routes/settings';
import { RepoRegistry, SettingsStore } from './store/repo-registry';

export interface CreateAppOptions {
  cacheRoot?: string;
  /** Serve built web UI from this directory (desktop / single-port production). */
  staticRoot?: string;
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
  if (process.env.CODEDELTA_DESKTOP === '1' && process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'CodeDelta');
  }
  return undefined;
}

export function createApp(options: CreateAppOptions = {}) {
  const registry = new RepoRegistry(options.cacheRoot);
  const settings = new SettingsStore(options.cacheRoot);

  const app = express();
  app.use(cors());
  app.use(express.json());

  const gitAvailable = isGitAvailable();

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      product: 'CodeDelta',
      gitAvailable,
    });
  });

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
  }

  return { app, registry, settings };
}

export function startServer(port = 3847, options: CreateAppOptions = {}) {
  const { app } = createApp(options);
  return app.listen(port, () => {
    const mode = options.staticRoot ? 'API + UI' : 'API';
    console.log(`CodeDelta ${mode} listening on http://localhost:${port}`);
  });
}

export function resolveServerOptions(): CreateAppOptions {
  const staticDir = process.env.CODEDELTA_STATIC_DIR;
  return {
    cacheRoot: resolveCacheRoot(),
    staticRoot: staticDir ? path.resolve(staticDir) : undefined,
  };
}

if (require.main === module) {
  const port = parseInt(process.env.CODEDELTA_PORT ?? '3847', 10);
  startServer(port, resolveServerOptions());
}
