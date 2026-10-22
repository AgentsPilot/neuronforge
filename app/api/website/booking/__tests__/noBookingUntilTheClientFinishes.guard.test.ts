/**
 * A booking exists only once the client has finished paying.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `create` wrote the `scheduling_bookings` row when the client SUBMITTED THEIR
 * DETAILS — before they had paid, for every service that takes money. A client
 * who opened the card dialog and closed it left a booking behind, and because
 * `pending` is in `SLOT_HOLDING_STATUSES` and `scheduling_bookings_no_overlap`
 * enforces it in the database, that slot was locked against every other client.
 *
 * Permanently. No cron touches `scheduling_bookings`, and
 * `checkout.session.expired` is handled only for the platform's own billing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THE FIX, AND WHY IT IS SHAPED THAT WAY
 *
 * An EARLY RETURN in `create`, before any write. Everything above it is a check
 * — bookable, readiness, slot free, not a closed day. Every write is below it.
 *
 * That matters more than it looks. The four hundred lines below are fifteen
 * recorded production bugs deep, and every one is about writing the right thing
 * in the right order for a booking being made NOW. Threading a second meaning
 * through them is how the sixteenth gets written. Returning before any of them
 * run leaves the six service types that take no money on exactly the code they
 * ran yesterday.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SOURCE, NOT BEHAVIOUR
 *
 * Reaching these lines needs a subdomain, a website page, a service, a Stripe
 * capability lookup and six Supabase tables. The two existing guards for these
 * routes read the source for the same stated reason: the row is correct and the
 * service layer is correct — what broke was the WIRING.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const createSrc = read('app/api/website/booking/create/route.ts');
const create = strip(createSrc);
const finalize = strip(read('app/api/website/booking/finalize/route.ts'));
const widget = strip(read('app/site/[subdomain]/book/BookingWidget.tsx'));
const checkout = strip(read('app/api/website/checkout/route.ts'));
const materialise = strip(read('lib/scheduling/materialiseAttempt.ts'));
const processFlow = strip(read('components/website/blocks/ProcessFlowSection.tsx'));

describe('this guard reads the code, not its own explanation', () => {
  it('strips the comments that describe the old behaviour', () => {
    expect(createSrc).toContain('A SERVICE THAT TAKES MONEY WRITES NOTHING YET');
    expect(create).not.toContain('A SERVICE THAT TAKES MONEY WRITES NOTHING YET');
  });
});

describe('create writes nothing when money is owed', () => {
  it('returns before any write', () => {
    /*
     * The assertion the whole change rests on. If the early return moves below
     * the contact insert, an abandoned checkout starts leaving contacts again;
     * below the booking insert, the original bug is back.
     */
    const earlyReturn = create.indexOf('if (requiresPayment) {');
    const contactInsert = create.indexOf("from('crm_contacts')");
    const bookingInsert = create.indexOf("from('scheduling_bookings')\n      .insert({");

    expect(earlyReturn).toBeGreaterThan(-1);
    expect(earlyReturn).toBeLessThan(contactInsert);
    if (bookingInsert > -1) expect(earlyReturn).toBeLessThan(bookingInsert);
  });

  it('records the attempt instead', () => {
    expect(create).toContain("import { openAttempt } from '@/lib/scheduling/abandonedBookings';");
    expect(create).toContain('const attemptId = await openAttempt({');
  });

  it('returns no booking at all', () => {
    /*
     * Deliberate. The client used to read `data.booking.id` and carry it to the
     * payment step; returning an attempt id under that name would have
     * `finalize` look up a booking that does not exist — failing AFTER the
     * client had paid. The absence makes an un-updated caller fail loudly and
     * immediately instead.
     */
    const block = create.slice(
      create.indexOf('if (requiresPayment) {'),
      create.indexOf('if (requiresPayment) {') + 1400
    );

    expect(block).toContain('attempt_id: attemptId');
    expect(block).toContain('requires_payment: true');
    expect(block).not.toMatch(/booking:\s*\{\s*id/);
  });
});

describe('every check still runs first', () => {
  /*
   * The early return must sit AFTER the gates, or a card booking stops being
   * validated at all: a client could book a closed day, a taken slot, or a
   * service from a business that cannot honour it.
   */
  const earlyReturn = () => create.indexOf('if (requiresPayment) {');

  it('after the readiness gate', () => {
    expect(create.indexOf('journeyGaps(ownerId')).toBeLessThan(earlyReturn());
  });

  it('after the closed-day check', () => {
    expect(create.indexOf('closedDayVerdict(')).toBeLessThan(earlyReturn());
  });

  it('after the slot check', () => {
    /* `busyMeetings` is the single definition of what occupies time, so a
       route that does not reach it does not check the slot at all. */
    expect(create.indexOf('busyMeetings(')).toBeLessThan(earlyReturn());
  });

  it('and after the service is loaded whole', () => {
    expect(create.indexOf('schedulingServiceRepository.findById')).toBeLessThan(earlyReturn());
  });
});

describe('the six paths that take no money are untouched', () => {
  it('the return is gated on requiresPayment alone', () => {
    /*
     * Free, invoice-collected, card-with-no-processor, quote request, product
     * and package all fall straight through. For them this route IS the last
     * stage of the journey — there is no window in which to abandon anything.
     */
    expect(create).toContain('if (requiresPayment) {');
    expect(create).not.toMatch(/if \(requiresPayment \|\|/);
  });

  it('they still write a booking below', () => {
    expect(create).toContain('const insertResult = reusable');
  });

  it('and `requiresPayment` is still the shared decision', () => {
    expect(create).toContain('const requiresPayment = shouldTakePayment(');
  });
});

describe('finalize creates the booking', () => {
  it('accepts an attempt as well as a booking', () => {
    expect(finalize).toContain("attempt_id: z.string().uuid('Invalid attempt ID').optional()");
    expect(finalize).toContain("booking_id: z.string().uuid('Invalid booking ID').optional()");
  });

  it('refuses a request carrying neither', () => {
    expect(finalize).toContain('One of booking_id or attempt_id is required');
  });

  it('materialises before its existing work', () => {
    /* The whole reason this shape is safe: everything below operates on a real
       booking row and runs exactly as it did before. */
    expect(finalize).toContain('const made = await materialiseAttempt(attempt);');
    expect(finalize.indexOf('materialiseAttempt(attempt)')).toBeLessThan(
      finalize.indexOf("from('scheduling_bookings')")
    );
  });

  it('only on a successful payment', () => {
    /* A failed or pending finalisation leaves the attempt open, so the client
       can try again on the same record. */
    const block = finalize.slice(
      finalize.indexOf('if (!bookingId && data.attempt_id)'),
      finalize.indexOf('if (!bookingId && data.attempt_id)') + 500
    );

    expect(block).toContain("data.payment_status !== 'paid'");
  });

  it('the lookup uses the resolved id, not the request field', () => {
    /* `data.booking_id` is optional now. Looking up by it would find nothing on
       every card journey. */
    expect(finalize).toContain(".eq('id', bookingId)");
    expect(finalize).not.toContain(".eq('id', data.booking_id)");
  });
});

describe('the booking that gets created is a finished one', () => {
  it('confirmed and paid, never pending', () => {
    /*
     * Anchored on a field unique to the BOOKING insert. This file has three
     * other candidates: the first `scheduling_bookings` is the slot check, and
     * the first `.insert({` is the contact.
     */
    const at = materialise.indexOf('service_id: attempt.service_id');
    expect(at).toBeGreaterThan(-1);
    const insert = materialise.slice(at, at + 600);

    expect(insert).toContain("status: 'confirmed'");
    expect(insert).toContain("payment_status: 'paid'");
    expect(insert).not.toContain("status: 'pending'");
  });

  it('is idempotent on the attempt', () => {
    /* `finalize` can be called twice — the browser retries, and the webhook may
       race it. Two bookings for one payment is the worst outcome available. */
    expect(materialise).toContain('if (attempt.booking_id) {');
  });

  it('re-checks the slot, because nothing held it', () => {
    expect(materialise).toContain('slotStillFree(attempt)');
    expect(materialise).toContain('busyMeetings(');
  });

  it('treats the overlap constraint as the authority', () => {
    /* A 23P01 means somebody took the slot between the check and the insert —
       the race the check cannot close. Reported as the slot being gone, not as
       a fault, because the caller has to refund rather than retry. */
    expect(materialise).toContain("=== '23P01'");
    expect(materialise).toContain("reason: 'slot_taken'");
  });

  it('never moves an existing contact\'s stage', () => {
    /*
     * Entry #8 of the recorded bugs, carried over: the route must not decide a
     * contact's stage. `promote_contact_on_payment (which replaced the dropped promote_contact_on_confirmed_booking, 20260920)` moves them when
     * the booking is written `confirmed`.
     */
    const contact = materialise.slice(
      materialise.indexOf('async function resolveContact'),
      materialise.indexOf('async function slotStillFree')
    );

    expect(contact).not.toContain('stage');
  });
});

describe('the money is confirmed with Stripe, not with the browser', () => {
  /*
   * ── WHAT THIS SUITE WAS MISSING ─────────────────────────────────────────
   *
   * Every rule above is about not creating a booking before the money. None
   * asked how the route KNOWS there is money. It read `payment_status` out of
   * the request body — a field the browser sends — so a POST carrying a valid
   * attempt uuid and `payment_status: 'paid'` created a contact and a
   * confirmed, paid booking with nothing behind it.
   *
   * The route already applied the right standard to a different question
   * forty lines down: "this route finalises from the client, so nothing it
   * sends is evidence."
   */
  const FINALIZE = read('app/api/website/booking/finalize/route.ts');

  it('verifies before it materialises', () => {
    const verify = FINALIZE.indexOf('verifyAttemptPayment(attempt');
    const make = FINALIZE.indexOf('materialiseAttempt(attempt)');
    expect(verify).toBeGreaterThan(-1);
    expect(make).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(make);
  });

  it('and refuses when it cannot be confirmed', () => {
    expect(FINALIZE).toContain("code: 'payment_unverified'");
    /* 402, not 400: the request was well formed, the money was not there. */
    expect(FINALIZE).toContain('{ status: 402 }');
  });

  it('and the charge has to belong to THIS attempt', () => {
    /*
     * Without it, one real succeeded PaymentIntent for the business would
     * finalise any attempt — a single payment reused to mint bookings.
     */
    const VERIFY = read('lib/scheduling/verifyAttemptPayment.ts');
    expect(VERIFY).toContain('stamped !== attempt.id');
    expect(VERIFY).toContain("reason: 'wrong_attempt'");
  });

  it('and the PaymentIntent is stamped with it in the first place', () => {
    const PI = read('app/api/website/payment-intent/route.ts');
    const metadata = PI.slice(PI.indexOf('automatic_payment_methods'));
    expect(metadata.slice(0, 1400)).toContain("attempt_id: data.attempt_id || ''");
  });
});

describe('a client who pays and never comes back still gets their booking', () => {
  /*
   * The browser returning was the ONLY thing that could create the booking.
   * A closed tab, a sleeping phone during 3DS, a dropped redirect on mobile
   * data — the card is charged at Stripe and nothing on our side ever hears.
   * The client was left charged with no booking and no contact, and the
   * attempt sat at `started` for ever with nothing surfacing it.
   *
   * `website/checkout` has always put the attempt in the session metadata,
   * calling it "the only signal that survives a closed tab". Nothing read it.
   */
  const WEBHOOK = read('app/api/stripe/webhook/route.ts');
  const CHECKOUT = read('app/api/website/checkout/route.ts');

  it('the webhook reads the attempt off the paid session', () => {
    expect(WEBHOOK).toContain('session.metadata?.attempt_id');
    expect(WEBHOOK).toContain("session.payment_status === 'paid'");
    expect(WEBHOOK).toContain('await materialiseAttempt(attempt)');
  });

  it('and the session is tied to the attempt when it is created', () => {
    /* So a charge can be matched BACKWARDS to its attempt. The column has
       existed since 20261070 with nothing writing it. */
    expect(CHECKOUT).toContain('await attachCheckoutSession(data.attempt_id, session.id)');
  });

  it('and both arriving creates one booking, not two', () => {
    /* `materialiseAttempt` returns the existing booking when the attempt
       already carries one, so the webhook and the redirect racing is safe. */
    const MAT = read('lib/scheduling/materialiseAttempt.ts');
    expect(MAT).toContain('alreadyDone');
  });
});

describe('the card step can actually start a payment', () => {
  /*
   * ── THE BLOCKER THIS SUITE DID NOT CATCH ────────────────────────────────
   *
   * Every rule above is about NOT creating a booking before the money, and
   * they all held. What none of them asked was whether the payment step still
   * works once there is no booking to point at.
   *
   * It did not. `PaymentStep` guarded its PaymentIntent effect with
   * `if (!bookingId) return;` and keyed its cache, its in-flight map and its
   * dependency array on the same value — while the card journey mounts it with
   * `bookingId={bookingId || ''}` by construction. So `paymentReady` never
   * flipped and the card form was a permanent spinner on the one journey that
   * needs it. The request body had already been taught to send `attempt_id`;
   * nothing ever reached it.
   *
   * Read as source rather than rendered: the failure is an early return inside
   * an effect, which renders as "a spinner, still" and asserts as nothing.
   */
  const FLOW = read('components/website/blocks/ProcessFlowSection.tsx');

  it('keys the payment on whichever id this journey has', () => {
    expect(FLOW).toContain('const paymentKey = attemptId || bookingId;');
  });

  it('and never gates that effect on the booking alone', () => {
    const effect = FLOW.slice(
      FLOW.indexOf('Initialize Stripe PaymentIntent'),
      FLOW.indexOf('Initialize Stripe PaymentIntent') + 2000
    );
    expect(effect).toContain('if (!paymentKey)');
    expect(effect).not.toContain('if (!bookingId)');
  });

  it('and the cache and in-flight map use the same key', () => {
    /* Keyed on the empty string, every card journey shared one cache entry and
       one in-flight promise with every other card journey. */
    expect(FLOW).toContain('getPaymentIntentCache()[paymentKey]');
    expect(FLOW).toContain('inFlightRequests.get(paymentKey)');
    expect(FLOW).toContain('inFlightRequests.set(paymentKey, request)');
    expect(FLOW).toContain('}, [paymentKey]);');
  });

  it('and the step is still handed the attempt', () => {
    expect(FLOW).toContain('attemptId={attemptId}');
  });
});

describe('the attempt survives the round trip to Stripe', () => {
  it('the widget carries it instead of a booking id', () => {
    expect(widget).toContain('const [attemptId, setAttemptId]');
    expect(widget).toContain('setAttemptId(data.attempt_id || null)');
  });

  it('the return URL carries whichever id this journey has', () => {
    /* Sending `booking_id=null` is how the return handler would come back with
       nothing to finalise. */
    expect(widget).toContain('const returnParam = attemptId');
  });

  it('the checkout route passes it to Stripe metadata', () => {
    expect(checkout).toContain('attempt_id: z.string().uuid().optional()');
    expect(checkout).toContain("attempt_id: data.attempt_id || ''");
  });

  it('and the widget finalises with it on the way back', () => {
    expect(widget).toContain("const attemptIdFromUrl = urlParams.get('attempt_id');");
    expect(widget).toContain('attempt_id: attemptIdFromUrl');
  });

  it('the language travels, for the abandoned-booking email', () => {
    expect(widget).toMatch(/\n\s+locale,/);
    expect(create).toContain('locale: z.string().max(10).optional()');
  });
});

describe('BOTH public surfaces carry the attempt', () => {
  /*
   * There are two booking surfaces and they are easy to forget about one at a
   * time. `BookingWidget` redirects to Stripe and comes back through the URL;
   * `ProcessFlowSection` takes the card in place, so the id stays in React
   * state and is handed down to `PaymentStep` as a prop.
   *
   * A surface left on the old shape sends `booking_id: null` to `finalize`
   * AFTER the client has paid — the worst moment available to fail.
   */
  it('ProcessFlowSection holds the attempt', () => {
    expect(processFlow).toContain('const [attemptId, setAttemptId]');
    expect(processFlow).toContain('setAttemptId(data.attempt_id || null)');
  });

  it('and hands it to the step that pays', () => {
    /* `PaymentStep` is a child component: the state is two scopes away from
       the `finalize` calls that need it. */
    expect(processFlow).toContain('attemptId?: string | null;');
    expect(processFlow).toContain('attemptId={attemptId}');
  });

  it('both of its finalize calls send it', () => {
    /* One for the card payment, one for the no-charge finalisation. Updating
       only the obvious one leaves the other broken. */
    /* Matched on the FINALIZE shape — `attempt_id` paired with the payment
       status — because the payment-intent call carries the id too and would
       otherwise be counted as a third finalisation. */
    const sends = processFlow.match(/attempt_id: attemptId, payment_status/g) ?? [];

    expect(sends.length).toBe(2);
  });

  it('and it sends the language too', () => {
    expect(processFlow).toMatch(/\n\s+locale,/);
  });

  it('its payment-intent call never sends an empty booking_id', () => {
    /*
     * `booking_id` is validated as a uuid. A card journey now carries the empty
     * string — `bookingId={bookingId || ''}` — so sending it unconditionally
     * fails validation and the card step never loads at all. This was a real
     * break introduced by deferring the booking, caught before it shipped.
     */
    const intent = readFileSync(
      join(process.cwd(), 'app/api/website/payment-intent/route.ts'),
      'utf8'
    );

    expect(intent).toContain('attempt_id: z.string().uuid().optional()');
    expect(processFlow).toContain('...(bookingId ? { booking_id: bookingId } : {})');
    expect(processFlow).toContain('...(attemptId ? { attempt_id: attemptId } : {})');
  });

  it('neither surface sends a bare booking_id on a card journey', () => {
    /* The conditional spread is what makes this true: an attempt journey sends
       `attempt_id`, everything else sends `booking_id`. */
    /* The SHAPE, not the variable name: the widget reads its id back from the
       return URL, so it is `bookingIdFromUrl` there and `bookingId` here. */
    for (const src of [widget, processFlow]) {
      expect(src).toMatch(/\?\s*\{\s*attempt_id:/);
      expect(src).toMatch(/:\s*\{\s*booking_id:/);
    }
  });
});

describe('the attempt record blocks nothing', () => {
  it('no availability check reads the table', () => {
    /*
     * The property that makes this safe. If an availability reader ever learns
     * about `abandoned_bookings`, an attempt becomes a hold — and a hold that
     * nothing expires is the bug this replaced.
     */
    for (const path of [
      'app/api/website/booking/availability/route.ts',
      'app/api/website/scheduling/availability/route.ts',
      'app/api/website/booking/create/route.ts',
    ]) {
      const src = strip(read(path));
      const slotCheck = src.slice(0, src.indexOf('if (requiresPayment) {') + 1);

      expect(slotCheck).not.toContain('abandoned_bookings');
    }
  });
});
