/**
 * `planManageOffer` / `planManageWire` (plan payments P-7a.1; workplan §4.1;
 * SA C-1, TQ-14): the one predicate behind the Cancel / Reactivate buttons and
 * the routes' our-data step. Every rule, in its order.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { planManageOffer, planManageWire, type PlanManageFacts } from '@/lib/business-os/billing/planManageOffer';

const NOW = new Date('2026-10-26T10:00:00.000Z');
const FUTURE = '2026-11-26T10:00:00.000Z';
const PAST = '2026-10-25T10:00:00.000Z';
const ON = { pricesEnabled: true };

function facts(overrides: Partial<PlanManageFacts> = {}): PlanManageFacts {
  return {
    stripeSubscriptionId: 'sub_1',
    subscriptionStatus: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: FUTURE,
    endedAt: null,
    failedAttempts: 0,
    ...overrides,
  };
}

describe('planManageOffer', () => {
  it('C-1: the price switch off offers nothing, whatever the row', () => {
    expect(planManageOffer(facts(), { pricesEnabled: false }, NOW)).toEqual({ kind: 'none', reason: 'switch_off' });
    expect(planManageWire(planManageOffer(facts(), { pricesEnabled: false }, NOW))).toBeNull();
  });

  it('no row, or no subscription id → not_subscribed', () => {
    expect(planManageOffer(null, ON, NOW)).toEqual({ kind: 'none', reason: 'not_subscribed' });
    expect(planManageOffer(facts({ stripeSubscriptionId: null }), ON, NOW)).toEqual({ kind: 'none', reason: 'not_subscribed' });
  });

  it('ended, or a status that does not renew → not_active', () => {
    expect(planManageOffer(facts({ endedAt: PAST }), ON, NOW)).toEqual({ kind: 'none', reason: 'not_active' });
    for (const status of ['canceled', 'incomplete', 'incomplete_expired', 'paused', null, 'something_new']) {
      expect(planManageOffer(facts({ subscriptionStatus: status }), ON, NOW)).toEqual({ kind: 'none', reason: 'not_active' });
    }
  });

  it('a renewal failure open → payment_failed (the column OR the status branch)', () => {
    expect(planManageOffer(facts({ subscriptionStatus: 'past_due' }), ON, NOW)).toEqual({ kind: 'none', reason: 'payment_failed' });
    expect(planManageOffer(facts({ subscriptionStatus: 'unpaid' }), ON, NOW)).toEqual({ kind: 'none', reason: 'payment_failed' });
    expect(planManageOffer(facts({ failedAttempts: 1 }), ON, NOW)).toEqual({ kind: 'none', reason: 'payment_failed' });
    expect(planManageWire({ kind: 'none', reason: 'payment_failed' })).toEqual({ cancel: false, reactivate: false, paymentFailed: true });
  });

  it('active, renewing → cancel', () => {
    const offer = planManageOffer(facts(), ON, NOW);
    expect(offer).toEqual({ kind: 'renewing' });
    expect(planManageWire(offer)).toEqual({ cancel: true, reactivate: false, paymentFailed: false });
  });

  it('TQ-14: trialing behaves as active (a matrix row P-11 inherits)', () => {
    expect(planManageOffer(facts({ subscriptionStatus: 'trialing' }), ON, NOW)).toEqual({ kind: 'renewing' });
    expect(planManageOffer(facts({ subscriptionStatus: 'trialing', cancelAtPeriodEnd: true }), ON, NOW)).toEqual({ kind: 'cancelling' });
  });

  it('set to end with the end ahead → reactivate', () => {
    const offer = planManageOffer(facts({ cancelAtPeriodEnd: true }), ON, NOW);
    expect(offer).toEqual({ kind: 'cancelling' });
    expect(planManageWire(offer)).toEqual({ cancel: false, reactivate: true, paymentFailed: false });
  });

  it('set to end with the end passed or unreadable → period_over (buy again instead)', () => {
    expect(planManageOffer(facts({ cancelAtPeriodEnd: true, currentPeriodEnd: PAST }), ON, NOW)).toEqual({ kind: 'none', reason: 'period_over' });
    expect(planManageOffer(facts({ cancelAtPeriodEnd: true, currentPeriodEnd: null }), ON, NOW)).toEqual({ kind: 'none', reason: 'period_over' });
    expect(planManageOffer(facts({ cancelAtPeriodEnd: true, currentPeriodEnd: 'not a date' }), ON, NOW)).toEqual({ kind: 'none', reason: 'period_over' });
  });

  it('nothing to show → the wire is null (older payloads unchanged)', () => {
    for (const reason of ['switch_off', 'not_subscribed', 'not_active', 'period_over'] as const) {
      expect(planManageWire({ kind: 'none', reason })).toBeNull();
    }
  });

  it('the module imports nothing (pure, client-safe shape; no entitlements import)', () => {
    const source = readFileSync(join(process.cwd(), 'lib/business-os/billing/planManageOffer.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
