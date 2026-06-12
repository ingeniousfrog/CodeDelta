import * as fs from 'fs';
import * as path from 'path';
import type { ModelProviderConfig, RepoRef } from '@codedelta/types';
import { getCacheRoot, getRegistryPath, getSettingsPath } from '@codedelta/repo-manager';

const DEFAULT_PROVIDER: ModelProviderConfig = { kind: 'none' };

/** Atomic JSON write: temp file + rename so a crash never leaves a half-written file. */
function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export class RepoRegistry {
  private repos = new Map<string, RepoRef>();
  private readonly cacheRoot: string;
  private readonly registryPath: string;

  constructor(cacheRoot?: string) {
    this.cacheRoot = cacheRoot ?? getCacheRoot();
    this.registryPath = getRegistryPath(this.cacheRoot);
    this.load();
  }

  getCacheRoot(): string {
    return this.cacheRoot;
  }

  list(): RepoRef[] {
    return Array.from(this.repos.values()).sort(
      (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime(),
    );
  }

  get(id: string): RepoRef | undefined {
    return this.repos.get(id);
  }

  add(ref: RepoRef): RepoRef {
    this.repos.set(ref.id, ref);
    this.save();
    return ref;
  }

  private load(): void {
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    if (!fs.existsSync(this.registryPath)) {
      fs.writeFileSync(this.registryPath, '[]\n', 'utf8');
      return;
    }
    try {
      const raw = fs.readFileSync(this.registryPath, 'utf8');
      const list = JSON.parse(raw) as RepoRef[];
      for (const ref of list) {
        this.repos.set(ref.id, ref);
      }
    } catch {
      this.repos.clear();
    }
  }

  private save(): void {
    writeJsonAtomic(this.registryPath, this.list());
  }
}

export class SettingsStore {
  private readonly settingsPath: string;
  private config: ModelProviderConfig;

  constructor(cacheRoot?: string) {
    const root = cacheRoot ?? getCacheRoot();
    this.settingsPath = getSettingsPath(root);
    this.config = this.load();
  }

  getProvider(): ModelProviderConfig {
    return { ...this.config };
  }

  setProvider(config: ModelProviderConfig): ModelProviderConfig {
    this.config = { ...config };
    writeJsonAtomic(this.settingsPath, this.config);
    return this.getProvider();
  }

  private load(): ModelProviderConfig {
    if (!fs.existsSync(this.settingsPath)) {
      return { ...DEFAULT_PROVIDER };
    }
    try {
      return JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as ModelProviderConfig;
    } catch {
      return { ...DEFAULT_PROVIDER };
    }
  }
}
