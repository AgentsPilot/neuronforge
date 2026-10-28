/**
 * Cancelling a meeting cannot claim the client was told when they were not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Reported as "mail did not send". The measurement was worse than the report:
 * of five meetings cancelled by an owner on this account, two produced no
 * client email AND no `email_sends` row of any kind. The owner saw a success
 * toast reading "the client has been told", the journey showed nothing, and —
 * because the journey draws its Resend button from an `email_sends` row — there
 * was nothing to press either. A server log line was the only trace.
 *
 * Three separate things made it silent, and all three had to go:
 *
 *   1. `meeting-cancel` sent the mail DETACHED. "Must not fail the request"
 *      had been implemented as "must not be waited for", which are different
 *      things: the result was unreachable, so the route answered `success`
 *      whether or not anything went out.
 *
 *   2. `outcome` awaited it and then DISCARDED `mail.sent`, warning to the log
 *      and returning the same `success: true` either way.
 *
 *   3. `sendCancellationEmail` wrote its `email_sends` row only on the path
 *      that reaches the transport. A THROW before that — a template calling
 *      `Intl` on a bad date is the shape that has already happened once on
 *      this platform — left no row, so there was nothing to see and nothing
 *      to re-send.
 *
 * Every refusal inside the sender was ruled out against the two silent
 * bookings: contact, address and service were present and identical to the
 * three that did send. So this does not claim to fix the underlying cause. It
 * makes the next occurrence legible — which is what finding the cause needs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * All three are wiring across a service and two routes with no injection seam
 * and no existing harness that renders one. `publicBookingWiring.test.ts` is
 * the repo's precedent for exactly this shape.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const sender = read('lib/services/BookingEmailService.ts');
const outcome = read('app/api/scheduling/meetings/[id]/outcome/route.ts');
const meetingCancel = read('app/api/scheduling/bookings/[id]/meeting-cancel/route.ts');
const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
const copy = dictionarySource();

describe('a failed send is written down', () => {
  const catchBlock = sender.slice(
    sender.indexOf('The attempt is written down even though nothing was sent'),
    sender.indexOf('return { sent: false, error: message };'),
  );

  it('records the attempt from the catch, not only from the happy path', () => {
    expect(catchBlock).toMatch(/recordEmailSend\(\{/);
    expect(catchBlock).toMatch(/contactId: recipientContactId/);
    expect(catchBlock).toMatch(/result: \{ sent: false, error: message, provider: 'none' \}/);
  });

  it('files it under the right kind, so the journey offers the right resend', () => {
    /*
     * `meeting_cancelled` and `booking_cancelled` are both in the drawer's
     * RESENDABLE_KINDS. Filing a meeting cancellation as an order cancellation
     * would offer to re-send the wrong message.
     */
    expect(catchBlock).toMatch(
      /kind: options\?\.meetingOnly \? 'meeting_cancelled' : 'booking_cancelled'/,
    );
  });

  it('has something to record with, which means hoisting it out of the try', () => {
    /* A throw cannot read a const declared inside the block it escaped. */
    expect(sender).toMatch(/let recipient: string \| null = null;/);
    expect(sender).toMatch(/let recipientContactId: string \| null = null;/);
    expect(sender).toMatch(/let composedSubject: string \| null = null;/);

    expect(sender).toMatch(/recipient = clientEmail;/);
    expect(sender).toMatch(/composedSubject = subject;/);
  });

  it('still returns the failure to its caller', () => {
    expect(sender).toMatch(/return \{ sent: false, error: message \};/);
  });
});

describe('both routes report whether the client was told', () => {
  it('the session outcome keeps the answer instead of logging it away', () => {
    expect(outcome).toMatch(/let clientNotified: boolean \| null = null;/);
    expect(outcome).toMatch(/clientNotified = mail\.sent;/);
    /* A throw is a failure to notify, not an absence of one. */
    expect(outcome).toMatch(/clientNotified = false;/);
    expect(outcome).toMatch(/clientNotified,\n\s*notifyError,/);
  });

  it('the meeting cancellation WAITS for the send', () => {
    /*
     * The fault as it was written: detached, so the result could never be
     * reported. It stays non-fatal — see the next case.
     */
    expect(meetingCancel).toMatch(
      /const mail = await BookingEmailService\.sendCancellationEmail/,
    );
    expect(meetingCancel).not.toMatch(
      /BookingEmailService\.sendCancellationEmail\([\s\S]{0,400}\}\)\.catch\(err =>/,
    );
  });

  it('and a mail failure still does not undo the cancellation', () => {
    /* The original reasoning, which was right: the appointment IS cancelled. */
    expect(meetingCancel).toMatch(/} catch \(err\) \{[\s\S]{0,200}clientNotified = false;/);
    expect(meetingCancel).toMatch(/success: true, data: result\.data, clientNotified, notifyError/);
  });
});

describe('the owner is told the truth', () => {
  it('the toast no longer promises a send on a failure', () => {
    expect(drawer).toMatch(/if \(data\.clientNotified === false\)/);
    expect(drawer).toMatch(/crm\.booking\.meeting_cancelled_unsent/);
  });

  it('only an explicit false changes the message', () => {
    /*
     * `null` means no mail was due. An older route that does not send the
     * field at all must leave the existing message exactly as it was, which
     * `=== false` guarantees and a truthiness test would not.
     */
    expect(drawer).not.toMatch(/if \(!data\.clientNotified\)/);
  });

  it('the new line exists in all three languages', () => {
    const hits = copy.match(/'crm\.booking\.meeting_cancelled_unsent':/g) ?? [];

    expect(hits).toHaveLength(3);
  });

  it('and it says the meeting IS cancelled, not that it failed', () => {
    /*
     * The cancellation succeeded. A message reading only "could not email the
     * client" would leave the owner unsure whether to cancel again.
     */
    expect(copy).toMatch(/'crm\.booking\.meeting_cancelled_unsent': 'The meeting is off, but/);
  });
});
