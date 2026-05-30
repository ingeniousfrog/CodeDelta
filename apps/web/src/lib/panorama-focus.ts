/** Focus navigation for panorama drill-down (expand / back / overview / breadcrumb). */

export interface PanoramaFocusCrumb {
  /** Root query value for this level ('' = all entry points). */
  root: string;
  /** Display label (symbol name or "All entry points"). */
  label: string;
}

const FOCUS_PATH_SEP = '|';

export function pushFocus(stack: string[], currentRoot: string): string[] {
  return [...stack, currentRoot];
}

export function popFocus(stack: string[]): { stack: string[]; root: string } | null {
  if (stack.length === 0) return null;
  const next = [...stack];
  const root = next.pop()!;
  return { stack: next, root };
}

export function focusLabel(root: string): string {
  return root.trim() ? root : 'All entry points';
}

/** Full trail from overview through stack to the current root. */
export function buildFocusTrail(stack: string[], currentRoot: string): PanoramaFocusCrumb[] {
  const crumbs: PanoramaFocusCrumb[] = [{ root: '', label: 'All entry points' }];

  for (const r of stack) {
    if (r.trim()) {
      crumbs.push({ root: r, label: focusLabel(r) });
    }
  }

  if (currentRoot.trim()) {
    const last = crumbs[crumbs.length - 1];
    if (last?.root !== currentRoot) {
      crumbs.push({ root: currentRoot, label: focusLabel(currentRoot) });
    }
  }

  return crumbs;
}

/** Serialize focus trail for URL (?focusPath=a|b|c). */
export function serializeFocusPath(trail: PanoramaFocusCrumb[]): string | null {
  const symbols = trail.map((c) => c.root).filter((r) => r.trim());
  if (symbols.length === 0) return null;
  return symbols.map((s) => encodeURIComponent(s)).join(FOCUS_PATH_SEP);
}

/** Parse ?focusPath= back into stack + current root. */
export function parseFocusPathParam(param: string | null | undefined): { stack: string[]; root: string } {
  if (!param?.trim()) return { stack: [], root: '' };

  const segments = param
    .split(FOCUS_PATH_SEP)
    .map((s) => {
      try {
        return decodeURIComponent(s.trim());
      } catch {
        return s.trim();
      }
    })
    .filter(Boolean);

  if (segments.length === 0) return { stack: [], root: '' };
  if (segments.length === 1) {
    return { stack: [''], root: segments[0]! };
  }

  const root = segments[segments.length - 1]!;
  const stack: string[] = [''];
  for (let i = 0; i < segments.length - 1; i++) {
    stack.push(segments[i]!);
  }
  return { stack, root };
}

/** Read focus state from URL (?focusPath= preferred, ?root= legacy). */
export function resolveFocusFromSearchParams(params: URLSearchParams): { stack: string[]; root: string } {
  const focusPath = params.get('focusPath');
  if (focusPath) return parseFocusPathParam(focusPath);

  const legacyRoot = params.get('root')?.trim();
  if (legacyRoot) return { stack: [''], root: legacyRoot };

  return { stack: [], root: '' };
}

/** Jump to a breadcrumb index (0 = overview). */
export function focusAtTrailIndex(
  stack: string[],
  currentRoot: string,
  index: number,
): { stack: string[]; root: string } | null {
  const trail = buildFocusTrail(stack, currentRoot);
  if (index < 0 || index >= trail.length) return null;

  const target = trail[index]!;
  if (index === 0) {
    return { stack: [], root: '' };
  }

  const newStack: string[] = [''];
  for (let j = 1; j < index; j++) {
    newStack.push(trail[j]!.root);
  }
  return { stack: newStack, root: target.root };
}
