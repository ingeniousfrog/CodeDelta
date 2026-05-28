import { describe, expect, it } from 'vitest';
import type { CommitInfo, TraceCandidateCommit, TraceEvidenceItem } from '@codedelta/types';
import {
  buildTraceProviderSystemPrompt,
  extractJsonFromModelText,
  validateProviderTraceOutput,
} from '../src/services/trace-provider-output';

function commit(hash: string): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message: 'fix auth',
    author: 'a',
    authorEmail: 'a@x.com',
    date: new Date().toISOString(),
    parents: ['parent1'],
    changedFilesCount: 1,
  };
}

const candidates: TraceCandidateCommit[] = [
  {
    commit: commit('abc1234567890123456789012345678901234567890'),
    relevanceScore: 50,
    reasons: ['message match'],
    matchedTerms: ['auth'],
    changedFiles: [{ path: 'src/auth.ts', status: 'modified' }],
    previousCommitHash: 'parent1',
  },
];

const evidence: TraceEvidenceItem[] = [
  {
    id: 'ev-abc1234567890123456789012345678901234567890-message',
    kind: 'commit-message',
    commitHash: candidates[0]!.commit.hash,
    title: 'msg',
    detail: 'fix auth',
  },
];

describe('trace-provider-output', () => {
  it('extracts JSON from fenced model output', () => {
    const raw = '```json\n{"directAnswer":"x","confidence":"low"}\n```';
    const parsed = extractJsonFromModelText(raw);
    expect(parsed).toEqual({ directAnswer: 'x', confidence: 'low' });
  });

  it('accepts valid provider output with evidence refs', () => {
    const hash = candidates[0]!.commit.hash;
    const evId = evidence[0]!.id;
    const result = validateProviderTraceOutput(
      {
        directAnswer: 'Likely introduced in candidate commit.',
        directAnswerEvidenceRefs: [evId],
        mostLikelyCommitHash: hash,
        confidence: 'medium',
        evolution: [
          {
            label: 'candidate',
            commitHash: hash,
            summary: 'Auth path changed.',
            evidenceRefs: [evId],
          },
        ],
        uncertainty: [],
        suggestedNextChecks: ['Open Delta View'],
      },
      {
        candidates,
        evidence,
        allCommitHashes: [hash, 'parent1'],
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.directAnswerEvidenceRefs).toEqual([evId]);
      expect(result.value.mostLikelyCommitHash).toBe(hash);
    }
  });

  it('rejects unknown commit hash', () => {
    const result = validateProviderTraceOutput(
      {
        directAnswer: 'bad',
        mostLikelyCommitHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
      { candidates, evidence, allCommitHashes: [candidates[0]!.commit.hash] },
    );
    expect(result.ok).toBe(false);
  });

  it('drops unknown evidence refs', () => {
    const hash = candidates[0]!.commit.hash;
    const result = validateProviderTraceOutput(
      {
        directAnswer: 'partial',
        directAnswerEvidenceRefs: ['ev-fake', evidence[0]!.id],
        mostLikelyCommitHash: hash,
        confidence: 'high',
      },
      { candidates, evidence, allCommitHashes: [hash] },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.directAnswerEvidenceRefs).toEqual([evidence[0]!.id]);
    }
  });

  it('system prompt requires evidence-grounded JSON', () => {
    const prompt = buildTraceProviderSystemPrompt();
    expect(prompt).toContain('Never invent');
    expect(prompt).toContain('directAnswerEvidenceRefs');
  });
});
