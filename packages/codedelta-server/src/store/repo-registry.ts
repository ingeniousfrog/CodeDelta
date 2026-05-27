import * as fs from 'fs';
import * as path from 'path';
import type { ModelProviderConfig, RepoRef } from '@codedelta/types';
import { getCacheRoot, getRegistryPath, getSettingsPath } from '@codedelta/repo-manager';

const DEFAULT_PROVIDER: ModelProviderConfig = { kind: 'none' };

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
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    fs.writeFileSync(this.registryPath, JSON.stringify(this.list(), null, 2) + '\n', 'utf8');
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
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.config, null, 2) + '\n', 'utf8');
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
