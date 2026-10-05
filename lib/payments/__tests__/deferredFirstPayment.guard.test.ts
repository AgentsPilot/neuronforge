/**
 * A payment plan whose first payment is not due today.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The owner could set "first payment N days after booking" in the Services
 * settings, it saved, and then the client could not book at all: the embedded
 * payment route refused with `PLAN_DEFERRED_START_UNSUPPORTED`. `planStartDate`
 * — the function that computes the date — had no caller anywhere in production,
 * and no cron scanned for a plan payment becoming due, so nothing would ever
 * have collected it.
 *
 * The design is a TRIALLING subscription: Stripe raises no invoice during the
 * trial, hands back a SetupIntent for the card, and charges that card itself
 * when the trial ends. Collection stays with Stripe, so no new scheduler holds
 * a card.
 *
 * These are source-level because the route's body is a Stripe call. What they
 * protect is the set of decisions that make the feature correct, each of which
 * fails silently and in a way that costs money or trust.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { planStartDate } from '../PaymentPlanService';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const ROUTE = 'app/api/website/payment-intent/route.ts';
const FORM = 'components/website/blocks/StripePaymentForm.tsx';
const DIALOG = 'components/website/blocks/ProcessFlowSection.tsx';

describe('the route no longer refuses a deferred plan', () => {
  const route = read(ROUTE);

  it('has dropped the refusal', () => {
    // Matched on the RETURNED code, not on prose: the comment there names the
    // old code to explain what replaced it.
    expect(route).not.toMatch(/code:\s*'PLAN_DEFERRED_START_UNSUPPORTED'/);
  });

  it('gives planStartDate the production caller it never had', () => {
    expect(route).toMatch(/import \{[^}]*planStartDate[^}]*\} from '@\/lib\/payments\/PaymentPlanService'/);
    expect(route).toMatch(/planStartDate\(planTerms, bookedAt\)/);
  });

  it('defers only when the date is genuinely in the future', () => {
    // 'days_after' with 0 days resolves to now. Asking Stripe for a trial that
    // has already ended is an error, and "0 days after booking" honestly means
    // on booking.
    expect(route).toMatch(/planStartsAt\.getTime\(\) > bookedAt\.getTime\(\)/);
  });

  it('sets trial_end only on the deferred path', () => {
    expect(route).toMatch(/deferred[\s\S]{0,200}trial_end: Math\.floor\(planStartsAt\.getTime\(\) \/ 1000\)/);
  });

  it('cancels the plan if no card survives the trial', () => {
    // The default leaves an active subscription collecting nothing, which is
    // the state hardest to notice.
    expect(route).toMatch(/missing_payment_method: 'cancel'/);
  });

  it('expands the SetupIntent when deferred and the invoice secret otherwise', () => {
    expect(route).toMatch(
      /expand: deferred \? \['pending_setup_intent'\] : \['latest_invoice\.confirmation_secret'\]/
    );
  });

  it('tells the client which kind of secret it is handing back', () => {
    // Guessing from the secret's prefix is a rule written in two places that
    // can disagree, and it fails at the last step of a booking.
    expect(route).toMatch(/intentKind: 'payment' \| 'setup'/);
    expect(route).toMatch(/intentKind,/);
  });

  it('returns no figure the caller does not consult', () => {
    // `amountDueNow` was returned and read by nobody. A second amount in a
    // money response that no caller checks is one more thing that can drift
    // out of agreement with what is actually charged.
    expect(route).not.toMatch(/amountDueNow/);
  });
});

describe('the form confirms the right kind of intent', () => {
  const form = read(FORM);

  it('uses confirmSetup for a setup secret', () => {
    expect(form).toMatch(/if \(intentKind === 'setup'\)[\s\S]{0,300}stripe\.confirmSetup\(/);
  });

  it('leaves the payment path on confirmPayment', () => {
    expect(form).toMatch(/stripe\.confirmPayment\(/);
  });

  it('defaults to payment, so every existing caller is unchanged', () => {
    expect(form).toMatch(/intentKind = 'payment'/);
  });

  it('never reports a saved card it has no confirmation of', () => {
    // Claiming success would leave a plan reading as set up that then collects
    // nothing on the day.
    const branch = form.slice(form.indexOf("if (intentKind === 'setup')"), form.indexOf('stripe.confirmPayment('));
    expect(branch).toMatch(/setupIntent\.status === 'succeeded'/);
    expect(branch).toMatch(/else \{[\s\S]{0,200}saveFailed/);
  });

  it('does not say "Pay" when nothing is being paid', () => {
    expect(form).toMatch(/intentKind === 'setup' \? labels\.saveCard/);
  });

  it('says what happens instead, and when', () => {
    expect(form).toMatch(/labels\.noChargeToday/);
    expect(form).toMatch(/labels\.firstChargeOn/);
  });

  it.each(['saveCard', 'firstChargeOn', 'noChargeToday', 'saveFailed'])(
    'has %s in all three locales',
    key => {
      // en / es / he. A missing one renders as undefined on a payment screen.
      expect(form.match(new RegExp(`${key}:`, 'g'))).toHaveLength(3);
    }
  );
});

describe('the dialog carries the kind from the route to the form', () => {
  const dialog = read(DIALOG);

  it('reads it off the response', () => {
    expect(dialog).toMatch(/intentKind: data\.intentKind === 'setup' \? 'setup' : 'payment'/);
  });

  it('passes it to the form', () => {
    expect(dialog).toMatch(/intentKind=\{paymentData\.intentKind\}/);
    expect(dialog).toMatch(/firstChargeAt=\{paymentData\.firstChargeAt\}/);
  });

  it('keeps it through the per-booking cache, which survives a remount', () => {
    // The cache was typed narrower than the info it holds, so a remount would
    // have type-erased the kind and silently fallen back to 'payment'.
    expect(dialog).toMatch(/function getPaymentIntentCache\(\): Record<string, PaymentIntentInfo>/);
  });
});

describe('planStartDate, the function this finally uses', () => {
  const TERMS = {
    totalAmount: 200,
    currency: 'ILS',
    installmentCount: 2,
    frequency: 'weekly' as const,
    firstPaymentDue: 'days_after' as const,
    firstPaymentDays: 7,
  };

  it('moves the start by the configured days', () => {
    const booked = new Date('2026-09-29T10:00:00.000Z');
    expect(planStartDate(TERMS, booked).toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });

  it('leaves an on-booking plan starting now', () => {
    const booked = new Date('2026-09-29T10:00:00.000Z');
    expect(planStartDate({ ...TERMS, firstPaymentDue: 'on_booking' }, booked)).toEqual(booked);
  });

  it('clamps a negative day count rather than starting in the past', () => {
    const booked = new Date('2026-09-29T10:00:00.000Z');
    // Which is why the route also tests the result against now: this returns
    // `booked`, and a trial ending in the past is a Stripe error.
    expect(planStartDate({ ...TERMS, firstPaymentDays: -5 }, booked)).toEqual(booked);
  });
});

/**
 * The dated list replaced the summary that could not tell the truth.
 *
 * The old block rendered dots, "Due today: ₪100", "Then: N × ₪100" and a total.
 * It never said WHEN, and "Due today" was asserted on every plan — including a
 * deferred one that charges nothing at checkout. Both faults were the same
 * missing piece: the dialog had the amounts and not the calendar.
 */
describe('the public dialog shows a dated list of payments', () => {
  const dialog = read(DIALOG);

  it('renders the list in all three places a plan appears', () => {
    // Details, payment and confirmation. One component, so the same plan
    // cannot be described three different ways.
    expect(dialog.match(/<PlanPaymentList/g)).toHaveLength(3);
  });

  it('has dropped the dot row that stood in for a schedule', () => {
    expect(dialog).not.toMatch(/Array\.from\(\{ length: Math\.min\(/);
  });

  it('fixes the clock once per mount rather than reading it while rendering', () => {
    // Otherwise the three panels drift apart, and a midnight crossing moves
    // the dates under a client mid-booking.
    expect(dialog.match(/const renderedAt = useMemo\(\(\) => new Date\(\), \[\]\)/g)).toHaveLength(3);
  });

  it('gives the confirmation step the past tense, not "due"', () => {
    expect(dialog).toMatch(/dueToday: labels\.paidToday/);
  });

  it('has the deferred line in all three locales', () => {
    // Only the label DEFINITIONS: the name also appears three more times where
    // it is passed down to the list.
    expect(dialog.match(/nothingDueToday: '/g)).toHaveLength(3);
  });
});

describe('the list itself never claims a payment that is not happening', () => {
  const list = read('components/website/blocks/PlanPaymentList.tsx');

  it('marks nothing as due today when the plan is deferred', () => {
    expect(read('lib/payments/planDisplaySchedule.ts')).toMatch(
      /dueToday: !deferred && item\.installmentNumber === 1/
    );
  });

  it('takes its dates from the same functions the server schedules Stripe with', () => {
    // Two calculations that agree by coincidence would drift the first time
    // either changed.
    const schedule = read('lib/payments/planDisplaySchedule.ts');
    expect(schedule).toMatch(/planStartDate\(terms, now\)/);
    expect(schedule).toMatch(/planSchedule\(/);
  });

  it('shows a count rather than a bare ellipsis when rows are capped', () => {
    expect(list).toMatch(/\+\{hidden\}/);
  });

  it('totals from the schedule, so the total matches the rows shown', () => {
    expect(list).toMatch(/formatAmount\(schedule\.total/);
  });
});

/**
 * The gap that analysis found and the tests above did not.
 *
 * `bindPlanSubscription` attaches the Subscription Schedule that caps a plan at
 * its agreed number of periods. Without it the subscription bills forever. It
 * was reachable from `invoice.paid` and `checkout.session.completed` only — and
 * a deferred plan produces NEITHER: Stripe raises no invoice during a trial, and
 * the embedded card form creates no Checkout Session.
 *
 * So a deferred plan sat unbounded, unmirrored and invisible for the whole
 * trial, and bound only at the first charge — the same `invoice.paid` that
 * failed in production on 2026-09-29. These assert the events, which is the
 * layer the earlier tests missed: they checked what the route sends to Stripe,
 * never which webhook comes back.
 */
describe('a trialling plan is bounded before its first charge', () => {
  const webhook = read('app/api/stripe/webhook/route.ts');

  it('handles customer.subscription.created for connected accounts', () => {
    expect(webhook).toMatch(/case 'customer\.subscription\.created':/);
    expect(webhook).toMatch(/if \(!isConnectEvent\) break;\s*\n\s*await handleConnectPlanSubscriptionCreated/);
  });

  it('binds only a trialling subscription, never an incomplete one', () => {
    // A schedule cannot be created from an `incomplete` subscription, which is
    // why the immediate path still waits for payment.
    const fn = webhook.slice(webhook.indexOf('async function handleConnectPlanSubscriptionCreated'));
    expect(fn.slice(0, 600)).toMatch(/if \(subscription\.status !== 'trialing'\) return;/);
  });

  it('refuses a plan whose metadata claims an owner the account does not own', () => {
    const fn = webhook.slice(webhook.indexOf('async function handleConnectPlanSubscriptionCreated'));
    expect(fn.slice(0, 1600)).toMatch(/await accountOwns\(connectAccountId, planMeta\.owner_id\)/);
  });

  it('rethrows, so Stripe retries rather than leaving it unbounded', () => {
    const fn = webhook.slice(webhook.indexOf('async function handleConnectPlanSubscriptionCreated'));
    expect(fn.slice(0, 2600)).toMatch(/throw bindError/);
  });

  it('leaves the platform path alone', () => {
    // A connected account's own subscriptions are its business.
    const fn = webhook.slice(webhook.indexOf("case 'customer.subscription.created'"));
    expect(fn.slice(0, 300)).toMatch(/if \(!isConnectEvent\) break;/);
  });
});

describe('a deferred booking is not called paid before any money moves', () => {
  it('the dialog reports pending for a saved card, paid for a charge', () => {
    const dialog = read(DIALOG);
    expect(dialog).toMatch(/payment_status: paymentData\?\.intentKind === 'setup' \? 'pending' : 'paid'/);
  });

  it('finalize accepts pending and still confirms the booking', () => {
    const finalize = read('app/api/website/booking/finalize/route.ts');
    expect(finalize).toMatch(/payment_status: z\.enum\(\['pending', 'paid', 'failed'\]\)/);
    expect(finalize).toMatch(/status: 'confirmed'/);
  });

  it('the webhook flips it to paid when the money actually arrives', () => {
    // Without this the deferred booking reads `pending` for ever, through
    // every period — the regression the `pending` change would have caused.
    const webhook = read('app/api/stripe/webhook/route.ts');
    const record = webhook.slice(webhook.indexOf('async function recordPlanPeriodPaid'));

    expect(record).toMatch(/from\('scheduling_bookings'\)[\s\S]{0,160}payment_status: 'paid'/);
    expect(record).toMatch(/\.eq\('user_id', plan\.data\.user_id\)/);
  });

  it('does not fail the webhook if only the booking update fails', () => {
    // The money is the part that must not be lost.
    const webhook = read('app/api/stripe/webhook/route.ts');
    const record = webhook.slice(webhook.indexOf('async function recordPlanPeriodPaid'));
    const branch = record.slice(record.indexOf('if (bookingError)'));

    expect(branch.slice(0, 400)).not.toMatch(/throw/);
  });
});
