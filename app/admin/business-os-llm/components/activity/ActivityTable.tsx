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
 *
 * Admin Layout Standard L-8a (§5.7, F-71, F-72): the shared table classes
 * (`text-sm`, tabular figures on the four number columns), ids and "Unknown"
 * in slate-400 (T-5), the shared Open button, and the outcome as the shared
 * `StatusChip` (`ok` / `danger` with the chip's own icons, SA Q-11 / S-2): the
 * page's own `text-emerald-300` was a second green (T-6). `OutcomeLabel` keeps
 * its name, so the drawer and `DrillDownCharges` show the same chip.
 */

import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_ID,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
  formatShortId,
} from '@/app/admin/components/layout/adminTable';

import { formatCount, formatCredits, formatUsd } from '../../costFormat';
import { formatInstant } from '../../format';
import {
  AREA_NOT_DECLARED,
  COLUMNS,
  ENTRY_ERROR_NONE,
  ENTRY_FIELD_UNKNOWN,
  ENTRY_MODELS_NONE,
  NAME_UNAVAILABLE,
  OPEN_DETAILS_LABEL,
  OUTCOME_LABELS,
  TRIGGER_LABELS,
} from '../../activityCopy';
import type { ActivityAmount, ActivityEntryState, ActivityOutcome, ActivityRow } from '../../activityTypes';
import { RecordStateMarker } from './RecordStateMarker';

/** Net, with the charged figure struck beside it when corrected. Exported for the drill-down (B2a). */
export function Amount({ amount, format, testId }: { amount: ActivityAmount; format: (n: number) => string; testId: string }) {
  if (amount.net === null || amount.net === amount.gross) {
    return <span data-testid={testId}>{format(amount.net ?? amount.gross)}</span>;
  }
  return (
    <span data-testid={testId}>
      {format(amount.net)}{' '}
      <s className="text-slate-400" aria-label={`charged ${format(amount.gross)} before correction`}>
        {format(amount.gross)}
      </s>
    </span>
  );
}

/** The outcome as words with the chip's icon (AC-B17, A-7). Exported for the drill-down (B2a). */
export function OutcomeLabel({ outcome }: { outcome: ActivityOutcome }) {
  return outcome === 'failed' ? (
    <StatusChip tone="danger">{OUTCOME_LABELS.failed}</StatusChip>
  ) : (
    <StatusChip tone="ok">{OUTCOME_LABELS.succeeded}</StatusChip>
  );
}

type FoundEntry = Extract<ActivityEntryState, { state: 'found' }>;

const unknownCell = <span className="text-slate-400">{ENTRY_FIELD_UNKNOWN}</span>;
const countOrUnknown = (value: number | null) => (value === null ? unknownCell : formatCount(value));

/** The four entry cells. Anything but a found entry reads "Unknown" in each. */
function EntryCells({ entry }: { entry: ActivityEntryState }) {
  const found: FoundEntry | null = entry.state === 'found' ? entry : null;
  return (
    <>
      <td className={ADMIN_TD_NUM} data-testid="activity-calls">
        {found ? (
          <>
            {countOrUnknown(found.callCount)} / {countOrUnknown(found.failedCallCount)}
          </>
        ) : (
          unknownCell
        )}
      </td>
      <td
        className={ADMIN_TD_NUM}
        data-testid="activity-tokens"
        title={
          found && found.inputTokens !== null && found.outputTokens !== null
            ? `${formatCount(found.inputTokens)} in, ${formatCount(found.outputTokens)} out`
            : undefined
        }
      >
        {found ? countOrUnknown(found.totalTokens) : unknownCell}
      </td>
      <td className={`${ADMIN_TD} font-mono text-[11px]`} data-testid="activity-models">
        {found && found.models !== null
          ? found.models.length > 0
            ? found.models.join(', ')
            : ENTRY_MODELS_NONE
          : unknownCell}
      </td>
      <td className={`${ADMIN_TD} font-mono text-[11px]`} data-testid="activity-error-code">
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
    <div className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} data-testid="activity-table" aria-label="AI actions">
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.details}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.when}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.business}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.area}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.actionType}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.trigger}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.outcome}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{COLUMNS.cost}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{COLUMNS.credits}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{COLUMNS.calls}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{COLUMNS.tokens}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.models}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.errorCode}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.groupId}</th>
            <th scope="col" className={ADMIN_TH}>{COLUMNS.state}</th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {rows.map((row) => (
            <tr key={row.actionId} data-testid="activity-row">
              <td className={ADMIN_TD}>
                <OpenRowButton
                  testId="activity-open-details"
                  label={OPEN_DETAILS_LABEL(row.actionType, formatInstant(row.createdAt))}
                  onOpen={(opener) => onOpen(row.actionId, opener)}
                />
              </td>
              <td className={`${ADMIN_TD} whitespace-nowrap`}>{formatInstant(row.createdAt)}</td>
              <td className={ADMIN_TD}>
                <div className="text-slate-200">{row.companyName ?? NAME_UNAVAILABLE}</div>
                <div className={ADMIN_TD_ID} title={row.accountId}>
                  {formatShortId(row.accountId)}
                </div>
              </td>
              <td className={ADMIN_TD}>{row.area ?? AREA_NOT_DECLARED}</td>
              <td className={`${ADMIN_TD} font-mono`}>{row.actionType}</td>
              <td className={ADMIN_TD}>{TRIGGER_LABELS[row.trigger] ?? row.trigger}</td>
              <td className={`${ADMIN_TD} whitespace-nowrap`} data-testid="activity-outcome">
                <OutcomeLabel outcome={row.outcome} />
              </td>
              <td className={ADMIN_TD_NUM}>
                <Amount amount={row.costUsd} format={formatUsd} testId="activity-cost" />
              </td>
              <td className={ADMIN_TD_NUM}>
                <Amount amount={row.credits} format={formatCredits} testId="activity-credits" />
              </td>
              <EntryCells entry={row.entry} />
              <td className={ADMIN_TD} title={row.groupId}>
                <span className={ADMIN_TD_ID}>{formatShortId(row.groupId)}</span>
              </td>
              <td className={ADMIN_TD}>
                <RecordStateMarker row={row} settleMinutes={settleMinutes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
