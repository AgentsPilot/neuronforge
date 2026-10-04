'use client';

/**
 * The Activity tab of the Business OS AI admin page (Gap B slice B1a): one row
 * per Business OS AI action, read from the credit ledger.
 *
 * Read-only: one `GET` to `/api/admin/business-os/ai-activity`, plus the
 * reused business picker's own `GET`. No `@/lib/` import (the page's source
 * guard): the payload types are re-declared in `../../activityTypes.ts`, and
 * the areas arrive in the payload.
 *
 * Only the NEWEST request may set the screen (the Costs tab's CR-N2 pattern):
 * each read takes a sequence number and aborts the one before it. A failed
 * read clears the list instead of leaving the previous window's rows under
 * the error, where they would read as current.
 *
 * A platform account chosen in the picker is refused by the route (409); the
 * tab says why in its own words instead of a generic error (SA-B1-5).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';

import { formatInstant } from '../../format';
import {
  ACTIVITY_EMPTY,
  ACTIVITY_ERROR_FALLBACK,
  ACTIVITY_INTRO,
  ACTIVITY_LOADING,
  ADJUSTMENTS_FAILED,
  NAMES_FAILED,
  PLATFORM_ACCOUNT_ERROR,
  TIMES_ARE_UTC,
  UNREADABLE_AMOUNTS,
  UNRESOLVED_ADJUSTMENTS,
} from '../../activityCopy';
import { resolvePreset, type ActivityPreset } from '../../activityPresets';
import type { ActivityAreaOption, ActivityPayload } from '../../activityTypes';
import { ActivityCountLine } from './ActivityCountLine';
import { ActivityFilters, type ActivityQuery } from './ActivityFilters';
import { ActivityTable } from './ActivityTable';
import { CutoverNotice } from './CutoverNotice';
import { DeletedAccountsBucket } from './DeletedAccountsBucket';

const ACTIVITY_URL = '/api/admin/business-os/ai-activity';
const DEFAULT_PRESET: ActivityPreset = 'this_month';

interface ActivityError {
  kind: 'platform_account' | 'other';
  message: string;
}

function initialQuery(): ActivityQuery {
  return {
    ...resolvePreset(DEFAULT_PRESET, new Date()),
    accountId: '',
    area: '',
    outcome: '',
    trigger: '',
    minCostUsd: '',
    sort: 'time',
  };
}

/** Only what is set: the route refuses empty values rather than guessing at them. */
function searchOf(q: ActivityQuery): string {
  const params = new URLSearchParams({ from: q.from, to: q.to, sort: q.sort });
  if (q.accountId) params.set('accountId', q.accountId);
  if (q.area) params.set('area', q.area);
  if (q.outcome) params.set('outcome', q.outcome);
  if (q.trigger) params.set('trigger', q.trigger);
  if (q.minCostUsd) params.set('minCostUsd', q.minCostUsd);
  return params.toString();
}

export function ActivityTab() {
  const [preset, setPreset] = useState<ActivityPreset | 'custom'>(DEFAULT_PRESET);
  const [query, setQuery] = useState<ActivityQuery>(initialQuery);
  const [payload, setPayload] = useState<ActivityPayload | null>(null);
  // Kept across reads, so the area filter does not empty while a read is in flight.
  const [areas, setAreas] = useState<ActivityAreaOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ActivityError | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (q: ActivityQuery) => {
    const mine = ++sequence.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const isCurrent = () => mine === sequence.current;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${ACTIVITY_URL}?${searchOf(q)}`, { signal: controller.signal });
      const body = await response.json();
      if (!isCurrent()) return;
      if (!response.ok || !body?.success) {
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
    } catch (err) {
      // A superseded (or aborted) request says nothing about the screen.
      if (!isCurrent()) return;
      setPayload(null);
      setError({ kind: 'other', message: err instanceof Error ? err.message : ACTIVITY_ERROR_FALLBACK });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  // Unmounting abandons the last read; nothing may set state afterwards.
  useEffect(
    () => () => {
      sequence.current += 1;
      inFlight.current?.abort();
    },
    []
  );

  const choosePreset = (p: ActivityPreset) => {
    setPreset(p);
    setQuery((q) => ({ ...q, ...resolvePreset(p, new Date()) }));
  };

  const change = (patch: Partial<ActivityQuery>, custom?: boolean) => {
    if (custom) setPreset('custom');
    setQuery((q) => ({ ...q, ...patch }));
  };

  const accountLabel =
    payload && query.accountId && payload.filters.accountId === query.accountId
      ? payload.rows.find((r) => r.companyName)?.companyName ?? null
      : null;
  const entirelyBefore = payload?.cutover.coverage === 'entirely_before_cutover';

  return (
    <div className="space-y-4" data-testid="activity-tab">
      <p className="max-w-3xl text-sm text-slate-400">
        {ACTIVITY_INTRO} {TIMES_ARE_UTC}
      </p>

      <div className="flex items-start gap-3">
        <div className="flex-1">
          <ActivityFilters
            query={query}
            preset={preset}
            areas={areas}
            accountLabel={accountLabel}
            onPreset={choosePreset}
            onChange={change}
          />
        </div>
        <div className="flex items-center gap-3">
          {payload && formatInstant(payload.generatedAt) && (
            <span className="text-xs text-slate-500">read at {formatInstant(payload.generatedAt)}</span>
          )}
          <button
            type="button"
            onClick={() => void load(query)}
            disabled={loading}
            title="Re-read the AI activity"
            aria-label="Re-read the AI activity"
            className="rounded-lg border border-slate-700 p-2 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 text-slate-400 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <div
          data-testid={error.kind === 'platform_account' ? 'activity-platform-account' : 'activity-error'}
          className={`flex items-start gap-2 rounded-lg border p-4 text-sm ${
            error.kind === 'platform_account'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-red-500/40 bg-red-500/10 text-red-200'
          }`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error.message}</span>
        </div>
      )}

      {loading && !payload && !error && (
        <div data-testid="activity-loading" className="flex items-center gap-3 py-12 text-slate-300">
          <RefreshCw className="h-6 w-6 animate-spin text-purple-500" aria-hidden="true" />
          {ACTIVITY_LOADING}
        </div>
      )}

      {payload && (
        <div className="space-y-3">
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
                  className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200"
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
                <div data-testid="activity-empty" className="rounded-xl border border-slate-700 bg-slate-800/40 p-8 text-center">
                  <p className="text-sm text-slate-200">{ACTIVITY_EMPTY}</p>
                </div>
              ) : (
                <ActivityTable rows={payload.rows} />
              )}

              {payload.deletedAccounts && <DeletedAccountsBucket bucket={payload.deletedAccounts} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
