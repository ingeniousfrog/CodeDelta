import { Router, type Request, type Response } from 'express';
import {
  getCommitDetail,
  importGitHubRepo,
  importLocalRepo,
  InvalidGitHubUrlError,
  listBranches,
  listCommits,
  RepoNotFoundError,
} from '@codedelta/repo-manager';
import type { ImportRepoRequest } from '@codedelta/types';
import { compareCommits, CompareError } from '../services/compare';
import { getFileDiff } from '../services/diff';
import { RepoRegistry } from '../store/repo-registry';
import { param } from './params';

export function createReposRouter(registry: RepoRegistry): Router {
  const router = Router();

  router.post('/import', (req: Request, res: Response) => {
    const body = req.body as ImportRepoRequest;
    if (!body?.source || !body?.input?.trim()) {
      res.status(400).json({ error: 'Missing source or input' });
      return;
    }

    try {
      const cacheRoot = registry.getCacheRoot();
      let ref;
      if (body.source === 'github') {
        ref = importGitHubRepo(body.input, { cacheRoot });
      } else if (body.source === 'local') {
        ref = importLocalRepo(body.input);
      } else {
        res.status(400).json({ error: 'source must be github or local' });
        return;
      }
      registry.add(ref);
      res.status(201).json(ref);
    } catch (err) {
      if (err instanceof InvalidGitHubUrlError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof RepoNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  router.get('/', (_req: Request, res: Response) => {
    res.json(registry.list());
  });

  router.get('/:id', (req: Request, res: Response) => {
    const id = param(req.params.id);
    const ref = registry.get(id);
    if (!ref) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    res.json(ref);
  });

  router.get('/:id/branches', (req: Request, res: Response) => {
    const id = param(req.params.id);
    const ref = registry.get(id);
    if (!ref) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    try {
      res.json(listBranches(ref.clonePath));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list branches' });
    }
  });

  router.get('/:id/compare', async (req: Request, res: Response) => {
    const id = param(req.params.id);
    const base = (req.query.base as string | undefined)?.trim();
    const head = (req.query.head as string | undefined)?.trim();

    if (!base || !head) {
      res.status(400).json({ error: 'Query parameters base and head are required' });
      return;
    }

    try {
      const result = await compareCommits(registry, id, base, head);
      res.json(result);
    } catch (err) {
      if (err instanceof CompareError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Compare failed',
      });
    }
  });


  router.get('/:id/diff', async (req: Request, res: Response) => {
    const id = param(req.params.id);
    const base = (req.query.base as string | undefined)?.trim();
    const head = (req.query.head as string | undefined)?.trim();
    const file = (req.query.file as string | undefined)?.trim();

    if (!base || !head || !file) {
      res.status(400).json({ error: 'Query parameters base, head and file are required' });
      return;
    }

    try {
      const result = await getFileDiff(registry, id, base, head, file);
      res.json(result);
    } catch (err) {
      if (err instanceof CompareError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Diff failed' });
    }
  });

  router.get('/:id/commits', (req: Request, res: Response) => {
    const id = param(req.params.id);
    const ref = registry.get(id);
    if (!ref) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const branch = (req.query.branch as string | undefined) ?? ref.defaultBranch;
    const limit = parseInt(String(req.query.limit ?? '50'), 10);
    const skip = parseInt(String(req.query.skip ?? '0'), 10);

    try {
      res.json(listCommits(ref.clonePath, branch, { limit, skip }));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list commits' });
    }
  });

  router.get('/:id/commits/:hash', (req: Request, res: Response) => {
    const id = param(req.params.id);
    const hash = param(req.params.hash);
    const ref = registry.get(id);
    if (!ref) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    try {
      res.json(getCommitDetail(ref.clonePath, hash));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Commit not found' });
    }
  });

  router.post('/:id/delta', (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Use GET /api/repos/:id/compare?base=&head= instead',
      message: 'POST /delta was replaced by GET /compare in Phase 2',
    });
  });

  // Phase 3 stub
  router.post('/:id/trace', (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'Trace View is not implemented yet',
      message: 'Issue tracing will be available in Phase 3',
    });
  });

  return router;
}
