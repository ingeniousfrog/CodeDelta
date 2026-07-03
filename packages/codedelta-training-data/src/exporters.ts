import type { CodingEpisode } from '@codedelta/types';

export interface AlpacaRow {
  instruction: string;
  input: string;
  output: string;
}

export interface ShareGptRow {
  conversations: Array<{ from: 'human' | 'gpt'; value: string }>;
}

export interface DpoRow {
  instruction: string;
  input: string;
  chosen: string;
  rejected: string;
}

export interface RlTaskManifestRow {
  prompt: string;
  repo_state: { base_commit: string };
  context_files: string[];
  verification: string[];
  reference_solution: { patch: string };
}

function trainableEpisode(episode: CodingEpisode): boolean {
  return episode.slice.trainable && episode.solution.patch_applies;
}

function promptInput(episode: CodingEpisode): string {
  return [
    `Before: ${episode.task.before_summary}`,
    `After: ${episode.task.after_summary}`,
    `Constraints:\n${episode.task.constraints.map((c) => `- ${c}`).join('\n')}`,
    `Context files:\n${episode.task.minimal_context_files.map((f) => `- ${f}`).join('\n')}`,
  ].join('\n\n');
}

function responseOutput(episode: CodingEpisode): string {
  return [
    `Plan:\n${episode.task.plan.map((step) => `- ${step}`).join('\n')}`,
    `Patch:\n${episode.solution.patch}`,
    `Verification:\n${episode.task.verification_command_candidates.map((cmd) => `- ${cmd}`).join('\n')}`,
  ].join('\n\n');
}

export function buildCanonicalJsonl(episodes: CodingEpisode[]): string {
  return episodes.map((episode) => JSON.stringify(episode)).join('\n') + (episodes.length ? '\n' : '');
}

export function buildAlpacaRows(episodes: CodingEpisode[]): AlpacaRow[] {
  return episodes.filter(trainableEpisode).map((episode) => ({
    instruction: episode.task.instruction,
    input: promptInput(episode),
    output: responseOutput(episode),
  }));
}

export function buildShareGptRows(episodes: CodingEpisode[]): ShareGptRow[] {
  return episodes.filter(trainableEpisode).map((episode) => ({
    conversations: [
      { from: 'human', value: `${episode.task.instruction}\n\n${promptInput(episode)}` },
      { from: 'gpt', value: responseOutput(episode) },
    ],
  }));
}

export function buildDpoRows(_episodes: CodingEpisode[]): DpoRow[] {
  return [];
}

export function buildRlTaskManifests(episodes: CodingEpisode[]): RlTaskManifestRow[] {
  return episodes.filter(trainableEpisode).map((episode) => ({
    prompt: `${episode.task.instruction}\n\n${promptInput(episode)}`,
    repo_state: { base_commit: episode.range.base },
    context_files: episode.task.minimal_context_files,
    verification: episode.task.verification_command_candidates,
    reference_solution: { patch: episode.solution.patch },
  }));
}

export function jsonlFromRows(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}
