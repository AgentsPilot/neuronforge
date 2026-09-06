/**
 * Reading a subscription off an invoice, asserted.
 *
 * The defect this replaces was invisible by construction. `invoice.subscription`
 * does not exist on the pinned API version — Stripe moved it into
 * `invoice.parent` — and every read of it went through a cast, so it returned
 * `undefined` without a type error and every caller quietly took its "not a
 * subscription" branch. A payment plan charged perfectly in Stripe and recorded
 * nothing at all locally.
 *
 * So the test that matters is the one that fails if someone reaches for the old
 * field again.
 */

import { subscriptionIdFromInvoice, subscriptionMetadataFromInvoice } from '../invoiceSubscription';
import type Stripe from 'stripe';

/** An invoice shaped the way this API version actually delivers one. */
function invoiceWithParent(subscription: string | { id: string }, metadata: Record<string, string> = {}) {
  return {
    id: 'in_1',
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription, metadata },
    },
  } as unknown as Stripe.Invoice;
}

describe('subscriptionIdFromInvoice', () => {
  it('reads the subscription from parent.subscription_details', () => {
    expect(subscriptionIdFromInvoice(invoiceWithParent('sub_live'))).toBe('sub_live');
  });

  it('reads it when the subscription is expanded to an object', () => {
    expect(subscriptionIdFromInvoice(invoiceWithParent({ id: 'sub_expanded' }))).toBe('sub_expanded');
  });

  it('returns null for a one-off invoice with no parent', () => {
    const oneOff = { id: 'in_2', parent: null } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(oneOff)).toBeNull();
  });

  it('returns null when the parent is a quote rather than a subscription', () => {
    const fromQuote = {
      id: 'in_3',
      parent: { type: 'quote_details', quote_details: { quote: 'qt_1' } },
    } as unknown as Stripe.Invoice;

    expect(subscriptionIdFromInvoice(fromQuote)).toBeNull();
  });

  it('still reads the legacy top-level field, for replayed pre-Basil events', () => {
    const legacy = { id: 'in_4', parent: null, subscription: 'sub_old' } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(legacy)).toBe('sub_old');
  });

  it('prefers the current field when an invoice somehow carries both', () => {
    const both = {
      id: 'in_5',
      parent: { subscription_details: { subscription: 'sub_new', metadata: {} } },
      subscription: 'sub_old',
    } as unknown as Stripe.Invoice;

    expect(subscriptionIdFromInvoice(both)).toBe('sub_new');
  });
});

describe('subscriptionMetadataFromInvoice', () => {
  it('returns the plan terms snapshotted at finalisation', () => {
    const invoice = invoiceWithParent('sub_1', {
      plan_count: '3',
      plan_total: '1000',
      owner_id: 'user_1',
    });

    expect(subscriptionMetadataFromInvoice(invoice)).toEqual({
      plan_count: '3',
      plan_total: '1000',
      owner_id: 'user_1',
    });
  });

  it('returns an empty object rather than throwing on a one-off invoice', () => {
    const oneOff = { id: 'in_6', parent: null } as unknown as Stripe.Invoice;
    expect(subscriptionMetadataFromInvoice(oneOff)).toEqual({});
  });
});
