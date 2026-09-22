/**
 * RC-15 — who is allowed to reach the entitlement repositories.
 *
 * The workplan (§3, §13.2) requires this guard in component 1, with an **empty**
 * allowed-referrer set: nothing outside the repositories themselves may touch
 * these tables yet. It exists now rather than later because `lib/repositories/
 * index.ts` re-exports the WRITE methods through the barrel, so from the moment
 * component 1 lands, any module could import `businessOsAccountPlanRepository`
 * and change an account's plan — bypassing the admin gate, the Zod validation
 * and the audit trail that component 5 will put in front of it.
 *
 * Symbol-level, not path-level (QA/SA note): a barrel import
 * (`from '@/lib/repositories'`) names no file, so matching import paths would
 * miss exactly the case the barrel creates. This scans for the symbols.
 *
 * When component 5 adds the admin routes, add their paths to ALLOWED — that edit
 * is the point at which someone states, in a reviewable diff, who may write
 * entitlement state.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SCANNED_DIRS = ['app', 'lib', 'components', 'hooks', 'scripts'];

/** Symbols that reach the entitlement tables. */
const GUARDED_SYMBOLS = [
  'BusinessOsAccountPlanRepository',
  'businessOsAccountPlanRepository',
  'BusinessOsEntitlementShadowRepository',
  'businessOsEntitlementShadowRepository',
];

/**
 * Files allowed to name them.
 *
 * The repositories themselves, the barrel that exports them, and their tests.
 * **No application code.** Component 5's admin routes join this list when they
 * are written.
 */
const ALLOWED = new Set(
  [
    'lib/repositories/BusinessOsAccountPlanRepository.ts',
    'lib/repositories/BusinessOsEntitlementShadowRepository.ts',
    'lib/repositories/index.ts',
    'lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts',
    'lib/repositories/__tests__/BusinessOsEntitlementShadowRepository.test.ts',
    'lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts',
  ].map((p) => p.split('/').join(sep))
);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.claude') continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

describe('RC-15 — entitlement repository referrers', () => {
  it('scans a non-trivial number of files', () => {
    // A guard on the guard: a broken walk would make everything below pass.
    expect(files.length).toBeGreaterThan(500);
  });

  it.each(GUARDED_SYMBOLS)('only the repository layer names %s', (symbol) => {
    const pattern = new RegExp(`\\b${symbol}\\b`);

    const referrers = files
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))
      .filter((rel) => !ALLOWED.has(rel))
      .sort();

    // If this fails: either the referrer is an admin route that belongs in
    // ALLOWED (add it, and say so in the PR), or it is application code that
    // should be going through an admin route instead.
    expect(referrers).toEqual([]);
  });

  it('the allowed list names files that exist', () => {
    // A stale entry would silently widen the guard.
    const existing = new Set(files.map((file) => relative(ROOT, file)));
    const missing = [...ALLOWED].filter((rel) => !existing.has(rel));
    expect(missing).toEqual([]);
  });
});
