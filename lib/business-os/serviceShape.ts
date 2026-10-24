import type {
  FirstPaymentDue,
  InstallmentFrequency,
  PaymentType,
  ServiceCollection,
  ServiceSaleMode,
} from '@/lib/repositories/SchedulingRepository';

/**
 * The fields a service row must carry, given the kind of service it now is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * One row holds every kind of service: a price, a collection method, a meeting
 * length, an instalment plan. A quoted package uses some of those columns, a
 * card-paid appointment uses different ones, and they share the row.
 *
 * Saving writes only the fields the form was showing. Change the KIND of
 * service and the fields that stopped applying are not mentioned, so the
 * database keeps whatever they said before. A 100-shekel appointment switched
 * to a quoted package kept its 100, and the row then said two contradictory
 * things at once: the amount is agreed later, and the amount is 100.
 *
 * Something downstream then asks the simple question — does this take money? —
 * sees the leftover figure and answers yes, while the client's own page asks
 * `journeySteps`, which knows it is quoted, and answers no. The page showed no
 * payment step, the client finished, the server waited for a payment that was
 * never coming, and the booking was never written. No row, no contact, no
 * email.
 *
 * WHY IT IS SHARED
 *
 * Two screens edit a service. The full dialog blanked the price for a quote;
 * the inline row editor in the list blanked the collection method and kept the
 * price and the whole instalment configuration. Same action, two different
 * rows, depending on which screen the owner happened to use — and the row that
 * lost the booking went through the second one.
 *
 * So the rule is written once, here, and both call it. A third editor cannot
 * invent a third answer.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *
 * `duration_minutes` survives a service becoming unscheduled. Nothing reads it
 * for a product, so it is harmless where it sits, and clearing it would lose
 * the owner's number if they change their mind back. The same is not true of a
 * price, which is read.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface ServiceShapeInput {
  /** `proposal` is quoted: nothing is priced or collected until the quote. */
  saleMode: ServiceSaleMode | null | undefined;
  /** False for a product or package — nothing is booked into an hour. */
  isScheduled: boolean;
  /** Null means "not priced yet", which is not the same as zero. */
  price: number | null;
  collection: ServiceCollection | null;
  paymentType: PaymentType | null | undefined;
  installmentCount: number | null | undefined;
  installmentFrequency: InstallmentFrequency | null | undefined;
  firstPaymentDue: FirstPaymentDue | null | undefined;
  firstPaymentDays: number | null | undefined;
  bufferMinutes: number | null | undefined;
}

/** Exactly the columns whose value depends on the kind of service. */
export interface ServiceShapeFields {
  price: number | null;
  collection: ServiceCollection | null;
  payment_type: PaymentType;
  installment_count: number;
  installment_frequency: InstallmentFrequency;
  first_payment_due: FirstPaymentDue;
  first_payment_days: number;
  buffer_minutes: number;
}

/** What a service with no instalment arrangement says, column by column. */
const PAID_IN_ONE = {
  payment_type: 'full' as const,
  installment_count: 1,
  installment_frequency: 'monthly' as const,
  first_payment_due: 'on_booking' as const,
  first_payment_days: 0,
};

export function serviceShapeFields(input: ServiceShapeInput): ServiceShapeFields {
  const quoted = input.saleMode === 'proposal';

  /*
   * A quote settles the amount. Keeping the last figure the field held before
   * it went dead is how a quoted job ends up with a published price nobody
   * agreed to — and how the booking route comes to believe money is owed.
   */
  const price = quoted ? null : input.price;

  /*
   * How it is collected is a question about a price. With no price there is
   * nothing to collect, so a free or unpriced service carries no method —
   * otherwise a service that lost its price keeps "by card" and every surface
   * that reads collection draws a payment step for nothing.
   */
  const collection = quoted || price === null || price <= 0 ? null : input.collection;

  /*
   * An instalment plan is an arrangement about an agreed amount. A quote has
   * no agreed amount yet, and a service with no price has nothing to split.
   *
   * This is the part the row editor kept: a service switched to a quote went
   * on carrying `payment_type` and `installment_count`, and `syncServicePaymentPlan`
   * mirrors those into the `payment_plans` row the client's dialog reads.
   */
  const plan = price !== null && price > 0 && !quoted
    ? {
        payment_type: input.paymentType ?? PAID_IN_ONE.payment_type,
        installment_count: input.installmentCount ?? PAID_IN_ONE.installment_count,
        installment_frequency: input.installmentFrequency ?? PAID_IN_ONE.installment_frequency,
        first_payment_due: input.firstPaymentDue ?? PAID_IN_ONE.first_payment_due,
        first_payment_days: input.firstPaymentDays ?? PAID_IN_ONE.first_payment_days,
      }
    : PAID_IN_ONE;

  return {
    price,
    collection,
    ...plan,
    /* Nothing is booked into an hour, so there is no gap to keep after one. */
    buffer_minutes: input.isScheduled ? (input.bufferMinutes ?? 0) : 0,
  };
}
