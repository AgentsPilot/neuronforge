/**
 * Money MK-5a (KPI restructure review §3.4 USD-1 to USD-5, SA-9, BD-47): the
 * `$` sign for US dollars, other codes on their own line, and the strict
 * one-US-dollar-line formatter the tiles print through.
 */

import { formatMoney, formatUsd, formatUsdSign } from '../financeFormat';

describe('formatUsdSign (SA-9): one US-dollar line, or null', () => {
  it('prints a US-dollar line with the sign, two decimals, grouped', () => {
    expect(formatUsdSign({ currency: 'USD', amount: 1234.5 })).toBe('$1,234.50');
    expect(formatUsdSign({ currency: 'USD', amount: 0 })).toBe('$0.00');
    expect(formatUsdSign({ currency: 'USD', amount: -12.5 })).toBe('-$12.50');
  });

  it('accepts the code in any case and with stray spaces (the code is normalised, never the amount)', () => {
    expect(formatUsdSign({ currency: 'usd', amount: 1 })).toBe('$1.00');
    expect(formatUsdSign({ currency: ' USD ', amount: 1 })).toBe('$1.00');
  });

  it('keeps up to four decimals when asked (AI cost: a small cost is never $0.00)', () => {
    expect(formatUsdSign({ currency: 'USD', amount: 0.0012 }, { maxDecimals: 4 })).toBe('$0.0012');
    expect(formatUsdSign({ currency: 'USD', amount: 0.0012 })).toBe('$0.00');
  });

  it.each([['ILS'], ['EUR'], ['US'], ['USDT'], [''], [null]])('refuses %p: null, never another currency on a tile (USD-5)', (currency) => {
    expect(formatUsdSign({ currency, amount: 10 })).toBeNull();
  });

  it('refuses a non-finite amount', () => {
    expect(formatUsdSign({ currency: 'USD', amount: Number.NaN })).toBeNull();
    expect(formatUsdSign({ currency: 'USD', amount: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('formatMoney (MK-5a): "$" for US dollars, every other code on its own line (USD-3)', () => {
  it('US dollars carry the sign, never the code', () => {
    expect(formatMoney(1234.56, 'USD')).toBe('$1,234.56');
    expect(formatMoney(-5, 'USD')).toBe('-$5.00');
    expect(formatMoney(19.99, 'USD')).not.toMatch(/USD/);
  });

  it('other currencies keep their code and are never converted', () => {
    expect(formatMoney(230.3, 'ILS')).toBe('ILS 230.30');
    expect(formatMoney(-5, 'EUR')).toBe('EUR -5.00');
    expect(formatMoney(12, null)).toBe('Unknown currency 12.00');
  });

  it('formatUsd (ledger cost, US dollars by construction) prints the sign with up to four decimals', () => {
    expect(formatUsd(3.5)).toBe('$3.50');
    expect(formatUsd(0.0012)).toBe('$0.0012');
  });
});
