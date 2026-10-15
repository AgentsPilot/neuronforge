/**
 * @jest-environment jsdom
 *
 * The Accounts tab (finance health slice 6a, Money M-3, T9 / T10): AC-130 (the
 * tablist, its keyboard, the URL), AC-136 ("n/a, different currency", one line
 * per currency), AC-137 / AC-138 (notices), AC-139 (Not available), AC-140 /
 * AC-141 (the controls write the URL; the page never sorts), AC-143 (the count
 * line), AC-144 (each row's link; none on the platform and Deleted rows), and
 * SA-WR-43 (USD headers, the sign of a negative margin, the cost cell equal to
 * Section 3's text).
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type {
  FinanceAccountEconomicsSection,
  FinanceEconomicsRow,
  FinancePayload,
} from '@/lib/business-os/finance/financeTypes';

const mockReplace = jest.fn();
let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/admin/finance',
}));
jest.mock('@/app/admin/components/layout/AdminBusinessPicker', () => ({
  ...jest.requireActual('@/app/admin/components/layout/AdminBusinessPicker'),
  AdminBusinessPicker: ({ onSelect }: { onSelect: (id: string, name: string | null) => void }) => (
    <button type="button" data-testid="picker-pick" onClick={() => onSelect('11111111-1111-4111-8111-111111111111', 'Acme Dental (picked)')}>
      pick
    </button>
  ),
}));

import { FinanceView } from '../components/FinanceView';
import { AccountsTab } from '../components/AccountsTab';
import { DEFAULT_FINANCE_QUERY } from '../financeUrl';
import { accountViewHref } from '../financeLinks';
import { formatUsd } from '../financeFormat';
import {
  ACCOUNTS_FOUNDING_CHIP,
  ECON_COST,
  ECON_CUTOVER_NOTICE,
  ECON_DELETED,
  ECON_EMPTY,
  ECON_MARGIN,
  ECON_MARGIN_NOT_AVAILABLE,
  ECON_MARGIN_OTHER_CURRENCY,
  ECON_NO_PLAN_ROW,
  ECON_NO_REVENUE,
  ECON_NOTES,
  ECON_PLATFORM_TITLE,
  ECON_UNKNOWN,
  ECON_WALK_INCOMPLETE,
  econNotListed,
  econShowing,
  NAME_PLATFORM,
  REVENUE_REFUND_TIMING_NOTE,
  TAB_ACCOUNTS,
  TAB_OVERVIEW,
} from '../financeCopy';

const OWNER = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const WINDOW: FinancePayload['window'] = { preset: 'this_month', from: '2026-10-01', to: '2026-10-14', start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z' };

const row = (accountId: string, extra: Partial<FinanceEconomicsRow> = {}): FinanceEconomicsRow => ({
  accountId,
  kind: 'account',
  name: 'Acme Dental',
  nameStatus: 'found',
  group: 'tier:x',
  tierLabel: 'Essentials-ish',
  foundingPartner: true,
  noPlanRow: false,
  paid: { failed: false, lines: [{ currency: 'USD', afterTax: 89, exact: true, planAfterTax: 79, boostsAfterTax: 10 }] },
  aiCost: { kind: 'figure', costUsd: 1.2345, exact: true },
  margin: { kind: 'figure', marginUsd: 87.7655, noRevenue: false },
  credits: { kind: 'position', used: 400, allowance: 1000, usedTenths: 400 },
  ...extra,
});

function section(extra: Partial<FinanceAccountEconomicsSection> = {}): FinanceAccountEconomicsSection {
  return {
    status: 'ok',
    coverage: 'after_cutover',
    query: { sort: 'ai_cost', group: null, show: 'all' },
    platform: {
      paid: { failed: false, lines: [{ currency: 'USD', afterTax: 89, exact: true, planAfterTax: 79, boostsAfterTax: 10 }] },
      aiCost: { kind: 'figure', costUsd: 3.5, exact: true },
      margin: { kind: 'figure', marginUsd: 85.5, noRevenue: false },
      accountsCovered: 4,
      includesDeleted: true,
    },
    rows: [
      row(OWNER),
      row(B, {
        name: null,
        nameStatus: 'missing',
        group: 'unknown_held',
        tierLabel: null,
        foundingPartner: false,
        noPlanRow: true,
        paid: { failed: false, lines: [{ currency: 'ILS', afterTax: 10, exact: true, planAfterTax: 0, boostsAfterTax: 10 }] },
        aiCost: { kind: 'figure', costUsd: 0.25, exact: true },
        margin: { kind: 'other_currency' },
        credits: { kind: 'no_plan_row' },
      }),
      row(C, {
        name: 'Gamma Gym',
        foundingPartner: false,
        paid: { failed: false, lines: [] },
        aiCost: { kind: 'figure', costUsd: 0.1234, exact: true },
        margin: { kind: 'figure', marginUsd: -0.1234, noRevenue: true },
        credits: { kind: 'no_allowance' },
      }),
      row(PLATFORM, { kind: 'platform', name: null, nameStatus: 'platform', group: null, tierLabel: null, foundingPartner: false, margin: { kind: 'unknown' }, credits: { kind: 'unknown' } }),
    ],
    deleted: { paid: { failed: false, lines: [] }, aiCost: { kind: 'figure', costUsd: 0.3, exact: true }, margin: { kind: 'figure', marginUsd: -0.3, noRevenue: true } },
    counts: { accounts: 4, matching: 4, shown: 4, notListed: 0 },
    groupOptions: [
      { key: 'trial', tierLabel: null },
      { key: 'tier:x', tierLabel: 'Essentials-ish' },
    ],
    notes: { walkIncomplete: false, ledgerFailed: false, boostsFailed: false, plansFailed: false, creditsUnavailable: false, refundOrDispute: false },
    ...extra,
  };
}

/** Only what the Accounts tab and the shell read: the Overview sections are not rendered on this tab. */
const tabPayload = (s: FinanceAccountEconomicsSection = section()) =>
  ({ generatedAt: '2026-10-14T10:00:00.000Z', window: WINDOW, accountId: null, accountEconomics: s }) as unknown as FinancePayload;

function serve(body: unknown): jest.Mock {
  const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const renderTab = (s = section(), onChange = jest.fn()) => {
  render(<AccountsTab section={s} window={WINDOW} windowLabel="This month" query={{ ...DEFAULT_FINANCE_QUERY, tab: 'accounts' }} onChange={onChange} onRetry={jest.fn()} />);
  return onChange;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
});

describe('AC-130: the tabs, through the real view', () => {
  it('tab=accounts in the URL (a reload) → Accounts selected, its panel shown, the request carries tab=accounts', async () => {
    mockSearch = 'tab=accounts';
    const fetchMock = serve({ success: true, data: tabPayload() });
    render(<FinanceView />);
    await screen.findByTestId('econ-table');
    expect(screen.getByRole('tab', { name: TAB_ACCOUNTS })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: TAB_OVERVIEW })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'finance-tab-accounts');
    expect(String(fetchMock.mock.calls[0][0])).toContain('tab=accounts');
    expect(screen.queryByTestId('kpi-strip')).toBeNull();
  });

  it('keyboard: Left / Right / Home / End move focus only (manual activation); Enter selects; roving tabIndex', async () => {
    mockSearch = 'tab=accounts';
    serve({ success: true, data: tabPayload() });
    render(<FinanceView />);
    await screen.findByTestId('econ-table');
    const overview = screen.getByRole('tab', { name: TAB_OVERVIEW });
    const accounts = screen.getByRole('tab', { name: TAB_ACCOUNTS });
    expect(accounts).toHaveAttribute('tabIndex', '0');
    expect(overview).toHaveAttribute('tabIndex', '-1');
    accounts.focus();
    fireEvent.keyDown(accounts, { key: 'ArrowRight' });
    expect(overview).toHaveFocus();
    fireEvent.keyDown(overview, { key: 'End' });
    expect(accounts).toHaveFocus();
    fireEvent.keyDown(accounts, { key: 'Home' });
    expect(overview).toHaveFocus();
    fireEvent.keyDown(overview, { key: 'ArrowLeft' });
    expect(accounts).toHaveFocus();
    expect(mockReplace).not.toHaveBeenCalled();
    // Enter / Space on a focused tab is the button's own click.
    fireEvent.click(overview);
    expect(mockReplace).toHaveBeenCalledWith('/admin/finance?preset=this_month', { scroll: false });
  });

  it('selecting Accounts writes tab=accounts with replace; leaving it resets sort, group and show', async () => {
    mockSearch = 'tab=accounts&sort=margin&group=trial&show=negative';
    serve({ success: true, data: tabPayload() });
    render(<FinanceView />);
    await screen.findByTestId('econ-table');
    fireEvent.click(screen.getByRole('tab', { name: TAB_OVERVIEW }));
    expect(mockReplace).toHaveBeenLastCalledWith('/admin/finance?preset=this_month', { scroll: false });
    fireEvent.click(screen.getByRole('tab', { name: TAB_ACCOUNTS }));
    expect(mockReplace).toHaveBeenLastCalledWith('/admin/finance?preset=this_month&tab=accounts&sort=margin&group=trial&show=negative', { scroll: false });
  });

  it('picking a business from the Accounts tab drops tab, sort, group and show (M3-FR-1)', async () => {
    mockSearch = 'tab=accounts&sort=paid';
    serve({ success: true, data: tabPayload() });
    render(<FinanceView />);
    await screen.findByTestId('econ-table');
    fireEvent.click(screen.getByTestId('picker-pick'));
    expect(mockReplace).toHaveBeenLastCalledWith(`/admin/finance?preset=this_month&accountId=${OWNER}`, { scroll: false });
  });

  it('a malformed tab key → the default view with the notice (and no tab key sent)', async () => {
    mockSearch = 'tab=overview';
    // The request never answers: the default (Overview) view would need a full payload, and this
    // case is about the URL only. Answering with the tab-only payload raced the assertion.
    const fetchMock = jest.fn<Promise<never>, [string]>(() => new Promise<never>(() => undefined));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;
    render(<FinanceView />);
    expect(await screen.findByTestId('finance-url-notice')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('tab=');
  });
});

describe('the Accounts tab body (T10)', () => {
  it('M3-FR-9: the always-on notes; the platform line labelled, covering every account', () => {
    renderTab();
    const notes = screen.getByTestId('econ-notes');
    for (const note of ECON_NOTES) expect(notes).toHaveTextContent(note);
    expect(notes).not.toHaveTextContent(REVENUE_REFUND_TIMING_NOTE);
    const platform = screen.getByTestId('econ-platform');
    expect(platform).toHaveTextContent(ECON_PLATFORM_TITLE);
    expect(screen.getByTestId('econ-platform-paid')).toHaveTextContent('USD 89.00');
    expect(screen.getByTestId('econ-platform-cost')).toHaveTextContent('USD 3.50');
    expect(screen.getByTestId('econ-platform-margin')).toHaveTextContent('USD 85.50');
  });

  it('S4-W-3: the refund-timing sentence shows when the boost part carries it', () => {
    renderTab(section({ notes: { ...section().notes, refundOrDispute: true } }));
    expect(screen.getByTestId('econ-refund-note')).toHaveTextContent(REVENUE_REFUND_TIMING_NOTE);
  });

  it('SA-WR-43: the cost and margin headers say (USD); paid with formatMoney and its parts; cost and margin with formatUsd', () => {
    renderTab();
    const table = screen.getByTestId('econ-table');
    expect(within(table).getByRole('columnheader', { name: ECON_COST })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: ECON_MARGIN })).toBeInTheDocument();
    expect(ECON_COST).toMatch(/\(USD\)$/);
    expect(ECON_MARGIN).toMatch(/\(USD\)$/);
    const owner = screen.getByTestId(`econ-row-${OWNER}`);
    expect(within(owner).getByTestId(`econ-paid-${OWNER}-USD`)).toHaveTextContent('USD 89.00');
    expect(within(owner).getByTestId(`econ-paid-${OWNER}-USD`)).toHaveTextContent('plan USD 79.00 · boosts USD 10.00');
    // The cost cell is Section 3's own text for the same figure (formatUsd, 2 to 4 decimals).
    expect(screen.getByTestId(`econ-cost-${OWNER}`).textContent).toBe(formatUsd(1.2345));
    expect(screen.getByTestId(`econ-margin-${OWNER}`)).toHaveTextContent('USD 87.7655');
    expect(within(owner).getByTestId(`econ-founding-${OWNER}`)).toHaveTextContent(ACCOUNTS_FOUNDING_CHIP);
  });

  it('SA-WR-43: a negative margin keeps its minus sign, with "No revenue in this window"', () => {
    renderTab();
    expect(screen.getByTestId(`econ-margin-${C}`)).toHaveTextContent('USD -0.1234');
    expect(screen.getByTestId(`econ-row-${C}`)).toHaveTextContent(ECON_NO_REVENUE);
  });

  it('AC-136: another currency → "n/a, different currency", its own line; a money-only account says "No plan row"', () => {
    renderTab();
    const b = screen.getByTestId(`econ-row-${B}`);
    expect(screen.getByTestId(`econ-margin-${B}`)).toHaveTextContent(ECON_MARGIN_OTHER_CURRENCY);
    expect(within(b).getByTestId(`econ-paid-${B}-ILS`)).toHaveTextContent('ILS 10.00');
    expect(b.textContent).not.toMatch(/USD 10\.00 ILS|USD 99/);
    expect(b).toHaveTextContent(ECON_NO_PLAN_ROW);
  });

  it('AC-144 / SA-W85: each linked row opens the one-account view on the same window; platform and Deleted rows have no link', () => {
    renderTab();
    expect(screen.getByTestId(`econ-open-${OWNER}`)).toHaveAttribute('href', accountViewHref(OWNER, WINDOW));
    expect(screen.queryByTestId(`econ-open-${PLATFORM}`)).toBeNull();
    expect(screen.getByTestId(`econ-row-${PLATFORM}`)).toHaveTextContent(NAME_PLATFORM);
    const deleted = screen.getByTestId('econ-row-deleted');
    expect(deleted).toHaveTextContent(ECON_DELETED);
    expect(within(deleted).queryByRole('link')).toBeNull();
    // The Deleted row is last.
    const rows = within(screen.getByTestId('econ-table')).getAllByRole('row');
    expect(rows[rows.length - 1]).toBe(deleted);
  });

  it('AC-143: the count line, and the "more not listed" sentence when cut', () => {
    renderTab(section({ counts: { accounts: 250, matching: 250, shown: 200, notListed: 50 } }));
    expect(screen.getByTestId('econ-count')).toHaveTextContent(econShowing('200', '250'));
    expect(screen.getByTestId('econ-not-listed')).toHaveTextContent(econNotListed('50'));
    expect(econShowing('200', '250')).toBe('Showing 200 of 250 accounts');
  });

  it('M3-FR-10: no row matches → "No accounts match this filter", no table', () => {
    renderTab(section({ rows: [], counts: { accounts: 4, matching: 0, shown: 0, notListed: 0 } }));
    expect(screen.getByTestId('econ-empty')).toHaveTextContent(ECON_EMPTY);
    expect(screen.queryByTestId('econ-table')).toBeNull();
  });

  it('AC-139: before the cut-over → "Not available" with the notice; AC-138: a failed part names itself', () => {
    renderTab(
      section({
        coverage: 'starts_before_cutover',
        rows: [row(OWNER, { margin: { kind: 'not_available' } })],
        platform: { ...section().platform, margin: { kind: 'not_available' } },
        notes: { ...section().notes, walkIncomplete: true },
      })
    );
    expect(screen.getByTestId(`econ-margin-${OWNER}`)).toHaveTextContent(ECON_MARGIN_NOT_AVAILABLE);
    expect(screen.getByTestId('econ-platform-margin')).toHaveTextContent(ECON_MARGIN_NOT_AVAILABLE);
    const notices = screen.getAllByTestId('econ-notice').map((n) => n.textContent);
    expect(notices).toEqual([ECON_WALK_INCOMPLETE, ECON_CUTOVER_NOTICE]);
  });

  it('AC-137: an "At least" figure and an Unknown margin read as words, never a 0', () => {
    renderTab(
      section({
        rows: [row(OWNER, { aiCost: { kind: 'figure', costUsd: 1.2345, exact: false }, margin: { kind: 'unknown' } })],
      })
    );
    expect(screen.getByTestId(`econ-cost-${OWNER}`)).toHaveTextContent('At least USD 1.2345');
    expect(screen.getByTestId(`econ-margin-${OWNER}`)).toHaveTextContent(ECON_UNKNOWN);
  });

  it('AC-140 / AC-141: the controls write the URL (the server sorts); group options come from the server', () => {
    const onChange = renderTab();
    fireEvent.change(screen.getByTestId('econ-sort'), { target: { value: 'margin' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'accounts', sort: 'margin' }));
    fireEvent.change(screen.getByTestId('econ-group'), { target: { value: 'tier:x' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ group: 'tier:x' }));
    fireEvent.change(screen.getByTestId('econ-group'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ group: null }));
    fireEvent.change(screen.getByTestId('econ-show'), { target: { value: 'negative' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ show: 'negative' }));
    const options = within(screen.getByTestId('econ-group')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['All plan groups', 'Trial', 'Essentials-ish']);
    // The rows stay in the server's order: the page never re-sorts.
    const ids = within(screen.getByTestId('econ-table')).getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid'));
    expect(ids).toEqual([`econ-row-${OWNER}`, `econ-row-${B}`, `econ-row-${C}`, `econ-row-${PLATFORM}`, 'econ-row-deleted']);
  });

  it('no test-mode or Stripe-id wording anywhere on the tab', () => {
    renderTab();
    expect(document.body.textContent).not.toMatch(/livemode|test.?mode|live.?mode|stripe_/i);
  });
});

describe('fix round 1 (QA B-1): only rows the one-account view can open are linked', () => {
  it('a "No plan row" account has no link; a normal account keeps its link; a platform row stays unlinked', () => {
    renderTab();
    const noPlan = screen.getByTestId(`econ-row-${B}`);
    expect(noPlan).toHaveTextContent(ECON_NO_PLAN_ROW);
    expect(screen.queryByTestId(`econ-open-${B}`)).toBeNull();
    expect(within(noPlan).queryByRole('link')).toBeNull();
    expect(screen.getByTestId(`econ-open-${OWNER}`)).toHaveAttribute('href', accountViewHref(OWNER, WINDOW));
    expect(screen.getByTestId(`econ-open-${C}`)).toHaveAttribute('href', accountViewHref(C, WINDOW));
    expect(within(screen.getByTestId(`econ-row-${PLATFORM}`)).queryByRole('link')).toBeNull();
  });
});
