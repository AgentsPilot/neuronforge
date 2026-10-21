/**
 * @jest-environment jsdom
 *
 * The Costs & credits tab (credit deduction slice 4a, workplan §4.6, §10.1 UI):
 * each state, each section, the labels SA asked for (S-6, S-7), and that the
 * Settings tab is still what the page opens on.
 *
 * Money M-5: the report moved to its own page, Charge checks; the last block
 * covers both pages. One case was deleted there (named in the block).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { CostsTab } from '../components/costs/CostsTab';
import BusinessOsLlmSettingsPage from '../page';
import ChargeChecksPage from '@/app/admin/finance/charges/page';
import { ACTIVITY_TAB_LABEL } from '../activityCopy';
import {
  CHARGE_CHECKS_TITLE,
  COSTS_EMPTY,
  COSTS_INCOMPLETE,
  NET_INCLUDING_CORRECTIONS,
  SETTINGS_TAB_LABEL,
} from '../costCopy';
import type { CostPeriodFigures, CostReportPayload } from '../costTypes';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const figures = (over: Partial<CostPeriodFigures> = {}): CostPeriodFigures => ({
  creditsTotal: 4,
  creditsOwner: 3,
  creditsScheduled: 1,
  creditsExternal: 0.5,
  creditsAdjustment: -0.5,
  costUsd: 0.004,
  charges: 4,
  fallbackPriced: 1,
  ...over,
});

function report(over: Partial<CostReportPayload> = {}): CostReportPayload {
  return {
    generatedAt: '2026-09-29T12:00:00.000Z',
    window: { from: '2026-08-31', to: '2026-09-29', start: '2026-08-31T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z' },
    accountFilter: null,
    periodLookbackDays: 31,
    incomplete: false,
    incompleteReasons: [],
    limits: { totalsCeiling: 2000, rowsCeiling: 20000, originalsMax: 1000, fallbackListMax: 50, fewExamplesBelow: 10 },
    sections: { totals: 'ok', rows: 'ok', names: 'ok', originals: 'ok' },
    rowsRead: 9,
    accounts: [
      { accountId: A, companyName: 'Alpha Studio' },
      { accountId: B, companyName: 'Beta Bakery' },
    ],
    periods: [
      { accountId: A, companyName: 'Alpha Studio', periodStart: '2026-09-05T00:00:00+00:00', stored: figures(), fromRows: figures(), matches: true },
      {
        accountId: B,
        companyName: 'Beta Bakery',
        periodStart: '2026-09-01T00:00:00+00:00',
        stored: figures({ creditsTotal: 3, costUsd: 0.003 }),
        fromRows: figures({ creditsTotal: 2.9, costUsd: 0.0029 }),
        matches: false,
      },
    ],
    grandTotal: { stored: figures({ creditsTotal: 7, costUsd: 0.007 }), fromRows: figures({ creditsTotal: 6.9 }) },
    mismatchedPeriods: 1,
    breakdowns: {
      byActionType: [
        { key: 'chat_turn', unresolved: false, charges: 3, failedCharges: 0, corrections: 0, credits: 6, costUsd: 0.006, correctionCredits: 0, correctionCostUsd: 0 },
        { key: 'embedding_only_fixture', unresolved: false, charges: 1, failedCharges: 1, corrections: 0, credits: 0.0002, costUsd: 0.00000021, correctionCredits: 0, correctionCostUsd: 0 },
        { key: null, unresolved: true, charges: 0, failedCharges: 0, corrections: 1, credits: -0.1, costUsd: -0.0001, correctionCredits: -0.1, correctionCostUsd: -0.0001 },
      ],
      byArea: [{ key: null, unresolved: false, charges: 1, failedCharges: 0, corrections: 0, credits: 1, costUsd: 0.001, correctionCredits: 0, correctionCostUsd: 0 }],
      byService: [{ key: 'ai', unresolved: false, charges: 4, failedCharges: 1, corrections: 0, credits: 6, costUsd: 0.006, correctionCredits: 0, correctionCostUsd: 0 }],
      byTrigger: [{ key: 'owner', unresolved: false, charges: 4, failedCharges: 0, corrections: 1, credits: 5.7, costUsd: 0.0057, correctionCredits: -0.3, correctionCostUsd: -0.0003 }],
    },
    unresolvedCorrections: { count: 1, credits: -0.1, costUsd: -0.0001 },
    fallback: {
      count: 1,
      reconciled: 0,
      items: [
        {
          accountId: A, companyName: 'Alpha Studio', createdAt: '2026-09-18T08:00:00+00:00', actionType: 'lead_reply_recommendation',
          groupId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', actionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', credits: 0.5, costUsd: 0.0005, reconciled: false,
        },
      ],
    },
    spreads: [
      { service: 'ai', actionType: 'chat_turn', area: 'chat', examples: 3, failed: 2, fallbackExcluded: 0, fewExamples: true, costUsd: { p50: 0.002, p90: 0.0028 }, credits: { p50: 2, p90: 2.8 } },
      { service: 'ai', actionType: 'insight_run', area: 'insights', examples: 12, failed: 0, fallbackExcluded: 1, fewExamples: false, costUsd: { p50: 0.01, p90: 0.02 }, credits: { p50: 10, p90: 20 } },
    ],
    unreadableAmounts: 0,
    ...over,
  };
}

type Responder = (url: string) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

function stubReport(respond: Responder) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const { status, body } = await respond(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const ok = (data: CostReportPayload) => ({ status: 200, body: { success: true, data } });

/** L-9a (E-3, E-6): the shared business picker's list route and its answer. */
const BUSINESSES_PATH = '/api/admin/business-os/llm-usage/businesses';
const businessesAnswer = {
  status: 200,
  body: {
    success: true,
    data: {
      businesses: [
        { userId: A, companyName: 'Alpha Studio' },
        { userId: B, companyName: 'Beta Bakery' },
      ],
      limit: 50,
    },
  },
};

/** Opens the shared picker (its one list read) and picks `name` from the list. */
async function pickBusiness(name: string) {
  fireEvent.focus(screen.getByTestId('business-picker-input'));
  const list = await screen.findByTestId('business-picker-options');
  fireEvent.click(await within(list).findByText(name));
}

beforeEach(() => jest.clearAllMocks());

describe('states', () => {
  it('loading, then the report', async () => {
    let release: (v: { status: number; body: unknown }) => void = () => {};
    stubReport(() => new Promise((resolve) => (release = resolve)));
    render(<CostsTab />);
    expect(screen.getByTestId('costs-loading')).toHaveTextContent('Reading the cost report');
    await act(async () => release(ok(report())));
    await waitFor(() => expect(screen.queryByTestId('costs-loading')).not.toBeInTheDocument());
    expect(screen.getByTestId('costs-periods')).toBeInTheDocument();
  });

  it('an error from the route is shown, not a blank tab', async () => {
    stubReport(() => ({ status: 400, body: { success: false, error: 'The window may be at most 92 days' } }));
    render(<CostsTab />);
    expect(await screen.findByTestId('costs-error')).toHaveTextContent('The window may be at most 92 days');
  });

  // E-1 (L-9a): the shared words, never the browser's message (§5.10 rules 3 and 4).
  it('a network failure is shown as an error', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    render(<CostsTab />);
    expect(await screen.findByTestId('costs-error')).toHaveTextContent(ADMIN_NETWORK_ERROR);
  });

  it('"No charges recorded in this window" when there are no periods', async () => {
    stubReport(() => ok(report({ periods: [], accounts: [], breakdowns: null, spreads: [], rowsRead: null })));
    render(<CostsTab />);
    expect(await screen.findByTestId('costs-empty')).toHaveTextContent(COSTS_EMPTY);
    expect(screen.queryByTestId('costs-periods')).not.toBeInTheDocument();
  });

  it('an amber "incomplete" banner when a read hit its ceiling, naming which', async () => {
    stubReport(() => ok(report({ incomplete: true, incompleteReasons: ['rows_ceiling'] })));
    render(<CostsTab />);
    const banner = await screen.findByTestId('costs-incomplete');
    expect(banner).toHaveTextContent(COSTS_INCOMPLETE.slice(0, 20));
    expect(banner).toHaveTextContent('too many ledger rows');
    // L-9b (E-9): the test id sits on the shared AdminNotice's text element
    // (RC-3), so the amber is its container's.
    expect(banner.closest('div')?.className).toMatch(/amber/);
  });

  it('a failed totals read says so instead of claiming there were no charges', async () => {
    stubReport(() =>
      ok(report({ periods: [], sections: { totals: 'failed', rows: 'skipped', names: 'skipped', originals: 'skipped' } }))
    );
    render(<CostsTab />);
    expect(await screen.findByTestId('costs-totals-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('costs-empty')).not.toBeInTheDocument();
  });

  it('a failed rows read fails the row-based sections only', async () => {
    stubReport(() =>
      ok(report({ breakdowns: null, sections: { totals: 'ok', rows: 'failed', names: 'ok', originals: 'skipped' } }))
    );
    render(<CostsTab />);
    expect(await screen.findByTestId('costs-breakdowns-failed')).toBeInTheDocument();
    expect(screen.getByTestId('costs-fallback-failed')).toBeInTheDocument();
    expect(screen.getByTestId('costs-spread-failed')).toBeInTheDocument();
    expect(screen.getAllByTestId('period-row')).toHaveLength(2);
  });
});

describe('sections', () => {
  beforeEach(() => {
    stubReport(() => ok(report()));
  });

  it('per account and period: names, figures, the check, the mismatch with both figures, the total', async () => {
    render(<CostsTab />);
    const rows = await screen.findAllByTestId('period-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Alpha Studio')).toBeInTheDocument();
    expect(within(rows[0]).getByText('2026-09-05')).toBeInTheDocument();
    expect(within(rows[0]).getByTestId('period-check-ok')).toBeInTheDocument();
    expect(within(rows[1]).getByTestId('period-check-mismatch')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('rows: 2.9 credits, $0.0029');
    expect(screen.getByTestId('costs-mismatch-summary')).toHaveTextContent('1 period disagrees');
    expect(screen.getByTestId('period-total-row')).toHaveTextContent('7');
  });

  it('the breakdowns are labelled "net, including corrections" (S-7)', async () => {
    render(<CostsTab />);
    const section = await screen.findByTestId('costs-breakdowns');
    expect(section).toHaveTextContent(NET_INCLUDING_CORRECTIONS);
    expect(screen.getByTestId('costs-unresolved')).toHaveTextContent('1 correction');
    expect(section).toHaveTextContent('correction, charge not found');
    expect(section).toHaveTextContent('not declared');
  });

  it('sub-cent costs keep their significant digits', async () => {
    render(<CostsTab />);
    const table = await screen.findByTestId('breakdown-Action type');
    expect(table).toHaveTextContent('$0.00000021');
    expect(table).not.toHaveTextContent('$0.00 ');
  });

  it('fallback-priced charges: the count and the list', async () => {
    render(<CostsTab />);
    expect(await screen.findByTestId('costs-fallback-count')).toHaveTextContent('1 fallback-priced charge, 0 reconciled.');
    const [row] = screen.getAllByTestId('fallback-row');
    expect(row).toHaveTextContent('lead_reply_recommendation');
    expect(row).toHaveTextContent('2026-09-18 08:00');
    expect(row).toHaveTextContent('no');
  });

  it('spread: succeeded examples, the failed count beside them, and "few examples" below 10 (S-6)', async () => {
    render(<CostsTab />);
    const rows = await screen.findAllByTestId('spread-row');
    expect(rows[0]).toHaveTextContent('chat_turn');
    expect(within(rows[0]).getByTestId('spread-few-examples')).toHaveTextContent('few examples');
    // examples 3, failed 2, shown side by side
    expect(rows[0].textContent).toMatch(/32\$0\.002/);
    expect(within(rows[1]).queryByTestId('spread-few-examples')).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('1 fallback left out');
    expect(screen.getByTestId('costs-spread')).toHaveTextContent('succeeded charges only');
  });

  it('the window line names the rule for which periods are shown', async () => {
    render(<CostsTab />);
    const line = await screen.findByTestId('costs-window');
    expect(line).toHaveTextContent('2026-08-31 to 2026-09-29 (UTC)');
    expect(line).toHaveTextContent('9 ledger rows read');
    expect(line).toHaveTextContent('at most 31 days before its first day');
  });
});

describe('controls', () => {
  it('opens on the last 30 days, all accounts', async () => {
    const fetchMock = stubReport(() => ok(report()));
    render(<CostsTab />);
    await screen.findByTestId('costs-periods');
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(url.pathname).toBe('/api/admin/business-os/credits/report');
    const from = Date.parse(`${url.searchParams.get('from')}T00:00:00Z`);
    const to = Date.parse(`${url.searchParams.get('to')}T00:00:00Z`);
    expect((to - from) / 86_400_000).toBe(29);
    expect(url.searchParams.has('accountId')).toBe(false);
  });

  it('a preset re-reads with its window', async () => {
    const fetchMock = stubReport(() => ok(report()));
    render(<CostsTab />);
    await screen.findByTestId('costs-periods');
    // E-2 (L-9a): the standard window label (D-2 (b)), the same window.
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost');
    const days = (Date.parse(url.searchParams.get('to')!) - Date.parse(url.searchParams.get('from')!)) / 86_400_000;
    expect(days).toBe(6);
  });

  // E-3 (L-9a, SA-R-11): rewritten. The shared picker searches every business
  // through the businesses route; the account <select> is gone.
  it('the business picker replaces the account select', async () => {
    const fetchMock = stubReport((url) =>
      url.split('?')[0] === BUSINESSES_PATH
        ? businessesAnswer
        : url.includes('accountId=')
          ? ok(report({ accounts: [{ accountId: B, companyName: 'Beta Bakery' }], accountFilter: B }))
          : ok(report())
    );
    render(<CostsTab />);
    await screen.findByTestId('costs-periods');
    expect(screen.queryByTestId('costs-account-filter')).not.toBeInTheDocument();
    const reportCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/credits/report'));

    await pickBusiness('Beta Bakery');
    await waitFor(() => expect(reportCalls()).toHaveLength(2));
    expect(reportCalls()[1]).toContain(`accountId=${B}`);
    expect(screen.getByTestId('business-filter-chip')).toHaveTextContent('Business: Beta Bakery');
  });

  // E-4 (L-9a): Custom opens the shared From / To row; its button is the shared "Apply".
  it('custom dates are sent as typed; the route validates them', async () => {
    const fetchMock = stubReport(() => ok(report()));
    render(<CostsTab />);
    await screen.findByTestId('costs-periods');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-07-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain('from=2026-07-01&to=2026-07-31');
  });

  it('refresh re-reads the same query', async () => {
    const fetchMock = stubReport(() => ok(report()));
    render(<CostsTab />);
    await screen.findByTestId('costs-periods');
    // E-5 (L-9a, D-15): the shared Refresh's name.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the cost report' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);
  });
});

describe('the pages: Business OS AI has two tabs, Settings first; the report is on Charge checks (Money M-5)', () => {
  function stubBoth() {
    return stubReport((url) =>
      url.includes('/credits/report')
        ? ok(report())
        : { status: 200, body: { success: true, data: { areas: [], generatedAt: '2026-09-23T09:00:00.000Z' } } }
    );
  }

  it('Business OS AI opens on Settings, shows Settings and Activity only, and never reads the cost report', async () => {
    const fetchMock = stubBoth();
    render(<BusinessOsLlmSettingsPage />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([SETTINGS_TAB_LABEL, ACTIVITY_TAB_LABEL]);
    expect(screen.getByTestId('tab-settings')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('tab-costs')).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toEqual(
      expect.arrayContaining([expect.stringContaining('/credits/report')])
    );
    expect(screen.getByTestId('page-standing-note')).toBeVisible();
    expect(screen.queryByTestId('costs-tab')).not.toBeInTheDocument();
    expect(document.getElementById('bos-llm-panel-costs')).toBeNull();
  });

  it('Charge checks mounts the report under its own h1, with no tabs', async () => {
    const fetchMock = stubBoth();
    render(<ChargeChecksPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CHARGE_CHECKS_TITLE);
    expect(await screen.findByTestId('costs-periods')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/credits/report'))).toBe(true);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByTestId('costs-tab')).toBeVisible();
  });

  it('each of the two tabs controls its own tabpanel (CR-N2)', async () => {
    stubBoth();
    render(<BusinessOsLlmSettingsPage />);
    for (const id of ['settings', 'activity']) {
      const tab = screen.getByTestId(`tab-${id}`);
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const panel = document.getElementById(panelId as string)!;
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    }
    const activityPanel = document.getElementById(screen.getByTestId('tab-activity').getAttribute('aria-controls')!)!;
    expect(activityPanel).not.toBeVisible();
    fireEvent.click(screen.getByTestId('tab-activity'));
    expect(activityPanel).toBeVisible();
  });

  // Deleted in Money M-5 (SA-W6, M5-R1): "switching tabs keeps the chosen
  // window and account, and does not re-read (CR-N2)". It switched between the
  // Costs and Settings tabs; there is no Costs tab any more, and Charge checks
  // has no tabs. Activity's own keep-on-switch behaviour is pinned by
  // `tabCoexistence.render.test.tsx` X-4.
});

describe('CR-N2 and QA Low items: which response the screen shows', () => {
  it('a slower EARLIER response never overwrites a newer window', async () => {
    const releases: Array<(v: { status: number; body: unknown }) => void> = [];
    stubReport(() => new Promise((resolve) => releases.push(resolve)));
    render(<CostsTab />);
    // Request 1 (30 days) is still pending when the admin picks 7 days.
    fireEvent.click(screen.getByRole('button', { name: '7 days' })); // E-7 (L-9a): the standard label
    await waitFor(() => expect(releases).toHaveLength(2));

    const newer = report({ window: { ...report().window, from: '2026-09-23', to: '2026-09-29' } });
    const older = report({ window: { ...report().window, from: '2026-08-31', to: '2026-09-29' } });
    await act(async () => releases[1](ok(newer)));
    expect(await screen.findByTestId('costs-window')).toHaveTextContent('2026-09-23 to 2026-09-29');
    await act(async () => releases[0](ok(older)));
    expect(screen.getByTestId('costs-window')).toHaveTextContent('2026-09-23 to 2026-09-29');
    expect(screen.queryByTestId('costs-loading')).not.toBeInTheDocument();
  });

  it('a slower earlier FAILURE does not show an error over a newer report', async () => {
    const releases: Array<(v: { status: number; body: unknown }) => void> = [];
    stubReport(() => new Promise((resolve) => releases.push(resolve)));
    render(<CostsTab />);
    fireEvent.click(screen.getByRole('button', { name: '7 days' })); // E-7 (L-9a): the standard label
    await waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => releases[1](ok(report())));
    await screen.findByTestId('costs-periods');
    await act(async () => releases[0]({ status: 500, body: { success: false, error: 'Internal server error' } }));
    expect(screen.queryByTestId('costs-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('costs-periods')).toBeInTheDocument();
  });

  it('a failed re-read clears the previous report instead of leaving it under the error', async () => {
    let fail = false;
    stubReport(() => (fail ? { status: 500, body: { success: false, error: 'Internal server error' } } : ok(report())));
    render(<CostsTab />);
    await screen.findByTestId('costs-periods');
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the cost report' })); // E-8 (L-9a, D-15)
    expect(await screen.findByTestId('costs-error')).toHaveTextContent('Internal server error');
    expect(screen.queryByTestId('costs-periods')).not.toBeInTheDocument();
    expect(screen.queryByTestId('costs-window')).not.toBeInTheDocument();
  });

  it('unreadable amounts are shown, never silent (QA Low 2)', async () => {
    stubReport(() => ok(report({ unreadableAmounts: 3 })));
    render(<CostsTab />);
    expect(await screen.findByTestId('costs-unreadable')).toHaveTextContent('3 stored amounts could not be read');
  });

  it('no unreadable-amounts notice at 0', async () => {
    stubReport(() => ok(report()));
    render(<CostsTab />);
    await screen.findByTestId('costs-periods');
    expect(screen.queryByTestId('costs-unreadable')).not.toBeInTheDocument();
  });

  it('a failed read of the corrected charges says the read failed, not "could not be matched" (QA Low 3)', async () => {
    stubReport(() => ok(report({ sections: { totals: 'ok', rows: 'ok', names: 'ok', originals: 'failed' } })));
    render(<CostsTab />);
    const note = await screen.findByTestId('costs-originals-failed');
    expect(note).toHaveTextContent('could not be read');
    expect(note).toHaveTextContent('not a gap in the ledger');
    expect(note).toHaveTextContent('1 correction (-0.1 credits)');
    expect(screen.queryByTestId('costs-unresolved')).not.toBeInTheDocument();
  });
});
