/**
 * What `finalize` records, and what it tells the client they paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHARACTERISATION. This records what the route does TODAY.
 *
 * It is step 2 of
 * `docs/workplans/booking-created-only-when-the-client-completes.md`: the three
 * money lessons in this file are recorded in comments and guarded by nothing,
 * and the plan moves the booking write out of `create` and into this route.
 * A rewrite that starts from the current code will not fail when it undoes one
 * of these — the comment will simply start describing behaviour that no longer
 * exists.
 *
 * Each `describe` below is one entry from
 * `docs/workplans/public-booking-recorded-bugs-inventory.md` (#16, #17, #18).
 * All three cost real money to learn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SOURCE, NOT BEHAVIOUR
 *
 * Reaching these lines needs a Stripe client, a Connect account lookup, a
 * contact, a service, a booking and four Supabase tables. The existing guard
 * for these routes — `publicBookingWiring.test.ts` — reads the source for the
 * same reason, and says so: the row is correct and the service layer is
 * correct; what broke was the WIRING around them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(process.cwd(), 'app/api/website/booking/finalize/route.ts'),
  'utf8'
);

/**
 * The file with comments removed.
 *
 * Every assertion below runs against this. The comments explain the very bugs
 * being guarded and quote the old code — a test reading the raw source would
 * pass on the prose describing what must NOT happen.
 */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('this guard reads the code, not its own explanation', () => {
  it('strips the comments that quote the old behaviour', () => {
    expect(SOURCE).toContain('the same payment banked twice');
    expect(code).not.toContain('the same payment banked twice');
  });

  it('and keeps the code', () => {
    expect(code).toContain('const isPlanBooking =');
    expect(code).toContain('const chargedAmount =');
  });
});

describe('#16 · a plan period is not recorded as the whole plan', () => {
  /*
   * The client paid one period of three. This route wrote `serviceDetails.price`
   * — the whole agreement — so ₪1,000 of revenue was recorded for a ₪333 charge,
   * and then `recordPlanPeriodPaid` banked the real ₪333 from `invoice.paid` on
   * top of it. The same payment twice, once at triple its value.
   */
  it('recognises a plan from the service, through the shared helper', () => {
    expect(code).toContain("import { isInstallmentPlan } from '@/lib/payments/PaymentPlanService';");
    expect(code).toContain('const isPlanBooking = isInstallmentPlan(serviceDetails ?? {});');
  });

  it('writes no transaction here for a plan', () => {
    /*
     * The guard itself. The webhook is the only authority that sees periods
     * 2..n at all, and it takes the amount from the charge rather than from the
     * agreement — so it is the right authority for period 1 as well.
     */
    const gate = code.slice(
      code.indexOf('if (data.payment_intent_id && serviceDetails?.price'),
      code.indexOf('if (data.payment_intent_id && serviceDetails?.price') + 120
    );

    expect(gate).toContain('!isPlanBooking');
  });

  it('says so in the log rather than passing over it silently', () => {
    /* A plan finalising with no transaction row looks like a bug to whoever
       reads the logs next. It is deliberate, and it is stated. */
    expect(code).toContain("'Payment plan booking — leaving every period to the webhook to record'");
  });
});

describe('#17 · a duplicate transaction means the webhook won the race', () => {
  /*
   * `payment_transactions.stripe_payment_intent_id` is unique, and Stripe's
   * `payment_intent.succeeded` records the same payment from the other side.
   * Whichever arrives second violates the constraint — routinely this route, on
   * a cold serverless invocation.
   *
   * Treating 23505 as an error cost a real client: the money was taken and
   * recorded correctly, this route threw before its update, the booking stayed
   * `pending` while `payment_status` read `paid`, no confirmation was sent. The
   * owner saw an unconfirmed booking; the client saw nothing and had paid €100.
   */
  it('tests for the unique-violation code specifically', () => {
    expect(code).toContain("const isDuplicate = paymentError?.code === '23505';");
  });

  /*
   * Sliced to the END OF THE BRANCH, not a character count.
   *
   * These read `indexOf(...) + 400` and `+ 600`. The branch then grew — it has
   * to attach the adopted row to the booking, see the test below — and the
   * assertions fell outside the window, so the guard failed over a change it
   * was never meant to be sensitive to. A count is a guess about length; the
   * `else if` is where the branch actually ends.
   */
  const duplicateBranch = () =>
    code.slice(code.indexOf('if (isDuplicate)'), code.indexOf('} else if (paymentError)'));

  it('adopts the row the webhook already wrote', () => {
    const branch = duplicateBranch();

    expect(branch).toContain("from('payment_transactions')");
    expect(branch).toContain("eq('stripe_payment_intent_id', data.payment_intent_id)");
    expect(branch).toContain('paymentTransactionId = existing?.id ?? null;');
  });

  it('attaches that row to this booking, not merely reads its id', () => {
    /*
     * THE HALF THAT WAS MISSING, and it cost the same client twice.
     *
     * Adopting the id left `payment_transactions.booking_id` NULL whenever the
     * webhook won the race — which on a smart link it usually does, because the
     * client pays before the booking is written, so the webhook's row cannot
     * carry a booking id even in its metadata.
     *
     * A payment attached in one direction only (`booking.payment_id` set, the
     * transaction not) is invisible to everything that finds a booking's money
     * by `booking_id`: the refund trigger leaves the booking reading `paid`,
     * the client is never emailed, and their portal totals nothing.
     *
     * `.is('booking_id', null)` is required with it: a row the webhook DID
     * link must never be moved to another booking.
     */
    const branch = duplicateBranch();

    expect(branch).toContain('booking_id: booking.id');
    expect(branch).toContain("is('booking_id', null)");
    /* Scoped to the owner, like every other write on this service-role path. */
    expect(branch).toContain("eq('user_id', ownerId)");
  });

  it('continues finalising rather than returning', () => {
    /*
     * The whole lesson. The constraint did its job — it stopped the money being
     * counted twice. What was wrong was reading that as "the payment is not
     * recorded" and abandoning the confirmation.
     */
    const branch = duplicateBranch();

    expect(branch).not.toMatch(/return NextResponse\.json\(\s*\{\s*success:\s*false/);
  });
});

describe('#18 · the receipt states what was charged', () => {
  /*
   * This sent `serviceDetails.price` unconditionally, so a client who paid the
   * first ₪333 of a three-part plan received a receipt for ₪1,000 — a document
   * telling them they had paid three times what left their account.
   */
  it('a plan receipt carries the first period, not the agreement', () => {
    const amount = code.slice(
      code.indexOf('const chargedAmount ='),
      code.indexOf('const chargedAmount =') + 360
    );

    expect(amount).toContain('isPlanBooking');
    expect(amount).toContain('planPhases(');
    expect(amount).toContain('[0].amountMinor');
  });

  it('and a single payment still carries the price', () => {
    const amount = code.slice(
      code.indexOf('const chargedAmount ='),
      code.indexOf('const chargedAmount =') + 360
    );

    expect(amount).toContain('serviceDetails.price');
  });

  it('the figure reaches the email', () => {
    const send = code.slice(
      code.indexOf('BookingEmailService.sendPaymentReceipt('),
      code.indexOf('BookingEmailService.sendPaymentReceipt(') + 300
    );

    expect(send).toContain('amount: chargedAmount');
    expect(send).not.toContain('amount: serviceDetails.price');
  });

  it('the first period is computed by the shared splitter', () => {
    /*
     * `planPhases` is the same split Stripe's prices are built from. A local
     * `price / count` would disagree with the processor by a rounding
     * remainder, and the receipt would be a document contradicting the bank.
     */
    expect(code).toContain("import { planPhases } from '@/lib/payments/planSchedule';");
    expect(code).toContain("import { fromMinorUnits } from '@/lib/payments/refundMath';");
  });

  it('a failed receipt never fails the finalisation', () => {
    /* The booking is paid for and confirmed. An email transport having a bad
       minute is not a reason to tell the client their payment did not land. */
    const send = code.slice(
      code.indexOf('BookingEmailService.sendPaymentReceipt('),
      code.indexOf('BookingEmailService.sendPaymentReceipt(') + 420
    );

    expect(send).toContain('.catch(');
  });
});
