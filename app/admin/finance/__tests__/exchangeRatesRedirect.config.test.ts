/**
 * @jest-environment node
 *
 * Admin Exchange Rates slice 2b (FR-26, SQ-4, SQ-17 (a)): `/admin/exchange-rates`,
 * now Finance's Exchange rates tab, redirects there, temporarily, with the
 * incoming query kept and the destination's `tab` winning. Two blocks, as the
 * MK-4 test (`subscriptionsRedirect.config.test.ts`): the shape from
 * `next.config.js`, then Next's own `prepareDestination` (the installed
 * version's internals) and the Finance filter spec reading the result. Every
 * query check compares the parsed object, never a string (the merged query's
 * key order is the incoming keys first).
 */

import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';

import { FINANCE_FILTER_SPEC } from '@/app/admin/finance/financeFilters';

// Relative, as the finance files import it (SQ-18).
import { DEFAULT_CURRENCY_SHOW } from '../../exchange-rates/exchangeRatesFilters';

interface Redirect {
  source: string;
  destination: string;
  permanent: boolean;
  has?: unknown[];
}

const config = jest.requireActual<{ redirects: () => Promise<Redirect[]> }>('@/next.config.js');

const OLD = '/admin/exchange-rates';

// The config read is async, so the entry is resolved once (SA Q-3).
let found: Redirect[] = [];
let entry: Redirect;
beforeAll(async () => {
  found = (await config.redirects()).filter((r) => r.source === OLD);
  entry = found[0];
});

describe('slice 2b: the redirect in next.config.js (shape only)', () => {
  it('sends /admin/exchange-rates to /admin/finance?tab=exchange-rates, temporarily, with no condition', () => {
    expect(found).toHaveLength(1);
    expect(entry).toEqual({
      source: OLD,
      destination: '/admin/finance?tab=exchange-rates',
      permanent: false,
    });
    expect(entry).not.toHaveProperty('has');
  });
});

describe('slice 2b through Next internals (prepareDestination): the query arrives and Finance reads it', () => {
  const finance = (query: Record<string, string>) => {
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: entry.destination,
      params: {},
      query,
    });
    const get = (key: string) => {
      const value = parsedDestination.query[key];
      return typeof value === 'string' && value ? value : null;
    };
    return { parsedDestination, get };
  };

  it('no query: the Exchange rates tab, Show at its default', () => {
    const { parsedDestination, get } = finance({});
    expect(parsedDestination.pathname).toBe('/admin/finance');
    expect(parsedDestination.query).toEqual({ tab: 'exchange-rates' });
    expect(FINANCE_FILTER_SPEC.tab.parse(get)).toBe('exchange-rates');
    // An absent key parses to undefined, and the URL hook then reads the field's default.
    expect(FINANCE_FILTER_SPEC.currencies.parse(get)).toBeUndefined();
    expect(FINANCE_FILTER_SPEC.currencies.defaultValue).toBe(DEFAULT_CURRENCY_SHOW);
  });

  it('an old ?currencies=all link keeps its Show on the tab', () => {
    const { parsedDestination, get } = finance({ currencies: 'all' });
    expect(parsedDestination.query).toEqual({ tab: 'exchange-rates', currencies: 'all' });
    expect(FINANCE_FILTER_SPEC.tab.parse(get)).toBe('exchange-rates');
    expect(FINANCE_FILTER_SPEC.currencies.parse(get)).toBe('all');
  });

  it('an incoming tab is overridden: the destination wins', () => {
    const { parsedDestination, get } = finance({ tab: 'accounts' });
    expect(parsedDestination.query).toEqual({ tab: 'exchange-rates' });
    expect(FINANCE_FILTER_SPEC.tab.parse(get)).toBe('exchange-rates');
  });

  it('an incoming tab is overridden and the rest of the query is kept', () => {
    const { parsedDestination, get } = finance({ tab: 'accounts', currencies: 'disabled' });
    expect(parsedDestination.query).toEqual({ tab: 'exchange-rates', currencies: 'disabled' });
    expect(FINANCE_FILTER_SPEC.tab.parse(get)).toBe('exchange-rates');
    expect(FINANCE_FILTER_SPEC.currencies.parse(get)).toBe('disabled');
  });

  it('an unknown Show value arrives and the spec reads the default', () => {
    const { parsedDestination, get } = finance({ currencies: 'junk' });
    expect(parsedDestination.query).toEqual({ tab: 'exchange-rates', currencies: 'junk' });
    // Dropped as invalid (undefined), so the hook reads the default, as for an absent key.
    expect(FINANCE_FILTER_SPEC.currencies.parse(get)).toBeUndefined();
    expect(FINANCE_FILTER_SPEC.currencies.defaultValue).toBe(DEFAULT_CURRENCY_SHOW);
  });
});
