/**
 * @jest-environment node
 *
 * Money MK-3b (KPI restructure review SA-6; workplan T-9): `/admin/analytics`,
 * AI calls & usage, is now the AI cost page's Calls tab. It redirects there,
 * temporarily, with the incoming query kept and the destination's `tab=calls`
 * winning over a stray one. Two blocks, as the M-5 and MK-4 redirect tests:
 * the shape from `next.config.js`, then Next's own `prepareDestination` (the
 * installed version's internals) and the page's ONE spec reading the result,
 * old key names (`dateFrom`, `dateTo`, `user`) included.
 */

import * as fs from 'fs';
import * as path from 'path';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';

import { AI_COST_FILTER_SPEC } from '@/app/admin/ai-cost/aiCostFilters';
import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';

interface Redirect {
  source: string;
  destination: string;
  permanent: boolean;
  has?: unknown[];
}

const config = jest.requireActual<{ redirects: () => Promise<Redirect[]> }>('@/next.config.js');

const A = '11111111-1111-4111-8111-111111111111';
const DESTINATION = '/admin/ai-cost?tab=calls';

async function analyticsRedirect(): Promise<Redirect> {
  const found = (await config.redirects()).filter((r) => r.source === '/admin/analytics');
  expect(found).toHaveLength(1);
  return found[0];
}

/** The hook's getter for one field: the canonical key, else an old name mapped to it (U-9). */
function getterFor(field: AdminFilterField<unknown>, query: Record<string, string | string[]>) {
  return (key: string) => {
    const value = query[key];
    if (typeof value === 'string' && value) return value;
    for (const [legacy, target] of Object.entries(field.aliases ?? {})) {
      const old = query[legacy];
      if (target === key && typeof old === 'string' && old) return old;
    }
    return null;
  };
}

function land(query: Record<string, string>) {
  const { parsedDestination } = prepareDestination({ appendParamsToQuery: false, destination: DESTINATION, params: {}, query });
  const parse = <K extends keyof typeof AI_COST_FILTER_SPEC>(key: K) =>
    AI_COST_FILTER_SPEC[key].parse(getterFor(AI_COST_FILTER_SPEC[key] as AdminFilterField<unknown>, parsedDestination.query as Record<string, string>));
  return { parsedDestination, parse };
}

describe('MK-3b: the redirect in next.config.js (shape only)', () => {
  it('sends /admin/analytics to /admin/ai-cost?tab=calls, temporarily, with no condition', async () => {
    expect(await analyticsRedirect()).toEqual({ source: '/admin/analytics', destination: DESTINATION, permanent: false });
  });

  it('the old page file is deleted and the AI cost page exists', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/analytics/page.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/ai-cost/page.tsx'))).toBe(true);
  });
});

describe('MK-3b through Next internals (prepareDestination): the query arrives and the page reads it', () => {
  it('no query: the Calls tab', () => {
    const { parsedDestination, parse } = land({});
    expect(parsedDestination.pathname).toBe('/admin/ai-cost');
    expect(parsedDestination.query).toEqual({ tab: 'calls' });
    expect(parse('tab')).toBe('calls');
  });

  it('a stray tab loses to the destination’s', () => {
    expect(land({ tab: 'checks', scope: 'all' }).parsedDestination.query).toEqual({ tab: 'calls', scope: 'all' });
  });

  it('the Health tile’s old link: scope, and the exact instants as a linked window', () => {
    const { parsedDestination, parse } = land({ scope: 'bos', dateFrom: '2026-09-25T08:14:00.000Z', dateTo: '2026-09-26T08:14:00.000Z' });
    expect(parsedDestination.query).toMatchObject({ tab: 'calls', scope: 'bos', dateFrom: '2026-09-25T08:14:00.000Z' });
    expect(parse('scope')).toBe('bos');
    expect(parse('window')).toEqual({ kind: 'linked', from: '2026-09-25T08:14:00.000Z', to: '2026-09-26T08:14:00.000Z' });
  });

  it('the Businesses panel’s old link: the business through the old `user` key', () => {
    const { parse } = land({ scope: 'bos', user: A });
    expect(parse('account')).toBe(A);
  });

  it('a window, a group-by and a drill arrive as they are', () => {
    const { parse } = land({ range: 'custom', from: '2026-09-01', to: '2026-09-30', group_by: 'model', provider: 'openai', account: A });
    expect(parse('window')).toEqual({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' });
    expect(parse('groupBy')).toBe('model');
    expect(parse('provider')).toBe('openai');
    expect(parse('account')).toBe(A);
  });

  it('SA-Q-MK3-3: an old `range=24h` link falls back to the default (This month), U-4', () => {
    expect(land({ range: '24h' }).parse('window')).toBeUndefined();
    expect(AI_COST_FILTER_SPEC.window.defaultValue).toEqual({ kind: 'preset', preset: 'this_month' });
  });
});
