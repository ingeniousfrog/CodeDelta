import type { CodeGraphSnapshot, CodeNode, WikiSection, WikiToc } from '@codedelta/types';
import { DEFAULT_WIKI_LOCALE, wikiCopy, type WikiLocale } from './locale';

/** Bump when generated wiki structure/content format changes (busts the cache). */
export const WIKI_VERSION = '1';

const GROUPING_ROOTS = new Set([
  'src',
  'lib',
  'app',
  'apps',
  'packages',
  'internal',
  'cmd',
  'pkg',
  'components',
  'modules',
  'services',
]);

/** Node kinds that count as documentable symbols (mirrors delta-summary intent). */
const SYMBOL_KINDS = new Set([
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',
  'function',
  'method',
  'component',
  'route',
  'enum',
  'type_alias',
  'module',
  'namespace',
  'constant',
  'variable',
  'property',
]);

export function isDocumentableSymbol(node: CodeNode): boolean {
  return SYMBOL_KINDS.has(node.kind);
}

/** Directory area a file belongs to: `src/db/x.ts` → `src/db`, `scripts/x.mjs` → `scripts`. */
export function areaForFile(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) return '(root)';
  if (GROUPING_ROOTS.has(parts[0]) && parts.length >= 3) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

export interface PlanWikiTocOptions {
  /** Cap on module sections; defaults scale with repo size. */
  maxModuleSections?: number;
  /** Per-section file list cap (TOC payload size guard). */
  maxFilesPerSection?: number;
  /** Locale for fixed section titles (Overview / Architecture / …). */
  locale?: WikiLocale;
}

function defaultMaxModuleSections(fileCount: number): number {
  if (fileCount < 200) return 12;
  if (fileCount < 1000) return 18;
  return 24;
}

/**
 * Deterministic wiki table of contents from a structural snapshot:
 * Overview + Architecture + one page per significant directory area.
 */
export function planWikiToc(
  snapshot: CodeGraphSnapshot,
  options: PlanWikiTocOptions = {},
): WikiToc {
  const maxModuleSections =
    options.maxModuleSections ?? defaultMaxModuleSections(snapshot.files.length);
  const maxFilesPerSection = options.maxFilesPerSection ?? 500;
  const copy = wikiCopy(options.locale ?? DEFAULT_WIKI_LOCALE);

  const symbolsPerFile = new Map<string, number>();
  for (const node of snapshot.nodes) {
    if (!isDocumentableSymbol(node)) continue;
    symbolsPerFile.set(node.filePath, (symbolsPerFile.get(node.filePath) ?? 0) + 1);
  }

  const areas = new Map<string, { files: string[]; symbolCount: number }>();
  for (const file of snapshot.files) {
    const area = areaForFile(file);
    const bucket = areas.get(area) ?? { files: [], symbolCount: 0 };
    bucket.files.push(file);
    bucket.symbolCount += symbolsPerFile.get(file) ?? 0;
    areas.set(area, bucket);
  }

  const ranked = [...areas.entries()]
    .filter(([, bucket]) => bucket.symbolCount > 0 || bucket.files.length >= 3)
    .sort((a, b) => b[1].symbolCount - a[1].symbolCount || b[1].files.length - a[1].files.length);

  const main = ranked.slice(0, maxModuleSections);
  const rest = ranked.slice(maxModuleSections);

  const totalSymbols = snapshot.nodes.filter(isDocumentableSymbol).length;

  const sections: WikiSection[] = [
    {
      id: 'overview',
      title: copy.overview,
      kind: 'overview',
      files: snapshot.files.slice(0, maxFilesPerSection),
      symbolCount: totalSymbols,
    },
    {
      id: 'architecture',
      title: copy.architecture,
      kind: 'architecture',
      files: [],
      symbolCount: totalSymbols,
    },
  ];

  const usedIds = new Set(sections.map((s) => s.id));
  for (const [area, bucket] of main) {
    let id = `module-${slugify(area)}`;
    while (usedIds.has(id)) id = `${id}-x`;
    usedIds.add(id);
    sections.push({
      id,
      title: area === '(root)' ? copy.rootArea : area,
      kind: 'module',
      area,
      files: bucket.files.slice(0, maxFilesPerSection),
      symbolCount: bucket.symbolCount,
    });
  }

  if (rest.length > 0) {
    const files = rest.flatMap(([, bucket]) => bucket.files).slice(0, maxFilesPerSection);
    sections.push({
      id: 'module-other',
      title: copy.otherAreas,
      kind: 'module',
      area: undefined,
      files,
      symbolCount: rest.reduce((acc, [, b]) => acc + b.symbolCount, 0),
    });
  }

  return {
    repoId: snapshot.repoId,
    commitHash: snapshot.commitHash,
    wikiVersion: WIKI_VERSION,
    generatedAt: new Date().toISOString(),
    sections,
  };
}
