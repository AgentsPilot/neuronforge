/**
 * One umbrella: everything an invoice says to a client, under one answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Three mechanisms wrote to clients about invoices and only two of them asked.
 *
 *   pre-due (due−3, due day)  `payment_reminder_enabled` — DEFAULTS TRUE, and
 *                             has no UI anywhere. So an owner who had agreed to
 *                             nothing was emailing their clients in their own
 *                             name and branding.
 *   days 1/3/7                `chase_invoices_enabled` — the advisor card
 *   the tail, from day 8      NOTHING. `sendInvoiceChase` read no consent at
 *                             all, so installing the agent from an insight card
 *                             chased clients with the switch still off.
 *
 * And the tail sent one email PER INVOICE while its cooldown was keyed on
 * `invoice_id`, so a client holding three late invoices received three emails in
 * the same run: each correctly deduped against its own invoice, none able to see
 * the other two.
 *
 * Meanwhile the agent sent nothing at all, because its find filtered
 * `sent_at < today - 7` and `payment_invoices.sent_at` is NULL on any invoice
 * that never went through `sendInvoice`. `NULL < date` is NULL, so those rows
 * were dropped before the plan began.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Reaching any of it needs a live cron, a scheduled agent claim, a real mailbox
 * and a week of calendar. What broke is decidable without them: a permission
 * read against the wrong column, a dedup keyed on the wrong unit, and a filter
 * whose NULL behaviour silently emptied a list. Each is one line, and each one
 * is the kind of thing a refactor restores without noticing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
/** Comments stripped: the prose in these files quotes the very code it forbids. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SERVICE = 'lib/services/PaymentReminderService.ts';
const DISPATCH = 'lib/services/InsightActionDispatchService.ts';
const PLAN = 'lib/business-os/automations/agents/chaseOverdueInvoices.steps.json';
const TEMPLATES = 'lib/email/templates/insight-actions.ts';

const service = code(read(SERVICE));
const dispatch = code(read(DISPATCH));
const plan = JSON.parse(read(PLAN)) as Array<Record<string, never>>;

describe('one switch governs every word sent about an invoice', () => {
  it('the pre-due half no longer answers to a switch of its own', () => {
    /*
     * `config.enabled` reads `payment_reminder_enabled`, which defaults true and
     * has no UI. It may still be read and written — the day lists live beside
     * it — but it must never again decide whether a client hears from us.
     */
    expect(service).not.toMatch(/if \(!config\.enabled\)/);
    expect(service).not.toMatch(/reminderType === 'overdue' \? config\.chaseOverdue : config\.enabled/);
  });

  it.each([
    ['scheduleReminder', 'async scheduleReminder('],
    ['scheduleInvoiceReminders', 'async scheduleInvoiceReminders('],
    ['scheduleInstallmentReminders', 'async scheduleInstallmentReminders('],
  ])('%s asks the switch the owner was actually shown', (_label, signature) => {
    /*
     * Asserted per entry point rather than as a count. A count also matches the
     * two `continue` guards inside `processOverdueItems`, which were always
     * correct and are not what this is about — so it would pass while any one of
     * these three silently lost its check.
     *
     * The two batch builders check as well as `scheduleReminder`, so a declined
     * business costs no round trips building a schedule that would then be
     * refused one row at a time.
     */
    const start = service.indexOf(signature);
    expect(start).toBeGreaterThan(-1);

    const body = service.slice(start, start + 1200);
    expect(body).toMatch(/if \(!config\.chaseOverdue\)/);
  });

  it('the agent asks it too, before it reads anything else', () => {
    /*
     * `sendInvoiceChase` read no consent whatsoever, and the scheduled chaser
     * checking for itself is what made the gap invisible from the other side.
     */
    expect(dispatch).toContain("select('chase_invoices_enabled')");

    const send = dispatch.slice(dispatch.indexOf('export async function sendInvoiceChase'));
    const consentAt = send.indexOf('chase_invoices_enabled');
    const invoiceAt = send.indexOf('paymentInvoiceRepository.findById');

    expect(consentAt).toBeGreaterThan(-1);
    expect(invoiceAt).toBeGreaterThan(-1);
    /* Asked before the records are opened: the question is "may we write to
       these people", not "is this invoice chaseable". */
    expect(consentAt).toBeLessThan(invoiceAt);
  });

  it('and fails closed when it cannot tell', () => {
    /* An unreadable profile is not permission. Same direction
       `getUserReminderConfig` fails in, for the same reason. */
    expect(dispatch).toMatch(/consentError[\s\S]{0,200}sent: false/);
  });
});

describe('one email per client, not one per invoice', () => {
  it('the cooldown is keyed on the contact', () => {
    expect(dispatch).toContain('findRecentByContact(');
    expect(read('lib/repositories/PaymentReminderRepository.ts')).toContain(
      'async findRecentByContact('
    );
  });

  it('with the invoice as the fallback only where there is no contact', () => {
    /* An ad-hoc invoice carrying an address and no CRM row is still chaseable;
       keying it on a null would suppress every other such invoice. */
    expect(dispatch).toMatch(/invoice\.contact_id\s*\n?\s*\?\s*await paymentReminderRepository\.findRecentByContact/);
    expect(dispatch).toContain('findRecentByInvoice(');
  });

  it('the statement is built from everything past the chaser, read at send time', () => {
    expect(dispatch).toContain('generateOutstandingStatementEmail(');
    expect(dispatch).toContain('tailBoundary');
    /* Settled rows cannot appear on it, by the money module's own test. */
    expect(dispatch).toContain('isSettledInvoice(row)');
  });

  it('a single item keeps the ordinary chase, which can name it in the subject', () => {
    expect(dispatch).toMatch(/items\.length > 1[\s\S]{0,200}generateOutstandingStatementEmail/);
    expect(dispatch).toContain('generateChaseInvoiceEmail(');
  });

  it('and every item named is recorded, not just the one that triggered the send', () => {
    /* The per-invoice history is what the milestone chaser reads. Recording one
       row would leave the others looking never-chased, and the chaser would be
       free to name one of them the next morning. */
    expect(dispatch).toMatch(/for \(const item of items\)[\s\S]{0,400}paymentReminderRepository\.create/);
  });
});

describe('the filter that emptied the list stays gone', () => {
  const find = plan[0] as unknown as {
    params: { filters: Array<{ field: string; op: string }> };
  };

  it('nothing filters on the invoice own send date', () => {
    /*
     * Two faults in one line. For a row carrying a date it was permanently true
     * and deduped nothing; for a row where it is NULL — any invoice the owner
     * raised by hand — `NULL < date` is NULL and the row vanished. That is why
     * the agent ran on schedule, reported success and sent nothing.
     */
    expect(find.params.filters.map(f => f.field)).not.toContain('sent_at');
  });

  it('and the window it actually needs is still there', () => {
    /* Unpaid, more than 7 days gone so nothing inside the chaser's milestones is
       touched, and bounded below by the owner's own stop-after. */
    const fields = find.params.filters.map(f => `${f.field}:${f.op}`);

    expect(fields).toContain('status:eq');
    expect(fields).toContain('due_date:lt');
    expect(fields).toContain('due_date:gte');
  });

  it('one person who cannot be written to does not block the rest', () => {
    /* The find is ordered oldest first, so without this the same unreachable
       address would sit at the top of every run for good. */
    const scatter = plan[1] as unknown as { scatter: { continueOnError: boolean } };
    expect(scatter.scatter.continueOnError).toBe(true);
  });
});

describe('the statement tells the truth about money', () => {
  const templates = read(TEMPLATES);

  it('subtotals per currency and never sums across them', () => {
    /* A business may price one client in another currency, and there is no rate
       here to join two debts with. CLAUDE.md forbids the addition outright. */
    expect(templates).toContain('const byCurrency = new Map<string, number>()');
    expect(templates).toMatch(/byCurrency\.size === 1[\s\S]{0,300}subjectMixed/);
  });

  it('every item carries its own way to pay', () => {
    /* One button could only ever serve one of them. */
    expect(templates).toMatch(/item\.payUrl[\s\S]{0,200}item\.invoiceNumber/);
  });

  it('and the copy exists in every language', () => {
    const strings = read('lib/email/templates/translations.ts');

    for (const key of [
      'subjectMixed',
      'askFriendly',
      'colInvoice',
      'colDue',
      'colAmount',
      'dueDaysAgo',
      'total',
      'payHint',
    ]) {
      /* A missing key renders as the key itself, which in a client's inbox is
         worse than silence. */
      const block = strings.slice(strings.indexOf('outstandingStatement: {'));
      expect(block.slice(0, block.indexOf('\n  },'))).toContain(key);
    }
  });
});

describe('the agent is offered only where there is a tail', () => {
  it.each([
    ['booking unpaid', 'lib/business-os/insight/detectors/catalog/CashBookingUnpaidDetector.ts'],
    ['revenue at risk', 'lib/business-os/insight/detectors/catalog/CashRevenueAtRiskDetector.ts'],
  ])('%s withholds the chase process the chaser can still reach', (_label, file) => {
    /*
     * Both already narrowed to invoices genuinely past due. What was missing is
     * the AGE: one day late is the milestone chaser's own territory, and the
     * paired process installs an AGENT whose find starts after day 7. So a
     * business whose clients settle on day 5 was offered an agent whose first
     * query would return nothing.
     */
    const source = code(read(file));

    expect(source).toContain("from '@/lib/payments/overdueMilestones'");
    expect(source).toMatch(/!chaserCanStillReach\(/);
    /* Measured against what the business is actually set to, not the default. */
    expect(source).toContain("select('payment_overdue_reminder_days')");
  });

  it('and the day arithmetic lives in one place', () => {
    /* `overdueMilestones` owns the default and the fallback. A detector
       restating `[1,3,7]` would be the third copy, which is the fault its own
       header describes. */
    for (const file of [
      'lib/business-os/insight/detectors/catalog/CashBookingUnpaidDetector.ts',
      'lib/business-os/insight/detectors/catalog/CashRevenueAtRiskDetector.ts',
    ]) {
      expect(code(read(file))).not.toMatch(/\[\s*1\s*,\s*3\s*,\s*7\s*\]/);
    }
  });
});
