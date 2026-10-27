'use client';

/**
 * Section 3's "Recorded above charged" line, and the one renderer of its
 * value (`RecordedAboveValue`), which the account summary uses too, so the two
 * lines cannot differ (AC-158).
 *
 * Money M-4 (OV-5, §11F.6 M4-FR-1) built a full recorded AI cost block here.
 * Money MK-3a (C-7, KPI restructure review §6 item 11) moved that block to the
 * AI cost page, where both measures are shown: Finance keeps ONE line,
 * "Recorded above charged", which links to the AI cost page's recorded block
 * and Leak check. The figure is still never added to the charged one (BD-18).
 * Every value and state comes from the server (`aiCost.recorded`); this file
 * only formats (M4-FR-11): no addition, subtraction or comparison of money.
 *
 * `AiCostSection` renders the line after the cut-over notice and OUTSIDE its
 * figures guard (SA-W98), so it shows before the cut-over ("Not available")
 * and when Section 3 could not load ("Unknown").
 *
 * @module app/admin/finance/components/RecordedCostLines
 */

import type { FinanceRecordedAiCost } from '@/lib/business-os/finance/financeTypes';
import {
  ABOVE_NONE,
  ABOVE_NOT_AVAILABLE,
  ACCOUNT_RECORDED_ABOVE,
  aboveChargedAboveLine,
  RECORDED_ON_AI_COST_LINK,
  RECORDED_UNKNOWN,
} from '../financeCopy';
import { formatUsd } from '../financeFormat';
import { aiCostRecordedHref, type FinanceLinkWindow } from '../financeLinks';

const NOTE = 'text-[11px] text-slate-400';

/** "Recorded above charged": the figure, "None" (with the charged-above line), "Not available" or "Unknown". */
export function RecordedAboveValue({ recorded, testId }: { recorded: FinanceRecordedAiCost; testId: string }) {
  const above = recorded.aboveCharged;
  if (above.state === 'figure' && above.usd !== null) return <span data-testid={testId}>{formatUsd(above.usd)}</span>;
  if (above.state === 'none') {
    return (
      <span data-testid={testId}>
        {ABOVE_NONE}
        {recorded.chargedAboveUsd !== null && (
          <span className={`block ${NOTE}`}>{aboveChargedAboveLine(formatUsd(recorded.chargedAboveUsd))}</span>
        )}
      </span>
    );
  }
  if (above.state === 'not_available') return <span data-testid={testId}>{ABOVE_NOT_AVAILABLE}</span>;
  return <span data-testid={testId}>{RECORDED_UNKNOWN}</span>;
}

/** MK-3a (C-7): Section 3's one line, linking to the AI cost page's recorded block and Leak check. */
export function RecordedAboveLine({
  recorded,
  accountId,
  window,
}: {
  recorded: FinanceRecordedAiCost;
  accountId: string | null;
  window: FinanceLinkWindow;
}) {
  return (
    <div data-testid="ai-recorded" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-slate-700/60 p-3">
      <span className="text-xs text-slate-400">{ACCOUNT_RECORDED_ABOVE}</span>
      <span className="text-lg font-semibold text-white">
        <RecordedAboveValue recorded={recorded} testId="ai-recorded-above" />
      </span>
      <a
        href={aiCostRecordedHref(accountId, window)}
        data-testid="ai-recorded-link"
        className="text-xs text-purple-300 underline hover:text-purple-200"
      >
        {RECORDED_ON_AI_COST_LINK}
      </a>
    </div>
  );
}
