/**
 * The race between this route and Stripe's webhook, and why a duplicate must
 * not be treated as a failure.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED
 *
 * `payment_transactions.stripe_payment_intent_id` is unique, and Stripe's
 * `payment_intent.succeeded` webhook records the same payment from the other
 * side. Whichever arrives second violates the constraint. On 2026-09-28 that was
 * this route — the webhook fired while it was still compiling — and the 23505
 * was handled as an insert failure:
 *
 *   * 500 returned before the booking was updated, so `status` stayed `pending`
 *     while `payment_status` read `paid`;
 *   * `sendBookingConfirmation` is below that return, so NO confirmation email
 *     was sent;
 *   * the client had paid EUR 100 and heard nothing.
 *
 * Two bookings reached that state before it was found. The constraint did its
 * job — it stopped the money being counted twice. Reading that as "the payment
 * is not recorded" is what was wrong.
 *
 * WHY A SOURCE TEST. The route needs Stripe, Supabase and the email service; a
 * behavioural test would mock all three and assert on the mocks. What actually
 * regressed is one branch and the ORDER of two statements, and both are
 * checkable from the file — which is the only reason this file exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'app/api/website/booking/finalize/route.ts'),
  'utf8'
);

/** Comments carry the explanation, which would otherwise satisfy these rules. */
const code = source
  .split('\n')
  .filter(line => {
    const t = line.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  })
  .join('\n');

describe('a duplicate payment insert', () => {
  it('is recognised by its Postgres code rather than its message', () => {
    // 23505 = unique_violation. Matching on the message text would break the
    // first time Postgres or PostgREST reworded it.
    expect(code).toContain("'23505'");
  });

  it('adopts the transaction the webhook already wrote', () => {
    expect(code).toMatch(/stripe_payment_intent_id['"]?,\s*data\.payment_intent_id/);
    expect(code).toMatch(/paymentTransactionId\s*=\s*existing\?\.id/);
  });

  it('does NOT return early on a duplicate', () => {
    // The whole bug. Everything that matters to the client — confirming the
    // booking and sending the email — is below that return.
    const duplicateBranch = code.indexOf("'23505'");
    const nextReturn = code.indexOf('return NextResponse', duplicateBranch);
    const elseIf = code.indexOf('} else if (paymentError) {', duplicateBranch);

    expect(duplicateBranch).toBeGreaterThan(-1);
    expect(elseIf).toBeGreaterThan(duplicateBranch);
    // The next `return` must belong to the real-failure branch, not the duplicate one.
    expect(nextReturn).toBeGreaterThan(elseIf);
  });

  it('still fails on a real insert error, which is a different thing', () => {
    expect(code).toContain('} else if (paymentError) {');
    expect(code).toMatch(/status:\s*500/);
  });
});

describe('what must stay downstream of that branch', () => {
  const statusUpdate = code.indexOf("status: 'confirmed'");
  const confirmationEmail = code.indexOf('sendBookingConfirmation');
  const duplicateBranch = code.indexOf("'23505'");

  it('confirms the booking after the payment branch', () => {
    expect(statusUpdate).toBeGreaterThan(duplicateBranch);
  });

  it('sends the confirmation after the payment branch', () => {
    // If this ever moves above the branch the ordering bug is impossible; if the
    // branch grows another early return, this is the test that catches it.
    expect(confirmationEmail).toBeGreaterThan(duplicateBranch);
  });

  it('awaits the confirmation rather than firing it after the response', () => {
    // A promise dispatched after the response has no owner on serverless: the
    // invocation freezes and the email is lost without anything rejecting.
    expect(code).toMatch(/await Promise\.allSettled\(\[/);
  });
});
