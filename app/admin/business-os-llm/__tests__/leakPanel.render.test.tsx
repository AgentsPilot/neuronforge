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

import { LeakCheckPanel } from '../components/costs/LeakCheckPanel';
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
