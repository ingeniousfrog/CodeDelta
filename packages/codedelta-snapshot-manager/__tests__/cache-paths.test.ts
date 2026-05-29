import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMonorepoRoot } from '../src/cache-paths';

describe('resolveMonorepoRoot', () => {
  const prev = process.env.CODEDELTA_MONOREPO_ROOT;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.CODEDELTA_MONOREPO_ROOT;
    } else {
      process.env.CODEDELTA_MONOREPO_ROOT = prev;
    }
  });

  it('uses CODEDELTA_MONOREPO_ROOT when set', () => {
    process.env.CODEDELTA_MONOREPO_ROOT = '/tmp/codedelta-runtime';
    expect(resolveMonorepoRoot()).toBe(path.resolve('/tmp/codedelta-runtime'));
  });

  it('falls back to monorepo relative path', () => {
    delete process.env.CODEDELTA_MONOREPO_ROOT;
    expect(resolveMonorepoRoot()).toBe(path.resolve(__dirname, '../../..'));
  });
});
