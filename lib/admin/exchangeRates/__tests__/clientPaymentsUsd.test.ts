/**
 * The client payments approximate-dollar converter (FIN BD-56, slice 1a).
 * Workplan docs/workplans/CLIENT_PAYMENTS_USD_1A_WORKPLAN.md §9.1, T-1 to
 * T-21. Pure: every case is a plain input with a fixed `readAt`.
 */

import {
  buildClientPaymentsUsd,
  centsToWire,
  readLineHundredths,
  type ClientPaymentRate,
  type ClientPaymentRatesRead,
} from '../clientPaymentsUsd';
import * as rateMath from '../rateMath';
import { buildTakings, type TakingsPaymentInput } from '@/lib/business-os/finance/takings';
import { groupByCurrency, normaliseCurrencyCode, toHundredths } from '@/lib/business-os/finance/currencyGroups';
import type { FinanceTakingsFigures, FinanceTakingsLine } from '@/lib/business-os/finance/financeTypes';

const READ_AT = '2026-10-26T12:00:00.000Z';
const FRESH = '2026-10-20T00:00:00.000Z';

function line(currency: string | null, gross: number, payments = 1, extra: Partial<FinanceTakingsLine> = {}): FinanceTakingsLine {
  return { currency, payments, gross, refunded: 0, net: gross, businesses: 1, unreadable: 0, unreadablePayments: 0, ...extra };
}

function figures(lines: FinanceTakingsLine[], extra: Partial<FinanceTakingsFigures> = {}): FinanceTakingsFigures {
  return {
    empty: lines.length === 0,
    paymentsExact: true,
    refundsState: 'ok',
    lines,
    refundLines: [],
    refundsNotCompleted: 0,
    feeLines: [],
    feesRecordedOn: 0,
    countedPayments: lines.reduce((n, l) => n + l.payments, 0),
    unreadableFees: 0,
    processors: [],
    businesses: 1,
    otherStatusPayments: 0,
    unreadableAmounts: 0,
    rows: [],
    rowsTotal: 0,
    ...extra,
  };
}

const rate = (code: string, value: string, extra: Partial<ClientPaymentRate> = {}): ClientPaymentRate => ({
  code, rate: value, enabled: true, lastUpdatedAt: FRESH, ...extra,
});
const ok = (...rates: ClientPaymentRate[]): ClientPaymentRatesRead => ({ status: 'ok', rates });
const FAILED: ClientPaymentRatesRead = { status: 'failed' };

const convert = (f: FinanceTakingsFigures | null, rates: ClientPaymentRatesRead) =>
  buildClientPaymentsUsd({ takings: { figures: f }, rates, readAt: READ_AT });

describe('buildClientPaymentsUsd', () => {
  it('T-1 (AC-2): USD 100.00 + ILS 370.00 at 3.7 → $200.00, the USD line exact', () => {
    const usd = convert(figures([line('ILS', 370), line('USD', 100)]), ok(rate('ILS', '3.700000')));
    expect(usd).toEqual({
      status: 'ok',
      totalUsd: 200,
      rows: [
        { currency: 'ILS', payments: 1, gross: 370, rate: '3.700000', rateUpdatedAt: FRESH, state: 'converted', usd: 100 },
        { currency: 'USD', payments: 1, gross: 100, rate: '1', rateUpdatedAt: null, state: 'converted', usd: 100 },
      ],
      converted: { payments: 2, currencies: 2 },
      notConverted: { payments: 0, currencies: 0 },
      ratesRead: 'ok',
      stale: false,
    });
  });

  it('T-2: each currency subtotal is converted ONCE (0.01 + 0.01 at 4 → 1 cent; payment by payment would be 0)', () => {
    const usd = convert(figures([line('ILS', 0.02, 2)]), ok(rate('ILS', '4')));
    expect(usd.rows[0].usd).toBe(0.01);
    expect(usd.totalUsd).toBe(0.01);
  });

  it('T-3: rounded half away from zero to the cent', () => {
    expect(convert(figures([line('EUR', 0.03)]), ok(rate('EUR', '2'))).totalUsd).toBe(0.02); // 1.5 → 2
    expect(convert(figures([line('EUR', 0.01)]), ok(rate('EUR', '4'))).totalUsd).toBe(0); // 0.25 → 0
    expect(convert(figures([line('EUR', 0.01)]), ok(rate('EUR', '0.666667'))).totalUsd).toBe(0.01); // 1.4999… → 1
  });

  it('T-4: a currency with no rate is left out, and the figure is "at least"', () => {
    const usd = convert(figures([line('EUR', 50, 3), line('USD', 10)]), ok(rate('ILS', '3.7')));
    expect(usd.status).toBe('partial');
    expect(usd.rows[0]).toEqual({ currency: 'EUR', payments: 3, gross: 50, rate: null, rateUpdatedAt: null, state: 'no_rate', usd: null });
    expect(usd.notConverted).toEqual({ payments: 3, currencies: 1 });
    expect(usd.totalUsd).toBe(10);
  });

  it('T-5: a disabled rate is left out', () => {
    const usd = convert(figures([line('GBP', 50)]), ok(rate('GBP', '0.8', { enabled: false })));
    expect(usd.rows[0]).toMatchObject({ state: 'disabled', usd: null, rate: '0.8' });
    expect(usd.status).toBe('partial');
    expect(usd.totalUsd).toBe(0);
  });

  it('T-6 (D-5): a stale rate is still converted and flagged; an unknown date is stale; exactly 35 days is not', () => {
    const old = convert(figures([line('ILS', 37)]), ok(rate('ILS', '3.7', { lastUpdatedAt: '2026-09-20T12:00:00.000Z' })));
    expect(old).toMatchObject({ status: 'ok', totalUsd: 10, stale: true });
    expect(old.rows[0].state).toBe('stale');
    const undated = convert(figures([line('ILS', 37)]), ok(rate('ILS', '3.7', { lastUpdatedAt: null })));
    expect(undated.rows[0].state).toBe('stale');
    const edge = convert(figures([line('ILS', 37)]), ok(rate('ILS', '3.7', { lastUpdatedAt: '2026-09-21T12:00:00.000Z' })));
    expect(edge.rows[0].state).toBe('converted');
    expect(edge.stale).toBe(false);
  });

  it('T-7: USD needs no rate row, ignores its own row, converts when the rates read failed, and is never stale', () => {
    for (const rates of [FAILED, ok(), ok(rate('USD', '1', { enabled: false, lastUpdatedAt: null }))]) {
      const usd = convert(figures([line('USD', 123.45)]), rates);
      expect(usd).toMatchObject({ status: 'ok', totalUsd: 123.45, stale: false });
      expect(usd.rows[0]).toMatchObject({ state: 'converted', rate: '1', rateUpdatedAt: null, usd: 123.45 });
    }
  });

  it('T-8 (CPU-2): codes match normalised on both sides; a stored ils matches', () => {
    const usd = convert(figures([line('ILS', 37)]), ok(rate(' ils ', '3.7')));
    expect(usd.rows[0]).toMatchObject({ state: 'converted', usd: 10 });
  });

  it.each(['0', '0.000000', '-3.7', '3.7e2', '', 'abc', '1234567.1', '3.1234567'])(
    'T-9 (W-1): the rate %p is unusable; divideHalfUp is never called with it',
    (bad) => {
      const spy = jest.spyOn(rateMath, 'divideHalfUp');
      const usd = convert(figures([line('ILS', 37)]), ok(rate('ILS', bad)));
      expect(usd.rows[0]).toMatchObject({ state: 'unusable', usd: null });
      expect(usd.status).toBe('partial');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  );

  it('T-10: two rate rows for one code after normalising are unusable', () => {
    const usd = convert(figures([line('ILS', 37)]), ok(rate('ILS', '3.7'), rate('ils', '3.6')));
    expect(usd.rows[0]).toMatchObject({ state: 'unusable', rate: null });
  });

  it('T-11 (CPU-2): the Unknown-currency line is never converted', () => {
    const usd = convert(figures([line('USD', 5), line(null, 9, 2)]), ok());
    expect(usd.rows[1]).toEqual({ currency: null, payments: 2, gross: 9, rate: null, rateUpdatedAt: null, state: 'unusable', usd: null });
    expect(usd.status).toBe('partial');
    expect(usd.notConverted).toEqual({ payments: 2, currencies: 1 });
  });

  it('T-12: a line with refunds only is not a row and never makes the figure partial', () => {
    const usd = convert(figures([line('EUR', 0, 0, { refunded: 20 }), line('USD', 5)]), ok());
    expect(usd.rows.map((r) => r.currency)).toEqual(['USD']);
    expect(usd.status).toBe('ok');
  });

  it('T-13 (AC-5): a failed rates read counts US dollars only, partial, with the reason', () => {
    const usd = convert(figures([line('EUR', 9), line('ILS', 37), line('USD', 7)]), FAILED);
    expect(usd).toMatchObject({ status: 'partial', ratesRead: 'failed', totalUsd: 7 });
    expect(usd.rows.map((r) => r.state)).toEqual(['no_rate', 'no_rate', 'converted']);
    expect(usd.notConverted).toEqual({ payments: 2, currencies: 2 });
  });

  it('T-14 (AC-7): the payments ceiling or an unreadable payment makes it partial', () => {
    expect(convert(figures([line('USD', 5)], { paymentsExact: false }), ok()).status).toBe('partial');
    expect(convert(figures([line('USD', 5, 2, { unreadablePayments: 1, unreadable: 1 })]), ok()).status).toBe('partial');
  });

  it('T-15 (D-3, D-4): the refunds state and unreadable fees never change it', () => {
    const f = figures([line('USD', 5)], { refundsState: 'unknown', refundLines: null, unreadableFees: 3 });
    expect(convert(f, ok()).status).toBe('ok');
  });

  it('T-16 (AC-7): a failed payments read is unknown', () => {
    expect(convert(null, ok())).toEqual({
      status: 'unknown', totalUsd: null, rows: [], converted: { payments: 0, currencies: 0 },
      notConverted: { payments: 0, currencies: 0 }, ratesRead: 'ok', stale: false,
    });
    expect(convert(null, FAILED).ratesRead).toBe('failed');
  });

  it('T-17: no counted payment is ok, no rows, total 0', () => {
    expect(convert(figures([]), ok())).toMatchObject({ status: 'ok', rows: [], totalUsd: 0 });
  });

  it('T-18 (D-3, AC-8): through the builder, succeeded and refunded payments both count; refunds are not taken off', () => {
    const payment = (id: string, amount: string, status: string): TakingsPaymentInput => ({
      id, user_id: 'a', amount, currency: 'ils', status, processor_fee: '1.00', fee_currency: 'ILS', processor_type: 'stripe',
    });
    const built = buildTakings({
      payments: { rows: [payment('1', '18.50', 'succeeded'), payment('2', '18.50', 'refunded'), payment('3', '99', 'failed')], reachedCeiling: false },
      refunds: { rows: [{ id: 'r', user_id: 'a', amount: '18.50', currency: 'ILS', status: 'succeeded' }], reachedCeiling: false },
      isPlatformAccount: () => false,
      displayCap: 10,
    });
    const usd = convert(built.figures as unknown as FinanceTakingsFigures, ok(rate('ILS', '3.7')));
    expect(usd.rows[0]).toMatchObject({ currency: 'ILS', payments: 2, gross: 37, usd: 10 });
    expect(usd.totalUsd).toBe(10);
  });

  it('T-21: rows follow the takings lines (code ascending, Unknown last)', () => {
    const usd = convert(figures([line('EUR', 1), line('ILS', 1), line('USD', 1), line(null, 1)]), ok());
    expect(usd.rows.map((r) => r.currency)).toEqual(['EUR', 'ILS', 'USD', null]);
  });
});

describe('centsToWire (SA-Q-1A-1)', () => {
  it('T-20: integer cents to the wire number at the safe-integer edge, refused past it', () => {
    expect(centsToWire(BigInt(266934))).toBe(2669.34);
    expect(centsToWire(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER / 100);
    expect(centsToWire(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1))).toBeNull();
    expect(centsToWire(-BigInt(Number.MAX_SAFE_INTEGER) - BigInt(1))).toBeNull();
  });

  it('T-20: a conversion past the safe range makes its row unusable, never a wrong number', () => {
    const usd = convert(figures([line('ILS', 10_000_000_000), line('USD', 1)]), ok(rate('ILS', '0.000001')));
    expect(usd.rows[0]).toMatchObject({ state: 'unusable', usd: null });
    expect(usd).toMatchObject({ status: 'partial', totalUsd: 1 });
  });
});

// ── T-19 (CPU-1): the converter's hundredths equal the builder's, for every line ──
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('T-19 property (CPU-1): 500 seeded windows', () => {
  const CODES: Array<string | null> = ['usd', 'USD', ' ils ', 'EUR', 'gbp', 'xx', null];
  const STATUSES = ['succeeded', 'refunded', 'failed', 'pending', null];
  const random = mulberry32(20261026);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const amount = (): string => {
    const cents = Math.floor(random() * 9_999_999_999) + 1;
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  };

  it('readLineHundredths(line.gross) equals an independent sum of the counted inputs; at rate 1 the total is their sum', () => {
    for (let run = 0; run < 500; run += 1) {
      const rows: TakingsPaymentInput[] = Array.from({ length: 1 + Math.floor(random() * 12) }, (_, i) => ({
        id: `p${i}`, user_id: 'a', amount: amount(), currency: pick(CODES), status: pick(STATUSES),
        processor_fee: null, fee_currency: null, processor_type: null,
      }));
      const built = buildTakings({ payments: { rows, reachedCeiling: false }, refunds: { rows: [], reachedCeiling: false }, isPlatformAccount: () => false, displayCap: 0 });
      const lines = (built.figures as unknown as FinanceTakingsFigures).lines;
      const counted = rows.filter((r) => r.status === 'succeeded' || r.status === 'refunded');
      const expected = new Map(
        groupByCurrency(counted.map((r) => ({ currency: r.currency, field: 'gross' as const, hundredths: toHundredths(r.amount) })), ['gross'] as const)
          .map((g) => [g.currency, g.sums.gross])
      );
      for (const l of lines) expect({ run, currency: l.currency, h: readLineHundredths(l.gross) }).toEqual({ run, currency: l.currency, h: expected.get(l.currency) });

      const allAtOne = ok(...['ILS', 'EUR', 'GBP'].map((c) => rate(c, '1')));
      const usd = convert(built.figures as unknown as FinanceTakingsFigures, allAtOne);
      const known = [...expected.entries()].filter(([code]) => normaliseCurrencyCode(code) !== null);
      const sum = known.reduce((n, [, h]) => n + h, 0);
      expect({ run, total: toHundredths(usd.totalUsd) }).toEqual({ run, total: sum });
    }
  });
});
