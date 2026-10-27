/**
 * `planCardAndInvoicesOffer` and the `cardAndInvoices` wire flag (plan
 * payments P-7a.2; workplan §4.1, §4.4, §4.5; SA C-1, BQ-1): the one predicate
 * behind "Update card" / "Invoices" on the screen and the portal and invoices
 * routes' our-data step.
 */

import { planCardAndInvoicesOffer, planManageWire } from '@/lib/business-os/billing/planManageOffer';

const ON = { pricesEnabled: true };
const OFF = { pricesEnabled: false };

describe('planCardAndInvoicesOffer', () => {
  it('a customer AND a subscription on our row, switch on → offered (ended subscriptions included)', () => {
    expect(planCardAndInvoicesOffer({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }, ON)).toBe(true);
  });

  it('C-1: the price switch off → never offered, whatever the row', () => {
    expect(planCardAndInvoicesOffer({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }, OFF)).toBe(false);
  });

  it('no row, no customer, or a customer from a checkout that never paid (no subscription) → not offered', () => {
    expect(planCardAndInvoicesOffer(null, ON)).toBe(false);
    expect(planCardAndInvoicesOffer({ stripeCustomerId: null, stripeSubscriptionId: 'sub_1' }, ON)).toBe(false);
    expect(planCardAndInvoicesOffer({ stripeCustomerId: 'cus_1', stripeSubscriptionId: null }, ON)).toBe(false);
    expect(planCardAndInvoicesOffer({ stripeCustomerId: '', stripeSubscriptionId: '' }, ON)).toBe(false);
  });
});

describe('planManageWire with cardAndInvoices', () => {
  it('rides along with Cancel / Reactivate / the failed-payment line', () => {
    expect(planManageWire({ kind: 'renewing' }, true)).toEqual({ cancel: true, reactivate: false, paymentFailed: false, cardAndInvoices: true });
    expect(planManageWire({ kind: 'cancelling' }, true)).toEqual({ cancel: false, reactivate: true, paymentFailed: false, cardAndInvoices: true });
    // P-7a.4: a failed renewal now offers Cancel (ends now).
    expect(planManageWire({ kind: 'failing' }, true)).toEqual({
      cancel: true,
      reactivate: false,
      paymentFailed: true,
      cardAndInvoices: true,
    });
  });

  it('may be the only control: an ended subscription still has its card and receipts', () => {
    expect(planManageWire({ kind: 'none', reason: 'not_active' }, true)).toEqual({
      cancel: false,
      reactivate: false,
      paymentFailed: false,
      cardAndInvoices: true,
    });
  });

  it('absent when false, so a payload from before P-7a.2 reads the same', () => {
    expect(planManageWire({ kind: 'renewing' })).toEqual({ cancel: true, reactivate: false, paymentFailed: false });
    expect(planManageWire({ kind: 'renewing' }, false)).not.toHaveProperty('cardAndInvoices');
    expect(planManageWire({ kind: 'none', reason: 'switch_off' }, false)).toBeNull();
  });
});
