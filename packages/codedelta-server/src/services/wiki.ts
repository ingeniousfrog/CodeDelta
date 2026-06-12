import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createProvider } from '@codedelta/provider-runtime';
import { git } from '@codedelta/repo-manager';
import {
  getOrBuildSnapshot,
  readAnalyzerVersion,
  resolveMonorepoRoot,
  SnapshotBuildError,
  SnapshotEmptyError,
  SnapshotTimeoutError,
  SnapshotTooLargeError,
} from '@codedelta/snapshot-manager';
import type {
  CodeGraphSnapshot,
  WikiAskAnswer,
  WikiAskRequest,
  WikiPageContent,
  WikiStatus,
  WikiToc,
} from '@codedelta/types';
import {
  buildSectionContext,
  buildWikiAskSystemPrompt,
  buildWikiAssetUrl,
  buildWikiPageSystemPrompt,
  buildWikiPageUserPayload,
  citationsFromEvidence,
  composeWikiPage,
  deterministicAskAnswer,
  extractJsonObject,
  normalizeWikiAssetPath,
  planWikiToc,
  retrieveAskEvidence,
  rewriteWikiAssetUrls,
  validateWikiAskOutput,
  validateWikiPageOutput,
  WIKI_VERSION,
  type ReadSource,
} from '@codedelta/wiki-engine';
import type { JobStore } from '../jobs';
import { RepoRegistry, SettingsStore } from '../store/repo-registry';

export class WikiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'WikiError';
  }
}

interface WikiMeta {
  llmUsed: boolean;
  generatedAt: string;
}

function wikiDir(cacheRoot: string, repoId: string, commitHash: string): string {
  return path.join(cacheRoot, 'wiki', repoId, commitHash, WIKI_VERSION);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function verifyCommit(clonePath: string, hash: string): void {
  try {
    git(['rev-parse', '--verify', hash], { cwd: clonePath });
  } catch {
    throw new WikiError(`Commit not found: ${hash}`, 404);
  }
}

function requireRepo(registry: RepoRegistry, repoId: string) {
  const ref = registry.get(repoId);
  if (!ref) throw new WikiError('Repository not found', 404);
  return ref;
}

async function loadSnapshot(
  registry: RepoRegistry,
  repoId: string,
  commitHash: string,
): Promise<CodeGraphSnapshot> {
  const ref = requireRepo(registry, repoId);
  verifyCommit(ref.clonePath, commitHash);
  try {
    return await getOrBuildSnapshot({
      repoId,
      commitHash,
      clonePath: ref.clonePath,
      cacheRoot: registry.getCacheRoot(),
      analyzerVersion: readAnalyzerVersion(resolveMonorepoRoot()),
    });
  } catch (err: unknown) {
    if (err instanceof SnapshotTimeoutError) throw new WikiError(err.message, 504);
    if (err instanceof SnapshotTooLargeError) throw new WikiError(err.message, 413);
    if (err instanceof SnapshotEmptyError) throw new WikiError(err.message, 422);
    if (err instanceof SnapshotBuildError) {
      throw new WikiError(`Snapshot build failed: ${err.message}`, 500);
    }
    throw new WikiError(
      `Snapshot build failed: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

/** File reader at a commit via `git show`, memoized per generation/ask run. */
function makeReadSource(clonePath: string, commitHash: string): ReadSource {
  const cache = new Map<string, string | null>();
  return (filePath: string) => {
    if (cache.has(filePath)) return cache.get(filePath) ?? null;
    let content: string | null;
    try {
      content = git(['show', `${commitHash}:${filePath}`], { cwd: clonePath });
    } catch {
      content = null;
    }
    cache.set(filePath, content);
    return content;
  };
}

function wikiAssetResolver(repoId: string, commitHash: string): (relativePath: string) => string {
  return (relativePath) => buildWikiAssetUrl(repoId, commitHash, relativePath);
}

const WIKI_ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function mimeForWikiAsset(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  return WIKI_ASSET_MIME[ext] ?? 'application/octet-stream';
}

/** Serve a repository file at a commit (README images, etc.). */
export function getWikiAsset(
  registry: RepoRegistry,
  repoId: string,
  commitHash: string,
  fileInput: string,
): { body: Buffer; contentType: string } {
  const ref = requireRepo(registry, repoId);
  verifyCommit(ref.clonePath, commitHash);
  let filePath: string;
  try {
    filePath = normalizeWikiAssetPath(fileInput);
  } catch {
    throw new WikiError('Invalid asset path', 400);
  }
  try {
    const body = execFileSync('git', ['show', `${commitHash}:${filePath}`], {
      cwd: ref.clonePath,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    }) as Buffer;
    return { body, contentType: mimeForWikiAsset(filePath) };
  } catch {
    throw new WikiError(`Asset not found at commit: ${filePath}`, 404);
  }
}

function wikiJobKey(repoId: string, commitHash: string): string {
  return `wiki\u0000${repoId}\u0000${commitHash}`;
}

export function getWikiStatus(
  registry: RepoRegistry,
  jobs: JobStore,
  repoId: string,
  commitHash: string,
): WikiStatus {
  requireRepo(registry, repoId);

  const job = jobs.getActiveByKey(wikiJobKey(repoId, commitHash));
  if (job) {
    return {
      state: 'generating',
      commitHash,
      jobId: job.id,
      totalSections: job.progress.total,
      completedSections: job.progress.completed,
      currentSection: job.progress.phase,
    };
  }

  const dir = wikiDir(registry.getCacheRoot(), repoId, commitHash);
  const meta = readJson<WikiMeta>(path.join(dir, 'meta.json'));
  const toc = readJson<WikiToc>(path.join(dir, 'toc.json'));
  if (meta && toc) {
    return {
      state: 'ready',
      commitHash,
      totalSections: toc.sections.length,
      completedSections: toc.sections.length,
      llmUsed: meta.llmUsed,
      generatedAt: meta.generatedAt,
    };
  }
  return { state: 'absent', commitHash };
}

export function startWikiGeneration(
  registry: RepoRegistry,
  settings: SettingsStore,
  jobs: JobStore,
  repoId: string,
  commitHash: string,
): { jobId: string; alreadyReady: boolean } {
  const ref = requireRepo(registry, repoId);
  verifyCommit(ref.clonePath, commitHash);

  const status = getWikiStatus(registry, jobs, repoId, commitHash);
  if (status.state === 'ready') {
    return { jobId: '', alreadyReady: true };
  }

  const job = jobs.start('wiki-generate', wikiJobKey(repoId, commitHash), async (report) => {
    report({ phase: 'snapshot' });
    const snapshot = await loadSnapshot(registry, repoId, commitHash);

    report({ phase: 'toc' });
    const toc = planWikiToc(snapshot);
    const dir = wikiDir(registry.getCacheRoot(), repoId, commitHash);
    writeJsonAtomic(path.join(dir, 'toc.json'), toc);

    const providerConfig = settings.getProvider();
    const provider = createProvider(providerConfig);
    const useLlm = provider.id !== 'none' && provider.isConfigured();
    const readSource = makeReadSource(ref.clonePath, commitHash);
    const resolveReadmeAssetUrl = wikiAssetResolver(repoId, commitHash);

    report({ total: toc.sections.length, completed: 0 });
    let completed = 0;
    let llmUsedAnywhere = false;

    for (const section of toc.sections) {
      report({ phase: section.title, completed });
      const context = buildSectionContext(snapshot, section, readSource, {
        resolveReadmeAssetUrl,
      });

      let narrative: string | undefined;
      if (useLlm) {
        try {
          const modelText = await provider.complete({
            system: buildWikiPageSystemPrompt(),
            messages: [{ role: 'user', content: buildWikiPageUserPayload(context) }],
            temperature: 0.2,
          });
          const validated = validateWikiPageOutput(extractJsonObject(modelText), context.evidence);
          if (validated.ok) {
            narrative = validated.value.narrative;
            llmUsedAnywhere = true;
          }
        } catch {
          // Deterministic page still ships; the section just has no narrative.
        }
      }

      const { markdown, citations } = composeWikiPage(snapshot, context, narrative);
      const page: WikiPageContent = {
        sectionId: section.id,
        title: section.title,
        markdown,
        citations,
        llmUsed: narrative !== undefined,
        generatedAt: new Date().toISOString(),
      };
      writeJsonAtomic(path.join(dir, 'pages', `${section.id}.json`), page);
      completed += 1;
      report({ completed });
    }

    const meta: WikiMeta = { llmUsed: llmUsedAnywhere, generatedAt: new Date().toISOString() };
    writeJsonAtomic(path.join(dir, 'meta.json'), meta);
  });

  return { jobId: job.id, alreadyReady: false };
}

export function getWikiToc(registry: RepoRegistry, repoId: string, commitHash: string): WikiToc {
  requireRepo(registry, repoId);
  const toc = readJson<WikiToc>(
    path.join(wikiDir(registry.getCacheRoot(), repoId, commitHash), 'toc.json'),
  );
  if (!toc) {
    throw new WikiError('Wiki not generated for this commit yet. POST /wiki/generate first.', 404);
  }
  return toc;
}

export function getWikiPage(
  registry: RepoRegistry,
  repoId: string,
  commitHash: string,
  sectionId: string,
): WikiPageContent {
  requireRepo(registry, repoId);
  if (!/^[a-z0-9-]+$/.test(sectionId)) {
    throw new WikiError('Invalid section id', 400);
  }
  const page = readJson<WikiPageContent>(
    path.join(wikiDir(registry.getCacheRoot(), repoId, commitHash), 'pages', `${sectionId}.json`),
  );
  if (!page) {
    throw new WikiError('Wiki page not found. Generate the wiki for this commit first.', 404);
  }
  const resolveReadmeAssetUrl = wikiAssetResolver(repoId, commitHash);
  return {
    ...page,
    markdown: rewriteWikiAssetUrls(page.markdown, resolveReadmeAssetUrl),
  };
}

export async function askWiki(
  registry: RepoRegistry,
  settings: SettingsStore,
  repoId: string,
  body: WikiAskRequest,
): Promise<WikiAskAnswer> {
  const ref = requireRepo(registry, repoId);
  const commitHash = body.commit?.trim();
  if (!commitHash) throw new WikiError('commit is required', 400);
  const question = body.question?.trim();
  if (!question) throw new WikiError('question is required', 400);

  const snapshot = await loadSnapshot(registry, repoId, commitHash);
  const readSource = makeReadSource(ref.clonePath, commitHash);
  const retrieval = retrieveAskEvidence(snapshot, question, readSource);
  const deterministic = deterministicAskAnswer(question, retrieval);

  const providerConfig = settings.getProvider();
  const provider = createProvider(providerConfig);

  const answer: WikiAskAnswer = {
    question,
    answer: deterministic.answer,
    citations: citationsFromEvidence(
      retrieval.evidence.filter((e) => e.kind === 'symbol').map((e) => e.id),
      retrieval.evidence,
    ),
    evidence: retrieval.evidence,
    confidence: deterministic.confidence,
    provider: { type: provider.id, model: providerConfig.model, used: false },
  };

  if (provider.id === 'none' || !provider.isConfigured() || retrieval.evidence.length === 0) {
    return answer;
  }

  try {
    const history = (body.history ?? []).slice(-6);
    const modelText = await provider.complete({
      system: buildWikiAskSystemPrompt(),
      messages: [
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        {
          role: 'user' as const,
          content: JSON.stringify(
            {
              question,
              evidence: retrieval.evidence.map((e) => ({
                id: e.id,
                kind: e.kind,
                title: e.title,
                detail: e.detail.length > 1500 ? `${e.detail.slice(0, 1500)}…` : e.detail,
                file: e.file,
                symbol: e.symbol,
                lines: e.startLine !== undefined ? `${e.startLine}-${e.endLine}` : undefined,
              })),
            },
            null,
            2,
          ),
        },
      ],
      temperature: 0.1,
    });
    const validated = validateWikiAskOutput(extractJsonObject(modelText), retrieval.evidence);
    if (validated.ok) {
      answer.answer = validated.value.answer;
      answer.citations = citationsFromEvidence(validated.value.citationIds, retrieval.evidence);
      answer.confidence = validated.value.confidence;
      answer.provider = { type: provider.id, model: providerConfig.model, used: true };
    } else {
      answer.provider = {
        type: provider.id,
        model: providerConfig.model,
        used: true,
        nonAuthoritativeText: modelText,
      };
    }
  } catch {
    // Keep the deterministic answer on provider failure.
  }

  return answer;
}
