/**
 * A quote accepted up front leaves the client something to pay.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED
 *
 * A client accepted a ₪700 package from their consultation's portal page, an
 * invoice was raised correctly, and the portal showed no payment at all. Not a
 * wrong figure — no money card, nothing to pay, as though the quote had never
 * been accepted.
 *
 * Both halves were behaving as written:
 *
 *   · `raiseInvoice` bills the PURCHASE, so the invoice points at the package
 *     CONTAINER it just created. That is deliberate and documented: pointed at
 *     the consultation instead, the payment could be taken and then not
 *     refunded from anywhere the owner looks.
 *
 *   · the portal gathers money by walking DOWNWARDS — this booking, its
 *     container, its siblings. A consultation that sold a package is none of
 *     those. It has no parent and no children, so the walk collapsed to its own
 *     id and the invoice on the container was out of scope.
 *
 * Verified on the live row: booking `12bc9aef` resolved one id and found zero
 * invoices; including the container it sold finds INV-00041, ₪700, sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THE FIX
 *
 * `proposals.package_booking_id` records which container each accepted quote
 * created, and the route ALREADY reads that link in the opposite direction, a
 * few lines below, to decide which booking a session belongs to. One
 * relationship, followed both ways, so the client and the owner are looking at
 * one agreement.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(
  join(process.cwd(), 'app/api/book/manage/[token]/route.ts'),
  'utf8'
);

/** The page a client reads, as opposed to the route that feeds it. */
const page = readFileSync(
  join(process.cwd(), 'app/book/manage/[token]/page.tsx'),
  'utf8'
);

describe('money follows the quote', () => {
  it('includes the package container this booking sold', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * Without it an upfront quote is accepted and the client is shown no way
     * to pay — the money exists, on a booking the page never asks about.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(route).toMatch(/\.from\('proposals'\)[\s\S]{0,200}\.select\('package_booking_id'\)/);
    expect(route).toMatch(/\.not\('package_booking_id', 'is', null\)/);
  });

  it('scopes that lookup to this booking and this owner', () => {
    // A client's token proves one booking. It must not widen into somebody
    // else's package because an id was reused.
    const block = route.slice(route.indexOf("select('package_booking_id')"));

    expect(block.slice(0, 300)).toMatch(/\.eq\('booking_id', booking\.id\)/);
    expect(block.slice(0, 300)).toMatch(/\.eq\('user_id', booking\.user_id\)/);
  });

  it('adds containers only, not their sessions', () => {
    /*
     * The sessions are reached by the family walk once a client opens one of
     * them. Adding every session here would widen the balance of a
     * consultation that happened to sell two packages.
     */
    const block = route.slice(route.indexOf('const soldContainerIds'));

    expect(block.slice(0, 400)).toMatch(/row\.package_booking_id as string/);
    expect(block.slice(0, 400)).not.toMatch(/parent_booking_id/);
  });

  it('cannot count one booking twice', () => {
    // The container a client is already inside must not arrive a second time
    // through the quote that sold it.
    expect(route).toMatch(/id !== moneyContainerId/);
    expect(route).toMatch(/new Set\(\[/);
  });
});

describe('and the sessions it bought', () => {
  it('looks for meetings under the sold package too', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE SAME BLIND SPOT, ONE FUNCTION OVER.
     *
     * `packageMeetings` walks down from `parent_booking_id ?? id` in both of
     * its branches — child bookings and `scheduling_meetings`. A consultation
     * that SOLD a package is outside it, so a client who had just bought
     * three sessions saw an empty schedule beside their new invoice.
     *
     * Measured on the live row: one container found 0 sessions, two found 3.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(route).toMatch(/soldContainerIds: string\[\] = \[\]/);
    expect(route).toMatch(/packageMeetings\(booking, contactEmail, noticeHours, now, soldContainerIds\)/);
  });

  it('asks both storage shapes about every container', () => {
    // A package sold last month is child bookings; one sold today is rows in
    // `scheduling_meetings`. Both are read, so both must widen.
    expect(route).toMatch(/\.in\('parent_booking_id', containerIds\)/);
    expect(route).toMatch(/\.in\('booking_id', containerIds\)/);
  });

  it('cannot let one package overwrite another session for session', () => {
    /*
     * The dedupe map was keyed on `session_number` alone, which is unique
     * within a package and not across two. Session 1 of the second would have
     * replaced session 1 of the first: a client shown half of what they
     * bought, with nothing to indicate anything was missing.
     */
    expect(route).toMatch(/current\.set\(`\$\{row\.booking_id\}#\$\{row\.session_number\}`, row\)/);
    expect(route).not.toMatch(/current\.set\(Number\(row\.session_number\), row\)/);
  });
});

describe('the order a client reads it in', () => {
  it('lists the sessions ABOVE the payment panel', () => {
    /*
     * Someone who has just accepted a quote is deciding two things at once:
     * the dates they agreed to, and whether to pay for them. The sessions sat
     * BELOW an open card form, so the three they had just bought were off the
     * bottom of the screen at the moment the decision was being made.
     *
     * Asserted by position, because nothing else can: both blocks render, both
     * are correct in isolation, and only their order was wrong.
     */
    const sessions = page.indexOf('{meetings.length > 0 && (');
    const payment = page.indexOf('{payOpen && payment?.invoiceId && (');

    expect(sessions).toBeGreaterThan(-1);
    expect(payment).toBeGreaterThan(-1);
    expect(sessions).toBeLessThan(payment);
  });

  it('keeps the reschedule and cancel panels below the list they act on', () => {
    /*
     * The rule an earlier move established: a picker opening ABOVE the row
     * that asked for it scrolls that row off screen. Lifting the sessions must
     * not drag those panels up with them.
     */
    const sessions = page.indexOf('{meetings.length > 0 && (');
    const panels = page.indexOf("task.kind === 'reschedule' || task.kind === 'cancel'");

    expect(panels).toBeGreaterThan(sessions);
  });
});

describe('what must not change', () => {
  it('an ordinary booking still resolves to itself alone', () => {
    /*
     * The original collapse is load-bearing: one booking, one id, and both
     * money queries byte-for-byte what they were. A service sold without a
     * quote has no proposals row, so the new lookup returns nothing and the
     * set is unchanged.
     */
    expect(route).toMatch(/familyRows\?\.length\s*\n?\s*\?\s*\[moneyContainerId, \.\.\.familyRows\.map/);
    expect(route).toMatch(/:\s*\[booking\.id\]/);
  });

  it('still reads the link the other way for the subject', () => {
    // The display rule this fix mirrors: which booking hosts a session.
    expect(route).toMatch(/\.eq\('package_booking_id', booking\.parent_booking_id\)/);
  });
});
