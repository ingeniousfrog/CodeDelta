import { describe, expect, it } from 'vitest';
import type { CommitInfo } from '@codedelta/types';
import { extractQueryTerms, findCandidateCommits } from '../src';

function commit(hash: string, message: string): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message,
    author: 't',
    authorEmail: 't@example.com',
    date: new Date().toISOString(),
    parents: [],
    changedFilesCount: 1,
  };
}

describe('trace-engine retrieval', () => {
  it('extracts stable query terms', () => {
    const terms = extractQueryTerms('When did oauth login callback redirect break in auth route?');
    expect(terms).toContain('oauth');
    expect(terms).toContain('auth');
    expect(terms).not.toContain('when');
  });

  it('scores matching commits higher', () => {
    const contexts = [
      {
        commit: commit('a1'.padEnd(40, '1'), 'update ui styles'),
        changedFiles: [{ path: 'src/styles.css', status: 'modified' as const }],
      },
      {
        commit: commit('b2'.padEnd(40, '2'), 'fix oauth callback redirect'),
        changedFiles: [{ path: 'src/auth/callback.ts', status: 'modified' as const }],
        riskTags: ['auth'],
      },
    ];
    const candidates = findCandidateCommits(contexts, 'oauth callback redirect auth', 2);
    expect(candidates[0]?.commit.hash).toBe(contexts[1]?.commit.hash);
    expect(candidates[0]?.relevanceScore).toBeGreaterThan(candidates[1]?.relevanceScore ?? 0);
  });

  it('keeps fallback candidates for weak matches', () => {
    const contexts = [
      {
        commit: commit('c3'.padEnd(40, '3'), 'chore: refactor'),
        changedFiles: [{ path: 'src/a.ts', status: 'modified' as const }],
      },
    ];
    const candidates = findCandidateCommits(contexts, 'unknown issue text', 5);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.reasons[0]).toContain('low direct lexical match');
  });
});

