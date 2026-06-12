/** Normalize a repository-relative asset path (README / HTML / markdown). */
export function normalizeWikiAssetPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Asset path is required');
  let normalized = trimmed.replace(/\\/g, '/');
  if (normalized.startsWith('/')) normalized = normalized.slice(1);
  normalized = normalized.replace(/^\.\//, '');
  if (!normalized || normalized.includes('..') || normalized.includes('/../')) {
    throw new Error('Invalid asset path');
  }
  return normalized;
}

export function buildWikiAssetUrl(
  repoId: string,
  commitHash: string,
  relativePath: string,
): string {
  const filePath = normalizeWikiAssetPath(relativePath);
  return `/api/repos/${encodeURIComponent(repoId)}/wiki/asset?commit=${encodeURIComponent(commitHash)}&path=${encodeURIComponent(filePath)}`;
}

function shouldRewriteAssetUrl(url: string): boolean {
  const u = url.trim();
  if (!u || u.startsWith('#')) return false;
  if (u.startsWith('/api/')) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u)) return false;
  return true;
}

/**
 * Rewrite relative README image URLs to a resolver (typically the wiki asset API).
 * Handles HTML <img src> and markdown ![alt](url).
 */
export function rewriteWikiAssetUrls(
  content: string,
  resolveUrl: (relativePath: string) => string,
): string {
  let out = content.replace(
    /<img([^>]*?)\ssrc=(["'])([^"']+)\2([^>]*)>/gi,
    (full, before, quote, src, after) => {
      if (!shouldRewriteAssetUrl(src)) return full;
      try {
        const next = resolveUrl(normalizeWikiAssetPath(src));
        return `<img${before} src=${quote}${next}${quote}${after}>`;
      } catch {
        return full;
      }
    },
  );

  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, url) => {
    const raw = String(url).trim();
    if (!shouldRewriteAssetUrl(raw)) return full;
    try {
      const next = resolveUrl(normalizeWikiAssetPath(raw));
      return `![${alt}](${next})`;
    } catch {
      return full;
    }
  });

  return out;
}
