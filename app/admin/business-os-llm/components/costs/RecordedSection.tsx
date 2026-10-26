/**
 * The recorded AI cost block on the AI cost page's Summary & checks tab
 * (Money MK-3, C-7: moved here from Finance's Section 3, where M-4 built it).
 *
 * Two measures BESIDE each other, never added (BD-18): the recorded AI cost
 * (the usage log, Business OS rows) and how far it is above the charged AI
 * cost (the credit ledger) for the same window. Every value and state comes
 * from the payload's `recorded` (Finance's own builder, run by the report
 * route); this file only formats: no addition, subtraction or comparison of
 * money. It sits directly above the Leak check, which answers "which calls".
 *
 * Presentational, no read and no `@/lib/` import (the page's source guard).
 */

import { AdminNotice } from '@/app/admin/components/layout/AdminStates';

import {
  ABOVE_LABEL,
  ABOVE_SOURCE,
  chargedAboveLine,
  KPI_ABOVE_NONE,
  KPI_ABOVE_NOT_AVAILABLE,
  KPI_ABOVE_NOT_AVAILABLE_SUB,
  KPI_AT_LEAST,
  KPI_UNKNOWN,
  RECORDED_BLOCK_TITLE,
  RECORDED_CAPTION,
  RECORDED_DELETED_NOTE,
  RECORDED_DISTORTIONS,
  RECORDED_LABEL,
  RECORDED_NOTICE,
  RECORDED_SOURCE,
} from '../../costCopy';
import { formatUsd } from '../../costFormat';
import type { CostRecordedInWindow } from '../../costTypes';

const NOTE = 'text-[11px] text-slate-400';

/** "Recorded above charged": the figure, "None" (with the charged-above line), "Not available" or "Unknown". */
function AboveValue({ recorded }: { recorded: CostRecordedInWindow }) {
  const above = recorded.aboveCharged;
  if (above.state === 'figure' && above.usd !== null) return <span data-testid="costs-recorded-above">{formatUsd(above.usd)}</span>;
  if (above.state === 'none') {
    return (
      <span data-testid="costs-recorded-above">
        {KPI_ABOVE_NONE}
        {recorded.chargedAboveUsd !== null && (
          <span className={`block ${NOTE}`}>{chargedAboveLine(formatUsd(recorded.chargedAboveUsd))}</span>
        )}
      </span>
    );
  }
  if (above.state === 'not_available') {
    return (
      <span data-testid="costs-recorded-above">
        {KPI_ABOVE_NOT_AVAILABLE}
        <span className={`block ${NOTE}`}>{KPI_ABOVE_NOT_AVAILABLE_SUB}</span>
      </span>
    );
  }
  return <span data-testid="costs-recorded-above">{KPI_UNKNOWN}</span>;
}

export function RecordedSection({ recorded, accountId }: { recorded: CostRecordedInWindow; accountId: string | null }) {
  const total =
    recorded.recordedUsd === null
      ? KPI_UNKNOWN
      : `${recorded.recordedExact ? '' : `${KPI_AT_LEAST} `}${formatUsd(recorded.recordedUsd)}`;
  return (
    <section data-testid="costs-recorded" className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <h2 className="text-sm font-semibold text-white">{RECORDED_BLOCK_TITLE}</h2>
      <p className="text-xs font-medium text-slate-300">{RECORDED_CAPTION}</p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-400">{RECORDED_LABEL}</dt>
          <dd className="text-lg font-semibold text-white" data-testid="costs-recorded-total">
            {total}
          </dd>
          <dd className={NOTE}>{RECORDED_SOURCE}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">{ABOVE_LABEL}</dt>
          <dd className="text-lg font-semibold text-white">
            <AboveValue recorded={recorded} />
          </dd>
          <dd className={NOTE}>{ABOVE_SOURCE}</dd>
        </div>
      </dl>
      {recorded.status === 'unknown' && <AdminNotice testId="costs-recorded-notice">{RECORDED_NOTICE}</AdminNotice>}
      {accountId === null && (
        <p className={NOTE} data-testid="costs-recorded-deleted-note">
          {RECORDED_DELETED_NOTE}
        </p>
      )}
      <ul className="space-y-0.5" data-testid="costs-recorded-distortions">
        {RECORDED_DISTORTIONS.map((sentence) => (
          <li key={sentence} className={NOTE}>
            {sentence}
          </li>
        ))}
      </ul>
    </section>
  );
}
