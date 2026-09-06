/**
 * A booking's money, as one number.
 *
 * Three surfaces answered this differently and the owner could see them
 * disagree: a booking whose money had been fully returned still refused to be
 * deleted, saying "refund the payment first". Every case below is one of those
 * disagreements.
 */

import { bookingPaymentState, bookingHoldsMoney } from '../bookingPaymentState';

const paid = (amount: number, refunded = 0, status = 'succeeded') => ({
  amount,
  refunded_amount: refunded,
  status,
});

describe('bookingPaymentState', () => {
  it('reports a booking with no settled money as unpaid', () => {
    expect(bookingPaymentState([])).toMatchObject({ status: 'unpaid', netHeld: 0 });
    expect(bookingPaymentState([paid(200, 0, 'pending')])).toMatchObject({ status: 'unpaid' });
    expect(bookingPaymentState([paid(200, 0, 'failed')])).toMatchObject({ status: 'unpaid' });
  });

  it('adds up every payment on the booking, not just the newest', () => {
    // The plan case. Reading one transaction is what returned a twelfth of the
    // money and called the booking refunded.
    const periods = Array.from({ length: 12 }, () => paid(100));

    expect(bookingPaymentState(periods)).toMatchObject({
      collected: 1200,
      refunded: 0,
      netHeld: 1200,
      status: 'paid',
    });
  });

  it('is partially refunded while any money is still held', () => {
    expect(bookingPaymentState([paid(100, 100), paid(100, 0)])).toMatchObject({
      collected: 200,
      refunded: 100,
      netHeld: 100,
      status: 'partially_refunded',
    });
  });

  it('is refunded only when everything is back', () => {
    expect(bookingPaymentState([paid(100, 100, 'refunded'), paid(100, 100, 'refunded')])).toMatchObject({
      netHeld: 0,
      status: 'refunded',
    });
  });

  it('counts a fully refunded payment as money that arrived', () => {
    // `status` flips to 'refunded' on a full refund. Treating that as "never
    // paid" would make `collected` shrink and report the booking unpaid.
    expect(bookingPaymentState([paid(100, 100, 'refunded')])).toMatchObject({
      collected: 100,
      refunded: 100,
      status: 'refunded',
    });
  });

  it('does not leave a rounding crumb behind on an uneven split', () => {
    // 200 across three periods. Without rounding this leaves 0.000000000004
    // held, so the booking reads partially_refunded forever and can never be
    // deleted.
    const state = bookingPaymentState([
      paid(66.67, 66.67),
      paid(66.67, 66.67),
      paid(66.66, 66.66),
    ]);

    expect(state.netHeld).toBe(0);
    expect(state.status).toBe('refunded');
  });

  it('treats an over-refund as fully refunded rather than partial', () => {
    // Possible when a refund is issued from the Stripe dashboard against a
    // charge this platform recorded incompletely. Calling it partial would leave
    // the booking permanently undeletable.
    expect(bookingPaymentState([paid(100, 120)])).toMatchObject({
      netHeld: 0,
      status: 'refunded',
    });
  });

  it('reads string amounts, because Postgres numerics arrive as strings', () => {
    expect(bookingPaymentState([{ amount: '150.50', refunded_amount: '50.50', status: 'succeeded' }]))
      .toMatchObject({ collected: 150.5, refunded: 50.5, netHeld: 100 });
  });
});

describe('bookingHoldsMoney', () => {
  it('blocks a delete while money is held', () => {
    expect(bookingHoldsMoney([paid(100)])).toBe(true);
    expect(bookingHoldsMoney([paid(100, 40)])).toBe(true);
  });

  it('allows a delete once everything is refunded', () => {
    // The reported bug: this was answered from `payment_status`, which only one
    // of four refund paths ever wrote.
    expect(bookingHoldsMoney([paid(100, 100, 'refunded')])).toBe(false);
  });

  it('allows a delete when nothing ever settled', () => {
    expect(bookingHoldsMoney([])).toBe(false);
  });
});
