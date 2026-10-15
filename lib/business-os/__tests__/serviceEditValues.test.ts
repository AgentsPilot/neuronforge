/**
 * The rule that stops an edit from rewriting how a service is paid for.
 *
 * The bug these lock out was silent: the editor hardcoded `is_scheduled: true`
 * and `collection: 'invoice'` when loading a row, and the save wrote them back.
 * Nothing failed, nothing warned — a business changed a duration and its card
 * services became invoiced ones. So the tests that matter are the ones proving
 * a stored value SURVIVES.
 */

import { serviceShapeValues, collectionToPersist } from '../serviceEditValues';

describe('serviceShapeValues', () => {
  it('keeps a card-collected service card-collected', () => {
    // The exact regression: this used to come back as 'invoice'.
    expect(serviceShapeValues({ collection: 'online', price: 200 })).toEqual({
      is_scheduled: true,
      collection: 'online',
      sale_mode: 'direct',
    });
  });

  it('keeps a product a product', () => {
    // And this used to come back as an appointment.
    expect(serviceShapeValues({ is_scheduled: false, collection: 'online' })).toEqual({
      is_scheduled: false,
      collection: 'online',
      sale_mode: 'direct',
    });
  });

  it('keeps an invoiced service invoiced', () => {
    expect(serviceShapeValues({ collection: 'invoice' }).collection).toBe('invoice');
  });

  it('falls back for a row that predates these columns', () => {
    // Never said is not the same as said 'invoice' — but for a legacy row the
    // safe reading is the one that does not commit the business to a processor.
    expect(serviceShapeValues({})).toEqual({
      is_scheduled: true,
      collection: 'invoice',
      sale_mode: 'direct',
    });
    expect(serviceShapeValues({ is_scheduled: null, collection: null, sale_mode: null })).toEqual({
      is_scheduled: true,
      collection: 'invoice',
      sale_mode: 'direct',
    });
  });

  it('treats only an explicit false as a product', () => {
    expect(serviceShapeValues({ is_scheduled: true }).is_scheduled).toBe(true);
    expect(serviceShapeValues({ is_scheduled: null }).is_scheduled).toBe(true);
    expect(serviceShapeValues({ is_scheduled: false }).is_scheduled).toBe(false);
  });
});

/**
 * The same rule, for the third fact.
 *
 * A quoted service opened in the editor and saved back must still be quoted.
 * The failure mode is identical to the original bug and would be just as
 * silent: a contractor renames "kitchen refit", and it starts offering a Book
 * button with a price of nothing.
 */
describe('serviceShapeValues — sale_mode', () => {
  it('keeps a quoted service quoted', () => {
    expect(serviceShapeValues({ sale_mode: 'proposal' }).sale_mode).toBe('proposal');
    // Even when everything else about it looks like an ordinary appointment.
    expect(
      serviceShapeValues({ sale_mode: 'proposal', is_scheduled: true, collection: 'online', price: 2700 })
        .sale_mode
    ).toBe('proposal');
  });

  it('falls back to direct, never to proposal', () => {
    // Guessing 'proposal' would strip the price and the payment step from every
    // public surface for a service that sells perfectly well today.
    expect(serviceShapeValues({}).sale_mode).toBe('direct');
    expect(serviceShapeValues({ sale_mode: null }).sale_mode).toBe('direct');
  });

  it('is independent of the other two facts', () => {
    // A quoted service can be scheduled (a treatment plan) or not (a refit),
    // and a direct one can be either. No combination is disallowed.
    for (const scheduled of [true, false]) {
      for (const mode of ['direct', 'proposal'] as const) {
        const values = serviceShapeValues({ is_scheduled: scheduled, sale_mode: mode });
        expect(values.is_scheduled).toBe(scheduled);
        expect(values.sale_mode).toBe(mode);
      }
    }
  });
});

describe('collectionToPersist', () => {
  it('keeps the method on a priced service', () => {
    expect(collectionToPersist('online', 200)).toBe('online');
    expect(collectionToPersist('invoice', 0.5)).toBe('invoice');
  });

  it('clears it when the service is free', () => {
    // A stale 'online' on a free service would keep counting towards "this
    // business needs a payment processor". Zero is an answer: nothing is
    // charged, so there is nothing to collect.
    expect(collectionToPersist('online', 0)).toBeNull();
  });

  it('keeps it when the service is not priced YET, which is not the same thing', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * This case used to assert null, alongside the zero above. The concern
     * quoted there is real and unchanged — a FREE service must not demand a
     * processor — but null is not free.
     *
     * Onboarding creates every service as a placeholder with `price: null`,
     * meaning "not priced yet". Clearing the method for those meant an owner
     * who chose "they pay by card" had it written as null and read back as
     * "invoice" on the next open: the choice reverted, silently, on every
     * service a new account has.
     *
     * An owner knows they will invoice long before they know what to charge.
     * Keeping the answer is the whole point of asking.
     *
     * What acts on it still behaves: `journeyReadiness` requires
     * `(price || 0) > 0` before a card step appears, so an unpriced service
     * cannot send a client to a payment page. What it does affect is
     * `needs_stripe_connect`, and correctly — "when I price this, they will
     * pay by card" is exactly a reason to connect a processor.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(collectionToPersist('online', null)).toBe('online');
    expect(collectionToPersist('invoice', undefined)).toBe('invoice');
  });
});
