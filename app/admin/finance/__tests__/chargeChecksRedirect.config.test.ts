/**
 * @jest-environment node
 *
 * Money M-5, R-1 (AC-191, AC-192; SA-WP-M5 SA-W3, M5-R3): old links to the
 * Business OS AI "Costs & credits" tab land on Charge checks.
 *
 * Two blocks. The first reads `next.config.js` itself and depends on nothing
 * inside Next. The second proves the behaviour through Next's OWN matcher and
 * query pass-through (internal modules of the installed version): a Next
 * upgrade that moves them fails here loudly, and the fix is to re-point the
 * imports or fall back to the shape block plus the manual `curl -sI` check.
 *
 * Money MK-3a (SA-6, ruled update): Charge checks became the AI cost page's
 * Summary & checks. The `tab=costs` redirect is retargeted straight at
 * `/admin/ai-cost?tab=checks` (no chain of two redirects), and a new one sends
 * `/admin/finance/charges` there too. Both keep the window and the business;
 * the destination's `tab=checks` wins over an incoming tab. Five redirects.
 */

import type { IncomingMessage } from 'http';
import { matchHas, prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';
import type { RouteHas } from 'next/dist/lib/load-custom-routes';

// Money MK-3b (SA-CR-MK3B F-2, ruled): the AI cost page's ONE spec reads what arrives.
import { AI_COST_FILTER_SPEC } from '@/app/admin/ai-cost/aiCostFilters';
import { resolveWindow } from '@/app/admin/components/layout/adminWindow';

interface Redirect {
  source: string;
  destination: string;
  permanent: boolean;
  has?: RouteHas[];
}

const config = jest.requireActual<{ redirects: () => Promise<Redirect[]> }>('@/next.config.js');

const A = '11111111-1111-4111-8111-111111111111';
const OLD = '/admin/business-os-llm';
const NEW = '/admin/ai-cost?tab=checks';
const NEW_PATH = '/admin/ai-cost';
const CHARGES = '/admin/finance/charges';

async function chargeChecksRedirect(): Promise<Redirect> {
  const found = (await config.redirects()).filter((r) => r.source === OLD);
  expect(found).toHaveLength(1);
  return found[0];
}

describe('R-1: the redirect in next.config.js (shape only)', () => {
  it('sends /admin/business-os-llm with tab=costs, exactly, to /admin/ai-cost?tab=checks, temporarily (MK-3a)', async () => {
    expect(await chargeChecksRedirect()).toEqual({
      source: OLD,
      has: [{ type: 'query', key: 'tab', value: 'costs' }],
      destination: NEW,
      permanent: false,
    });
  });

  // Money MK-4 (ruled): the Subscriptions redirect joins, so three in all.
  // Admin Exchange Rates slice 2b (SQ-17): the Exchange rates redirect joins, so four.
  // Money MK-3a (ruled): the Charge checks redirect joins, so five.
  // Money MK-3b (ruled): the AI calls & usage redirect joins, so six.
  it('keeps the payments redirect; six redirects in all', async () => {
    const all = await config.redirects();
    expect(all).toHaveLength(6);
    expect(all).toContainEqual({ source: '/business-os/payments', destination: '/business-os/orders', permanent: false });
  });
});

describe('R-1 through Next 14.2.35 internals (matchHas, prepareDestination): on an upgrade, re-point or fall back to shape + curl', () => {
  const req = { headers: {} } as unknown as IncomingMessage;

  it.each([
    ['tab=costs with a window and a business', true, { tab: 'costs', range: '7d', account: A }],
    ['tab=costs alone', true, { tab: 'costs' }],
    ['tab=activity', false, { tab: 'activity', range: '7d' }],
    ['tab=settings', false, { tab: 'settings' }],
    ['no tab', false, { range: '7d' }],
    ['a longer value (anchored match)', false, { tab: 'costsx' }],
  ])('%s → redirected: %s', async (_name, redirected, query) => {
    const { has } = await chargeChecksRedirect();
    expect(matchHas(req, query, has) !== false).toBe(redirected);
  });

  it('the window and the business arrive, and parse back through the Charge checks spec (AC-191)', async () => {
    const { destination } = await chargeChecksRedirect();
    const query = { tab: 'costs', range: 'custom', from: '2026-09-01', to: '2026-09-30', account: A };
    const { parsedDestination } = prepareDestination({ appendParamsToQuery: false, destination, params: {}, query });
    expect(parsedDestination.pathname).toBe(NEW_PATH);
    // MK-3a: the destination's tab wins; every other key arrives.
    expect(parsedDestination.query).toEqual({ ...query, tab: 'checks' });

    const get = (key: string) => {
      const value = parsedDestination.query[key];
      return typeof value === 'string' && value ? value : null;
    };
    expect(AI_COST_FILTER_SPEC.account.parse(get)).toBe(A);
    const window = AI_COST_FILTER_SPEC.window.parse(get);
    expect(window).toBeDefined();
    const resolved = resolveWindow(window!, new Date('2026-10-16T10:00:00.000Z'));
    expect(resolved).toMatchObject({ kind: 'dates', from: '2026-09-01', to: '2026-09-30' });
  });
});

describe('MK-3a: /admin/finance/charges redirects to the AI cost page (SA-6)', () => {
  async function chargesRedirect(): Promise<Redirect> {
    const found = (await config.redirects()).filter((r) => r.source === CHARGES);
    expect(found).toHaveLength(1);
    return found[0];
  }

  it('shape: to /admin/ai-cost?tab=checks, temporarily, with no condition', async () => {
    expect(await chargesRedirect()).toEqual({ source: CHARGES, destination: NEW, permanent: false });
  });

  it.each([
    ['no query', {}],
    ['a preset window', { range: '7d' }],
    ['a custom window and a business', { range: 'custom', from: '2026-09-01', to: '2026-09-30', account: A }],
    ['a stray tab', { tab: 'costs', range: 'this_month' }],
  ])('%s: lands on the Summary & checks tab with every other key kept', async (_name, query: Record<string, string>) => {
    const { destination } = await chargesRedirect();
    const { parsedDestination } = prepareDestination({ appendParamsToQuery: false, destination, params: {}, query });
    expect(parsedDestination.pathname).toBe(NEW_PATH);
    expect(parsedDestination.query).toEqual({ ...query, tab: 'checks' });
  });

  it('the window and the business parse back through the report spec', async () => {
    const { destination } = await chargesRedirect();
    const query = { range: 'custom', from: '2026-09-01', to: '2026-09-30', account: A };
    const { parsedDestination } = prepareDestination({ appendParamsToQuery: false, destination, params: {}, query });
    const get = (key: string) => {
      const value = parsedDestination.query[key];
      return typeof value === 'string' && value ? value : null;
    };
    expect(AI_COST_FILTER_SPEC.account.parse(get)).toBe(A);
    const resolved = resolveWindow(AI_COST_FILTER_SPEC.window.parse(get)!, new Date('2026-10-16T10:00:00.000Z'));
    expect(resolved).toMatchObject({ kind: 'dates', from: '2026-09-01', to: '2026-09-30' });
  });

  it('the old page file is deleted and the new page exists', () => {
    const fs = jest.requireActual<typeof import('fs')>('fs');
    const path = jest.requireActual<typeof import('path')>('path');
    expect(fs.existsSync(path.join(process.cwd(), 'app', 'admin', 'finance', 'charges', 'page.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'app', 'admin', 'ai-cost', 'page.tsx'))).toBe(true);
  });
});
