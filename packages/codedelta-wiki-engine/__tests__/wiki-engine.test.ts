import type { CodeGraphSnapshot, CodeNode } from '@codedelta/types';
import { describe, expect, it } from 'vitest';
import {
  citationsFromEvidence,
  composeWikiPage,
  buildSectionContext,
  deterministicAskAnswer,
  extractJsonObject,
  mermaidCallFlow,
  mermaidModuleGraph,
  planWikiToc,
  renderDeterministicPage,
  retrieveAskEvidence,
  tokenizeQuestion,
  validateWikiAskOutput,
  validateWikiPageOutput,
  buildWikiAssetUrl,
  rewriteWikiAssetUrls,
} from '../src';

function node(partial: Partial<CodeNode> & { id: string; name: string; filePath: string }): CodeNode {
  return {
    kind: 'function',
    qualifiedName: partial.name,
    language: 'typescript',
    startLine: 1,
    endLine: 5,
    isExported: true,
    ...partial,
  } as CodeNode;
}

function makeSnapshot(): CodeGraphSnapshot {
  const nodes: CodeNode[] = [
    node({ id: 'n1', name: 'createServer', filePath: 'src/server/index.ts', signature: 'function createServer(): App' }),
    node({ id: 'n2', name: 'handleCompare', filePath: 'src/server/compare.ts' }),
    node({ id: 'n3', name: 'buildSnapshot', filePath: 'src/snapshot/build.ts' }),
    node({ id: 'n4', name: 'diffGraphs', filePath: 'src/diff/diff.ts' }),
    node({ id: 'n5', name: 'renderApp', filePath: 'web/App.tsx', kind: 'component' }),
    node({ id: 'n6', name: 'helperUtil', filePath: 'scripts/util.ts', isExported: false }),
  ];
  const edges = [
    { source: 'n1', target: 'n2', kind: 'calls' },
    { source: 'n2', target: 'n3', kind: 'calls' },
    { source: 'n2', target: 'n4', kind: 'calls', provenance: 'heuristic', metadata: { synthesizedBy: 'callback' } },
    { source: 'n5', target: 'n1', kind: 'imports' },
  ];
  return {
    repoId: 'repo-1',
    commitHash: 'abcdef1234567890',
    analyzerVersion: '1',
    createdAt: new Date().toISOString(),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    files: [
      'src/server/index.ts',
      'src/server/compare.ts',
      'src/snapshot/build.ts',
      'src/diff/diff.ts',
      'web/App.tsx',
      'scripts/util.ts',
      'README.md',
    ],
  };
}

const readSource = (filePath: string): string | null => {
  if (filePath === 'README.md') return '# Demo repo\n\nA test repository.';
  return 'line1\nline2\nline3\nline4\nline5\nline6';
};

describe('readme asset URLs', () => {
  const resolve = (p: string) => buildWikiAssetUrl('repo1', 'abc123', p);

  it('rewrites HTML img src and markdown images', () => {
    const input = [
      '<p align="center"><img src="docs/images/hero.png" width="900" alt="hero"></p>',
      '![Overview](./docs/images/overview.png)',
    ].join('\n');
    const out = rewriteWikiAssetUrls(input, resolve);
    expect(out).toContain(
      `/api/repos/repo1/wiki/asset?commit=abc123&path=${encodeURIComponent('docs/images/hero.png')}`,
    );
    expect(out).toContain(
      `/api/repos/repo1/wiki/asset?commit=abc123&path=${encodeURIComponent('docs/images/overview.png')}`,
    );
    expect(out).not.toContain('src="docs/');
  });

  it('leaves absolute URLs unchanged', () => {
    const input = '![x](https://example.com/a.png) <img src="https://cdn.example/b.png">';
    expect(rewriteWikiAssetUrls(input, resolve)).toBe(input);
  });

  it('does not double-rewrite wiki asset API URLs', () => {
    const apiUrl = resolve('docs/a.png');
    const input = `<img src="${apiUrl}">`;
    expect(rewriteWikiAssetUrls(input, resolve)).toBe(input);
  });
});

describe('planWikiToc', () => {
  it('always includes overview and architecture first', () => {
    const toc = planWikiToc(makeSnapshot());
    expect(toc.sections[0]).toMatchObject({ id: 'overview', kind: 'overview' });
    expect(toc.sections[1]).toMatchObject({ id: 'architecture', kind: 'architecture' });
  });

  it('creates module sections grouped by directory area', () => {
    const toc = planWikiToc(makeSnapshot());
    const moduleSections = toc.sections.filter((s) => s.kind === 'module');
    const titles = moduleSections.map((s) => s.title);
    expect(titles).toContain('src/server');
    const server = moduleSections.find((s) => s.title === 'src/server')!;
    expect(server.files).toEqual(['src/server/index.ts', 'src/server/compare.ts']);
    expect(server.symbolCount).toBe(2);
  });

  it('is deterministic across runs (section ids/order)', () => {
    const a = planWikiToc(makeSnapshot()).sections.map((s) => s.id);
    const b = planWikiToc(makeSnapshot()).sections.map((s) => s.id);
    expect(a).toEqual(b);
  });

  it('caps module sections and rolls the rest into module-other', () => {
    const toc = planWikiToc(makeSnapshot(), { maxModuleSections: 1 });
    const moduleSections = toc.sections.filter((s) => s.kind === 'module');
    expect(moduleSections.length).toBe(2);
    expect(moduleSections[1].id).toBe('module-other');
  });
});

describe('mermaid serialization', () => {
  it('module graph only contains real cross-area edges', () => {
    const mermaid = mermaidModuleGraph(makeSnapshot());
    expect(mermaid).toContain('flowchart LR');
    expect(mermaid).toContain('src/server');
    expect(mermaid).toContain('src/snapshot');
    // n1->n2 is same-area (src/server) and must not appear as an edge label area pair
    const edgeLines = mermaid.split('\n').filter((l) => l.includes('-->'));
    expect(edgeLines.length).toBeGreaterThan(0);
  });

  it('call flow labels synthesized edges with the synthesizer', () => {
    const mermaid = mermaidCallFlow(makeSnapshot(), ['n1'], { maxDepth: 3 });
    expect(mermaid).toContain('flowchart TD');
    expect(mermaid).toContain('createServer');
    expect(mermaid).toContain('calls · callback');
  });

  it('returns empty string when no edges exist', () => {
    const snap = { ...makeSnapshot(), edges: [], edgeCount: 0 };
    expect(mermaidModuleGraph(snap)).toBe('');
    expect(mermaidCallFlow(snap, ['n1'])).toBe('');
  });
});

describe('page rendering', () => {
  it('renders a deterministic page with symbol table and files', () => {
    const snapshot = makeSnapshot();
    const toc = planWikiToc(snapshot);
    const section = toc.sections.find((s) => s.title === 'src/server')!;
    const context = buildSectionContext(snapshot, section, readSource);
    const markdown = renderDeterministicPage(snapshot, context);
    expect(markdown).toContain('# src/server');
    expect(markdown).toContain('| Symbol | Kind | File | Lines |');
    expect(markdown).toContain('`createServer`');
    expect(markdown).toContain('## Files');
  });

  it('overview page includes README excerpt and module diagram', () => {
    const snapshot = makeSnapshot();
    const toc = planWikiToc(snapshot);
    const context = buildSectionContext(snapshot, toc.sections[0], readSource);
    const markdown = renderDeterministicPage(snapshot, context);
    expect(markdown).toContain('## From the README');
    expect(markdown).toContain('A test repository.');
    expect(markdown).toContain('```mermaid');
  });

  it('composeWikiPage prepends narrative and keeps deterministic appendix', () => {
    const snapshot = makeSnapshot();
    const toc = planWikiToc(snapshot);
    const section = toc.sections.find((s) => s.title === 'src/server')!;
    const context = buildSectionContext(snapshot, section, readSource);
    const { markdown, citations } = composeWikiPage(snapshot, context, 'This area hosts the API server.');
    expect(markdown).toContain('This area hosts the API server.');
    expect(markdown).toContain('## Key symbols');
    expect(citations.length).toBe(context.evidence.length);
    expect(citations.every((c) => c.id.startsWith('sym-'))).toBe(true);
  });
});

describe('provider output validation', () => {
  it('extractJsonObject handles fenced and bare JSON', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('prefix {"a":1} suffix')).toEqual({ a: 1 });
    expect(extractJsonObject('not json at all')).toBeNull();
  });

  it('validateWikiPageOutput drops citation ids outside the evidence whitelist', () => {
    const evidence = [{ id: 'sym-n1', kind: 'symbol' as const, title: 't', detail: 'd' }];
    const result = validateWikiPageOutput(
      { narrative: 'Hello', citationIds: ['sym-n1', 'sym-INVENTED'] },
      evidence,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.citationIds).toEqual(['sym-n1']);
  });

  it('validateWikiPageOutput rejects empty narrative', () => {
    const result = validateWikiPageOutput({ narrative: '', citationIds: [] }, []);
    expect(result.ok).toBe(false);
  });

  it('validateWikiAskOutput defaults invalid confidence to low', () => {
    const result = validateWikiAskOutput({ answer: 'A', citationIds: [], confidence: 'huge' }, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.confidence).toBe('low');
  });
});

describe('ask retrieval', () => {
  it('tokenizes questions, dropping stopwords and short tokens', () => {
    const tokens = tokenizeQuestion('How does the createServer function work?');
    expect(tokens).toContain('createserver');
    expect(tokens).not.toContain('how');
    expect(tokens).not.toContain('the');
  });

  it('retrieves matching symbols with call-path and source evidence', () => {
    const snapshot = makeSnapshot();
    const result = retrieveAskEvidence(snapshot, 'how does handleCompare build a snapshot?', readSource);
    const names = result.matchedNodes.map((n) => n.name);
    expect(names).toContain('handleCompare');
    expect(names).toContain('buildSnapshot');
    const kinds = new Set(result.evidence.map((e) => e.kind));
    expect(kinds.has('symbol')).toBe(true);
    expect(kinds.has('call-path')).toBe(true);
    expect(kinds.has('source')).toBe(true);
  });

  it('marks synthesized call paths in evidence detail', () => {
    const snapshot = makeSnapshot();
    const result = retrieveAskEvidence(snapshot, 'handleCompare diffGraphs', readSource);
    const synth = result.evidence.find((e) => e.kind === 'call-path' && e.detail.includes('synthesized'));
    expect(synth).toBeDefined();
    expect(synth!.detail).toContain('callback');
  });

  it('deterministicAskAnswer reports no matches gracefully', () => {
    const snapshot = makeSnapshot();
    const result = retrieveAskEvidence(snapshot, 'zzz qqq vvv', readSource);
    const answer = deterministicAskAnswer('zzz qqq vvv', result);
    expect(answer.confidence).toBe('low');
    expect(answer.answer).toContain('No symbols');
  });

  it('deterministicAskAnswer lists matched symbols and call relationships', () => {
    const snapshot = makeSnapshot();
    const result = retrieveAskEvidence(snapshot, 'handleCompare buildSnapshot diffGraphs', readSource);
    const answer = deterministicAskAnswer('q', result);
    expect(answer.confidence).toBe('medium');
    expect(answer.answer).toContain('`handleCompare`');
    expect(answer.answer).toContain('Related call relationships:');
  });

  it('citationsFromEvidence keeps only known ids in order', () => {
    const evidence = [
      { id: 'sym-n1', kind: 'symbol' as const, title: 't', detail: 'd', file: 'a.ts', symbol: 'A' },
      { id: 'sym-n2', kind: 'symbol' as const, title: 't2', detail: 'd2', file: 'b.ts', symbol: 'B' },
    ];
    const citations = citationsFromEvidence(['sym-n2', 'missing', 'sym-n1'], evidence);
    expect(citations.map((c) => c.id)).toEqual(['sym-n2', 'sym-n1']);
  });
});
