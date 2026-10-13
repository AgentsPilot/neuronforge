/**
 * A meeting that raised its own invoice has to say whether the money came.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES
 *
 * On a package billed per meeting, marking one held is what RAISES ITS INVOICE
 * and emails it to the client. The row then showed the meeting's status and
 * nothing else — so the owner could watch an invoice go out and had no way, on
 * the card where they sent it, to see it come back in. The question "did they
 * pay?" had no answer anywhere on the booking.
 *
 * The data was never missing. A meeting is a `SessionCardData` like the card
 * above it and carries its own `payment`, built by the same pipeline. The row
 * simply never read the field.
 *
 * AND THE OTHER DIRECTION: UNDOING IT
 *
 * Money taken on one meeting could only be returned from the payments list
 * several levels away, where six meetings of one package are six near-identical
 * rows and picking the wrong one refunds the wrong session. The meeting's own
 * menu is where that belongs.
 *
 * WHY A SOURCE GUARD
 *
 * Rendering this list needs a contact, a package container, its child bookings,
 * their invoices and a journey — the component is reached about eight levels
 * into a drawer. The rules worth pinning are narrow and local, and all of them
 * are visible in the source: which field is read, when the action is offered,
 * and that the words exist in every language.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

const tab = read('components/crm/contact-drawer/BookingsTab.tsx');
const actions = read('components/crm/contact-drawer/MeetingRowActions.tsx');

/** The meeting row: from the map over a package's meetings to its actions. */
const meetingRow = tab.slice(
  tab.indexOf('session.meetings.map((meeting, meetingIndex)'),
  tab.indexOf('<MeetingRowActions')
);

describe('the row reads the meeting\'s own payment', () => {
  it('takes it from the meeting, not the card above it', () => {
    /*
     * `meeting.payment`, never the container's. A package paid up front holds
     * its money on the parent, and spending that figure on each child would
     * report one payment six times.
     */
    expect(meetingRow).toMatch(/const pay = meeting\.payment/);
  });

  it('says the amount and the word, not one of them', () => {
    // A figure alone does not say whether it arrived; "Paid" alone does not say
    // what was.
    expect(tab).toMatch(/payState && \(/);
    expect(tab).toMatch(/payState\.text/);
    expect(tab).toMatch(/format\(pay!\.amount\)/);
  });

  it('stays silent when the meeting holds no money of its own', () => {
    /*
     * A package paid up front, or a free service. There is no payment fact to
     * state, and a dash in its place would imply one is missing.
     */
    expect(meetingRow).toMatch(/!pay \|\| pay\.status === 'free' \|\| !\(pay\.amount > 0\)/);
  });

  it('separates a refund from a payment, and colours it as a refund', () => {
    /*
     * A refunded row still carries `status: 'paid'` — correctly, because it WAS
     * paid — so testing the status alone reports money the business no longer
     * has as money it kept. Orange rather than red is settled elsewhere in this
     * file: a refund is a deliberate, completed act, not a failure.
     */
    expect(meetingRow).toMatch(/refunded[\s\S]{0,120}refundedAt/);
    expect(meetingRow).toContain("#B54708");
  });
});

describe('and the menu can return it', () => {
  it('offers a refund', () => {
    expect(actions).toMatch(/key: 'refund'/);
    expect(actions).toContain("t('payments.refund')");
  });

  it('only while something is left to return', () => {
    // A fully refunded meeting must stop offering it, or the owner is invited
    // to send back money that has already gone.
    expect(actions).toMatch(/if \(refundable && onRefund\)/);
    expect(tab).toMatch(/pay\.amount - Number\(pay\.refundedAmount \|\| 0\) > 0/);
  });

  it('only on money that actually arrived', () => {
    // An unpaid invoice has nothing to refund; it is cancelled, not returned.
    const gate = tab.slice(tab.indexOf('refundable={Boolean('));
    expect(gate.slice(0, 400)).toMatch(/pay\?\.invoiceId[\s\S]*?pay\.status === 'paid'/);
  });

  it('reuses the dialog the payment stages already use', () => {
    /*
     * `onRefundStage` is named for where it was first needed, but its contract
     * is an invoice. A second route to returning money would be a second place
     * for the partial-refund rules to drift.
     */
    expect(tab).toMatch(/onRefund=\{[\s\S]{0,200}onRefundStage\(\{/);
  });

  it('names which meeting, since six of a package look alike', () => {
    const refundCall = tab.slice(tab.indexOf('refundable={Boolean('));
    expect(refundCall.slice(0, 1200)).toMatch(/label:[\s\S]{0,120}formatDate\(row\.start_time\)/);
  });
});

describe('the words exist wherever the drawer is read', () => {
  const dictionaries = ['en', 'es', 'he'].map(lang =>
    read(`lib/business-os/translations/${lang}.ts`)
  );

  /*
   * `t()` returns the KEY when a translation is missing, so a gap here does not
   * throw and does not fail a render — the owner simply reads
   * "payments.refund" on a menu. That has happened before on this card.
   */
  it.each([
    'crm.payment.status.paid',
    'crm.payment.status.pending',
    'crm.payment.status.refunded',
    'payments.invoice.overdue',
    'payments.refund',
  ])('%s is translated in all three', key => {
    for (const dictionary of dictionaries) {
      expect(dictionary).toContain(`'${key}':`);
    }
  });
});
