/**
 * @jest-environment jsdom
 *
 * Finance slice 8.3: the History states (HS-FR-11 to HS-FR-16, E-100,
 * E-101; AC-288, AC-289, AC-291, AC-292). The view is the server's; the trends
 * only format it.
 *
 * Money MK-7 (§6 item 13): the one History block is split into two trends, the
 * plan mix under Plan mix and the credits under Credits, sharing ONE lazy read
 * (`FinanceHistoryProvider`). Every 8.3 state is checked on a trend; the MK-7
 * cases add the shared read (two open trends, one request) and the split.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import type { FinanceHistoryView } from '@/lib/business-os/finance/historyView';
import { HistoryAllBusinessesLine } from '../components/HistoryBlock';
import { FinanceHistoryProvider, HistoryTrend } from '../components/HistoryTrends';
import { FinanceSection } from '../components/FinanceSection';
import {
  HISTORY_ALL_BUSINESSES_ONLY,
  HISTORY_NONE_YET,
  HISTORY_NOT_INSTALLED,
  HISTORY_SUBTITLE,
} from '../financeCopy';

const QUERY = { preset: 'this_month' as const, from: null, to: null };

const READY: FinanceHistoryView = {
  window: { from: '2026-09-01', to: '2026-10-17' },
  firstSnapshotDate: '2026-10-01',
  state: 'ready',
  weekly: true,
  planMix: {
    columns: [
      { id: 'group', key: 'trial', tierLabel: null, noLongerConfigured: false },
      { id: 'group', key: 'tier:retired-plan', tierLabel: null, noLongerConfigured: true },
      { id: 'accounts_total', unit: 'accounts' },
    ],
    points: [
      { date: '2026-10-16', kind: 'snapshot', cells: [{ kind: 'value', value: 3 }, { kind: 'not_recorded' }, { kind: 'value', value: 1200 }] },
      { date: '2026-10-09', kind: 'no_snapshot' },
      { date: '2026-10-02', kind: 'snapshot', cells: [{ kind: 'value', value: 1 }, { kind: 'value', value: 0 }, { kind: 'value', value: 1000 }] },
    ],
    change: [{ kind: 'value', value: 2 }, { kind: 'not_available' }, { kind: 'value', value: 200 }],
  },
  credits: {
    columns: [{ id: 'credit_used', unit: 'credits' }],
    points: [{ date: '2026-10-16', kind: 'snapshot', cells: [{ kind: 'value', value: 12.5 }] }],
    change: [{ kind: 'not_available' }],
  },
};

let fetchMock: jest.Mock;
function serve(body: unknown, status = 200) {
  fetchMock = jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

/** Both trends, as the page hosts them: each in its own block, one provider. */
function renderTrends() {
  return render(
    <FinanceHistoryProvider query={QUERY}>
      <div data-testid="plan-mix-host">
        <HistoryTrend trend="planMix" />
      </div>
      <div data-testid="credits-host">
        <HistoryTrend trend="credits" />
      </div>
    </FinanceHistoryProvider>
  );
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
async function openPlanMix() {
  renderTrends();
  fireEvent.click(screen.getByTestId('history-plan-mix-toggle'));
  await settle();
}

describe('closed (E-85)', () => {
  it('each trend: a "History" heading, the subtitle, a "Show history" button, and no request', () => {
    serve({ success: true, data: READY });
    renderTrends();
    for (const id of ['history-plan-mix', 'history-credits']) {
      const trend = screen.getByTestId(`${id}-trend`);
      expect(within(trend).getByRole('heading', { name: 'History' })).toBeInTheDocument();
      expect(trend).toHaveTextContent(HISTORY_SUBTITLE);
      expect(screen.getByTestId(`${id}-toggle`)).toHaveTextContent('Show history');
      expect(screen.getByTestId(`${id}-toggle`)).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByTestId('section-history')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('open (AC-288, AC-289, AC-291)', () => {
  it('ready: the start line, "Weekly points", the cells as words, gaps across the row, the change line, a stale tier flagged', async () => {
    serve({ success: true, data: READY });
    await openPlanMix();
    expect(screen.getByTestId('history-plan-mix-toggle')).toHaveTextContent('Hide history');
    expect(screen.getByTestId('history-plan-mix-start-line')).toHaveTextContent('History starts on 2026-10-01 (UTC).');
    expect(screen.getByTestId('history-plan-mix-weekly')).toHaveTextContent('Weekly points');
    const plan = screen.getByTestId('history-plan-mix');
    expect(within(plan).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Trial', 'tier:retired-plan (no longer configured)', 'Total']);
    expect(screen.getByTestId('history-plan-mix-row-2026-10-16')).toHaveTextContent('Not recorded');
    expect(screen.getByTestId('history-plan-mix-row-2026-10-16')).toHaveTextContent('1,200');
    expect(screen.getByTestId('history-plan-mix-row-2026-10-09')).toHaveTextContent('No snapshot');
    expect(screen.getByTestId('history-plan-mix-change')).toHaveTextContent('Change in this window+2Not available+200');
    // Never a 0 for a missing figure.
    expect(screen.getByTestId('history-plan-mix-row-2026-10-16').textContent).not.toMatch(/(^|\D)0(\D|$)/);
    // MK-7: the plan-mix trend shows its table only; the credits trend is still closed.
    expect(screen.queryByTestId('history-credits')).toBeNull();
  });

  it('no history (E-101): the every-night sentence', async () => {
    serve({ success: true, data: { ...READY, state: 'no_history', firstSnapshotDate: null } });
    await openPlanMix();
    expect(screen.getByTestId('history-plan-mix-start-line')).toHaveTextContent(HISTORY_NONE_YET);
    expect(screen.queryByTestId('history-plan-mix')).toBeNull();
  });

  it('none in the window: names the first snapshot day', async () => {
    serve({ success: true, data: { ...READY, state: 'none_in_window' } });
    await openPlanMix();
    expect(screen.getByTestId('history-plan-mix-start-line')).toHaveTextContent('No snapshot in this window. History starts on 2026-10-01 (UTC).');
  });

  it('E-100 not installed: the calm notice, no error and no Try again', async () => {
    serve({ success: true, data: { ...READY, state: 'not_installed', firstSnapshotDate: null } });
    await openPlanMix();
    expect(screen.getByTestId('history-plan-mix-not-installed')).toHaveTextContent(HISTORY_NOT_INSTALLED);
    expect(screen.queryByTestId('history-plan-mix-error')).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('AC-292: a failed read is the trend’s own error with Try again, which re-sends', async () => {
    serve({ success: false, error: 'Could not read the finance history.' }, 500);
    await openPlanMix();
    expect(screen.getByTestId('history-plan-mix-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('closing again sends nothing more', async () => {
    serve({ success: true, data: READY });
    await openPlanMix();
    fireEvent.click(screen.getByTestId('history-plan-mix-toggle'));
    expect(screen.queryByTestId('history-plan-mix-trend-body')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('MK-7: two trends, one shared read', () => {
  it('opening the credits trend too sends no second request; each trend shows its own table', async () => {
    serve({ success: true, data: READY });
    await openPlanMix();
    fireEvent.click(screen.getByTestId('history-credits-toggle'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId('plan-mix-host')).getByTestId('history-plan-mix')).toBeInTheDocument();
    expect(within(screen.getByTestId('plan-mix-host')).queryByTestId('history-credits')).toBeNull();
    const credits = within(screen.getByTestId('credits-host'));
    expect(credits.getByTestId('history-credits')).toBeInTheDocument();
    expect(credits.queryByTestId('history-plan-mix')).toBeNull();
    expect(credits.getByTestId('history-credits-start-line')).toHaveTextContent('History starts on 2026-10-01 (UTC).');
  });

  it('closing one trend while the other stays open sends nothing; closing both and reopening reads again', async () => {
    serve({ success: true, data: READY });
    await openPlanMix();
    fireEvent.click(screen.getByTestId('history-credits-toggle'));
    await settle();
    fireEvent.click(screen.getByTestId('history-plan-mix-toggle'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('history-credits-toggle'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('history-credits-toggle'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('with a business picked (HS-FR-11)', () => {
  it('only the one line', () => {
    render(<HistoryAllBusinessesLine />);
    expect(screen.getByTestId('history-all-businesses-only')).toHaveTextContent(HISTORY_ALL_BUSINESSES_ONLY);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FinanceSection statusChip (SA-W-8.3-2)', () => {
  it('defaults to the chip; false hides only the chip', () => {
    const { rerender } = render(<FinanceSection id="x" title="T" subtitle="S" status="ok" onRetry={jest.fn()} />);
    expect(screen.getByTestId('section-x-status')).toBeInTheDocument();
    rerender(<FinanceSection id="x" title="T" subtitle="S" status="ok" onRetry={jest.fn()} statusChip={false} />);
    expect(screen.queryByTestId('section-x-status')).toBeNull();
    expect(screen.getByTestId('section-x')).toHaveTextContent('T');
  });
});
