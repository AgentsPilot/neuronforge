/**
 * @jest-environment jsdom
 *
 * Money M-4 (OV-5, T9-B): Section 3's recorded block and the one renderer of
 * "Recorded above charged". Every state in words (M4-FR-3), the Leak check
 * link (SA-W99), the block outside Section 3's figures guard (SA-W98), the
 * notice on a failed read (AC-161), the deleted-accounts sentence with all
 * businesses only (R4-4), the stated distortions (R4-10), and no element
 * showing the sum of the two measures (AC-154, R4-11).
 */

import '@testing-library/jest-dom';
import { cleanup, render, screen, within } from '@testing-library/react';

import type { FinanceAiCostSection, FinanceRecordedAiCost, FinanceWindowInfo } from '@/lib/business-os/finance/financeTypes';
import { AiCostSection } from '../components/AiCostSection';
import { RecordedAboveValue, RecordedCostLines } from '../components/RecordedCostLines';
import {
  ABOVE_LABEL,
  ABOVE_LEAK_LINK,
  ABOVE_NONE,
  ABOVE_NOT_AVAILABLE,
  ABOVE_SOURCE,
  aboveChargedAboveLine,
  RECORDED_CAPTION,
  RECORDED_DELETED_NOTE,
  RECORDED_DISTORTIONS,
  RECORDED_LABEL,
  RECORDED_NOTICE,
  RECORDED_NOTICE_PLAIN,
  RECORDED_SOURCE,
  RECORDED_UNKNOWN,
} from '../financeCopy';

const A = '11111111-1111-4111-8111-111111111111';
const WINDOW: FinanceWindowInfo = { preset: 'this_month', from: '2026-10-01', to: '2026-10-14', start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z' };

function recorded(extra: Partial<FinanceRecordedAiCost> = {}): FinanceRecordedAiCost {
  return { status: 'ok', recordedUsd: 1.94, recordedExact: true, aboveCharged: { state: 'figure', usd: 0.33 }, chargedAboveUsd: null, ...extra };
}

function aiCost(extra: Partial<FinanceAiCostSection> = {}): FinanceAiCostSection {
  return {
    status: 'ok',
    coverage: 'after_cutover',
    figures: {
      exact: true, costUsd: 1.61, credits: 120, chargedActions: 10, rows: 11,
      byTrigger: [{ trigger: 'owner', costUsd: 1.61, credits: 120, rows: 11 }],
      byGroup: { status: 'ok', lines: [] }, topAccounts: [], deleted: { costUsd: 0, credits: 0, rows: 0 },
      unreadableAmounts: 0, unresolvedAdjustments: 0,
    },
    recorded: recorded(),
    ...extra,
  };
}

const renderSection = (section: FinanceAiCostSection, accountId: string | null = null) =>
  render(<AiCostSection aiCost={section} accountId={accountId} window={WINDOW} windowLabel="This month" onRetry={() => undefined} />);

afterEach(cleanup);

describe('the block (M4-FR-1)', () => {
  it('both lines beside the charged total, with their labels, sub-labels and caption; no element is their sum (AC-154)', () => {
    renderSection(aiCost());
    const block = screen.getByTestId('ai-recorded');
    expect(within(block).getByText(RECORDED_CAPTION)).toBeInTheDocument();
    expect(within(block).getByText(RECORDED_LABEL)).toBeInTheDocument();
    expect(within(block).getByText(RECORDED_SOURCE)).toBeInTheDocument();
    expect(within(block).getByText(ABOVE_LABEL)).toBeInTheDocument();
    expect(block).toHaveTextContent(ABOVE_SOURCE);
    expect(screen.getByTestId('ai-recorded-total')).toHaveTextContent('USD 1.94');
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent('USD 0.33');
    expect(screen.getByTestId('ai-total')).toHaveTextContent('USD 1.61');
    // Directly under the charged total, before the breakdown tables.
    expect(screen.getByTestId('ai-total').compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).not.toContain('3.55');
  });

  it('SA-W99 / M-5 R-4: the Leak check link opens Charge checks; with a business picked it carries the account; never a window', () => {
    renderSection(aiCost());
    const link = screen.getByTestId('ai-recorded-leak-link');
    expect(link).toHaveTextContent(ABOVE_LEAK_LINK);
    expect(link).toHaveAttribute('href', '/admin/finance/charges');
    cleanup();
    renderSection(aiCost(), A);
    expect(screen.getByTestId('ai-recorded-leak-link')).toHaveAttribute('href', `/admin/finance/charges?account=${A}`);
    // The existing AI calls & usage link stays and keeps the window.
    expect(screen.getByTestId('ai-analytics-link').getAttribute('href')).toContain('range=this_month');
  });

  it('R4-4: the deleted-accounts sentence with all businesses only; R4-10: the stated distortions, one each', () => {
    renderSection(aiCost());
    expect(screen.getByTestId('ai-recorded-deleted-note')).toHaveTextContent(RECORDED_DELETED_NOTE);
    const items = within(screen.getByTestId('ai-recorded-distortions')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([...RECORDED_DISTORTIONS]);
    expect(RECORDED_DISTORTIONS[RECORDED_DISTORTIONS.length - 1]).toBe("Recorded above charged is not 'not charged' call by call; the Leak check matches calls.");
    cleanup();
    renderSection(aiCost(), A);
    expect(screen.queryByTestId('ai-recorded-deleted-note')).toBeNull();
  });

  it('absent when the payload has no recorded key (the Accounts tab), in every Section 3 state', () => {
    renderSection(aiCost({ recorded: undefined }));
    expect(screen.queryByTestId('ai-recorded')).toBeNull();
    expect(screen.getByTestId('ai-total')).toBeInTheDocument();
    cleanup();
    renderSection(aiCost({ recorded: undefined, status: 'unknown', figures: null }));
    expect(screen.queryByTestId('ai-recorded')).toBeNull();
  });

  it('rendered exactly once when Section 3 loaded (never twice through the unknown slot)', () => {
    renderSection(aiCost());
    expect(screen.getAllByTestId('ai-recorded')).toHaveLength(1);
    cleanup();
    renderSection(aiCost({ status: 'partial' }));
    expect(screen.getAllByTestId('ai-recorded')).toHaveLength(1);
  });
});

describe('the states (M4-FR-3)', () => {
  it('AC-160 / AC-168: "At least" on the recorded figure, Unknown on the difference', () => {
    render(<RecordedCostLines recorded={recorded({ status: 'partial', recordedExact: false, aboveCharged: { state: 'unknown', usd: null } })} accountId={null} chargedShown />);
    expect(screen.getByTestId('ai-recorded-total')).toHaveTextContent('At least USD 1.94');
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent(RECORDED_UNKNOWN);
    expect(screen.queryByTestId('ai-recorded-notice')).toBeNull();
  });

  it('AC-161: a failed read → both Unknown with the notice; never 0', () => {
    render(<RecordedCostLines recorded={{ status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null }} accountId={null} chargedShown />);
    expect(screen.getByTestId('ai-recorded-total')).toHaveTextContent(RECORDED_UNKNOWN);
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent(RECORDED_UNKNOWN);
    expect(screen.getByTestId('ai-recorded-notice')).toHaveTextContent(RECORDED_NOTICE);
    for (const id of ['ai-recorded-total', 'ai-recorded-above']) expect(screen.getByTestId(id).textContent).not.toMatch(/\d/);
  });
});

describe('fix round 1: the failure notice names "the charged figures above" only when they rendered', () => {
  const FAILED: FinanceRecordedAiCost = { status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null };

  it('the charged figures rendered → the notice says they are unaffected', () => {
    renderSection(aiCost({ recorded: FAILED }));
    expect(screen.getByTestId('ai-total')).toBeInTheDocument();
    expect(screen.getByTestId('ai-recorded-notice').textContent).toBe(RECORDED_NOTICE);
  });

  it('the charged read also failed → the plain notice, with no reference to figures above', () => {
    renderSection(aiCost({ status: 'unknown', figures: null, recorded: FAILED }));
    expect(screen.queryByTestId('ai-total')).toBeNull();
    const notice = screen.getByTestId('ai-recorded-notice');
    expect(notice.textContent).toBe(RECORDED_NOTICE_PLAIN);
    expect(notice.textContent).not.toMatch(/above|unaffected/);
  });

  it('a window entirely before the cut-over (no charged figure shown) → the plain notice too', () => {
    renderSection(aiCost({ coverage: 'entirely_before_cutover', recorded: FAILED }));
    expect(screen.queryByTestId('ai-total')).toBeNull();
    expect(screen.getByTestId('ai-recorded-notice').textContent).toBe(RECORDED_NOTICE_PLAIN);
  });

  it('R4-6: "None", and the charged-above line only when charged is strictly above', () => {
    render(<RecordedAboveValue recorded={recorded({ aboveCharged: { state: 'none', usd: null }, chargedAboveUsd: 0.25 })} testId="v" />);
    expect(screen.getByTestId('v')).toHaveTextContent(`${ABOVE_NONE}${aboveChargedAboveLine('USD 0.25')}`);
    expect(aboveChargedAboveLine('USD 0.25')).toBe('Charged is USD 0.25 above recorded (fallback prices or corrections)');
    cleanup();
    render(<RecordedAboveValue recorded={recorded({ aboveCharged: { state: 'none', usd: null }, chargedAboveUsd: null })} testId="v" />);
    expect(screen.getByTestId('v').textContent).toBe(ABOVE_NONE);
  });

  it('AC-159: "Not available: AI charging began 29 Sep 2026"', () => {
    render(<RecordedAboveValue recorded={recorded({ aboveCharged: { state: 'not_available', usd: null } })} testId="v" />);
    expect(screen.getByTestId('v')).toHaveTextContent(ABOVE_NOT_AVAILABLE);
    expect(ABOVE_NOT_AVAILABLE).toBe('Not available: AI charging began 29 Sep 2026');
  });
});

describe('SA-W98: the block is outside Section 3’s figures guard', () => {
  it('a window entirely before the cut-over: no charged figure, but the recorded block shows with "Not available"', () => {
    renderSection(aiCost({ coverage: 'entirely_before_cutover', recorded: recorded({ aboveCharged: { state: 'not_available', usd: null } }) }));
    expect(screen.queryByTestId('ai-total')).toBeNull();
    expect(screen.getByTestId('ai-recorded-total')).toHaveTextContent('USD 1.94');
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent(ABOVE_NOT_AVAILABLE);
  });

  it('Section 3 could not load (figures null): the recorded block still shows, the difference Unknown', () => {
    renderSection(aiCost({ status: 'unknown', figures: null, recorded: recorded({ status: 'partial', aboveCharged: { state: 'unknown', usd: null } }) }));
    expect(screen.queryByTestId('ai-total')).toBeNull();
    expect(screen.getByTestId('section-ai-cost')).toHaveTextContent('Could not load this section');
    expect(screen.getAllByTestId('ai-recorded')).toHaveLength(1);
    expect(screen.getByTestId('ai-recorded-total')).toHaveTextContent('USD 1.94');
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent(RECORDED_UNKNOWN);
  });
});
