'use client';

/**
 * The Costs & credits tab of the Business OS AI admin page (credit deduction
 * slice 4a, workplan §4.6): the operator cost report.
 *
 * Read-only: one `GET` to `/api/admin/business-os/credits/report`, the shared
 * business picker's own `GET`, and the leak check panel's own `GET` (slice 4b),
 * run only when its button is pressed. No `@/lib/` import (the page's source
 * guard): the payload types are re-declared in `../../costTypes.ts`.
 *
 * Only the NEWEST request may set the screen (SA CR-N2): each read takes a
 * sequence number and aborts the one before it, so a slow earlier response can
 * never overwrite a later window. A failed read clears the report instead of
 * leaving the previous window's figures under the error, where they would read
 * as current.
 *
 * Admin Layout Standard L-9a: every filter is in the URL through the shared
 * `useAdminFilters` (spec in `../../costsFilters.ts`), parsed before the first
 * read, so an inbound link reads its own view once. The route's query is
 * resolved ONCE per filter change (memoised on the identity-stable `filters`),
 * so Refresh and "Try again" re-send the same dates even across midnight. The
 * page passes `active` (F-113): while another tab is shown this tab's hook
 * neither re-reads nor writes, so a tab switch starts no read here. The account
 * `<select>` gave way to the shared business picker (SA-R-11), which searches
 * every business; one with no charges in the window gets the empty state.
 *
 * A platform account chosen in the picker is refused by the route (409); the
 * tab says why in its own words instead of a generic error (SA M-2, the
 * Activity precedent L-8 Q-12). That code must be seen before any generic
 * copy, so the read keeps its own branching on `readJsonBody` rather than
 * `readAdminResponse`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AdminEmpty, AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';

import { formatCount } from '../../costFormat';
import {
  COSTS_EMPTY,
  COSTS_EMPTY_HINT,
  COSTS_ERROR_FALLBACK,
  COSTS_INCOMPLETE,
  COSTS_PERIOD_RULE,
  COSTS_PLATFORM_ACCOUNT,
  COSTS_WHAT,
  INCOMPLETE_REASON_TEXT,
  NAMES_FAILED,
  SECTION_FAILED,
  UNREADABLE_AMOUNTS,
} from '../../costCopy';
import { COSTS_FILTER_SPEC, costsRouteSearch } from '../../costsFilters';
import type { CostReportPayload } from '../../costTypes';
import { CostsFilterBar } from './CostsFilterBar';
import { CostsKpis } from './CostsKpis';
import { BreakdownsSection, ChargedInWindowSection, FallbackSection, PeriodsSection, SpreadSection } from './CostsSections';
import { LeakCheckPanel } from './LeakCheckPanel';

const REPORT_URL = '/api/admin/business-os/credits/report';

interface CostsError {
  kind: 'platform_account' | 'other';
  message: string;
}

export function CostsTab({ active = true }: { active?: boolean } = {}) {
  const { filters, setFilters, clear, isDefault } = useAdminFilters(COSTS_FILTER_SPEC, { active });
  /**
   * The route's query, resolved once per filter change. An object, not the
   * string, so the read effect is keyed on the filters' identity: a change of
   * filters reads, and nothing else does.
   */
  const request = useMemo(() => ({ search: costsRouteSearch(filters, new Date()) }), [filters]);

  const [payload, setPayload] = useState<CostReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CostsError | null>(null);
  /** The business last picked, with the name the picker showed (not in the URL). */
  const [picked, setPicked] = useState<{ accountId: string; name: string | null } | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

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
        response = await fetch(`${REPORT_URL}?${search}`, { signal: controller.signal });
      } catch {
        // A superseded (or aborted) request says nothing about the screen. A
        // network failure says the shared words, never the browser's (§5.10).
        if (!isCurrent()) return;
        setPayload(null);
        setError({ kind: 'other', message: ADMIN_NETWORK_ERROR });
        return;
      }
      // A non-JSON body (a proxy's HTML error page) reads as null, so the tab
      // shows its own words, never a parser message. A JSON error body still
      // gives the route's reason (400, 409). Newest wins before any setState (SA S-7).
      const body = await readJsonBody(response);
      if (!isCurrent()) return;
      if (!response.ok || body === null || body.success !== true) {
        setPayload(null);
        setError(
          body?.error === 'platform_account'
            ? { kind: 'platform_account', message: COSTS_PLATFORM_ACCOUNT }
            : { kind: 'other', message: typeof body?.error === 'string' ? body.error : COSTS_ERROR_FALLBACK }
        );
        return;
      }
      setPayload(body.data as CostReportPayload);
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

  const report = payload;
  const isEmpty = report !== null && report.sections.totals === 'ok' && report.periods.length === 0;
  const sectionsShown = report !== null && report.sections.totals !== 'failed' && !isEmpty;

  // The chip's name: the picked name, else the report's own name for that
  // account, else none (the short id; RC-6, no lookup).
  const businessName = !filters.account
    ? null
    : picked && picked.accountId === filters.account && picked.name
      ? picked.name
      : report?.accounts.find((account) => account.accountId === filters.account)?.companyName ?? null;

  return (
    <div className="space-y-4" data-testid="costs-tab">
      <CostsKpis report={report} firstLoad={loading && !report && !error} sectionsShown={sectionsShown} />

      <CostsFilterBar
        filters={filters}
        setFilters={setFilters}
        onClear={clear}
        canClear={!isDefault}
        businessName={businessName}
        onPickBusiness={(accountId, name) => {
          setPicked({ accountId, name });
          setFilters({ account: accountId });
        }}
        busy={loading}
        readAt={report?.generatedAt ?? null}
        onRefresh={reread}
      />

      {/* Always mounted, so a re-read marks the content busy instead of replacing it. */}
      <div data-testid="costs-content" aria-busy={loading} className="space-y-4">
        {error &&
          (error.kind === 'platform_account' ? (
            <AdminNotice testId="costs-platform-account">{error.message}</AdminNotice>
          ) : (
            <AdminError testId="costs-error" message={error.message} onRetry={reread} />
          ))}

        {loading && !report && !error && (
          <div data-testid="costs-loading">
            <AdminLoading what={COSTS_WHAT} />
          </div>
        )}

        {report && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400" data-testid="costs-window">
              {report.window.from} to {report.window.to} (UTC)
              {report.rowsRead !== null && <> &middot; {formatCount(report.rowsRead)} ledger rows read</>}
              {' · '}
              {COSTS_PERIOD_RULE(report.periodLookbackDays)}
            </p>

            {/* L-9b (E-9): the shared notice; same words and reasons, its amber. */}
            {report.incomplete && (
              <AdminNotice testId="costs-incomplete">
                {COSTS_INCOMPLETE}{' '}
                <span className="text-amber-300/80">
                  ({report.incompleteReasons.map((r) => INCOMPLETE_REASON_TEXT[r] ?? r).join(', ')})
                </span>
              </AdminNotice>
            )}

            {/* L-10 task 9 (F-120, SA L-10 Q-7): each partial fact is its own
                shared notice, same words and test ids, after the incomplete one.
                Separate boxes, not one merged notice: each says a different
                thing is missing (§5.10 Partial), and no copy changes. */}
            {report.unreadableAmounts > 0 && (
              <AdminNotice testId="costs-unreadable">{UNREADABLE_AMOUNTS(report.unreadableAmounts)}</AdminNotice>
            )}

            {report.sections.names === 'failed' && (
              <AdminNotice testId="costs-names-failed">{NAMES_FAILED}</AdminNotice>
            )}

            {report.sections.totals === 'failed' ? (
              <p data-testid="costs-totals-failed" className="text-sm text-red-300">
                {SECTION_FAILED}
              </p>
            ) : isEmpty ? (
              <AdminEmpty
                message={COSTS_EMPTY}
                hint={COSTS_EMPTY_HINT}
                testId="costs-empty"
                onClear={isDefault ? undefined : clear}
              />
            ) : (
              <>
                <ChargedInWindowSection report={report} />
                <PeriodsSection report={report} />
                <BreakdownsSection report={report} />
                <FallbackSection report={report} />
                <SpreadSection report={report} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Slice 4b: the on-demand leak check. Its own window (at most 7 days) and
          button; it follows the business chosen above. */}
      <LeakCheckPanel accountId={filters.account} accountLabel={businessName} />
    </div>
  );
}
