import type { CommitInfo, TraceAnswer } from '@codedelta/types';

export interface TraceQuery {
  question: string;
  repoId: string;
  branch?: string;
  candidateCommit?: string;
}

/**
 * Phase 3 TODO: retrieve candidate commits from messages/files/symbols,
 * assemble evidence, call provider for grounded answer.
 */
export async function runTrace(_query: TraceQuery): Promise<TraceAnswer> {
  throw new Error('trace-engine: not implemented (Phase 3)');
}

/** Phase 3 TODO: keyword search over commit history without LLM. */
export function findCandidateCommits(
  _commits: CommitInfo[],
  _question: string,
): CommitInfo[] {
  return [];
}
