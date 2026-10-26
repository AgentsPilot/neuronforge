/**
 * @jest-environment jsdom
 *
 * Money MK-3a (C-7, T-7): the recorded AI cost block on the AI cost page's
 * Summary & checks tab, moved from Finance's Section 3 (Money M-4). The cases
 * moved with it from `app/admin/finance/__tests__/recordedCost.render.test.tsx`:
 * both measures beside each other and never their sum (AC-154), every state
 * in words (M4-FR-3), the notice on a failed read (AC-161), the deleted-accounts
 * sentence with all businesses only (R4-4), the stated distortions (R4-10).
 * The block sits with the Leak check under `#costs-leak`, A-K3's target.
 */

import '@testing-library/jest-dom';
import { cleanup, render, screen, within } from '@testing-library/react';

import { RecordedSection } from '../components/costs/RecordedSection';
import {
  ABOVE_LABEL,
  ABOVE_SOURCE,
  chargedAboveLine,
  KPI_ABOVE_NONE,
  KPI_ABOVE_NOT_AVAILABLE,
  KPI_UNKNOWN,
  RECORDED_CAPTION,
  RECORDED_DELETED_NOTE,
  RECORDED_DISTORTIONS,
  RECORDED_LABEL,
  RECORDED_NOTICE,
  RECORDED_SOURCE,
} from '../costCopy';
import type { CostRecordedInWindow } from '../costTypes';

const A = '11111111-1111-4111-8111-111111111111';

function recorded(extra: Partial<CostRecordedInWindow> = {}): CostRecordedInWindow {
  return { status: 'ok', recordedUsd: 1.94, recordedExact: true, aboveCharged: { state: 'figure', usd: 0.33 }, chargedAboveUsd: null, ...extra };
}

afterEach(cleanup);

describe('the block (M4-FR-1, moved by C-7)', () => {
  it('both measures with their labels, sources and caption; no element is their sum (AC-154); no "USD " amount', () => {
    render(<RecordedSection recorded={recorded()} accountId={null} />);
    const block = screen.getByTestId('costs-recorded');
    expect(within(block).getByText(RECORDED_CAPTION)).toBeInTheDocument();
    expect(within(block).getByText(RECORDED_LABEL)).toBeInTheDocument();
    expect(within(block).getByText(RECORDED_SOURCE)).toBeInTheDocument();
    expect(within(block).getByText(ABOVE_LABEL)).toBeInTheDocument();
    expect(within(block).getByText(ABOVE_SOURCE)).toBeInTheDocument();
    expect(screen.getByTestId('costs-recorded-total')).toHaveTextContent('$1.94');
    expect(screen.getByTestId('costs-recorded-above')).toHaveTextContent('$0.33');
    expect(block.textContent).not.toContain('2.27');
    expect(block.textContent).not.toMatch(/USD -?\d/);
  });

  it('R4-4: the deleted-accounts sentence with all businesses only; R4-10: the stated distortions, one each', () => {
    render(<RecordedSection recorded={recorded()} accountId={null} />);
    expect(screen.getByTestId('costs-recorded-deleted-note')).toHaveTextContent(RECORDED_DELETED_NOTE);
    const items = within(screen.getByTestId('costs-recorded-distortions')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([...RECORDED_DISTORTIONS]);
    expect(RECORDED_DISTORTIONS).toHaveLength(5);
    cleanup();
    render(<RecordedSection recorded={recorded()} accountId={A} />);
    expect(screen.queryByTestId('costs-recorded-deleted-note')).toBeNull();
  });
});

describe('the states (M4-FR-3)', () => {
  it('AC-160 / AC-168: "at least" on the recorded figure, Unknown on the difference, no notice', () => {
    render(<RecordedSection recorded={recorded({ status: 'partial', recordedExact: false, aboveCharged: { state: 'unknown', usd: null } })} accountId={null} />);
    expect(screen.getByTestId('costs-recorded-total')).toHaveTextContent('at least $1.94');
    expect(screen.getByTestId('costs-recorded-above')).toHaveTextContent(KPI_UNKNOWN);
    expect(screen.queryByTestId('costs-recorded-notice')).toBeNull();
  });

  it('AC-161: a failed or late read: both Unknown with the notice; never 0', () => {
    render(
      <RecordedSection
        recorded={{ status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null }}
        accountId={null}
      />
    );
    expect(screen.getByTestId('costs-recorded-total')).toHaveTextContent(KPI_UNKNOWN);
    expect(screen.getByTestId('costs-recorded-above')).toHaveTextContent(KPI_UNKNOWN);
    expect(screen.getByTestId('costs-recorded-notice')).toHaveTextContent(RECORDED_NOTICE);
    for (const id of ['costs-recorded-total', 'costs-recorded-above']) expect(screen.getByTestId(id).textContent).not.toMatch(/\d/);
  });

  it('R4-6: "None", and the charged-above line only when charged is strictly above', () => {
    render(<RecordedSection recorded={recorded({ aboveCharged: { state: 'none', usd: null }, chargedAboveUsd: 0.25 })} accountId={null} />);
    expect(screen.getByTestId('costs-recorded-above')).toHaveTextContent(`${KPI_ABOVE_NONE}${chargedAboveLine('$0.25')}`);
    cleanup();
    render(<RecordedSection recorded={recorded({ aboveCharged: { state: 'none', usd: null }, chargedAboveUsd: null })} accountId={null} />);
    expect(screen.getByTestId('costs-recorded-above').textContent).toBe(KPI_ABOVE_NONE);
  });

  it('R4-5: before the cut-over the recorded figure shows and the difference is "Not available"', () => {
    render(<RecordedSection recorded={recorded({ aboveCharged: { state: 'not_available', usd: null } })} accountId={null} />);
    expect(screen.getByTestId('costs-recorded-total')).toHaveTextContent('$1.94');
    expect(screen.getByTestId('costs-recorded-above')).toHaveTextContent(KPI_ABOVE_NOT_AVAILABLE);
    expect(screen.getByTestId('costs-recorded-above')).toHaveTextContent('AI charging began 29 Sep 2026');
  });
});
