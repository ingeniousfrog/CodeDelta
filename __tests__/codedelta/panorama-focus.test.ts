import { describe, expect, it } from 'vitest';
import {
  buildFocusTrail,
  focusAtTrailIndex,
  parseFocusPathParam,
  serializeFocusPath,
} from '../../apps/web/src/lib/panorama-focus';

describe('panorama-focus URL trail', () => {
  it('round-trips a multi-hop focus path', () => {
    const trail = buildFocusTrail(['', 'MainActivity.onCreate'], 'handleClick');
    const encoded = serializeFocusPath(trail);
    expect(encoded).toBeTruthy();
    const parsed = parseFocusPathParam(encoded);
    expect(parsed.root).toBe('handleClick');
    expect(parsed.stack).toEqual(['', 'MainActivity.onCreate']);
  });

  it('navigates breadcrumb index back to overview', () => {
    const next = focusAtTrailIndex(['', 'A'], 'B', 0);
    expect(next).toEqual({ stack: [], root: '' });
  });

  it('navigates breadcrumb index to intermediate hop', () => {
    const next = focusAtTrailIndex(['', 'A'], 'B', 1);
    expect(next).toEqual({ stack: [''], root: 'A' });
  });

  it('encodes symbols with special characters', () => {
    const trail = buildFocusTrail([], 'GET /api/users');
    const encoded = serializeFocusPath(trail)!;
    const parsed = parseFocusPathParam(encoded);
    expect(parsed.root).toBe('GET /api/users');
  });
});
