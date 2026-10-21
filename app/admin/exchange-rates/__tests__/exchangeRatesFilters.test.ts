/**
 * The Exchange rates filter module (Admin Exchange Rates slice 1c.2, §5.5.1,
 * FR-14 to FR-16, SQ-8, SQ-9, SA-1c-5): the URL field `currencies`, the Show
 * options, the literal code-or-name search, held rows and the count line.
 * Workplan §7.1 U-1 to U-8.
 */

import type { ExchangeRateWire } from '@/lib/admin/exchangeRates/exchangeRateRules';

import {
  CURRENCY_SHOW_OPTIONS,
  EXCHANGE_RATES_FILTER_SPEC,
  NO_MATCHING_CURRENCIES,
  currencyCountLine,
  matchesCurrencyFilter,
  toCurrencyShow,
  visibleRates,
} from '../exchangeRatesFilters';

function rate(code: string, name: string, isEnabled = true): ExchangeRateWire {
  return {
    currencyCode: code,
    currencyName: name,
    currencySymbol: '¤',
    rateToUsd: '1.000000',
    isEnabled,
    decimalPlaces: 2,
    lastUpdatedAt: null,
    updatedBy: null,
  };
}

const EUR = rate('EUR', 'Euro');
const ILS = rate('ILS', 'Israeli Shekel');
const JPY = rate('JPY', 'Japanese Yen', false);
const USD = rate('USD', 'US Dollar');
const RATES = [EUR, ILS, JPY, USD];

const field = EXCHANGE_RATES_FILTER_SPEC.currencies;
const parse = (raw: string | null) => field.parse((key) => (key === 'currencies' ? raw : null));

describe('U-1: the URL field (SQ-8)', () => {
  it('owns the key currencies, defaulting to enabled, and is written to the URL', () => {
    expect(field.keys).toEqual(['currencies']);
    expect(field.defaultValue).toBe('enabled');
    expect(field.pageOnly).toBeFalsy();
  });

  it('parses the three values; anything else is ignored (U-4)', () => {
    expect(parse('disabled')).toBe('disabled');
    expect(parse('all')).toBe('all');
    expect(parse('enabled')).toBe('enabled');
    for (const raw of ['bogus', 'ENABLED', 'All', 'show']) expect(parse(raw)).toBeUndefined();
    expect(parse(null)).toBeUndefined();
  });

  it('serialises a value under its key', () => {
    expect(field.serialise('disabled')).toEqual({ currencies: 'disabled' });
    expect(field.serialise('all')).toEqual({ currencies: 'all' });
  });
});

describe('U-2: toCurrencyShow', () => {
  it('passes the three values through; anything else is the default', () => {
    expect(toCurrencyShow('enabled')).toBe('enabled');
    expect(toCurrencyShow('disabled')).toBe('disabled');
    expect(toCurrencyShow('all')).toBe('all');
    expect(toCurrencyShow('')).toBe('enabled');
    expect(toCurrencyShow('nope')).toBe('enabled');
  });
});

describe('U-3: the Show options', () => {
  it('lists Enabled only, Disabled only and All, in that order', () => {
    expect(CURRENCY_SHOW_OPTIONS).toEqual([
      { value: 'enabled', label: 'Enabled only' },
      { value: 'disabled', label: 'Disabled only' },
      { value: 'all', label: 'All' },
    ]);
  });
});

describe('U-4: Show', () => {
  it('Enabled only keeps enabled rows, USD included', () => {
    expect(RATES.filter((r) => matchesCurrencyFilter(r, 'enabled', ''))).toEqual([EUR, ILS, USD]);
  });

  it('Disabled only keeps disabled rows', () => {
    expect(RATES.filter((r) => matchesCurrencyFilter(r, 'disabled', ''))).toEqual([JPY]);
  });

  it('All keeps every row', () => {
    expect(RATES.filter((r) => matchesCurrencyFilter(r, 'all', ''))).toEqual(RATES);
  });
});

describe('U-5: Search (SA-1c-5)', () => {
  it('matches the code or the name, case-insensitively', () => {
    expect(matchesCurrencyFilter(ILS, 'all', 'ils')).toBe(true);
    expect(matchesCurrencyFilter(ILS, 'all', 'ILS')).toBe(true);
    expect(matchesCurrencyFilter(ILS, 'all', 'shekel')).toBe(true);
    expect(matchesCurrencyFilter(ILS, 'all', 'Shekel')).toBe(true);
    expect(matchesCurrencyFilter(EUR, 'all', 'shekel')).toBe(false);
  });

  it('is trimmed; an empty or spaces-only search matches every row', () => {
    expect(matchesCurrencyFilter(EUR, 'all', '  eur  ')).toBe(true);
    expect(RATES.every((r) => matchesCurrencyFilter(r, 'all', ''))).toBe(true);
    expect(RATES.every((r) => matchesCurrencyFilter(r, 'all', '   '))).toBe(true);
  });

  it('applies together with Show', () => {
    expect(matchesCurrencyFilter(JPY, 'enabled', 'jpy')).toBe(false);
    expect(matchesCurrencyFilter(JPY, 'disabled', 'jpy')).toBe(true);
  });
});

describe('U-6: Search is literal, never a pattern', () => {
  it.each(['.', '(', '*', '\\', '[', '.*'])('%s neither throws nor matches everything', (term) => {
    expect(() => RATES.map((r) => matchesCurrencyFilter(r, 'all', term))).not.toThrow();
    expect(RATES.filter((r) => matchesCurrencyFilter(r, 'all', term))).toEqual([]);
  });

  it('a literal character that is in a name still matches', () => {
    const odd = rate('XAU', 'Gold (troy ounce)');
    expect(matchesCurrencyFilter(odd, 'all', '(troy')).toBe(true);
  });
});

describe('U-7: visibleRates (SQ-9)', () => {
  it('keeps the payload order', () => {
    expect(visibleRates([USD, EUR, ILS], 'enabled', '', new Set())).toEqual([USD, EUR, ILS]);
  });

  it('a held code shows even when it no longer matches, in its place', () => {
    const switchedOff = { ...EUR, isEnabled: false };
    expect(visibleRates([switchedOff, ILS, JPY, USD], 'enabled', '', new Set(['EUR']))).toEqual([switchedOff, ILS, USD]);
  });

  it('a held code missing from the rates adds nothing', () => {
    expect(visibleRates(RATES, 'enabled', '', new Set(['GBP']))).toEqual([EUR, ILS, USD]);
  });
});

describe('U-8: the count line', () => {
  it('reads "Showing N of X currencies", singular for one currency', () => {
    expect(currencyCountLine(3, 4)).toBe('Showing 3 of 4 currencies');
    expect(currencyCountLine(0, 4)).toBe('Showing 0 of 4 currencies');
    expect(currencyCountLine(1, 1)).toBe('Showing 1 of 1 currency');
  });

  it('groups thousands through formatCount', () => {
    expect(currencyCountLine(1200, 1500)).toBe('Showing 1,200 of 1,500 currencies');
  });

  it('the empty-state sentence is the requirement text', () => {
    expect(NO_MATCHING_CURRENCIES).toBe('No currencies match these filters.');
  });
});
