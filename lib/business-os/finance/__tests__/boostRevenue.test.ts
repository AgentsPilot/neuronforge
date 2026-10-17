/**
 * The boost revenue builder (finance & business health slice 4a, T2): AC-87
 * against an independent copy of SQL check 14, AC-88's builder half, AC-89
 * (statuses, and the paid-family literal against the migration's CHECKs),
 * AC-90 (minor units exact; every SA-W48 unreadable case), AC-92 (per currency
 * only), AC-93 (the ceiling), AC-94 (empty), AC-97 (deleted accounts).
 *
 * Slice 5a (SA-W59): K-5 moved to `ourRevenue.ts`. This builder gives the
 * combiner `netMinorByCurrency`: integer minor units per line, null exactly
 * when the wire net is null.
 *
 * Slice 4b.2 (BD-17, FR-4B-1 to FR-4B-9, FR-4B-16): refunds and lost disputes
 * now come from the REVERSAL EVENTS recorded in the window, never from the
 * purchase row; held is a NOW figure passed in and never in a net. AC-217,
 * AC-218, AC-220 to AC-224 (builder half), and E-103 (every new field set).
 * The 4a refund-in-purchase-month cases (AC-91) are replaced by these.
 */

jest.mock('@/lib/payments/refundMath', () => {
  const actual = jest.requireActual('@/lib/payments/refundMath');
  return { ...actual, minorUnitsPerMajor: jest.fn(actual.minorUnitsPerMajor) };
});

import * as fs from 'fs';
import * as path from 'path';

import { minorUnitsPerMajor } from '@/lib/payments/refundMath';
import { BOOST_PAID_FAMILY, buildBoostRevenue, readMoney, readReversalMoney, type BoostPurchaseInput } from '../boostRevenue';

const mockMinorUnits = minorUnitsPerMajor as jest.MockedFunction<typeof minorUnitsPerMajor>;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

type EventInput = Parameters<typeof readReversalMoney>[0];

let seq = 0;
function boost(extra: Partial<BoostPurchaseInput> = {}): BoostPurchaseInput {
  seq += 1;
  return {
    id: `bbbbbbbb-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id: A,
    status: 'paid',
    package_id: 'pkg-small',
    package_version: 1,
    currency: 'USD',
    amount_total_minor: 1000,
    amount_tax_minor: 0,
    credits_total: '5000.000000',
    ...extra,
  };
}

function event(extra: Partial<EventInput> = {}, purchase: Partial<NonNullable<EventInput['purchase']>> = {}): EventInput {
  seq += 1;
  return {
    id: `eeeeeeee-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    purchase_id: 'pppppppp-0000-4000-8000-000000000001',
    kind: 'refund',
    amount_minor: 300,
    currency: 'USD',
    purchase: {
      user_id: A,
      package_id: 'pkg-small',
      package_version: 1,
      amount_total_minor: 1000,
      amount_tax_minor: 0,
      paid: true,
      ...purchase,
    },
    ...extra,
  };
}

const read = <T,>(rows: T[], reachedCeiling = false) => ({ rows, reachedCeiling });
const NO_EVENTS = read<EventInput>([]);
const all = (rows: BoostPurchaseInput[], reachedCeiling = false, events: EventInput[] = []) =>
  buildBoostRevenue({ purchases: read(rows, reachedCeiling), events: read(events), heldNow: [], scope: 'all' });

beforeEach(() => jest.clearAllMocks());

// ── An independent copy of SQL check 14 (§13), in minor units (purchases only, 4b.2) ──

interface CheckRow {
  currency: string;
  package: string;
  purchases: number;
  deleted_account_purchases: number;
  gross_minor: number;
  tax_minor: number;
  credits_sold: number;
}

/** Written from the SQL, not from the builder: grouping sets (currency, package, version) and (currency). */
function checkFourteen(rows: BoostPurchaseInput[]): CheckRow[] {
  const family = ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'];
  const paid = rows.filter((r) => r.status !== null && family.includes(r.status));
  const groups = new Map<string, BoostPurchaseInput[]>();
  for (const r of paid) {
    const currency = String(r.currency).trim().toUpperCase();
    for (const key of [`${currency}|${r.package_id} v${r.package_version}`, `${currency}|ALL`]) {
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
  }
  const n = (v: unknown) => v as number;
  return [...groups.entries()].map(([key, g]) => {
    const [currency, pkg] = key.split('|');
    const sum = (f: (r: BoostPurchaseInput) => number) => g.reduce((s, r) => s + f(r), 0);
    return {
      currency,
      package: pkg,
      purchases: g.length,
      deleted_account_purchases: g.filter((r) => r.user_id === null).length,
      gross_minor: sum((r) => n(r.amount_total_minor)),
      tax_minor: sum((r) => n(r.amount_tax_minor)),
      credits_sold: sum((r) => Number(r.credits_total)),
    };
  });
}

/** A month of every paid-family status, two accounts and two deleted-account purchases. */
const MONTH: BoostPurchaseInput[] = [
  boost({ amount_total_minor: 1000, credits_total: '5000.000000' }),
  boost({ user_id: B, status: 'partially_refunded', currency: 'usd ', amount_total_minor: 1999 }),
  boost({ status: 'refunded', package_id: 'pkg-big', package_version: 2, amount_total_minor: 5000, amount_tax_minor: 100, credits_total: 30000 }),
  boost({ user_id: B, status: 'disputed', package_id: 'pkg-big', package_version: 2, amount_total_minor: 5000, credits_total: '30000.5' }),
  boost({ user_id: null, status: 'dispute_lost', amount_total_minor: 1000 }),
  boost({ user_id: null, package_id: 'pkg-big', package_version: 2, amount_total_minor: 5000, credits_total: 30000 }),
];

describe('AC-87 / AC-220: purchases, gross, tax and credits sold equal check 14 (per currency and per package)', () => {
  const result = all(MONTH);
  const check = checkFourteen(MONTH);

  it('the currency line equals the ALL row; with no event, refunded and lost are 0 and net = gross (FR-4B-5)', () => {
    const allRow = check.find((r) => r.package === 'ALL')!;
    expect(result.lines).toHaveLength(1);
    expect(result.lines![0]).toEqual({
      currency: 'USD',
      purchases: allRow.purchases,
      gross: allRow.gross_minor / 100,
      tax: allRow.tax_minor / 100,
      refunded: 0,
      lost: 0,
      net: allRow.gross_minor / 100,
      creditsSold: allRow.credits_sold,
      unreadable: 0,
      unreadableEvents: 0,
      unreadableCredits: 0,
    });
    expect(result.status).toBe('ok');
  });

  it('a purchase status of refunded, disputed or lost moves no money any more: only events do (BD-17)', () => {
    expect(result.lines![0].net).toBe(result.lines![0].gross);
    expect(result.notes!.refundOrDispute).toBe(false);
  });

  it('each by-package row equals its check 14 row, sorted by currency, id, version', () => {
    const rows = check.filter((r) => r.package !== 'ALL').sort((a, b) => (a.package < b.package ? -1 : 1));
    expect(result.packages).toEqual(
      rows.map((r) => ({
        currency: r.currency,
        packageId: r.package.split(' v')[0],
        packageVersion: Number(r.package.split(' v')[1]),
        purchases: r.purchases,
        gross: r.gross_minor / 100,
        refunded: 0,
        net: r.gross_minor / 100,
        unreadable: 0,
      }))
    );
    expect(result.packages!.map((p) => p.packageId)).toEqual(['pkg-big', 'pkg-small']);
  });

  it('AC-97: the deleted-accounts line; never a name', () => {
    expect(result.deletedAccounts).toEqual([{ currency: 'USD', purchases: 2, net: 60, unreadable: 0 }]);
    expect(result.lines![0].purchases).toBe(MONTH.length);
    expect(JSON.stringify(result.deletedAccounts)).not.toMatch(/user_id|name/);
    expect(result.counts.deletedAccountPurchases).toBe(2);
  });
});

describe('AC-88 (builder half): each row it is given counts once; it never looks at a date', () => {
  it('n rows → n purchases', () => {
    expect(all([boost(), boost(), boost()]).lines![0].purchases).toBe(3);
  });

  it('a row with no date at all still counts: the read decided the window', () => {
    const rows = [boost()];
    expect('paid_at' in rows[0]).toBe(false);
    expect(all(rows).lines![0]).toMatchObject({ purchases: 1, gross: 10 });
  });
});

describe('AC-89: statuses', () => {
  it.each(BOOST_PAID_FAMILY)('%s counts', (status) => {
    const result = all([boost({ status })]);
    expect(result.lines![0].purchases).toBe(1);
    expect(result.notes!.otherStatusPurchases).toBe(0);
  });

  it('a planted pending, flagged_mismatch, NULL or differently cased status is left out of every sum and counted; partial', () => {
    const result = all([
      boost(),
      boost({ status: 'awaiting_payment', amount_total_minor: 9999 }),
      boost({ status: 'flagged_mismatch', amount_total_minor: 9999 }),
      boost({ status: null, amount_total_minor: 9999 }),
      boost({ status: 'PAID', amount_total_minor: 9999 }),
      boost({ status: ' paid', amount_total_minor: 9999 }),
    ]);
    expect(result.notes!.otherStatusPurchases).toBe(5);
    expect(result.lines).toEqual([expect.objectContaining({ purchases: 1, gross: 10, net: 10 })]);
    expect(result.packages!.map((p) => p.purchases)).toEqual([1]);
    expect(result.status).toBe('partial');
  });

  it('only other statuses → empty (no line), still partial because something was left out', () => {
    const result = all([boost({ status: 'expired' })]);
    expect(result.lines).toEqual([]);
    expect(result.notes).toMatchObject({ empty: true, otherStatusPurchases: 1 });
    expect(result.status).toBe('partial');
    expect(result.netMinorByCurrency).toEqual([]);
  });
});

describe('S4-W-2: the paid-family literal matches the migration CHECKs (the SA-W2 precedent)', () => {
  const MIGRATION = path.join(process.cwd(), 'supabase/migrations/20261030_business_os_boost_purchases.sql');
  const listOf = (sql: string, constraint: string, keyword: 'IN' | 'NOT IN') => {
    const re = new RegExp(`${constraint} CHECK \\(status ${keyword} \\(([^)]*)\\)`);
    const match = sql.match(re);
    return match ? [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : null;
  };
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  it('equals the paid_family_complete list exactly, and is a subset of status_known', () => {
    const family = listOf(sql, 'business_os_boost_purchases_paid_family_complete', 'NOT IN');
    const known = listOf(sql, 'business_os_boost_purchases_status_known', 'IN');
    expect(family).toEqual([...BOOST_PAID_FAMILY]);
    expect(known).not.toBeNull();
    for (const status of BOOST_PAID_FAMILY) expect(known).toContain(status);
  });

  it('the check bites (planted): an extra status in the extracted list fails', () => {
    const planted = sql.replace(
      "status NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')",
      "status NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost', 'chargeback')"
    );
    expect(planted).not.toBe(sql);
    expect(listOf(planted, 'business_os_boost_purchases_paid_family_complete', 'NOT IN')).not.toEqual([...BOOST_PAID_FAMILY]);
  });
});

describe('AC-90: minor units, exact', () => {
  it('1000 → 10.00 and 1999 → 19.99 on the wire, never × 100', () => {
    expect(all([boost({ amount_total_minor: 1000 })]).lines![0]).toMatchObject({ gross: 10, net: 10 });
    expect(all([boost({ amount_total_minor: 1999 })]).lines![0]).toMatchObject({ gross: 19.99, net: 19.99 });
    expect(all([boost({ amount_total_minor: 1 })]).lines![0].gross).toBe(0.01);
  });

  it('asks minorUnitsPerMajor with the normalised code, and never with null or a non-string', () => {
    all([boost({ currency: ' usd ' }), boost({ currency: null }), boost({ currency: 42 }), boost({ currency: 'US' })]);
    expect(mockMinorUnits).toHaveBeenCalledWith('USD');
    for (const [arg] of mockMinorUnits.mock.calls) expect(arg).toBe('USD');
  });

  const UNREADABLE: Array<[string, Partial<BoostPurchaseInput>]> = [
    ['a fractional total', { amount_total_minor: 1.5 }],
    ['a negative total', { amount_total_minor: -1 }],
    ['an unsafe total', { amount_total_minor: Number.MAX_SAFE_INTEGER + 2 }],
    ['a numeric-string total (SA-W48)', { amount_total_minor: '1000' }],
    ['a null total on a paid row', { amount_total_minor: null }],
    ['a numeric-string tax', { amount_tax_minor: '0' }],
    ['a null tax', { amount_tax_minor: null }],
    ['a NaN total', { amount_total_minor: Number.NaN }],
  ];

  it.each(UNREADABLE)('%s: counted, excluded from every sum, net Unknown, partial, never 0', (_name, extra) => {
    const result = all([boost(), boost(extra)]);
    const line = result.lines![0];
    expect(line).toMatchObject({ currency: 'USD', purchases: 2, gross: 10, tax: 0, refunded: 0, lost: 0, net: null, unreadable: 1 });
    expect(result.notes!.unreadablePurchases).toBe(1);
    expect(result.status).toBe('partial');
    expect(result.packages![0]).toMatchObject({ purchases: 2, net: null, unreadable: 1 });
    expect(result.netMinorByCurrency).toEqual([{ currency: 'USD', netMinor: null }]);
    expect(line.creditsSold).toBe(10000);
  });

  it('a NULL currency: the Unknown currency line, unreadable, minorUnitsPerMajor never called for it', () => {
    const result = all([boost({ currency: null })]);
    expect(result.lines).toEqual([expect.objectContaining({ currency: null, purchases: 1, gross: 0, net: null, unreadable: 1 })]);
    expect(mockMinorUnits).not.toHaveBeenCalled();
    expect(result.status).toBe('partial');
  });

  it('a currency with other than two decimals (mocked) is unreadable', () => {
    mockMinorUnits.mockReturnValueOnce(1000);
    const result = all([boost()]);
    expect(result.lines![0]).toMatchObject({ purchases: 1, gross: 0, net: null, unreadable: 1 });
    expect(result.status).toBe('partial');
  });

  it('a real zero-decimal currency is unreadable too, on its own line', () => {
    const result = all([boost(), boost({ currency: 'jpy' })]);
    expect(result.lines!.map((l) => [l.currency, l.unreadable, l.net])).toEqual([
      ['JPY', 1, null],
      ['USD', 0, 10],
    ]);
  });

  it('an overflowing sum is never silent: net Unknown, partial', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const result = all([boost({ amount_total_minor: big }), boost({ amount_total_minor: big })]);
    expect(result.lines![0].net).toBeNull();
    expect(result.status).toBe('partial');
  });
});

describe('credits sold (S4-W-6): through the credit scale once; not money', () => {
  it('a number and a numeric string both count, exactly at 6 dp', () => {
    expect(all([boost({ credits_total: '0.000001' }), boost({ credits_total: 1.5 })]).lines![0].creditsSold).toBe(1.500001);
  });

  it('unreadable credits are counted, left out, and make the block partial; money is untouched', () => {
    const result = all([boost(), boost({ credits_total: 'lots' }), boost({ credits_total: null })]);
    expect(result.lines![0]).toMatchObject({ purchases: 3, gross: 30, net: 30, creditsSold: 5000, unreadableCredits: 2, unreadable: 0 });
    expect(result.status).toBe('partial');
    expect(result.counts.unreadableCredits).toBe(2);
  });
});

// ── Slice 4b.2: refunds and lost disputes by the date we recorded them (BD-17) ──

describe('AC-217: a purchase paid in October and refunded in November', () => {
  // The read decides the window: October's reads hold the purchase and no event;
  // November's hold the refund event and no purchase.
  const october = all([boost({ status: 'refunded' })], false, []);
  const november = all([], false, [event({ kind: 'refund', amount_minor: 1000 })]);

  it('October: gross 10, refunded 0, net 10, unchanged by the later refund', () => {
    expect(october.lines![0]).toMatchObject({ gross: 10, refunded: 0, net: 10 });
  });

  it('November: no purchase, the refund, and a negative net with nothing clamped (FR-4B-5)', () => {
    expect(november.notes!.empty).toBe(false);
    expect(november.lines![0]).toMatchObject({ purchases: 0, gross: 0, refunded: 10, lost: 0, net: -10 });
    expect(november.netMinorByCurrency).toEqual([{ currency: 'USD', netMinor: -1000 }]);
    expect(november.notes!.refundOrDispute).toBe(true);
    expect(november.events!.refundEvents).toBe(1);
  });

  it('a partial then a full refund in one window: both deltas count', () => {
    const r = all([boost()], false, [event({ amount_minor: 300 }), event({ amount_minor: 700 })]);
    expect(r.lines![0]).toMatchObject({ gross: 10, refunded: 10, net: 0 });
  });
});

describe('AC-218: a dispute opened in October and lost in November', () => {
  it('October (opened only): nothing moves; November (lost): lost equals the event amount', () => {
    const october = all([boost()], false, [event({ kind: 'dispute_opened', amount_minor: 1000 })]);
    expect(october.lines![0]).toMatchObject({ refunded: 0, lost: 0, net: 10 });
    const november = all([], false, [event({ kind: 'dispute_lost', amount_minor: 1000 })]);
    expect(november.lines![0]).toMatchObject({ refunded: 0, lost: 10, net: -10 });
  });

  it('a won dispute is history: no money', () => {
    expect(all([boost()], false, [event({ kind: 'dispute_won', amount_minor: 1000 })]).lines![0]).toMatchObject({ net: 10, lost: 0 });
  });
});

describe('AC-219 (builder half): held now is passed through and never in a net', () => {
  it('heldNow is shown per currency; net is unchanged by it; the timing note shows', () => {
    const r = buildBoostRevenue({
      purchases: read([boost()]),
      events: NO_EVENTS,
      heldNow: [{ currency: 'USD', disputes: 1, amountMinor: 800 }],
      scope: 'all',
    });
    expect(r.heldNow).toEqual([{ currency: 'USD', disputes: 1, amount: 8 }]);
    expect(r.lines![0].net).toBe(10);
    expect(r.notes!.refundOrDispute).toBe(true);
  });

  it('the attention read failed → heldNow null; the revenue still builds', () => {
    const r = buildBoostRevenue({ purchases: read([boost()]), events: NO_EVENTS, heldNow: null, scope: 'all' });
    expect(r.heldNow).toBeNull();
    expect(r.lines![0].net).toBe(10);
  });
});

describe('AC-221: an event on a purchase never paid changes no figure and is counted', () => {
  it('no line, no money; onUnpaidPurchases 1', () => {
    const r = all([boost()], false, [event({ amount_minor: 500 }, { paid: false })]);
    expect(r.lines![0]).toMatchObject({ refunded: 0, net: 10 });
    expect(r.events!.onUnpaidPurchases).toBe(1);
  });
});

describe('AC-222: deleted accounts and packages', () => {
  it('an event of a deleted account counts on the Deleted accounts line; packages group by the purchase', () => {
    const r = all([], false, [event({ amount_minor: 200 }, { user_id: null, package_id: 'pkg-big', package_version: 2 })]);
    expect(r.deletedAccounts).toEqual([{ currency: 'USD', purchases: 0, net: -2, unreadable: 0 }]);
    expect(r.packages).toEqual([
      { currency: 'USD', packageId: 'pkg-big', packageVersion: 2, purchases: 0, gross: 0, refunded: 2, net: -2, unreadable: 0 },
    ]);
  });
});

describe('AC-223: unreadable events and the ceiling', () => {
  it.each([
    ['a string amount', { amount_minor: '300' }],
    ['a negative amount', { amount_minor: -1 }],
    ['an unknown kind', { kind: 'chargeback' }],
    ['no purchase', { purchase: null }],
  ] as Array<[string, Partial<EventInput>]>)('%s: counted, net Unknown on its line, partial', (_n, extra) => {
    const r = all([boost()], false, [event(extra)]);
    expect(r.lines![0]).toMatchObject({ refunded: 0, net: null, unreadableEvents: 1 });
    expect(r.events!.unreadable).toBe(1);
    expect(r.notes!.refundOrDispute).toBe(true);
    expect(r.status).toBe('partial');
  });

  it('the event read at its ceiling: refunded and lost stay (at least), net Unknown, partial', () => {
    const r = buildBoostRevenue({ purchases: read([boost()]), events: read([event()], true), heldNow: [], scope: 'all' });
    expect(r.lines![0]).toMatchObject({ refunded: 3, net: null });
    expect(r.notes!.exact).toBe(false);
    expect(r.events!.exact).toBe(false);
    expect(r.status).toBe('partial');
  });

  it('SA-Q74: refunds plus lost above the purchase total are counted as recorded, with a count', () => {
    const r = all([], false, [event({ amount_minor: 1000 }), event({ kind: 'dispute_lost', amount_minor: 500 })]);
    expect(r.lines![0]).toMatchObject({ refunded: 10, lost: 5, net: -15 });
    expect(r.events!.overTotal).toBe(1);
  });
});

describe('AC-224 / FR-4B-16: the event read failed', () => {
  it('refunded, lost and net Unknown on every line and package; gross still shows; partial; no fallback', () => {
    const r = buildBoostRevenue({ purchases: read([boost({ status: 'refunded' })]), events: null, heldNow: [], scope: 'all' });
    expect(r.lines![0]).toMatchObject({ gross: 10, refunded: null, lost: null, net: null });
    expect(r.packages![0]).toMatchObject({ refunded: null, net: null });
    expect(r.events).toMatchObject({ state: 'failed', exact: false });
    expect(r.status).toBe('partial');
    expect(r.netMinorByCurrency).toEqual([{ currency: 'USD', netMinor: null }]);
  });

  it('the table is not there yet → state not_available', () => {
    const r = buildBoostRevenue({ purchases: read([boost()]), events: null, eventsAbsent: true, heldNow: [], scope: 'all' });
    expect(r.events!.state).toBe('not_available');
  });
});

describe('AC-92: per currency only', () => {
  it('USD and a planted EUR → two lines, sorted, no total anywhere', () => {
    const result = all([boost({ currency: 'EUR', amount_total_minor: 700 }), boost()], false, [event({ currency: 'EUR', amount_minor: 100 })]);
    expect(result.lines!.map((l) => [l.currency, l.gross, l.refunded])).toEqual([
      ['EUR', 7, 1],
      ['USD', 10, 0],
    ]);
    expect(result.netMinorByCurrency).toEqual([{ currency: 'EUR', netMinor: 600 }, { currency: 'USD', netMinor: 1000 }]);
    expect(Object.keys(result).sort()).toEqual(['counts', 'deletedAccounts', 'events', 'heldNow', 'lines', 'netMinorByCurrency', 'notes', 'packages', 'status']);
    expect(Object.keys(result.notes!).sort()).toEqual(['empty', 'exact', 'otherStatusPurchases', 'refundOrDispute', 'unreadablePurchases']);
  });

  it('the Unknown currency line sorts last, and its package rows sort last within the table', () => {
    const result = all([boost({ currency: '??' }), boost({ currency: 'EUR' }), boost(), boost({ package_id: null }), boost({ package_version: null })]);
    expect(result.lines!.map((l) => l.currency)).toEqual(['EUR', 'USD', null]);
    expect(result.packages!.map((p) => [p.currency, p.packageId, p.packageVersion])).toEqual([
      ['EUR', 'pkg-small', 1],
      ['USD', 'pkg-small', 1],
      ['USD', 'pkg-small', null],
      ['USD', null, 1],
      [null, 'pkg-small', 1],
    ]);
  });
});

describe('AC-93: the purchase read at its ceiling', () => {
  it('counts and amounts stay ("At least"); net null everywhere; partial', () => {
    const result = all(MONTH, true);
    expect(result.notes!.exact).toBe(false);
    expect(result.status).toBe('partial');
    expect(result.lines![0]).toMatchObject({ purchases: 6, net: null });
    expect(result.lines![0].gross).toBeGreaterThan(0);
    expect(result.packages!.every((p) => p.net === null)).toBe(true);
    expect(result.deletedAccounts!.every((d) => d.net === null)).toBe(true);
    expect(result.netMinorByCurrency.every((n) => n.netMinor === null)).toBe(true);
  });
});

describe('AC-94: empty', () => {
  it('no counted purchase and no event → no line, no package, no deleted line; ok', () => {
    const result = all([]);
    expect(result).toMatchObject({
      status: 'ok',
      lines: [],
      packages: [],
      deletedAccounts: [],
      notes: { empty: true, exact: true, otherStatusPurchases: 0, unreadablePurchases: 0, refundOrDispute: false },
      netMinorByCurrency: [],
    });
  });

  it('a business picked → deletedAccounts null (S4-FR-8)', () => {
    const one = (rows: BoostPurchaseInput[]) => buildBoostRevenue({ purchases: read(rows), events: NO_EVENTS, heldNow: [], scope: 'one' });
    expect(one([boost()]).deletedAccounts).toBeNull();
    expect(one([]).deletedAccounts).toBeNull();
  });
});

describe('the purchase read failed', () => {
  it('unknown, every figure null; held now still passed through', () => {
    const result = buildBoostRevenue({ purchases: null, events: NO_EVENTS, heldNow: [], scope: 'all' });
    expect(result).toEqual({
      status: 'unknown',
      lines: null,
      packages: null,
      deletedAccounts: null,
      notes: null,
      heldNow: [],
      events: null,
      netMinorByCurrency: [],
      counts: { counted: 0, unreadableCredits: 0, deletedAccountPurchases: 0, events: 0 },
    });
  });
});

describe('E-103: every new 4b.2 field is set on every built result', () => {
  it.each([
    ['empty', all([])],
    ['purchases', all(MONTH)],
    ['events failed', buildBoostRevenue({ purchases: read([boost()]), events: null, heldNow: null, scope: 'all' })],
  ])('%s: heldNow and events are present keys; lines carry unreadableEvents', (_n, r) => {
    expect(r).toHaveProperty('heldNow');
    expect(r).toHaveProperty('events');
    expect(r.events).not.toBeUndefined();
    for (const line of r.lines ?? []) expect(typeof line.unreadableEvents).toBe('number');
  });
});

describe('netMinorByCurrency (slice 5a, SA-W59): the combiner input, integer minor units', () => {
  it('one currency, exact → the net in minor units (1000 ↔ 10)', () => {
    const result = all([boost()]);
    expect(result.netMinorByCurrency).toEqual([{ currency: 'USD', netMinor: 1000 }]);
    expect(result.lines![0].net).toBe(10);
  });

  it('a full refund in the window nets to 0: a real 0, not null', () => {
    expect(all([boost()], false, [event({ amount_minor: 1000 })]).netMinorByCurrency).toEqual([{ currency: 'USD', netMinor: 0 }]);
  });

  it('null exactly where the wire net is null, one entry per line, in line order', () => {
    const result = all([boost({ currency: 'EUR', amount_total_minor: 'x' as unknown as number }), boost()]);
    expect(result.netMinorByCurrency.map((n) => n.currency)).toEqual(result.lines!.map((l) => l.currency));
    result.lines!.forEach((line, i) => expect(result.netMinorByCurrency[i].netMinor === null).toBe(line.net === null));
  });
});

describe('readMoney (slice 6a, SA-Q45; slice 4b.2: total and tax only)', () => {
  it('a readable purchase → { total, tax } in integer minor units, whatever its status', () => {
    expect(readMoney(boost({ amount_total_minor: 1000, amount_tax_minor: 100 }))).toEqual({ total: 1000, tax: 100 });
    expect(readMoney(boost({ status: 'disputed' }))).toEqual({ total: 1000, tax: 0 });
  });

  it('unreadable → null; tax above total is NOT refused here (SA-W81)', () => {
    expect(readMoney(boost({ amount_total_minor: '1000' }))).toBeNull();
    expect(readMoney(boost({ currency: 'US' }))).toBeNull();
    expect(readMoney(boost({ amount_total_minor: 100, amount_tax_minor: 120 }))).toEqual({ total: 100, tax: 120 });
  });
});

describe('readReversalMoney (slice 4b.2, SA-W118)', () => {
  it('a refund, a lost dispute, an opened dispute, a never-paid purchase, an unreadable event', () => {
    expect(readReversalMoney(event({ amount_minor: 300 }))).toEqual({ kind: 'money', refunded: 300, lost: 0, tax: 0 });
    expect(readReversalMoney(event({ kind: 'dispute_lost', amount_minor: 900 }, { amount_tax_minor: 50 }))).toEqual({ kind: 'money', refunded: 0, lost: 900, tax: 50 });
    expect(readReversalMoney(event({ kind: 'dispute_opened' }))).toEqual({ kind: 'money', refunded: 0, lost: 0, tax: 0 });
    expect(readReversalMoney(event({}, { paid: false }))).toEqual({ kind: 'not_revenue' });
    expect(readReversalMoney(event({ amount_minor: 1.5 }))).toBeNull();
    expect(readReversalMoney(event({ purchase: null }))).toBeNull();
    expect(readReversalMoney(event({}, { amount_tax_minor: '0' }))).toEqual({ kind: 'money', refunded: 300, lost: 0, tax: null });
  });
});
