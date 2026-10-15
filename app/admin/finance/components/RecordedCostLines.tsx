'use client';

/**
 * Section 3's recorded AI cost block (Money M-4, OV-5, §11F.6 M4-FR-1) and the
 * one renderer of "Recorded above charged" (`RecordedAboveValue`), which the
 * account summary uses too, so the two lines cannot differ (AC-158).
 *
 * Two measures BESIDE each other, never added (BD-18): the recorded AI cost
 * (the usage log) and how far it is above the charged AI cost (the credit
 * ledger). Every value and state comes from the server (`aiCost.recorded`);
 * this file only formats (M4-FR-11): no addition, subtraction or comparison
 * of money.
 *
 * `AiCostSection` renders the block after the cut-over notice and OUTSIDE its
 * figures guard (SA-W98), so it shows before the cut-over ("Not available")
 * and when Section 3 could not load ("Unknown").
 *
 * @module app/admin/finance/components/RecordedCostLines
 */

import { AdminNotice } from '@/app/admin/components/layout/AdminStates';
import type { FinanceRecordedAiCost } from '@/lib/business-os/finance/financeTypes';
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
import { atLeast, formatUsd } from '../financeFormat';
import { leakCheckHref } from '../financeLinks';

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

export function RecordedCostLines({
  recorded,
  accountId,
  chargedShown,
}: {
  recorded: FinanceRecordedAiCost;
  accountId: string | null;
  /** Fix round 1: whether Section 3's charged figures rendered above; the notice names them only then. */
  chargedShown: boolean;
}) {
  return (
    <div data-testid="ai-recorded" className="space-y-2 rounded-lg border border-slate-700/60 p-3">
      <p className="text-xs font-medium text-slate-300">{RECORDED_CAPTION}</p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-400">{RECORDED_LABEL}</dt>
          <dd className="text-lg font-semibold text-white" data-testid="ai-recorded-total">
            {recorded.recordedUsd === null ? RECORDED_UNKNOWN : atLeast(formatUsd(recorded.recordedUsd), recorded.recordedExact)}
          </dd>
          <dd className={NOTE}>{RECORDED_SOURCE}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">{ABOVE_LABEL}</dt>
          <dd className="text-lg font-semibold text-white">
            <RecordedAboveValue recorded={recorded} testId="ai-recorded-above" />
          </dd>
          <dd className={NOTE}>
            {ABOVE_SOURCE}{' '}
            <a href={leakCheckHref(accountId)} data-testid="ai-recorded-leak-link" className="text-purple-300 underline hover:text-purple-200">
              {ABOVE_LEAK_LINK}
            </a>
            .
          </dd>
        </div>
      </dl>
      {recorded.status === 'unknown' && <AdminNotice testId="ai-recorded-notice">{chargedShown ? RECORDED_NOTICE : RECORDED_NOTICE_PLAIN}</AdminNotice>}
      {accountId === null && (
        <p className={NOTE} data-testid="ai-recorded-deleted-note">
          {RECORDED_DELETED_NOTE}
        </p>
      )}
      <ul className="space-y-0.5" data-testid="ai-recorded-distortions">
        {RECORDED_DISTORTIONS.map((sentence) => (
          <li key={sentence} className={NOTE}>
            {sentence}
          </li>
        ))}
      </ul>
    </div>
  );
}
