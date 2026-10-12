'use client';

/**
 * The leak check panel on the Costs & credits tab (credit deduction slice 4b,
 * workplan §5.4): the on-demand door of the leak check.
 *
 * Read-only: one `GET` to `/api/admin/business-os/credits/leak-check`, only
 * when the admin presses the button (the check walks every business, so it is
 * never run on mount). No `@/lib/` import (the page's source guard): the
 * payload types are re-declared in `../../leakTypes.ts`.
 *
 * One run at a time: the button is disabled while a run is in flight. Only the
 * newest run may set the screen all the same (the CostsTab rule, SA CR-N2):
 * each run takes a sequence number and aborts the one before it, and an
 * unmount abandons it. A failed run clears the previous result instead of
 * leaving it under the error.
 *
 * Admin Layout Standard L-9b (§2.8): an on-demand check, not a page filter, so
 * it keeps its own form (dates and Run), restyled on the bar's field classes.
 * The body is read through the shared `readJsonBody` (F-67, leak half): a
 * network failure says the shared sentence, a non-JSON body says this panel's
 * own words, never a parser message, and a platform account (409
 * `platform_account`) gets the same sentence as the tab (SA M-2), without
 * "Try again" (Run is the retry). The code must be seen before any generic
 * copy, so the read keeps its own branching rather than `readAdminResponse`.
 * The account table is on the shared table classes (F-71, F-72) and its
 * statuses are `StatusChip`s (Q-5); the four verdict boxes stay as they are:
 * they are results of the run, not page states (Q-7).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Play, RefreshCw } from 'lucide-react';

import { ADMIN_FIELD_CONTROL, ADMIN_FIELD_LABEL } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminError, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';

import { COSTS_PLATFORM_ACCOUNT } from '../../costCopy';
import { formatCount, formatDay, formatUsd, utcDateDaysAgo } from '../../costFormat';
import {
  LEAK_BLIND_SPOTS_TITLE,
  LEAK_BLIND_SPOT_TEXT,
  LEAK_CASE_TEXT,
  LEAK_CLEAN,
  LEAK_COLUMNS,
  LEAK_DIRECTION_TEXT,
  LEAK_EMPTY_WINDOW,
  LEAK_END_CLAMPED,
  LEAK_EXAMPLES_TITLE,
  LEAK_FOUND,
  LEAK_INTRO,
  LEAK_KNOWN_PATHS_TITLE,
  LEAK_LISTING_FAILED,
  LEAK_NOT_RUN,
  LEAK_PARTIAL,
  LEAK_PLATFORM,
  LEAK_PLATFORM_ENV_IGNORED,
  LEAK_REASON_TEXT,
  LEAK_REMAINING,
  LEAK_ROW_NOTE,
  LEAK_RUN,
  LEAK_RUNNING,
  LEAK_SCOPE,
  LEAK_STATUS_TEXT,
  LEAK_TITLE,
  LEAK_TWO_NIGHTS,
} from '../../leakCopy';
import type { LeakAccountFindingWire, LeakCheckPayload, LeakGroupExampleWire } from '../../leakTypes';

const LEAK_URL = '/api/admin/business-os/credits/leak-check';

/** Kept words: the panel's fallback when the route gives no reason of its own. */
const LEAK_ERROR_FALLBACK = 'Could not run the leak check';

export interface LeakCheckPanelProps {
  /** The account chosen on the tab, or '' for every business. */
  accountId: string;
  /** Its business name, for the scope line. */
  accountLabel: string | null;
}

/**
 * §5.9 tones (SA Q-5): a leak is `danger`; "could not check" is `unknown`; a
 * partly read account is `warn`; a clean row stays `neutral` so the green
 * verdict box carries the result and a long table is not a wall of green.
 */
const STATUS_TONE: Record<LeakAccountFindingWire['status'], StatusTone> = {
  leak: 'danger',
  could_not_check: 'unknown',
  incomplete: 'warn',
  clean: 'neutral',
};

/** Why the last run failed: the platform-account case is a notice, anything else an error. */
interface LeakError {
  kind: 'platform_account' | 'other';
  message: string;
}

function ExampleList({ title, items }: { title: string; items: LeakGroupExampleWire[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-slate-300">{title}</p>
      <ul className="space-y-0.5 font-mono text-[11px] text-slate-400">
        {items.map((e) => (
          <li key={`${title}-${e.groupId}`} data-testid="leak-example">
            {e.groupId} · {formatCount(e.calls)} call{e.calls === 1 ? '' : 's'} · recorded {formatUsd(e.usageUsd)} · charged{' '}
            {formatUsd(e.chargedUsd)}
            {e.firstCallAt && <> · first call {formatUtc(e.firstCallAt)}</>}
            {e.direction && <> · {LEAK_DIRECTION_TEXT[e.direction]}</>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccountRow({ finding }: { finding: LeakAccountFindingWire }) {
  const c = finding.counts;
  // QA4b-E1: an account can be listed only for these, with every column at zero.
  const note = LEAK_ROW_NOTE(c);
  const hasExamples =
    finding.examples.uncharged.length +
      finding.examples.undercharged.length +
      finding.examples.pendingReconciliation.length +
      finding.examples.chargedAboveUsage.length >
    0;
  return (
    <>
      <tr data-testid={`leak-account-${finding.accountId}`}>
        <td className={`${ADMIN_TD} text-slate-200`}>{finding.companyName ?? finding.accountId}</td>
        <td className={ADMIN_TD}>
          <StatusChip tone={STATUS_TONE[finding.status]} testId="leak-status">
            {LEAK_STATUS_TEXT[finding.status]}
          </StatusChip>
          {finding.reasons.length > 0 && (
            <span className="ml-2 text-[11px] text-amber-300/80">
              {finding.reasons.map((r) => LEAK_REASON_TEXT[r] ?? r).join(', ')}
            </span>
          )}
          {note && (
            <span className="ml-2 text-[11px] text-slate-400" data-testid="leak-row-note">
              {note}
            </span>
          )}
        </td>
        <td className={`${ADMIN_TD} whitespace-nowrap`} data-testid="leak-period">
          {finding.periodStarts.length > 0 ? finding.periodStarts.map(formatDay).join(', ') : '—'}
        </td>
        <td className={ADMIN_TD_NUM}>{formatCount(c.uncharged)}</td>
        <td className={ADMIN_TD_NUM}>{formatCount(c.ungroupedCalls)}</td>
        <td className={ADMIN_TD_NUM}>{formatCount(c.undercharged)}</td>
        <td className={ADMIN_TD_NUM}>
          {formatCount(c.pendingReconciliation)}
          {c.pendingUndercharged > 0 && <span className="text-amber-300"> ({formatCount(c.pendingUndercharged)} under)</span>}
        </td>
        <td className={ADMIN_TD_NUM}>{formatCount(c.knownPathCalls)}</td>
        <td className={ADMIN_TD_NUM}>{formatUsd(finding.usd.totalUncharged)}</td>
      </tr>
      {hasExamples && (
        <tr>
          <td colSpan={9} className={ADMIN_TD}>
            <details className="rounded border border-slate-800 bg-slate-900/40 p-2">
              <summary className="cursor-pointer text-[11px] text-slate-400">{LEAK_EXAMPLES_TITLE}</summary>
              <div className="mt-2 space-y-2">
                <ExampleList title={LEAK_CASE_TEXT.uncharged} items={finding.examples.uncharged} />
                <ExampleList title={LEAK_CASE_TEXT.undercharged} items={finding.examples.undercharged} />
                <ExampleList title={LEAK_CASE_TEXT.pendingReconciliation} items={finding.examples.pendingReconciliation} />
                <ExampleList title={LEAK_CASE_TEXT.chargedAboveUsage} items={finding.examples.chargedAboveUsage} />
              </div>
            </details>
          </td>
        </tr>
      )}
    </>
  );
}

function Result({ result }: { result: LeakCheckPayload }) {
  const partial =
    result.accountsIncomplete > 0 || result.accountsNotChecked > 0 || result.accountsRemaining > 0 || result.listingFailed;
  // CR4b-N2 / QA4b-E2: the settle clamp can pull the end back to the start
  // (e.g. from = to = today in the first minutes after 00:00 UTC). Nothing was
  // examined, so that is not a clean result.
  const emptyWindow = Date.parse(result.window.end) <= Date.parse(result.window.start);
  const knownPaths = new Map<string, { feature: string; component: string; calls: number; usageUsd: number }>();
  for (const account of result.accounts) {
    for (const path of account.knownPaths) {
      const key = `${path.feature}|${path.component}`;
      const entry = knownPaths.get(key) ?? { ...path, calls: 0, usageUsd: 0 };
      entry.calls += path.calls;
      entry.usageUsd += path.usageUsd;
      knownPaths.set(key, entry);
    }
  }

  return (
    <div className="space-y-3" data-testid="leak-result">
      <p className="text-xs text-slate-400" data-testid="leak-window">
        {formatUtc(result.window.start)} to {formatUtc(result.window.end)}{' '}
        &middot; {formatCount(result.accountsChecked)} business{result.accountsChecked === 1 ? '' : 'es'} checked &middot; read at{' '}
        {formatUtc(result.generatedAt)}
      </p>

      {result.accountsWithLeak > 0 ? (
        <div
          data-testid="leak-verdict-found"
          className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{LEAK_FOUND(result.accountsWithLeak, formatUsd(result.totals.unchargedUsd))}</span>
        </div>
      ) : emptyWindow ? (
        <div
          data-testid="leak-verdict-empty"
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-slate-800/60 p-3 text-sm text-amber-100"
        >
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{LEAK_EMPTY_WINDOW}</span>
        </div>
      ) : partial ? (
        <div
          data-testid="leak-verdict-partial"
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{LEAK_PARTIAL}</span>
        </div>
      ) : (
        <div
          data-testid="leak-verdict-clean"
          className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{LEAK_CLEAN}</span>
        </div>
      )}

      {result.accountsWithLeak > 0 && partial && (
        <p className="text-xs text-amber-300" data-testid="leak-also-partial">
          {LEAK_PARTIAL}
        </p>
      )}
      {result.listingFailed && (
        <p className="text-xs text-amber-300" data-testid="leak-listing-failed">
          {LEAK_LISTING_FAILED}
        </p>
      )}
      {result.accountsRemaining > 0 && (
        <p className="text-xs text-amber-300" data-testid="leak-remaining">
          {LEAK_REMAINING(result.accountsRemaining)}
        </p>
      )}
      {result.endClamped && (
        <p className="text-xs text-slate-400" data-testid="leak-end-clamped">
          {LEAK_END_CLAMPED}
        </p>
      )}

      {result.accounts.length > 0 && (
        <div>
          <div className={ADMIN_TABLE_WRAP}>
            <table className={ADMIN_TABLE} data-testid="leak-accounts" aria-label="Leak check by business">
              <thead className={ADMIN_THEAD}>
                <tr>
                  <th scope="col" className={ADMIN_TH}>{LEAK_COLUMNS.business}</th>
                  <th scope="col" className={ADMIN_TH}>{LEAK_COLUMNS.status}</th>
                  <th scope="col" className={ADMIN_TH}>{LEAK_COLUMNS.period}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{LEAK_COLUMNS.uncharged}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{LEAK_COLUMNS.ungrouped}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{LEAK_COLUMNS.undercharged}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{LEAK_COLUMNS.pending}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{LEAK_COLUMNS.known}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{LEAK_COLUMNS.usd}</th>
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {result.accounts.map((finding) => (
                  <AccountRow key={finding.accountId} finding={finding} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{LEAK_TWO_NIGHTS}</p>
        </div>
      )}

      {knownPaths.size > 0 && (
        <div className="space-y-1" data-testid="leak-known-paths">
          <p className="text-xs font-medium text-slate-300">{LEAK_KNOWN_PATHS_TITLE}</p>
          <ul className="text-xs text-slate-400">
            {[...knownPaths.values()].map((p) => (
              <li key={`${p.feature}|${p.component}`}>
                {p.feature} / {p.component}: {formatCount(p.calls)} call{p.calls === 1 ? '' : 's'}, {formatUsd(p.usageUsd)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.accountId === null && (
        <p className="text-xs text-slate-400" data-testid="leak-platform">
          {LEAK_PLATFORM(result.platform.businessOsCalls, result.platform.helperLabelCalls)}
          {result.platform.envIgnored && <span className="text-amber-300"> {LEAK_PLATFORM_ENV_IGNORED}</span>}
        </p>
      )}

      <details className="rounded border border-slate-800 p-2" data-testid="leak-blind-spots">
        <summary className="cursor-pointer text-xs text-slate-400">{LEAK_BLIND_SPOTS_TITLE}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-400">
          {result.blindSpots.map((spot) => (
            <li key={spot}>{LEAK_BLIND_SPOT_TEXT[spot] ?? spot}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function LeakCheckPanel({ accountId, accountLabel }: LeakCheckPanelProps) {
  const yesterday = utcDateDaysAgo(1);
  const [from, setFrom] = useState(yesterday);
  const [to, setTo] = useState(yesterday);
  const [result, setResult] = useState<LeakCheckPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<LeakError | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    const mine = ++sequence.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const isCurrent = () => mine === sequence.current;

    setRunning(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (accountId) params.set('accountId', accountId);
      let response: Response;
      try {
        response = await fetch(`${LEAK_URL}?${params.toString()}`, { signal: controller.signal });
      } catch {
        // A superseded (or aborted) run says nothing about the screen. A
        // network failure says the shared words, never the browser's (§5.10).
        if (!isCurrent()) return;
        setResult(null);
        setError({ kind: 'other', message: ADMIN_NETWORK_ERROR });
        return;
      }
      // Never throws: a non-JSON body reads as null and gets the kept words.
      // Newest wins before any setState (SA S-7).
      const body = await readJsonBody(response);
      if (!isCurrent()) return;
      if (!response.ok || body === null || body.success !== true) {
        setResult(null);
        setError(
          body?.error === 'platform_account'
            ? { kind: 'platform_account', message: COSTS_PLATFORM_ACCOUNT }
            : { kind: 'other', message: typeof body?.error === 'string' ? body.error : LEAK_ERROR_FALLBACK }
        );
        return;
      }
      setResult(body.data as LeakCheckPayload);
    } finally {
      if (isCurrent()) setRunning(false);
    }
  }, [from, to, accountId]);

  // Unmounting abandons the last run; nothing may set state afterwards.
  useEffect(
    () => () => {
      sequence.current += 1;
      inFlight.current?.abort();
    },
    []
  );

  return (
    <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/30 p-4" data-testid="leak-panel">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">{LEAK_TITLE}</h3>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">{LEAK_INTRO}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className={ADMIN_FIELD_LABEL}>Check from (UTC)</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            data-testid="leak-from"
            className={`${ADMIN_FIELD_CONTROL} w-40`}
          />
        </label>
        <label>
          <span className={ADMIN_FIELD_LABEL}>Check to (UTC)</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            data-testid="leak-to"
            className={`${ADMIN_FIELD_CONTROL} w-40`}
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          data-testid="leak-run"
          className="flex items-center gap-1.5 rounded-lg border border-purple-500/50 bg-purple-500/15 px-3 py-1.5 text-sm text-purple-100 hover:bg-purple-500/25 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        >
          {running ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {running ? LEAK_RUNNING : LEAK_RUN}
        </button>
        <span className="pb-2 text-[11px] text-slate-400" data-testid="leak-scope">
          {LEAK_SCOPE(accountId ? accountLabel ?? accountId : null)}
        </span>
      </div>

      {/* No "Try again": Run is the retry. */}
      {error &&
        (error.kind === 'platform_account' ? (
          <AdminNotice testId="leak-platform-account">{error.message}</AdminNotice>
        ) : (
          <AdminError testId="leak-error" message={error.message} />
        ))}

      {!result && !error && !running && (
        <p className="text-xs text-slate-400" data-testid="leak-not-run">
          {LEAK_NOT_RUN}
        </p>
      )}

      {result && <Result result={result} />}
    </section>
  );
}
