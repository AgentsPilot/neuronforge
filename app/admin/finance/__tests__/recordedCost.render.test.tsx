/**
 * @jest-environment jsdom
 *
 * Money M-4 (OV-5, T9-B): Section 3's recorded AI cost and the one renderer of
 * "Recorded above charged".
 *
 * Money MK-3a (C-7, ruled update): the full recorded block (the recorded
 * figure, its source, the notices, the deleted-accounts sentence and the
 * stated distortions) moved to the AI cost page; its cases moved with it, to
 * `app/admin/business-os-llm/__tests__/recordedSection.render.test.tsx`.
 * Finance keeps ONE line, "Recorded above charged", which links to the AI cost
 * page's recorded block and Leak check on the same window. What this file
 * still proves on Finance: the line's value in every state (M4-FR-3), its link,
 * that it sits outside Section 3's figures guard (SA-W98), that it is absent
 * on the Accounts tab, that it is never the sum of the two measures (AC-154),
 * and that the moved block's parts are gone from Finance.
 */

import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';

import type { FinanceAiCostSection, FinanceRecordedAiCost, FinanceWindowInfo } from '@/lib/business-os/finance/financeTypes';
import { AiCostSection } from '../components/AiCostSection';
import { RecordedAboveValue } from '../components/RecordedCostLines';
import {
  ABOVE_NONE,
  ABOVE_NOT_AVAILABLE,
  ACCOUNT_RECORDED_ABOVE,
  aboveChargedAboveLine,
  RECORDED_ON_AI_COST_LINK,
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

const FAILED: FinanceRecordedAiCost = { status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null };

const renderSection = (section: FinanceAiCostSection, accountId: string | null = null) =>
  render(<AiCostSection aiCost={section} accountId={accountId} window={WINDOW} windowLabel="This month" onRetry={() => undefined} />);

afterEach(cleanup);

describe('MK-3a (C-7): Section 3 keeps one line, "Recorded above charged"', () => {
  it('the line under the charged total, with its label and value; no element is the sum of the two (AC-154)', () => {
    renderSection(aiCost());
    const line = screen.getByTestId('ai-recorded');
    expect(line).toHaveTextContent(ACCOUNT_RECORDED_ABOVE);
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent('$0.33');
    expect(screen.getByTestId('ai-total')).toHaveTextContent('$1.61');
    expect(screen.getByTestId('ai-total').compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).not.toContain('3.55');
  });

  it('the moved block is gone from Finance: no recorded figure, notice, deleted sentence or distortions', () => {
    renderSection(aiCost({ recorded: FAILED }));
    for (const id of ['ai-recorded-total', 'ai-recorded-notice', 'ai-recorded-deleted-note', 'ai-recorded-distortions', 'ai-recorded-leak-link']) {
      expect({ id, present: screen.queryByTestId(id) !== null }).toEqual({ id, present: false });
    }
    // The recorded figure itself ($1.94 in the default fixture) is shown on the AI cost page, not here.
    cleanup();
    renderSection(aiCost());
    expect(document.body.textContent).not.toContain('1.94');
  });

  it('the link opens the AI cost page at the recorded block and Leak check, on the same window, with the business when picked', () => {
    renderSection(aiCost());
    const link = screen.getByTestId('ai-recorded-link');
    expect(link).toHaveTextContent(RECORDED_ON_AI_COST_LINK);
    expect(link).toHaveAttribute('href', '/admin/ai-cost?tab=checks&range=this_month#costs-leak');
    cleanup();
    renderSection(aiCost(), A);
    expect(screen.getByTestId('ai-recorded-link')).toHaveAttribute('href', `/admin/ai-cost?tab=checks&range=this_month&account=${A}#costs-leak`);
    // The existing AI calls & usage link stays and keeps the window.
    expect(screen.getByTestId('ai-analytics-link').getAttribute('href')).toContain('range=this_month');
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

describe('the value in every state (M4-FR-3)', () => {
  it('AC-168: Unknown on the difference; a failed read never shows a 0', () => {
    renderSection(aiCost({ recorded: FAILED }));
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent(RECORDED_UNKNOWN);
    expect(screen.getByTestId('ai-recorded-above').textContent).not.toMatch(/\d/);
  });

  it('R4-6: "None", and the charged-above line only when charged is strictly above', () => {
    render(<RecordedAboveValue recorded={recorded({ aboveCharged: { state: 'none', usd: null }, chargedAboveUsd: 0.25 })} testId="v" />);
    expect(screen.getByTestId('v')).toHaveTextContent(`${ABOVE_NONE}${aboveChargedAboveLine('$0.25')}`);
    expect(aboveChargedAboveLine('$0.25')).toBe('Charged is $0.25 above recorded (fallback prices or corrections)');
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

describe('SA-W98: the line is outside Section 3’s figures guard', () => {
  it('a window entirely before the cut-over: no charged figure, but the line shows with "Not available"', () => {
    renderSection(aiCost({ coverage: 'entirely_before_cutover', recorded: recorded({ aboveCharged: { state: 'not_available', usd: null } }) }));
    expect(screen.queryByTestId('ai-total')).toBeNull();
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent(ABOVE_NOT_AVAILABLE);
  });

  it('Section 3 could not load (figures null): the line still shows, the difference Unknown', () => {
    renderSection(aiCost({ status: 'unknown', figures: null, recorded: recorded({ status: 'partial', aboveCharged: { state: 'unknown', usd: null } }) }));
    expect(screen.queryByTestId('ai-total')).toBeNull();
    expect(screen.getByTestId('section-ai-cost')).toHaveTextContent('Could not load this section');
    expect(screen.getAllByTestId('ai-recorded')).toHaveLength(1);
    expect(screen.getByTestId('ai-recorded-above')).toHaveTextContent(RECORDED_UNKNOWN);
  });
});
