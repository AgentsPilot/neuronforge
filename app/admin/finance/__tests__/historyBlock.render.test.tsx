/**
 * @jest-environment jsdom
 *
 * Finance slice 8.3: the History block's states (HS-FR-11 to HS-FR-16, E-100,
 * E-101; AC-288, AC-289, AC-291, AC-292). The view is the server's; the block
 * only formats it.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import type { FinanceHistoryView } from '@/lib/business-os/finance/historyView';
import { HistoryAllBusinessesLine, HistoryBlock } from '../components/HistoryBlock';
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
async function openBlock() {
  render(<HistoryBlock query={QUERY} />);
  fireEvent.click(screen.getByTestId('history-toggle'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('closed (E-85)', () => {
  it('a heading, the subtitle, a "Show history" button, no status chip and no request', () => {
    serve({ success: true, data: READY });
    render(<HistoryBlock query={QUERY} />);
    const block = screen.getByTestId('section-history');
    expect(within(block).getByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(block).toHaveTextContent(HISTORY_SUBTITLE);
    expect(screen.getByTestId('history-toggle')).toHaveTextContent('Show history');
    expect(screen.getByTestId('history-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('section-history-status')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('open (AC-288, AC-289, AC-291)', () => {
  it('ready: the start line, "Weekly points", the cells as words, gaps across the row, the change line, a stale tier flagged', async () => {
    serve({ success: true, data: READY });
    await openBlock();
    expect(screen.getByTestId('history-toggle')).toHaveTextContent('Hide history');
    expect(screen.getByTestId('history-start-line')).toHaveTextContent('History starts on 2026-10-01 (UTC).');
    expect(screen.getByTestId('history-weekly')).toHaveTextContent('Weekly points');
    const plan = screen.getByTestId('history-plan-mix');
    expect(within(plan).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Trial', 'tier:retired-plan (no longer configured)', 'Total']);
    expect(screen.getByTestId('history-plan-mix-row-2026-10-16')).toHaveTextContent('Not recorded');
    expect(screen.getByTestId('history-plan-mix-row-2026-10-16')).toHaveTextContent('1,200');
    expect(screen.getByTestId('history-plan-mix-row-2026-10-09')).toHaveTextContent('No snapshot');
    expect(screen.getByTestId('history-plan-mix-change')).toHaveTextContent('Change in this window+2Not available+200');
    expect(screen.getByTestId('section-history-status')).toBeInTheDocument();
    // Never a 0 for a missing figure.
    expect(screen.getByTestId('history-plan-mix-row-2026-10-16').textContent).not.toMatch(/(^|\D)0(\D|$)/);
  });

  it('no history (E-101): the every-night sentence', async () => {
    serve({ success: true, data: { ...READY, state: 'no_history', firstSnapshotDate: null } });
    await openBlock();
    expect(screen.getByTestId('history-start-line')).toHaveTextContent(HISTORY_NONE_YET);
    expect(screen.queryByTestId('history-plan-mix')).toBeNull();
  });

  it('none in the window: names the first snapshot day', async () => {
    serve({ success: true, data: { ...READY, state: 'none_in_window' } });
    await openBlock();
    expect(screen.getByTestId('history-start-line')).toHaveTextContent('No snapshot in this window. History starts on 2026-10-01 (UTC).');
  });

  it('E-100 not installed: the calm notice, no error and no Try again', async () => {
    serve({ success: true, data: { ...READY, state: 'not_installed', firstSnapshotDate: null } });
    await openBlock();
    expect(screen.getByTestId('history-not-installed')).toHaveTextContent(HISTORY_NOT_INSTALLED);
    expect(screen.queryByTestId('history-error')).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('AC-292: a failed read is the block’s own error with Try again, which re-sends', async () => {
    serve({ success: false, error: 'Could not read the finance history.' }, 500);
    await openBlock();
    expect(screen.getByTestId('history-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('closing again sends nothing more', async () => {
    serve({ success: true, data: READY });
    await openBlock();
    fireEvent.click(screen.getByTestId('history-toggle'));
    expect(screen.queryByTestId('history-body')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
