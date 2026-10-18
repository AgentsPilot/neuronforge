/**
 * @jest-environment jsdom
 *
 * The admin Subscriptions page (plan payments P-8a.1, AM-2 and AM-3; workplan
 * §5.4; AC-AM.2). The route is stubbed with the payload shape the builder
 * produces; the builder and the MRR rule have their own tests.
 *
 * `useSearchParams` follows `window.location`, as Next does once a
 * `replaceState(null, …)` has been delivered (the Charge checks harness).
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/admin/subscriptions',
}));

import SubscriptionsPage from '../page';
import {
  EMPTY_ALL,
  EMPTY_FILTERED,
  SUBSCRIPTIONS_TITLE,
  TEST_KEY_NOTE,
} from '../subscriptionsCopy';
import {
  STRIPE_MODE_UNKNOWN,
  SUBSCRIPTION_STATUSES,
  type SubscriptionRow,
  type SubscriptionStatus,
  type SubscriptionsPayload,
} from '@/lib/admin/billing/subscriptionsTypes';

const PAGE = '/admin/subscriptions';
const ROUTE = '/api/admin/business-os/billing/subscriptions';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const WAIT = { timeout: 10_000 };

const zeros = () => Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0])) as Record<SubscriptionStatus, number>;

function subscriptionRow(patch: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    accountId: ACCOUNT,
    businessName: 'Acme Studio',
    status: 'active',
    statuses: ['active'],
    stripeStatus: 'active',
    planBought: { id: 'plan_a', name: 'Plan A' },
    planOnRecord: { id: 'plan_a', name: 'Plan A' },
    paidThrough: '2026-11-01T00:00:00.000Z',
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    endedAt: null,
    lastPaidAt: '2026-10-01T09:30:00.000Z',
    lastPaymentFailedAt: null,
    failedAttempts: 0,
    pendingPlan: null,
    discounted: false,
    ...patch,
  };
}

function payload(patch: Partial<SubscriptionsPayload> = {}): SubscriptionsPayload {
  return {
    generatedAt: '2026-10-18T12:00:00.000Z',
    mode: 'test',
    status: null,
    totals: {
      mrr: [
        {
          currency: 'USD',
          totalHundredths: 7900,
          cancellingHundredths: 0,
          pastDueHundredths: 0,
          subscriptions: 1,
          overflow: false,
        },
      ],
      mrrUnpriced: 0,
      mrrDiscountUnknown: 0,
      mrrPastDueCounted: true,
      paidByPlan: [{ id: 'plan_a', name: 'Plan A', accounts: 1 }],
      byStatus: { ...zeros(), active: 1 },
      accounts: 1,
    },
    rows: [subscriptionRow()],
    matching: 1,
    ...patch,
  };
}

function stub(respond: (url: string) => { status: number; body: unknown }) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const { status, body } = respond(String(input));
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const routeCalls = (fetchMock: jest.Mock) => fetchMock.mock.calls.map((c) => String(c[0]));

function openAt(search: string) {
  window.history.replaceState(null, '', `${PAGE}${search}`);
  return render(<SubscriptionsPage />);
}

beforeEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, '', PAGE);
});

describe('Subscriptions page', () => {
  it('one h1 equal to the sidebar label, the mode chip, the test-key note and the As of line', async () => {
    stub(() => ({ status: 200, body: { success: true, data: payload() } }));
    openAt('');
    await screen.findByTestId('subscriptions-table', undefined, WAIT);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(SUBSCRIPTIONS_TITLE);
    expect(screen.getByTestId('subscriptions-mode')).toHaveTextContent('Stripe test mode');
    expect(screen.getByTestId('subscriptions-test-key-note')).toHaveTextContent(TEST_KEY_NOTE);
    expect(screen.getByTestId('as-of')).toHaveTextContent('2026-10-18 12:00 UTC');
  });

  it('a live key shows no test-key note', async () => {
    stub(() => ({ status: 200, body: { success: true, data: payload({ mode: 'live' }) } }));
    openAt('');
    await screen.findByTestId('subscriptions-table', undefined, WAIT);
    expect(screen.getByTestId('subscriptions-mode')).toHaveTextContent('Stripe live mode');
    expect(screen.queryByTestId('subscriptions-test-key-note')).toBeNull();
  });

  it('MRR is one tile per currency, never one total', async () => {
    const data = payload();
    data.totals.mrr = [
      { currency: 'EUR', totalHundredths: 5000, cancellingHundredths: 0, pastDueHundredths: 0, subscriptions: 1, overflow: false },
      { currency: 'USD', totalHundredths: 20800, cancellingHundredths: 7900, pastDueHundredths: 0, subscriptions: 2, overflow: false },
    ];
    stub(() => ({ status: 200, body: { success: true, data } }));
    openAt('');
    await screen.findByTestId('subscriptions-table', undefined, WAIT);
    const tiles = screen.getAllByTestId('kpi-mrr');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveTextContent('MRR (EUR)');
    expect(tiles[0]).toHaveTextContent('€50');
    expect(tiles[1]).toHaveTextContent('MRR (USD)');
    expect(tiles[1]).toHaveTextContent('$208');
    expect(tiles[1]).toHaveTextContent('of which cancelling $79');
  });

  it('no paying subscription: the MRR tile says None, and the list is empty', async () => {
    const data = payload({ rows: [], matching: 0 });
    data.totals = { ...data.totals, mrr: [], paidByPlan: [], byStatus: zeros(), accounts: 0 };
    stub(() => ({ status: 200, body: { success: true, data } }));
    openAt('');
    expect(await screen.findByTestId('subscriptions-empty', undefined, WAIT)).toHaveTextContent(EMPTY_ALL);
    expect(screen.getByTestId('kpi-mrr')).toHaveTextContent('None');
  });

  it('the row: business link to its drawer, status chip, plan names from the server, dates in UTC', async () => {
    stub(() => ({ status: 200, body: { success: true, data: payload() } }));
    openAt('');
    const row = (await screen.findAllByTestId('subscription-row', undefined, WAIT))[0];
    const link = within(row).getByTestId('subscription-business-link');
    expect(link).toHaveTextContent('Acme Studio');
    expect(link.getAttribute('href')).toBe(`/admin/users?status=all&account=${ACCOUNT}`);
    expect(within(row).getByTestId('subscription-status')).toHaveTextContent('Active');
    expect(row).toHaveTextContent('Plan A');
    expect(row).toHaveTextContent('Renews on 2026-11-01 00:00 UTC');
    expect(row).toHaveTextContent('2026-10-01 09:30 UTC');
  });

  it('a cancelling row reads "Ends on"', async () => {
    const data = payload({
      rows: [subscriptionRow({ status: 'cancelling', statuses: ['cancelling'], cancelAtPeriodEnd: true })],
    });
    stub(() => ({ status: 200, body: { success: true, data } }));
    openAt('');
    const row = (await screen.findAllByTestId('subscription-row', undefined, WAIT))[0];
    expect(row).toHaveTextContent('Ends on 2026-11-01 00:00 UTC');
  });

  it('an inbound ?status= link is sent to the route on the first read', async () => {
    const fetchMock = stub(() => ({ status: 200, body: { success: true, data: payload({ status: 'failed', rows: [], matching: 0 }) } }));
    openAt('?status=failed');
    expect(await screen.findByTestId('subscriptions-empty', undefined, WAIT)).toHaveTextContent(EMPTY_FILTERED);
    expect(routeCalls(fetchMock)).toEqual([`${ROUTE}?status=failed`]);
  });

  it('choosing a status writes it to the URL and reads again with it', async () => {
    const fetchMock = stub(() => ({ status: 200, body: { success: true, data: payload() } }));
    openAt('');
    await screen.findByTestId('subscriptions-table', undefined, WAIT);
    fireEvent.change(screen.getByTestId('subscriptions-status-filter'), { target: { value: 'paused' } });
    await waitFor(() => expect(routeCalls(fetchMock)).toContain(`${ROUTE}?status=paused`), WAIT);
    expect(window.location.search).toBe('?status=paused');
  });

  it('an unknown ?status= value is ignored (the default, all)', async () => {
    const fetchMock = stub(() => ({ status: 200, body: { success: true, data: payload() } }));
    openAt('?status=bogus');
    await screen.findByTestId('subscriptions-table', undefined, WAIT);
    expect(routeCalls(fetchMock)).toEqual([ROUTE]);
  });

  it('a 409 for an unknown key mode shows the route’s sentence and no figure', async () => {
    stub(() => ({ status: 409, body: { success: false, error: STRIPE_MODE_UNKNOWN } }));
    openAt('');
    expect(await screen.findByTestId('subscriptions-error', undefined, WAIT)).toHaveTextContent(STRIPE_MODE_UNKNOWN);
    expect(screen.queryByTestId('kpi-mrr')).toBeNull();
    expect(screen.queryByTestId('subscriptions-table')).toBeNull();
  });

  it('a network failure shows the shared sentence', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    openAt('');
    expect(await screen.findByTestId('subscriptions-error', undefined, WAIT)).toHaveTextContent('Could not reach the server');
  });

  it('a status tile is a real link to the filtered view', async () => {
    const data = payload();
    data.totals.byStatus = { ...zeros(), active: 1, failed: 2 };
    stub(() => ({ status: 200, body: { success: true, data } }));
    openAt('');
    await screen.findByTestId('subscriptions-table', undefined, WAIT);
    const tile = screen.getByTestId('kpi-failed');
    expect(tile).toHaveTextContent('2');
    expect(tile.getAttribute('href')).toBe(`${PAGE}?status=failed`);
  });
});

describe('source', () => {
  const dir = path.join(process.cwd(), 'app/admin/subscriptions');
  const files = ['page.tsx', 'subscriptionsCopy.ts', 'components/SubscriptionsTable.tsx'].map((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8')
  );

  it('imports no repository, no server-only module and no entitlements module', () => {
    for (const source of files) {
      expect(source).not.toMatch(/@\/lib\/repositories|server-only|business-os\/entitlements|supabase/);
    }
  });

  it('uses only the shared layout primitives for the header, the bar, the strip, the chips and the states', () => {
    const page = files[0];
    for (const primitive of ['AdminPageHeader', 'AdminFilterBar', 'KpiStrip', 'useAdminFilters', 'AdminLoading', 'AdminError', 'AdminEmpty']) {
      expect(page).toContain(primitive);
    }
    expect(files[2]).toContain('StatusChip');
  });
});
