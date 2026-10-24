/**
 * The reports tile and the orders page count the same late money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The two screens answered "what is late" from different sources, and a live
 * account showed it:
 *
 *     reports   תשלומים באיחור   ₪1,600   (5 invoices)
 *     orders    באיחור           ₪2,800
 *
 * The whole ₪1,200 gap was plan periods past their due date with no invoice
 * raised — money the client owes and nobody is chasing, reported on the reports
 * page as not existing. Reconciled exactly against the account: ₪1,600 of
 * invoices + ₪1,200 over three plan stages.
 *
 * Two separate causes, both of which made this tile narrower than the truth:
 *
 *   1. It read `payment_plan_installments` nowhere. The route already queries
 *      those rows for `planOwedAmount`, under a comment saying the reports page
 *      and the orders page "cannot disagree about one debt" — the late figure
 *      simply never got the same treatment.
 *   2. It read `status = 'overdue'`, which a CRON writes. Between an invoice
 *      falling due and the next sweep it is late in fact and `sent` in the
 *      column, so the tile reported the scheduler rather than the money. Zero
 *      on the day this was found, and a real divergence on any other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The figure is assembled inside a ~2,400-line route whose data arrives from a
 * 48-way Promise fan-out against Supabase. What is protected is that it keeps
 * reading BOTH sources, by the same rule, scoped so neither is counted twice.
 * The rule itself is behaviour-tested below through the shared predicate.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { isLatePeriod } from '@/lib/payments/moneyItems';

const SOURCE = readFileSync(
  join(process.cwd(), 'app/api/business-os/stats/route.ts'),
  'utf8'
);

/** Comments quote the old query and the figures; assertions must not read them. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the comment stripping works', () => {
  it('removes prose quoting the old behaviour', () => {
    expect(SOURCE).toContain('scheduler rather than about the money');
    expect(code).not.toContain('scheduler rather than about the money');
  });
});

describe('plan stages count as late money', () => {
  it('the route uses the orders page predicate, not a second opinion', () => {
    /*
     * A copy of the rule is how the two screens drifted in the first place.
     * `isLatePeriod` is exported from `moneyItems` for exactly this.
     */
    expect(code).toContain("import { isLatePeriod } from '@/lib/payments/moneyItems';");
    expect(code).toContain('isLatePeriod({ dueDate:');
  });

  it('the late total adds them to the invoices', () => {
    /* `lastIndexOf`: the first hit is the response TYPE declaration near the
       top of the route, not the assignment that builds the figure. */
    const line = code.slice(
      code.lastIndexOf('invoices_overdue_amount:'),
      code.lastIndexOf('invoices_overdue_amount:') + 120
    );

    expect(line).toContain('planLateAmount');
  });

  it('and so does the count', () => {
    const line = code.slice(
      code.lastIndexOf('invoices_overdue:'),
      code.lastIndexOf('invoices_overdue:') + 120
    );

    expect(line).toContain('planLateCount');
  });

  it('reads the due date it needs to decide', () => {
    /* The column was not selected, which is why this could not have been done
       without widening the query. */
    const q = code.slice(
      code.indexOf("from('payment_plan_installments')"),
      code.indexOf("from('payment_plan_installments')") + 260
    );

    expect(q).toContain('due_date');
  });
});

describe('nothing is counted twice', () => {
  it('a billed stage is left to its invoice', () => {
    /*
     * The scoping that makes adding the two sources safe. Billing a stage
     * raises an invoice for the same money and writes its id back onto the
     * stage; without this filter every invoiced-but-unpaid stage would be
     * counted by both halves.
     */
    const q = code.slice(
      code.indexOf("from('payment_plan_installments')"),
      code.indexOf("from('payment_plan_installments')") + 600
    );

    expect(q).toContain(".is('invoice_id', null)");
  });

  it('the late periods are filtered from the same rows as the owed ones', () => {
    /* One read, two figures. A second query could drift in its scoping and
       reintroduce the double count. */
    expect(code).toContain('const latePlanPeriods = (unpaidInstallments || []).filter(');
  });
});

describe('an invoice is late when it is late, not when the cron says so', () => {
  it('the query no longer asks only for the swept status', () => {
    expect(code).not.toContain("select('amount, status')\n        .eq('user_id', user.id)\n        .eq('status', 'overdue')");
  });

  it('it reads every unsettled invoice instead', () => {
    const q = code.slice(
      code.indexOf("select('amount, status, due_date')"),
      code.indexOf("select('amount, status, due_date')") + 200
    );

    expect(q).toContain("in('status', ['pending', 'sent', 'overdue'])");
  });

  it('and keeps the swept status as one of the two ways to be late', () => {
    /*
     * Not replaced by the date test: an invoice the sweep marked overdue is
     * late whatever its due date says, and dropping the status would lose any
     * row whose date is missing.
     */
    const filter = code.slice(
      code.indexOf('const lateInvoices ='),
      code.indexOf('const lateInvoices =') + 320
    );

    expect(filter).toContain("inv.status === 'overdue'");
    expect(filter).toContain('due_date');
    expect(filter).toContain('todayKey');
  });
});

describe('the tile stops calling plan stages invoices', () => {
  it('the route reports the split', () => {
    expect(code).toContain('invoices_overdue_invoice_count:');
    expect(code).toContain('invoices_overdue_plan_count:');
  });

  it('the page passes it on', () => {
    const page = readFileSync(join(process.cwd(), 'app/business-os/reports/page.tsx'), 'utf8');

    expect(page).toContain('overdueInvoiceCount={payments.invoices_overdue_invoice_count}');
    expect(page).toContain('overduePlanCount={payments.invoices_overdue_plan_count}');
  });

  it('and the tile words it from both, only when there are stages', () => {
    /*
     * A business with no plans keeps the sentence it had. One noun could only
     * ever be wrong about part of the number.
     */
    const tile = readFileSync(
      join(process.cwd(), 'components/business-os/reports/FinancialDetail.tsx'),
      'utf8'
    ).replace(/\/\*[\s\S]*?\*\//g, '');

    expect(tile).toContain('p.overduePlanCount');
    expect(tile).toContain('reports.overdue_plan_payments');
    expect(tile).toContain('reports.overdue_invoices');
  });

  it('the new key exists in every language, exactly once', () => {
    for (const lang of ['he', 'en', 'es']) {
      const file = readFileSync(
        join(process.cwd(), `lib/business-os/translations/${lang}.ts`),
        'utf8'
      );
      const hits = file.match(/'reports\.overdue_plan_payments':/g) ?? [];

      expect(hits).toHaveLength(1);
    }
  });
});

describe('the shared predicate, behaviourally', () => {
  const today = '2026-10-15';

  it('a stage due yesterday is late', () => {
    expect(isLatePeriod({ dueDate: '2026-10-14' }, today)).toBe(true);
  });

  it('a stage due today is not', () => {
    /* Compared as calendar days: due today is due by close of play. */
    expect(isLatePeriod({ dueDate: '2026-10-15' }, today)).toBe(false);
  });

  it('a stage due tomorrow is not', () => {
    expect(isLatePeriod({ dueDate: '2026-10-16' }, today)).toBe(false);
  });

  it('a stage with no date is not', () => {
    /* A milestone waiting on the owner has no date and is not a debt. */
    expect(isLatePeriod({ dueDate: null }, today)).toBe(false);
  });

  it('a timestamp is read by its calendar day, not its instant', () => {
    /* Parsing a due date into an instant reads as yesterday west of UTC. */
    expect(isLatePeriod({ dueDate: '2026-10-14T23:30:00Z' }, today)).toBe(true);
    expect(isLatePeriod({ dueDate: '2026-10-15T00:30:00Z' }, today)).toBe(false);
  });
});
