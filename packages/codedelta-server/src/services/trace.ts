import { createProvider } from '@codedelta/provider-runtime';
import { findCandidateCommits, type TraceCommitContext } from '@codedelta/trace-engine';
import { getCommitDetail, listCommits } from '@codedelta/repo-manager';
import type {
  CommitInfo,
  TraceAnswer,
  TraceCandidateCommit,
  TraceEvidenceItem,
  TraceQuestion,
} from '@codedelta/types';
import { compareCommits, CompareError } from './compare';
import {
  buildTraceProviderSystemPrompt,
  extractJsonFromModelText,
  validateProviderTraceOutput,
} from './trace-provider-output';
import { RepoRegistry, SettingsStore } from '../store/repo-registry';

export class TraceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'TraceError';
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function confidenceFromCandidates(candidates: TraceCandidateCommit[], commitCount: number): 'low' | 'medium' | 'high' {
  if (commitCount < 3) return 'low';
  const top = candidates[0]?.relevanceScore ?? 0;
  const second = candidates[1]?.relevanceScore ?? 0;
  if (top >= 65 && top - second >= 10) return 'high';
  if (top >= 35) return 'medium';
  return 'low';
}

export async function runTrace(
  registry: RepoRegistry,
  settings: SettingsStore,
  query: TraceQuestion,
): Promise<TraceAnswer> {
  const ref = registry.get(query.repoId);
  if (!ref) throw new TraceError('Repository not found', 404);
  if (!query.question.trim()) throw new TraceError('Question is required', 400);

  const branch = query.branch ?? ref.defaultBranch;
  const commitLimit = clamp(query.commitLimit ?? 50, 10, 200);
  const includeDiffEvidence = query.includeDiffEvidence ?? true;

  let commits: CommitInfo[] = [];
  try {
    commits = listCommits(ref.clonePath, branch, { limit: commitLimit });
  } catch (err) {
    throw new TraceError(`Candidate retrieval failed: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
  if (commits.length === 0) throw new TraceError('No commits available', 404);

  const contexts: TraceCommitContext[] = commits.map((commit) => ({
    commit,
    changedFiles: getCommitDetail(ref.clonePath, commit.hash).changedFiles,
  }));

  const candidates = findCandidateCommits(contexts, query.question, 8);
  const evidence: TraceEvidenceItem[] = [];
  const uncertainty: string[] = [];
  const uncertaintyEvidenceRefs: string[] = [];
  const files = new Set<string>();
  const symbols = new Set<string>();
  const entryPoints = new Set<string>();
  const riskTags = new Set<string>();

  for (const candidate of candidates) {
    const commitHash = candidate.commit.hash;
    evidence.push({
      id: `ev-${commitHash}-message`,
      kind: 'commit-message',
      commitHash,
      title: 'Commit message match',
      detail: candidate.commit.message,
      score: candidate.relevanceScore,
    });

    for (const changed of candidate.changedFiles.slice(0, 20)) {
      files.add(changed.path);
      evidence.push({
        id: `ev-${commitHash}-file-${changed.path}`,
        kind: 'changed-file',
        commitHash,
        title: `${changed.status}: ${changed.path}`,
        detail: `Changed file ${changed.path}`,
        file: changed.path,
      });
    }

    const prev = candidate.commit.parents[0];
    if (!prev) {
      const noPrevId = `ev-${commitHash}-delta-unavailable-noparent`;
      evidence.push({
        id: noPrevId,
        kind: 'delta-unavailable',
        commitHash,
        title: 'Delta unavailable',
        detail: 'No parent commit available for previous -> candidate comparison',
      });
      uncertainty.push(`No previous commit for ${candidate.commit.shortHash}; delta comparison unavailable`);
      uncertaintyEvidenceRefs.push(noPrevId);
      continue;
    }
    candidate.previousCommitHash = prev;
    try {
      const cmp = await compareCommits(registry, query.repoId, prev, candidate.commit.hash);
      candidate.impactSummary = cmp.impact;
      candidate.deltaSummary = cmp.deltaSummary;

      if (cmp.deltaSummary) {
        evidence.push({
          id: `ev-${commitHash}-delta-summary`,
          kind: 'delta-summary',
          commitHash,
          title: 'Delta summary',
          detail: cmp.deltaSummary.overview.join(' | '),
        });
      }

      for (const n of cmp.graphDiff.modifiedNodes.slice(0, 12)) {
        symbols.add(n.after.qualifiedName);
        evidence.push({
          id: `ev-${commitHash}-symbol-${n.after.id}`,
          kind: 'changed-symbol',
          commitHash,
          title: `${n.after.name} modified`,
          detail: n.changes.join(', '),
          file: n.after.filePath,
          symbol: n.after.qualifiedName,
        });
      }

      for (const e of cmp.graphDiff.addedEdges.slice(0, 8)) {
        evidence.push({
          id: `ev-${commitHash}-edge-${e.kind}-${e.source}-${e.target}`,
          kind: 'edge-change',
          commitHash,
          title: `Edge + ${e.kind}`,
          detail: `${e.source} -> ${e.target}`,
        });
      }

      for (const tag of cmp.impact.riskTags) {
        riskTags.add(tag);
        evidence.push({
          id: `ev-${commitHash}-risk-${tag}`,
          kind: 'risk-tag',
          commitHash,
          title: `Risk tag: ${tag}`,
          detail: `Impact model matched risk tag ${tag}`,
        });
      }

      for (const ep of cmp.impact.impactedEntryPoints.slice(0, 10)) {
        entryPoints.add(ep);
        evidence.push({
          id: `ev-${commitHash}-entry-${ep}`,
          kind: 'entry-point',
          commitHash,
          title: 'Impacted entry point',
          detail: ep,
          symbol: ep,
        });
      }

      if (includeDiffEvidence) {
        const topFile = cmp.graphDiff.changedFiles[0]?.path;
        if (topFile) {
          evidence.push({
            id: `ev-${commitHash}-codediff-${topFile}`,
            kind: 'code-diff',
            commitHash,
            title: `Code diff available: ${topFile}`,
            detail: `Open Delta View diff for ${topFile}`,
            file: topFile,
          });
        }
      }
    } catch (err) {
      const unavailableId = `ev-${commitHash}-delta-unavailable`;
      const detail =
        err instanceof CompareError ? err.message : err instanceof Error ? err.message : String(err);
      evidence.push({
        id: unavailableId,
        kind: 'delta-unavailable',
        commitHash,
        title: 'Delta unavailable',
        detail,
      });
      uncertainty.push(`Delta unavailable for ${candidate.commit.shortHash}: ${detail}`);
      uncertaintyEvidenceRefs.push(unavailableId);
    }
  }

  const confidence = confidenceFromCandidates(candidates, commits.length);
  const mostLikely = candidates[0]?.commit;
  const directAnswer =
    mostLikely && candidates[0]
      ? `Most likely related commit is ${mostLikely.shortHash}: ${mostLikely.message}. Evidence score ${candidates[0].relevanceScore}.`
      : 'No strong candidate found from commit history.';
  const directAnswerEvidenceRefs = mostLikely ? [`ev-${mostLikely.hash}-message`] : [];

  const evolution = mostLikely
    ? [
        {
          label: 'before' as const,
          commitHash: candidates[0]?.previousCommitHash,
          summary: 'State before candidate change.',
          evidenceRefs: candidates[0]?.previousCommitHash ? [`ev-${mostLikely.hash}-delta-summary`] : [],
        },
        {
          label: 'candidate' as const,
          commitHash: mostLikely.hash,
          summary: `Candidate commit ${mostLikely.shortHash} introduces the strongest lexical and structural signals.`,
          evidenceRefs: [`ev-${mostLikely.hash}-message`],
        },
        {
          label: 'current' as const,
          commitHash: commits[0]?.hash,
          summary: 'Current branch head after subsequent changes.',
          evidenceRefs: [],
        },
      ]
    : [
        {
          label: 'current' as const,
          commitHash: commits[0]?.hash,
          summary: 'Insufficient evidence to identify an introducing commit.',
          evidenceRefs: [],
        },
      ];

  if (commits.length < 3) {
    uncertainty.push('Commit history is too short for reliable origin tracing');
  }

  const suggestedNextChecks = [
    ...(candidates[0]?.previousCommitHash
      ? [`Open Delta View: base=${candidates[0].previousCommitHash} head=${candidates[0].commit.hash}`]
      : []),
    'Inspect top changed files from candidate commits in diff viewer',
    'Cross-check uncertain items with runtime logs or tests',
  ];

  const providerConfig = settings.getProvider();
  const provider = createProvider(providerConfig);
  const answer: TraceAnswer = {
    question: query.question,
    directAnswer,
    directAnswerEvidenceRefs,
    mostLikelyCommit: mostLikely,
    candidates,
    evidence,
    impactRadius: {
      files: [...files].sort(),
      symbols: [...symbols].sort(),
      entryPoints: [...entryPoints].sort(),
      riskTags: [...riskTags].sort(),
    },
    evolution,
    confidence,
    uncertainty: [...new Set(uncertainty)],
    uncertaintyEvidenceRefs: [...new Set(uncertaintyEvidenceRefs)],
    suggestedNextChecks,
    provider: {
      type: provider.id,
      model: providerConfig.model,
      used: false,
    },
  };

  if (provider.id !== 'none' && provider.isConfigured()) {
    const allCommitHashes = commits.map((c) => c.hash);
    try {
      const modelText = await provider.complete({
        system: buildTraceProviderSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: JSON.stringify(
              {
                question: query.question,
                branch,
                allowedCommitHashes: allCommitHashes,
                allowedEvidenceIds: evidence.map((e) => e.id),
                candidates: candidates.slice(0, 5).map((c) => ({
                  hash: c.commit.hash,
                  message: c.commit.message,
                  score: c.relevanceScore,
                  reasons: c.reasons,
                  previousCommitHash: c.previousCommitHash,
                })),
                evidence: evidence.slice(0, 30).map((e) => ({
                  id: e.id,
                  kind: e.kind,
                  commitHash: e.commitHash,
                  title: e.title,
                  detail: e.detail.length > 240 ? `${e.detail.slice(0, 240)}…` : e.detail,
                  file: e.file,
                  symbol: e.symbol,
                })),
              },
              null,
              2,
            ),
          },
        ],
        temperature: 0.1,
      });
      const rawJson = extractJsonFromModelText(modelText);
      const validated = validateProviderTraceOutput(rawJson, {
        candidates,
        evidence,
        allCommitHashes,
      });
      if (!validated.ok) {
        answer.uncertainty.push(`Provider output rejected: ${validated.reason}`);
        answer.provider = {
          type: provider.id,
          model: providerConfig.model,
          used: true,
          nonAuthoritativeText: modelText,
        };
      } else {
        const v = validated.value;
        if (v.directAnswer) answer.directAnswer = v.directAnswer;
        if (v.directAnswerEvidenceRefs.length) answer.directAnswerEvidenceRefs = v.directAnswerEvidenceRefs;
        if (v.mostLikelyCommitHash) {
          answer.mostLikelyCommit = candidates.find((c) => c.commit.hash === v.mostLikelyCommitHash)?.commit;
        }
        if (v.confidence) answer.confidence = v.confidence;
        if (v.evolution.length) answer.evolution = v.evolution;
        if (v.uncertainty.length) {
          answer.uncertainty = [...new Set([...answer.uncertainty, ...v.uncertainty])];
        }
        if (v.uncertaintyEvidenceRefs.length) {
          answer.uncertaintyEvidenceRefs = [
            ...new Set([...(answer.uncertaintyEvidenceRefs ?? []), ...v.uncertaintyEvidenceRefs]),
          ];
        }
        if (v.suggestedNextChecks.length) answer.suggestedNextChecks = v.suggestedNextChecks;
        answer.provider = {
          type: provider.id,
          model: providerConfig.model,
          used: true,
        };
      }
    } catch (err) {
      answer.uncertainty.push(
        `Provider failed; returned deterministic evidence-only answer: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return answer;
}

