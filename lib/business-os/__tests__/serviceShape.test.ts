/**
 * Changing the kind of a service clears what no longer applies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The bug this exists for, with the real row that caused it:
 *
 *   "חבילת טיפולים"  sale_mode=proposal  is_scheduled=false
 *                    price=100  collection=NULL  payment_type=full
 *
 * It had been a 100-shekel appointment. The owner changed it to a package sold
 * by quote, in the inline row editor — which blanked the collection method and
 * kept the price, while the full dialog would have blanked both.
 *
 * The row then said two contradictory things: the amount is agreed later, and
 * the amount is 100. The public booking route asks "does this take money",
 * read the leftover figure, and said yes; the client's page asks `journeySteps`,
 * which knows the service is quoted, and said no. So the client walked a
 * journey with no payment step, finished it, and the route sat waiting for a
 * payment nobody had been asked for. No booking, no contact, no email.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { serviceShapeFields } from '@/lib/business-os/serviceShape';
import type { ServiceShapeInput } from '@/lib/business-os/serviceShape';

/** A card-paid, scheduled appointment with an instalment plan on it. */
const paidAppointment: ServiceShapeInput = {
  saleMode: 'direct',
  isScheduled: true,
  price: 100,
  collection: 'online',
  paymentType: 'installments',
  installmentCount: 3,
  installmentFrequency: 'monthly',
  firstPaymentDue: 'on_booking',
  firstPaymentDays: 0,
  bufferMinutes: 15,
};

describe('a service that becomes a quote', () => {
  const quoted = () => serviceShapeFields({ ...paidAppointment, saleMode: 'proposal' });

  it('loses the price, which is what lost the booking', () => {
    /* 100 was the old figure. A quote settles its own amount. */
    expect(quoted().price).toBeNull();
  });

  it('loses the collection method, because there is no price to collect', () => {
    expect(quoted().collection).toBeNull();
  });

  it('and loses the instalment plan, which the row editor used to keep', () => {
    /*
     * `syncServicePaymentPlan` mirrors these into the `payment_plans` row the
     * client's dialog reads, so a quoted service carrying three instalments
     * would quote a schedule for an amount nobody had agreed.
     */
    expect(quoted().payment_type).toBe('full');
    expect(quoted().installment_count).toBe(1);
  });
});

describe('a service that stops being booked into an hour', () => {
  it('keeps no gap after a meeting it no longer has', () => {
    const product = serviceShapeFields({ ...paidAppointment, isScheduled: false });

    expect(product.buffer_minutes).toBe(0);
  });

  it('but keeps its price: a product is still sold', () => {
    const product = serviceShapeFields({ ...paidAppointment, isScheduled: false });

    expect(product.price).toBe(100);
    expect(product.collection).toBe('online');
  });
});

describe('a service that loses its price', () => {
  it('carries no collection method either', () => {
    /* Otherwise a service that went free keeps "by card", and every surface
       that reads collection draws a payment step for nothing. */
    const free = serviceShapeFields({ ...paidAppointment, price: 0 });

    expect(free.collection).toBeNull();
  });

  it('and no instalment plan, since there is nothing to split', () => {
    const free = serviceShapeFields({ ...paidAppointment, price: 0 });

    expect(free.payment_type).toBe('full');
    expect(free.installment_count).toBe(1);
  });

  it('with "not priced yet" kept distinct from "free"', () => {
    /* Collapsing null to 0 threw away the owner's answer on every unpriced
       service. Both carry no collection, and they are still different values. */
    expect(serviceShapeFields({ ...paidAppointment, price: null }).price).toBeNull();
    expect(serviceShapeFields({ ...paidAppointment, price: 0 }).price).toBe(0);
  });
});

describe('a service that changes nothing', () => {
  it('comes back exactly as it went in', () => {
    /* The rule only clears what stopped applying; it is not an opinion about
       services that are already coherent. */
    const same = serviceShapeFields(paidAppointment);

    expect(same).toEqual({
      price: 100,
      collection: 'online',
      payment_type: 'installments',
      installment_count: 3,
      installment_frequency: 'monthly',
      first_payment_due: 'on_booking',
      first_payment_days: 0,
      buffer_minutes: 15,
    });
  });
});

describe('the row that actually broke', () => {
  it('cannot be written again', () => {
    /*
     * Exactly what was in the database: quoted, unscheduled, still priced at
     * 100. Re-saved through either editor it comes out coherent, and the
     * booking route can no longer read money into it.
     */
    const repaired = serviceShapeFields({
      saleMode: 'proposal',
      isScheduled: false,
      price: 100,
      collection: null,
      paymentType: 'full',
      installmentCount: 1,
      installmentFrequency: 'monthly',
      firstPaymentDue: 'on_booking',
      firstPaymentDays: 0,
      bufferMinutes: 0,
    });

    expect(repaired.price).toBeNull();
    expect(repaired.collection).toBeNull();
  });
});
