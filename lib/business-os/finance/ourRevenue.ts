/**
 * "Our revenue" per currency: boost net plus plans received (finance & business
 * health slice 5a, SA-Q40, E-34, SA-W63). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md
 * § M2.4.
 *
 * PURE (SA-WR-4): integer minor units in, wire numbers out; no clock, no I/O,
 * no data layer, no entitlements import.
 *
 * The ONE place two money parts are added, and only WITHIN one currency
 * (BD-12): there is no export that adds two currencies and no exchange rate.
 * K-5 and the account summary's "Paid us, total" both read `totals`, so the
 * tile and the summary cannot differ.
 *
 * Exactness (E-34, SA-W63), per currency:
 *   - a part present with a value adds that value;
 *   - a part present with null (cut off, unreadable, overflow) is NOT exact;
 *   - a part ABSENT for this currency is an exact 0 only when that part's read
 *     succeeded and was not cut off (a read at its ceiling may have cut off
 *     that currency's rows);
 *   - the Unknown currency (null) is never exact.
 * A total is shown only when both parts are exact and the sum is a safe
 * integer; otherwise it is null ("Unknown"), never a lower bound plus a figure.
 *
 * @module lib/business-os/finance/ourRevenue
 */

import { CURRENCY_SCALE } from './currencyGroups';
import type { FinanceRevenueTotalLine, FinanceTileMoney } from './financeTypes';

/** One part's per-currency integer minor units (boost net, or plans received). */
export interface PartByCurrency {
  /** Null: that read failed. */
  lines: ReadonlyArray<{ currency: string | null; minor: number | null }> | null;
  /** The read reached its ceiling (SA-W63). */
  cutOff: boolean;
}

/** Ascending, the Unknown currency (null) last. */
function compareCurrencies(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** One part's exact minor units for a currency, or null when it cannot be exact. */
function partFor(part: PartByCurrency & { lines: NonNullable<PartByCurrency['lines']> }, currency: string | null): number | null {
  if (currency === null) return null;
  const line = part.lines.find((candidate) => candidate.currency === currency);
  if (line !== undefined) return line.minor !== null && Number.isSafeInteger(line.minor) ? line.minor : null;
  return part.cutOff ? null : 0;
}

/** Minor units → the wire number, once. */
const toMoney = (minor: number): number => minor / CURRENCY_SCALE;

export function combineOurRevenue(input: { boosts: PartByCurrency; plans: PartByCurrency }): {
  totals: FinanceRevenueTotalLine[] | null;
  k5: FinanceTileMoney;
} {
  const { boosts, plans } = input;
  if (boosts.lines === null || plans.lines === null) {
    return { totals: null, k5: { kind: 'unknown', reason: 'failed' } };
  }
  const boostPart = { ...boosts, lines: boosts.lines };
  const planPart = { ...plans, lines: plans.lines };

  const currencies = [...new Set([...boostPart.lines, ...planPart.lines].map((line) => line.currency))].sort(compareCurrencies);
  const totals: FinanceRevenueTotalLine[] = currencies.map((currency) => {
    const boostMinor = partFor(boostPart, currency);
    const planMinor = partFor(planPart, currency);
    const sum = boostMinor !== null && planMinor !== null ? boostMinor + planMinor : null;
    const total = sum !== null && Number.isSafeInteger(sum) ? sum : null;
    return {
      currency,
      boostsNet: boostMinor === null ? null : toMoney(boostMinor),
      plansReceived: planMinor === null ? null : toMoney(planMinor),
      total: total === null ? null : toMoney(total),
    };
  });

  let k5: FinanceTileMoney;
  if (totals.length === 0) k5 = { kind: 'none' };
  else if (totals.length > 1) k5 = { kind: 'several', currencies: totals.length };
  else {
    const only = totals[0];
    k5 =
      only.total !== null
        ? { kind: 'one', currency: only.currency, net: only.total }
        : { kind: 'unknown', reason: boosts.cutOff || plans.cutOff ? 'cut_off' : 'unreadable' };
  }
  return { totals, k5 };
}
