/**
 * The paying-status set of the finance page (slice 1a, SA-Q5, SA-W2 option B).
 *
 * Pinned: the exact set; that it is its own list and not the checkout's or the
 * deletion refusal's; that every member is a status the database can hold
 * (read from the migration's CHECK list at runtime — ts-jest does not
 * type-check, so a type annotation would prove nothing here); and that an
 * ended row is never paying.
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { PAYING_SUBSCRIPTION_STATUSES, isPayingBillingRow } from '../payingSubscriptionStatuses';
import { LIVE_SUBSCRIPTION_STATUSES } from '../planCheckout';
import { R3_LIVE_STATUSES } from '../../purge/adminDeletionRefusals';

const MIGRATION = path.join(process.cwd(), 'supabase', 'migrations', '20261025_business_os_billing_accounts.sql');

/** The statuses the CHECK `business_os_billing_accounts_status_known` allows. */
function checkListStatuses(): string[] {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const match = sql.match(/business_os_billing_accounts_status_known CHECK \([^)]*IN \(([^)]*)\)/);
  if (!match) throw new Error('status_known CHECK not found in the migration');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('PAYING_SUBSCRIPTION_STATUSES', () => {
  it('is exactly active and past_due', () => {
    expect([...PAYING_SUBSCRIPTION_STATUSES]).toEqual(['active', 'past_due']);
  });

  it('the CHECK-list reader really reads the list (non-vacuity)', () => {
    expect(checkListStatuses()).toEqual([
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'paused',
    ]);
  });

  it('every member is a status the migration CHECK allows (SA-W2: runtime check in place of a type)', () => {
    const allowed = checkListStatuses();
    for (const status of PAYING_SUBSCRIPTION_STATUSES) expect(allowed).toContain(status);
  });

  it('is its own set: not the checkout live set nor the deletion R-3 set, and not a reference to either', () => {
    expect(PAYING_SUBSCRIPTION_STATUSES).not.toBe(LIVE_SUBSCRIPTION_STATUSES);
    expect(PAYING_SUBSCRIPTION_STATUSES).not.toBe(R3_LIVE_STATUSES);
    expect([...PAYING_SUBSCRIPTION_STATUSES].sort()).not.toEqual([...LIVE_SUBSCRIPTION_STATUSES].sort());
    expect([...PAYING_SUBSCRIPTION_STATUSES].sort()).not.toEqual([...R3_LIVE_STATUSES].sort());
  });

  it('the source imports nothing from the data layer and never names it (routerPlacement M-1)', () => {
    const text = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'business-os', 'billing', 'payingSubscriptionStatuses.ts'),
      'utf8'
    );
    expect(text).not.toMatch(/supabase/i);
    expect(text).not.toMatch(/\.from\(/);
    expect(text).not.toMatch(/lib\/repositories/);
    // No import statement at all (the comment may say the word).
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\brequire\(/);
  });
});

describe('isPayingBillingRow', () => {
  it.each([
    ['active', null, true],
    ['past_due', null, true],
    ['active', '2026-10-01T00:00:00Z', false],
    ['past_due', '2026-10-01T00:00:00Z', false],
    ['trialing', null, false],
    ['unpaid', null, false],
    ['incomplete', null, false],
    ['paused', null, false],
    ['canceled', null, false],
    [null, null, false],
  ])('status %p, ended_at %p → %p', (subscription_status, ended_at, expected) => {
    expect(isPayingBillingRow({ subscription_status, ended_at })).toBe(expected);
  });
});
