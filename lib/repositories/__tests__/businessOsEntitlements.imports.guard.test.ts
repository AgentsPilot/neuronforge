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
    // ── Component 3, 2026-09-22 — the READ path, stated deliberately ────────
    // `EntitlementService` is the module's only reader (§4.9): every surface
    // goes through `check()`, which is what gives the module one cache policy
    // and one failure policy instead of one per call site. It is added here
    // rather than the guard being weakened, and the test below pins the reason:
    // it may READ entitlement inputs and may not write anything.
    'lib/business-os/entitlements/EntitlementService.ts',
    // Types only: `fromPlanRow` maps a row to the resolver's vocabulary.
    'lib/business-os/entitlements/account.ts',
    'lib/business-os/entitlements/__tests__/entitlementService.test.ts',
  ].map((p) => p.split('/').join(sep))
);

/** The methods that CHANGE entitlement state. Component 5's admin routes own these. */
const WRITE_METHODS = ['ensurePlanRow', 'updatePlan', 'createOverride', 'endOverride', 'resetPlanState'];

/**
 * Allowed files that are NOT the repository layer and NOT an admin route — i.e.
 * files allowed to READ entitlement state and nothing more.
 *
 * Listed rather than derived (SA C3-3): the next entry someone adds to ALLOWED
 * inherits the read-only condition only if they put it here too, and that is a
 * line in a diff someone has to write on purpose. When component 5's admin
 * routes join ALLOWED they do **not** belong in this list — they are the code
 * that may write.
 */
const READ_ONLY_REFERRERS = [
  'lib/business-os/entitlements/EntitlementService.ts',
  'lib/business-os/entitlements/account.ts',
].map((p) => p.split('/').join(sep));

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

  it.each(READ_ONLY_REFERRERS)('%s READS entitlement state and never writes it', (relativePath) => {
    // Why these files are on the allowed list at all: they are the read path. If
    // one ever calls a write method, the admin gate, the Zod validation and the
    // audit trail in front of those writes have been bypassed — so the allowance
    // is conditional, and this is the condition.
    const source = readFileSync(join(ROOT, relativePath), 'utf8');

    for (const method of WRITE_METHODS) {
      expect(source).not.toMatch(new RegExp(`\\.${method}\\s*\\(`));
    }
  });

  it('at least one of them really does read, so the check above is not vacuous', () => {
    const service = readFileSync(join(ROOT, 'lib', 'business-os', 'entitlements', 'EntitlementService.ts'), 'utf8');
    expect(service).toMatch(/findEntitlementInputs\b/);
  });

  it('every read-only referrer is itself on the allowed list', () => {
    // A file listed there but not in ALLOWED would be checked for writes and
    // then fail the referrer scan anyway — confusing.
    expect(READ_ONLY_REFERRERS.filter((p) => !ALLOWED.has(p))).toEqual([]);
  });

  it('every allowed file falls into exactly one category (QA C-1)', () => {
    // The hazard the previous test does NOT catch: a new non-route file added to
    // ALLOWED and *not* to READ_ONLY_REFERRERS, which would then inherit no
    // write condition at all. A comment asked a human to notice; this makes the
    // classification compulsory, because an unclassified file fails here.
    const category = (rel: string): string[] => {
      const p = rel.split(sep).join('/');
      const of: string[] = [];
      // 1. The repository layer itself — the code that is *supposed* to write.
      if (p.startsWith('lib/repositories/') && !p.includes('__tests__/')) of.push('repository');
      // 2. Readers: allowed to look, never to change. Checked above.
      if (READ_ONLY_REFERRERS.includes(rel)) of.push('read_only');
      // 3. Admin routes (component 5) — gated, audited, and allowed to write.
      if (p.startsWith('app/api/admin/')) of.push('admin_route');
      // 4. Tests, which name these symbols in order to assert on them.
      if (p.includes('__tests__/') && p.endsWith('.test.ts')) of.push('test');
      return of;
    };

    const misclassified = [...ALLOWED]
      .map((rel) => ({ file: rel.split(sep).join('/'), categories: category(rel) }))
      .filter((entry) => entry.categories.length !== 1);

    // If this fails: say which of the four the new file is. If it is none of
    // them, it does not belong in ALLOWED.
    expect(misclassified).toEqual([]);
  });

  it('the allowed list names files that exist', () => {
    // A stale entry would silently widen the guard.
    const existing = new Set(files.map((file) => relative(ROOT, file)));
    const missing = [...ALLOWED].filter((rel) => !existing.has(rel));
    expect(missing).toEqual([]);
  });
});
