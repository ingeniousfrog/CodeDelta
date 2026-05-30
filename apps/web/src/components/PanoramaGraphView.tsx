import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { downloadPanoramaPng, downloadPanoramaSvg } from '../lib/panorama-export';
import type { PanoramaFocusCrumb } from '../lib/panorama-focus';
import type { PanoramaGraph, PanoramaNode } from '../types';
import { Button } from './ui';

export interface PanoramaGraphViewProps {
  graph: PanoramaGraph | null;
  loading?: boolean;
  error?: string | null;
  onContinueTrace?: (qualifiedName: string) => void;
  onNodeClick?: (node: PanoramaNode) => void;
  onEnrich?: (nodeIds: string[]) => void;
  enriching?: boolean;
  impactedEntryPoints?: string[];
  onFocusEntry?: (qualifiedName: string) => void;
  /** When true, show delta change legend (Delta View graph tab). */
  showDeltaLegend?: boolean;
  /** Clickable focus trail (overview → … → current symbol). */
  focusTrail?: PanoramaFocusCrumb[];
  onFocusTrailSelect?: (index: number) => void;
  canGoBack?: boolean;
  canGoToOverview?: boolean;
  onGoBack?: () => void;
  onGoToOverview?: () => void;
  /** Optional link to open the same commit in full Panorama page (Delta graph tab). */
  fullPanoramaHref?: string;
}

type PanoramaFlowData = {
  panorama: PanoramaNode;
  onContinue?: () => void;
};

function fileBaseName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] ?? filePath;
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'route':
      return 'Route / entry';
    case 'component':
      return 'Component';
    case 'function':
      return 'Function';
    case 'method':
      return 'Method';
    case 'class':
      return 'Class';
    default:
      return kind.replace(/_/g, ' ');
  }
}

function roleLabel(role?: PanoramaNode['role']): string | null {
  switch (role) {
    case 'entry':
      return 'Entry point';
    case 'bridge':
      return 'In call chain';
    case 'leaf':
      return 'Leaf callee';
    default:
      return null;
  }
}

function kindAccentClass(kind: string): string {
  if (kind === 'route') return 'panorama-node--kind-route';
  if (kind === 'component') return 'panorama-node--kind-component';
  if (kind === 'function' || kind === 'method') return 'panorama-node--kind-callable';
  if (kind === 'class') return 'panorama-node--kind-class';
  return 'panorama-node--kind-default';
}

function deltaClass(status?: PanoramaNode['deltaStatus']): string {
  if (!status || status === 'unchanged') return '';
  return `panorama-node--delta-${status}`;
}

const BREADCRUMB_MAX = 48;

function truncateCrumbLabel(label: string): string {
  if (label.length <= BREADCRUMB_MAX) return label;
  return `${label.slice(0, BREADCRUMB_MAX - 1)}…`;
}

function PanoramaFocusBreadcrumb({
  trail,
  onSelect,
}: {
  trail: PanoramaFocusCrumb[];
  onSelect?: (index: number) => void;
}) {
  if (trail.length <= 1) return null;

  return (
    <nav className="panorama-breadcrumb" aria-label="Focus path">
      <ol className="panorama-breadcrumb-list">
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;
          return (
            <li key={`${crumb.root}-${index}`} className="panorama-breadcrumb-item">
              {index > 0 && <span className="panorama-breadcrumb-sep" aria-hidden="true">›</span>}
              {isLast || !onSelect ? (
                <span className="panorama-breadcrumb-current" title={crumb.label}>
                  {truncateCrumbLabel(crumb.label)}
                </span>
              ) : (
                <button
                  type="button"
                  className="panorama-breadcrumb-link"
                  title={crumb.label}
                  onClick={() => onSelect(index)}
                >
                  {truncateCrumbLabel(crumb.label)}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function PanoramaFlowNode({ data }: NodeProps<Node<PanoramaFlowData>>) {
  const n = data.panorama;
  const fileName = fileBaseName(n.filePath);
  const lineRange =
    n.startLine === n.endLine ? `L${n.startLine}` : `L${n.startLine}–L${n.endLine}`;
  const role = roleLabel(n.role);
  const commitLabel = n.commitShortHash ?? '—';
  const signaturePreview = n.signature?.split('\n')[0]?.trim();

  return (
    <div
      className={[
        'panorama-node',
        kindAccentClass(n.kind),
        n.role ? `panorama-node--role-${n.role}` : '',
        deltaClass(n.deltaStatus),
        n.pathHighlight ? 'panorama-node--path' : '',
        n.traceHighlight ? 'panorama-node--trace' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Top} className="panorama-handle" />
      <div className="panorama-node-accent" aria-hidden />
      <div className="panorama-node-top">
        <span className="panorama-node-kind">{kindLabel(n.kind)}</span>
        {role && <span className="panorama-node-role">{role}</span>}
        {n.deltaStatus && n.deltaStatus !== 'unchanged' && (
          <span className={`panorama-delta-badge panorama-delta-badge--${n.deltaStatus}`}>
            {n.deltaStatus}
          </span>
        )}
      </div>
      <div className="panorama-node-title">{n.name}</div>
      <div className="panorama-node-meta">
        <span className="panorama-node-meta-item" title={n.filePath}>
          <span className="panorama-meta-label">File</span>
          <span className="panorama-meta-value">{fileName}</span>
        </span>
        <span className="panorama-node-meta-item">
          <span className="panorama-meta-label">Lines</span>
          <span className="panorama-meta-value">{lineRange}</span>
        </span>
        <span className="panorama-node-meta-item">
          <span className="panorama-meta-label">Commit</span>
          <span className="panorama-meta-value panorama-meta-mono">{commitLabel}</span>
        </span>
      </div>
      <div className="panorama-node-path" title={n.filePath}>
        {n.filePath}
      </div>
      {signaturePreview && (
        <pre className="panorama-node-signature">{signaturePreview}</pre>
      )}
      {n.llmLabel && <p className="panorama-node-label">{n.llmLabel}</p>}
      {data.onContinue && (
        <button type="button" className="panorama-continue-btn" onClick={data.onContinue}>
          Expand from here
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="panorama-handle" />
    </div>
  );
}

const nodeTypes = { panorama: PanoramaFlowNode };

function edgeLabel(kind: string, synthesizedBy?: string): string {
  if (synthesizedBy) return `${kind} · ${synthesizedBy}`;
  return kind;
}

function toFlowGraph(
  graph: PanoramaGraph,
  onContinue?: (qualifiedName: string) => void,
): { nodes: Node<PanoramaFlowData>[]; edges: Edge[] } {
  const nodes: Node<PanoramaFlowData>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: 'panorama',
    position: n.position ?? { x: 0, y: 0 },
    data: {
      panorama: n,
      onContinue: onContinue ? () => onContinue(n.qualifiedName) : undefined,
    },
  }));

  const edges: Edge[] = graph.edges.map((e) => {
    const isHeuristic = e.provenance === 'heuristic' || Boolean(e.synthesizedBy);
    const stroke = e.pathHighlight ? '#0969da' : isHeuristic ? '#bf8700' : '#656d76';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: edgeLabel(e.kind, e.synthesizedBy),
      labelStyle: { fill: '#656d76', fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.95 },
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 4,
      animated: Boolean(e.pathHighlight),
      className: [
        isHeuristic ? 'panorama-edge--heuristic' : '',
        e.deltaStatus && e.deltaStatus !== 'unchanged' ? `panorama-edge--delta-${e.deltaStatus}` : '',
        e.pathHighlight ? 'panorama-edge--path' : '',
      ]
        .filter(Boolean)
        .join(' '),
      style: {
        stroke,
        strokeWidth: e.pathHighlight ? 2.5 : 1.5,
      },
    };
  });

  return { nodes, edges };
}

function PanoramaFlowInner({
  graph,
  onContinueTrace,
  onNodeClick,
}: {
  graph: PanoramaGraph;
  onContinueTrace?: (qualifiedName: string) => void;
  onNodeClick?: (node: PanoramaNode) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flow = useMemo(
    () => toFlowGraph(graph, onContinueTrace),
    [graph, onContinueTrace],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<PanoramaFlowData>) => {
      onNodeClick?.(node.data.panorama);
    },
    [onNodeClick],
  );

  return (
    <div className="panorama-flow" ref={wrapperRef}>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.15}
        maxZoom={1.8}
        onNodeClick={handleNodeClick}
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap
          pannable
          zoomable
          className="panorama-minimap"
          nodeColor={() => '#d0d7de'}
          maskColor="rgba(240, 243, 246, 0.75)"
        />
        <Controls className="panorama-controls-widget" showInteractive={false} />
        <Background gap={20} size={1.2} color="#d0d7de" />
      </ReactFlow>
    </div>
  );
}

export default function PanoramaGraphView({
  graph,
  loading,
  error,
  onContinueTrace,
  onNodeClick,
  onEnrich,
  enriching,
  impactedEntryPoints,
  onFocusEntry,
  showDeltaLegend = false,
  focusTrail,
  onFocusTrailSelect,
  canGoBack,
  canGoToOverview,
  onGoBack,
  onGoToOverview,
  fullPanoramaHref,
}: PanoramaGraphViewProps) {
  const [exporting, setExporting] = useState<'svg' | 'png' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportSvg = useCallback(() => {
    if (!graph) return;
    setExportError(null);
    setExporting('svg');
    try {
      downloadPanoramaSvg(graph);
    } catch {
      setExportError('SVG export failed.');
    } finally {
      setExporting(null);
    }
  }, [graph]);

  const exportPng = useCallback(async () => {
    if (!graph) return;
    setExportError(null);
    setExporting('png');
    try {
      await downloadPanoramaPng(graph);
    } catch {
      setExportError('PNG export failed — try Export SVG instead.');
    } finally {
      setExporting(null);
    }
  }, [graph]);

  const hasDelta = graph?.nodes.some((n) => n.deltaStatus && n.deltaStatus !== 'unchanged');

  const sparseOverview =
    graph &&
    !canGoToOverview &&
    (graph.stats.snapshotNodeCount ?? 0) >= 300 &&
    graph.stats.nodeCount <= Math.max((graph.stats.entrySurfaceCount ?? 6) * 3, 24);

  const showEntryCatalog =
    graph?.entryCatalog &&
    graph.entryCatalog.length > 0 &&
    !canGoToOverview &&
    onFocusEntry &&
    (sparseOverview || graph.entryCatalog.length > 6);

  if (loading) {
    return <p className="hint panorama-status">Loading panorama…</p>;
  }
  if (error) {
    return <p className="hint panorama-error">{error}</p>;
  }
  if (!graph) {
    return (
      <p className="hint panorama-status">
        Select a branch and commit to load the call-flow graph.
      </p>
    );
  }

  return (
    <div className="panorama-panel">
      <div className="panorama-toolbar">
        <div className="panorama-toolbar-info">
          <span className="panorama-toolbar-title">
            {graph.commitShortHash ? `Commit ${graph.commitShortHash}` : 'Call-flow graph'}
          </span>
          {focusTrail && focusTrail.length > 1 && (
            <PanoramaFocusBreadcrumb trail={focusTrail} onSelect={onFocusTrailSelect} />
          )}
          <span className="hint">
            {graph.stats.nodeCount} symbols · {graph.stats.edgeCount} edges · depth-limited tree
            {graph.stats.snapshotNodeCount
              ? ` · ${graph.stats.snapshotNodeCount.toLocaleString()} indexed`
              : ''}
            {graph.stats.truncated ? ' · truncated — expand a node to go deeper' : ''}
            {graph.stats.effectiveDepth && graph.stats.effectiveDepth > 3
              ? ` · depth ${graph.stats.effectiveDepth} (large repo boost)`
              : ''}
          </span>
          {sparseOverview && (
            <span className="hint panorama-overview-hint">
              Overview shows top entry routes and components — pick an entry below or click{' '}
              <em>Expand from here</em> on a route or mount point to open its call tree.
            </span>
          )}
        </div>
        {graph.extractionMethod === 'fallback' && (
          <span className="panorama-warn">Fallback extractor — call edges may be sparse</span>
        )}
        {graph.pathMessage && <span className="panorama-warn">{graph.pathMessage}</span>}
        <div className="panorama-toolbar-actions">
          {canGoBack && onGoBack && (
            <Button variant="secondary" size="sm" onClick={onGoBack}>
              ← Back
            </Button>
          )}
          {canGoToOverview && onGoToOverview && (
            <Button variant="secondary" size="sm" onClick={onGoToOverview}>
              All entry points
            </Button>
          )}
          {fullPanoramaHref && (
            <Link to={fullPanoramaHref} className="btn btn-secondary btn-sm">
              Open full Panorama
            </Link>
          )}
          {onEnrich && graph.nodes.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              disabled={enriching}
              onClick={() => onEnrich(graph.nodes.slice(0, 20).map((n) => n.id))}
            >
              {enriching ? 'Generating labels…' : 'Generate labels (LLM)'}
            </Button>
          )}
          {graph.nodes.length > 0 && (
            <>
              <Button variant="secondary" size="sm" onClick={exportSvg} disabled={exporting !== null}>
                {exporting === 'svg' ? 'Exporting…' : 'Export SVG'}
              </Button>
              <Button variant="secondary" size="sm" onClick={exportPng} disabled={exporting !== null}>
                {exporting === 'png' ? 'Exporting…' : 'Export PNG'}
              </Button>
            </>
          )}
        </div>
      </div>
      {exportError && <p className="hint panorama-export-error">{exportError}</p>}

      {showEntryCatalog && (
        <div className="panorama-entry-sidebar">
          <h4>Entry surfaces ({graph!.entryCatalog!.length})</h4>
          <p className="hint panorama-entry-sidebar-hint">
            Jump into a route, component, or exported handler.
          </p>
          <ul className="panorama-entry-list">
            {graph!.entryCatalog!.map((entry) => (
              <li key={entry.id} className={entry.inGraph ? 'panorama-entry-list-item--in-graph' : ''}>
                <Button variant="link" onClick={() => onFocusEntry!(entry.qualifiedName)}>
                  <span className="panorama-entry-kind">{entry.kind}</span>
                  {entry.qualifiedName}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {impactedEntryPoints && impactedEntryPoints.length > 0 && onFocusEntry && (
        <div className="panorama-entry-sidebar">
          <h4>Impacted entry points</h4>
          <ul className="file-list">
            {impactedEntryPoints.map((ep) => (
              <li key={ep}>
                <Button variant="link" onClick={() => onFocusEntry(ep)}>
                  {ep}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {graph.nodes.length === 0 ? (
        <p className="hint panorama-status">
          No symbols in this subgraph. Try another focus symbol or increase call depth.
        </p>
      ) : (
        <ReactFlowProvider>
          <PanoramaFlowInner
            graph={graph}
            onContinueTrace={onContinueTrace}
            onNodeClick={onNodeClick}
          />
        </ReactFlowProvider>
      )}

      {(showDeltaLegend || hasDelta) && (
        <div className="panorama-legend">
          <span className="panorama-legend-item panorama-legend-added">Added</span>
          <span className="panorama-legend-item panorama-legend-modified">Modified</span>
          <span className="panorama-legend-item panorama-legend-removed">Removed</span>
          <span className="panorama-legend-item panorama-legend-heuristic">Heuristic edge</span>
        </div>
      )}
    </div>
  );
}
