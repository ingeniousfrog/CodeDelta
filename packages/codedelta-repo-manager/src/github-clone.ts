import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { RepoRef } from '@codedelta/types';
import { getCacheRoot, getRepoClonePath, getReposDir } from './cache-layout';
import { git, getDefaultBranch, InvalidGitHubUrlError } from './git-runner';

const GITHUB_URL_RE =
  /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#].*)?$/i;

const GITHUB_SHORT_RE = /^([^/]+\/[^/]+)$/;

export interface ParsedGitHubRepo {
  owner: string;
  name: string;
  cloneUrl: string;
  normalizedInput: string;
}

/** Parse GitHub URL or owner/repo shorthand into clone URL. */
export function parseGitHubInput(input: string): ParsedGitHubRepo {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(GITHUB_URL_RE);
  if (urlMatch) {
    const owner = urlMatch[1]!;
    const name = urlMatch[2]!.replace(/\.git$/, '');
    return {
      owner,
      name,
      cloneUrl: `https://github.com/${owner}/${name}.git`,
      normalizedInput: `https://github.com/${owner}/${name}`,
    };
  }

  const shortMatch = trimmed.match(GITHUB_SHORT_RE);
  if (shortMatch) {
    const [owner, name] = shortMatch[1]!.split('/');
    if (owner && name) {
      return {
        owner,
        name,
        cloneUrl: `https://github.com/${owner}/${name}.git`,
        normalizedInput: `https://github.com/${owner}/${name}`,
      };
    }
  }

  throw new InvalidGitHubUrlError(
    `Invalid GitHub URL or owner/repo: "${input}". Expected https://github.com/owner/repo or owner/repo.`,
  );
}

/** Stable repo id from normalized source string. */
export function computeRepoId(normalizedSource: string): string {
  return crypto.createHash('sha256').update(normalizedSource).digest('hex').slice(0, 16);
}

export interface ImportGitHubOptions {
  cacheRoot?: string;
  /** When true, skip clone if directory already exists. */
  reuseExisting?: boolean;
}

/** Clone a public GitHub repository into the CodeDelta cache. */
export function importGitHubRepo(
  url: string,
  options: ImportGitHubOptions = {},
): RepoRef {
  const parsed = parseGitHubInput(url);
  const cacheRoot = options.cacheRoot ?? getCacheRoot();
  const repoId = computeRepoId(parsed.normalizedInput);
  const clonePath = getRepoClonePath(cacheRoot, repoId);

  fs.mkdirSync(getReposDir(cacheRoot), { recursive: true });

  if (options.reuseExisting !== false && fs.existsSync(clonePath)) {
    if (isValidGitDir(clonePath)) {
      return buildRepoRef({
        id: repoId,
        source: 'github',
        input: url.trim(),
        clonePath,
        remoteUrl: parsed.cloneUrl,
      });
    }
    fs.rmSync(clonePath, { recursive: true, force: true });
  }

  git(['clone', '--bare', parsed.cloneUrl, clonePath], { cwd: cacheRoot, captureStderr: true });

  return buildRepoRef({
    id: repoId,
    source: 'github',
    input: url.trim(),
    clonePath,
    remoteUrl: parsed.cloneUrl,
  });
}

function isValidGitDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'HEAD'));
}

function buildRepoRef(params: {
  id: string;
  source: 'github' | 'local';
  input: string;
  clonePath: string;
  remoteUrl?: string;
}): RepoRef {
  const defaultBranch = getDefaultBranch(params.clonePath);
  return {
    id: params.id,
    source: params.source,
    input: params.input,
    clonePath: params.clonePath,
    defaultBranch,
    remoteUrl: params.remoteUrl,
    importedAt: new Date().toISOString(),
  };
}
