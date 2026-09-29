/**
 * The "cancel booking" switch has to reach the server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS GUARDS
 *
 * `RefundModal` held the choice in `deleteBooking` state, never put it in the
 * request, and handed it to `onSuccess(deleteBooking)` instead. All four callers
 * are written `onSuccess={() => ...}`, so the flag was passed to a function that
 * discarded it.
 *
 * Nothing failed. The refund succeeded, the modal closed, the booking stayed
 * confirmed and its slot stayed blocked — and because no error was reported, the
 * only way to find out was to look at the booking days later. One was found in
 * production: money fully refunded, `status` still `pending`.
 *
 * A source-level guard, deliberately. What broke was not a function returning the
 * wrong value — every function here did exactly what it said. What broke was that
 * two files stopped agreeing about the name of a field, and that is what this
 * asserts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const route = readFileSync(join(root, 'app/api/payments/refunds/route.ts'), 'utf8');
const modal = readFileSync(join(root, 'components/payments/RefundModal.tsx'), 'utf8');

describe('the refund dialog and the refunds route agree about cancelling', () => {
  it('the modal sends the flag', () => {
    // Inside the request body, not merely mentioned in a comment.
    const body = modal.slice(modal.indexOf('body: JSON.stringify'));
    expect(body).toMatch(/cancel_booking:/);
  });

  it('the route accepts it', () => {
    // In the Zod schema: an unknown key is stripped, so a field the schema does
    // not name is silently dropped rather than rejected. That is precisely how
    // this could have been wrong again without anything failing.
    const schema = route.slice(0, route.indexOf('/** Which HTTP status each refusal deserves. */'));
    expect(schema).toMatch(/cancel_booking:\s*z\.boolean\(\)/);
  });

  it('the route acts on it, through the one path that frees the slot', () => {
    /*
     * `cancelBooking` and not an UPDATE. A status write would mark the row and
     * leave the calendar event holding the time, the unpaid invoices chasing and
     * the client untold.
     */
    expect(route).toMatch(/import \{ cancelBooking \} from '@\/lib\/services\/BookingLifecycleService'/);
    expect(route).toMatch(/body\.cancel_booking\s*\n?\s*\?\s*await cancelBookingBehind/);
    expect(route).toMatch(/await cancelBooking\(\{/);
  });

  it('reports a cancellation that failed instead of closing quietly', () => {
    // The refund cannot be undone, so a failure here must be told, not thrown.
    expect(route).toMatch(/booking_cancelled:/);
    expect(modal).toMatch(/booking_cancelled/);
    expect(modal).toMatch(/payments\.refund\.booking_not_cancelled/);
  });
});
