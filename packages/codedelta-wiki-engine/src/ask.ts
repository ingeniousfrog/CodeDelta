import type { CodeGraphSnapshot, CodeNode, WikiCitation, WikiEvidenceItem } from '@codedelta/types';
import { detectEntryPoints } from '@codedelta/graph-subgraph';
import { evidenceIdForSymbol, type ReadSource } from './page';
import { isDocumentableSymbol } from './toc';

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'this',
  'that',
  'with',
  'how',
  'what',
  'where',
  'when',
  'does',
  'why',
  'who',
  'which',
  'into',
  'from',
  'work',
  'works',
  'code',
  'file',
  'files',
  'function',
  'used',
  'use',
]);

export function tokenizeQuestion(question: string): string[] {
  return [
    ...new Set(
      question
        .split(/[^a-zA-Z0-9_$]+/)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ];
}

function scoreNode(node: CodeNode, tokens: string[]): number {
  const name = node.name.toLowerCase();
  const qualified = node.qualifiedName.toLowerCase();
  const file = node.filePath.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (name === token) score += 10;
    else if (name.includes(token)) score += 6;
    else if (qualified.includes(token)) score += 4;
    else if (file.includes(token)) score += 2;
  }
  if (score > 0 && node.isExported) score += 1;
  return score;
}

export interface AskRetrievalOptions {
  maxSymbols?: number;
  maxCallPaths?: number;
  maxSnippets?: number;
  maxSnippetLines?: number;
}

export interface AskRetrievalResult {
  evidence: WikiEvidenceItem[];
  matchedNodes: CodeNode[];
}

/**
 * Lexical + graph retrieval over the snapshot: score symbols against the
 * question, then expand one hop along calls/references edges so the evidence
 * carries real call relationships (the part embeddings cannot provide).
 */
export function retrieveAskEvidence(
  snapshot: CodeGraphSnapshot,
  question: string,
  readSource: ReadSource,
  options: AskRetrievalOptions = {},
): AskRetrievalResult {
  const maxSymbols = options.maxSymbols ?? 8;
  const maxCallPaths = options.maxCallPaths ?? 12;
  const maxSnippets = options.maxSnippets ?? 4;
  const maxSnippetLines = options.maxSnippetLines ?? 30;

  const tokens = tokenizeQuestion(question);
  const scored = snapshot.nodes
    .filter(isDocumentableSymbol)
    .map((node) => ({ node, score: scoreNode(node, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSymbols);

  const matchedNodes = scored.map((s) => s.node);
  const matchedIds = new Set(matchedNodes.map((n) => n.id));
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));

  const evidence: WikiEvidenceItem[] = matchedNodes.map((node) => ({
    id: evidenceIdForSymbol(node),
    kind: 'symbol',
    title: node.qualifiedName,
    detail: node.signature ?? `${node.kind} ${node.name}`,
    file: node.filePath,
    symbol: node.qualifiedName,
    startLine: node.startLine,
    endLine: node.endLine,
  }));

  // One-hop call-path expansion around matched symbols.
  let pathCount = 0;
  const seenPaths = new Set<string>();
  for (const edge of snapshot.edges) {
    if (pathCount >= maxCallPaths) break;
    if (edge.kind !== 'calls' && edge.kind !== 'references') continue;
    const touchesMatch = matchedIds.has(edge.source) || matchedIds.has(edge.target);
    if (!touchesMatch) continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    const synth =
      edge.provenance === 'heuristic'
        ? ` (synthesized: ${typeof edge.metadata?.synthesizedBy === 'string' ? edge.metadata.synthesizedBy : 'heuristic'})`
        : '';
    evidence.push({
      id: `path-${pathCount}`,
      kind: 'call-path',
      title: `${source.name} → ${target.name}`,
      detail: `${source.qualifiedName} ${edge.kind} ${target.qualifiedName}${synth}`,
      file: source.filePath,
      symbol: source.qualifiedName,
    });
    pathCount += 1;
  }

  // Source snippets for the top matches.
  for (const node of matchedNodes.slice(0, maxSnippets)) {
    const raw = readSource(node.filePath);
    if (raw === null) continue;
    const lines = raw.split('\n');
    const start = Math.max(0, node.startLine - 1);
    const end = Math.min(lines.length, Math.min(node.endLine, node.startLine - 1 + maxSnippetLines));
    const snippet = lines.slice(start, end).join('\n');
    if (!snippet.trim()) continue;
    evidence.push({
      id: `src-${node.id}`,
      kind: 'source',
      title: `Source: ${node.qualifiedName}`,
      detail: snippet,
      file: node.filePath,
      symbol: node.qualifiedName,
      startLine: node.startLine,
      endLine: Math.min(node.endLine, node.startLine - 1 + maxSnippetLines),
    });
  }

  return { evidence, matchedNodes };
}

/**
 * When lexical retrieval finds no symbol matches, seed the LLM with entry points
 * and a repo overview so conversational questions still get a useful answer.
 */
export function bootstrapAskEvidence(
  snapshot: CodeGraphSnapshot,
  readSource: ReadSource,
  options: AskRetrievalOptions = {},
): AskRetrievalResult {
  const maxSymbols = options.maxSymbols ?? 8;
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const entryIds = detectEntryPoints(snapshot, { limit: maxSymbols });
  const matchedNodes = entryIds
    .map((id) => nodeById.get(id))
    .filter((n): n is CodeNode => n !== undefined && isDocumentableSymbol(n));

  const areas = new Map<string, number>();
  for (const f of snapshot.files) {
    const top = f.split('/')[0] ?? f;
    areas.set(top, (areas.get(top) ?? 0) + 1);
  }
  const topAreas = [...areas.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([a, n]) => `${a} (${n} files)`)
    .join(', ');

  let readme = '';
  for (const candidate of ['README.md', 'readme.md']) {
    const raw = readSource(candidate);
    if (raw) {
      readme = raw.slice(0, 800);
      break;
    }
  }

  const evidence: WikiEvidenceItem[] = [
    {
      id: 'ctx-repo',
      kind: 'source',
      title: 'Repository overview (no direct symbol match for this question)',
      detail: [
        `Commit graph: ${snapshot.files.length} files, ${snapshot.nodeCount} indexed symbols.`,
        topAreas ? `Top-level areas: ${topAreas}.` : '',
        readme ? `README excerpt:\n${readme}` : '',
        'Use the entry-point symbols below as starting points for vague or high-level questions.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      file: 'README.md',
    },
    ...matchedNodes.map((node) => ({
      id: evidenceIdForSymbol(node),
      kind: 'symbol' as const,
      title: node.qualifiedName,
      detail: `(entry point) ${node.signature ?? `${node.kind} ${node.name}`}`,
      file: node.filePath,
      symbol: node.qualifiedName,
      startLine: node.startLine,
      endLine: node.endLine,
    })),
  ];

  return { evidence, matchedNodes };
}

/** Lexical retrieval, falling back to entry-point bootstrap when nothing matches. */
export function prepareAskRetrieval(
  snapshot: CodeGraphSnapshot,
  question: string,
  readSource: ReadSource,
  options: AskRetrievalOptions = {},
): AskRetrievalResult {
  const result = retrieveAskEvidence(snapshot, question, readSource, options);
  if (result.matchedNodes.length > 0) return result;
  return bootstrapAskEvidence(snapshot, readSource, options);
}

/** Deterministic Ask answer (legacy; Wiki Ask now requires a configured provider). */
export function deterministicAskAnswer(
  question: string,
  result: AskRetrievalResult,
): { answer: string; confidence: 'low' | 'medium' | 'high' } {
  if (result.matchedNodes.length === 0) {
    return {
      answer:
        'No symbols in the structural graph matched this question. Try mentioning a concrete symbol, file, or directory name.',
      confidence: 'low',
    };
  }
  const lines = [
    'Top matching symbols from the structural graph:',
    ...result.matchedNodes.map(
      (n) => `- \`${n.qualifiedName}\` (${n.kind}) — \`${n.filePath}\` L${n.startLine}–L${n.endLine}`,
    ),
  ];
  const paths = result.evidence.filter((e) => e.kind === 'call-path').slice(0, 6);
  if (paths.length > 0) {
    lines.push('', 'Related call relationships:');
    lines.push(...paths.map((p) => `- ${p.detail}`));
  }
  lines.push('', 'Configure a Provider in Settings for a narrated answer grounded in this evidence.');
  return {
    answer: lines.join('\n'),
    confidence: result.matchedNodes.length >= 3 ? 'medium' : 'low',
  };
}

/** Map validated citation ids back to citation objects from the evidence list. */
export function citationsFromEvidence(
  citationIds: string[],
  evidence: WikiEvidenceItem[],
): WikiCitation[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const citations: WikiCitation[] = [];
  for (const id of citationIds) {
    const item = byId.get(id);
    if (!item) continue;
    citations.push({
      id,
      symbol: item.symbol,
      file: item.file ?? '',
      startLine: item.startLine,
      endLine: item.endLine,
    });
  }
  return citations;
}
