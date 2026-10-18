/**
 * The MRR rule (plan payments P-8a.1, workplan §4; AC-AM.2, AC-P8a.1 to
 * AC-P8a.3). Every row of the §4 table, the currency rule and the BQ-P8a-4
 * switch. Pure: no mocks.
 *
 * Tier ids here are made-up placeholders, not configured tiers. The rule takes
 * the price as a parameter, so it never needs to know which tiers exist.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  MRR_COUNTS_PAST_DUE,
  computeMrr,
  mrrTreatment,
  type MrrBillingRow,
  type MrrInputs,
  type MrrPrice,
} from '../planMrr';

const PRICES: Record<string, MrrPrice> = {
  tier_low: { currency: 'USD', monthlyHundredths: 7900 },
  tier_high: { currency: 'USD', monthlyHundredths: 12900 },
  tier_eur: { currency: 'EUR', monthlyHundredths: 5000 },
};
const priceOf = (tier: string): MrrPrice | null => PRICES[tier] ?? null;
const TEST_MODE: MrrInputs = { livemode: false, priceOf };

function row(patch: Partial<MrrBillingRow> = {}): MrrBillingRow {
  return {
    livemode: false,
    subscription_status: 'active',
    ended_at: null,
    cancel_at_period_end: false,
    bought_tier: 'tier_low',
    founder_discount_applied_at: null,
    ...patch,
  };
}

describe('mrrTreatment: each kind of account (workplan §4)', () => {
  it('an active subscription counts at the list price of its bought tier', () => {
    expect(mrrTreatment(row(), TEST_MODE)).toEqual({
      kind: 'counted',
      price: PRICES.tier_low,
      cancelling: false,
      pastDue: false,
    });
  });

  it('cancelling at period end still counts, flagged as cancelling (BQ-P8a-3)', () => {
    expect(mrrTreatment(row({ cancel_at_period_end: true }), TEST_MODE)).toMatchObject({ kind: 'counted', cancelling: true });
  });

  it('past_due counts by default, flagged (BQ-P8a-4 default)', () => {
    expect(MRR_COUNTS_PAST_DUE).toBe(true);
    expect(mrrTreatment(row({ subscription_status: 'past_due' }), TEST_MODE)).toMatchObject({ kind: 'counted', pastDue: true });
  });

  it('the BQ-P8a-4 switch excludes past_due when off, and nothing else', () => {
    const off = { ...TEST_MODE, countPastDue: false };
    expect(mrrTreatment(row({ subscription_status: 'past_due' }), off)).toEqual({ kind: 'not_paying' });
    expect(mrrTreatment(row(), off)).toMatchObject({ kind: 'counted' });
  });

  it.each(['trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', 'canceled'])(
    '%s is not counted',
    (status) => {
      expect(mrrTreatment(row({ subscription_status: status }), TEST_MODE)).toEqual({ kind: 'not_paying' });
    }
  );

  it('an ended subscription is not counted, whatever its status says', () => {
    expect(mrrTreatment(row({ ended_at: '2026-10-01T00:00:00.000Z' }), TEST_MODE)).toEqual({ kind: 'not_paying' });
  });

  it('a row with no subscription (no status) is not counted: a comp or an abandoned checkout', () => {
    expect(mrrTreatment(row({ subscription_status: null }), TEST_MODE)).toEqual({ kind: 'not_paying' });
  });

  it('a row of the other mode is never money (PF-15), in both directions', () => {
    expect(mrrTreatment(row({ livemode: true }), TEST_MODE)).toEqual({ kind: 'other_mode' });
    expect(mrrTreatment(row({ livemode: false }), { livemode: true, priceOf })).toEqual({ kind: 'other_mode' });
  });

  it('a founder discount is never counted at list price (BQ-P8a-2, until P-11)', () => {
    expect(mrrTreatment(row({ founder_discount_applied_at: '2026-10-01T00:00:00.000Z' }), TEST_MODE)).toEqual({
      kind: 'discount_unknown',
    });
  });

  it('a tier with no monthly price, or no tier, is unpriced: never 0, never guessed', () => {
    expect(mrrTreatment(row({ bought_tier: 'retired_tier' }), TEST_MODE)).toEqual({ kind: 'unpriced' });
    expect(mrrTreatment(row({ bought_tier: null }), TEST_MODE)).toEqual({ kind: 'unpriced' });
    const bad = { ...TEST_MODE, priceOf: () => ({ currency: 'USD', monthlyHundredths: 79.5 }) };
    expect(mrrTreatment(row(), bad)).toEqual({ kind: 'unpriced' });
  });
});

describe('computeMrr', () => {
  it('sums one currency, with the cancelling and past-due parts inside the total', () => {
    const result = computeMrr(
      [
        row(),
        row({ bought_tier: 'tier_high' }),
        row({ cancel_at_period_end: true }),
        row({ subscription_status: 'past_due', bought_tier: 'tier_high' }),
        row({ subscription_status: 'trialing' }),
      ],
      TEST_MODE
    );
    expect(result.lines).toEqual([
      {
        currency: 'USD',
        totalHundredths: 7900 + 12900 + 7900 + 12900,
        cancellingHundredths: 7900,
        pastDueHundredths: 12900,
        subscriptions: 4,
        overflow: false,
      },
    ]);
    expect(result).toMatchObject({ unpriced: 0, discountUnknown: 0, otherModeExcluded: 0, pastDueCounted: true });
  });

  it('never adds two currencies together (AC-P8a.2): one line each, sorted by code', () => {
    const result = computeMrr([row(), row({ bought_tier: 'tier_eur' }), row({ bought_tier: 'tier_high' })], TEST_MODE);
    expect(result.lines.map((l) => [l.currency, l.totalHundredths, l.subscriptions])).toEqual([
      ['EUR', 5000, 1],
      ['USD', 7900 + 12900, 2],
    ]);
  });

  it('counts other-mode rows without summing them (AC-P8a.3)', () => {
    const result = computeMrr([row(), row({ livemode: true }), row({ livemode: true, bought_tier: 'tier_high' })], TEST_MODE);
    expect(result.otherModeExcluded).toBe(2);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].totalHundredths).toBe(7900);
  });

  it('reports unpriced and discounted rows as counts, outside every line', () => {
    const result = computeMrr(
      [row({ bought_tier: 'retired_tier' }), row({ founder_discount_applied_at: '2026-10-01T00:00:00.000Z' })],
      TEST_MODE
    );
    expect(result).toEqual({ lines: [], unpriced: 1, discountUnknown: 1, otherModeExcluded: 0, pastDueCounted: true });
  });

  it('says whether past_due was counted', () => {
    expect(computeMrr([], { ...TEST_MODE, countPastDue: false }).pastDueCounted).toBe(false);
  });

  it('no rows: no lines, never a zero line in a currency nobody pays in', () => {
    expect(computeMrr([], TEST_MODE).lines).toEqual([]);
  });
});

describe('source rules (placement, SA-WP-P8a)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'planMrr.ts'), 'utf8');
  const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

  it('imports no data layer and no entitlements module', () => {
    expect(imports).toEqual([
      '@/lib/business-os/billing/payingSubscriptionStatuses',
      '@/lib/business-os/finance/currencyGroups',
    ]);
  });

  it('the BQ-P8a-4 switch is declared exactly once', () => {
    expect(source.match(/export const MRR_COUNTS_PAST_DUE = (true|false);/g)).toHaveLength(1);
  });
});
