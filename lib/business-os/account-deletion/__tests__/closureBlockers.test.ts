/**
 * Blockers at stage A (DL-1b; requirement XC-5; workplan §9, T-7; SA W-4,
 * Q-14). The guard list is read from the generated function, so a new guard
 * without a classification fails here, as `blockerCopy`'s test does.
 */

import fs from 'fs';
import path from 'path';
import { REQUEST_GUARD_CLASS, requestBlockers } from '../closureBlockers';
import { GUARD_CODES, toBlockerViews } from '../blockerCopy';
import { FUNCTION_MIGRATION } from '../../../../scripts/generate-test-account-cleanup-sql';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FUNCTION_SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', `${FUNCTION_MIGRATION}.sql`), 'utf-8');
const EMITTED_GUARDS = [...new Set([...FUNCTION_SQL.matchAll(/'(G-\d+[a-z]?)'::text AS guard/g)].map((m) => m[1]))];

const ok = { verdictBlocked: false, resolvedThisLogin: true };
const blocked = { verdictBlocked: true, resolvedThisLogin: true };
const run = (rows: Array<{ guard: string; item?: string; found?: number }>, facts = blocked) => requestBlockers({ rows, ...facts });

describe('classification coverage (T-7)', () => {
  it('reads the guards of the generated function (not vacuous)', () => {
    expect(EMITTED_GUARDS.length).toBeGreaterThanOrEqual(20);
  });

  it('every guard the function can emit, and every guard with copy, has a stage-A classification', () => {
    expect(EMITTED_GUARDS.filter((guard) => !(guard in REQUEST_GUARD_CLASS))).toEqual([]);
    expect(Object.keys(GUARD_CODES).filter((guard) => !(guard in REQUEST_GUARD_CLASS))).toEqual([]);
  });
});

describe('what does NOT block at A (XC-5, W-4)', () => {
  it.each([
    ['G-6 alone (a plan running)', [{ guard: 'G-6', found: 1 }]],
    ['G-12 alone (files)', [{ guard: 'G-12', item: 'files', found: 3 }]],
    ['G-6 + G-12', [{ guard: 'G-6', found: 1 }, { guard: 'G-12', found: 2 }]],
  ])('%s → not blocked, and never `unknown` (W-4)', (_label, rows) => {
    expect(run(rows)).toEqual({ blocking: [], engineering: [] });
  });

  it('the engineering guards do not block; they are listed for the log', () => {
    const ids = ['G-5', 'G-7', 'G-10', 'G-11', 'G-13', 'G-14', 'G-15', 'G-16', 'G-17', 'G-18', 'G-19', 'G-20', 'G-21', 'G-22'];
    const out = run(ids.map((guard) => ({ guard, item: 'x', found: 1 })));
    expect(out.blocking).toEqual([]);
    expect(out.engineering.sort()).toEqual([...ids].sort());
  });

  it('an OK verdict on this login with no rows → nothing', () => {
    expect(run([], ok)).toEqual({ blocking: [], engineering: [] });
  });
});

describe('what blocks at A, and how it reads (T-7)', () => {
  it('G-8 → stripe_connected; G-9 by item with counts; G-4 → admin_account', () => {
    const out = run([
      { guard: 'G-8', found: 1 },
      { guard: 'G-9', item: 'money in flight: recurring payment plan(s) still running', found: 2 },
      { guard: 'G-9', item: 'money in flight: payment(s) still pending', found: 1 },
      { guard: 'G-4', found: 1 },
      { guard: 'G-6', found: 1 },
      { guard: 'G-12', found: 4 },
      { guard: 'G-17', found: 1 },
    ]);
    expect(toBlockerViews(out.blocking)).toEqual([
      { code: 'stripe_connected' },
      { code: 'client_plans_running', count: 2 },
      { code: 'client_payments_pending', count: 1 },
      { code: 'admin_account' },
    ]);
    expect(out.engineering).toEqual(['G-17']);
  });

  it.each(['G-1', 'G-2', 'G-2a', 'G-3'])('identity guard %s → blocks as contact_support (Q-14)', (guard) => {
    expect(toBlockerViews(run([{ guard }]).blocking)).toEqual([{ code: 'contact_support' }]);
  });

  it('a G-9 row with item text the parser does not know → blocks as contact_support (fail closed)', () => {
    expect(toBlockerViews(run([{ guard: 'G-9', item: 'something new', found: 1 }]).blocking)).toEqual([{ code: 'contact_support' }]);
  });

  it('a guard id nobody classified → blocks (fail closed)', () => {
    expect(toBlockerViews(run([{ guard: 'G-99' }]).blocking)).toEqual([{ code: 'contact_support' }]);
  });

  it('the check resolved another login → unknown → contact_support, even with no rows', () => {
    const out = requestBlockers({ rows: [], verdictBlocked: false, resolvedThisLogin: false });
    expect(out.blocking).toEqual([{ guard: 'unknown' }]);
    expect(toBlockerViews(out.blocking)).toEqual([{ code: 'contact_support' }]);
  });

  it('BLOCKED with no row the parser read → unknown (a parser miss)', () => {
    expect(run([]).blocking).toEqual([{ guard: 'unknown' }]);
  });
});
