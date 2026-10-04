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
 */

import { useEffect, useId, useState } from 'react';
import { AlertCircle, AlertTriangle, Layers, RefreshCw } from 'lucide-react';

// OQ-13: the shared Radix sheet (focus trap, Escape, focus handling), as
// CreditHistoryPanel uses it. It reaches `@/lib/utils` transitively; this
// page's source guard bans direct `@/lib/` imports only.
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

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
  DRILL_DOWN_LOADING,
  DRILL_DOWN_NOT_FOUND,
  DRILL_DOWN_SECTIONS,
  DRILL_DOWN_TITLE,
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
import { readJsonBody } from '../../readJsonBody';
import type { ActivityEntryState } from '../../activityTypes';
import { Amount, OutcomeLabel } from './ActivityTable';
import { DrillDownCharges } from './DrillDownCharges';
import { EntryMarker, RecordStateMarker } from './RecordStateMarker';

const DRILL_DOWN_URL = '/api/admin/business-os/ai-activity/drill-down';

type DrawerState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payload: ActivityDrillDownPayload };

const shortId = (id: string) => `${id.slice(0, 8)}…`;

function Field({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="contents">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-slate-200" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  // Named by its own heading (SA optional), not a duplicate label.
  const headingId = useId();
  return (
    <section className="space-y-2" data-testid={testId} aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold text-slate-100">
        {title}
      </h3>
      {children}
    </section>
  );
}

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
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs" data-testid="drill-down-entry-fields">
      <Field label={DRILL_DOWN_FIELDS.calls}>{countOrUnknown(entry.callCount)}</Field>
      <Field label={DRILL_DOWN_FIELDS.failedCalls}>{countOrUnknown(entry.failedCallCount)}</Field>
      <Field label={DRILL_DOWN_FIELDS.inputTokens}>{countOrUnknown(entry.inputTokens)}</Field>
      <Field label={DRILL_DOWN_FIELDS.outputTokens}>{countOrUnknown(entry.outputTokens)}</Field>
      <Field label={DRILL_DOWN_FIELDS.totalTokens}>{countOrUnknown(entry.totalTokens)}</Field>
      <Field label={DRILL_DOWN_FIELDS.models}>
        <span className="font-mono">
          {entry.models === null ? unknownText : entry.models.length > 0 ? entry.models.join(', ') : ENTRY_MODELS_NONE}
        </span>
      </Field>
      <Field label={DRILL_DOWN_FIELDS.errorCode}>
        <span className="font-mono">{entry.errorCode ?? ENTRY_ERROR_NONE}</span>
      </Field>
    </dl>
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

      <Section title={DRILL_DOWN_SECTIONS.action} testId="drill-down-action">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <Field label={DRILL_DOWN_FIELDS.business} testId="drill-down-business">
            {payload.account.companyName ?? NAME_UNAVAILABLE}{' '}
            <span className="font-mono text-[11px] text-slate-500" title={payload.account.accountId}>
              {shortId(payload.account.accountId)}
            </span>
          </Field>
          <Field label={DRILL_DOWN_FIELDS.when}>{formatInstant(opened.createdAt)}</Field>
          <Field label={DRILL_DOWN_FIELDS.area}>{opened.area ?? AREA_NOT_DECLARED}</Field>
          <Field label={DRILL_DOWN_FIELDS.actionType}>
            <span className="font-mono">{opened.actionType}</span>
          </Field>
          <Field label={DRILL_DOWN_FIELDS.trigger}>{TRIGGER_LABELS[opened.trigger] ?? opened.trigger}</Field>
          <Field label={DRILL_DOWN_FIELDS.outcome}>
            <OutcomeLabel outcome={opened.outcome} />
          </Field>
          <Field label={DRILL_DOWN_FIELDS.cost}>
            <Amount amount={opened.costUsd} format={formatUsd} testId="drill-down-cost" />
          </Field>
          <Field label={DRILL_DOWN_FIELDS.credits}>
            <Amount amount={opened.credits} format={formatCredits} testId="drill-down-credits" />
          </Field>
          <Field label={DRILL_DOWN_FIELDS.state}>
            <RecordStateMarker row={opened} settleMinutes={settleMinutes} />
          </Field>
        </dl>
      </Section>

      <Section title={DRILL_DOWN_SECTIONS.corrections} testId="drill-down-corrections-section">
        <Corrections charge={opened} unread={payload.adjustments === 'failed'} />
      </Section>

      <Section title={DRILL_DOWN_SECTIONS.entry} testId="drill-down-entry">
        <EntryFields entry={opened.entry} settleMinutes={settleMinutes} />
      </Section>

      <Section title={DRILL_DOWN_SECTIONS.group} testId="drill-down-group">
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
      </Section>
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
  const [state, setState] = useState<DrawerState>({ kind: 'idle' });

  useEffect(() => {
    if (actionId === null) {
      setState({ kind: 'idle' });
      return;
    }
    // Newest request wins: this read is abandoned when the action changes or the drawer closes.
    let current = true;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const response = await fetch(`${DRILL_DOWN_URL}?${new URLSearchParams({ actionId })}`, { signal: controller.signal });
        if (!current) return;
        // QA-B2a-2: the status decides first; a 404 never depends on its body being JSON.
        if (response.status === 404) {
          setState({ kind: 'error', message: DRILL_DOWN_NOT_FOUND });
          return;
        }
        // A non-JSON body (a proxy's HTML error page) reads as NULL: our words, never a parser message.
        const body = await readJsonBody(response);
        if (!current) return;
        if (!response.ok || body === null || body.success !== true) {
          setState({ kind: 'error', message: typeof body?.error === 'string' ? body.error : DRILL_DOWN_ERROR_FALLBACK });
        } else {
          setState({ kind: 'ready', payload: body.data as ActivityDrillDownPayload });
        }
      } catch (err) {
        if (!current) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : DRILL_DOWN_ERROR_FALLBACK });
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [actionId]);

  return (
    <Sheet
      open={actionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        data-testid="activity-drill-down"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
        // The admin palette (OQ-13). `cn()` is a plain join, so the sheet's own
        // `--v2-bg` class ships too; the inline background decides which wins.
        // SA-CR-B2a-1: the sheet's close button is coloured with a `--v2-*` token
        // the /admin tree does not load; in light mode it fell back to a dark
        // foreground on this dark panel. The child selector outranks its class.
        className="w-full overflow-y-auto border-slate-700 bg-slate-900 p-6 text-slate-200 sm:max-w-3xl [&>button]:text-slate-300"
        style={{ backgroundColor: 'rgb(15 23 42)' }}
      >
        <SheetTitle className="mb-4 text-lg font-semibold text-slate-100">
          {DRILL_DOWN_TITLE}
          {state.kind === 'ready' && (
            <span className="ml-2 font-mono text-sm font-normal text-slate-400">
              {state.payload.group.charges.find((c) => c.opened)?.actionType ?? ''}
            </span>
          )}
        </SheetTitle>

        {state.kind === 'loading' && (
          <div data-testid="drill-down-loading" className="flex items-center gap-3 py-8 text-sm text-slate-300">
            <RefreshCw className="h-5 w-5 animate-spin text-purple-500" aria-hidden="true" />
            {DRILL_DOWN_LOADING}
          </div>
        )}

        {state.kind === 'error' && (
          <div
            data-testid="drill-down-error"
            className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{state.message}</span>
          </div>
        )}

        {state.kind === 'ready' && <DrillDownBody payload={state.payload} />}
      </SheetContent>
    </Sheet>
  );
}
