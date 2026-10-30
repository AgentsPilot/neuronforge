/**
 * Payment terms decide when a debt is owed. Nothing may chase before that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A business agrees terms with its client — the proposal's own
 * `payment_terms_days`, the business default, or thirty days — and
 * `dueDateFromTerms` turns that into `payment_invoices.due_date`.
 *
 * Three surfaces select invoices and every one of them can offer a chase:
 *
 *   PaymentReminderService   fires on milestone days AFTER the due date. Right
 *                            from the start.
 *   cash_ar_overdue          selects `due_date < today - 7`. Right.
 *   cash_revenue_at_risk     aged by `created_at`, which is correct for the
 *                            FINDING and was wrong for the action.
 *   invoice_unpaid (here)    selected every issued invoice, with no date test
 *                            at all, and put "Chase payment" on each.
 *
 * Five real invoices were chased before they were owed, by up to nineteen
 * days. This pins the gap's half; `InsightActionDispatchService.test.ts` pins
 * the send's, and `CashRevenueAtRiskDetector.test.ts` the detector's.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = { payment_invoices: [], payment_reminders: [] };

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) =>
                resolve({ data: tables[table] ?? [], error: null });
            }
            return () => builder;
          },
        }
      );
      return builder;
    },
  },
}));

import { findGaps } from '../findGaps';

const NOW = new Date('2026-10-29T12:00:00.000Z');

const day = (offset: number) =>
  new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

const invoice = (overrides: Row = {}): Row => ({
  id: 'i1',
  contact_id: 'c1',
  amount: 500,
  currency: 'ILS',
  client_name: 'Dana Levi',
  status: 'sent',
  created_at: day(-20),
  due_date: day(-5),
  ...overrides,
});

async function run() {
  const [gap] = await findGaps('user-1', { only: ['invoice_unpaid'], now: NOW });
  return gap;
}

beforeEach(() => {
  tables.payment_invoices = [];
  tables.payment_reminders = [];
});

describe('an invoice the client still has time to pay', () => {
  it('is not on the card', async () => {
    /* Raised twenty days ago on forty-five-day terms: outstanding, not late. */
    tables.payment_invoices = [invoice({ due_date: day(25) })];

    expect(await run()).toBeUndefined();
  });

  it('nor is one falling due today', async () => {
    /* They have until the end of the day they were given. */
    tables.payment_invoices = [invoice({ due_date: day(0) })];

    expect(await run()).toBeUndefined();
  });

  it('nor one with no due date, which is a different card', async () => {
    /* Not nothing — `invoice_no_due_date` asks the owner to supply one — but
       not a debt anybody is late on either. */
    tables.payment_invoices = [invoice({ due_date: null })];

    expect(await run()).toBeUndefined();
  });

  it('but a genuinely late one still is', async () => {
    tables.payment_invoices = [invoice({ due_date: day(-5) })];

    expect((await run())?.count).toBe(1);
  });
});
