import { Router, type Request, type Response } from 'express';
import type { WikiAskRequest } from '@codedelta/types';
import type { JobStore } from '../jobs';
import {
  askWiki,
  getWikiAsset,
  getWikiPage,
  getWikiStatus,
  getWikiToc,
  startWikiGeneration,
  WikiError,
} from '../services/wiki';
import { RepoRegistry, SettingsStore } from '../store/repo-registry';
import { param } from './params';

function handleError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof WikiError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : fallback });
}

/** Mounted at /api/repos/:id/wiki (mergeParams gives access to :id). */
export function createWikiRouter(
  registry: RepoRegistry,
  settings: SettingsStore,
  jobs: JobStore,
): Router {
  const router = Router({ mergeParams: true });

  router.post('/generate', (req: Request, res: Response) => {
    const repoId = param((req.params as Record<string, string>).id);
    const commit = (req.query.commit as string | undefined)?.trim();
    const locale = (req.query.locale as string | undefined)?.trim()
      ?? (typeof req.body?.locale === 'string' ? req.body.locale : undefined);
    if (!commit) {
      res.status(400).json({ error: 'Query parameter commit is required' });
      return;
    }
    try {
      const result = startWikiGeneration(registry, settings, jobs, repoId, commit, locale);
      if (result.alreadyReady) {
        res.json({ status: 'ready' });
        return;
      }
      res.status(202).json({ status: 'generating', jobId: result.jobId });
    } catch (err) {
      handleError(res, err, 'Wiki generation failed to start');
    }
  });

  router.get('/status', (req: Request, res: Response) => {
    const repoId = param((req.params as Record<string, string>).id);
    const commit = (req.query.commit as string | undefined)?.trim();
    const locale = (req.query.locale as string | undefined)?.trim();
    if (!commit) {
      res.status(400).json({ error: 'Query parameter commit is required' });
      return;
    }
    try {
      res.json(getWikiStatus(registry, jobs, repoId, commit, locale));
    } catch (err) {
      handleError(res, err, 'Wiki status failed');
    }
  });

  router.get('/toc', (req: Request, res: Response) => {
    const repoId = param((req.params as Record<string, string>).id);
    const commit = (req.query.commit as string | undefined)?.trim();
    const locale = (req.query.locale as string | undefined)?.trim();
    if (!commit) {
      res.status(400).json({ error: 'Query parameter commit is required' });
      return;
    }
    try {
      res.json(getWikiToc(registry, repoId, commit, locale));
    } catch (err) {
      handleError(res, err, 'Wiki TOC failed');
    }
  });

  router.get('/page', (req: Request, res: Response) => {
    const repoId = param((req.params as Record<string, string>).id);
    const commit = (req.query.commit as string | undefined)?.trim();
    const section = (req.query.section as string | undefined)?.trim();
    const locale = (req.query.locale as string | undefined)?.trim();
    if (!commit || !section) {
      res.status(400).json({ error: 'Query parameters commit and section are required' });
      return;
    }
    try {
      res.json(getWikiPage(registry, repoId, commit, section, locale));
    } catch (err) {
      handleError(res, err, 'Wiki page failed');
    }
  });

  router.get('/asset', (req: Request, res: Response) => {
    const repoId = param((req.params as Record<string, string>).id);
    const commit = (req.query.commit as string | undefined)?.trim();
    const filePath = (req.query.path as string | undefined)?.trim();
    if (!commit || !filePath) {
      res.status(400).json({ error: 'Query parameters commit and path are required' });
      return;
    }
    try {
      const asset = getWikiAsset(registry, repoId, commit, filePath);
      res.type(asset.contentType).send(asset.body);
    } catch (err) {
      handleError(res, err, 'Wiki asset failed');
    }
  });

  router.post('/ask', async (req: Request, res: Response) => {
    const repoId = param((req.params as Record<string, string>).id);
    const body = (req.body ?? {}) as Partial<WikiAskRequest>;
    try {
      const result = await askWiki(registry, settings, repoId, {
        commit: body.commit ?? '',
        question: body.question ?? '',
        history: body.history,
      });
      res.json(result);
    } catch (err) {
      handleError(res, err, 'Wiki ask failed');
    }
  });

  return router;
}
