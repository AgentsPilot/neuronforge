/**
 * Fixtures for the client payments approximate-dollar render tests (FIN BD-56,
 * slice 1b; SA-WP-CPU1B SA-Q-1B-6). A plain helper module, never a `*.test.tsx`,
 * so importing it runs no page suite; `financePage.render.test.tsx`'s own
 * fixtures are not touched. Jest collects every file under `__tests__/`, so,
 * like its precedents (`financeRequestPins.ts`, `chargeChecksRequestPins.ts`),
 * it carries one self-check of its own data.
 */

import type {
  FinanceClientPaymentsUsd,
  FinanceClientPaymentsUsdRow,
  FinanceTakingsFigures,
  FinanceTakingsLine,
  FinanceTakingsSection,
} from '@/lib/business-os/finance/financeTypes';

export function takingsLine(currency: string | null, payments: number, gross: number, extra: Partial<FinanceTakingsLine> = {}): FinanceTakingsLine {
  return { currency, payments, gross, refunded: 0, net: gross, businesses: 1, unreadable: 0, unreadablePayments: 0, ...extra };
}

/** A filled takings block: USD, ILS and EUR lines, no refunds, no fees. */
export function takingsFigures(extra: Partial<FinanceTakingsFigures> = {}): FinanceTakingsFigures {
  const lines = [takingsLine('EUR', 3, 120), takingsLine('ILS', 42, 45230), takingsLine('USD', 7, 122)];
  return {
    empty: false,
    paymentsExact: true,
    refundsState: 'ok',
    lines,
    refundLines: [],
    refundsNotCompleted: 0,
    feeLines: [],
    feesRecordedOn: 0,
    countedPayments: 52,
    unreadableFees: 0,
    processors: [{ processorType: 'stripe', payments: 52 }],
    businesses: 4,
    otherStatusPayments: 0,
    unreadableAmounts: 0,
    rows: [],
    rowsTotal: 0,
    ...extra,
  };
}

export function usdRow(extra: Partial<FinanceClientPaymentsUsdRow> & Pick<FinanceClientPaymentsUsdRow, 'currency'>): FinanceClientPaymentsUsdRow {
  return { payments: 1, gross: 0, rate: null, rateUpdatedAt: null, state: 'converted', usd: null, ...extra };
}

/** Every currency converted, fresh rates: ≈ $12,346.32 (ILS 12,224.32 + USD 122.00). */
export function usdOk(extra: Partial<FinanceClientPaymentsUsd> = {}): FinanceClientPaymentsUsd {
  return {
    status: 'ok',
    totalUsd: 12346.32,
    rows: [
      usdRow({ currency: 'ILS', payments: 42, gross: 45230, rate: '3.700000', rateUpdatedAt: '2026-10-20T09:15:00+00:00', state: 'converted', usd: 12224.32 }),
      usdRow({ currency: 'USD', payments: 7, gross: 122, rate: '1', rateUpdatedAt: null, state: 'converted', usd: 122 }),
    ],
    converted: { payments: 49, currencies: 2 },
    notConverted: { payments: 0, currencies: 0 },
    ratesRead: 'ok',
    stale: false,
    ...extra,
  };
}

/** EUR has no rate: "at least", 3 payments not converted. */
export function usdMissingEur(): FinanceClientPaymentsUsd {
  const ok = usdOk();
  return {
    ...ok,
    status: 'partial',
    rows: [usdRow({ currency: 'EUR', payments: 3, gross: 120, state: 'no_rate' }), ...ok.rows],
    notConverted: { payments: 3, currencies: 1 },
  };
}

export function takingsSectionWith(usd: FinanceClientPaymentsUsd | undefined, figures: FinanceTakingsFigures = takingsFigures()): FinanceTakingsSection {
  const section: FinanceTakingsSection = { status: 'ok', scope: 'all', figures };
  return usd ? { ...section, usd } : section;
}

describe('client payments approximate-dollar fixtures (self-check)', () => {
  it('the ok total is the sum of its rows to the cent, and the counts match the rows', () => {
    const ok = usdOk();
    const cents = ok.rows.reduce((sum, row) => sum + Math.round((row.usd ?? 0) * 100), 0);
    expect(cents).toBe(Math.round((ok.totalUsd ?? 0) * 100));
    expect(ok.converted).toEqual({ payments: 49, currencies: 2 });
    expect(usdMissingEur().notConverted).toEqual({ payments: 3, currencies: 1 });
  });
});
