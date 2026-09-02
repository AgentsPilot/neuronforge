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
    });
  });

  it('keeps a product a product', () => {
    // And this used to come back as an appointment.
    expect(serviceShapeValues({ is_scheduled: false, collection: 'online' })).toEqual({
      is_scheduled: false,
      collection: 'online',
    });
  });

  it('keeps an invoiced service invoiced', () => {
    expect(serviceShapeValues({ collection: 'invoice' }).collection).toBe('invoice');
  });

  it('falls back for a row that predates these columns', () => {
    // Never said is not the same as said 'invoice' — but for a legacy row the
    // safe reading is the one that does not commit the business to a processor.
    expect(serviceShapeValues({})).toEqual({ is_scheduled: true, collection: 'invoice' });
    expect(serviceShapeValues({ is_scheduled: null, collection: null })).toEqual({
      is_scheduled: true,
      collection: 'invoice',
    });
  });

  it('treats only an explicit false as a product', () => {
    expect(serviceShapeValues({ is_scheduled: true }).is_scheduled).toBe(true);
    expect(serviceShapeValues({ is_scheduled: null }).is_scheduled).toBe(true);
    expect(serviceShapeValues({ is_scheduled: false }).is_scheduled).toBe(false);
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
