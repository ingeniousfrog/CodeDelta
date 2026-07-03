import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createProvider } from '@codedelta/provider-runtime';
import { getChangedFilesForRange, getCommit, git, resolveRef } from '@codedelta/repo-manager';
import {
  DEFAULT_TRAINING_FILTER_OPTIONS,
  buildAlpacaRows,
  buildCanonicalJsonl,
  buildDpoRows,
  buildReviewSystemPrompt,
  buildReviewUserPayload,
  buildRlTaskManifests,
  buildShareGptRows,
  evaluateTrainingInterval,
  extractJsonObject,
  jsonlFromRows,
  parseTrainingDiffHunks,
  validateReviewOutput,
  type ValidatedReviewSlice,
} from '@codedelta/training-data';
import type {
  ChangedFile,
  CodingEpisode,
  CommitInfo,
  TrainingExportArtifact,
  TrainingExportFormat,
  TrainingExportManifest,
  TrainingExportRequest,
  TrainingExportStatus,
  TrainingFilterOptions,
  TrainingSkippedCommit,
} from '@codedelta/types';
import type { JobStore } from '../jobs';
import { compareCommits, CompareError } from './compare';
import { RepoRegistry, SettingsStore } from '../store/repo-registry';

export class TrainingExportError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'TrainingExportError';
  }
}

interface CommitInterval {
  base: string;
  head: string;
  commit: CommitInfo;
  parent: string;
}

interface ExportRunResult {
  episodes: CodingEpisode[];
  skipped: TrainingSkippedCommit[];
  warnings: string[];
}

const ALL_FORMATS: TrainingExportFormat[] = ['canonical', 'alpaca', 'sharegpt', 'dpo', 'rl'];

function requireRepo(registry: RepoRegistry, repoId: string) {
  const ref = registry.get(repoId);
  if (!ref) throw new TrainingExportError('Repository not found', 404);
  return ref;
}

function trainingRoot(cacheRoot: string, repoId: string): string {
  return path.join(cacheRoot, 'training', repoId);
}

function exportDir(cacheRoot: string, repoId: string, exportId: string): string {
  return path.join(trainingRoot(cacheRoot, repoId), 'exports', exportId);
}

function manifestPath(cacheRoot: string, repoId: string, exportId: string): string {
  return path.join(exportDir(cacheRoot, repoId, exportId), 'manifest.json');
}

function trainingJobKey(repoId: string, exportId: string): string {
  return `training\u0000${repoId}\u0000${exportId}`;
}

function writeTextAtomic(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, value, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  writeTextAtomic(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function normalizedFormats(formats: TrainingExportFormat[] | undefined): TrainingExportFormat[] {
  const requested = formats?.length ? formats : ['canonical'];
  return Array.from(new Set(requested)).filter((format): format is TrainingExportFormat =>
    ALL_FORMATS.includes(format as TrainingExportFormat),
  );
}

function mergedFilters(filters: Partial<TrainingFilterOptions> | undefined): TrainingFilterOptions {
  return { ...DEFAULT_TRAINING_FILTER_OPTIONS, ...filters };
}

function diffText(clonePath: string, base: string, head: string): string {
  return git(['diff', '--find-renames', `${base}..${head}`], { cwd: clonePath });
}

function listRangeCommits(clonePath: string, base: string, head: string): string[] {
  const out = git(['log', '--first-parent', '--reverse', '--format=%H', `${base}..${head}`], {
    cwd: clonePath,
  });
  return out.split('\n').filter(Boolean);
}

function listHistoryCommits(clonePath: string, branch: string): string[] {
  const ref = resolveRef(clonePath, branch);
  const out = git(['log', '--first-parent', '--reverse', '--format=%H', ref], { cwd: clonePath });
  return out.split('\n').filter(Boolean);
}

function intervalForCommit(clonePath: string, hash: string): CommitInterval {
  const commit = getCommit(clonePath, hash);
  const parent = commit.parents[0] ?? '';
  return { base: parent, head: commit.hash, commit, parent };
}

function planIntervals(clonePath: string, request: TrainingExportRequest, defaultBranch: string): CommitInterval[] {
  if (request.mode === 'range') {
    if (!request.base || !request.head) {
      throw new TrainingExportError('Range exports require base and head', 400);
    }
    const hashes = listRangeCommits(clonePath, request.base, request.head);
    return hashes.map((hash) => intervalForCommit(clonePath, hash));
  }

  const branch = request.branch?.trim() || defaultBranch;
  return listHistoryCommits(clonePath, branch).map((hash) => intervalForCommit(clonePath, hash));
}

function languageHints(files: ChangedFile[]): string[] {
  const hints = new Set(
    files
      .map((f) => path.extname(f.path).replace(/^\./, '').toLowerCase())
      .filter(Boolean)
      .slice(0, 8),
  );
  return Array.from(hints);
}

function repoNameFromInput(input: string): string {
  const trimmed = input.replace(/[\\/]+$/, '');
  return path.basename(trimmed) || trimmed;
}

function slicePatch(diff: string): string {
  return diff;
}

function checkPatchApplies(clonePath: string, base: string, patch: string): boolean {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedelta-patch-check-'));
  try {
    git(['worktree', 'add', '--detach', tmpDir, base], { cwd: clonePath });
    const patchPath = path.join(tmpDir, '.codedelta-check.patch');
    fs.writeFileSync(patchPath, patch, 'utf8');
    git(['apply', '--check', patchPath], { cwd: tmpDir });
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      git(['worktree', 'prune'], { cwd: clonePath });
    } catch {
      // Best-effort cleanup only; patch applicability remains non-authoritative.
    }
  }
}

function episodeFromSlice(input: {
  repoId: string;
  repoName: string;
  interval: CommitInterval;
  changedFiles: ChangedFile[];
  diff: string;
  providerId: string;
  generatedAt: string;
  index: number;
  patchApplies: boolean;
  slice: ValidatedReviewSlice;
}): CodingEpisode {
  const patch = slicePatch(input.diff);
  return {
    schema_version: 'codedelta.coding_episode.v1',
    repo: {
      id: input.repoId,
      name: input.repoName,
      language_hints: languageHints(input.changedFiles),
    },
    range: {
      base: input.interval.base,
      head: input.interval.head,
      commit: input.interval.commit.hash,
      parent: input.interval.parent,
    },
    slice: {
      id: `${input.interval.commit.hash}:slice-${String(input.index + 1).padStart(3, '0')}`,
      intent: input.slice.intent,
      trainable: input.slice.trainable && input.patchApplies,
      trainability_reason: input.patchApplies
        ? input.slice.trainability_reason
        : `${input.slice.trainability_reason}; patch did not apply to base`,
      noise: input.slice.noise,
      files: input.slice.files,
    },
    task: input.slice.task,
    solution: {
      patch,
      patch_applies: input.patchApplies,
      changed_files: input.changedFiles.map((f) => f.path),
    },
    quality: {
      confidence: input.slice.trainable && input.patchApplies ? 0.75 : 0.35,
      requires_human_review: !input.slice.trainable || !input.patchApplies || input.slice.warnings.length > 0,
      warnings: input.slice.warnings,
    },
    provenance: {
      source: 'git_commit',
      review_provider: input.providerId,
      generated_at: input.generatedAt,
    },
  };
}

async function analyzeInterval(input: {
  registry: RepoRegistry;
  repoId: string;
  clonePath: string;
  repoName: string;
  interval: CommitInterval;
  provider: ReturnType<typeof createProvider>;
  filters: TrainingFilterOptions;
}): Promise<{ episodes: CodingEpisode[]; skipped?: TrainingSkippedCommit; warnings: string[] }> {
  const changedFiles = getChangedFilesForRange(input.clonePath, input.interval.base, input.interval.head);
  const diff = diffText(input.clonePath, input.interval.base, input.interval.head);
  const evaluation = evaluateTrainingInterval({
    commit: input.interval.commit,
    changedFiles,
    diffText: diff,
    options: input.filters,
  });

  if (!evaluation.trainable && evaluation.skipReason) {
    return {
      episodes: [],
      skipped: {
        commitHash: input.interval.commit.hash,
        message: input.interval.commit.message,
        skip_reason: evaluation.skipReason,
      },
      warnings: [],
    };
  }

  const hunks = parseTrainingDiffHunks(diff);
  if (hunks.length === 0) {
    return {
      episodes: [],
      skipped: {
        commitHash: input.interval.commit.hash,
        message: input.interval.commit.message,
        skip_reason: 'no_trainable_slices',
      },
      warnings: [],
    };
  }

  let graphSummary: unknown;
  try {
    const compare = await compareCommits(input.registry, input.repoId, input.interval.base, input.interval.head);
    graphSummary = {
      deltaSummary: compare.deltaSummary,
      impact: compare.impact,
      graphDiffSummary: compare.graphDiff.summary,
    };
  } catch (err) {
    if (err instanceof CompareError) {
      return {
        episodes: [],
        skipped: {
          commitHash: input.interval.commit.hash,
          message: input.interval.commit.message,
          skip_reason: 'compare_failed',
        },
        warnings: [err.message],
      };
    }
    throw err;
  }

  const modelText = await input.provider.complete({
    system: buildReviewSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: buildReviewUserPayload({
          commit: {
            hash: input.interval.commit.hash,
            message: input.interval.commit.message,
            parent: input.interval.parent,
          },
          changedFiles: changedFiles.map((f) => f.path),
          hunks,
          diff,
          graphSummary,
        }),
      },
    ],
    temperature: 0,
  });
  const json = extractJsonObject(modelText);
  const validation = validateReviewOutput(json, {
    allowedFiles: changedFiles.map((f) => f.path),
    hunks,
  });
  if (!validation.ok) {
    return {
      episodes: [],
      skipped: {
        commitHash: input.interval.commit.hash,
        message: input.interval.commit.message,
        skip_reason: 'model_invalid',
      },
      warnings: [validation.reason],
    };
  }

  const generatedAt = new Date().toISOString();
  const patch = slicePatch(diff);
  const patchApplies = checkPatchApplies(input.clonePath, input.interval.base, patch);
  const episodes = validation.value.slices.map((slice, index) =>
    episodeFromSlice({
      repoId: input.repoId,
      repoName: input.repoName,
      interval: input.interval,
      changedFiles,
      diff,
      providerId: input.provider.id,
      generatedAt,
      index,
      patchApplies,
      slice,
    }),
  );
  const trainable = episodes.filter((episode) => episode.slice.trainable);
  if (trainable.length === 0) {
    return {
      episodes,
      skipped: {
        commitHash: input.interval.commit.hash,
        message: input.interval.commit.message,
        skip_reason: 'no_trainable_slices',
      },
      warnings: [],
    };
  }
  return { episodes, warnings: [] };
}

function artifact(format: TrainingExportArtifact['format'], filePath: string): TrainingExportArtifact {
  return {
    format,
    path: filePath,
    bytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
  };
}

function writeArtifacts(input: {
  cacheRoot: string;
  repoId: string;
  exportId: string;
  request: TrainingExportRequest;
  providerId: string;
  intervals: CommitInterval[];
  result: ExportRunResult;
}): TrainingExportManifest {
  const dir = exportDir(input.cacheRoot, input.repoId, input.exportId);
  const formats = normalizedFormats(input.request.formats);
  const artifacts: TrainingExportArtifact[] = [];
  const warnings = [...input.result.warnings];

  if (formats.includes('canonical')) {
    const filePath = path.join(dir, 'canonical.jsonl');
    writeTextAtomic(filePath, buildCanonicalJsonl(input.result.episodes));
    artifacts.push(artifact('canonical', filePath));
  }
  if (formats.includes('alpaca')) {
    const filePath = path.join(dir, 'alpaca.jsonl');
    writeTextAtomic(filePath, jsonlFromRows(buildAlpacaRows(input.result.episodes)));
    artifacts.push(artifact('alpaca', filePath));
  }
  if (formats.includes('sharegpt')) {
    const filePath = path.join(dir, 'sharegpt.jsonl');
    writeTextAtomic(filePath, jsonlFromRows(buildShareGptRows(input.result.episodes)));
    artifacts.push(artifact('sharegpt', filePath));
  }
  if (formats.includes('dpo')) {
    const rows = buildDpoRows(input.result.episodes);
    const filePath = path.join(dir, 'dpo.jsonl');
    writeTextAtomic(filePath, jsonlFromRows(rows));
    if (rows.length === 0) warnings.push('DPO export is empty because no real rejected candidates exist.');
    artifacts.push(artifact('dpo', filePath));
  }
  if (formats.includes('rl')) {
    const filePath = path.join(dir, 'rl.jsonl');
    writeTextAtomic(filePath, jsonlFromRows(buildRlTaskManifests(input.result.episodes)));
    artifacts.push(artifact('rl', filePath));
  }

  if (input.request.mode === 'history') {
    const byCommit = new Map<string, CodingEpisode[]>();
    for (const episode of input.result.episodes) {
      byCommit.set(episode.range.commit, [...(byCommit.get(episode.range.commit) ?? []), episode]);
    }
    for (const [commitHash, episodes] of byCommit.entries()) {
      writeTextAtomic(
        path.join(trainingRoot(input.cacheRoot, input.repoId), 'commits', commitHash, 'episodes.jsonl'),
        buildCanonicalJsonl(episodes),
      );
    }
  }

  const manifestWithoutSelf: TrainingExportManifest = {
    exportId: input.exportId,
    repoId: input.repoId,
    request: input.request,
    provider: {
      type: input.providerId,
      used: true,
    },
    counts: {
      intervals: input.intervals.length,
      episodes: input.result.episodes.length,
      skipped: input.result.skipped.length,
    },
    skipped: input.result.skipped,
    warnings,
    artifacts,
    generatedAt: new Date().toISOString(),
  };
  const manifestFile = manifestPath(input.cacheRoot, input.repoId, input.exportId);
  const manifest = {
    ...manifestWithoutSelf,
    artifacts: [...artifacts, { format: 'manifest' as const, path: manifestFile, bytes: 0 }],
  };
  writeJsonAtomic(manifestFile, manifest);
  const finalManifest = {
    ...manifest,
    artifacts: manifest.artifacts.map((item) =>
      item.format === 'manifest' ? artifact('manifest', manifestFile) : item,
    ),
  };
  writeJsonAtomic(manifestFile, finalManifest);
  return finalManifest;
}

async function runTrainingExport(input: {
  registry: RepoRegistry;
  repoId: string;
  request: TrainingExportRequest;
  exportId: string;
  provider: ReturnType<typeof createProvider>;
  report: (progress: { total?: number; completed?: number; phase?: string }) => void;
}): Promise<TrainingExportManifest> {
  const ref = requireRepo(input.registry, input.repoId);
  const intervals = planIntervals(ref.clonePath, input.request, ref.defaultBranch);
  const filters = mergedFilters(input.request.filters);
  const repoName = repoNameFromInput(ref.input);
  const result: ExportRunResult = { episodes: [], skipped: [], warnings: [] };

  input.report({ total: intervals.length, completed: 0, phase: 'planning' });
  let completed = 0;
  for (const interval of intervals) {
    input.report({ completed, phase: interval.commit.hash.slice(0, 7) });
    const analyzed = await analyzeInterval({
      registry: input.registry,
      repoId: input.repoId,
      clonePath: ref.clonePath,
      repoName,
      interval,
      provider: input.provider,
      filters,
    });
    result.episodes = [...result.episodes, ...analyzed.episodes];
    result.skipped = analyzed.skipped ? [...result.skipped, analyzed.skipped] : result.skipped;
    result.warnings = [...result.warnings, ...analyzed.warnings];
    completed += 1;
    input.report({ completed, phase: interval.commit.hash.slice(0, 7) });
  }

  return writeArtifacts({
    cacheRoot: input.registry.getCacheRoot(),
    repoId: input.repoId,
    exportId: input.exportId,
    request: input.request,
    providerId: input.provider.id,
    intervals,
    result,
  });
}

export function startTrainingExport(
  registry: RepoRegistry,
  settings: SettingsStore,
  jobs: JobStore,
  repoId: string,
  request: TrainingExportRequest,
): { exportId: string; jobId: string } {
  requireRepo(registry, repoId);
  const provider = createProvider(settings.getProvider());
  if (provider.id === 'none' || !provider.isConfigured()) {
    throw new TrainingExportError('Provider must be configured before starting a training export.', 400);
  }

  const exportId = randomUUID();
  const job = jobs.start('training-export', trainingJobKey(repoId, exportId), async (report) => {
    await runTrainingExport({ registry, repoId, request, exportId, provider, report });
  });
  return { exportId, jobId: job.id };
}

export function getTrainingExportStatus(
  registry: RepoRegistry,
  jobs: JobStore,
  repoId: string,
  exportId: string,
): TrainingExportStatus {
  requireRepo(registry, repoId);
  const job = jobs.getByKey(trainingJobKey(repoId, exportId));
  if (job) {
    if (job.state === 'error') {
      return {
        state: 'error',
        exportId,
        jobId: job.id,
        totalIntervals: job.progress.total,
        completedIntervals: job.progress.completed,
        currentCommit: job.progress.phase,
        error: job.error,
      };
    }
    if (job.state === 'queued' || job.state === 'running') {
      return {
        state: 'generating',
        exportId,
        jobId: job.id,
        totalIntervals: job.progress.total,
        completedIntervals: job.progress.completed,
        currentCommit: job.progress.phase,
      };
    }
  }

  const manifest = readJson<TrainingExportManifest>(manifestPath(registry.getCacheRoot(), repoId, exportId));
  if (manifest) {
    return {
      state: 'ready',
      exportId,
      totalIntervals: manifest.counts.intervals,
      completedIntervals: manifest.counts.intervals,
      episodes: manifest.counts.episodes,
      skipped: manifest.counts.skipped,
      artifacts: manifest.artifacts,
      generatedAt: manifest.generatedAt,
    };
  }

  return { state: 'absent', exportId };
}

export function listTrainingExportArtifacts(
  registry: RepoRegistry,
  repoId: string,
  exportId: string,
): TrainingExportArtifact[] {
  requireRepo(registry, repoId);
  const manifest = readJson<TrainingExportManifest>(manifestPath(registry.getCacheRoot(), repoId, exportId));
  if (!manifest) throw new TrainingExportError('Training export not found', 404);
  return manifest.artifacts;
}

export function getTrainingExportArtifact(
  registry: RepoRegistry,
  repoId: string,
  exportId: string,
  format: TrainingExportFormat,
): { body: string; contentType: string; fileName: string } {
  const artifacts = listTrainingExportArtifacts(registry, repoId, exportId);
  const item = artifacts.find((a) => a.format === format);
  if (!item) throw new TrainingExportError(`Artifact not found for format: ${format}`, 404);
  const dir = exportDir(registry.getCacheRoot(), repoId, exportId);
  const resolved = path.resolve(item.path);
  const relative = path.relative(path.resolve(dir), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TrainingExportError('Artifact path is outside export directory', 400);
  }
  if (!fs.existsSync(resolved)) {
    throw new TrainingExportError('Artifact file is missing', 404);
  }
  return {
    body: fs.readFileSync(resolved, 'utf8'),
    contentType: 'application/x-ndjson; charset=utf-8',
    fileName: path.basename(resolved),
  };
}
