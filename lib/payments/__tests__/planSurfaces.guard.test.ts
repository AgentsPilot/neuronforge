/**
 * §3 verification: what a plan lights up once its rows exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The plan for this work assumed the drawer, the reminders and the cancellation
 * chain "already work and only need confirming". Two of those three assumptions
 * were wrong, and checking is how that surfaced. These pin what is actually
 * true, so the next reader inherits the verified version rather than the
 * assumed one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('the contact drawer needs BOTH tables, which is why §0 and §1 are load-bearing', () => {
  /*
   * The drawer does not query instalments itself — it takes `item.plan` from
   * the money endpoint. That endpoint builds the periods from the PROJECTED
   * INSTALMENTS and then enriches each with its subscription's status.
   *
   * So a plan appears in the drawer only if `projectPeriods` wrote rows, which
   * needs a `payment_plans` row to point at (§1) and needs not to throw on the
   * way (§0). Either missing, and the drawer shows nothing at all.
   */
  it('the drawer reads plans from the money endpoint, not from its own query', () => {
    const section = read('components/crm/contact-drawer/PaymentsSection.tsx');

    expect(section).toMatch(/fetchContactMoney\(contactId\)/);
    expect(section).not.toMatch(/from\('payment_plan_installments'\)/);
  });

  it('the money endpoint takes the periods from the projected instalments', () => {
    const route = read('app/api/payments/money/route.ts');
    expect(route).toMatch(/plansByBookingId/);
  });

  it('and takes the STATUS from the subscription, so a stopped plan stops reading active', () => {
    const route = read('app/api/payments/money/route.ts');
    const block = route.slice(route.indexOf('payment_plan_subscriptions'));

    expect(block).toMatch(/select\('id, booking_id, status'\)/);
  });

  it('projectPeriods is therefore the only writer of those rows for a website plan', () => {
    const binder = read('lib/payments/bindPlanSubscription.ts');

    expect(binder).toMatch(/from\('payment_plan_installments'\)\.insert\(/);
    // And it returns early without writing when there is no plan row to point
    // at — the state §1 exists to prevent.
    expect(binder).toMatch(/if \(!planRowId\)/);
  });
});

describe('cancelling a booking reports a live plan rather than stopping it', () => {
  /*
   * Deliberate: a plan can fund more than one booking, so ending it is a
   * person's decision. What makes that safe is that every surface is loud about
   * it — the assertion here is that the reporting is still wired, because a
   * silent `planLive` is a client whose card keeps being charged after the
   * appointment was called off.
   */
  it('the cancel route returns the flag and the periods left', () => {
    const route = read('app/api/scheduling/bookings/[id]/cancel/route.ts');

    expect(route).toMatch(/plan_live: result\.data!\.planLive/);
    expect(route).toMatch(/periods_remaining: result\.data!\.periodsRemaining/);
  });

  it('the drawer acts on it instead of closing quietly', () => {
    const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');

    expect(drawer).toMatch(/const planLive = data\.plan_live === true/);
    expect(drawer).toMatch(/held > 0 \|\| planLive/);
  });

  it('the client-facing cancel says the plan is still charging', () => {
    const route = read('app/api/book/manage/[token]/cancel/route.ts');
    expect(route).toMatch(/planStillCharging/);
  });

  it('stopping a plan cancels the schedule and never releases it', () => {
    // `release` DETACHES the schedule and the subscription then bills forever.
    const cancel = read('lib/payments/cancelPlan.ts');

    expect(cancel).toMatch(/subscriptionSchedules\.cancel/);
    expect(cancel).not.toMatch(/subscriptionSchedules\.release\(/);
  });

  it('a cancelled booking with a live plan raises a gap', () => {
    const gaps = read('lib/business-os/gaps/definitions.ts');
    expect(gaps).toMatch(/planLive:/);
  });
});

describe('a period Stripe already collected is marked paid, not left pending', () => {
  /*
   * This is what keeps the overdue chaser off a working plan: the chaser scans
   * `payment_plan_installments` for `pending` rows past their due date, with no
   * exclusion for subscription-backed ones. The row closing promptly is the
   * only thing standing between a client and being chased for money Stripe is
   * taking anyway.
   */
  it('the webhook closes the instalment by subscription and period number', () => {
    const webhook = read('app/api/stripe/webhook/route.ts');
    const record = webhook.slice(webhook.indexOf('async function recordPlanPeriodPaid'));

    expect(record).toMatch(/from\('payment_plan_installments'\)[\s\S]{0,200}status: 'paid'/);
    expect(record).toMatch(/\.eq\('installment_number', periodsPaid\)/);
  });

  it('the overdue chaser only looks at rows still pending', () => {
    const reminders = read('lib/services/PaymentReminderService.ts');
    const pass = reminders.slice(reminders.indexOf('// Get overdue installments'));

    expect(pass.slice(0, 400)).toMatch(/\.eq\('status', 'pending'\)/);
  });
});
