'use client';

/**
 * The drill-down drawer of the Activity tab (Gap B slice B2a, FR-B2, FR-B12,
 * AC-B2, AC-B17): one Business OS AI action, opened from its row.
 *
 * Read-only: one `GET` to `/api/admin/business-os/ai-activity/drill-down`
 * carrying the action id and nothing else. The route takes the account and
 * the grouping id from the charge row, never from this screen. No `@/lib/`
 * import (the page's source guard): the payload types are re-declared in
 * `../../activityDrillDownTypes.ts`.
 *
 * Sections, in order: the action; its corrections; its audit entry; its
 * grouping id (whether other charged actions share it on this account, and
 * which). The group's calls and the cost check are slice B2b, and are absent
 * here rather than empty, so nothing reads as "no calls".
 *
 * Only the NEWEST request may set the drawer: each read is abandoned when the
 * action changes or the drawer closes, and a failed read clears the content
 * instead of leaving the previous action's figures under the error.
 *
 * Admin Layout Standard L-8b: the panel is the shared `AdminDrawer` (palette,
 * readable title in the light scheme F-65, the close button's focus ring F-66,
 * focus handed back by the page) and the read's state is the shared
 * `useDrawerResource` (newest wins, abort on close and unmount, no frame of
 * another action's data, SA M-4). `readDrillDown` below does the request and
 * the body read, so the shared folder stays fetch-free (SA Q-9). Sections are
 * the shared named groups (A-9), with their headings, order and testids kept.
 */

import { AlertTriangle, Layers } from 'lucide-react';

import { AdminDrawer, DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { useDrawerResource, type DrawerRead } from '@/app/admin/components/layout/useDrawerResource';

import { formatCount, formatCredits, formatUsd } from '../../costFormat';
import { formatInstant } from '../../format';
import {
  ADJUSTMENTS_FAILED,
  AREA_NOT_DECLARED,
  CORRECTION_COLUMNS,
  CORRECTION_REASON_NONE,
  CORRECTIONS_NONE,
  CORRECTIONS_UNREAD,
  DRILL_DOWN_ERROR_FALLBACK,
  DRILL_DOWN_FIELDS,
  DRILL_DOWN_NOT_FOUND,
  DRILL_DOWN_SECTIONS,
  DRILL_DOWN_TITLE,
  DRILL_DOWN_WHAT,
  ENTRY_ERROR_NONE,
  ENTRY_FIELD_UNKNOWN,
  ENTRY_MODELS_NONE,
  ENTRY_NO_FIELDS,
  GROUP_FAILED,
  GROUP_SHARED,
  GROUP_SINGLE,
  NAME_UNAVAILABLE,
  NAMES_FAILED,
  TRIGGER_LABELS,
  UNREADABLE_AMOUNTS,
  UNRESOLVED_ADJUSTMENTS,
} from '../../activityCopy';
import type { ActivityDrillDownCharge, ActivityDrillDownPayload } from '../../activityDrillDownTypes';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import type { ActivityEntryState } from '../../activityTypes';
import { Amount, OutcomeLabel } from './ActivityTable';
import { DrillDownCharges } from './DrillDownCharges';
import { EntryMarker, RecordStateMarker } from './RecordStateMarker';

const DRILL_DOWN_URL = '/api/admin/business-os/ai-activity/drill-down';

/**
 * The drawer's one read (SA Q-9): the request and the body read, answered in
 * this tab's words. A rejected `fetch` is left to reject: `useDrawerResource`
 * turns it into the shared network sentence (§5.10), or ignores it after an
 * abort.
 */
async function readDrillDown(actionId: string, signal: AbortSignal): Promise<DrawerRead<ActivityDrillDownPayload>> {
  const response = await fetch(`${DRILL_DOWN_URL}?${new URLSearchParams({ actionId })}`, { signal });
  // QA-B2a-2: the status decides first; a 404 never depends on its body being JSON.
  if (response.status === 404) return { ok: false, message: DRILL_DOWN_NOT_FOUND };
  // A non-JSON body (a proxy's HTML error page) reads as NULL: our words, never a parser message.
  const body = await readJsonBody(response);
  if (!response.ok || body === null || body.success !== true) {
    return { ok: false, message: typeof body?.error === 'string' ? body.error : DRILL_DOWN_ERROR_FALLBACK };
  }
  return { ok: true, data: body.data as ActivityDrillDownPayload };
}

const shortId = (id: string) => `${id.slice(0, 8)}…`;

const unknownText = <span className="text-slate-500">{ENTRY_FIELD_UNKNOWN}</span>;
const countOrUnknown = (value: number | null) => (value === null ? unknownText : formatCount(value));

/** The B1b entry fields (OQ-12), or the entry state when there are none. Never blank. */
function EntryFields({ entry, settleMinutes }: { entry: ActivityEntryState; settleMinutes: number }) {
  if (entry.state !== 'found') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300" data-testid="drill-down-entry-state">
        <span>{ENTRY_NO_FIELDS}</span>
        <EntryMarker entry={entry} settleMinutes={settleMinutes} />
      </div>
    );
  }
  // The shared grid takes no testid, so a wrapper carries the existing one.
  return (
    <div data-testid="drill-down-entry-fields">
      <DrawerFields>
        <DrawerField label={DRILL_DOWN_FIELDS.calls}>{countOrUnknown(entry.callCount)}</DrawerField>
        <DrawerField label={DRILL_DOWN_FIELDS.failedCalls}>{countOrUnknown(entry.failedCallCount)}</DrawerField>
        <DrawerField label={DRILL_DOWN_FIELDS.inputTokens}>{countOrUnknown(entry.inputTokens)}</DrawerField>
        <DrawerField label={DRILL_DOWN_FIELDS.outputTokens}>{countOrUnknown(entry.outputTokens)}</DrawerField>
        <DrawerField label={DRILL_DOWN_FIELDS.totalTokens}>{countOrUnknown(entry.totalTokens)}</DrawerField>
        <DrawerField label={DRILL_DOWN_FIELDS.models}>
          <span className="font-mono">
            {entry.models === null ? unknownText : entry.models.length > 0 ? entry.models.join(', ') : ENTRY_MODELS_NONE}
          </span>
        </DrawerField>
        <DrawerField label={DRILL_DOWN_FIELDS.errorCode}>
          <span className="font-mono">{entry.errorCode ?? ENTRY_ERROR_NONE}</span>
        </DrawerField>
      </DrawerFields>
    </div>
  );
}

function Corrections({ charge, unread }: { charge: ActivityDrillDownCharge; unread: boolean }) {
  if (unread) return <p className="text-xs text-amber-200">{CORRECTIONS_UNREAD}</p>;
  if (charge.adjustments.length === 0) return <p className="text-xs text-slate-400">{CORRECTIONS_NONE}</p>;
  return (
    <table className="min-w-full text-left text-xs text-slate-300" data-testid="drill-down-corrections">
      <thead className="text-[11px] uppercase tracking-wide text-slate-400">
        <tr>
          <th scope="col" className="py-1 pr-3">{CORRECTION_COLUMNS.when}</th>
          <th scope="col" className="py-1 pr-3">{CORRECTION_COLUMNS.reason}</th>
          <th scope="col" className="py-1 pr-3 text-right">{CORRECTION_COLUMNS.cost}</th>
          <th scope="col" className="py-1 text-right">{CORRECTION_COLUMNS.credits}</th>
        </tr>
      </thead>
      <tbody>
        {charge.adjustments.map((adjustment, index) => (
          <tr key={`${adjustment.createdAt}-${index}`} data-testid="drill-down-correction">
            <td className="whitespace-nowrap py-1 pr-3">{formatInstant(adjustment.createdAt)}</td>
            <td className="py-1 pr-3 font-mono">{adjustment.reasonCode ?? CORRECTION_REASON_NONE}</td>
            <td className="whitespace-nowrap py-1 pr-3 text-right">{formatUsd(adjustment.costUsd)}</td>
            <td className="whitespace-nowrap py-1 text-right">{formatCredits(adjustment.credits)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DrillDownBody({ payload }: { payload: ActivityDrillDownPayload }) {
  const opened = payload.group.charges.find((c) => c.opened);
  // The route always marks one; anything else is not a payload to show.
  if (!opened) return <p className="text-sm text-red-200">{DRILL_DOWN_ERROR_FALLBACK}</p>;
  const settleMinutes = payload.audit.settleMinutes;
  const { group } = payload;

  return (
    <div className="space-y-6">
      {(payload.names === 'failed' ||
        payload.adjustments === 'failed' ||
        payload.unresolvedAdjustments > 0 ||
        payload.unreadableAmounts > 0) && (
        <div
          data-testid="drill-down-notices"
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <ul className="space-y-1">
            {payload.adjustments === 'failed' && <li>{ADJUSTMENTS_FAILED}</li>}
            {payload.unresolvedAdjustments > 0 && <li>{UNRESOLVED_ADJUSTMENTS(payload.unresolvedAdjustments)}</li>}
            {payload.unreadableAmounts > 0 && <li>{UNREADABLE_AMOUNTS(payload.unreadableAmounts)}</li>}
            {payload.names === 'failed' && <li>{NAMES_FAILED}</li>}
          </ul>
        </div>
      )}

      <DrawerSection title={DRILL_DOWN_SECTIONS.action} testId="drill-down-action">
        <DrawerFields>
          <DrawerField label={DRILL_DOWN_FIELDS.business} testId="drill-down-business">
            {payload.account.companyName ?? NAME_UNAVAILABLE}{' '}
            <span className="font-mono text-[11px] text-slate-500" title={payload.account.accountId}>
              {shortId(payload.account.accountId)}
            </span>
          </DrawerField>
          <DrawerField label={DRILL_DOWN_FIELDS.when}>{formatInstant(opened.createdAt)}</DrawerField>
          <DrawerField label={DRILL_DOWN_FIELDS.area}>{opened.area ?? AREA_NOT_DECLARED}</DrawerField>
          <DrawerField label={DRILL_DOWN_FIELDS.actionType}>
            <span className="font-mono">{opened.actionType}</span>
          </DrawerField>
          <DrawerField label={DRILL_DOWN_FIELDS.trigger}>{TRIGGER_LABELS[opened.trigger] ?? opened.trigger}</DrawerField>
          <DrawerField label={DRILL_DOWN_FIELDS.outcome}>
            <OutcomeLabel outcome={opened.outcome} />
          </DrawerField>
          <DrawerField label={DRILL_DOWN_FIELDS.cost}>
            <Amount amount={opened.costUsd} format={formatUsd} testId="drill-down-cost" />
          </DrawerField>
          <DrawerField label={DRILL_DOWN_FIELDS.credits}>
            <Amount amount={opened.credits} format={formatCredits} testId="drill-down-credits" />
          </DrawerField>
          <DrawerField label={DRILL_DOWN_FIELDS.state}>
            <RecordStateMarker row={opened} settleMinutes={settleMinutes} />
          </DrawerField>
        </DrawerFields>
      </DrawerSection>

      <DrawerSection title={DRILL_DOWN_SECTIONS.corrections} testId="drill-down-corrections-section">
        <Corrections charge={opened} unread={payload.adjustments === 'failed'} />
      </DrawerSection>

      <DrawerSection title={DRILL_DOWN_SECTIONS.entry} testId="drill-down-entry">
        <EntryFields entry={opened.entry} settleMinutes={settleMinutes} />
      </DrawerSection>

      <DrawerSection title={DRILL_DOWN_SECTIONS.group} testId="drill-down-group">
        <p className="font-mono text-[11px] text-slate-400">{group.groupId}</p>
        {group.status === 'failed' ? (
          <p className="flex items-start gap-2 text-xs text-amber-200" data-testid="drill-down-group-failed">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {GROUP_FAILED}
          </p>
        ) : group.shared ? (
          <p className="flex items-start gap-2 text-xs text-slate-200" data-testid="drill-down-group-shared">
            <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {GROUP_SHARED(formatCount(group.chargedActions), group.atLeast)}
          </p>
        ) : (
          <p className="text-xs text-slate-400" data-testid="drill-down-group-single">
            {GROUP_SINGLE}
          </p>
        )}
        {group.charges.length > 1 && <DrillDownCharges charges={group.charges} settleMinutes={settleMinutes} />}
      </DrawerSection>
    </div>
  );
}

export function ActivityDrillDown({
  actionId,
  onClose,
  onReturnFocus,
}: {
  /** NULL: the drawer is closed. */
  actionId: string | null;
  onClose: () => void;
  /** Called when the drawer has closed: the opener is not a Radix trigger, so focus is returned by hand. */
  onReturnFocus: () => void;
}) {
  // Newest wins, abort on close / change / unmount, and never another action's
  // figures under this one's title (SA M-4): all in the shared hook.
  const state = useDrawerResource(actionId, readDrillDown);
  const openedType = state.kind === 'ready' ? state.data.group.charges.find((c) => c.opened)?.actionType : undefined;

  return (
    <AdminDrawer
      open={actionId !== null}
      onClose={onClose}
      onReturnFocus={onReturnFocus}
      title={DRILL_DOWN_TITLE}
      titleSuffix={openedType || undefined}
      testId="activity-drill-down"
    >
      {state.kind === 'loading' && (
        <div data-testid="drill-down-loading">
          <AdminLoading what={DRILL_DOWN_WHAT} />
        </div>
      )}

      {state.kind === 'error' && <AdminError testId="drill-down-error" message={state.message} />}

      {state.kind === 'ready' && <DrillDownBody payload={state.data} />}
    </AdminDrawer>
  );
}
