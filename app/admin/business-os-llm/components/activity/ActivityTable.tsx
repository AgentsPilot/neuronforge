/**
 * The Activity list: one `<tr>` per Business OS AI action (FR-B1).
 *
 * B1a columns only. The audit-entry columns (calls, tokens, models, error
 * code) arrive with B1b, and until then they are ABSENT rather than blank: a
 * blank cell could be misread as "none", an absent column cannot.
 *
 * Cost and credits are NET of corrections; a corrected row shows the charged
 * figure struck beside it. When corrections could not be read the figure is
 * the charged one and the tab says so above the table: a gross figure is
 * never presented as net.
 */

import { CheckCircle2, XCircle } from 'lucide-react';

import { formatCredits, formatUsd } from '../../costFormat';
import { formatInstant } from '../../format';
import { AREA_NOT_DECLARED, COLUMNS, NAME_UNAVAILABLE, OUTCOME_LABELS, TRIGGER_LABELS } from '../../activityCopy';
import type { ActivityAmount, ActivityRow } from '../../activityTypes';
import { RecordStateMarker } from './RecordStateMarker';

const shortId = (id: string) => `${id.slice(0, 8)}…`;

function Amount({ amount, format, testId }: { amount: ActivityAmount; format: (n: number) => string; testId: string }) {
  if (amount.net === null || amount.net === amount.gross) {
    return <span data-testid={testId}>{format(amount.net ?? amount.gross)}</span>;
  }
  return (
    <span data-testid={testId}>
      {format(amount.net)}{' '}
      <s className="text-slate-500" aria-label={`charged ${format(amount.gross)} before correction`}>
        {format(amount.gross)}
      </s>
    </span>
  );
}

export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700">
      <table className="min-w-full text-left text-xs text-slate-300" data-testid="activity-table">
        <thead className="bg-slate-800/60 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th scope="col" className="px-3 py-2">{COLUMNS.when}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.business}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.area}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.actionType}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.trigger}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.outcome}</th>
            <th scope="col" className="px-3 py-2 text-right">{COLUMNS.cost}</th>
            <th scope="col" className="px-3 py-2 text-right">{COLUMNS.credits}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.groupId}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.state}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row) => (
            <tr key={row.actionId} data-testid="activity-row" className="align-top">
              <td className="whitespace-nowrap px-3 py-2">{formatInstant(row.createdAt)}</td>
              <td className="px-3 py-2">
                <div className="text-slate-200">{row.companyName ?? NAME_UNAVAILABLE}</div>
                <div className="font-mono text-[11px] text-slate-500" title={row.accountId}>
                  {shortId(row.accountId)}
                </div>
              </td>
              <td className="px-3 py-2">{row.area ?? AREA_NOT_DECLARED}</td>
              <td className="px-3 py-2 font-mono">{row.actionType}</td>
              <td className="px-3 py-2">{TRIGGER_LABELS[row.trigger] ?? row.trigger}</td>
              <td className="whitespace-nowrap px-3 py-2" data-testid="activity-outcome">
                {row.outcome === 'failed' ? (
                  <span className="inline-flex items-center gap-1 text-red-300">
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {OUTCOME_LABELS.failed}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {OUTCOME_LABELS.succeeded}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Amount amount={row.costUsd} format={formatUsd} testId="activity-cost" />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Amount amount={row.credits} format={formatCredits} testId="activity-credits" />
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-slate-400" title={row.groupId}>
                {shortId(row.groupId)}
              </td>
              <td className="px-3 py-2">
                <RecordStateMarker row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
