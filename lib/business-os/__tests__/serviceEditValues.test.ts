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
    // business needs a payment processor".
    expect(collectionToPersist('online', 0)).toBeNull();
    expect(collectionToPersist('online', null)).toBeNull();
    expect(collectionToPersist('invoice', undefined)).toBeNull();
  });
});
