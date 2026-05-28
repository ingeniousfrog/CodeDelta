import type { ChangedFile, CommitInfo, TraceCandidateCommit } from '@codedelta/types';

export interface TraceCommitContext {
  commit: CommitInfo;
  changedFiles: ChangedFile[];
  riskTags?: string[];
  changedSymbols?: string[];
  deltaSummaryText?: string;
  impactScore?: number;
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'for',
  'of',
  'and',
  'or',
  'in',
  'on',
  'is',
  'are',
  'was',
  'were',
  'be',
  'it',
  'this',
  'that',
  'with',
  'when',
  'why',
  'how',
  'what',
  'which',
  'issue',
  'bug',
  'change',
  'regression',
]);

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function containsAny(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t.toLowerCase()));
}

export function extractQueryTerms(question: string): string[] {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9_.\-/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return unique(terms).slice(0, 24);
}

export function scoreCommitCandidate(ctx: TraceCommitContext, terms: string[]): TraceCandidateCommit {
  const reasons: string[] = [];
  const matchedTerms: string[] = [];

  let score = 0;
  const msgMatches = containsAny(ctx.commit.message, terms);
  if (msgMatches.length > 0) {
    score += 30 + msgMatches.length * 5;
    reasons.push(`commit message matched: ${msgMatches.join(', ')}`);
    matchedTerms.push(...msgMatches);
  }

  const filePaths = ctx.changedFiles.map((f) => f.path);
  const fileText = filePaths.join('\n');
  const fileMatches = containsAny(fileText, terms);
  if (fileMatches.length > 0) {
    score += 25 + fileMatches.length * 4;
    reasons.push(`changed files matched: ${fileMatches.join(', ')}`);
    matchedTerms.push(...fileMatches);
  }

  const symbolText = (ctx.changedSymbols ?? []).join('\n');
  const symbolMatches = containsAny(symbolText, terms);
  if (symbolMatches.length > 0) {
    score += 20 + symbolMatches.length * 3;
    reasons.push(`changed symbols matched: ${symbolMatches.join(', ')}`);
    matchedTerms.push(...symbolMatches);
  }

  const riskText = (ctx.riskTags ?? []).join('\n');
  const riskMatches = containsAny(riskText, terms);
  if (riskMatches.length > 0) {
    score += 12 + riskMatches.length * 2;
    reasons.push(`risk tags matched: ${riskMatches.join(', ')}`);
    matchedTerms.push(...riskMatches);
  }

  if (ctx.deltaSummaryText) {
    const deltaMatches = containsAny(ctx.deltaSummaryText, terms);
    if (deltaMatches.length > 0) {
      score += 8 + deltaMatches.length * 2;
      reasons.push(`delta summary matched: ${deltaMatches.join(', ')}`);
      matchedTerms.push(...deltaMatches);
    }
  }

  if ((ctx.impactScore ?? 0) > 0) {
    const boost = Math.min(8, Math.round((ctx.impactScore ?? 0) / 15));
    score += boost;
    reasons.push(`impact boost: +${boost}`);
  }

  // Mild recency boost: newer commits already come first from git log.
  score += 1;

  return {
    commit: ctx.commit,
    relevanceScore: score,
    reasons: reasons.length > 0 ? reasons : ['low direct lexical match; included by recency fallback'],
    matchedTerms: unique(matchedTerms),
    changedFiles: ctx.changedFiles,
  };
}

export function findCandidateCommits(
  contexts: TraceCommitContext[],
  question: string,
  limit = 8,
): TraceCandidateCommit[] {
  const terms = extractQueryTerms(question);
  const scored = contexts.map((ctx) => scoreCommitCandidate(ctx, terms));
  const sorted = scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return sorted.slice(0, Math.max(1, limit));
}
