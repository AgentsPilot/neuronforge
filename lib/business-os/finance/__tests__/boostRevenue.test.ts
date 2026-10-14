/**
 * The boost revenue builder (finance & business health slice 4a, T2): AC-87
 * against an independent copy of SQL check 14, AC-88's builder half, AC-89
 * (statuses, and the paid-family literal against the migration's CHECKs),
 * AC-90 (minor units exact; every SA-W48 unreadable case), AC-91 (refunds and
 * disputes, DF-5), AC-92 (per currency only), AC-93 (the ceiling), AC-94
 * (empty), AC-97 (deleted accounts) and the K-5 summary (SA-W47).
 *
 * Slice 5a (SA-W59): K-5 moved to `ourRevenue.ts` (its five kinds are tested in
 * ourRevenue.test.ts). This builder now gives the combiner `netMinorByCurrency`:
 * integer minor units per line, null exactly when the wire net is null. The
 * former `.k5` assertions here assert that input instead.
 */

jest.mock('@/lib/payments/refundMath', () => {
  const actual = jest.requireActual('@/lib/payments/refundMath');
  return { ...actual, minorUnitsPerMajor: jest.fn(actual.minorUnitsPerMajor) };
});

import * as fs from 'fs';
import * as path from 'path';

import { minorUnitsPerMajor } from '@/lib/payments/refundMath';
import { BOOST_PAID_FAMILY, buildBoostRevenue, type BoostPurchaseInput } from '../boostRevenue';

const mockMinorUnits = minorUnitsPerMajor as jest.MockedFunction<typeof minorUnitsPerMajor>;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

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
    amount_refunded_minor: 0,
    credits_total: '5000.000000',
    ...extra,
  };
}

const read = (rows: BoostPurchaseInput[], reachedCeiling = false) => ({ rows, reachedCeiling });
const all = (rows: BoostPurchaseInput[], reachedCeiling = false) =>
  buildBoostRevenue({ purchases: read(rows, reachedCeiling), scope: 'all' });

beforeEach(() => jest.clearAllMocks());

// ── An independent copy of SQL check 14 (§13), in minor units ───────────────

interface CheckRow {
  currency: string;
  package: string;
  purchases: number;
  deleted_account_purchases: number;
  deleted_account_net_minor: number;
  gross_minor: number;
  tax_minor: number;
  refunded_minor: number;
  held_in_open_disputes_minor: number;
  lost_in_disputes_minor: number;
  net_minor: number;
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
    const gross = sum((r) => n(r.amount_total_minor));
    const refunded = sum((r) => n(r.amount_refunded_minor));
    const remainderOf = (status: string) =>
      sum((r) => (r.status === status ? n(r.amount_total_minor) - n(r.amount_refunded_minor) : 0));
    const held = remainderOf('disputed');
    const lost = remainderOf('dispute_lost');
    return {
      currency,
      package: pkg,
      purchases: g.length,
      deleted_account_purchases: g.filter((r) => r.user_id === null).length,
      deleted_account_net_minor: sum((r) =>
        r.user_id === null && ['paid', 'partially_refunded', 'refunded'].includes(r.status as string)
          ? n(r.amount_total_minor) - n(r.amount_refunded_minor)
          : 0
      ),
      gross_minor: gross,
      tax_minor: sum((r) => n(r.amount_tax_minor)),
      refunded_minor: refunded,
      held_in_open_disputes_minor: held,
      lost_in_disputes_minor: lost,
      net_minor: gross - refunded - (held + lost),
      credits_sold: sum((r) => Number(r.credits_total)),
    };
  });
}

/** A month of every paid-family status, two accounts and two deleted-account purchases. */
const MONTH: BoostPurchaseInput[] = [
  boost({ amount_total_minor: 1000, credits_total: '5000.000000' }),
  boost({ user_id: B, status: 'partially_refunded', currency: 'usd ', amount_total_minor: 1999, amount_refunded_minor: 500 }),
  boost({ status: 'refunded', package_id: 'pkg-big', package_version: 2, amount_total_minor: 5000, amount_tax_minor: 100, amount_refunded_minor: 5000, credits_total: 30000 }),
  boost({ user_id: B, status: 'disputed', package_id: 'pkg-big', package_version: 2, amount_total_minor: 5000, amount_refunded_minor: 1000, credits_total: '30000.5' }),
  boost({ user_id: null, status: 'dispute_lost', amount_total_minor: 1000 }),
  boost({ user_id: null, package_id: 'pkg-big', package_version: 2, amount_total_minor: 5000, credits_total: 30000 }),
];

describe('AC-87: the figures equal check 14 (per currency and per package)', () => {
  const result = all(MONTH);
  const check = checkFourteen(MONTH);

  it('the currency line equals the ALL row; net = gross - refunded - held - lost', () => {
    const allRow = check.find((r) => r.package === 'ALL')!;
    expect(result.lines).toHaveLength(1);
    const line = result.lines![0];
    expect(line).toEqual({
      currency: 'USD',
      purchases: allRow.purchases,
      gross: allRow.gross_minor / 100,
      tax: allRow.tax_minor / 100,
      refunded: allRow.refunded_minor / 100,
      held: allRow.held_in_open_disputes_minor / 100,
      lost: allRow.lost_in_disputes_minor / 100,
      net: allRow.net_minor / 100,
      creditsSold: allRow.credits_sold,
      unreadable: 0,
      unreadableCredits: 0,
    });
    // Integer cents, so the identity holds exactly in cents.
    expect(Math.round(line.net! * 100)).toBe(
      Math.round(line.gross * 100) - Math.round(line.refunded * 100) - Math.round(line.held! * 100) - Math.round(line.lost! * 100)
    );
    expect(result.status).toBe('ok');
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
        refunded: r.refunded_minor / 100,
        net: r.net_minor / 100,
        unreadable: 0,
      }))
    );
    expect(result.packages!.map((p) => p.packageId)).toEqual(['pkg-big', 'pkg-small']);
  });

  it('AC-97: the deleted-accounts line equals deleted_account_purchases and deleted_account_net_minor; never a name', () => {
    const allRow = check.find((r) => r.package === 'ALL')!;
    expect(result.deletedAccounts).toEqual([
      { currency: 'USD', purchases: allRow.deleted_account_purchases, net: allRow.deleted_account_net_minor / 100, unreadable: 0 },
    ]);
    expect(allRow.deleted_account_purchases).toBe(2);
    // The deleted purchases are in the totals too.
    expect(result.lines![0].purchases).toBe(MONTH.length);
    expect(JSON.stringify(result.deletedAccounts)).not.toMatch(/user_id|name/);
    expect(result.counts.deletedAccountPurchases).toBe(2);
  });
});

describe('AC-88 (builder half): each row it is given counts once; it never looks at a date', () => {
  it('n rows → n purchases', () => {
    const rows = [boost(), boost(), boost()];
    expect(all(rows).lines![0].purchases).toBe(3);
  });

  it('a row with no date at all still counts: the read decided the window', () => {
    const rows = [boost()];
    expect('paid_at' in rows[0]).toBe(false);
    expect(all(rows).lines![0]).toMatchObject({ purchases: 1, gross: 10 });
  });
});

describe('AC-89: statuses', () => {
  it.each(BOOST_PAID_FAMILY)('%s counts', (status) => {
    const result = all([boost({ status, amount_refunded_minor: status === 'refunded' ? 1000 : 0 })]);
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
    ['a numeric-string refund', { amount_refunded_minor: '0' }],
    ['a refund above the total', { amount_total_minor: 1000, amount_refunded_minor: 1200 }],
    ['a NaN total', { amount_total_minor: Number.NaN }],
  ];

  it.each(UNREADABLE)('%s: counted, excluded from every sum, net Unknown, partial, never 0', (_name, extra) => {
    const result = all([boost(), boost(extra)]);
    const line = result.lines![0];
    expect(line).toMatchObject({ currency: 'USD', purchases: 2, gross: 10, tax: 0, refunded: 0, held: null, lost: null, net: null, unreadable: 1 });
    expect(result.notes!.unreadablePurchases).toBe(1);
    expect(result.status).toBe('partial');
    expect(result.packages![0]).toMatchObject({ purchases: 2, net: null, unreadable: 1 });
    expect(result.netMinorByCurrency).toEqual([{ currency: 'USD', netMinor: null }]);
    // Credits are not money: the unreadable purchase's credits still count.
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
    const result = all([boost({ credits_total: '0.000001' }), boost({ credits_total: 1.5 })]);
    expect(result.lines![0].creditsSold).toBe(1.500001);
  });

  it('unreadable credits are counted, left out, and make the block partial; money is untouched', () => {
    const result = all([boost(), boost({ credits_total: 'lots' }), boost({ credits_total: null })]);
    expect(result.lines![0]).toMatchObject({ purchases: 3, gross: 30, net: 30, creditsSold: 5000, unreadableCredits: 2, unreadable: 0 });
    expect(result.status).toBe('partial');
    expect(result.counts.unreadableCredits).toBe(2);
  });
});

describe('AC-91: refunds and disputes (DF-5: counted in the purchase window)', () => {
  it.each([
    ['a partial refund', { status: 'partially_refunded', amount_refunded_minor: 300 }, { refunded: 3, held: 0, lost: 0, net: 7 }],
    ['a full refund', { status: 'refunded', amount_refunded_minor: 1000 }, { refunded: 10, held: 0, lost: 0, net: 0 }],
    ['an open dispute with an earlier partial refund', { status: 'disputed', amount_refunded_minor: 200 }, { refunded: 2, held: 8, lost: 0, net: 0 }],
    ['a lost dispute', { status: 'dispute_lost' }, { refunded: 0, held: 0, lost: 10, net: 0 }],
  ] as const)('%s → the S4-W-6 figures, and the refund-timing note', (_name, extra, figures) => {
    const result = all([boost(extra)]);
    expect(result.lines![0]).toMatchObject({ gross: 10, ...figures });
    expect(result.notes!.refundOrDispute).toBe(true);
  });

  it('a won dispute is back in paid: counts in full, no note', () => {
    const result = all([boost({ status: 'paid' })]);
    expect(result.lines![0]).toMatchObject({ gross: 10, refunded: 0, held: 0, lost: 0, net: 10 });
    expect(result.notes!.refundOrDispute).toBe(false);
  });

  it('an unreadable refund row still raises the note (its refund amount is unknown)', () => {
    expect(all([boost({ status: 'refunded', amount_refunded_minor: '1000' })]).notes!.refundOrDispute).toBe(true);
    expect(all([boost({ status: 'paid', amount_total_minor: '1000' })]).notes!.refundOrDispute).toBe(false);
  });
});

describe('AC-92: per currency only', () => {
  it('USD and a planted EUR → two lines, sorted, K-5 "several", no total anywhere', () => {
    const result = all([boost({ currency: 'EUR', amount_total_minor: 700 }), boost()]);
    expect(result.lines!.map((l) => [l.currency, l.gross])).toEqual([
      ['EUR', 7],
      ['USD', 10],
    ]);
    expect(result.netMinorByCurrency).toEqual([{ currency: 'EUR', netMinor: 700 }, { currency: 'USD', netMinor: 1000 }]);
    expect(Object.keys(result).sort()).toEqual(['counts', 'deletedAccounts', 'lines', 'netMinorByCurrency', 'notes', 'packages', 'status']);
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

describe('AC-93: the ceiling', () => {
  it('counts and amounts stay (shown as "At least"); held, lost and net are null everywhere; partial; K-5 unknown cut_off', () => {
    const result = all(MONTH, true);
    expect(result.notes!.exact).toBe(false);
    expect(result.status).toBe('partial');
    expect(result.lines![0]).toMatchObject({ purchases: 6, held: null, lost: null, net: null });
    expect(result.lines![0].gross).toBeGreaterThan(0);
    expect(result.packages!.every((p) => p.net === null)).toBe(true);
    expect(result.deletedAccounts!.every((d) => d.net === null)).toBe(true);
    expect(result.netMinorByCurrency.every((n) => n.netMinor === null)).toBe(true);
  });
});

describe('AC-94: empty', () => {
  it('no counted purchase → no line, no package, no deleted line; ok; K-5 none', () => {
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
    expect(buildBoostRevenue({ purchases: read([boost()]), scope: 'one' }).deletedAccounts).toBeNull();
    expect(buildBoostRevenue({ purchases: read([]), scope: 'one' }).deletedAccounts).toBeNull();
  });
});

describe('the read failed', () => {
  it('unknown, every figure null, K-5 unknown failed', () => {
    const result = buildBoostRevenue({ purchases: null, scope: 'all' });
    expect(result).toEqual({
      status: 'unknown',
      lines: null,
      packages: null,
      deletedAccounts: null,
      notes: null,
      netMinorByCurrency: [],
      counts: { counted: 0, unreadableCredits: 0, deletedAccountPurchases: 0 },
    });
  });
});

describe('netMinorByCurrency (slice 5a, SA-W59): the combiner input, integer minor units, never a scaled wire number', () => {
  it('one currency, exact → the net in minor units, equal to the wire net times nothing (1000 ↔ 10)', () => {
    const result = all([boost()]);
    expect(result.netMinorByCurrency).toEqual([{ currency: 'USD', netMinor: 1000 }]);
    expect(result.lines![0].net).toBe(10);
  });

  it('a full refund nets to 0: a real 0, not null', () => {
    expect(all([boost({ status: 'refunded', amount_refunded_minor: 1000 })]).netMinorByCurrency).toEqual([{ currency: 'USD', netMinor: 0 }]);
  });

  it('null exactly where the wire net is null, one entry per line, in line order', () => {
    const result = all([boost({ currency: 'EUR', amount_total_minor: 'x' as unknown as number }), boost()]);
    expect(result.netMinorByCurrency.map((n) => n.currency)).toEqual(result.lines!.map((l) => l.currency));
    result.lines!.forEach((line, i) => expect(result.netMinorByCurrency[i].netMinor === null).toBe(line.net === null));
  });
});
