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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Play, RefreshCw } from 'lucide-react';

import { formatInstant } from '../../format';
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

export interface LeakCheckPanelProps {
  /** The account chosen on the tab, or '' for every business. */
  accountId: string;
  /** Its business name, for the scope line. */
  accountLabel: string | null;
}

const STATUS_CLASS: Record<LeakAccountFindingWire['status'], string> = {
  leak: 'bg-red-500/15 text-red-200',
  could_not_check: 'bg-amber-500/15 text-amber-200',
  incomplete: 'bg-amber-500/15 text-amber-200',
  clean: 'bg-slate-700/60 text-slate-300',
};

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
            {e.firstCallAt && <> · first call {formatInstant(e.firstCallAt) ?? e.firstCallAt}</>}
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
      <tr className="border-t border-slate-800" data-testid={`leak-account-${finding.accountId}`}>
        <td className="py-1.5 pr-3 text-slate-200">{finding.companyName ?? finding.accountId}</td>
        <td className="py-1.5 pr-3">
          <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_CLASS[finding.status]}`} data-testid="leak-status">
            {LEAK_STATUS_TEXT[finding.status]}
          </span>
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
        <td className="py-1.5 pr-3 text-slate-300" data-testid="leak-period">
          {finding.periodStarts.length > 0 ? finding.periodStarts.map(formatDay).join(', ') : '—'}
        </td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{formatCount(c.uncharged)}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{formatCount(c.ungroupedCalls)}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{formatCount(c.undercharged)}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">
          {formatCount(c.pendingReconciliation)}
          {c.pendingUndercharged > 0 && <span className="text-amber-300"> ({formatCount(c.pendingUndercharged)} under)</span>}
        </td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{formatCount(c.knownPathCalls)}</td>
        <td className="py-1.5 text-right tabular-nums">{formatUsd(finding.usd.totalUncharged)}</td>
      </tr>
      {hasExamples && (
        <tr>
          <td colSpan={9} className="pb-2">
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
      <p className="text-xs text-slate-500" data-testid="leak-window">
        {formatInstant(result.window.start) ?? result.window.start} to {formatInstant(result.window.end) ?? result.window.end}{' '}
        &middot; {formatCount(result.accountsChecked)} business{result.accountsChecked === 1 ? '' : 'es'} checked &middot; read at{' '}
        {formatInstant(result.generatedAt) ?? result.generatedAt}
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300" data-testid="leak-accounts">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-1 pr-3 font-medium">{LEAK_COLUMNS.business}</th>
                <th className="pb-1 pr-3 font-medium">{LEAK_COLUMNS.status}</th>
                <th className="pb-1 pr-3 font-medium">{LEAK_COLUMNS.period}</th>
                <th className="pb-1 pr-3 text-right font-medium">{LEAK_COLUMNS.uncharged}</th>
                <th className="pb-1 pr-3 text-right font-medium">{LEAK_COLUMNS.ungrouped}</th>
                <th className="pb-1 pr-3 text-right font-medium">{LEAK_COLUMNS.undercharged}</th>
                <th className="pb-1 pr-3 text-right font-medium">{LEAK_COLUMNS.pending}</th>
                <th className="pb-1 pr-3 text-right font-medium">{LEAK_COLUMNS.known}</th>
                <th className="pb-1 text-right font-medium">{LEAK_COLUMNS.usd}</th>
              </tr>
            </thead>
            <tbody>
              {result.accounts.map((finding) => (
                <AccountRow key={finding.accountId} finding={finding} />
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-500">{LEAK_TWO_NIGHTS}</p>
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
  const [error, setError] = useState<string | null>(null);
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
      const response = await fetch(`${LEAK_URL}?${params.toString()}`, { signal: controller.signal });
      const body = await response.json();
      if (!isCurrent()) return;
      if (!response.ok || !body?.success) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not run the leak check');
      }
      setResult(body.data as LeakCheckPayload);
    } catch (err) {
      if (!isCurrent()) return;
      setResult(null);
      setError(err instanceof Error ? err.message : 'Could not run the leak check');
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
        <label className="flex flex-col text-[11px] text-slate-400">
          Check from (UTC)
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            data-testid="leak-from"
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          />
        </label>
        <label className="flex flex-col text-[11px] text-slate-400">
          Check to (UTC)
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            data-testid="leak-to"
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          data-testid="leak-run"
          className="flex items-center gap-1.5 rounded-lg border border-purple-500/50 bg-purple-500/15 px-3 py-1.5 text-xs text-purple-100 hover:bg-purple-500/25 disabled:opacity-50"
        >
          {running ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {running ? LEAK_RUNNING : LEAK_RUN}
        </button>
        <span className="text-[11px] text-slate-500" data-testid="leak-scope">
          {LEAK_SCOPE(accountId ? accountLabel ?? accountId : null)}
        </span>
      </div>

      {error && (
        <div
          data-testid="leak-error"
          className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!result && !error && !running && (
        <p className="text-xs text-slate-500" data-testid="leak-not-run">
          {LEAK_NOT_RUN}
        </p>
      )}

      {result && <Result result={result} />}
    </section>
  );
}
