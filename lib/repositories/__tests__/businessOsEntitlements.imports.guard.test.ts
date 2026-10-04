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
 * Symbol-level rather than import-path-level (QA/SA note): a barrel import
 * (`from '@/lib/repositories'`) names no file, so matching import paths would
 * miss exactly the case the barrel creates. This scans for the symbols.
 *
 * ── What that precision actually is (SA S0-2, 2026-09-26) ────────────────
 * **It is symbol-level for a value import and path-level for a type-only
 * import**, and this header used to claim the first for both.
 *
 * The scan is a plain text match over the whole file, so a guarded symbol
 * matches wherever its name appears — including inside the module PATH of
 * `import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOs`
 * `AccountPlanRepository'`. That import erases at compile time: it brings in no
 * value, calls nothing, and cannot reach a table. Only the path survives to be
 * matched, so the file is reported as a referrer when nothing is referred to.
 *
 * It **fails safe** — it over-reports, never under-reports — and the remedy is
 * to declare the file in `ALLOWED` with the reason, as `dormantChampions.test.ts`
 * does below. Do **not** re-route the type through the barrel to make the match
 * go away: that passes by hiding a referrer, which is the evasion this guard
 * exists to prevent. A declared referrer is auditable; a hidden one is not.
 *
 * Refining the match to distinguish a type-only import is tracked **outside
 * S-0** — see `docs/workplans/business-os-s0-unblock.md` §10.3. Widening a
 * security guard is not a change to make inside a slice that is not about it.
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
    // ── Component 4, 2026-09-22 — shadow mode and the report ───────────────
    // `shadow.ts` records OBSERVATIONS (`recordEvents`); `report.ts` reads plan
    // rows and observations. Neither may change plan state, which is what the
    // check below enforces for everything in NO_STATE_WRITE_REFERRERS.
    'lib/business-os/entitlements/shadow.ts',
    'lib/business-os/entitlements/report.ts',
    'lib/business-os/entitlements/__tests__/shadow.test.ts',
    'lib/business-os/entitlements/__tests__/report.test.ts',
    // ── Component 5, 2026-09-22 — the admin surface ────────────────────────
    // These ARE the code that may write entitlement state, which is why they
    // are the only files here that do NOT belong in NO_STATE_WRITE_REFERRERS.
    // Each one gates with `requireAdmin` as its first statement, validates with
    // Zod, and writes an audit entry that is flushed before it responds.
    'app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts',
    'app/api/admin/business-os/entitlements/launch/route.ts',
    'lib/business-os/entitlements/adminOps.ts',
    'lib/business-os/entitlements/__tests__/adminOps.test.ts',
    'app/api/admin/business-os/entitlements/__tests__/routes.test.ts',
    // ── S-0, 2026-09-26 ─ the trim-list section test ────────────────────
    // A test of `report.ts` (already allowed). It names the repository only in
    // the PATH of an `import type` — it imports no value and calls nothing.
    // Declared here rather than routed through the barrel to dodge the match:
    // hiding a referrer is worse than declaring one. See the header.
    'lib/business-os/entitlements/__tests__/dormantChampions.test.ts',
    // ── Invite-only signup Slice 1b, 2026-09-28 ────────────────────────────
    // The account summary route passes the plan repository to the widened
    // tenant check (L-4: "any plan row" makes a tenant). READ ONLY: it calls
    // `findEntitlementInputs` through `isBusinessOsTenant` and nothing else
    // (SA R-8). An admin route, gated by `requireAdmin`.
    'app/api/admin/business-os/accounts/[accountId]/summary/route.ts',
    'app/api/admin/business-os/accounts/[accountId]/summary/__tests__/route.test.ts',
    // The redemption's production wiring. It may call exactly TWO plan-state
    // writes, `provisionFromInvite` (the champion finalise) and, from Slice 5b,
    // `provisionFromFriendInvite` (the friend finalise, T-19), each after
    // mailbox proof, the invite claim and the account creation; the test below
    // pins that it calls no other write method (F-8). Slice 5b also hands it the
    // plan repository as the friend issuer's READ-ONLY plan reader
    // (`findEntitlementInputs`, the TypeScript in-force re-check).
    'lib/business-os/invites/redemptionDeps.ts',
    'lib/business-os/invites/__tests__/redemptionDeps.test.ts',
    // Slice 5b (QA-1): the friend code route's end-to-end test. It replaces the
    // plan repository with a fake that only answers `findEntitlementInputs`.
    'app/api/public/invites/signup/__tests__/code.friend.route.test.ts',
    // ── Credit deduction slice 4b, 2026-09-29 — the leak check ─────────────
    // The leak check walks every Business OS account (plan rows, SA S-1) and
    // needs each one's `period_anchor` to name the billing period of a leak
    // (SA S-4). READ ONLY: `pagePlans` and `findEntitlementInputs`, nothing
    // else; listed in NO_STATE_WRITE_REFERRERS below, which pins it. Its callers
    // are an admin route (`requireAdmin` first) and a fail-closed cron.
    'lib/business-os/credits/creditLeakCheckDeps.ts',
    // ── Invite-only signup Slice 5a, 2026-09-30 — friend invites ───────────
    // The friend-invite routes' production wiring. READ ONLY: the operations
    // call `findEntitlementInputs` to ask whether the signed-in account is an
    // in-force champion (T-17 mode: the plan row, never the resolver), and
    // nothing else; listed in NO_STATE_WRITE_REFERRERS below, which pins it.
    // The operations themselves name no plan repository (a structural type).
    'lib/business-os/invites/friendInviteDeps.ts',
    // ── Credit deduction slice 6a, 2026-09-30 — the owner credits card ──────
    // Credit deduction slice 6a: the owner card's period — READ ONLY,
    // `findPeriodAnchor` and nothing else (SA W6-1). The one file that wires the
    // plan repository for `GET /api/business-os/usage`; the account id is the
    // session's, through the account seam. Listed in NO_STATE_WRITE_REFERRERS
    // below, which pins it, and the slice 6a test below pins the one method.
    'lib/business-os/credits/ownerCreditUsageDeps.ts',
    // ── Credit deduction slice 11c, 2026-10-03 — the admin per-account credit view ──
    // The route passes the plan repository to the tenant check (as the summary
    // route does): READ ONLY through `isBusinessOsTenant`. An admin route, gated
    // by `requireAdmin`. Its test replaces the repository with a fake.
    'app/api/admin/business-os/credits/accounts/[accountId]/route.ts',
    'app/api/admin/business-os/credits/accounts/[accountId]/__tests__/route.test.ts',
    // The view's service-role wiring: READ ONLY, `findPeriodAnchor` and nothing
    // else (the slice 11c test below pins the one method). Listed in
    // NO_STATE_WRITE_REFERRERS below.
    'lib/business-os/credits/adminCreditPositionDeps.ts',
  ].map((p) => p.split('/').join(sep))
);

/** Slice 6a: the owner card's wiring, and the ONE plan-repository method it may call. */
const OWNER_CREDIT_CARD_WIRING = 'lib/business-os/credits/ownerCreditUsageDeps.ts';
const OWNER_CREDIT_CARD_METHOD = 'findPeriodAnchor';

/** Slice 11c: the admin credit view's wiring, and the ONE plan-repository method it may call. */
const ADMIN_CREDIT_VIEW_WIRING = 'lib/business-os/credits/adminCreditPositionDeps.ts';

/** The methods that CHANGE entitlement state. Component 5's admin routes own these. */
const WRITE_METHODS = [
  'ensurePlanRow',
  'updatePlan',
  'createOverride',
  'endOverride',
  'resetPlanState',
  // Invite-only signup Slice 1b (F-8): the finalise function writes a plan row.
  'provisionFromInvite',
  // Invite-only signup Slice 5b (T-19): the friend finalise writes a no-basis plan row.
  'provisionFromFriendInvite',
];

/** The one invite-redemption file allowed to name the plan repository, and the writes it may call. */
const INVITE_REDEMPTION_WIRING = 'lib/business-os/invites/redemptionDeps.ts';
const INVITE_REDEMPTION_WRITES = ['provisionFromInvite', 'provisionFromFriendInvite'];

/**
 * Allowed files that are NOT the repository layer and NOT an admin route.
 *
 * The invariant is **"may not change entitlement STATE"**, which is narrower
 * than "read only" and is why the list is named this way: `shadow.ts` writes —
 * it records observations through `recordEvents` — but a shadow event is
 * observability, not a plan. What none of these may do is call a method that
 * changes what an account is entitled to; those belong to component 5's admin
 * routes, behind `requireAdmin`, Zod and the audit trail.
 *
 * Listed rather than derived (SA C3-3): the next entry someone adds to ALLOWED
 * inherits the condition only if they put it here too, and that is a line in a
 * diff someone has to write on purpose.
 */
const NO_STATE_WRITE_REFERRERS = [
  'lib/business-os/entitlements/EntitlementService.ts',
  'lib/business-os/entitlements/account.ts',
  'lib/business-os/entitlements/shadow.ts',
  'lib/business-os/entitlements/report.ts',
  // Credit deduction slice 4b: the leak check's wiring reads plan rows only.
  'lib/business-os/credits/creditLeakCheckDeps.ts',
  // Invite-only signup Slice 5a: the friend-invite wiring reads plan rows only.
  'lib/business-os/invites/friendInviteDeps.ts',
  // Credit deduction slice 6a: the owner card's period — READ ONLY, `findPeriodAnchor` and nothing else.
  'lib/business-os/credits/ownerCreditUsageDeps.ts',
  // Credit deduction slice 11c: the admin credit view's wiring — READ ONLY, `findPeriodAnchor` and nothing else.
  'lib/business-os/credits/adminCreditPositionDeps.ts',
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

  it.each(NO_STATE_WRITE_REFERRERS)('%s never changes entitlement STATE', (relativePath) => {
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

  it('every no-state-write referrer is itself on the allowed list', () => {
    // A file listed there but not in ALLOWED would be checked for writes and
    // then fail the referrer scan anyway — confusing.
    expect(NO_STATE_WRITE_REFERRERS.filter((p) => !ALLOWED.has(p))).toEqual([]);
  });

  it('every allowed file falls into exactly one category (QA C-1)', () => {
    // The hazard the previous test does NOT catch: a new non-route file added to
    // ALLOWED and *not* to NO_STATE_WRITE_REFERRERS, which would then inherit no
    // write condition at all. A comment asked a human to notice; this makes the
    // classification compulsory, because an unclassified file fails here.
    const category = (rel: string): string[] => {
      const p = rel.split(sep).join('/');
      const of: string[] = [];
      // Decided first so a test UNDER an admin path counts once, as a test:
      // otherwise `app/api/admin/**/__tests__/x.test.ts` lands in two
      // categories and the partition fails for a file that is not ambiguous.
      const isTest = p.includes('__tests__/') && p.endsWith('.test.ts');

      // 1. The repository layer itself — the code that is *supposed* to write.
      if (p.startsWith('lib/repositories/') && !isTest) of.push('repository');
      // 2. Readers: allowed to look, never to change. Checked above.
      if (NO_STATE_WRITE_REFERRERS.includes(rel)) of.push('no_state_write');
      // 3. Admin routes (component 5) — gated, audited, and allowed to write.
      if (!isTest && p.startsWith('app/api/admin/')) of.push('admin_route');
      // 3b. The module the admin routes delegate to. It holds the pre-checks and
      // the write calls; it is not a route, so it needs its own category rather
      // than being smuggled in as a "reader".
      if (!isTest && p === 'lib/business-os/entitlements/adminOps.ts') of.push('admin_ops');
      // 3c. The invite redemption's wiring (Slice 1b): one write, checked below.
      if (!isTest && p === INVITE_REDEMPTION_WIRING) of.push('invite_redemption');
      // 4. Tests, which name these symbols in order to assert on them.
      if (isTest) of.push('test');
      return of;
    };

    const misclassified = [...ALLOWED]
      .map((rel) => ({ file: rel.split(sep).join('/'), categories: category(rel) }))
      .filter((entry) => entry.categories.length !== 1);

    // If this fails: say which of the four the new file is. If it is none of
    // them, it does not belong in ALLOWED.
    expect(misclassified).toEqual([]);
  });

  it('Slices 1b/5b (F-8, T-19): the invite redemption wiring calls the two finalise writes and NO other plan-state write', () => {
    const source = readFileSync(join(ROOT, ...INVITE_REDEMPTION_WIRING.split('/')), 'utf8');
    for (const write of INVITE_REDEMPTION_WRITES) {
      expect(source).toMatch(new RegExp(`\\.${write}\\s*\\(`));
    }
    for (const method of WRITE_METHODS.filter((name) => !INVITE_REDEMPTION_WRITES.includes(name))) {
      expect(source).not.toMatch(new RegExp(`\\.${method}\\s*\\(`));
    }
  });

  it('Slice 6a (W6-1): the owner credit card wiring calls findPeriodAnchor on the plan repository and NOTHING else', () => {
    const source = readFileSync(join(ROOT, ...OWNER_CREDIT_CARD_WIRING.split('/')), 'utf8');
    const calls = [...source.matchAll(/businessOsAccountPlanRepository\s*\.\s*(\w+)\s*\(/g)].map((m) => m[1]);
    expect(calls).toEqual([OWNER_CREDIT_CARD_METHOD]);
    // The rule is not vacuous: it would see a second method.
    const planted = 'businessOsAccountPlanRepository.findPeriodAnchor(a); businessOsAccountPlanRepository.updatePlan(b)';
    expect([...planted.matchAll(/businessOsAccountPlanRepository\s*\.\s*(\w+)\s*\(/g)].map((m) => m[1])).toEqual([
      'findPeriodAnchor',
      'updatePlan',
    ]);
  });

  it('Slice 11c: the admin credit view wiring calls findPeriodAnchor on the plan repository and NOTHING else', () => {
    const source = readFileSync(join(ROOT, ...ADMIN_CREDIT_VIEW_WIRING.split('/')), 'utf8');
    const calls = [...source.matchAll(/businessOsAccountPlanRepository\s*\.\s*(\w+)\s*\(/g)].map((m) => m[1]);
    expect(calls).toEqual([OWNER_CREDIT_CARD_METHOD]);
  });

  it('the allowed list names files that exist', () => {
    // A stale entry would silently widen the guard.
    const existing = new Set(files.map((file) => relative(ROOT, file)));
    const missing = [...ALLOWED].filter((rel) => !existing.has(rel));
    expect(missing).toEqual([]);
  });
});
