import { readCodexAuthStatus } from '@codedelta/provider-runtime';
import { Router, type Request, type Response } from 'express';
import type { ModelProviderConfig } from '@codedelta/types';
import { SettingsStore } from '../store/repo-registry';

export function createSettingsRouter(settings: SettingsStore): Router {
  const router = Router();

  router.get('/provider', (_req: Request, res: Response) => {
    res.json(settings.getProvider());
  });

  router.get('/provider/codex-status', (_req: Request, res: Response) => {
    res.json(readCodexAuthStatus());
  });

  router.put('/provider', (req: Request, res: Response) => {
    const body = req.body as ModelProviderConfig;
    if (!body?.kind) {
      res.status(400).json({ error: 'Missing provider kind' });
      return;
    }
    const allowed = ['codex-oauth', 'openai', 'openai-compatible', 'anthropic', 'ollama', 'none'];
    if (!allowed.includes(body.kind)) {
      res.status(400).json({ error: `Invalid provider kind: ${body.kind}` });
      return;
    }
    res.json(settings.setProvider(body));
  });

  return router;
}
