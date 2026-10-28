/**
 * The invoice mail says which job it bills.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `sendByEmail` records every invoice mail with the contact, the address, the
 * subject and the provider's message id — and no booking and no kind. So the
 * mail belonged to no job, and nothing on the card could answer the one
 * question an owner asks after billing someone: did the invoice actually go
 * out?
 *
 * The booking was never missing. It is read off the invoice row ~130 lines
 * earlier to build the pay link, and then dropped at the record.
 *
 * Found from a live account. The owner marked a package session held, the
 * invoice was raised and emailed, Resend confirmed delivery two seconds later
 * — and the session showed no trace of it. Of six invoice mails to that client
 * exactly one carried a booking, by a mechanism nothing in the code can
 * produce; the other five, including that one, carried none.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * `sendByEmail` wants a business profile, a connected account, a PDF renderer
 * and a mail transport before it reaches this line, which is the same reason
 * `invoiceSendReachesTheClient` pins its decision in source and tests the
 * predicate separately. What the record DOES with these arguments is tested for
 * real in `lib/notifications/__tests__/recordEmailSend.test.ts`; what cannot be
 * seen from there is whether this caller passes them at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const service = fs.readFileSync(
  path.join(process.cwd(), 'lib/services/InvoiceDeliveryService.ts'),
  'utf8'
);

const roster = fs.readFileSync(
  path.join(process.cwd(), 'lib/notifications/recordEmailSend.ts'),
  'utf8'
);

/**
 * The arguments the invoice send is recorded with.
 *
 * Taken from the call opening to its closing `});` rather than by counting
 * braces: the block holds object literals of its own, and the first `}` walking
 * forward is not the end of the call.
 */
const record = (() => {
  const at = service.indexOf('await recordEmailSend({');
  expect(at).toBeGreaterThan(-1);

  const end = service.indexOf('});', at);
  expect(end).toBeGreaterThan(at);

  return service.slice(at, end);
})();

describe('the invoice mail', () => {
  it('names the booking it bills', () => {
    expect(record).toMatch(/bookingId:\s*\(invoice as[^)]*\)\.booking_id \?\? null/);
  });

  it('is the only invoice send, so pinning this one pins them all', () => {
    /* If a second sender appears, this guard silently stops covering the one
       that matters. The template has exactly one call site today. */
    expect(service.split('await recordEmailSend({').length - 1).toBe(1);
    expect(service.split('generateInvoiceEmail(').length - 1).toBe(1);
  });

  it('declares what kind of mail it is', () => {
    expect(record).toMatch(/kind: 'invoice_sent'/);
  });

  it('marks a copy as a resend rather than a second original', () => {
    /* `isCopy` is the same answer the watermark uses, so the document and its
       record cannot disagree about which this was. */
    expect(record).toMatch(/isResend: isCopy/);
  });

  it('uses the same booking the pay link is built from', () => {
    /* The point of the fault: the value was in hand all along. If the pay link
       stops reading it off the invoice, this guard should be re-read rather
       than quietly passing on a field that no longer means the same thing. */
    expect(service).toMatch(/bookingId: \(invoice as[^)]*\)\.booking_id \?\? null,\s*\n\s*userId,/);
  });
});

describe('the kind it declares', () => {
  it('exists in the roster', () => {
    expect(roster).toMatch(/\| 'invoice_sent'/);
  });

  it('is NOT about one appointment, so a bill stays out of a session history', () => {
    /*
     * The decision `payment_receipt` and `refund_confirmed` already encode: a
     * money fact belongs to the JOB. Filing it under the booking's current
     * attempt would put it inside one session's rail, which is exactly the
     * fault that put a booking cancellation under "you cancelled the meeting".
     *
     * The set is read from source because its membership is the decision; the
     * behaviour it produces is asserted for real in recordEmailSend.test.ts.
     */
    const set = roster.slice(
      roster.indexOf('const ABOUT_ONE_APPOINTMENT'),
      roster.indexOf('async function resolveMeetingId')
    );

    expect(set.length).toBeGreaterThan(0);
    expect(set).not.toMatch(/invoice_sent/);
  });
});
