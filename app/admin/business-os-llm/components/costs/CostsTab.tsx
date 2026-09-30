'use client';

/**
 * The Costs & credits tab of the Business OS AI admin page (credit deduction
 * slice 4a, workplan §4.6): the operator cost report.
 *
 * Read-only: one `GET` to `/api/admin/business-os/credits/report`, and the
 * leak check panel's own `GET` (slice 4b), run only when its button is pressed. No `@/lib/` import (the page's source guard): the payload types are
 * re-declared in `../../costTypes.ts`.
 *
 * The account filter is a choice from the accounts the report itself returned
 * (SA S-5: no business-name search). The list is kept from the last
 * all-accounts read, so narrowing to one account does not empty the picker.
 *
 * Only the NEWEST request may set the screen (SA CR-N2): each read takes a
 * sequence number and aborts the one before it, so a slow earlier response can
 * never overwrite a later window. A failed read clears the report instead of
 * leaving the previous window's figures under the error, where they would read
 * as current.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';

import { formatInstant } from '../../format';
import { formatCount, utcDateDaysAgo } from '../../costFormat';
import {
  COSTS_EMPTY,
  COSTS_EMPTY_HINT,
  COSTS_INCOMPLETE,
  COSTS_INTRO,
  COSTS_PERIOD_RULE,
  INCOMPLETE_REASON_TEXT,
  NAMES_FAILED,
  SECTION_FAILED,
  UNREADABLE_AMOUNTS,
} from '../../costCopy';
import type { CostReportPayload } from '../../costTypes';
import { BreakdownsSection, FallbackSection, PeriodsSection, SpreadSection } from './CostsSections';
import { LeakCheckPanel } from './LeakCheckPanel';

const REPORT_URL = '/api/admin/business-os/credits/report';
const PRESETS = [7, 30, 90] as const;
type Preset = (typeof PRESETS)[number] | 'custom';

interface Query {
  from: string;
  to: string;
  accountId: string;
}

function presetQuery(days: number, accountId: string): Query {
  return { from: utcDateDaysAgo(days - 1), to: utcDateDaysAgo(0), accountId };
}

export function CostsTab() {
  const [preset, setPreset] = useState<Preset>(30);
  const [query, setQuery] = useState<Query>(() => presetQuery(30, ''));
  const [customFrom, setCustomFrom] = useState(query.from);
  const [customTo, setCustomTo] = useState(query.to);
  const [payload, setPayload] = useState<CostReportPayload | null>(null);
  const [accounts, setAccounts] = useState<CostReportPayload['accounts']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (q: Query) => {
    const mine = ++sequence.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const isCurrent = () => mine === sequence.current;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: q.from, to: q.to });
      if (q.accountId) params.set('accountId', q.accountId);
      const response = await fetch(`${REPORT_URL}?${params.toString()}`, { signal: controller.signal });
      const body = await response.json();
      if (!isCurrent()) return;
      if (!response.ok || !body?.success) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not read the cost report');
      }
      const data = body.data as CostReportPayload;
      setPayload(data);
      // Keep the picker's list from an all-accounts read only.
      if (!q.accountId) setAccounts(data.accounts);
    } catch (err) {
      // A superseded (or aborted) request says nothing about the screen.
      if (!isCurrent()) return;
      setPayload(null);
      setError(err instanceof Error ? err.message : 'Could not read the cost report');
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

  const choosePreset = (days: (typeof PRESETS)[number]) => {
    setPreset(days);
    setQuery((q) => presetQuery(days, q.accountId));
  };

  const applyCustom = () => {
    setPreset('custom');
    setQuery((q) => ({ from: customFrom, to: customTo, accountId: q.accountId }));
  };

  const report = payload;
  const isEmpty = report !== null && report.sections.totals === 'ok' && report.periods.length === 0;
  const chosenAccountLabel = accounts.find((a) => a.accountId === query.accountId)?.companyName ?? null;

  return (
    <div className="space-y-4" data-testid="costs-tab">
      <p className="max-w-3xl text-sm text-slate-400">{COSTS_INTRO}</p>

      <div className="flex flex-wrap items-end gap-3" data-testid="costs-controls">
        <div className="flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Window">
          {PRESETS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => choosePreset(days)}
              aria-pressed={preset === days}
              className={`rounded-md px-3 py-1 text-xs ${
                preset === days ? 'bg-purple-500/20 text-purple-200' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              Last {days} days
            </button>
          ))}
        </div>

        <label className="flex flex-col text-[11px] text-slate-400">
          From (UTC)
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          />
        </label>
        <label className="flex flex-col text-[11px] text-slate-400">
          To (UTC)
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          />
        </label>
        <button
          type="button"
          onClick={applyCustom}
          className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
        >
          Apply dates
        </button>

        <label className="flex flex-col text-[11px] text-slate-400">
          Account
          <select
            value={query.accountId}
            onChange={(e) => setQuery((q) => ({ ...q, accountId: e.target.value }))}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            data-testid="costs-account-filter"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.companyName ?? a.accountId}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-3">
          {report && formatInstant(report.generatedAt) && (
            <span className="text-xs text-slate-500">read at {formatInstant(report.generatedAt)}</span>
          )}
          <button
            type="button"
            onClick={() => void load(query)}
            disabled={loading}
            title="Re-read the cost report"
            aria-label="Re-read the cost report"
            className="rounded-lg border border-slate-700 p-2 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 text-slate-400 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <div
          data-testid="costs-error"
          className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading && !report && (
        <div data-testid="costs-loading" className="flex items-center gap-3 py-12 text-slate-300">
          <RefreshCw className="h-6 w-6 animate-spin text-purple-500" aria-hidden="true" />
          Reading the cost report&hellip;
        </div>
      )}

      {report && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500" data-testid="costs-window">
            {report.window.from} to {report.window.to} (UTC)
            {report.rowsRead !== null && <> &middot; {formatCount(report.rowsRead)} ledger rows read</>}
            {' · '}
            {COSTS_PERIOD_RULE(report.periodLookbackDays)}
          </p>

          {report.incomplete && (
            <div
              data-testid="costs-incomplete"
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {COSTS_INCOMPLETE}{' '}
                <span className="text-amber-300/80">
                  ({report.incompleteReasons.map((r) => INCOMPLETE_REASON_TEXT[r] ?? r).join(', ')})
                </span>
              </span>
            </div>
          )}

          {report.unreadableAmounts > 0 && (
            <p data-testid="costs-unreadable" className="text-xs text-amber-300">
              {UNREADABLE_AMOUNTS(report.unreadableAmounts)}
            </p>
          )}

          {report.sections.names === 'failed' && (
            <p data-testid="costs-names-failed" className="text-xs text-amber-300">
              {NAMES_FAILED}
            </p>
          )}

          {report.sections.totals === 'failed' ? (
            <p data-testid="costs-totals-failed" className="text-sm text-red-300">
              {SECTION_FAILED}
            </p>
          ) : isEmpty ? (
            <div data-testid="costs-empty" className="rounded-xl border border-slate-700 bg-slate-800/40 p-8 text-center">
              <p className="text-sm font-medium text-slate-200">{COSTS_EMPTY}</p>
              <p className="mt-1 text-xs text-slate-400">{COSTS_EMPTY_HINT}</p>
            </div>
          ) : (
            <>
              <PeriodsSection report={report} />
              <BreakdownsSection report={report} />
              <FallbackSection report={report} />
              <SpreadSection report={report} />
            </>
          )}
        </div>
      )}

      {/* Slice 4b: the on-demand leak check. Its own window (at most 7 days) and
          button; it follows the account chosen above. */}
      <LeakCheckPanel accountId={query.accountId} accountLabel={chosenAccountLabel} />
    </div>
  );
}
