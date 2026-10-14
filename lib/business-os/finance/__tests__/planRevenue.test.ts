/**
 * The plan revenue builder (finance & business health slice 5a, T2): AC-117
 * against an independent copy of SQL check 17, AC-119 (the kind), AC-120
 * (minor units exact; every SA-W64 unreadable case), AC-121 (zero-amount
 * invoices), AC-124's builder half (by business against check 18's plan
 * column; deleted accounts; SA-W66 order; the cap), AC-125 (the ceiling),
 * AC-126 (empty), the one-business list (newest first, stable) and SA-W65 (the
 * label comes from the callback; null is "Unknown plan").
 */

jest.mock('@/lib/payments/refundMath', () => {
  const actual = jest.requireActual('@/lib/payments/refundMath');
  return { ...actual, minorUnitsPerMajor: jest.fn(actual.minorUnitsPerMajor) };
});

import { minorUnitsPerMajor } from '@/lib/payments/refundMath';
import { buildPlanRevenue, PLAN_PAYMENT_KIND, type PlanPaymentInput } from '../planRevenue';

const mockMinorUnits = minorUnitsPerMajor as jest.MockedFunction<typeof minorUnitsPerMajor>;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
/** A stored tier id, passed through untouched: this file names no real tier. */
const STORED_TIER = 'stored-tier-id';
const LABEL = 'Stored Tier Label';
const planLabelOf = jest.fn((tier: string | null) => (tier === STORED_TIER ? LABEL : null));
const LIMITS = { accountsShown: 200, paymentsShown: 50 };

let seq = 0;
function invoice(extra: Partial<PlanPaymentInput> = {}): PlanPaymentInput {
  seq += 1;
  return {
    id: `eeeeeeee-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id: A,
    kind: 'invoice_paid',
    tier: STORED_TIER,
    amount_minor: 7900,
    amount_tax_minor: 0,
    currency: 'usd',
    period_start: '2026-10-12T18:21:07.000Z',
    period_end: '2026-11-12T18:21:07.000Z',
    paid_at: '2026-10-12T18:21:09.000Z',
    ...extra,
  };
}

const read = (rows: PlanPaymentInput[], reachedCeiling = false) => ({ rows, reachedCeiling });
const all = (rows: PlanPaymentInput[], reachedCeiling = false, limits = LIMITS) =>
  buildPlanRevenue({ payments: read(rows, reachedCeiling), scope: 'all', planLabelOf, limits });
const one = (rows: PlanPaymentInput[], reachedCeiling = false, limits = LIMITS) =>
  buildPlanRevenue({ payments: read(rows, reachedCeiling), scope: 'one', planLabelOf, limits });

beforeEach(() => jest.clearAllMocks());

// ── An independent copy of SQL check 17 (§13, E-40), in minor units ─────────

interface CheckSeventeenRow {
  currency: string;
  payments: number;
  zero_amount_invoices: number;
  businesses_paid: number;
  received_minor: number;
  tax_minor: number;
  deleted_account_payments: number;
  deleted_account_received_minor: number;
}

/** Written from the SQL, not from the builder: kind = invoice_paid, grouped by upper(btrim(currency)). */
function checkSeventeen(rows: PlanPaymentInput[]): CheckSeventeenRow[] {
  const paid = rows.filter((r) => r.kind === 'invoice_paid');
  const groups = new Map<string, PlanPaymentInput[]>();
  for (const r of paid) {
    const currency = String(r.currency).trim().toUpperCase();
    groups.set(currency, [...(groups.get(currency) ?? []), r]);
  }
  const n = (v: unknown) => v as number;
  return [...groups.entries()]
    .map(([currency, g]) => ({
      currency,
      payments: g.filter((r) => n(r.amount_minor) > 0).length,
      zero_amount_invoices: g.filter((r) => n(r.amount_minor) === 0).length,
      businesses_paid: new Set(g.filter((r) => n(r.amount_minor) > 0 && r.user_id !== null).map((r) => r.user_id)).size,
      received_minor: g.reduce((s, r) => s + n(r.amount_minor), 0),
      tax_minor: g.reduce((s, r) => s + n(r.amount_tax_minor), 0),
      deleted_account_payments: g.filter((r) => r.user_id === null && n(r.amount_minor) > 0).length,
      deleted_account_received_minor: g.filter((r) => r.user_id === null).reduce((s, r) => s + n(r.amount_minor), 0),
    }))
    .sort((a, b) => (a.currency < b.currency ? -1 : 1));
}

/** Check 18's plan column: per (account, currency), deleted accounts as one bucket. */
function checkEighteenPlans(rows: PlanPaymentInput[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows.filter((x) => x.kind === 'invoice_paid')) {
    const key = `${r.user_id ?? 'deleted accounts'}|${String(r.currency).trim().toUpperCase()}`;
    out.set(key, (out.get(key) ?? 0) + (r.amount_minor as number));
  }
  return out;
}

const MONTH: PlanPaymentInput[] = [
  invoice(), // the owner's USD 79.00
  invoice({ user_id: B, amount_minor: 1999, amount_tax_minor: 199, currency: 'USD' }),
  invoice({ user_id: B, amount_minor: 2500, amount_tax_minor: 0, currency: 'eur' }),
  invoice({ user_id: null, amount_minor: 4900, amount_tax_minor: 0, currency: ' usd ' }),
  invoice({ user_id: C, amount_minor: 0, amount_tax_minor: 0 }),
  invoice({ kind: 'mismatch_refused', amount_minor: 7900 }),
];

describe('AC-117: the figures equal check 17 (per currency)', () => {
  it('payments, zero-amount invoices, businesses that paid, received, tax and the deleted-account columns', () => {
    const result = all(MONTH);
    const check = checkSeventeen(MONTH);
    expect(result.lines!.map((l) => l.currency)).toEqual(check.map((c) => c.currency));
    for (const c of check) {
      const line = result.lines!.find((l) => l.currency === c.currency)!;
      expect({ currency: c.currency, payments: line.payments, zero: line.zeroAmountInvoices, businesses: line.businesses, received: line.received, tax: line.tax }).toEqual({
        currency: c.currency,
        payments: c.payments,
        zero: c.zero_amount_invoices,
        businesses: c.businesses_paid,
        received: c.received_minor / 100,
        tax: c.tax_minor / 100,
      });
      const deleted = result.deletedAccounts!.find((d) => d.currency === c.currency);
      expect(deleted?.payments ?? 0).toBe(c.deleted_account_payments);
      expect(deleted?.received ?? 0).toBe(c.deleted_account_received_minor / 100);
    }
  });

  it('the owner fixture: one USD payment of 79.00, tax 0.00, one business, nothing from deleted accounts', () => {
    const result = all([invoice()]);
    expect(result.lines).toEqual([
      { currency: 'USD', payments: 1, received: 79, tax: 0, businesses: 1, zeroAmountInvoices: 0, unreadable: 0, exact: true },
    ]);
    expect(result.deletedAccounts).toEqual([]);
    expect(result.status).toBe('ok');
    expect(result.receivedMinorByCurrency).toEqual([{ currency: 'USD', receivedMinor: 7900 }]);
  });
});

describe('AC-118 (builder half): each row given counts once; the builder reads no window', () => {
  it('n rows → n payments, whatever their paid_at', () => {
    const result = all([invoice({ paid_at: null }), invoice({ paid_at: '1999-01-01T00:00:00Z' }), invoice()]);
    expect(result.lines![0].payments).toBe(3);
  });
});

describe('AC-119: only invoice_paid counts', () => {
  it('a planted mismatch_refused row with 7900 is in no sum, counted as another kind; the block is partial', () => {
    const result = all([invoice(), invoice({ kind: 'mismatch_refused' }), invoice({ kind: null })]);
    expect(result.lines![0]).toMatchObject({ payments: 1, received: 79 });
    expect(result.notes!.otherKind).toBe(2);
    expect(result.counts.otherKind).toBe(2);
    expect(result.status).toBe('partial');
    expect(PLAN_PAYMENT_KIND).toBe('invoice_paid');
  });
});

describe('AC-120: minor units, exact', () => {
  it('7900 → 79.00 and 1999 → 19.99 on the wire, never × 100; usd and " USD " are one USD line', () => {
    const result = all([invoice({ currency: 'usd' }), invoice({ amount_minor: 1999, currency: ' USD ' })]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines![0]).toMatchObject({ currency: 'USD', payments: 2, received: 98.99 });
    expect(all([invoice({ amount_minor: 1999 })]).lines![0].received).toBe(19.99);
  });

  it('asks minorUnitsPerMajor with the normalised code only, never with null or a raw value', () => {
    all([invoice({ currency: ' usd ' }), invoice({ currency: null }), invoice({ currency: 42 })]);
    expect(mockMinorUnits.mock.calls.map((c) => c[0])).toEqual(['USD']);
  });

  const UNREADABLE: Array<[string, Partial<PlanPaymentInput>]> = [
    ['a fractional amount 1.5', { amount_minor: 1.5 }],
    ['a negative amount -1', { amount_minor: -1 }],
    ['an amount past the safe range', { amount_minor: Number.MAX_SAFE_INTEGER + 2 }],
    ['a numeric string "7900"', { amount_minor: '7900' }],
    ['a NULL amount', { amount_minor: null }],
    ['a NULL tax', { amount_tax_minor: null }],
    ['tax greater than amount', { amount_minor: 100, amount_tax_minor: 101 }],
  ];

  it.each(UNREADABLE)('%s: not a payment, counted, excluded, line "At least", partial, never 0', (_name, extra) => {
    const result = all([invoice(), invoice(extra)]);
    expect(result.lines![0]).toEqual({
      currency: 'USD', payments: 1, received: 79, tax: 0, businesses: 1, zeroAmountInvoices: 0, unreadable: 1, exact: false,
    });
    expect(result.notes!.unreadable).toBe(1);
    expect(result.status).toBe('partial');
    expect(result.receivedMinorByCurrency).toEqual([{ currency: 'USD', receivedMinor: null }]);
  });

  it('a NULL currency: the Unknown currency line, unreadable, minorUnitsPerMajor never called for it', () => {
    const result = all([invoice({ currency: null })]);
    expect(result.lines).toEqual([
      { currency: null, payments: 0, received: 0, tax: 0, businesses: 0, zeroAmountInvoices: 0, unreadable: 1, exact: false },
    ]);
    expect(mockMinorUnits).not.toHaveBeenCalled();
    expect(result.notes!.empty).toBe(false);
  });

  it('a currency with other than two decimals (mocked to 1) is unreadable', () => {
    mockMinorUnits.mockImplementation((code: string) => (code === 'USD' ? 1 : 100));
    const result = all([invoice()]);
    expect(result.lines![0]).toMatchObject({ payments: 0, received: 0, unreadable: 1, exact: false });
    mockMinorUnits.mockImplementation(jest.requireActual('@/lib/payments/refundMath').minorUnitsPerMajor);
  });

  it('a NULL tier is not unreadable ("Unknown plan"); a NULL period is not unreadable', () => {
    const result = one([invoice({ tier: null, period_start: null, period_end: null })]);
    expect(result.status).toBe('ok');
    expect(result.payments![0]).toMatchObject({ planLabel: null, periodStart: null, periodEnd: null, received: 79 });
  });

  it('an overflowing sum is never silent: not exact, partial', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const result = all([invoice({ amount_minor: big }), invoice({ amount_minor: big })]);
    expect(result.lines![0].exact).toBe(false);
    expect(result.status).toBe('partial');
    expect(result.receivedMinorByCurrency![0].receivedMinor).toBeNull();
  });
});

describe('AC-121: zero-amount invoices', () => {
  it('not a payment; received unchanged; counted on the line and in the note', () => {
    const result = all([invoice(), invoice({ user_id: C, amount_minor: 0 })]);
    expect(result.lines![0]).toMatchObject({ payments: 1, received: 79, businesses: 1, zeroAmountInvoices: 1 });
    expect(result.notes!.zeroAmountInvoices).toBe(1);
    expect(result.status).toBe('ok');
  });

  it('a currency with only zero-amount invoices has no line (no "0.00"); the block is empty but says so', () => {
    const result = all([invoice({ amount_minor: 0 })]);
    expect(result.lines).toEqual([]);
    expect(result.notes).toEqual({ empty: true, exact: true, zeroAmountInvoices: 1, unreadable: 0, otherKind: 0 });
  });
});

describe('AC-124 (builder half): by business, deleted accounts, order, cap', () => {
  it('each by-business row equals check 18\'s plan column per account and currency', () => {
    const result = all(MONTH);
    const check = checkEighteenPlans(MONTH);
    for (const row of result.accounts!) {
      expect(row.received).toBe(check.get(`${row.accountId}|${row.currency}`)! / 100);
    }
    // The deleted line comes from NULL user_id only, never named.
    expect(result.deletedAccounts).toEqual([{ currency: 'USD', payments: 1, received: 49, exact: true }]);
    expect(check.get('deleted accounts|USD')).toBe(4900);
    expect(result.accounts!.some((r) => (r as { accountId: string | null }).accountId === null)).toBe(false);
  });

  it('SA-W66: currency (Unknown last), then received highest first, then the account id; amounts never ranked across currencies', () => {
    const result = all([
      invoice({ user_id: C, amount_minor: 100, currency: 'usd' }),
      invoice({ user_id: A, amount_minor: 500, currency: 'usd' }),
      invoice({ user_id: B, amount_minor: 500, currency: 'usd' }),
      invoice({ user_id: A, amount_minor: 99999, currency: 'eur' }),
      invoice({ user_id: B, amount_minor: 1, currency: null }),
    ]);
    expect(result.accounts!.map((r) => [r.currency, r.accountId])).toEqual([
      ['EUR', A],
      ['USD', A],
      ['USD', B],
      ['USD', C],
      [null, B],
    ]);
  });

  it('the cap: accountsTotal counts every row before it', () => {
    const result = all([invoice({ user_id: A }), invoice({ user_id: B }), invoice({ user_id: C })], false, { accountsShown: 2, paymentsShown: 50 });
    expect(result.accounts).toHaveLength(2);
    expect(result.accountsTotal).toBe(3);
    expect(result.counts.accountsTotal).toBe(3);
  });

  it('a business picked → no table and no deleted line, the payment list instead', () => {
    const result = one([invoice()]);
    expect(result.accounts).toBeNull();
    expect(result.accountsTotal).toBeNull();
    expect(result.deletedAccounts).toBeNull();
    expect(result.payments).toHaveLength(1);
    expect(result.paymentsTotal).toBe(1);
  });
});

describe('AC-125: the ceiling', () => {
  it('every line inexact, received minor null, partial; counts and amounts stay', () => {
    const result = all(MONTH, true);
    expect(result.lines!.every((l) => l.exact === false)).toBe(true);
    expect(result.receivedMinorByCurrency!.every((l) => l.receivedMinor === null)).toBe(true);
    expect(result.notes!.exact).toBe(false);
    expect(result.status).toBe('partial');
    expect(result.lines!.find((l) => l.currency === 'USD')!.received).toBeGreaterThan(0);
  });
});

describe('AC-126: empty, and the read failed', () => {
  it('no payment → empty, no line, ok', () => {
    expect(all([])).toMatchObject({ status: 'ok', lines: [], accounts: [], deletedAccounts: [], notes: { empty: true } });
  });

  it('the read failed → unknown, every figure null', () => {
    const result = buildPlanRevenue({ payments: null, scope: 'all', planLabelOf, limits: LIMITS });
    expect(result).toMatchObject({ status: 'unknown', lines: null, accounts: null, payments: null, deletedAccounts: null, notes: null, receivedMinorByCurrency: null });
  });
});

describe('the one-business list (M2-FR-3)', () => {
  it('newest first by paid_at, stable on ties by id; each row has its label, money and period', () => {
    const older = invoice({ paid_at: '2026-10-01T09:00:00.000Z' });
    const tieB = invoice({ id: 'eeeeeeee-0000-4000-8000-0000000000bb', paid_at: '2026-10-12T18:21:09.000Z' });
    const tieA = invoice({ id: 'eeeeeeee-0000-4000-8000-0000000000aa', paid_at: '2026-10-12T18:21:09.000Z' });
    const result = one([older, tieB, tieA]);
    expect(result.payments!.map((p) => p.id)).toEqual([tieA.id, tieB.id, older.id]);
    expect(result.payments![0]).toEqual({
      id: tieA.id,
      paidAt: '2026-10-12T18:21:09.000Z',
      planLabel: LABEL,
      received: 79,
      tax: 0,
      currency: 'USD',
      periodStart: '2026-10-12T18:21:07.000Z',
      periodEnd: '2026-11-12T18:21:07.000Z',
    });
  });

  it('zero-amount and unreadable invoices are not in the list; the cap keeps paymentsTotal', () => {
    const result = one([invoice(), invoice({ amount_minor: 0 }), invoice({ amount_minor: '1' }), invoice()], false, { accountsShown: 200, paymentsShown: 1 });
    expect(result.payments).toHaveLength(1);
    expect(result.paymentsTotal).toBe(2);
  });

  it('SA-W65: the label comes from the callback with the stored tier; a tier it does not know is null ("Unknown plan")', () => {
    const result = one([invoice(), invoice({ tier: 'not_a_tier' }), invoice({ tier: null })]);
    expect(planLabelOf.mock.calls.map((c) => c[0]).sort()).toEqual([STORED_TIER, 'not_a_tier', null].sort());
    expect(result.payments!.map((p) => p.planLabel).sort()).toEqual([LABEL, null, null].sort());
  });
});
