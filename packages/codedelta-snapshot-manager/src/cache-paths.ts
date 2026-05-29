import * as fs from 'fs';
import * as path from 'path';

export function snapshotDir(
  cacheRoot: string,
  repoId: string,
  commitHash: string,
  analyzerVersion: string,
): string {
  return path.join(cacheRoot, 'snapshots', repoId, commitHash, analyzerVersion);
}

export function snapshotFilePath(
  cacheRoot: string,
  repoId: string,
  commitHash: string,
  analyzerVersion: string,
): string {
  return path.join(snapshotDir(cacheRoot, repoId, commitHash, analyzerVersion), 'snapshot.json');
}

export function readAnalyzerVersion(monorepoRoot: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(monorepoRoot, 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function resolveMonorepoRoot(): string {
  const env = process.env.CODEDELTA_MONOREPO_ROOT;
  if (env) {
    return path.resolve(env);
  }
  return path.resolve(__dirname, '../../..');
}
