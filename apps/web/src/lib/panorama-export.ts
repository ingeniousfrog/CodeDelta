import type { PanoramaGraph, PanoramaNode } from '../types';

const EXPORT_BG = '#f6f8fa';
const BASE_NODE_W = 360;
const BASE_NODE_H = 188;
const BASE_PADDING = 48;
/** Target effective pixel density for PNG (SVG logical units × this ≈ output px). */
const PNG_TARGET_SCALE = 6;
const PNG_MAX_DIMENSION = 14_000;

const ACCENT: Record<string, string> = {
  route: '#fb8500',
  component: '#0969da',
  callable: '#1a7f37',
  class: '#8250df',
  default: '#8c959f',
};

const DELTA_STROKE: Record<string, string> = {
  added: '#1a7f37',
  modified: '#9a6700',
  removed: '#cf222e',
};

type ExportLayout = {
  scale: number;
  nodeW: number;
  nodeH: number;
  pad: number;
};

function layout(scale = 1): ExportLayout {
  return {
    scale,
    nodeW: BASE_NODE_W * scale,
    nodeH: BASE_NODE_H * scale,
    pad: BASE_PADDING * scale,
  };
}

function accentForKind(kind: string): string {
  if (kind === 'route') return ACCENT.route!;
  if (kind === 'component') return ACCENT.component!;
  if (kind === 'function' || kind === 'method') return ACCENT.callable!;
  if (kind === 'class') return ACCENT.class!;
  return ACCENT.default!;
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function fileBaseName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] ?? filePath;
}

function s(value: number, scale: number): number {
  return value * scale;
}

function computeBounds(nodes: PanoramaNode[], lay: ExportLayout): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const x = node.position?.x ?? 0;
    const y = node.position?.y ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + lay.nodeW / lay.scale);
    maxY = Math.max(maxY, y + lay.nodeH / lay.scale);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, width: 800 * lay.scale, height: 600 * lay.scale };
  }

  const contentW = maxX - minX;
  const contentH = maxY - minY;
  return {
    minX,
    minY,
    width: contentW * lay.scale + lay.pad * 2,
    height: contentH * lay.scale + lay.pad * 2,
  };
}

function resolvePngRasterScale(width: number, height: number): number {
  const maxSide = Math.max(width, height);
  let scale = PNG_TARGET_SCALE;
  if (maxSide * scale > PNG_MAX_DIMENSION) {
    scale = Math.max(2, Math.floor(PNG_MAX_DIMENSION / maxSide));
  }
  return scale;
}

function edgePath(
  source: PanoramaNode,
  target: PanoramaNode,
  offsetX: number,
  offsetY: number,
  lay: ExportLayout,
): string {
  const nodeW = lay.nodeW;
  const nodeH = lay.nodeH;
  const sx = (source.position?.x ?? 0) * lay.scale + nodeW / 2 + offsetX;
  const sy = (source.position?.y ?? 0) * lay.scale + nodeH + offsetY;
  const tx = (target.position?.x ?? 0) * lay.scale + nodeW / 2 + offsetX;
  const ty = (target.position?.y ?? 0) * lay.scale + offsetY;
  const midY = (sy + ty) / 2;
  return `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
}

function nodeStroke(node: PanoramaNode, lay: ExportLayout): { color: string; width: number } {
  if (node.traceHighlight) return { color: '#0969da', width: s(2, lay.scale) };
  if (node.deltaStatus && node.deltaStatus !== 'unchanged') {
    return { color: DELTA_STROKE[node.deltaStatus] ?? '#d0d7de', width: s(2, lay.scale) };
  }
  return { color: '#d0d7de', width: s(1, lay.scale) };
}

function renderNode(node: PanoramaNode, offsetX: number, offsetY: number, lay: ExportLayout): string {
  const x = (node.position?.x ?? 0) * lay.scale + offsetX;
  const y = (node.position?.y ?? 0) * lay.scale + offsetY;
  const accent = accentForKind(node.kind);
  const fileName = fileBaseName(node.filePath);
  const lineRange =
    node.startLine === node.endLine ? `L${node.startLine}` : `L${node.startLine}-${node.endLine}`;
  const commit = node.commitShortHash ?? '-';
  const title = escapeXml(truncate(node.name, 52));
  const kind = escapeXml(kindLabel(node.kind));
  const path = escapeXml(truncate(node.filePath, 58));
  const stroke = nodeStroke(node, lay);
  const rx = s(10, lay.scale);

  const roleBadge =
    node.role === 'entry'
      ? `<rect x="${x + s(118, lay.scale)}" y="${y + s(14, lay.scale)}" width="${s(72, lay.scale)}" height="${s(18, lay.scale)}" rx="${s(9, lay.scale)}" fill="#f6f8fa" stroke="#d0d7de"/><text x="${x + s(154, lay.scale)}" y="${y + s(27, lay.scale)}" text-anchor="middle" font-size="${s(10, lay.scale)}" fill="#24292f">Entry point</text>`
      : node.role === 'leaf'
        ? `<rect x="${x + s(118, lay.scale)}" y="${y + s(14, lay.scale)}" width="${s(68, lay.scale)}" height="${s(18, lay.scale)}" rx="${s(9, lay.scale)}" fill="#f6f8fa" stroke="#d0d7de"/><text x="${x + s(152, lay.scale)}" y="${y + s(27, lay.scale)}" text-anchor="middle" font-size="${s(10, lay.scale)}" fill="#24292f">Leaf callee</text>`
        : '';

  const llmLine = node.llmLabel
    ? `<text x="${x + s(14, lay.scale)}" y="${y + s(148, lay.scale)}" font-size="${s(10, lay.scale)}" fill="#656d76">${escapeXml(truncate(node.llmLabel, 64))}</text>`
    : '';

  return `
  <g class="panorama-export-node">
    <rect x="${x}" y="${y}" width="${lay.nodeW}" height="${lay.nodeH}" rx="${rx}" fill="#ffffff" stroke="${stroke.color}" stroke-width="${stroke.width}"/>
    <rect x="${x}" y="${y}" width="${lay.nodeW}" height="${s(4, lay.scale)}" rx="${rx}" fill="${accent}"/>
    <text x="${x + s(14, lay.scale)}" y="${y + s(28, lay.scale)}" font-size="${s(11, lay.scale)}" font-weight="600" fill="#656d76">${kind.toUpperCase()}</text>
    ${roleBadge}
    <text x="${x + s(14, lay.scale)}" y="${y + s(58, lay.scale)}" font-size="${s(17, lay.scale)}" font-weight="700" fill="#24292f">${title}</text>
    <text x="${x + s(14, lay.scale)}" y="${y + s(88, lay.scale)}" font-size="${s(10, lay.scale)}" fill="#656d76">File</text>
    <text x="${x + s(14, lay.scale)}" y="${y + s(102, lay.scale)}" font-size="${s(11, lay.scale)}" font-weight="600" fill="#24292f">${escapeXml(truncate(fileName, 24))}</text>
    <text x="${x + s(130, lay.scale)}" y="${y + s(88, lay.scale)}" font-size="${s(10, lay.scale)}" fill="#656d76">Lines</text>
    <text x="${x + s(130, lay.scale)}" y="${y + s(102, lay.scale)}" font-size="${s(11, lay.scale)}" font-weight="600" fill="#24292f">${escapeXml(lineRange)}</text>
    <text x="${x + s(246, lay.scale)}" y="${y + s(88, lay.scale)}" font-size="${s(10, lay.scale)}" fill="#656d76">Commit</text>
    <text x="${x + s(246, lay.scale)}" y="${y + s(102, lay.scale)}" font-size="${s(11, lay.scale)}" font-weight="600" fill="#24292f" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(commit)}</text>
    <rect x="${x + s(14, lay.scale)}" y="${y + s(112, lay.scale)}" width="${lay.nodeW - s(28, lay.scale)}" height="${s(22, lay.scale)}" rx="${s(4, lay.scale)}" fill="#f6f8fa"/>
    <text x="${x + s(20, lay.scale)}" y="${y + s(127, lay.scale)}" font-size="${s(10, lay.scale)}" fill="#656d76">${path}</text>
    ${llmLine}
  </g>`;
}

function renderFooter(graph: PanoramaGraph, height: number, lay: ExportLayout): string {
  const commit = graph.commitShortHash ? `commit ${graph.commitShortHash}` : '';
  const stats = `${graph.stats.nodeCount} symbols · ${graph.stats.edgeCount} edges`;
  const label = escapeXml(['CodeDelta Panorama', commit, stats].filter(Boolean).join(' · '));
  return `<text x="${lay.pad}" y="${height - lay.pad / 2}" font-size="${s(11, lay.scale)}" fill="#656d76">${label}</text>`;
}

export interface BuildPanoramaSvgOptions {
  /** Scale layout units (2 = double-size SVG for sharper PNG rasterization). */
  renderScale?: number;
}

/** Build a standalone SVG document from panorama graph data (true vector, not a DOM screenshot). */
export function buildPanoramaSvg(graph: PanoramaGraph, options: BuildPanoramaSvgOptions = {}): string {
  const lay = layout(options.renderScale ?? 1);
  const nodes = graph.nodes.filter((n) => n.position);
  const bounds = computeBounds(nodes, lay);
  const offsetX = lay.pad - bounds.minX * lay.scale;
  const offsetY = lay.pad - bounds.minY * lay.scale;
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const svgW = Math.ceil(bounds.width);
  const svgH = Math.ceil(bounds.height + s(20, lay.scale));

  const edgeEls = graph.edges
    .map((edge) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      if (!source || !target) return '';
      const stroke = edge.pathHighlight ? '#0969da' : edge.synthesizedBy ? '#bf8700' : '#656d76';
      const dash = edge.synthesizedBy ? ` stroke-dasharray="${s(6, lay.scale)} ${s(4, lay.scale)}"` : '';
      const d = edgePath(source, target, offsetX, offsetY, lay);
      const label = edge.synthesizedBy ? `${edge.kind} · ${edge.synthesizedBy}` : edge.kind;
      const sx = (source.position?.x ?? 0) * lay.scale + lay.nodeW / 2 + offsetX;
      const sy = (source.position?.y ?? 0) * lay.scale + lay.nodeH + offsetY;
      const tx = (target.position?.x ?? 0) * lay.scale + lay.nodeW / 2 + offsetX;
      const ty = (target.position?.y ?? 0) * lay.scale + offsetY;
      const midX = (sx + tx) / 2;
      const midY = (sy + ty) / 2;
      const labelW = s(72, lay.scale);
      const labelH = s(16, lay.scale);
      return `
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="${s(1.5, lay.scale)}"${dash}/>
    <rect x="${midX - labelW / 2}" y="${midY - labelH / 2}" width="${labelW}" height="${labelH}" rx="${s(4, lay.scale)}" fill="#ffffff"/>
    <text x="${midX}" y="${midY + s(4, lay.scale)}" text-anchor="middle" font-size="${s(10, lay.scale)}" fill="#656d76">${escapeXml(truncate(label, 22))}</text>`;
    })
    .join('');

  const nodeEls = nodes.map((n) => renderNode(n, offsetX, offsetY, lay)).join('');
  const footer = renderFooter(graph, svgH, lay);

  const title = graph.commitShortHash
    ? `CodeDelta Panorama · ${graph.commitShortHash}`
    : 'CodeDelta Panorama';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  <title>${escapeXml(title)}</title>
  <rect width="100%" height="100%" fill="${EXPORT_BG}"/>
  <g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" text-rendering="geometricPrecision">
    <g class="panorama-export-edges">${edgeEls}</g>
    <g class="panorama-export-nodes">${nodeEls}</g>
    ${footer}
  </g>
</svg>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

function exportBasename(graph: PanoramaGraph): string {
  return graph.commitShortHash ? `codedelta-panorama-${graph.commitShortHash}` : 'codedelta-panorama';
}

/** Download infinitely scalable vector export. */
export function downloadPanoramaSvg(graph: PanoramaGraph): void {
  const svg = buildPanoramaSvg(graph);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${exportBasename(graph)}.svg`);
}

/** Rasterize vector SVG to a high-DPI PNG. */
export async function downloadPanoramaPng(graph: PanoramaGraph): Promise<void> {
  const svgRenderScale = 2;
  const lay = layout(svgRenderScale);
  const nodes = graph.nodes.filter((n) => n.position);
  const bounds = computeBounds(nodes, lay);
  const rasterScale = resolvePngRasterScale(bounds.width, bounds.height);

  const svg = buildPanoramaSvg(graph, { renderScale: svgRenderScale });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

  try {
    const img = new Image();
    img.decoding = 'async';

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterize failed'));
      img.src = url;
    });

    if (img.decode) {
      await img.decode();
    }

    const logicalW = bounds.width;
    const logicalH = bounds.height + s(20, lay.scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(logicalW * rasterScale);
    canvas.height = Math.ceil(logicalH * rasterScale);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    ctx.fillStyle = EXPORT_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    await new Promise<void>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('PNG encode failed'));
            return;
          }
          downloadBlob(blob, `${exportBasename(graph)}.png`);
          resolve();
        },
        'image/png',
        1,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
