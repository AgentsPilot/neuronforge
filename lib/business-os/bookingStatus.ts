/**
 * What state a booking can be in — declared once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `pending` IS A REAL STATUS, AND FOR YEARS NOTHING SAID SO.
 *
 * Eleven files declared this union as four values, the creating migration's
 * comment listed the same four, and both Zod schemas accepted only those four.
 * Meanwhile `app/api/website/booking/create/route.ts` writes a FIFTH:
 *
 *     status: requiresPayment || isQuoteRequest ? 'pending' : 'confirmed'
 *
 * The column is `TEXT NOT NULL DEFAULT 'confirmed'` with no CHECK, so the
 * database accepted the undeclared value without complaint, and the four-value
 * types were simply wrong about the data they described.
 *
 * What that cost:
 *
 *   - a free intro booking rendered "Awaiting payment", because the one place
 *     that DID handle `pending` assumed it could only mean unpaid;
 *   - `PATCH /bookings/[id]` and `POST /bookings` rejected `pending`, so a
 *     booking in that state could not be moved out of it through the app;
 *   - reading any of those types told you something untrue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT `pending` MEANS: NOT CONFIRMED YET. NOT "UNPAID".
 *
 * The route writes it for two unrelated reasons, and conflating them is what
 * produced the bad label:
 *
 *   - a payment is genuinely owed and has not arrived;
 *   - the service is QUOTED, so nobody has said what the work costs yet —
 *     there is no price to be awaiting.
 *
 * An owner can also set it by hand. To find out whether money is actually
 * outstanding, read `payment_status`: it is written 'paid' whenever the price
 * is zero or there is nothing to collect, so anything else is a real debt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEPENDENCY-FREE ON PURPOSE.
 *
 * Client components need this type. The obvious home was
 * `lib/repositories/SchedulingRepository`, but that imports `supabaseServer` —
 * and a value import of a server module from a client component bundles a
 * service-role key that is not there, which took down every public page in this
 * app once already. This file imports nothing, so it cannot.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const BOOKING_STATUSES = [
  /** Booked, and either paid for or free. The ordinary case. */
  'confirmed',
  /**
   * Not confirmed yet: a payment is owed, or the work has yet to be quoted.
   * NOT a statement about money on its own — see the note above.
   */
  'pending',
  'cancelled',
  'completed',
  'no_show',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Whether a value off the wire is a status this system recognises. */
export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

/**
 * The statuses that still occupy their time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A booking that WILL NOT HAPPEN does not hold a slot. Two statuses mean
 * exactly that — `cancelled` and `no_show` — and only the first was ever
 * released.
 *
 * So marking a client as a no-show left their appointment sitting on the
 * calendar. The owner had just decided that meeting is not taking place, and
 * invited the person to pick another time, while the original slot stayed shut
 * to everyone including them.
 *
 * `completed` stays in the list. It is necessarily in the past, so it is never
 * offered anyway, and keeping it means the calendar cannot be double-booked
 * retrospectively.
 *
 * `pending` stays too, and for the opposite reason: a payment or a quote is
 * outstanding, the client is still expecting that time, and releasing it sells
 * their slot to somebody else.
 *
 * NOTHING IS DELETED by releasing a slot. The booking row keeps its status and
 * its history; it simply stops blocking the calendar.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const SLOT_HOLDING_STATUSES = ['confirmed', 'pending', 'completed'] as const;

/** Whether a booking in this state still occupies its time. */
export function holdsSlot(status: unknown): boolean {
  return typeof status === 'string' && (SLOT_HOLDING_STATUSES as readonly string[]).includes(status);
}
