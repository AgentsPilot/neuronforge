/**
 * @jest-environment jsdom
 *
 * Money MK-8: the Finance drawers' openers, reads and states, on their own
 * (the full page cases are in financePage.render.test.tsx). Read-only: each
 * drawer reads only when opened, through `useDrawerResource`.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import type { FinanceEconomicsRow } from '@/lib/business-os/finance/financeTypes';
import type { SubscriptionRow, SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
import { AccountEconomicsTable } from '../components/AccountEconomicsTable';
import { BusinessDrawerProvider } from '../components/BusinessDrawer';
import { PlanDrawer } from '../components/PlanDrawer';
import { SubscriptionsTable } from '../components/SubscriptionsTable';
import { businessDrawerKey } from '../drawerReads';
import { formatOwnCurrency } from '../financeFormat';

const A = '11111111-1111-4111-8111-111111111111';
const WINDOW = { preset: 'this_month' as const, from: '2026-10-01', to: '2026-10-21' };

const econRow = (extra: Partial<FinanceEconomicsRow> = {}): FinanceEconomicsRow => ({
  accountId: A,
  kind: 'account',
  name: 'Acme Dental',
  nameStatus: 'found',
  group: 'founding_partner',
  tierLabel: null,
  foundingPartner: false,
  noPlanRow: false,
  paid: { lines: [{ currency: 'USD', afterTax: 90, exact: true, planAfterTax: 90, boostsAfterTax: 0 }], failed: false },
  aiCost: { kind: 'figure', costUsd: 2.25, exact: true },
  margin: { kind: 'figure', marginUsd: 87.75, noRevenue: false },
  marginAfterFees: { kind: 'figure', afterFeesUsd: 84.57, feesUsd: 3.18, currency: 'USD', noRevenue: false },
  credits: { kind: 'position', used: 400, allowance: 1000, usedTenths: 400 },
  ...extra,
});

const subRow = (extra: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  accountId: A,
  businessName: 'Acme Dental',
  status: 'active',
  statuses: ['active'],
  stripeStatus: 'active',
  planBought: { id: 'tier_a', name: 'Plan A' },
  planOnRecord: { id: 'tier_a', name: 'Plan A' },
  paidThrough: '2026-11-01T00:00:00.000Z',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  endedAt: null,
  lastPaidAt: '2026-10-01T00:00:00.000Z',
  lastPaymentFailedAt: null,
  failedAttempts: 0,
  pendingPlan: null,
  discounted: false,
  disagreements: [], // P-8b.3a: the new field, empty (agrees)
  ...extra,
});

let fetchMock: jest.Mock;
function serve(body: unknown, status = 200) {
  fetchMock = jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => jest.clearAllMocks());

describe('openers appear only with the drawer mounted (tables on their own are unchanged)', () => {
  // Money MK-10 (ruled test edit): the opener is the Businesses page's own: `row-open`, "Open details for …",
  // in a narrow last column with an sr-only "Details" header.
  it('the Accounts row: no opener without the provider; with it, the Businesses Open button in a new narrow last column', () => {
    const { unmount } = render(<AccountEconomicsTable rows={[econRow()]} deleted={null} window={WINDOW} />);
    expect(screen.queryByTestId('row-open')).toBeNull();
    const headersBefore = screen.getAllByRole('columnheader').length;
    unmount();
    render(
      <BusinessDrawerProvider window={WINDOW}>
        <AccountEconomicsTable rows={[econRow()]} deleted={null} window={WINDOW} />
      </BusinessDrawerProvider>
    );
    expect(within(screen.getByTestId(`econ-row-${A}`)).getByTestId('row-open')).toHaveAttribute('aria-label', 'Open details for Acme Dental');
    expect(screen.getAllByRole('columnheader')).toHaveLength(headersBefore + 1);
    expect(screen.getAllByRole('columnheader')[headersBefore]).toHaveTextContent('Details');
  });

  it('a platform row or a row with no plan row has no quick look (not a business)', () => {
    render(
      <BusinessDrawerProvider window={WINDOW}>
        <AccountEconomicsTable
          rows={[econRow({ kind: 'platform', name: null, nameStatus: 'platform' }), econRow({ accountId: '22222222-2222-4222-8222-222222222222', noPlanRow: true })]}
          deleted={null}
          window={WINDOW}
        />
      </BusinessDrawerProvider>
    );
    expect(screen.queryAllByTestId('row-open')).toHaveLength(0);
  });

  it('the Subscriptions table: no opener column without onQuickLook; with it, a named narrow last column', () => {
    const { unmount } = render(<SubscriptionsTable rows={[subRow()]} />);
    expect(screen.queryByTestId('row-open')).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);
    unmount();
    render(<SubscriptionsTable rows={[subRow(), subRow({ accountId: null })]} onQuickLook={jest.fn()} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(9);
    expect(screen.getAllByRole('columnheader')[8]).toHaveTextContent('Details');
    // A detached row (deleted account) has no business to look at.
    expect(screen.getAllByTestId('row-open')).toHaveLength(1);
    expect(screen.getByTestId('row-open')).toHaveAttribute('aria-label', 'Open details for Acme Dental');
  });
});

describe('the business drawer reads only on open', () => {
  it('nothing on render; opening sends ONE request, the finance route with that business in the page window', async () => {
    serve({ success: false, error: 'Could not read this business.' }, 500);
    render(
      <BusinessDrawerProvider window={WINDOW}>
        <AccountEconomicsTable rows={[econRow()]} deleted={null} window={WINDOW} />
      </BusinessDrawerProvider>
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId(`econ-row-${A}`)).getByTestId('row-open'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/admin/business-os/finance?preset=this_month&accountId=${A}`);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ cache: 'no-store' }));
    // A failed read is the shared error, in the drawer titled with the row's name.
    const drawer = await screen.findByTestId('business-drawer');
    expect(within(drawer).getByTestId('business-drawer-error')).toBeInTheDocument();
    expect(within(drawer).getByText('Acme Dental')).toBeInTheDocument();
  });

  it('the key is the page’s own request shape: a custom window carries its dates, never a tab', () => {
    expect(businessDrawerKey(A, { preset: 'custom', from: '2026-09-01', to: '2026-09-30' })).toBe(
      `preset=custom&from=2026-09-01&to=2026-09-30&accountId=${A}`
    );
    expect(businessDrawerKey(A, WINDOW)).not.toMatch(/tab=|sort=|group=|show=/);
  });

  it('with no window (a business already picked) there is no opener', () => {
    render(
      <BusinessDrawerProvider window={null}>
        <AccountEconomicsTable rows={[econRow()]} deleted={null} window={WINDOW} />
      </BusinessDrawerProvider>
    );
    expect(screen.queryByTestId('row-open')).toBeNull();
  });
});

describe('the plan drawer', () => {
  const PLAN: SubscriptionsPayload = {
    generatedAt: '2026-10-21T09:00:00.000Z',
    mode: 'test',
    status: null,
    totals: {
      mrr: [{ currency: 'USD', totalHundredths: 4900, cancellingHundredths: 0, pastDueHundredths: 0, subscriptions: 1, overflow: false }],
      mrrUnpriced: 0,
      mrrDiscountUnknown: 0,
      mrrPastDueCounted: true,
      paidByPlan: [{ id: 'tier_a', name: 'Plan A', accounts: 1 }],
      byStatus: { ended: 0, paused: 0, grace: 0, failed: 0, cancelling: 0, active: 1, other: 0, no_stripe: 2 },
      accounts: 3,
      disagreeing: 0, // P-8b.3a
    },
    rows: [subRow()],
    matching: 3,
  };

  it('closed: no request; open: one request to the plan route, MRR in $, statuses, the accounts; no opener inside', async () => {
    serve({ success: true, data: PLAN });
    const { rerender } = render(<PlanDrawer plan={null} onClose={jest.fn()} onReturnFocus={jest.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<PlanDrawer plan={{ id: 'tier_a', name: 'Plan A' }} onClose={jest.fn()} onReturnFocus={jest.fn()} />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/business-os/billing/plans/tier_a');
    const body = await screen.findByTestId('plan-drawer-body');
    expect(within(body).getByTestId('plan-drawer-mrr-line')).toHaveTextContent(/^\$49 1 subscription/);
    expect(within(body).getByTestId('plan-drawer-status-active')).toHaveTextContent('1');
    expect(within(body).getByTestId('plan-drawer-status-no_stripe')).toHaveTextContent('2');
    expect(within(body).queryByTestId('plan-drawer-status-ended')).toBeNull();
    expect(within(body).getByTestId('plan-drawer-showing')).toHaveTextContent('Showing 1 of 3 accounts');
    expect(within(body).getAllByTestId('subscription-row')).toHaveLength(1);
    expect(within(body).queryByTestId('row-open')).toBeNull();
    // Read-only: no button in the body.
    expect(within(body).queryAllByRole('button')).toHaveLength(0);
  });

  it('a failed read is the shared error', async () => {
    serve({ success: false, error: 'That plan is not one of the configured plans.' }, 404);
    render(<PlanDrawer plan={{ id: 'tier_a', name: 'Plan A' }} onClose={jest.fn()} onReturnFocus={jest.fn()} />);
    expect(await screen.findByTestId('plan-drawer-error')).toBeInTheDocument();
  });
});

describe('formatOwnCurrency (USD-4)', () => {
  it('a business’s own currency sign: ₪ for ILS, $ for USD, € for EUR; an unknown code keeps its code', () => {
    expect(formatOwnCurrency(230.3, 'ILS')).toBe('₪230.30');
    expect(formatOwnCurrency(12.5, 'usd')).toBe('$12.50');
    expect(formatOwnCurrency(9, 'EUR')).toBe('€9.00');
    expect(formatOwnCurrency(9, 'NOTACODE')).toBe('NOTACODE 9.00');
    expect(formatOwnCurrency(9, null)).toMatch(/9\.00/);
  });
});

// ── Money MK-10 (MK10-R1 to R5): the Accounts and Subscriptions rows open like the Businesses rows ──
describe('Money MK-10: Accounts and Subscriptions rows (D-17)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('Accounts: a row click opens once; the "Open" full-view link inside does not open the drawer; the button opens once', async () => {
    serve({ success: false, error: 'Could not read this business.' }, 500);
    render(
      <BusinessDrawerProvider window={WINDOW}>
        <AccountEconomicsTable rows={[econRow()]} deleted={null} window={WINDOW} />
      </BusinessDrawerProvider>
    );
    const row = screen.getByTestId(`econ-row-${A}`);
    expect(row.className).toContain('cursor-pointer');
    // The full-view link is a control: its click is its own (no drawer read).
    const link = screen.getByTestId(`econ-open-${A}`);
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    // A plain cell click opens, once.
    fireEvent.click(row.querySelector('th') as Element);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Accounts: the button opens once (not twice through the row), and focus returns to it on close', async () => {
    serve({ success: false, error: 'Could not read this business.' }, 500);
    render(
      <BusinessDrawerProvider window={WINDOW}>
        <AccountEconomicsTable rows={[econRow()]} deleted={null} window={WINDOW} />
      </BusinessDrawerProvider>
    );
    const button = within(screen.getByTestId(`econ-row-${A}`)).getByTestId('row-open');
    fireEvent.click(button);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(`econ-row-${A}`).className).toContain('bg-slate-700/20');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    expect(document.activeElement).toBe(button);
  });

  it('Subscriptions: a row click opens through the row button; the business link inside does not; the button opens once', () => {
    const onQuickLook = jest.fn();
    render(<SubscriptionsTable rows={[subRow()]} onQuickLook={onQuickLook} openAccountId={A} />);
    const row = screen.getByTestId('subscription-row');
    expect(row.className).toContain('bg-slate-700/20');
    const button = within(row).getByTestId('row-open');
    const link = within(row).getByTestId('subscription-business-link');
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(onQuickLook).not.toHaveBeenCalled();
    fireEvent.click(row.querySelector('td:nth-child(3)') as Element);
    expect(onQuickLook).toHaveBeenCalledTimes(1);
    expect(onQuickLook.mock.calls[0][1]).toBe(button);
    fireEvent.click(button);
    expect(onQuickLook).toHaveBeenCalledTimes(2);
  });

  it('Subscriptions: a text selection does not open; without onQuickLook the row has no click or pointer', () => {
    const onQuickLook = jest.fn();
    const { unmount } = render(<SubscriptionsTable rows={[subRow()]} onQuickLook={onQuickLook} />);
    const cell = screen.getByTestId('subscription-row').querySelector('td:nth-child(3)') as Element;
    jest.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: cell.firstChild, focusNode: cell.firstChild } as unknown as Selection);
    fireEvent.click(cell);
    expect(onQuickLook).not.toHaveBeenCalled();
    unmount();
    render(<SubscriptionsTable rows={[subRow()]} />);
    expect(screen.getByTestId('subscription-row').className).not.toContain('cursor-pointer');
  });
});
