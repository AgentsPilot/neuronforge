'use client';

/**
 * The Activity tab of the Business OS AI admin page (Gap B slices B1a and
 * B1b): one row per Business OS AI action, read from the credit ledger, with
 * its audit entry attached server-side (B1b).
 *
 * Read-only: one `GET` to `/api/admin/business-os/ai-activity`, plus the
 * shared business picker's own `GET`. No `@/lib/` import (the page's source
 * guard): the payload types are re-declared in `../../activityTypes.ts`, and
 * the areas arrive in the payload.
 *
 * Only the NEWEST request may set the screen (the Costs tab's CR-N2 pattern):
 * each read takes a sequence number and aborts the one before it. A failed
 * read clears the list instead of leaving the previous window's rows under
 * the error, where they would read as current.
 *
 * A platform account chosen in the picker is refused by the route (409); the
 * tab says why in its own words instead of a generic error (SA-B1-5). That
 * code must be seen before any generic copy, so the list read keeps its own
 * branching on `readJsonBody` rather than `readAdminResponse` (SA Q-12).
 *
 * B2a: each row's Open button opens the drill-down drawer for that action.
 * Which action is open lives in this component only; it is not in the URL
 * (the deep link lands in B3, OQ-12). Closing the drawer returns focus to the
 * button that opened it.
 *
 * Admin Layout Standard L-8a: every filter is in the URL through the shared
 * `useAdminFilters` (spec in `../../activityFilters.ts`), parsed before the
 * first read, so an inbound link reads its own view once. The route's query is
 * resolved ONCE per filter change (memoised on the identity-stable `filters`),
 * so Refresh and "Try again" re-send the same dates even across midnight, and
 * a tab click (an outside change for the hook, SA M-1) starts no read. The
 * strip, the bar and the shared states are the standard's; the purpose line
 * moved into the page header.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { AdminEmpty, AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';

import {
  ACTIVITY_EMPTY,
  ACTIVITY_ERROR_FALLBACK,
  ADJUSTMENTS_FAILED,
  NAMES_FAILED,
  PLATFORM_ACCOUNT_ERROR,
  UNREADABLE_AMOUNTS,
  UNRESOLVED_ADJUSTMENTS,
} from '../../activityCopy';
import { ACTIVITY_FILTER_SPEC, ACTIVITY_PATH, activityRouteSearch, type ActivityFilters } from '../../activityFilters';
import type { ActivityAreaOption, ActivityPayload } from '../../activityTypes';
import { ActivityCountLine } from './ActivityCountLine';
import { ActivityDrillDown } from './ActivityDrillDown';
import { ACTIVITY_WHAT, ActivityFilterBar } from './ActivityFilterBar';
import { ActivityKpis } from './ActivityKpis';
import { ActivityTable } from './ActivityTable';
import { AuditSummaryLine } from './AuditSummaryLine';
import { CutoverNotice } from './CutoverNotice';
import { DeletedAccountsBucket } from './DeletedAccountsBucket';

const ACTIVITY_URL = '/api/admin/business-os/ai-activity';

interface ActivityError {
  kind: 'platform_account' | 'other';
  message: string;
}

export function ActivityTab() {
  const { filters, setFilters, clear, isDefault, hrefFor } = useAdminFilters(ACTIVITY_FILTER_SPEC);
  /**
   * The route's query, resolved once per filter change. An object, not the
   * string, so the read effect is keyed on the filters' identity: a change of
   * filters reads, and nothing else does (SA M-1, mutation V-6 (q)).
   */
  const request = useMemo(() => ({ search: activityRouteSearch(filters, new Date()) }), [filters]);

  const [payload, setPayload] = useState<ActivityPayload | null>(null);
  // Kept across reads, so the area filter does not empty while a read is in flight.
  const [areas, setAreas] = useState<ActivityAreaOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ActivityError | null>(null);
  /** The business last picked, with the name the picker showed (not in the URL). */
  const [picked, setPicked] = useState<{ accountId: string; name: string | null } | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  // B2a: the action whose drawer is open, and the button that opened it.
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const openDetails = useCallback((actionId: string, button: HTMLElement) => {
    opener.current = button;
    setOpenActionId(actionId);
  }, []);
  const closeDetails = useCallback(() => setOpenActionId(null), []);
  const returnFocus = useCallback(() => opener.current?.focus(), []);

  const load = useCallback(async (search: string) => {
    const mine = ++sequence.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const isCurrent = () => mine === sequence.current;

    setLoading(true);
    setError(null);
    try {
      let response: Response;
      try {
        response = await fetch(`${ACTIVITY_URL}?${search}`, { signal: controller.signal });
      } catch {
        // A superseded (or aborted) request says nothing about the screen. A
        // network failure says the shared words, never the browser's (§5.10).
        if (!isCurrent()) return;
        setPayload(null);
        setError({ kind: 'other', message: ADMIN_NETWORK_ERROR });
        return;
      }
      // QA-B2a-2: a non-JSON body (a proxy's HTML error page) reads as NULL, so
      // the tab shows its own words, never a parser message. A JSON error body
      // still gives the route's reason (400, 409).
      const body = await readJsonBody(response);
      if (!isCurrent()) return;
      if (!response.ok || body === null || body.success !== true) {
        setPayload(null);
        setError(
          body?.error === 'platform_account'
            ? { kind: 'platform_account', message: PLATFORM_ACCOUNT_ERROR }
            : { kind: 'other', message: typeof body?.error === 'string' ? body.error : ACTIVITY_ERROR_FALLBACK }
        );
        return;
      }
      const data = body.data as ActivityPayload;
      setPayload(data);
      setAreas(data.areas);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(request.search);
  }, [load, request]);

  // Unmounting abandons the last read; nothing may set state afterwards.
  useEffect(
    () => () => {
      sequence.current += 1;
      inFlight.current?.abort();
    },
    []
  );

  const reread = useCallback(() => void load(request.search), [load, request]);

  const tile = (patch: Partial<ActivityFilters>) => ({
    href: `${ACTIVITY_PATH}${hrefFor(patch)}`,
    apply: () => setFilters(patch),
  });

  // The chip's name: the picked name, else the first row's name when the list
  // is for that business, else none (the short id; RC-6, no lookup).
  const businessName = !filters.account
    ? null
    : picked && picked.accountId === filters.account && picked.name
      ? picked.name
      : payload && payload.filters.accountId === filters.account
        ? payload.rows.find((r) => r.companyName)?.companyName ?? null
        : null;
  const entirelyBefore = payload?.cutover.coverage === 'entirely_before_cutover';

  return (
    <div className="space-y-4" data-testid="activity-tab">
      <ActivityKpis payload={payload} firstLoad={loading && !payload && !error} filters={filters} tile={tile} />

      <ActivityFilterBar
        filters={filters}
        setFilters={setFilters}
        onClear={clear}
        canClear={!isDefault}
        areas={areas}
        businessName={businessName}
        onPickBusiness={(accountId, name) => {
          setPicked({ accountId, name });
          setFilters({ account: accountId });
        }}
        busy={loading}
        readAt={payload?.generatedAt ?? null}
        onRefresh={reread}
      />

      <div data-testid="activity-content" aria-busy={loading} className="space-y-3">
        {error &&
          (error.kind === 'platform_account' ? (
            <AdminNotice testId="activity-platform-account">{error.message}</AdminNotice>
          ) : (
            <AdminError testId="activity-error" message={error.message} onRetry={reread} />
          ))}

        {loading && !payload && !error && (
          <div data-testid="activity-loading">
            <AdminLoading what={ACTIVITY_WHAT} />
          </div>
        )}

        {payload && (
          <>
            <CutoverNotice coverage={payload.cutover.coverage} accountId={payload.filters.accountId} />

            {!entirelyBefore && (
              <>
                <ActivityCountLine payload={payload} />

                {(payload.names === 'failed' ||
                  payload.adjustments === 'failed' ||
                  payload.unresolvedAdjustments > 0 ||
                  payload.unreadableAmounts > 0) && (
                  <div
                    data-testid="activity-notices"
                    className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <ul className="space-y-1">
                      {payload.adjustments === 'failed' && <li data-testid="activity-adjustments-failed">{ADJUSTMENTS_FAILED}</li>}
                      {payload.unresolvedAdjustments > 0 && <li>{UNRESOLVED_ADJUSTMENTS(payload.unresolvedAdjustments)}</li>}
                      {payload.unreadableAmounts > 0 && <li>{UNREADABLE_AMOUNTS(payload.unreadableAmounts)}</li>}
                      {payload.names === 'failed' && <li data-testid="activity-names-failed">{NAMES_FAILED}</li>}
                    </ul>
                  </div>
                )}

                {payload.rows.length === 0 ? (
                  <AdminEmpty message={ACTIVITY_EMPTY} testId="activity-empty" onClear={isDefault ? undefined : clear} />
                ) : (
                  <ActivityTable
                    rows={payload.rows}
                    settleMinutes={payload.audit?.settleMinutes ?? null}
                    onOpen={openDetails}
                  />
                )}

                {payload.audit && payload.rows.length > 0 && (
                  <AuditSummaryLine audit={payload.audit} shown={payload.rows.length} />
                )}

                {payload.deletedAccounts && <DeletedAccountsBucket bucket={payload.deletedAccounts} />}
              </>
            )}
          </>
        )}
      </div>

      <ActivityDrillDown actionId={openActionId} onClose={closeDetails} onReturnFocus={returnFocus} />
    </div>
  );
}
