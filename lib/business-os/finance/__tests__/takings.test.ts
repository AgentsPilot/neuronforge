/**
 * The takings builder (finance & business health slice 2a, T3): AC-47 against
 * an independent check-7 / check-8 helper written here, AC-48 to AC-54, the
 * SA rulings SA-W18 (counted payments, exact status match SA-WR-15), SA-W19
 * (refund-only lines and rows), SA-W20 / SA-WR-14 (unreadable amounts and
 * fees, each a cause of `partial` on its own), SA-W21 (processors) and SA-W26
 * (hundredths divided once).
 */

import { buildTakings, type TakingsPaymentInput, type TakingsRefundInput } from '../takings';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const PLATFORM = '00000000-0000-0000-0000-000000000000';

let seq = 0;
function pay(user_id: string | null, amount: unknown, currency: unknown, extra: Partial<TakingsPaymentInput> = {}): TakingsPaymentInput {
  seq += 1;
  return {
    id: `p-${seq}`,
    user_id,
    amount,
    currency,
    status: 'succeeded',
    processor_fee: null,
    fee_currency: null,
    processor_type: 'stripe',
    ...extra,
  };
}
function refund(user_id: string | null, amount: unknown, currency: unknown, status: string | null = 'succeeded'): TakingsRefundInput {
  seq += 1;
  return { id: `r-${seq}`, user_id, amount, currency, status };
}

const isPlatformAccount = (id: string) => id === PLATFORM;
function build(
  payments: TakingsPaymentInput[] | null,
  refunds: TakingsRefundInput[] | null = [],
  opts: { paymentsCeiling?: boolean; refundsCeiling?: boolean; displayCap?: number } = {}
) {
  return buildTakings({
    payments: payments === null ? null : { rows: payments, reachedCeiling: opts.paymentsCeiling ?? false },
    refunds: refunds === null ? null : { rows: refunds, reachedCeiling: opts.refundsCeiling ?? false },
    isPlatformAccount,
    displayCap: opts.displayCap ?? 200,
  });
}
const figuresOf = (result: ReturnType<typeof buildTakings>) => {
  if (!result.figures) throw new Error('expected figures');
  return result.figures;
};

/**
 * SQL checks 7 and 8, re-done independently: amounts parsed as TEXT into
 * integer cents (no float), currency upper-cased and trimmed, statuses
 * compared as stored.
 */
function cents(value: unknown): number {
  const [whole, frac = ''] = String(value).trim().split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(frac.padEnd(2, '0')));
}
function checkSevenAndEight(payments: TakingsPaymentInput[], refunds: TakingsRefundInput[]) {
  const code = (c: unknown) => {
    const t = typeof c === 'string' ? c.trim().toUpperCase() : '';
    return /^[A-Z]{3}$/.test(t) ? t : 'UNKNOWN';
  };
  const seven = new Map<string, { counted_payments: number; gross: number; businesses_counted: Set<string> }>();
  let otherStatusRows = 0;
  for (const p of payments) {
    if (p.status !== 'succeeded' && p.status !== 'refunded') {
      otherStatusRows += 1;
      continue;
    }
    const row = seven.get(code(p.currency)) ?? { counted_payments: 0, gross: 0, businesses_counted: new Set<string>() };
    row.counted_payments += 1;
    row.gross += cents(p.amount);
    if (p.user_id) row.businesses_counted.add(p.user_id);
    seven.set(code(p.currency), row);
  }
  const eight = new Map<string, { succeeded_rows: number; refunded: number }>();
  let notCompletedRows = 0;
  for (const r of refunds) {
    if (r.status !== 'succeeded') {
      notCompletedRows += 1;
      continue;
    }
    const row = eight.get(code(r.currency)) ?? { succeeded_rows: 0, refunded: 0 };
    row.succeeded_rows += 1;
    row.refunded += cents(r.amount);
    eight.set(code(r.currency), row);
  }
  return { seven, eight, otherStatusRows, notCompletedRows };
}

beforeEach(() => {
  seq = 0;
});

describe('AC-47: the figures equal SQL checks 7 and 8, re-done independently', () => {
  const payments = [
    pay(A, '100.00', 'USD', { processor_fee: '3.20', fee_currency: 'usd' }),
    pay(A, 50.5, 'usd', { status: 'refunded', processor_fee: 1.75, fee_currency: 'USD', processor_type: 'Stripe ' }),
    pay(B, '200.00', 'ILS', { processor_fee: '0.90', fee_currency: 'USD' }),
    pay(B, 30, ' ils ', { processor_type: 'manual' }),
    pay(C, '0.10', 'ILS'),
    pay(C, '0.20', 'ILS'),
    pay(A, '999.00', 'USD', { status: 'pending' }),
  ];
  const refunds = [refund(A, '20.00', 'USD'), refund(B, 15, 'ILS'), refund(A, '9.00', 'USD', 'pending')];

  it('payments, gross, businesses, other statuses; refunds, refunded, not completed; net per currency', () => {
    const result = build(payments, refunds);
    const f = figuresOf(result);
    const check = checkSevenAndEight(payments, refunds);
    expect(result.status).toBe('ok');

    for (const line of f.lines) {
      const seven = check.seven.get(line.currency ?? 'UNKNOWN');
      const eight = check.eight.get(line.currency ?? 'UNKNOWN');
      expect(line.payments).toBe(seven?.counted_payments ?? 0);
      expect(Math.round(line.gross * 100)).toBe(seven?.gross ?? 0);
      expect(line.businesses).toBe(seven?.businesses_counted.size ?? 0);
      expect(Math.round((line.refunded ?? NaN) * 100)).toBe(eight?.refunded ?? 0);
      expect(Math.round((line.net ?? NaN) * 100)).toBe((seven?.gross ?? 0) - (eight?.refunded ?? 0));
    }
    expect(f.lines.map((l) => l.currency)).toEqual(['ILS', 'USD']);
    expect(f.otherStatusPayments).toBe(check.otherStatusRows);
    expect(f.refundsNotCompleted).toBe(check.notCompletedRows);
    for (const line of f.refundLines ?? []) {
      const eight = check.eight.get(line.currency ?? 'UNKNOWN');
      expect(line.refunds).toBe(eight?.succeeded_rows);
      expect(Math.round(line.refunded * 100)).toBe(eight?.refunded);
    }
    // The literal figures, so the helper above cannot drift with the builder.
    expect(f.lines).toEqual([
      { currency: 'ILS', payments: 4, gross: 230.3, refunded: 15, net: 215.3, businesses: 2, unreadable: 0, unreadablePayments: 0 },
      { currency: 'USD', payments: 2, gross: 150.5, refunded: 20, net: 130.5, businesses: 1, unreadable: 0, unreadablePayments: 0 },
    ]);
    expect(f.businesses).toBe(3);
    expect(f.countedPayments).toBe(6);
  });

  it('SA-W26: 0.10 + 0.20 is exactly 0.3 on the wire (hundredths divided once)', () => {
    const f = figuresOf(build([pay(C, 0.1, 'ILS'), pay(C, 0.2, 'ILS')]));
    expect(f.lines[0].gross).toBe(0.3);
    expect(f.lines[0].net).toBe(0.3);
  });
});

describe('SA-W18 / SA-WR-15: a payment counts only with the stored status exactly succeeded or refunded', () => {
  it.each([['pending'], ['failed'], ['Succeeded'], [' succeeded'], ['succeeded '], ['REFUNDED'], [null]])(
    'status %p is "another status": counted, left out of every figure',
    (status) => {
      const f = figuresOf(build([pay(A, '10.00', 'USD'), pay(B, '99.00', 'USD', { status, processor_fee: '1.00', fee_currency: 'USD' })]));
      expect(f.otherStatusPayments).toBe(1);
      expect(f.countedPayments).toBe(1);
      expect(f.lines).toEqual([{ currency: 'USD', payments: 1, gross: 10, refunded: 0, net: 10, businesses: 1, unreadable: 0, unreadablePayments: 0 }]);
      expect(f.businesses).toBe(1);
      expect(f.feeLines).toEqual([]);
      expect(f.processors).toEqual([{ processorType: 'stripe', payments: 1 }]);
      expect(f.rows.map((r) => r.accountId)).toEqual([A]);
    }
  );

  it.each([['Succeeded'], [' succeeded'], ['pending'], [null]])('a refund with status %p is "not completed", its amount left out', (status) => {
    const f = figuresOf(build([pay(A, '10.00', 'USD')], [refund(A, '4.00', 'USD', status)]));
    expect(f.refundsNotCompleted).toBe(1);
    expect(f.refundLines).toEqual([]);
    expect(f.lines[0]).toMatchObject({ refunded: 0, net: 10 });
  });
});

describe('AC-48: currencies are never mixed', () => {
  it('USD, usd, ILS and NULL → three lines for payments and three for refunds, Unknown last', () => {
    const f = figuresOf(
      build(
        [pay(A, 1, 'USD'), pay(A, 2, 'usd'), pay(B, 3, 'ILS'), pay(C, 4, null)],
        [refund(A, 0.5, 'USD'), refund(A, 0.25, 'usd'), refund(B, 1, 'ILS'), refund(C, 1, null)]
      )
    );
    expect(f.lines.map((l) => [l.currency, l.gross])).toEqual([
      ['ILS', 3],
      ['USD', 3],
      [null, 4],
    ]);
    expect(f.refundLines?.map((l) => [l.currency, l.refunded, l.refunds])).toEqual([
      ['ILS', 1, 1],
      ['USD', 0.75, 2],
      [null, 1, 1],
    ]);
  });
});

describe('AC-49: fees by FEE currency, never deducted', () => {
  it('an ILS payment with a USD fee: the fee on the USD fee line only; net unchanged; recorded on 1 of 1', () => {
    const f = figuresOf(build([pay(B, '200.00', 'ILS', { processor_fee: '5.80', fee_currency: 'usd' })]));
    expect(f.feeLines).toEqual([{ currency: 'USD', fees: 5.8, payments: 1 }]);
    expect(f.lines).toEqual([{ currency: 'ILS', payments: 1, gross: 200, refunded: 0, net: 200, businesses: 1, unreadable: 0, unreadablePayments: 0 }]);
    expect(f.lines[0]).not.toHaveProperty('fees');
    expect([f.feesRecordedOn, f.countedPayments]).toEqual([1, 1]);
  });

  it('a fee with no or a malformed fee currency → the Unknown fee line; a NULL fee is not recorded (never 0)', () => {
    const f = figuresOf(
      build([
        pay(A, 10, 'USD', { processor_fee: 1, fee_currency: null }),
        pay(A, 10, 'USD', { processor_fee: 2, fee_currency: 'US' }),
        pay(A, 10, 'USD', { processor_fee: null, fee_currency: 'USD' }),
      ])
    );
    expect(f.feeLines).toEqual([{ currency: null, fees: 3, payments: 2 }]);
    expect([f.feesRecordedOn, f.countedPayments]).toEqual([2, 3]);
  });
});

describe('AC-50 / SA-W19: refunds dated in the window, refund-only lines and rows', () => {
  it('a succeeded refund with no payment in its currency → a line with payments 0, gross 0, a negative net; its business gets a row', () => {
    const f = figuresOf(build([pay(A, '10.00', 'USD')], [refund(D, '5.00', 'EUR')]));
    expect(f.lines).toEqual([
      { currency: 'EUR', payments: 0, gross: 0, refunded: 5, net: -5, businesses: 0, unreadable: 0, unreadablePayments: 0 },
      { currency: 'USD', payments: 1, gross: 10, refunded: 0, net: 10, businesses: 1, unreadable: 0, unreadablePayments: 0 },
    ]);
    expect(f.rows).toContainEqual({ accountId: D, isPlatform: false, currency: 'EUR', payments: 0, gross: 0, refunded: 5, net: -5, unreadablePayments: 0 });
    // "Businesses with takings" counts only businesses with a counted payment.
    expect(f.businesses).toBe(1);
    expect(f.empty).toBe(false);
  });

  it('no payment at all but a refund: lines from refunds; not empty; countedPayments 0 (the page still says no client payments)', () => {
    const result = build([], [refund(A, '5.00', 'USD')]);
    const f = figuresOf(result);
    expect(result.status).toBe('ok');
    expect(f.empty).toBe(false);
    expect(f.countedPayments).toBe(0);
    expect(f.lines).toEqual([{ currency: 'USD', payments: 0, gross: 0, refunded: 5, net: -5, businesses: 0, unreadable: 0, unreadablePayments: 0 }]);
  });
});

describe('AC-51: a read at its ceiling', () => {
  it('payments at the ceiling → not exact, net null everywhere, partial; refunded still exact', () => {
    const result = build([pay(A, 10, 'USD')], [refund(A, 1, 'USD')], { paymentsCeiling: true });
    const f = figuresOf(result);
    expect(result.status).toBe('partial');
    expect(f.paymentsExact).toBe(false);
    expect(f.refundsState).toBe('ok');
    expect(f.lines[0]).toMatchObject({ gross: 10, refunded: 1, net: null });
    expect(f.rows[0].net).toBeNull();
  });

  it('refunds at the ceiling → refundsState partial, net null, partial; gross exact', () => {
    const result = build([pay(A, 10, 'USD')], [refund(A, 1, 'USD')], { refundsCeiling: true });
    const f = figuresOf(result);
    expect(result.status).toBe('partial');
    expect(f.paymentsExact).toBe(true);
    expect(f.refundsState).toBe('partial');
    expect(f.lines[0]).toMatchObject({ gross: 10, refunded: 1, net: null });
    expect(f.rows[0].net).toBeNull();
  });
});

describe('AC-66 (builder half): a failed read', () => {
  it('payments failed → unknown, no figures', () => {
    expect(build(null, [refund(A, 1, 'USD')])).toEqual({ status: 'unknown', figures: null });
  });

  it('refunds failed → refunded and net null, refund lines null, gross shown, partial', () => {
    const result = build([pay(A, 10, 'USD')], null);
    const f = figuresOf(result);
    expect(result.status).toBe('partial');
    expect(f.refundsState).toBe('unknown');
    expect(f.refundLines).toBeNull();
    expect(f.refundsNotCompleted).toBeNull();
    expect(f.lines).toEqual([{ currency: 'USD', payments: 1, gross: 10, refunded: null, net: null, businesses: 1, unreadable: 0, unreadablePayments: 0 }]);
    expect(f.rows[0]).toMatchObject({ refunded: null, net: null });
  });
});

describe('AC-52: an empty window', () => {
  it('no payment and no refund → empty, no line, no row, ok', () => {
    const result = build([], []);
    expect(result.status).toBe('ok');
    const f = figuresOf(result);
    expect(f).toMatchObject({ empty: true, lines: [], refundLines: [], feeLines: [], rows: [], rowsTotal: 0, businesses: 0, processors: [] });
  });

  it('only other-status payments → still empty, the count kept', () => {
    const f = figuresOf(build([pay(A, 10, 'USD', { status: 'pending' })], []));
    expect(f).toMatchObject({ empty: true, otherStatusPayments: 1, lines: [] });
  });
});

describe('AC-53 / SA-W20 / SA-WR-14: unreadable values, each a cause of partial on its own', () => {
  it('an unreadable payment amount (12.345, NaN): excluded, counted, never 0; that line and row net Unknown; the other line exact; partial', () => {
    const result = build([pay(A, '12.345', 'USD'), pay(A, '10.00', 'USD'), pay(B, NaN, 'USD'), pay(C, '7.00', 'ILS')], []);
    const f = figuresOf(result);
    expect(result.status).toBe('partial');
    expect(f.unreadableAmounts).toBe(2);
    expect(f.unreadableFees).toBe(0);
    expect(f.lines).toEqual([
      { currency: 'ILS', payments: 1, gross: 7, refunded: 0, net: 7, businesses: 1, unreadable: 0, unreadablePayments: 0 },
      { currency: 'USD', payments: 3, gross: 10, refunded: 0, net: null, businesses: 2, unreadable: 2, unreadablePayments: 2 },
    ]);
    const rowOf = (id: string) => f.rows.find((r) => r.accountId === id);
    expect(rowOf(A)).toMatchObject({ payments: 2, gross: 10, net: null });
    expect(rowOf(B)).toMatchObject({ payments: 1, gross: 0, net: null });
    expect(rowOf(C)).toMatchObject({ net: 7 });
  });

  it('an unreadable refund amount: excluded, counted, net Unknown on its line, partial', () => {
    const result = build([pay(A, '10.00', 'USD')], [refund(A, 'abc', 'USD')]);
    const f = figuresOf(result);
    expect(result.status).toBe('partial');
    expect(f.unreadableAmounts).toBe(1);
    expect(f.lines[0]).toMatchObject({ gross: 10, refunded: 0, net: null, unreadable: 1, unreadablePayments: 0 });
  });

  it('an unreadable FEE alone: left out of the fee line, counted, the block partial; net unchanged (SA-WR-14)', () => {
    const result = build([
      pay(A, '10.00', 'USD', { processor_fee: '0.555', fee_currency: 'USD' }),
      pay(A, '10.00', 'USD', { processor_fee: '0.50', fee_currency: 'USD' }),
    ]);
    const f = figuresOf(result);
    expect(result.status).toBe('partial');
    expect(f.unreadableAmounts).toBe(0);
    expect(f.unreadableFees).toBe(1);
    expect(f.feeLines).toEqual([{ currency: 'USD', fees: 0.5, payments: 1 }]);
    expect([f.feesRecordedOn, f.countedPayments]).toEqual([1, 2]);
    expect(f.lines[0]).toMatchObject({ gross: 20, net: 20, unreadable: 0, unreadablePayments: 0 });
  });

  it('the control: the same rows with readable values are ok', () => {
    expect(build([pay(A, '10.00', 'USD', { processor_fee: '0.55', fee_currency: 'USD' })], [refund(A, '1.00', 'USD')]).status).toBe('ok');
  });
});

describe('AC-54: the per-business table', () => {
  it('sorted by currency (Unknown last), then gross highest first; NULL id kept; platform flagged', () => {
    const f = figuresOf(
      build([pay(A, 5, 'USD'), pay(B, 50, 'USD'), pay(PLATFORM, 1, 'USD'), pay(C, 9, 'ILS'), pay(null, 3, 'USD'), pay(D, 2, null)])
    );
    expect(f.rows.map((r) => [r.currency, r.accountId, r.gross])).toEqual([
      ['ILS', C, 9],
      ['USD', B, 50],
      ['USD', A, 5],
      ['USD', null, 3],
      ['USD', PLATFORM, 1],
      [null, D, 2],
    ]);
    expect(f.rows.find((r) => r.accountId === PLATFORM)?.isPlatform).toBe(true);
    expect(f.rows.find((r) => r.accountId === null)?.isPlatform).toBe(false);
    // A business with two currencies has two rows.
    const two = figuresOf(build([pay(A, 1, 'USD'), pay(A, 1, 'ILS')]));
    expect(two.rows.map((r) => [r.accountId, r.currency])).toEqual([
      [A, 'ILS'],
      [A, 'USD'],
    ]);
  });

  it('the cap: 201 keys → 200 rows shown, rowsTotal 201', () => {
    const id = (i: number) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const f = figuresOf(build(Array.from({ length: 201 }, (_, i) => pay(id(i), i + 1, 'USD'))));
    expect(f.rows).toHaveLength(200);
    expect(f.rowsTotal).toBe(201);
    expect(f.rows[0].gross).toBe(201);
    // The smallest is the one left out.
    expect(f.rows.map((r) => r.accountId)).not.toContain(id(0));
  });
});

describe('SA-W21: payments by processor, counts only', () => {
  it('trimmed and lower-cased; NULL or empty → not recorded (null, last); an unknown value kept as stored', () => {
    const f = figuresOf(
      build([
        pay(A, 1, 'USD', { processor_type: 'stripe' }),
        pay(A, 1, 'USD', { processor_type: 'Stripe ' }),
        pay(A, 1, 'USD', { processor_type: 'manual' }),
        pay(A, 1, 'USD', { processor_type: 'PayPal' }),
        pay(A, 1, 'USD', { processor_type: null }),
        pay(A, 1, 'USD', { processor_type: '  ' }),
      ])
    );
    expect(f.processors).toEqual([
      { processorType: 'manual', payments: 1 },
      { processorType: 'paypal', payments: 1 },
      { processorType: 'stripe', payments: 2 },
      { processorType: null, payments: 2 },
    ]);
  });
});
