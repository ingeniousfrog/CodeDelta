import express from 'express';
import cors from 'cors';
import { createReposRouter } from './routes/repos';
import { createSettingsRouter } from './routes/settings';
import { RepoRegistry, SettingsStore } from './store/repo-registry';

export interface CreateAppOptions {
  cacheRoot?: string;
}

export function createApp(options: CreateAppOptions = {}) {
  const registry = new RepoRegistry(options.cacheRoot);
  const settings = new SettingsStore(options.cacheRoot);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', product: 'CodeDelta' });
  });

  app.use('/api/repos', createReposRouter(registry));
  app.use('/api/settings', createSettingsRouter(settings));

  return { app, registry, settings };
}

export function startServer(port = 3847, options: CreateAppOptions = {}) {
  const { app } = createApp(options);
  return app.listen(port, () => {
    console.log(`CodeDelta API listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  const port = parseInt(process.env.CODEDELTA_PORT ?? '3847', 10);
  startServer(port);
}
