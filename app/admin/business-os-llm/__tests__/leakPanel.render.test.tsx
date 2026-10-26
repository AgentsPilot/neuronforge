/**
 * @jest-environment jsdom
 *
 * The leak check panel on the Costs & credits tab (credit deduction slice 4b,
 * workplan §5.4, §10.2): it runs only on the button, sends the chosen window
 * and account, and shows each verdict (found, partial, clean), the per-account
 * findings with their period, the known paths, the platform count, the blind
 * spots, and errors. Only the newest run may set the screen.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';

import { LeakCheckPanel } from '../components/costs/LeakCheckPanel';
import { COSTS_PLATFORM_ACCOUNT } from '../costCopy';
import {
  LEAK_BLIND_SPOT_TEXT,
  LEAK_CLEAN,
  LEAK_EMPTY_WINDOW,
  LEAK_END_CLAMPED,
  LEAK_FOUND,
  LEAK_NOT_RUN,
  LEAK_PARTIAL,
  LEAK_REMAINING,
  LEAK_RUN,
  LEAK_STATUS_TEXT,
} from '../leakCopy';
import type { LeakAccountFindingWire, LeakCheckPayload } from '../leakTypes';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const G1 = 'aaaaaaaa-0000-4000-8000-000000000001';

function finding(over: Partial<LeakAccountFindingWire> = {}): LeakAccountFindingWire {
  return {
    accountId: A,
    companyName: 'Alpha Studio',
    status: 'leak',
    periodStart: '2026-09-23T19:55:01.286Z',
    periodStarts: ['2026-09-23T19:55:01.286Z'],
    counts: {
      groupsExamined: 4,
      matched: 2,
      uncharged: 1,
      undercharged: 0,
      ungroupedCalls: 1,
      noSpend: 0,
      pendingReconciliation: 1,
      pendingUndercharged: 1,
      chargedAboveUsage: 0,
      knownPathCalls: 0,
      unresolvedCorrections: 0,
      unreadableAmounts: 0,
    },
    usd: { uncharged: 0.0009, undercharged: 0, ungrouped: 0.0001, totalUncharged: 0.001, knownPath: 0 },
    examples: {
      uncharged: [
        {
          groupId: G1,
          periodStart: '2026-09-23T19:55:01.286Z',
          calls: 2,
          usageUsd: 0.0009,
          chargedUsd: 0,
          firstCallAt: '2026-09-28T10:00:00.000Z',
          lastCallAt: '2026-09-28T10:00:01.000Z',
          direction: null,
        },
      ],
      undercharged: [],
      pendingReconciliation: [],
      chargedAboveUsage: [],
    },
    knownPaths: [],
    reasons: [],
    ...over,
  };
}

function payload(over: Partial<LeakCheckPayload> = {}): LeakCheckPayload {
  return {
    trigger: 'on_demand',
    window: { start: '2026-09-28T00:00:00.000Z', end: '2026-09-29T00:00:00.000Z' },
    endClamped: false,
    accountId: null,
    generatedAt: '2026-09-29T08:00:00.000Z',
    accountsChecked: 8,
    accountsWithLeak: 1,
    accountsIncomplete: 0,
    accountsNotChecked: 0,
    accountsRemaining: 0,
    deadlineReached: false,
    listingFailed: false,
    listing: { planAccounts: 8, chargedWithoutPlan: 0, plans: 'ok', totals: 'ok' },
    totals: {
      unchargedGroups: 1,
      ungroupedCalls: 1,
      underchargedGroups: 0,
      pendingReconciliation: 1,
      knownPathCalls: 0,
      matchedGroups: 2,
      noSpendGroups: 0,
      chargedAboveUsage: 0,
      unchargedUsd: 0.001,
    },
    platform: { businessOsCalls: 19, helperLabelCalls: 3, envIgnored: false },
    accounts: [finding()],
    blindSpots: [
      'no_plan_no_charge_account',
      'sub_microdollar_reused_group',
      'never_reached_token_usage',
      'outside_business_os_filter',
      'edge_of_window',
      'fallback_masks_undercharge',
    ],
    ...over,
  };
}

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn(() => respond({ success: true, data: payload() }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
});

const run = () => fireEvent.click(screen.getByTestId('leak-run'));

describe('the leak check panel', () => {
  it('does not run on mount: the check walks every business, so only the button starts it', () => {
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('leak-not-run')).toHaveTextContent(LEAK_NOT_RUN);
    expect(screen.getByTestId('leak-run')).toHaveTextContent(LEAK_RUN);
  });

  it('defaults to yesterday (UTC) for both dates and sends them, with no account', async () => {
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(screen.getByTestId('leak-from')).toHaveValue(yesterday);
    expect(screen.getByTestId('leak-to')).toHaveValue(yesterday);
    run();
    await screen.findByTestId('leak-result');
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/admin/business-os/credits/leak-check?from=${yesterday}&to=${yesterday}`);
  });

  it('sends the chosen dates and the account chosen on the tab', async () => {
    render(<LeakCheckPanel accountId={A} accountLabel="Alpha Studio" />);
    expect(screen.getByTestId('leak-scope')).toHaveTextContent('Checking one business: Alpha Studio');
    fireEvent.change(screen.getByTestId('leak-from'), { target: { value: '2026-09-22' } });
    fireEvent.change(screen.getByTestId('leak-to'), { target: { value: '2026-09-28' } });
    run();
    await screen.findByTestId('leak-result');
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/admin/business-os/credits/leak-check?from=2026-09-22&to=2026-09-28&accountId=${A}`
    );
  });

  it('a leak: red verdict with the count and the USD, the account row with its period and counts, the group ids', async () => {
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    const verdict = await screen.findByTestId('leak-verdict-found');
    expect(verdict).toHaveTextContent(LEAK_FOUND(1, '$0.001'));
    const row = screen.getByTestId(`leak-account-${A}`);
    expect(row).toHaveTextContent('Alpha Studio');
    expect(within(row).getByTestId('leak-status')).toHaveTextContent(LEAK_STATUS_TEXT.leak);
    expect(within(row).getByTestId('leak-period')).toHaveTextContent('2026-09-23');
    // Pending reconciliation shows how many were under the fallback (N-8).
    expect(row).toHaveTextContent('1 under');
    expect(screen.getAllByTestId('leak-example')[0]).toHaveTextContent(G1);
    expect(screen.getByTestId('leak-platform')).toHaveTextContent('19 Business OS calls, 3 with the shared helper label');
  });

  it('nothing found and everything read: green', async () => {
    fetchMock.mockImplementation(() =>
      respond({ success: true, data: payload({ accountsWithLeak: 0, accounts: [], totals: { ...payload().totals, unchargedGroups: 0, ungroupedCalls: 0, unchargedUsd: 0 } }) })
    );
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    expect(await screen.findByTestId('leak-verdict-clean')).toHaveTextContent(LEAK_CLEAN);
    expect(screen.queryByTestId('leak-accounts')).not.toBeInTheDocument();
  });

  it.each([
    ['an account could not be read', { accountsNotChecked: 1 }],
    ['an account was only partly read', { accountsIncomplete: 1 }],
    ['time ran out', { accountsRemaining: 2, deadlineReached: true }],
    ['the business list failed', { listingFailed: true }],
  ])('nothing found but %s: amber, never green', async (_name, over) => {
    fetchMock.mockImplementation(() => respond({ success: true, data: payload({ accountsWithLeak: 0, accounts: [], ...over }) }));
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    expect(await screen.findByTestId('leak-verdict-partial')).toHaveTextContent(LEAK_PARTIAL);
    expect(screen.queryByTestId('leak-verdict-clean')).not.toBeInTheDocument();
  });

  it('says how many businesses were left when time ran out, and when the end was pulled back', async () => {
    fetchMock.mockImplementation(() =>
      respond({ success: true, data: payload({ accountsRemaining: 3, deadlineReached: true, endClamped: true }) })
    );
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    expect(await screen.findByTestId('leak-remaining')).toHaveTextContent(LEAK_REMAINING(3));
    expect(screen.getByTestId('leak-end-clamped')).toHaveTextContent(LEAK_END_CLAMPED);
    expect(screen.getByTestId('leak-also-partial')).toBeInTheDocument();
  });

  it('CR4b-N2 / QA4b-E2: a window the clamp shrank to nothing reads "nothing to check yet", never green', async () => {
    fetchMock.mockImplementation(() =>
      respond({
        success: true,
        data: payload({
          window: { start: '2026-09-30T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z' },
          endClamped: true,
          accountsWithLeak: 0,
          accounts: [],
          totals: { ...payload().totals, unchargedGroups: 0, ungroupedCalls: 0, pendingReconciliation: 0, matchedGroups: 0, unchargedUsd: 0 },
        }),
      })
    );
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    expect(await screen.findByTestId('leak-verdict-empty')).toHaveTextContent(LEAK_EMPTY_WINDOW);
    expect(screen.queryByTestId('leak-verdict-clean')).not.toBeInTheDocument();
    expect(screen.getByTestId('leak-end-clamped')).toHaveTextContent(LEAK_END_CLAMPED);
  });

  it('QA4b-E1: a row listed only for corrections, unreadable amounts or charges above usage says so', async () => {
    const quiet = finding({
      accountId: B,
      companyName: 'Beta',
      status: 'clean',
      counts: {
        ...finding().counts,
        uncharged: 0,
        ungroupedCalls: 0,
        pendingReconciliation: 0,
        pendingUndercharged: 0,
        chargedAboveUsage: 2,
        unresolvedCorrections: 1,
        unreadableAmounts: 3,
      },
      usd: { uncharged: 0, undercharged: 0, ungrouped: 0, totalUncharged: 0, knownPath: 0 },
      examples: { uncharged: [], undercharged: [], pendingReconciliation: [], chargedAboveUsage: [] },
    });
    fetchMock.mockImplementation(() => respond({ success: true, data: payload({ accountsWithLeak: 0, accounts: [quiet, finding()] }) }));
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    const row = await screen.findByTestId(`leak-account-${B}`);
    expect(row).toHaveTextContent(LEAK_STATUS_TEXT.clean);
    expect(within(row).getByTestId('leak-row-note')).toHaveTextContent(
      '2 charged above usage · 1 unresolved correction · 3 unreadable amounts'
    );
    // A row with none of the three carries no note.
    expect(within(screen.getByTestId(`leak-account-${A}`)).queryByTestId('leak-row-note')).not.toBeInTheDocument();
  });

  it('an account that could not be checked shows its reason', async () => {
    fetchMock.mockImplementation(() =>
      respond({
        success: true,
        data: payload({
          accountsWithLeak: 0,
          accountsNotChecked: 1,
          accounts: [finding({ accountId: B, companyName: null, status: 'could_not_check', reasons: ['usage_read_failed'], periodStarts: [] })],
        }),
      })
    );
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    const row = await screen.findByTestId(`leak-account-${B}`);
    expect(row).toHaveTextContent(B); // no name: the id is shown
    expect(row).toHaveTextContent(LEAK_STATUS_TEXT.could_not_check);
    expect(row).toHaveTextContent('token_usage could not be read');
  });

  it('known uncharged paths are listed apart, as accepted (S-3)', async () => {
    fetchMock.mockImplementation(() =>
      respond({
        success: true,
        data: payload({
          accountsWithLeak: 0,
          accounts: [
            finding({
              status: 'clean',
              counts: { ...finding().counts, uncharged: 0, ungroupedCalls: 0, knownPathCalls: 2 },
              knownPaths: [{ feature: 'business-os-chat', component: 'IntentParser', calls: 2, usageUsd: 0.0004 }],
            }),
          ],
        }),
      })
    );
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    expect(await screen.findByTestId('leak-known-paths')).toHaveTextContent('business-os-chat / IntentParser: 2 calls, $0.0004');
    expect(screen.getByTestId('leak-verdict-clean')).toBeInTheDocument();
  });

  it('every blind spot is spelled out', async () => {
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    const spots = await screen.findByTestId('leak-blind-spots');
    for (const text of Object.values(LEAK_BLIND_SPOT_TEXT)) expect(spots).toHaveTextContent(text);
  });

  it('an error is shown as-is and clears the previous result', async () => {
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    await screen.findByTestId('leak-result');
    fetchMock.mockImplementation(() => respond({ success: false, error: 'The leak check window may be at most 7 days' }, 400));
    run();
    expect(await screen.findByTestId('leak-error')).toHaveTextContent('The leak check window may be at most 7 days');
    expect(screen.queryByTestId('leak-result')).not.toBeInTheDocument();
  });

  it('one run at a time: the button is disabled while a run is in flight, and an unmount abandons it', async () => {
    let release: (v: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const { unmount } = render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    await waitFor(() => expect(screen.getByTestId('leak-run')).toBeDisabled());
    expect(screen.getByTestId('leak-run')).toHaveTextContent('Checking');
    run(); // ignored while disabled
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = (fetchMock.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
    // A late answer after the unmount sets nothing (no React warning, no throw).
    await act(async () => {
      release({ ok: true, status: 200, json: async () => ({ success: true, data: payload() }) } as Response);
    });
  });
});

/**
 * Admin Layout Standard L-9b (workplan §2.8, §6.3 L-1 to L-4): the panel reads
 * through the shared `readJsonBody`, says the shared sentence on a network
 * failure, its own words on a non-JSON body, the tab's platform-account
 * sentence on a 409 (SA M-2), and shows its statuses as `StatusChip`s (Q-5) in
 * a table on the shared classes.
 */
describe('the leak check panel on the admin layout standard (L-9b)', () => {
  it('L-1: a network failure says the shared sentence, never the browser message, and clears the result', async () => {
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    await screen.findByTestId('leak-result');
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    run();
    const error = await screen.findByTestId('leak-error');
    expect(error.textContent).toBe(ADMIN_NETWORK_ERROR);
    expect(screen.queryByTestId('leak-result')).not.toBeInTheDocument();
    // Run is the retry: no "Try again" of its own.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByTestId('leak-run')).toBeEnabled();
  });

  it('L-2: a body that is not JSON says the panel\'s own words, never a parser message', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
        },
      } as unknown as Response)
    );
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    const error = await screen.findByTestId('leak-error');
    expect(error.textContent).toBe('Could not run the leak check');
    expect(error).not.toHaveTextContent('Unexpected token');
  });

  it('L-3: a platform account (409) gets the tab\'s sentence (SA M-2) as a notice, without "Try again"', async () => {
    fetchMock.mockImplementation(() => respond({ success: false, error: 'platform_account' }, 409));
    render(<LeakCheckPanel accountId={A} accountLabel="Platform" />);
    run();
    const notice = await screen.findByTestId('leak-platform-account');
    expect(notice.textContent).toBe(COSTS_PLATFORM_ACCOUNT);
    expect(screen.queryByTestId('leak-error')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('platform_account')).toBeNull();
  });

  it('L-4: status chips by tone with their words, number cells in tabular figures, the table named, no slate-500', async () => {
    const C = '33333333-3333-4333-8333-333333333333';
    const D = '44444444-4444-4444-8444-444444444444';
    fetchMock.mockImplementation(() =>
      respond({
        success: true,
        data: payload({
          accounts: [
            finding(),
            finding({ accountId: B, companyName: 'Beta', status: 'could_not_check', reasons: ['usage_read_failed'] }),
            finding({ accountId: C, companyName: 'Gamma', status: 'incomplete' }),
            finding({ accountId: D, companyName: 'Delta', status: 'clean' }),
          ],
        }),
      })
    );
    const { container } = render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    const table = await screen.findByRole('table', { name: 'Leak check by business' });
    expect(table).toHaveAttribute('data-testid', 'leak-accounts');

    const expected: Array<[string, keyof typeof LEAK_STATUS_TEXT, string]> = [
      [A, 'leak', 'danger'],
      [B, 'could_not_check', 'unknown'],
      [C, 'incomplete', 'warn'],
      [D, 'clean', 'neutral'],
    ];
    for (const [id, status, tone] of expected) {
      const row = screen.getByTestId(`leak-account-${id}`);
      const chip = within(row).getByTestId('leak-status');
      expect(chip.textContent).toBe(LEAK_STATUS_TEXT[status]);
      expect(chip).toHaveAttribute('data-tone', tone);
      // §5.9 / A-7: every meaning tone carries its icon; only neutral has none.
      expect(chip.querySelector('svg') !== null).toBe(tone !== 'neutral');

      const cells = row.querySelectorAll('td');
      expect(cells).toHaveLength(9);
      for (const cell of Array.from(cells).slice(3)) {
        expect(cell.className).toContain('tabular-nums');
        expect(cell.className).toContain('text-right');
        expect(cell.className).not.toContain('font-mono');
      }
    }
    expect(container.querySelector('[class*="text-slate-500"]')).toBeNull();
  });
});

// ── Money MK-3a (§4.2, §5, SA-Q-MK3-5, T-6): the Leak check's block KPI ─────────
// A separate import, so the lines above stay unedited.
import { unchargedBusinessesKpi } from '../components/costs/LeakCheckPanel';
import {
  LEAK_KPI_COULD_NOT_CHECK,
  LEAK_KPI_DEFINITION,
  LEAK_KPI_LABEL,
  LEAK_KPI_NOT_ALL_CHECKED,
  LEAK_KPI_NOT_RUN,
  LEAK_KPI_UNKNOWN,
} from '../leakCopy';

const valueOf = (result: LeakCheckPayload | null, failed = false) => unchargedBusinessesKpi(result, failed).value;

describe('MK-3a: the block KPI "Businesses with uncharged calls"', () => {
  const box = () => screen.getByTestId('leak-kpi-uncharged-kpi');

  it('heads the panel on the shared BlockKpi with its leading pill; "Not run yet" before a run, and no read on mount', () => {
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    expect(box()).toHaveAttribute('role', 'group');
    expect(box()).toHaveAttribute('aria-label', `${LEAK_KPI_LABEL}, ${LEAK_KPI_NOT_RUN}`);
    expect(box()).toHaveTextContent('Leading');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(LEAK_KPI_DEFINITION).toMatch(/never counted/);
  });

  it('after a run: the count of businesses with an uncharged call', async () => {
    fetchMock.mockImplementation(() =>
      respond({
        success: true,
        data: payload({
          accounts: [
            finding(),
            finding({ accountId: B, companyName: 'Beta', counts: { ...finding().counts, uncharged: 3 } }),
            // Undercharged only: charged, so not counted (SA-Q-MK3-5).
            finding({ accountId: G1, companyName: 'Gamma', status: 'leak', counts: { ...finding().counts, uncharged: 0, undercharged: 2 } }),
          ],
        }),
      })
    );
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    await waitFor(() => expect(screen.getByTestId('leak-kpi-uncharged')).toHaveTextContent('2'));
    expect(box()).toHaveAttribute('aria-label', `${LEAK_KPI_LABEL}, 2`);
  });

  it('platform calls are reported apart and never counted as a business', () => {
    const value = valueOf(payload({ accounts: [], platform: { businessOsCalls: 40, helperLabelCalls: 5, envIgnored: false } }));
    expect(value).toBe('0');
  });

  it.each([
    ['an incomplete account', { accountsIncomplete: 1 }],
    ['an account that could not be checked', { accountsNotChecked: 1 }],
    ['accounts left', { accountsRemaining: 3 }],
    ['the deadline', { deadlineReached: true }],
    ['a failed listing', { listingFailed: true }],
  ] as const)('"At least" when the run may have missed a business and found one: %s', (_name, over) => {
    expect(unchargedBusinessesKpi(payload(over), false)).toEqual({ value: 'At least 1', chip: null });
  });

  it('exact when the run saw every business', () => {
    expect(unchargedBusinessesKpi(payload(), false)).toEqual({ value: '1', chip: null });
    expect(valueOf(null)).toBe(LEAK_KPI_NOT_RUN);
  });

  // QA B-1: "At least 0" reads as "none found"; a run that may have missed businesses and found none
  // says Unknown, with a chip in words.
  it.each([
    ['a failed listing', { listingFailed: true }],
    ['the deadline', { deadlineReached: true }],
    ['accounts left', { accountsRemaining: 30 }],
  ] as const)('B-1: %s with no findings → Unknown and the chip, never "At least 0"', (_name, over) => {
    expect(unchargedBusinessesKpi(payload({ ...over, accounts: [] }), false)).toEqual({
      value: LEAK_KPI_UNKNOWN,
      chip: { tone: 'warn', label: LEAK_KPI_NOT_ALL_CHECKED },
    });
  });

  it('B-1 (render): the box shows Unknown and the chip after such a run', async () => {
    fetchMock.mockImplementation(() => respond({ success: true, data: payload({ listingFailed: true, accounts: [] }) }));
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    run();
    await waitFor(() => expect(screen.getByTestId('leak-kpi-uncharged')).toHaveTextContent(LEAK_KPI_UNKNOWN));
    expect(screen.getByTestId('leak-kpi-uncharged-chip')).toHaveTextContent(LEAK_KPI_NOT_ALL_CHECKED);
    expect(box()).not.toHaveTextContent('At least 0');
  });

  it('B-1: a complete run that found none is an exact 0, with no chip', () => {
    expect(unchargedBusinessesKpi(payload({ accounts: [] }), false)).toEqual({ value: '0', chip: null });
  });

  // QA B-2: the run was tried and failed, so it is not "Not run yet".
  it('B-2: after a failed run the box says "Could not check"; before any run, "Not run yet"', async () => {
    expect(unchargedBusinessesKpi(null, true)).toEqual({ value: LEAK_KPI_COULD_NOT_CHECK, chip: null });
    fetchMock.mockImplementation(() => respond({ success: false, error: 'The leak check failed' }, 500));
    render(<LeakCheckPanel accountId="" accountLabel={null} />);
    expect(box()).toHaveAttribute('aria-label', `${LEAK_KPI_LABEL}, ${LEAK_KPI_NOT_RUN}`);
    run();
    await screen.findByTestId('leak-error');
    expect(box()).toHaveAttribute('aria-label', `${LEAK_KPI_LABEL}, ${LEAK_KPI_COULD_NOT_CHECK}`);
  });
});
