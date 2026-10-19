/**
 * Money MK-4 (SA-2, BD-37, BQ-P8a-4): MRR now for the Finance payload. The
 * same billing rows give the SAME MRR here as on the Subscriptions list
 * (`buildSubscriptions`), because both call `subscriptionsMrr`. The real
 * entitlement config is used; tier ids come from it, never from literals.
 */

import type { AdminBillingRow, AdminBillingPanelRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { planMonthlyPriceUsd } from '@/lib/business-os/entitlements/planPresentation';
import { buildSubscriptions } from '../subscriptionsView';
import { readFinanceMrr, type FinanceMrrDeps } from '../financeMrr';

const config = getEntitlementConfig();
const LOW = config.tierOrder[0];
const HIGH = config.tierOrder[config.tierOrder.length - 1];
const hundredths = (tier: string) => Math.round(planMonthlyPriceUsd(config, tier) * 100);
const account = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

function billing(n: number, patch: Partial<AdminBillingRow> = {}): AdminBillingRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    user_id: account(n),
    livemode: false,
    subscription_status: 'active',
    bought_tier: LOW,
    current_period_end: '2026-11-01T00:00:00.000Z',
    cancel_at_period_end: false,
    pending_tier: null,
    last_paid_at: '2026-10-01T00:00:00.000Z',
    last_payment_failed_at: null,
    failed_attempts: 0,
    founder_discount_applied_at: null,
    ended_at: null,
    ...patch,
  };
}

/** A mix: active, past due (still counted), cancelling, a founder discount, ended, and no status. */
const TEST_ROWS: AdminBillingRow[] = [
  billing(1),
  billing(2, { bought_tier: HIGH, subscription_status: 'past_due' }),
  billing(3, { cancel_at_period_end: true }),
  billing(4, { founder_discount_applied_at: '2026-09-01T00:00:00.000Z' }),
  billing(5, { subscription_status: 'canceled', ended_at: '2026-09-30T00:00:00.000Z' }),
  billing(6, { subscription_status: null }),
];

function readerOver(rows: AdminBillingRow[]) {
  const calls: unknown[][] = [];
  const reader: NonNullable<FinanceMrrDeps['reader']> = {
    listBillingRowsForModeAllAccounts: async (livemode: boolean) => {
      calls.push(['all', livemode]);
      return { data: rows.filter((row) => row.livemode === livemode), error: null };
    },
    findBillingRowForAccount: async (accountId: string, livemode: boolean) => {
      calls.push(['one', accountId, livemode]);
      const row = rows.find((r) => r.user_id === accountId && r.livemode === livemode);
      return { data: row ? ({ ...row, stripe_customer_id: 'cus_x' } as AdminBillingPanelRow) : null, error: null };
    },
  };
  return { reader, calls };
}

describe('readFinanceMrr: the same MRR as the Subscriptions list (SA-2)', () => {
  it('all businesses: lines, unpriced, discount and past-due flag equal buildSubscriptions totals for the same rows', async () => {
    const { reader, calls } = readerOver(TEST_ROWS);
    const read = await readFinanceMrr(null, { reader, mode: () => 'test', config: () => config });
    const list = buildSubscriptions({ billingRows: TEST_ROWS, planRows: [], config, now: new Date('2026-10-19T00:00:00Z'), mode: 'test', status: null });

    expect(calls).toEqual([['all', false]]);
    expect(read.stripeMode).toBe('test');
    expect(read.mrr.status).toBe('ok');
    expect(read.mrr.lines).toEqual(list.totals.mrr);
    expect(read.mrr.unpriced).toBe(list.totals.mrrUnpriced);
    expect(read.mrr.discountUnknown).toBe(list.totals.mrrDiscountUnknown);
    expect(read.mrr.pastDueCounted).toBe(list.totals.mrrPastDueCounted);
  });

  it('BQ-P8a-4: past due is counted and shown apart; cancelling is shown apart; the discount is never priced', async () => {
    const { reader } = readerOver(TEST_ROWS);
    const { mrr } = await readFinanceMrr(null, { reader, mode: () => 'test', config: () => config });
    expect(mrr.lines).toEqual([
      {
        currency: 'USD',
        totalHundredths: hundredths(LOW) * 2 + hundredths(HIGH),
        cancellingHundredths: hundredths(LOW),
        pastDueHundredths: hundredths(HIGH),
        subscriptions: 3,
        overflow: false,
      },
    ]);
    expect(mrr.discountUnknown).toBe(1);
    expect(mrr.pastDueCounted).toBe(true);
  });

  it('PF-15 / BD-37: a live key reads the live rows only; test rows are never money then', async () => {
    const rows = [...TEST_ROWS, billing(7, { livemode: true, bought_tier: HIGH })];
    const { reader, calls } = readerOver(rows);
    const read = await readFinanceMrr(null, { reader, mode: () => 'live', config: () => config });
    expect(calls).toEqual([['all', true]]);
    expect(read.stripeMode).toBe('live');
    expect(read.mrr.lines).toEqual([
      { currency: 'USD', totalHundredths: hundredths(HIGH), cancellingHundredths: 0, pastDueHundredths: 0, subscriptions: 1, overflow: false },
    ]);
  });

  it('one business: read through findBillingRowForAccount with exactly that id, in the current mode', async () => {
    const { reader, calls } = readerOver(TEST_ROWS);
    const read = await readFinanceMrr(account(2), { reader, mode: () => 'test', config: () => config });
    expect(calls).toEqual([['one', account(2), false]]);
    expect(read.mrr.lines[0]).toEqual(expect.objectContaining({ totalHundredths: hundredths(HIGH), pastDueHundredths: hundredths(HIGH), subscriptions: 1 }));
  });

  it('one business with no row in this mode: ok with no line (no MRR), never unknown', async () => {
    const { reader } = readerOver(TEST_ROWS);
    const read = await readFinanceMrr(account(99), { reader, mode: () => 'test', config: () => config });
    expect(read.mrr).toEqual({ status: 'ok', lines: [], unpriced: 0, discountUnknown: 0, pastDueCounted: true });
  });

  it('an unknown key mode fails closed: unknown, no mode, zero reads', async () => {
    const { reader, calls } = readerOver(TEST_ROWS);
    const read = await readFinanceMrr(null, {
      reader,
      mode: () => {
        throw new Error('stripe_key_mode_unknown');
      },
      config: () => config,
    });
    expect(read).toEqual({ stripeMode: null, mrr: { status: 'unknown', lines: [], unpriced: 0, discountUnknown: 0, pastDueCounted: true } });
    expect(calls).toEqual([]);
  });

  it('a failed read is unknown with the mode kept; it never throws', async () => {
    const failing: NonNullable<FinanceMrrDeps['reader']> = {
      listBillingRowsForModeAllAccounts: async () => ({ data: null, error: new Error('boom') }),
      findBillingRowForAccount: async () => ({ data: null, error: new Error('boom') }),
    };
    for (const id of [null, account(1)]) {
      const read = await readFinanceMrr(id, { reader: failing, mode: () => 'test', config: () => config });
      expect(read.stripeMode).toBe('test');
      expect(read.mrr.status).toBe('unknown');
    }
  });

  it('a throwing reader is unknown too', async () => {
    const throwing: NonNullable<FinanceMrrDeps['reader']> = {
      listBillingRowsForModeAllAccounts: async () => {
        throw new Error('network');
      },
      findBillingRowForAccount: async () => {
        throw new Error('network');
      },
    };
    const read = await readFinanceMrr(null, { reader: throwing, mode: () => 'test', config: () => config });
    expect(read.mrr.status).toBe('unknown');
  });
});
