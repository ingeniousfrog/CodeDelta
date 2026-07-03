import { Router, type Request, type Response } from 'express';
import type { TrainingExportFormat, TrainingExportRequest } from '@codedelta/types';
import type { JobStore } from '../jobs';
import {
  TrainingExportError,
  getTrainingExportArtifact,
  getTrainingExportStatus,
  listTrainingExportArtifacts,
  startTrainingExport,
} from '../services/training';
import { RepoRegistry, SettingsStore } from '../store/repo-registry';
import { param } from './params';

const FORMATS = new Set(['canonical', 'alpaca', 'sharegpt', 'dpo', 'rl']);

function handleError(res: Response, err: unknown): void {
  if (err instanceof TrainingExportError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : 'Training export failed' });
}

/** Mounted at /api/repos/:id/training (mergeParams gives access to :id). */
export function createTrainingRouter(
  registry: RepoRegistry,
  settings: SettingsStore,
  jobs: JobStore,
): Router {
  const router = Router({ mergeParams: true });

  router.post('/export', (req: Request, res: Response) => {
    const repoId = param(req.params.id);
    const body = (req.body ?? {}) as Partial<TrainingExportRequest>;
    if (body.mode !== 'range' && body.mode !== 'history') {
      res.status(400).json({ error: 'mode must be range or history' });
      return;
    }

    try {
      const result = startTrainingExport(registry, settings, jobs, repoId, {
        mode: body.mode,
        branch: body.branch,
        base: body.base,
        head: body.head,
        formats: body.formats,
        filters: body.filters,
      });
      res.status(202).json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/exports/:exportId/status', (req: Request, res: Response) => {
    try {
      res.json(getTrainingExportStatus(registry, jobs, param(req.params.id), param(req.params.exportId)));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/exports/:exportId/artifacts', (req: Request, res: Response) => {
    try {
      res.json(listTrainingExportArtifacts(registry, param(req.params.id), param(req.params.exportId)));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/exports/:exportId/download', (req: Request, res: Response) => {
    const format = String(req.query.format ?? '');
    if (!FORMATS.has(format)) {
      res.status(400).json({ error: 'format must be canonical, alpaca, sharegpt, dpo, or rl' });
      return;
    }
    try {
      const artifact = getTrainingExportArtifact(
        registry,
        param(req.params.id),
        param(req.params.exportId),
        format as TrainingExportFormat,
      );
      res.type(artifact.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
      res.send(artifact.body);
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
