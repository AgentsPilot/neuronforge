/**
 * The Activity list: one `<tr>` per Business OS AI action (FR-B1).
 *
 * B1b adds the audit-entry columns (calls / failed, tokens, models, error
 * code). When a row has no matched entry, or a field of it is not readable,
 * the cell says "Unknown": never blank, which could be misread as "none"
 * (FR-B1). Why there is no entry is the row's record state.
 *
 * Cost and credits are NET of corrections; a corrected row shows the charged
 * figure struck beside it. When corrections could not be read the figure is
 * the charged one and the tab says so above the table: a gross figure is
 * never presented as net.
 */

import { CheckCircle2, PanelRightOpen, XCircle } from 'lucide-react';

import { formatCount, formatCredits, formatUsd } from '../../costFormat';
import { formatInstant } from '../../format';
import {
  AREA_NOT_DECLARED,
  COLUMNS,
  ENTRY_ERROR_NONE,
  ENTRY_FIELD_UNKNOWN,
  ENTRY_MODELS_NONE,
  NAME_UNAVAILABLE,
  OPEN_DETAILS,
  OPEN_DETAILS_LABEL,
  OUTCOME_LABELS,
  TRIGGER_LABELS,
} from '../../activityCopy';
import type { ActivityAmount, ActivityEntryState, ActivityOutcome, ActivityRow } from '../../activityTypes';
import { RecordStateMarker } from './RecordStateMarker';

const shortId = (id: string) => `${id.slice(0, 8)}…`;

/** Net, with the charged figure struck beside it when corrected. Exported for the drill-down (B2a). */
export function Amount({ amount, format, testId }: { amount: ActivityAmount; format: (n: number) => string; testId: string }) {
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

/** The outcome as text with an icon (AC-B17). Exported for the drill-down (B2a). */
export function OutcomeLabel({ outcome }: { outcome: ActivityOutcome }) {
  return outcome === 'failed' ? (
    <span className="inline-flex items-center gap-1 text-red-300">
      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {OUTCOME_LABELS.failed}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      {OUTCOME_LABELS.succeeded}
    </span>
  );
}

type FoundEntry = Extract<ActivityEntryState, { state: 'found' }>;

const unknownCell = <span className="text-slate-500">{ENTRY_FIELD_UNKNOWN}</span>;
const countOrUnknown = (value: number | null) => (value === null ? unknownCell : formatCount(value));

/** The four entry cells. Anything but a found entry reads "Unknown" in each. */
function EntryCells({ entry }: { entry: ActivityEntryState }) {
  const found: FoundEntry | null = entry.state === 'found' ? entry : null;
  return (
    <>
      <td className="whitespace-nowrap px-3 py-2 text-right" data-testid="activity-calls">
        {found ? (
          <>
            {countOrUnknown(found.callCount)} / {countOrUnknown(found.failedCallCount)}
          </>
        ) : (
          unknownCell
        )}
      </td>
      <td
        className="whitespace-nowrap px-3 py-2 text-right"
        data-testid="activity-tokens"
        title={
          found && found.inputTokens !== null && found.outputTokens !== null
            ? `${formatCount(found.inputTokens)} in, ${formatCount(found.outputTokens)} out`
            : undefined
        }
      >
        {found ? countOrUnknown(found.totalTokens) : unknownCell}
      </td>
      <td className="px-3 py-2 font-mono text-[11px]" data-testid="activity-models">
        {found && found.models !== null
          ? found.models.length > 0
            ? found.models.join(', ')
            : ENTRY_MODELS_NONE
          : unknownCell}
      </td>
      <td className="px-3 py-2 font-mono text-[11px]" data-testid="activity-error-code">
        {found ? found.errorCode ?? ENTRY_ERROR_NONE : unknownCell}
      </td>
    </>
  );
}

export function ActivityTable({
  rows,
  settleMinutes,
  onOpen,
}: {
  rows: ActivityRow[];
  settleMinutes: number | null;
  /** B2a: opens the drill-down. The button is passed so focus can return to it when the drawer closes. */
  onOpen: (actionId: string, opener: HTMLElement) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700">
      <table className="min-w-full text-left text-xs text-slate-300" data-testid="activity-table">
        <thead className="bg-slate-800/60 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th scope="col" className="px-3 py-2">{COLUMNS.details}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.when}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.business}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.area}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.actionType}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.trigger}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.outcome}</th>
            <th scope="col" className="px-3 py-2 text-right">{COLUMNS.cost}</th>
            <th scope="col" className="px-3 py-2 text-right">{COLUMNS.credits}</th>
            <th scope="col" className="px-3 py-2 text-right">{COLUMNS.calls}</th>
            <th scope="col" className="px-3 py-2 text-right">{COLUMNS.tokens}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.models}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.errorCode}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.groupId}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.state}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row) => (
            <tr key={row.actionId} data-testid="activity-row" className="align-top">
              <td className="px-3 py-2">
                <button
                  type="button"
                  data-testid="activity-open-details"
                  aria-label={OPEN_DETAILS_LABEL(row.actionType, formatInstant(row.createdAt))}
                  onClick={(event) => onOpen(row.actionId, event.currentTarget)}
                  className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <PanelRightOpen className="h-3 w-3" aria-hidden="true" />
                  {OPEN_DETAILS}
                </button>
              </td>
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
                <OutcomeLabel outcome={row.outcome} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Amount amount={row.costUsd} format={formatUsd} testId="activity-cost" />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Amount amount={row.credits} format={formatCredits} testId="activity-credits" />
              </td>
              <EntryCells entry={row.entry} />
              <td className="px-3 py-2 font-mono text-[11px] text-slate-400" title={row.groupId}>
                {shortId(row.groupId)}
              </td>
              <td className="px-3 py-2">
                <RecordStateMarker row={row} settleMinutes={settleMinutes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
