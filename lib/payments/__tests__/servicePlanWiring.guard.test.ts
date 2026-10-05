/**
 * The two halves of a payment plan must stay wired to each other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the guard for the defect itself, not for a function's return value.
 *
 * "Is this service paid in instalments" has two stores: the instalment columns
 * on `scheduling_services`, which the server trusts, and a `payment_plans` row,
 * which the public dialog, the contact drawer and the reminders read. Nothing
 * connected them, so a service configured in the Services settings was a plan to
 * the server and a single price to the client. Live on 2026-09-29: a 200 ILS
 * service sold as 2 × 100 quoted 200, charged 200, and banked nothing.
 *
 * A unit test of `syncServicePaymentPlan` cannot catch that coming back, because
 * the bug was never in a function — it was in a call that did not exist. So these
 * assert the CALLS, at source level, on the three files where dropping one
 * silently recreates the bug.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('every path that saves a service also writes its plan row', () => {
  const routes = [
    ['create', 'app/api/scheduling/services/route.ts'],
    ['update', 'app/api/scheduling/services/[id]/route.ts'],
  ] as const;

  it.each(routes)('the %s route imports the reconciler', (_what, file) => {
    expect(read(file)).toContain("from '@/lib/payments/syncServicePaymentPlan'");
  });

  it.each(routes)('the %s route calls it', (_what, file) => {
    expect(read(file)).toMatch(/await syncServicePaymentPlan\(/);
  });

  it.each(routes)('the %s route calls it AFTER the service row is written', (_what, file) => {
    const source = read(file);
    // Reconciling against unsaved input would mirror a service that may not
    // exist, and would miss whatever the database defaulted.
    expect(source.indexOf('schedulingServiceRepository.')).toBeLessThan(
      source.indexOf('await syncServicePaymentPlan(')
    );
  });

  it.each(routes)('the %s route treats a plan-write failure as a failure', (_what, file) => {
    const source = read(file);
    const branch = source.slice(source.indexOf('if (planSync.error)'), source.indexOf('// 4. Audit log'));

    // Silence here is what the original bug looked like from outside: a service
    // that saved cleanly and quoted the wrong money.
    expect(branch).toContain('PLAN_SYNC_FAILED');
    expect(branch).toMatch(/status: 500/);
  });

  it('PATCH does not need its own call, because it delegates to PUT', () => {
    const source = read('app/api/scheduling/services/[id]/route.ts');
    const patch = source.slice(source.indexOf('export async function PATCH'));

    expect(patch.slice(0, 220)).toMatch(/return PUT\(request, context\)/);
  });
});

describe('the reconciler writes the row the client is actually shown', () => {
  /*
   * `PaymentPlanRepository.findByServiceId` orders created_at DESCENDING;
   * `loadServicePaymentPlans` orders ASCENDING and keeps the first. Taking the
   * repository's first row would update the NEWEST while the dialog quotes the
   * OLDEST — fixed on paper, unchanged on screen.
   */
  it('reads the oldest active row, matching loadServicePaymentPlans', () => {
    const source = read('lib/payments/syncServicePaymentPlan.ts');

    expect(source).toMatch(/function targetRow/);
    expect(source).toMatch(/localeCompare/);
    expect(source).toContain('loadServicePaymentPlans');
  });

  it('still orders ascending on the read side, which is what that depends on', () => {
    const loader = read('lib/business-os/servicePaymentPlan.ts');

    expect(loader).toMatch(/order\('created_at',\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  it('takes one period from planPhases rather than dividing the total', () => {
    const source = read('lib/payments/syncServicePaymentPlan.ts');

    // Matched on the assignment, not on prose: the comment beside it names
    // `total / count` to explain why that is the wrong way to get this number.
    const line = source.split('\n').find(l => l.includes('const installmentAmount ='));

    expect(line).toBeDefined();
    expect(line).toContain('planPhases(total, currency, count)[0]');
    // Dividing quotes 333.33 on a 1000 plan whose final period Stripe charges
    // at 333.34, and nothing then says which figure was right.
    expect(line).not.toMatch(/total\s*\/\s*count/);
  });

  it('deactivates rather than deletes when a service stops being a plan', () => {
    const source = read('lib/payments/syncServicePaymentPlan.ts');

    // A live subscription's instalments point at this row by a real FK.
    expect(source).toContain('is_active: false');
    expect(source).not.toMatch(/\.delete\(/);
  });
});

describe('the dialog charges one period, never the whole price', () => {
  const dialog = read('components/website/blocks/ProcessFlowSection.tsx');

  it('sends the instalment amount when a plan applies', () => {
    expect(dialog).toMatch(/amount:\s*plan\s*\?\s*plan\.installmentAmount\s*:\s*service\.price/);
  });

  it('shows the instalment amount on the button, not the total', () => {
    expect(dialog).toMatch(/amount=\{plan \? plan\.installmentAmount/);
  });

  it('derives the plan from the service the client chose', () => {
    // `service.paymentPlan` is populated from `payment_plans` — which is why the
    // write above is what makes every line in this block true.
    expect(dialog).toMatch(/const plan = service\.paymentPlan && service\.paymentPlan\.installmentCount > 1/);
  });
});
