/**
 * The charged actions of the opened action's grouping id, on the opened
 * action's account (Gap B slice B2a, FR-B2). One row per charge, newest
 * first, each with its record state. The opened action is marked in text.
 *
 * No call figure is shown per charge: when a grouping id holds more than one
 * action, its calls cannot be attributed to one of them (requirement `:326`).
 */

import { formatCredits, formatUsd } from '../../costFormat';
import { formatInstant } from '../../format';
import { AREA_NOT_DECLARED, COLUMNS, GROUP_CHARGES_CAPTION, GROUP_THIS_ACTION, TRIGGER_LABELS } from '../../activityCopy';
import type { ActivityDrillDownCharge } from '../../activityDrillDownTypes';
import { Amount, OutcomeLabel } from './ActivityTable';
import { RecordStateMarker } from './RecordStateMarker';

export function DrillDownCharges({
  charges,
  settleMinutes,
}: {
  charges: ActivityDrillDownCharge[];
  settleMinutes: number | null;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table className="min-w-full text-left text-xs text-slate-300" data-testid="drill-down-group-charges">
        <caption className="sr-only">{GROUP_CHARGES_CAPTION}</caption>
        <thead className="bg-slate-800/60 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th scope="col" className="px-3 py-2">{COLUMNS.when}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.area}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.actionType}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.trigger}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.outcome}</th>
            <th scope="col" className="px-3 py-2 text-right">{COLUMNS.cost}</th>
            <th scope="col" className="px-3 py-2 text-right">{COLUMNS.credits}</th>
            <th scope="col" className="px-3 py-2">{COLUMNS.state}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {charges.map((charge) => (
            <tr
              key={charge.actionId}
              data-testid="drill-down-group-charge"
              data-opened={charge.opened ? 'true' : 'false'}
              className={`align-top ${charge.opened ? 'bg-purple-500/10' : ''}`}
            >
              <td className="whitespace-nowrap px-3 py-2">
                <div>{formatInstant(charge.createdAt)}</div>
                {/* Text, not only the highlight (AC-B17). */}
                {charge.opened && <div className="text-[11px] font-medium text-purple-300">{GROUP_THIS_ACTION}</div>}
              </td>
              <td className="px-3 py-2">{charge.area ?? AREA_NOT_DECLARED}</td>
              <td className="px-3 py-2 font-mono">{charge.actionType}</td>
              <td className="px-3 py-2">{TRIGGER_LABELS[charge.trigger] ?? charge.trigger}</td>
              <td className="whitespace-nowrap px-3 py-2">
                <OutcomeLabel outcome={charge.outcome} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Amount amount={charge.costUsd} format={formatUsd} testId="drill-down-group-cost" />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Amount amount={charge.credits} format={formatCredits} testId="drill-down-group-credits" />
              </td>
              <td className="px-3 py-2">
                <RecordStateMarker row={charge} settleMinutes={settleMinutes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
