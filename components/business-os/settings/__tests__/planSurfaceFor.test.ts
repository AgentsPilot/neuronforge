/**
 * @jest-environment node
 *
 * UM-D3 (SA R-1, condition D3-1): which "Your plan" surface Settings opens, for
 * every account state of requirement §2.2, on REAL `my-plan` payloads. And the
 * UM-3 CV-5 subheading (SA Q-2 / Y-8): `upgrade` only in the `settings`
 * variant, only when a column's action is the server's upgrade offer.
 */

import { planSurfaceFor, upgradeModalView } from '@/components/business-os/settings/upgradeModalView';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

import { FOUNDING_PARTNER, LOWER, TOP, TRIAL, inSixtyDays, payingRow, payloadFor } from './upgradeModalPayloads';

const pastDue = (overrides: Record<string, unknown> = {}) => ({
  livemode: false,
  stripeSubscriptionId: 'sub_probe',
  subscriptionStatus: 'past_due',
  boughtTier: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2099-11-12T22:30:00.000Z',
  failedAttempts: 2,
  lastPaymentFailedAt: '2099-11-12T22:30:00.000Z',
  actionRequiredInvoiceUrl: null,
  endedAt: null,
  ...overrides,
});

describe('planSurfaceFor (D3-1): the pop-up exactly when the server offers something', () => {
  it.each([
    ['Trial (Test Flight)', () => payloadFor({ planId: TRIAL }), 'modal'],
    ['Founding Partner with an end date', () => payloadFor({ planId: FOUNDING_PARTNER, cohortExpiresAt: inSixtyDays() }), 'modal'],
    ['Essentials, renewing (upgrade offered)', () => payloadFor({ billingRow: payingRow(LOWER) }), 'modal'],
    ['admin-assigned tier offered "Pay for" its own plan', () => payloadFor({ planId: LOWER, buyable: [LOWER] }), 'modal'],
    ['Founding Partner, no end date (BQ-P10: nothing offered)', () => payloadFor({ planId: FOUNDING_PARTNER }), 'drawer'],
    ['Autopilot, renewing (the top plan)', () => payloadFor({ planId: TOP, billingRow: payingRow(TOP) }), 'drawer'],
  ] as const)('%s → %s', async (_name, make, expected) => {
    const payload = await make();
    const view = upgradeModalView(payload);
    // The rule is the view's own predicate, nothing else (R-1).
    expect(view.available && view.hasActions).toBe(expected === 'modal');
    expect(planSurfaceFor(payload, false)).toBe(expected);
  });

  it('Essentials, cancelling, and an ended / past-due record: whatever the server offers decides', async () => {
    for (const payload of [
      await payloadFor({ billingRow: payingRow(LOWER, { cancelAtPeriodEnd: true }) }),
      await payloadFor({ billingRow: pastDue() }),
      await payloadFor({ billingRow: pastDue({ subscriptionStatus: 'canceled', endedAt: '2026-01-01T00:00:00.000Z' }) }),
    ]) {
      const view = upgradeModalView(payload);
      expect(planSurfaceFor(payload, false)).toBe(view.available && view.hasActions ? 'modal' : 'drawer');
    }
  });

  it('a refused state (no purchase view, or upgrade withheld) → the drawer', async () => {
    const essentials = await payloadFor({ billingRow: payingRow(LOWER) });
    expect(planSurfaceFor({ ...essentials, purchase: null }, false)).toBe('drawer');
    expect(planSurfaceFor({ ...essentials, purchase: { ...essentials.purchase!, upgrade: null } }, false)).toBe('drawer');
  });

  it('a plan that is not ok, or no comparison, or no answer at all → the drawer (R-4)', async () => {
    const trial = await payloadFor({ planId: TRIAL });
    expect(planSurfaceFor({ ...trial, status: 'unavailable' } as PlanPayload, false)).toBe('drawer');
    expect(planSurfaceFor({ ...trial, comparison: undefined }, false)).toBe('drawer');
    expect(planSurfaceFor(null, false)).toBe('drawer');
  });

  it('a checkout return marker always opens the pop-up, whatever the answer (R-7)', async () => {
    const top = await payloadFor({ planId: TOP, billingRow: payingRow(TOP) });
    expect(planSurfaceFor(top, true)).toBe('modal');
    expect(planSurfaceFor(null, true)).toBe('modal');
  });

  it('a stale "Stripe key missing" state still opens the pop-up (it says "not set up" itself, R-1)', async () => {
    // The key is a browser-side check (`usePlanFlow`), so the payload alone decides.
    expect(planSurfaceFor(await payloadFor({ planId: TRIAL }), false)).toBe('modal');
  });
});

describe('UM-3 CV-5: the upgrade subheading (Y-8)', () => {
  it('Essentials in settings → upgrade; every other variant keeps its own', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    expect(upgradeModalView(payload).subheading).toBe('upgrade');
    expect(upgradeModalView(payload, { kind: 'locked_feature', planId: TOP }).subheading).toBe('locked_feature');
  });

  it('no upgrade action → the default subheading (trial chooses, Autopilot, Founding Partner)', async () => {
    for (const payload of [
      await payloadFor({ planId: TRIAL }),
      await payloadFor({ planId: TOP, billingRow: payingRow(TOP) }),
      await payloadFor({ planId: FOUNDING_PARTNER }),
    ]) {
      const view = upgradeModalView(payload);
      expect(view.columns.some((entry) => entry.action === 'upgrade')).toBe(false);
      expect(view.subheading).toBe('default');
    }
  });

  it('the same payload with the upgrade withheld → default (the server offer, not the plan, decides)', async () => {
    const payload = await payloadFor({ billingRow: payingRow(LOWER) });
    expect(upgradeModalView({ ...payload, purchase: { ...payload.purchase!, upgrade: null } }).subheading).toBe('default');
  });
});
