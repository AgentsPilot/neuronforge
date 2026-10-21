/**
 * @jest-environment node
 *
 * Money MK-4 (KPI restructure review SA-6): `/admin/subscriptions`, now
 * Finance's Plans & subscriptions tab, redirects there, temporarily, with
 * the incoming query kept. Two blocks, as the M-5 redirect test: the shape
 * from `next.config.js`, then Next's own `prepareDestination` (the installed
 * version's internals) and the Finance filter spec reading the result.
 */

import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';

import { FINANCE_FILTER_SPEC } from '@/app/admin/finance/financeFilters';

interface Redirect {
  source: string;
  destination: string;
  permanent: boolean;
  has?: unknown[];
}

const config = jest.requireActual<{ redirects: () => Promise<Redirect[]> }>('@/next.config.js');

async function subscriptionsRedirect(): Promise<Redirect> {
  const found = (await config.redirects()).filter((r) => r.source === '/admin/subscriptions');
  expect(found).toHaveLength(1);
  return found[0];
}

describe('MK-4: the redirect in next.config.js (shape only)', () => {
  it('sends /admin/subscriptions to /admin/finance?tab=plans, temporarily, with no condition', async () => {
    expect(await subscriptionsRedirect()).toEqual({
      source: '/admin/subscriptions',
      destination: '/admin/finance?tab=plans',
      permanent: false,
    });
  });
});

describe('MK-4 through Next internals (prepareDestination): the query arrives and Finance reads it', () => {
  const finance = (query: Record<string, string>) => {
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: '/admin/finance?tab=plans',
      params: {},
      query,
    });
    const get = (key: string) => {
      const value = parsedDestination.query[key];
      return typeof value === 'string' && value ? value : null;
    };
    return { parsedDestination, get };
  };

  it('no query: the Plans & subscriptions tab', async () => {
    const { parsedDestination, get } = finance({});
    expect(parsedDestination.pathname).toBe('/admin/finance');
    expect(parsedDestination.query).toEqual({ tab: 'plans' });
    expect(FINANCE_FILTER_SPEC.tab.parse(get)).toBe('plans');
    expect(FINANCE_FILTER_SPEC.status.parse(get)).toBeUndefined();
  });

  it('an old ?status= link keeps its filter on the tab', async () => {
    const { parsedDestination, get } = finance({ status: 'failed' });
    expect(parsedDestination.query).toEqual({ tab: 'plans', status: 'failed' });
    expect(FINANCE_FILTER_SPEC.tab.parse(get)).toBe('plans');
    expect(FINANCE_FILTER_SPEC.status.parse(get)).toBe('failed');
  });

  it('an unknown status value is dropped by the Finance spec (the default, all)', async () => {
    const { get } = finance({ status: 'nope' });
    expect(FINANCE_FILTER_SPEC.status.parse(get)).toBeUndefined();
  });
});
