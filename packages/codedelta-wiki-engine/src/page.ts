import { detectEntryPoints } from '@codedelta/graph-subgraph';
import type {
  CodeGraphSnapshot,
  CodeNode,
  WikiCitation,
  WikiEvidenceItem,
  WikiSection,
} from '@codedelta/types';
import { mermaidArchitecture, mermaidCallFlow, mermaidModuleGraph } from './mermaid';
import { isDocumentableSymbol } from './toc';
import { rewriteWikiAssetUrls } from './readme-assets';

/** Reads file contents at the wiki's commit (server backs this with `git show`). */
export type ReadSource = (filePath: string) => string | null;

export interface WikiSectionContext {
  section: WikiSection;
  /** Ranked documentable symbols covered by this section. */
  symbols: CodeNode[];
  /** Evidence items (whitelist for LLM citations), ids are `sym-<nodeId>`. */
  evidence: WikiEvidenceItem[];
  /** Deterministic mermaid diagram (module graph or call flow), if any. */
  mermaid: string;
  /** Source snippets for the top symbols. */
  sourceSnippets: Array<{ node: CodeNode; snippet: string }>;
  /** README excerpt (overview section only). */
  readmeExcerpt?: string;
}

export interface BuildSectionContextOptions {
  maxSymbols?: number;
  maxSnippets?: number;
  maxSnippetLines?: number;
  /** Rewrite relative README image paths (e.g. docs/hero.png). */
  resolveReadmeAssetUrl?: (relativePath: string) => string;
}

function kindWeight(node: CodeNode): number {
  switch (node.kind) {
    case 'route':
      return 0;
    case 'component':
      return 1;
    case 'class':
    case 'struct':
    case 'interface':
    case 'trait':
    case 'protocol':
      return 2;
    case 'function':
    case 'method':
      return 3;
    case 'enum':
    case 'type_alias':
      return 4;
    default:
      return 5;
  }
}

function rankSymbols(snapshot: CodeGraphSnapshot, files: Set<string>, max: number): CodeNode[] {
  const callerCount = new Map<string, number>();
  for (const edge of snapshot.edges) {
    if (edge.kind !== 'calls' && edge.kind !== 'references') continue;
    callerCount.set(edge.target, (callerCount.get(edge.target) ?? 0) + 1);
  }

  return snapshot.nodes
    .filter((n) => isDocumentableSymbol(n) && files.has(n.filePath))
    .sort((a, b) => {
      const exported = Number(b.isExported ?? false) - Number(a.isExported ?? false);
      if (exported !== 0) return exported;
      const kind = kindWeight(a) - kindWeight(b);
      if (kind !== 0) return kind;
      return (callerCount.get(b.id) ?? 0) - (callerCount.get(a.id) ?? 0);
    })
    .slice(0, max);
}

export function evidenceIdForSymbol(node: CodeNode): string {
  return `sym-${node.id}`;
}

function snippetFor(node: CodeNode, readSource: ReadSource, maxLines: number): string | null {
  const raw = readSource(node.filePath);
  if (raw === null) return null;
  const lines = raw.split('\n');
  const start = Math.max(0, node.startLine - 1);
  const end = Math.min(lines.length, Math.min(node.endLine, node.startLine - 1 + maxLines));
  const slice = lines.slice(start, end).join('\n');
  return slice.trim() ? slice : null;
}

function extractReadmeExcerpt(readSource: ReadSource, maxChars = 1500): string | undefined {
  for (const candidate of ['README.md', 'readme.md', 'Readme.md']) {
    const raw = readSource(candidate);
    if (raw) return raw.slice(0, maxChars);
  }
  return undefined;
}

/** Deterministic per-section context: symbols, evidence whitelist, diagram, snippets. */
export function buildSectionContext(
  snapshot: CodeGraphSnapshot,
  section: WikiSection,
  readSource: ReadSource,
  options: BuildSectionContextOptions = {},
): WikiSectionContext {
  const maxSymbols = options.maxSymbols ?? 20;
  const maxSnippets = options.maxSnippets ?? 8;
  const maxSnippetLines = options.maxSnippetLines ?? 40;

  let symbols: CodeNode[];
  let mermaid: string;
  let readmeExcerpt: string | undefined;

  if (section.kind === 'overview') {
    const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
    symbols = detectEntryPoints(snapshot, { limit: maxSymbols })
      .map((id) => nodeById.get(id))
      .filter((n): n is CodeNode => Boolean(n));
    mermaid = mermaidModuleGraph(snapshot);
    const excerpt = extractReadmeExcerpt(readSource);
    readmeExcerpt =
      excerpt && options.resolveReadmeAssetUrl
        ? rewriteWikiAssetUrls(excerpt, options.resolveReadmeAssetUrl)
        : excerpt;
  } else if (section.kind === 'architecture') {
    const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
    symbols = detectEntryPoints(snapshot, { limit: maxSymbols })
      .map((id) => nodeById.get(id))
      .filter((n): n is CodeNode => Boolean(n));
    mermaid = mermaidArchitecture(snapshot);
  } else {
    const files = new Set(section.files);
    symbols = rankSymbols(snapshot, files, maxSymbols);
    mermaid = mermaidCallFlow(
      snapshot,
      symbols.slice(0, 6).map((s) => s.id),
      { maxDepth: 2, maxNodes: 28 },
    );
  }

  const evidence: WikiEvidenceItem[] = symbols.map((node) => ({
    id: evidenceIdForSymbol(node),
    kind: 'symbol',
    title: node.qualifiedName,
    detail: node.signature ?? `${node.kind} ${node.name}`,
    file: node.filePath,
    symbol: node.qualifiedName,
    startLine: node.startLine,
    endLine: node.endLine,
  }));

  const sourceSnippets: Array<{ node: CodeNode; snippet: string }> = [];
  for (const node of symbols.slice(0, maxSnippets)) {
    const snippet = snippetFor(node, readSource, maxSnippetLines);
    if (snippet) sourceSnippets.push({ node, snippet });
  }

  return { section, symbols, evidence, mermaid, sourceSnippets, readmeExcerpt };
}

function symbolTable(symbols: CodeNode[]): string {
  if (symbols.length === 0) return '_No documentable symbols in this area._';
  const rows = symbols.map(
    (n) =>
      `| \`${n.qualifiedName}\` | ${n.kind} | \`${n.filePath}\` | L${n.startLine}–L${n.endLine} |`,
  );
  return ['| Symbol | Kind | File | Lines |', '|---|---|---|---|', ...rows].join('\n');
}

/**
 * Deterministic page body (works with the `none` provider): structure diagram,
 * key-symbol table, file listing. LLM narrative, when present, is prepended.
 */
export function renderDeterministicPage(
  snapshot: CodeGraphSnapshot,
  context: WikiSectionContext,
): string {
  const { section } = context;
  const parts: string[] = [];

  parts.push(`# ${section.title}`);
  parts.push(
    `> Generated from the structural graph at commit \`${snapshot.commitHash.slice(0, 7)}\`` +
      ` — ${snapshot.files.length} files, ${snapshot.nodeCount} symbols indexed.`,
  );

  if (context.readmeExcerpt) {
    parts.push('## From the README');
    parts.push(context.readmeExcerpt);
  }

  if (context.mermaid) {
    parts.push(section.kind === 'overview' ? '## Module dependencies' : '## Call flow');
    parts.push('```mermaid\n' + context.mermaid + '\n```');
  }

  parts.push('## Key symbols');
  parts.push(symbolTable(context.symbols));

  if (section.kind === 'module' && section.files.length > 0) {
    parts.push('## Files');
    const shown = section.files.slice(0, 50);
    parts.push(shown.map((f) => `- \`${f}\``).join('\n'));
    if (section.files.length > shown.length) {
      parts.push(`_…and ${section.files.length - shown.length} more files._`);
    }
  }

  return parts.join('\n\n');
}

/** Compose the final page: optional validated LLM narrative + deterministic appendix. */
export function composeWikiPage(
  snapshot: CodeGraphSnapshot,
  context: WikiSectionContext,
  narrative?: string,
): { markdown: string; citations: WikiCitation[] } {
  const deterministic = renderDeterministicPage(snapshot, context);
  const markdown = narrative
    ? `# ${context.section.title}\n\n${narrative}\n\n---\n\n${deterministic.replace(/^# .*\n+/, '')}`
    : deterministic;

  const citations: WikiCitation[] = context.evidence.map((e) => ({
    id: e.id,
    symbol: e.symbol,
    file: e.file ?? '',
    startLine: e.startLine,
    endLine: e.endLine,
  }));

  return { markdown, citations };
}
