import { CashIncomeDropDetector } from '../CashIncomeDropDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const DAY = 86_400_000;

/**
 * A client that answers each table with rows filtered by the window the
 * detector asks for.
 *
 * The date filters are honoured rather than ignored, because the whole subject
 * here is two periods being compared: a mock that returned every row to both
 * queries would make the recent and baseline totals identical and the test
 * would pass while proving nothing.
 */
function mockSupabase(rows: { transactions?: Row[]; invoices?: Row[] }) {
  return {
    from(table: string) {
      const source =
        table === 'payment_transactions' ? rows.transactions ?? [] : rows.invoices ?? [];
      const dateField = table === 'payment_transactions' ? 'created_at' : 'paid_at';
      let gte: string | null = null;
      let lt: string | null = null;

      const chain: Record<string, unknown> = {
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
          const filtered = source.filter(r => {
            const at = r[dateField] as string;
            if (gte && at < gte) return false;
            if (lt && at >= lt) return false;
            return true;
          });
          return resolve({ data: filtered, error: null });
        },
      };
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'not']) chain[m] = () => chain;
      chain.gte = (_c: string, v: string) => { gte = v; return chain; };
      chain.lt = (_c: string, v: string) => { lt = v; return chain; };
      return chain;
    },
  };
}

interface Row {
  id: string;
  amount: number;
  refunded_amount?: number;
  currency?: string;
  invoice_id?: string | null;
  created_at?: string;
  paid_at?: string;
}

const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** n payments of `amount`, dated `days` ago, in whichever table. */
function payments(prefix: string, n: number, amount: number, days: number, field: 'created_at' | 'paid_at'): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    amount,
    currency: 'GBP',
    [field]: ago(days),
  })) as Row[];
}

/** The detector with cooldown disabled — that path needs a database. */
function detector(client: unknown) {
  const d = new CashIncomeDropDetector(client as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('CashIncomeDropDetector', () => {
  it('reports a real fall between the two periods', async () => {
    // 10 × £100 in the baseline window, 2 × £100 in the recent one: down 80%.
    const d = detector(mockSupabase({
      transactions: [
        ...payments('old', 10, 100, 40, 'created_at'),
        ...payments('new', 2, 100, 5, 'created_at'),
      ],
    }));

    const result = await d.evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.processParameters!.drop_percent).toBe(80);
    expect(result!.processParameters!.received_baseline).toBe(1000);
    expect(result!.processParameters!.received_recent).toBe(200);
    // Impact is the SHORTFALL, not the takings: reporting £200 of real income
    // under a heading that reads as loss everywhere else would be a lie.
    expect(result!.estimatedImpactUsd).toBe(800);
    expect(result!.severity).toBe('critical');
  });

  it('counts an invoice and the transaction that settled it once', async () => {
    /*
     * The failure this guards: on the live database every transaction carries
     * an `invoice_id`, so without de-duplication every payment is counted
     * twice. Both periods double, which hides a real fall and invents flat
     * months out of halved ones.
     */
    const d = detector(mockSupabase({
      transactions: [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `t${i}`, amount: 100, currency: 'GBP', invoice_id: `i${i}`, created_at: ago(40),
        })),
        { id: 'recent', amount: 100, currency: 'GBP', invoice_id: 'ir', created_at: ago(5) },
      ],
      invoices: [
        ...Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, amount: 100, currency: 'GBP', paid_at: ago(40) })),
        { id: 'ir', amount: 100, currency: 'GBP', paid_at: ago(5) },
      ],
    }));

    const result = await d.evaluate('user-1');

    // £1,000 and £100, not £2,000 and £200.
    expect(result!.processParameters!.received_baseline).toBe(1000);
    expect(result!.processParameters!.received_recent).toBe(100);
    expect(result!.processParameters!.payments_baseline).toBe(10);
  });

  it('nets off refunds, because money that came and went was never income', async () => {
    const d = detector(mockSupabase({
      transactions: [
        ...payments('old', 10, 100, 40, 'created_at'),
        { id: 'r1', amount: 100, refunded_amount: 100, currency: 'GBP', created_at: ago(5) },
      ],
    }));

    const result = await d.evaluate('user-1');
    expect(result!.processParameters!.received_recent).toBe(0);
  });

  it('stays silent when the earlier period is too thin to compare against', async () => {
    /*
     * Four payments, then one. That is an 80% "fall" and it means nothing: one
     * late invoice looks identical. A detector that cries collapse every quiet
     * fortnight is ignored in the month that matters.
     */
    const d = detector(mockSupabase({
      transactions: [
        ...payments('old', 4, 100, 40, 'created_at'),
        ...payments('new', 1, 100, 5, 'created_at'),
      ],
    }));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent for a business with no earlier period at all', async () => {
    // The first month, where the comparison would be against zero.
    const d = detector(mockSupabase({ transactions: payments('new', 8, 100, 5, 'created_at') }));
    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent for a dip that is not a fall', async () => {
    // 10 × £100 then 9 × £100: down 10%, which is a normal fortnight.
    const d = detector(mockSupabase({
      transactions: [
        ...payments('old', 10, 100, 40, 'created_at'),
        ...payments('new', 9, 100, 5, 'created_at'),
      ],
    }));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('reports the business own currency, not dollars', async () => {
    // `estimated_impact_usd` does not hold USD. An Israeli therapist must not
    // be told they lost "$800".
    const d = detector(mockSupabase({
      transactions: [
        ...Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, amount: 100, currency: 'ILS', created_at: ago(40) })),
        { id: 'n1', amount: 100, currency: 'ILS', created_at: ago(5) },
      ],
    }));

    const result = await d.evaluate('user-1');
    expect(result!.processParameters!.currency).toBe('ILS');
  });
});
