import type {
  CodeGraphSnapshot,
  GraphDiff,
  ImpactExplanation,
  ImpactSeverity,
  ImpactSummary,
} from '@codedelta/types';

/** Impact-first deterministic scoring weights. */
const S_AFFECTED_RADIUS = 45;
const S_ENTRY_SURFACE = 20;
const S_MODULE_SPREAD = 15;
const S_STRUCTURAL_CHURN = 12;
const S_RISK_BONUS = 8;

const RISK_RULES: Array<{ tag: string; patterns: RegExp[]; reason: string }> = [
  { tag: 'auth', patterns: [/auth/i, /login/i, /session/i, /jwt/i, /oauth/i], reason: 'touches authentication/session logic' },
  { tag: 'billing', patterns: [/billing/i, /stripe/i, /payment/i, /invoice/i], reason: 'touches billing or payment flow' },
  { tag: 'database', patterns: [/prisma/i, /schema/i, /\bsql\b/i, /orm/i, /database/i], reason: 'touches data/storage boundaries' },
  { tag: 'migration', patterns: [/migration/i], reason: 'includes migration-like changes' },
  { tag: 'env', patterns: [/\.env/i, /config\/env/i], reason: 'touches runtime environment configuration' },
  { tag: 'config', patterns: [/config/i, /settings/i], reason: 'touches global configuration' },
  { tag: 'api', patterns: [/api\//i, /routes?\//i, /handler/i, /controller/i], reason: 'touches API surface' },
  { tag: 'routing', patterns: [/route/i, /router/i, /pages\//i], reason: 'touches routing/entry behavior' },
  { tag: 'dependency', patterns: [/package\.json/i, /Cargo\.toml/i, /Cargo\.lock/i, /import/i], reason: 'touches dependencies/import graph' },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function collectRiskTags(diff: GraphDiff): string[] {
  const tags = new Set<string>();
  const texts: string[] = [];

  for (const f of diff.changedFiles) {
    texts.push(f.path);
  }
  for (const n of [...diff.addedNodes, ...diff.removedNodes, ...diff.modifiedNodes.map((m) => m.after)]) {
    texts.push(n.filePath, n.name, n.qualifiedName);
  }

  const haystack = texts.join('\n');
  for (const rule of RISK_RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) {
      tags.add(rule.tag);
    }
  }

  return Array.from(tags).sort();
}

function topLevelModule(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? filePath;
}

function impactedModules(diff: GraphDiff): string[] {
  const modules = new Set<string>();
  for (const f of diff.changedFiles) {
    modules.add(topLevelModule(f.path));
  }
  for (const n of [...diff.addedNodes, ...diff.removedNodes, ...diff.modifiedNodes.map((m) => m.after)]) {
    modules.add(topLevelModule(n.filePath));
  }
  return Array.from(modules).sort();
}

function impactedModulesFromAffected(
  diff: GraphDiff,
  head: CodeGraphSnapshot | undefined,
  affectedIds: Set<string>,
): string[] {
  if (!head) return impactedModules(diff);
  const modules = new Set<string>();
  for (const node of head.nodes) {
    if (!affectedIds.has(node.id)) continue;
    modules.add(topLevelModule(node.filePath));
  }
  if (modules.size === 0) return impactedModules(diff);
  return Array.from(modules).sort();
}

function impactedEntryPoints(head: CodeGraphSnapshot, affectedIds: Set<string>): string[] {
  const entries: string[] = [];
  for (const node of head.nodes) {
    if (!affectedIds.has(node.id)) continue;
    if (node.kind === 'route' || node.kind === 'component') {
      entries.push(node.qualifiedName);
    } else if (node.isExported && (node.kind === 'function' || node.kind === 'method')) {
      entries.push(node.qualifiedName);
    }
  }
  return [...new Set(entries)].sort();
}

function severityFromScore(score: number): ImpactSeverity {
  if (score >= 90) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function normalize(count: number, weight: number, cap: number): number {
  if (count <= 0) return 0;
  return Math.min(cap, Math.log1p(count) * weight);
}

function ratio(value: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(value / total, 0, 1);
}

function ratioScore(r: number, maxScore: number): number {
  if (r <= 0) return 0;
  return Math.sqrt(r) * maxScore;
}

function buildExplanation(params: {
  changedFiles: number;
  changedSymbols: number;
  changedEdges: number;
  affectedNodes: number;
  affectedRatio: number;
  riskTags: string[];
  entryPoints: number;
  entryPointRatio: number;
  impactedModules: number;
  moduleSpreadRatio: number;
  score: number;
}): ImpactExplanation {
  const contributors = [
    {
      factor: 'affectedNodes' as const,
      value: params.affectedNodes,
      weight: S_AFFECTED_RADIUS,
      contribution: ratioScore(params.affectedRatio, S_AFFECTED_RADIUS),
    },
    {
      factor: 'entryPoints' as const,
      value: params.entryPoints,
      weight: S_ENTRY_SURFACE,
      contribution: ratioScore(params.entryPointRatio, S_ENTRY_SURFACE),
    },
    {
      factor: 'changedFiles' as const,
      value: params.impactedModules,
      weight: S_MODULE_SPREAD,
      contribution: ratioScore(params.moduleSpreadRatio, S_MODULE_SPREAD),
    },
    {
      factor: 'changedEdges' as const,
      value: params.changedEdges,
      weight: S_STRUCTURAL_CHURN / 2,
      contribution: normalize(params.changedEdges, S_STRUCTURAL_CHURN / 2, S_STRUCTURAL_CHURN / 2),
    },
    {
      factor: 'changedSymbols' as const,
      value: params.changedSymbols,
      weight: S_STRUCTURAL_CHURN / 2,
      contribution: normalize(params.changedSymbols, S_STRUCTURAL_CHURN / 2, S_STRUCTURAL_CHURN / 2),
    },
    {
      factor: 'riskTags' as const,
      value: params.riskTags.length,
      weight: S_RISK_BONUS,
      contribution: normalize(params.riskTags.length, S_RISK_BONUS, S_RISK_BONUS),
    },
  ].sort((a, b) => b.contribution - a.contribution);

  const severity = severityFromScore(params.score);

  const reasons: string[] = [];
  reasons.push(
    `blast radius: ${params.affectedNodes} nodes (~${Math.round(params.affectedRatio * 100)}% of indexed graph)`,
  );
  reasons.push(
    `entry surface: ${params.entryPoints} entry points (~${Math.round(params.entryPointRatio * 100)}% of entry set)`,
  );
  reasons.push(
    `module spread: ${params.impactedModules} modules (~${Math.round(params.moduleSpreadRatio * 100)}%)`,
  );
  reasons.push(`${params.changedSymbols} changed symbols, ${params.changedEdges} edge changes`);
  if (params.riskTags.length > 0) {
    reasons.push(`risk tags: ${params.riskTags.join(', ')}`);
  }

  return {
    severity,
    summary: `${severity.charAt(0).toUpperCase() + severity.slice(1)} impact based on structural change volume and risk surfaces.`,
    reasons,
    topContributors: contributors.slice(0, 4),
  };
}

/**
 * Deterministic impact score for a commit range (no LLM).
 */
export function computeImpactScore(
  commitHash: string,
  diff: GraphDiff,
  head?: CodeGraphSnapshot,
): ImpactSummary {
  const changedSymbols =
    diff.summary.symbolsAdded + diff.summary.symbolsRemoved + diff.summary.symbolsModified;
  const changedEdges = diff.summary.edgesAdded + diff.summary.edgesRemoved;

  const riskTags = collectRiskTags(diff);
  const affectedSet = new Set(diff.affectedNodeIds);
  const entryPoints = head ? impactedEntryPoints(head, affectedSet) : [];
  const affectedNodeCount = diff.affectedNodeIds.length;
  const totalNodes = head?.nodeCount ?? 0;
  const affectedRatio = ratio(affectedNodeCount, totalNodes);

  const allEntryPointCount = head
    ? head.nodes.filter(
        (node) =>
          node.kind === 'route' ||
          node.kind === 'component' ||
          (node.isExported && (node.kind === 'function' || node.kind === 'method')),
      ).length
    : 0;
  const entryPointRatio = ratio(entryPoints.length, allEntryPointCount);

  const affectedModules = impactedModulesFromAffected(diff, head, affectedSet);
  const totalModuleCount = head
    ? new Set(head.nodes.map((node) => topLevelModule(node.filePath))).size
    : affectedModules.length;
  const moduleSpreadRatio = ratio(affectedModules.length, totalModuleCount);

  const structuralChurn =
    normalize(changedSymbols, S_STRUCTURAL_CHURN / 2, S_STRUCTURAL_CHURN / 2) +
    normalize(changedEdges, S_STRUCTURAL_CHURN / 2, S_STRUCTURAL_CHURN / 2);

  const raw =
    ratioScore(affectedRatio, S_AFFECTED_RADIUS) +
    ratioScore(entryPointRatio, S_ENTRY_SURFACE) +
    ratioScore(moduleSpreadRatio, S_MODULE_SPREAD) +
    structuralChurn +
    normalize(riskTags.length, S_RISK_BONUS, S_RISK_BONUS);

  const score = clamp(Math.round(raw), 0, 100);

  return {
    commitHash,
    score,
    changedSymbols,
    changedEdges,
    affectedModules,
    impactedEntryPoints: entryPoints,
    riskTags,
    explanation: buildExplanation({
      changedFiles: diff.changedFiles.length,
      changedSymbols,
      changedEdges,
      affectedNodes: affectedNodeCount,
      affectedRatio,
      riskTags,
      entryPoints: entryPoints.length,
      entryPointRatio,
      impactedModules: affectedModules.length,
      moduleSpreadRatio,
      score,
    }),
  };
}

export const __private = {
  severityFromScore,
};
