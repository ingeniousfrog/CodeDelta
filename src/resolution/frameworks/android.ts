/**
 * Android Framework Resolver
 *
 * Parses AndroidManifest.xml for MAIN/LAUNCHER activities and emits
 * launch route nodes linked to Activity classes.
 */

import { Node } from '../../types';
import {
  FrameworkResolver,
  FrameworkExtractionResult,
  UnresolvedRef,
} from '../types';

function parseLauncherActivities(manifest: string): Array<{ activity: string; line: number }> {
  const results: Array<{ activity: string; line: number }> = [];
  const lines = manifest.split('\n');
  let currentActivity: string | null = null;
  let activityLine = 0;
  let inMainLauncher = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const activityMatch = line.match(/<activity[^>]*android:name="([^"]+)"/);
    if (activityMatch) {
      currentActivity = activityMatch[1]!.replace(/^\./, '');
      activityLine = i + 1;
      inMainLauncher = false;
    }
    if (currentActivity && line.includes('android.intent.action.MAIN')) {
      inMainLauncher = true;
    }
    if (inMainLauncher && currentActivity && line.includes('android.intent.category.LAUNCHER')) {
      results.push({ activity: currentActivity, line: activityLine });
      inMainLauncher = false;
      currentActivity = null;
    }
    if (line.includes('</activity>')) {
      currentActivity = null;
      inMainLauncher = false;
    }
  }

  return results;
}

function activitySimpleName(fqn: string): string {
  const parts = fqn.split('.');
  return parts[parts.length - 1] ?? fqn;
}

export const androidResolver: FrameworkResolver = {
  name: 'android',
  languages: ['xml', 'kotlin', 'java'],

  detect(context) {
    if (context.fileExists('AndroidManifest.xml')) return true;
    const gradle = context.readFile('build.gradle') ?? context.readFile('app/build.gradle');
    return Boolean(gradle && /com\.android\.application/.test(gradle));
  },

  resolve(ref, context) {
    if (!ref.referenceName.endsWith('Activity') && ref.referenceName !== 'onCreate') {
      return null;
    }
    const simple = ref.referenceName.replace(/^.*\./, '');
    const matches = context.getNodesByName(simple);
    if (matches.length === 1) {
      return {
        original: ref,
        targetNodeId: matches[0]!.id,
        confidence: 0.75,
        resolvedBy: 'framework',
      };
    }
    return null;
  },

  extract(filePath, content): FrameworkExtractionResult {
    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const now = Date.now();

    if (filePath.endsWith('AndroidManifest.xml') || filePath.endsWith('/AndroidManifest.xml')) {
      for (const { activity, line } of parseLauncherActivities(content)) {
        const simple = activitySimpleName(activity);
        const routeNode: Node = {
          id: `route:android:launch:${filePath}:${line}:${simple}`,
          kind: 'route',
          name: `LAUNCHER ${simple}`,
          qualifiedName: `android:launch:${activity}`,
          filePath,
          startLine: line,
          endLine: line,
          startColumn: 0,
          endColumn: 80,
          language: 'xml',
          docstring: 'Android MAIN/LAUNCHER activity entry',
          updatedAt: now,
        };
        nodes.push(routeNode);
        references.push({
          fromNodeId: routeNode.id,
          referenceName: simple,
          referenceKind: 'references',
          line,
          column: 0,
          filePath,
          language: 'xml',
          candidates: [activity],
        });
      }
      return { nodes, references };
    }

    if (!filePath.endsWith('.kt') && !filePath.endsWith('.java')) {
      return { nodes, references };
    }

    const language = filePath.endsWith('.kt') ? 'kotlin' : 'java';
    const classMatch = content.match(
      /class\s+(\w+)(?:\s*:\s*[\w.]+Activity|\s+extends\s+[\w.]+Activity)/,
    );
    if (!classMatch) return { nodes, references };

    const className = classMatch[1]!;
    const classLine = content.slice(0, classMatch.index ?? 0).split('\n').length;
    const onCreateMatch = content.match(/\bfun\s+onCreate\s*\(|\bvoid\s+onCreate\s*\(/);
    const onCreateLine = onCreateMatch
      ? content.slice(0, onCreateMatch.index ?? 0).split('\n').length
      : classLine;

    const componentNode: Node = {
      id: `component:${filePath}:${classLine}:${className}`,
      kind: 'component',
      name: className,
      qualifiedName: `${filePath}::${className}`,
      filePath,
      startLine: classLine,
      endLine: classLine + 5,
      startColumn: 0,
      endColumn: 40,
      language,
      docstring: 'Android Activity component',
      updatedAt: now,
    };
    nodes.push(componentNode);

    if (onCreateMatch) {
      references.push({
        fromNodeId: componentNode.id,
        referenceName: 'onCreate',
        referenceKind: 'contains',
        line: onCreateLine,
        column: 0,
        filePath,
        language,
      });
    }

    return { nodes, references };
  },
};
