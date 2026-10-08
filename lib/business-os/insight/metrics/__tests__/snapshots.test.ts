/**
 * Current-state metrics, and the two refusals that keep them honest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The first is the standing platform rule: there is NO FX RATE ANYWHERE, so
 * ₪400 plus $400 is not a number. `cashflow.ar_overdue_usd` already breaks
 * this quietly — its name says USD and it sums whatever `amount` holds — and
 * the point of `cashflow.ar_total` is to be the version that does not.
 *
 * The second is the difference between zero and nothing. A business with no
 * links at all has not got zero broken links; it has no answer, and a zero
 * there becomes a flat green series implying something was checked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readSnapshot, snapshotKeys } from '../snapshots';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/*
 * The client-stage resolver is its own query against `crm_pipeline_stages`.
 * Mocked so these tests are about the at-risk RULE, not about stage
 * resolution — which has its own guard in
 * `repository/__tests__/clientStageResolution.guard.test.ts`.
 */
let stageKeys: string[] = ['family_enrolled'];
jest.mock('@/lib/crm/StageTypeUtils', () => ({
  buildClientStageFilter: async () => stageKeys,
}));

interface Row {
  [k: string]: unknown;
}

/** Honours `.in('status', …)` and `.eq('is_active', …)`, which the readers rely on. */
function mockSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const eq: Record<string, unknown> = {};
      let inCol: string | null = null;
      let inVals: unknown[] = [];

      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          let out = rows.filter(r =>
            Object.entries(eq).every(([k, v]) => k === 'user_id' || r[k] === v)
          );
          if (inCol) out = out.filter(r => inVals.includes(r[inCol!]));
          return resolve({ data: out, error: null });
        },
      };
      chain.select = () => chain;
      chain.eq = (c: string, v: unknown) => {
        eq[c] = v;
        return chain;
      };
      chain.in = (c: string, v: unknown[]) => {
        inCol = c;
        inVals = v;
        return chain;
      };
      /*
       * The date filters are no-ops here on purpose. Each fixture supplies
       * exactly the rows that fall inside the window it is testing, so a mock
       * that also filtered by date would be asserting its own arithmetic
       * rather than the reader's rule.
       */
      for (const m of ['gte', 'lte', 'lt', 'gt', 'order', 'limit', 'not']) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

const USER = '08456106-aa50-4810-b12c-7ca84102da31';

const invoice = (amount: number, currency: string, status = 'sent', refunded = 0): Row => ({
  amount,
  currency,
  status,
  refunded_amount: refunded,
});

describe('money owed', () => {
  it('sums unpaid invoices in a single currency, net of refunds', async () => {
    const db = mockSupabase({
      payment_invoices: [
        invoice(1000, 'ILS'),
        invoice(500, 'ILS', 'overdue'),
        invoice(400, 'ILS', 'sent', 100),
        invoice(9999, 'ILS', 'paid'), // settled: not owed
      ],
    });

    const r = await readSnapshot(db as never, USER, 'cashflow.ar_total', 'usd');

    expect(r).toMatchObject({ value: 1800, sampleSize: 3 });
  });

  it('REFUSES to sum across currencies', async () => {
    /*
     * The rule the reader exists for. No FX rate exists anywhere in the
     * platform, so the only honest answers are a per-currency series or
     * nothing — and nothing is what this returns, which the sweep records as
     * `unmeasurable`.
     */
    const db = mockSupabase({
      payment_invoices: [invoice(1000, 'ILS'), invoice(400, 'USD')],
    });

    await expect(readSnapshot(db as never, USER, 'cashflow.ar_total', 'usd')).resolves.toBeNull();
  });

  it('treats a settled business as a real zero, not an absence', async () => {
    // Everything invoiced has been paid. That IS zero owed, and the series
    // needs the point or a good month looks like a gap.
    const db = mockSupabase({ payment_invoices: [] });

    const r = await readSnapshot(db as never, USER, 'cashflow.ar_total', 'usd');

    expect(r).toMatchObject({ value: 0, sampleSize: 0 });
  });

  it('never reports a negative balance from an over-refund', async () => {
    // A refund larger than the invoice is a data problem, not money the
    // client owes backwards.
    const db = mockSupabase({ payment_invoices: [invoice(100, 'ILS', 'sent', 250)] });

    const r = await readSnapshot(db as never, USER, 'cashflow.ar_total', 'usd');

    expect(r?.value).toBe(0);
  });
});

describe('broken link destinations', () => {
  const link = (destination_url: string | null, is_active = true): Row => ({
    code: 'abc',
    destination_url,
    is_active,
  });

  it('counts the active links a visitor cannot open', async () => {
    const db = mockSupabase({
      smart_links: [
        link('http://localhost:3000/c/x/book'),
        link('https://example.invalid/book'),
        link('https://realbusiness.com/book'),
      ],
    });

    const r = await readSnapshot(db as never, USER, 'acquisition.broken_link_destinations', 'count');

    expect(r).toMatchObject({ value: 2, sampleSize: 3 });
  });

  it('ignores links that are switched off', async () => {
    const db = mockSupabase({
      smart_links: [link('https://realbusiness.com/book'), link('http://localhost:3000', false)],
    });

    const r = await readSnapshot(db as never, USER, 'acquisition.broken_link_destinations', 'count');

    expect(r).toMatchObject({ value: 0, sampleSize: 1 });
  });

  it('returns nothing when there are no links at all', async () => {
    /*
     * Not zero. "None of your links are broken" is a different and
     * misleading claim when there are no links, and a flat green series
     * implies something was checked.
     */
    const db = mockSupabase({ smart_links: [] });

    await expect(
      readSnapshot(db as never, USER, 'acquisition.broken_link_destinations', 'count')
    ).resolves.toBeNull();
  });
});

describe('a key with no reader', () => {
  it('returns null rather than inventing a figure', async () => {
    await expect(
      readSnapshot(mockSupabase({}) as never, USER, 'operations.service_performance', 'count')
    ).resolves.toBeNull();
  });

  it('reports which keys it can answer for', () => {
    expect(snapshotKeys().sort()).toEqual([
      'acquisition.broken_link_destinations',
      'cashflow.ar_total',
      'retention.clients_at_risk',
    ]);
  });
});

describe('clients who have gone quiet', () => {
  const DAY = 86_400_000;
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

  /** A client whose relationship is `age` days old. */
  const client = (id: string, age: number): Row => ({
    id,
    created_at: daysAgo(age),
    stage: 'family_enrolled',
  });

  beforeEach(() => {
    stageKeys = ['family_enrolled'];
  });

  it('counts a long-standing client with no activity and no booking', async () => {
    const db = mockSupabase({
      crm_contacts: [client('c1', 90), client('c2', 90)],
      // c2 was seen recently; c1 has not been.
      crm_activities: [{ contact_id: 'c2' }],
      scheduling_bookings: [],
    });

    const r = await readSnapshot(db as never, USER, 'retention.clients_at_risk', 'count');

    expect(r).toMatchObject({ value: 1, sampleSize: 2 });
  });

  it('counts a BOOKING as contact, not just a logged activity', async () => {
    /*
     * Either source alone would mark a client who only ever books as silent.
     * `CrmEngagementDecayDetector` checks both and so does this.
     */
    const db = mockSupabase({
      crm_contacts: [client('c1', 90)],
      crm_activities: [],
      scheduling_bookings: [{ contact_id: 'c1' }],
    });

    const r = await readSnapshot(db as never, USER, 'retention.clients_at_risk', 'count');

    expect(r?.value).toBe(0);
  });

  it('excludes a client too new to have gone quiet', async () => {
    /*
     * Someone who became a client last week has not gone silent. Counting
     * them would make every new client briefly "at risk" — and because they
     * are excluded from the DENOMINATOR too, the sample reflects only clients
     * who could actually qualify.
     */
    const db = mockSupabase({
      crm_contacts: [client('old', 90), client('new', 3)],
      crm_activities: [],
      scheduling_bookings: [],
    });

    const r = await readSnapshot(db as never, USER, 'retention.clients_at_risk', 'count');

    expect(r).toMatchObject({ value: 1, sampleSize: 1 });
  });

  it('returns nothing when no client is old enough to judge', async () => {
    // Zero at-risk out of zero eligible is not a measurement.
    const db = mockSupabase({
      crm_contacts: [client('new', 3)],
      crm_activities: [],
      scheduling_bookings: [],
    });

    await expect(
      readSnapshot(db as never, USER, 'retention.clients_at_risk', 'count')
    ).resolves.toBeNull();
  });

  it('returns nothing when the business has no clients', async () => {
    const db = mockSupabase({ crm_contacts: [] });

    await expect(
      readSnapshot(db as never, USER, 'retention.clients_at_risk', 'count')
    ).resolves.toBeNull();
  });

  it('returns nothing when no client stage is configured', async () => {
    /*
     * Stages are rows in `crm_pipeline_stages`, not the literal string
     * 'client'. A business with none configured cannot have clients, and
     * reading `lifecycle_stage` instead is what held the retention vector
     * dark platform-wide (hazard H14).
     */
    stageKeys = [];
    const db = mockSupabase({ crm_contacts: [client('c1', 90)] });

    await expect(
      readSnapshot(db as never, USER, 'retention.clients_at_risk', 'count')
    ).resolves.toBeNull();
  });
});
