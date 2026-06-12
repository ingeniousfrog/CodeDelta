import { randomUUID } from 'crypto';

export type JobState = 'queued' | 'running' | 'done' | 'error';

export interface JobProgress {
  total?: number;
  completed?: number;
  phase?: string;
}

export interface Job {
  id: string;
  kind: string;
  /** Dedupe key — one active job per key. */
  key: string;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  progress: JobProgress;
  error?: string;
}

const FINISHED_JOB_TTL_MS = 30 * 60 * 1000;

/**
 * Generic in-memory async job store (wiki generation today; reusable for
 * trace/compare task-ification later). Single-process by design — matches the
 * local-first server/desktop deployment.
 */
export class JobStore {
  private jobs = new Map<string, Job>();

  get(id: string): Job | undefined {
    this.evictFinished();
    return this.jobs.get(id);
  }

  /** Active (queued/running) job for a dedupe key, if any. */
  getActiveByKey(key: string): Job | undefined {
    this.evictFinished();
    for (const job of this.jobs.values()) {
      if (job.key === key && (job.state === 'queued' || job.state === 'running')) {
        return job;
      }
    }
    return undefined;
  }

  /**
   * Start a job unless one is already active for the key. The runner receives
   * a progress callback; completion/failure is recorded automatically.
   */
  start(
    kind: string,
    key: string,
    runner: (reportProgress: (progress: JobProgress) => void) => Promise<void>,
  ): Job {
    const existing = this.getActiveByKey(key);
    if (existing) return existing;

    const job: Job = {
      id: randomUUID(),
      kind,
      key,
      state: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      progress: {},
    };
    this.jobs.set(job.id, job);

    const reportProgress = (progress: JobProgress): void => {
      job.progress = { ...job.progress, ...progress };
      job.updatedAt = Date.now();
    };

    job.state = 'running';
    runner(reportProgress)
      .then(() => {
        job.state = 'done';
        job.updatedAt = Date.now();
      })
      .catch((err) => {
        job.state = 'error';
        job.error = err instanceof Error ? err.message : String(err);
        job.updatedAt = Date.now();
      });

    return job;
  }

  private evictFinished(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (
        (job.state === 'done' || job.state === 'error') &&
        now - job.updatedAt > FINISHED_JOB_TTL_MS
      ) {
        this.jobs.delete(id);
      }
    }
  }
}
