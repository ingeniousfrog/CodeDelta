export {
  getCacheRoot,
  getReposDir,
  getRepoClonePath,
  getSnapshotsDir,
  getRegistryPath,
  getSettingsPath,
  getWorktreesDir,
  expandHome,
} from './cache-layout';

export {
  git,
  isGitRepo,
  gitRoot,
  getDefaultBranch,
  GitCommandError,
  RepoNotFoundError,
  InvalidGitHubUrlError,
} from './git-runner';

export {
  parseGitHubInput,
  computeRepoId,
  importGitHubRepo,
  type ParsedGitHubRepo,
  type ImportGitHubOptions,
} from './github-clone';

export { importLocalRepo, type ImportLocalOptions } from './local-open';

export {
  listCommits,
  getCommit,
  getCommitDetail,
  getChangedFiles,
  getChangedFilesForRange,
  listBranches,
  resolveRef,
  countChangedFiles,
  type ListCommitsOptions,
} from './commits';

export {
  createWorktree,
  removeWorktree,
  worktreePath,
  type WorktreeOptions,
} from './worktree';
