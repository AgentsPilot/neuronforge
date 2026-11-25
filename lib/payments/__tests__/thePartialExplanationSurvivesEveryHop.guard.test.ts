/**
 * The owner's account of a partial refund reaches the client, through both paths.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT
 *
 * A live partial refund: $20 of $40, the owner wrote "As a good will, the
 * owner decided to refund half of the amount", and the client received the
 * old line — "Reason: The service was not provided", their own complaint
 * handed back as the account of why half was kept.
 *
 * Every individual piece was correct. The dialog collected the sentence. The
 * route passed it. `notifyRefund` declared it. The template rendered it, and
 * had a passing unit test proving so. The refund row still holds the sentence.
 *
 * It died at a seam. `notifyRefund` has TWO paths — an invoice-only refund
 * calls the template directly, and a refund against a BOOKING goes through
 * `BookingEmailService.sendRefundConfirmation`, which has its own typed
 * parameter and builds its own call to the template. The field was added to
 * the object passed to that service without being declared on it, so it was
 * dropped in silence: no error, no type complaint at runtime, an email that
 * sent successfully and said the wrong thing.
 *
 * The lesson this file encodes: a value crossing a module boundary needs a
 * test at the BOUNDARY, not only at both ends. Both ends passed.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const NOTIFY = read('lib/payments/notifyRefund.ts');
const BOOKING_SERVICE = read('lib/services/BookingEmailService.ts');
const ROUTE = read('app/api/payments/refunds/route.ts');

describe('the partial explanation, hop by hop', () => {
  it('leaves the route, on the single-payment path only', () => {
    /* `body.amount` is set only when the owner asked to return PART of one
       payment. A full refund has no difference to account for, and its note
       stays internal like everywhere else in the platform. */
    expect(ROUTE).toContain('partialExplanation: body.amount ? body.reason_note : undefined');
  });

  it('is declared on the notifier that carries it', () => {
    expect(NOTIFY).toMatch(/partialExplanation\?: string \| null;/);
  });

  it('reaches BOTH of the notifier’s paths', () => {
    /*
     * Two, always: the invoice-only refund and the booking refund. One of them
     * having it is how this bug shipped — the booking path is the common one,
     * and it was the one passing the field into a parameter that did not
     * declare it.
     */
    expect(NOTIFY.match(/partialExplanation: input\.partialExplanation \?\? undefined/g)).toHaveLength(2);
  });

  it('is DECLARED on the booking service, not merely passed to it', () => {
    /*
     * The whole bug in one assertion. An undeclared key on a typed parameter
     * is dropped without a word, so "notifyRefund passes it" proved nothing.
     */
    const signature = BOOKING_SERVICE.slice(
      BOOKING_SERVICE.indexOf('static async sendRefundConfirmation'),
      BOOKING_SERVICE.indexOf('): Promise<EmailResult> {', BOOKING_SERVICE.indexOf('static async sendRefundConfirmation'))
    );
    expect(signature).toMatch(/partialExplanation\?: string;/);
  });

  it('is handed to the template by the booking service', () => {
    const call = BOOKING_SERVICE.slice(
      BOOKING_SERVICE.indexOf('generateRefundConfirmationEmail({'),
      BOOKING_SERVICE.indexOf('});', BOOKING_SERVICE.indexOf('generateRefundConfirmationEmail({'))
    );
    expect(call).toMatch(/partialExplanation: refundData\.partialExplanation/);
  });

  it('is what the template actually gates the reason line on', () => {
    const template = read('lib/email/templates/refund-confirmation.ts');
    expect(template).toMatch(
      /data\.refundType === 'partial' && Boolean\(data\.partialExplanation\?\.trim\(\)\)/
    );
    /* And the old line stands down when it is present, rather than sitting
       beside it as a second, contradictory answer. */
    expect(template).toMatch(/if \(!explainsThePart && data\.reason\)/);
  });
});
