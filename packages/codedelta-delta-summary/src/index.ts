import type { DeltaSummary, GraphDiff, ImpactSummary } from '@codedelta/types';

function moduleName(filePath: string): string {
  const p = filePath.split('/').filter(Boolean);
  if (p.length >= 2) return `${p[0]}/${p[1]}`;
  return p[0] ?? filePath;
}

function areaForFile(filePath: string): string {
  if (filePath.startsWith('src/')) return moduleName(filePath);
  return filePath.split('/')[0] ?? filePath;
}

function riskReason(tag: string): string {
  switch (tag) {
    case 'auth':
      return 'Authentication/session related files changed';
    case 'billing':
      return 'Billing/payment related files changed';
    case 'database':
      return 'Data/storage boundary changed';
    case 'migration':
      return 'Migration-like changes detected';
    case 'env':
      return 'Runtime environment settings touched';
    case 'config':
      return 'Global configuration touched';
    case 'api':
      return 'API surface files changed';
    case 'routing':
      return 'Route or navigation behavior touched';
    case 'dependency':
      return 'Dependency/import graph touched';
    default:
      return 'Potentially sensitive area changed';
  }
}

function priorityFrom(file: string, riskTags: string[]): 'high' | 'medium' | 'low' {
  if (riskTags.length > 0) return 'high';
  if (/config|auth|billing|api|route|Cargo\.toml|package\.json/i.test(file)) return 'high';
  if (/service|controller|handler|core/i.test(file)) return 'medium';
  return 'low';
}

/**
 * Deterministic human-readable summary from compare output.
 */
export function buildDeltaSummary(diff: GraphDiff, impact: ImpactSummary): DeltaSummary {
  const changedSymbols =
    diff.summary.symbolsAdded + diff.summary.symbolsRemoved + diff.summary.symbolsModified;
  const edgeChanges = diff.summary.edgesAdded + diff.summary.edgesRemoved;

  const fileToSymbolCount = new Map<string, number>();
  for (const n of diff.addedNodes) {
    fileToSymbolCount.set(n.filePath, (fileToSymbolCount.get(n.filePath) ?? 0) + 1);
  }
  for (const n of diff.removedNodes) {
    fileToSymbolCount.set(n.filePath, (fileToSymbolCount.get(n.filePath) ?? 0) + 1);
  }
  for (const m of diff.modifiedNodes) {
    const file = m.after.filePath;
    fileToSymbolCount.set(file, (fileToSymbolCount.get(file) ?? 0) + 1);
  }

  const areaMap = new Map<string, { files: Set<string>; changedSymbols: number; riskTags: Set<string> }>();
  for (const f of diff.changedFiles) {
    const area = areaForFile(f.path);
    const record = areaMap.get(area) ?? { files: new Set<string>(), changedSymbols: 0, riskTags: new Set<string>() };
    record.files.add(f.path);
    record.changedSymbols += fileToSymbolCount.get(f.path) ?? 0;
    for (const tag of impact.riskTags) {
      if (new RegExp(tag, 'i').test(f.path)) {
        record.riskTags.add(tag);
      }
    }
    areaMap.set(area, record);
  }

  const mainAreas = Array.from(areaMap.entries())
    .map(([name, rec]) => ({
      name,
      files: Array.from(rec.files).sort().slice(0, 8),
      changedSymbols: rec.changedSymbols,
      riskTags: Array.from(rec.riskTags).sort(),
    }))
    .sort((a, b) => b.changedSymbols - a.changedSymbols)
    .slice(0, 8);

  const risks = impact.riskTags.map((tag) => {
    const files = diff.changedFiles
      .map((f) => f.path)
      .filter((f) => new RegExp(tag, 'i').test(f))
      .slice(0, 10);
    return {
      tag,
      reason: riskReason(tag),
      files,
    };
  });

  const reviewOrder = diff.changedFiles
    .map((f) => ({
      file: f.path,
      reason:
        f.status === 'deleted'
          ? 'File deletion may break downstream dependencies'
          : f.status === 'renamed'
            ? 'Rename can break imports and routes'
            : 'Changed in commit range',
      priority: priorityFrom(
        f.path,
        impact.riskTags.filter((tag) => new RegExp(tag, 'i').test(f.path)),
      ),
      score:
        (fileToSymbolCount.get(f.path) ?? 0) +
        (impact.riskTags.some((tag) => new RegExp(tag, 'i').test(f.path)) ? 10 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map(({ file, reason, priority }) => ({ file, reason, priority }));

  return {
    title: 'Commit-to-commit structural delta',
    overview: [
      `${diff.changedFiles.length} changed files`,
      `${changedSymbols} changed symbols`,
      `${edgeChanges} dependency edge changes`,
      `${diff.affectedNodeIds.length} affected nodes`,
      impact.impactedEntryPoints.length > 0
        ? `${impact.impactedEntryPoints.length} affected entry points`
        : 'No impacted entry points detected',
    ],
    mainAreas,
    risks,
    reviewOrder,
    metrics: {
      changedFiles: diff.changedFiles.length,
      changedSymbols,
      edgeChanges,
      affectedNodes: diff.affectedNodeIds.length,
    },
  };
}
