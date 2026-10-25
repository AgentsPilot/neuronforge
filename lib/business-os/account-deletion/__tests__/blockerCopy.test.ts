/**
 * Guard rows → plain-word blocker codes (data export DE-10b.2, workplan §2.5,
 * §4.1). The guard list is read from the generated function, so a new guard
 * without a mapping fails here.
 */

import fs from 'fs';
import path from 'path';
import { BLOCKER_CODES, GUARD_CODES, blockerCodeOf, toBlockerViews, willKeepBilling } from '../blockerCopy';
import { FUNCTION_MIGRATION } from '../../../../scripts/generate-test-account-cleanup-sql';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FUNCTION_SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', `${FUNCTION_MIGRATION}.sql`), 'utf-8');
const EMITTED_GUARDS = [...new Set([...FUNCTION_SQL.matchAll(/'(G-\d+[a-z]?)'::text AS guard/g)].map((m) => m[1]))];

describe('guard coverage', () => {
  it('reads the guards of the generated function (not vacuous)', () => {
    expect(EMITTED_GUARDS.length).toBeGreaterThanOrEqual(20);
    expect(EMITTED_GUARDS).toEqual(expect.arrayContaining(['G-6', 'G-8', 'G-9', 'G-12', 'G-22']));
  });

  it('every guard the function can emit has a mapping', () => {
    expect(EMITTED_GUARDS.filter((guard) => !(guard in GUARD_CODES))).toEqual([]);
  });

  it('an unknown guard fails safe to contact_support', () => {
    expect(blockerCodeOf({ guard: 'G-99' })).toBe('contact_support');
    expect(blockerCodeOf({ guard: 'something else' })).toBe('contact_support');
    expect(blockerCodeOf({ guard: '__proto__' })).toBe('contact_support');
  });
});

describe('the customer blockers (TL-6, NBQ-5)', () => {
  it('G-6 → plan_running, G-8 → stripe_connected, G-4 → admin_account', () => {
    expect(blockerCodeOf({ guard: 'G-6' })).toBe('plan_running');
    expect(blockerCodeOf({ guard: 'G-8' })).toBe('stripe_connected');
    expect(blockerCodeOf({ guard: 'G-4' })).toBe('admin_account');
  });

  it('the G-9 rows, by the item text the function writes', () => {
    const items = [...FUNCTION_SQL.matchAll(/'G-9'::text AS guard, '([^']+)'::text AS item/g)].map((m) => m[1]);
    expect(items).toEqual(expect.arrayContaining(['money in flight: recurring payment plan(s) still running']));
    expect(blockerCodeOf({ guard: 'G-9', item: 'money in flight: recurring payment plan(s) still running' })).toBe('client_plans_running');
    expect(blockerCodeOf({ guard: 'G-9', item: 'money in flight: payment(s) still pending' })).toBe('client_payments_pending');
    expect(blockerCodeOf({ guard: 'G-9', item: 'money in flight: refund(s) still in flight' })).toBe('client_payments_pending');
    expect(blockerCodeOf({ guard: 'G-9' })).toBe('contact_support');
  });

  it('G-12 (files) is never shown: the storage step clears it', () => {
    expect(blockerCodeOf({ guard: 'G-12' })).toBeNull();
    expect(toBlockerViews([{ guard: 'G-12', found: 3 }])).toEqual([]);
  });

  it('views: once each, fixed order, summed counts only where the copy names a number', () => {
    expect(
      toBlockerViews([
        { guard: 'G-17', item: 'x', found: 1 },
        { guard: 'G-9', item: 'money in flight: payment(s) still pending', found: 2 },
        { guard: 'G-9', item: 'money in flight: refund(s) still in flight', found: 1 },
        { guard: 'G-8', found: 1 },
        { guard: 'G-10', item: 'y', found: 1 },
        { guard: 'G-6', found: 1 },
      ])
    ).toEqual([
      { code: 'plan_running' },
      { code: 'stripe_connected' },
      { code: 'client_payments_pending', count: 3 },
      { code: 'contact_support' },
    ]);
  });

  it('a guard id list without rows (the refusal after the check) still maps', () => {
    expect(toBlockerViews([{ guard: 'G-8' }, { guard: 'G-9' }])).toEqual([{ code: 'stripe_connected' }, { code: 'contact_support' }]);
  });

  it('BLOCKER_CODES is the copy key list', () => {
    expect([...BLOCKER_CODES]).toEqual([
      'plan_running',
      'stripe_connected',
      'client_plans_running',
      'client_payments_pending',
      'admin_account',
      'contact_support',
    ]);
  });
});

describe('willKeepBilling', () => {
  it('true for a G-5 or a G-7 note', () => {
    expect(willKeepBilling([{ guard: 'G-5', found: 2 }])).toBe(true);
    expect(willKeepBilling([{ guard: 'G-7', found: 1 }])).toBe(true);
  });

  it('false for the other notes (sent invoice, consent rows, invite circle)', () => {
    expect(willKeepBilling([{ guard: 'G-9', found: 1 }, { guard: 'G-14', found: 4 }, { guard: 'G-15', found: 1 }])).toBe(false);
    expect(willKeepBilling([])).toBe(false);
  });
});
