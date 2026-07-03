import type { ChangedFile, CommitInfo, TrainingFilterOptions, TrainingSkipReason } from '@codedelta/types';

export const DEFAULT_TRAINING_FILTER_OPTIONS: TrainingFilterOptions = {
  maxChangedFiles: 30,
  maxDiffBytes: 200_000,
  maxUnrelatedModules: 4,
  includeMergeCommits: false,
  includeDocsOnly: false,
};

export interface EvaluateTrainingIntervalInput {
  commit: CommitInfo;
  changedFiles: ChangedFile[];
  diffText: string;
  options?: Partial<TrainingFilterOptions>;
}

export interface TrainingIntervalEvaluation {
  trainable: boolean;
  skipReason?: TrainingSkipReason;
}

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
]);

function fileName(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function isDocPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const name = fileName(normalized);
  return (
    normalized.startsWith('docs/') ||
    normalized.startsWith('doc/') ||
    name === 'readme.md' ||
    name === 'readme' ||
    name.endsWith('.md') ||
    name.endsWith('.mdx') ||
    name.endsWith('.rst') ||
    name.endsWith('.txt')
  );
}

function isLockfilePath(filePath: string): boolean {
  return LOCKFILE_NAMES.has(fileName(filePath));
}

function isGeneratedOrVendorPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const name = fileName(normalized);
  return (
    normalized.includes('/vendor/') ||
    normalized.startsWith('vendor/') ||
    normalized.includes('/generated/') ||
    normalized.startsWith('generated/') ||
    normalized.includes('/dist/') ||
    normalized.startsWith('dist/') ||
    normalized.includes('/build/') ||
    normalized.startsWith('build/') ||
    normalized.includes('/node_modules/') ||
    normalized.startsWith('node_modules/') ||
    name.endsWith('.min.js') ||
    name.endsWith('.min.css') ||
    name.endsWith('.map')
  );
}

function changedModules(files: ChangedFile[]): Set<string> {
  return new Set(
    files.map((f) => {
      const parts = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts[0] === 'packages' || parts[0] === 'apps') {
        return parts.slice(0, 2).join('/');
      }
      return parts[0] ?? f.path;
    }),
  );
}

function changedPayloadLines(diffText: string): { added: string[]; removed: string[] } {
  const lines = diffText.split('\n');
  const added = lines
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
  const removed = lines
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1));
  return { added, removed };
}

function stripWhitespace(lines: string[]): string {
  return lines.join('\n').replace(/\s+/g, '');
}

function isFormatOnlyDiff(diffText: string): boolean {
  const { added, removed } = changedPayloadLines(diffText);
  if (added.length === 0 || removed.length === 0) return false;
  return stripWhitespace(added) === stripWhitespace(removed);
}

function mergeOptions(options?: Partial<TrainingFilterOptions>): TrainingFilterOptions {
  return { ...DEFAULT_TRAINING_FILTER_OPTIONS, ...options };
}

export function evaluateTrainingInterval(input: EvaluateTrainingIntervalInput): TrainingIntervalEvaluation {
  const options = mergeOptions(input.options);
  const changedFiles = input.changedFiles;

  if (input.commit.parents.length === 0) {
    return { trainable: false, skipReason: 'initial_commit' };
  }

  if (!options.includeMergeCommits && input.commit.parents.length > 1) {
    return { trainable: false, skipReason: 'merge_commit' };
  }

  if (changedFiles.length > options.maxChangedFiles) {
    return { trainable: false, skipReason: 'too_many_changed_files' };
  }

  if (Buffer.byteLength(input.diffText, 'utf8') > options.maxDiffBytes) {
    return { trainable: false, skipReason: 'huge_diff' };
  }

  if (changedFiles.length > 0 && changedFiles.every((f) => f.status === 'renamed')) {
    return { trainable: false, skipReason: 'rename_only' };
  }

  if (changedFiles.length > 0 && changedFiles.every((f) => isLockfilePath(f.path))) {
    return { trainable: false, skipReason: 'lockfile_only' };
  }

  if (
    !options.includeDocsOnly &&
    changedFiles.length > 0 &&
    changedFiles.every((f) => isDocPath(f.path))
  ) {
    return { trainable: false, skipReason: 'docs_only' };
  }

  if (changedFiles.length > 0 && changedFiles.every((f) => isGeneratedOrVendorPath(f.path))) {
    return { trainable: false, skipReason: 'generated_or_vendor_only' };
  }

  if (changedModules(changedFiles).size > options.maxUnrelatedModules) {
    return { trainable: false, skipReason: 'too_many_unrelated_modules' };
  }

  if (isFormatOnlyDiff(input.diffText)) {
    return { trainable: false, skipReason: 'format_only' };
  }

  return { trainable: true };
}
