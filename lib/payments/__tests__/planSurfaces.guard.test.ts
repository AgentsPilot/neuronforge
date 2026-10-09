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
import * as ts from 'typescript';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/*
 * CF-5 PR 4 moved the webhook's and the binder's queries on these tables into
 * repositories (workplan BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES §7.3.5, SA
 * C-2). The checks below follow each query into the method that now holds it,
 * and keep a check on the caller that it calls that method. Both are read from
 * the AST, so a slice ends where the function or method ends (C-2: the old
 * `recordPlanPeriodPaid` slice ran to the end of the file).
 */
function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** One top-level function's text, from `async function` to its closing brace. */
function functionText(rel: string, name: string): string {
  const sf = parse(rel);
  const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  expect(fn).toBeDefined();
  return fn!.getText(sf);
}

/** One method's code, comments removed, from a named class. */
function methodCode(rel: string, className: string, method: string): string {
  const sf = parse(rel);
  let found: ts.MethodDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.body && member.name.getText(sf) === method) found = member;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  expect(found).toBeDefined();
  return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, found!, sf);
}

const BINDER = 'lib/payments/bindPlanSubscription.ts';
const PLAN_REPOSITORY = 'lib/repositories/PaymentPlanRepository.ts';

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
    const binder = read(BINDER);

    // CF-5 PR 4: the insert lives in the repository; projectPeriods is still
    // the one place in the binder that calls it, and the method is a single
    // insert on the table.
    const projectPeriods = functionText(BINDER, 'projectPeriods');
    expect(projectPeriods).toMatch(/paymentPlanRepository\.insertProjectedPeriods\(/);
    expect(binder.match(/\binsertProjectedPeriods\(/g)).toHaveLength(1);
    expect(methodCode(PLAN_REPOSITORY, 'PaymentPlanRepository', 'insertProjectedPeriods')).toMatch(
      /from\('payment_plan_installments'\)\.insert\(rows\)/
    );
    // And it returns early without writing when there is no plan row to point
    // at — the state §1 exists to prevent.
    expect(binder).toMatch(/if \(!planRowId\)/);
    expect(projectPeriods.indexOf('if (!planRowId)')).toBeLessThan(projectPeriods.indexOf('insertProjectedPeriods('));
  });

  it('the binder reaches the database only through repositories (CF-5 PR 4, CLAUDE.md rule 1)', () => {
    const binder = read(BINDER);

    expect(binder).not.toMatch(/\.from\(/);
    expect(binder).not.toMatch(/\bsupabaseServer\b/);
    expect(binder).not.toMatch(/\.rpc\(/);
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
    // Bounded to the function (SA C-2): a later function's text cannot satisfy it.
    const record = functionText('app/api/stripe/webhook/route.ts', 'recordPlanPeriodPaid');

    // CF-5 PR 4: the route closes it through the repository, by this plan's row
    // id and the period number it just counted...
    expect(record).toMatch(/paymentPlanRepository\.markPeriodPaidFromStripe\(plan\.data\.id, periodsPaid,/);
    expect(record).not.toMatch(/from\(\s*['"`]payment_plan_installments['"`]\s*\)/);

    // ...and the method is the update the route used to write inline.
    const method = methodCode(PLAN_REPOSITORY, 'PaymentPlanRepository', 'markPeriodPaidFromStripe');
    expect(method).toMatch(/from\('payment_plan_installments'\)[\s\S]{0,200}status: 'paid'/);
    expect(method).toMatch(/\.eq\('subscription_id', planSubscriptionId\)/);
    expect(method).toMatch(/\.eq\('installment_number', installmentNumber\)/);
  });

  it('the overdue chaser only looks at rows still pending', () => {
    const reminders = read('lib/services/PaymentReminderService.ts');
    const pass = reminders.slice(reminders.indexOf('// Get overdue installments'));

    expect(pass.slice(0, 400)).toMatch(/\.eq\('status', 'pending'\)/);
  });
});
