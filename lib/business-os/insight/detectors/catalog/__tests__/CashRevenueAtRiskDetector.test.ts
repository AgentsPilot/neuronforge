import { CashRevenueAtRiskDetector } from '../CashRevenueAtRiskDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

interface Row { id: string; created_at: string; [k: string]: unknown }

/**
 * Honours the `lt('created_at', …)` age filter, because the age filter is the
 * whole subject: a mock that returned every row regardless would make the
 * "stays silent for a fresh invoice" test pass for the wrong reason.
 */
function mockSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      let before: string | null = null;
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: rows.filter(r => !before || r.created_at < before), error: null }),
      };
      for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'neq']) chain[m] = () => chain;
      chain.lt = (_c: string, v: string) => { before = v; return chain; };
      return chain;
    },
  };
}

/*
 * `dueDays` is part of the fixture now, and it was absent.
 *
 * The finding ages invoices by `created_at` — "what have I billed that has not
 * arrived" is a question about the issue date — but the CHASE may only touch
 * what is actually late. An invoice raised thirty days ago on forty-five-day
 * terms is outstanding and is not overdue.
 *
 * Defaults to ten days past due, so the existing cases still describe money
 * that is genuinely late. `dueDays: -14` makes one that is not.
 */
function invoices(n: number, days: number, amount = 500, dueDays = 10): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `inv-${days}-${i}`, created_at: ago(days),
    due_date: ago(dueDays).slice(0, 10),
    amount, refunded_amount: 0, currency: 'USD', contact_id: `c${i}`,
  }));
}

function detector(client: unknown) {
  const d = new CashRevenueAtRiskDetector(client as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('CashRevenueAtRiskDetector', () => {
  it('stays silent for a single invoice raised minutes ago', async () => {
    /*
     * The case that produced a real card: an invoice created at 03:10 and paid
     * at 03:56 was reported as "$500 needs attention". Nothing is at risk the
     * moment it is raised, and `chase_overdue_invoices` already chases late
     * invoices.
     */
    const d = detector(mockSupabase({ payment_invoices: invoices(1, 0) }));
    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent for one aged invoice — that is a row, not a pattern', async () => {
    const d = detector(mockSupabase({ payment_invoices: invoices(1, 30) }));
    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent for three invoices that are all too recent', async () => {
    const d = detector(mockSupabase({ payment_invoices: invoices(3, 2) }));
    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('reports three aged items as a pattern', async () => {
    const d = detector(mockSupabase({ payment_invoices: invoices(3, 30) }));
    const result = await d.evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.estimatedImpactUsd).toBe(1500);
    // People to chase, not documents: one client with three unpaid instalments
    // is one call.
    expect(result!.affectedCount).toBe(3);
    expect(result!.affectedEntityIds).toHaveLength(3);
  });

  it('counts money not yet due, and does NOT offer to chase it', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE SPLIT THIS DETECTOR HAS TO MAKE, AND DID NOT.
     *
     * Three invoices raised thirty days ago on forty-five-day terms. They are
     * outstanding — that is this card's subject, and the total must include
     * them — and not one of them is late.
     *
     * Every id used to travel as `affectedEntityIds`, which is what the chase
     * acts on. Five real invoices were chased that way, by up to nineteen days
     * before they were owed: INV-00022, 23 and 24 chased on 22 October against
     * a due date of 4 November.
     *
     * So the finding keeps counting by issue date and the action is narrowed to
     * what the due date says is late.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const d = detector(mockSupabase({ payment_invoices: invoices(3, 30, 500, -15) }));
    const result = await d.evaluate('user-1');

    expect(result).not.toBeNull();
    /* Counted: it is money that has not arrived. */
    expect(result!.estimatedImpactUsd).toBe(1500);
    /* Not chaseable: nobody owes it yet. */
    expect(result!.affectedEntityIds).toHaveLength(0);
  });

  it('counts only the aged ones when a business has both', async () => {
    const d = detector(mockSupabase({
      payment_invoices: [...invoices(3, 30), ...invoices(5, 1, 900)],
    }));

    const result = await d.evaluate('user-1');
    // £4,500 of fresh invoices is not at risk and must not inflate the total.
    expect(result!.estimatedImpactUsd).toBe(1500);
  });
});
