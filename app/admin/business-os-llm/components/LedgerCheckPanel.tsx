'use client';

/**
 * FR-18 / FR-19 — the ledger check, and everything it cannot tell you.
 *
 * ── The panel writes no READINGS of its own ──────────────────────────────
 * Every reading, and the caveat, comes from
 * `lib/business-os/llm/ledgerCheckCopy.ts` — the same module the route imports,
 * deliberately NOT `server-only` so this component can share it. One string, so
 * a copy edit cannot soften the panel while the API keeps saying something
 * stronger.
 *
 * What this file DOES write is the framing around the three states that have no
 * reading: the two refusal headings, "no stored change to count from" and its
 * own failure line (QA DEF-S2-8 — the header used to say "every sentence",
 * which overclaimed). Even there the refusal's EXPLANATION is the route's own
 * sentence: a code for the machine, a sentence for the human.
 *
 * ── No green tick, in any branch ─────────────────────────────────────────
 * There is no success affordance anywhere below. The most positive reading this
 * panel can produce ("no calls completed since the change, and this area WAS
 * making calls before it") corroborates a switch; it does not prove one, and a
 * tick is read as proof from across the room.
 *
 * ── Why chat is not special-cased HERE ───────────────────────────────────
 * It would be easy to branch on the area name. The route already does it — it
 * short-circuits chat BEFORE any repository call and returns
 * `ledger_cannot_answer` — so this component asks the route and renders the
 * kind it is given. The client therefore holds no knowledge of which areas the
 * ledger can see, and cannot fall out of step with the one that decides.
 *
 * ── RC-D: a 400 is not an error ──────────────────────────────────────────
 * The check is bounded to a change made in the last 24 hours. Every stored row
 * is older than that, so on load this panel takes the refusal branch for every
 * area — which is correct, and is rendered as "too long ago to check" in the
 * same neutral tone as any other reading. Rendering it red would be the panel
 * complaining loudly about its own design.
 */

import { useCallback, useEffect, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';

import {
  LEDGER_READINGS_WITH_COUNTS,
  type LedgerReadingKind,
} from '@/lib/business-os/llm/ledgerCheckCopy';

import { PROPAGATION_NOTE } from '../copy';
import { formatInstant, toSinceParam } from '../format';
import type { LedgerCheckData } from '../types';

type PanelState =
  | { status: 'no_change' }
  | { status: 'loading' }
  | { status: 'reading'; data: LedgerCheckData }
  /** The route declined to answer for this change. Neutral, not an error. */
  | { status: 'cannot_check'; heading: string; explanation: string; retryable: boolean }
  | { status: 'failed' };

/** The route's machine-readable refusal reasons, in the operator's words. */
const CANNOT_CHECK_HEADINGS = {
  too_long_ago: 'Too long ago to check',
  since_in_future: 'That change time is in the future',
} as const;

type CannotCheckReason = keyof typeof CANNOT_CHECK_HEADINGS;

/**
 * Narrowed rather than indexed off an untyped body: the `??` fallback is meant
 * to be a decision about codes that do not exist yet — a third one added in
 * slice 3 degrades to a neutral heading instead of to an error — and indexing
 * a `Record<string, string>` would quietly make it a typo-swallower too.
 */
function isKnownReason(value: unknown): value is CannotCheckReason {
  return typeof value === 'string' && value in CANNOT_CHECK_HEADINGS;
}

function hasCounts(kind: string): boolean {
  return (LEDGER_READINGS_WITH_COUNTS as readonly string[]).includes(kind as LedgerReadingKind);
}

function WindowCounts({ data }: { data: LedgerCheckData }) {
  if (!hasCounts(data.kind) || !data.after || !data.before) return null;
  const latest = formatInstant(data.after.latestAt ?? data.before.latestAt);
  return (
    <dl data-testid="ledger-counts" className="grid gap-2 text-xs sm:grid-cols-3">
      <div>
        <dt className="text-slate-500">Completed since the change</dt>
        <dd className="text-slate-200">{data.after.count}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Completed in the same length of time before it</dt>
        <dd className="text-slate-200">{data.before.count}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Latest call seen</dt>
        <dd className="text-slate-200">{latest ?? 'none in either window'}</dd>
      </div>
    </dl>
  );
}

export function LedgerCheckPanel({ area, since }: { area: string; since: string | null }) {
  const [state, setState] = useState<PanelState>(
    since ? { status: 'loading' } : { status: 'no_change' }
  );

  const run = useCallback(async () => {
    if (!since) {
      setState({ status: 'no_change' });
      return;
    }
    const sinceParam = toSinceParam(since);
    if (!sinceParam) {
      setState({
        status: 'cannot_check',
        heading: 'No usable change time',
        explanation:
          'The stored row carries no readable timestamp, so there is no point to count from.',
        retryable: false,
      });
      return;
    }

    setState({ status: 'loading' });
    try {
      const response = await fetch(
        `/api/admin/business-os/llm-settings/ledger?area=${encodeURIComponent(area)}` +
          `&since=${encodeURIComponent(sinceParam)}`
      );
      const body = await response.json();

      if (response.ok && body?.success) {
        setState({ status: 'reading', data: body.data as LedgerCheckData });
        return;
      }

      if (response.status === 400) {
        const reason: unknown = body?.reason;
        setState({
          status: 'cannot_check',
          heading: isKnownReason(reason)
            ? CANNOT_CHECK_HEADINGS[reason]
            : 'This check does not apply here',
          explanation: typeof body?.error === 'string' ? body.error : '',
          // A change only ever gets older, so re-asking can only produce the
          // same refusal. Every other refusal may change with the next read.
          retryable: reason !== 'too_long_ago',
        });
        return;
      }

      setState({ status: 'failed' });
    } catch {
      // The panel's own failure, reported as itself — never as a statement
      // about the area.
      setState({ status: 'failed' });
    }
  }, [area, since]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <section
      data-testid="ledger-panel"
      className="rounded-lg border border-slate-700 bg-slate-900/40 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Ledger check
        </h4>
        <button
          type="button"
          onClick={() => void run()}
          disabled={
            state.status === 'loading' ||
            state.status === 'no_change' ||
            (state.status === 'cannot_check' && !state.retryable)
          }
          className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
        >
          <RefreshCw
            className={`h-3 w-3 ${state.status === 'loading' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Check again
        </button>
      </div>

      {state.status === 'loading' && (
        <p className="text-xs text-slate-400">Reading the ledger&hellip;</p>
      )}

      {state.status === 'no_change' && (
        <p data-testid="ledger-no-change" className="text-xs text-slate-400">
          There is no stored change to count from, so there is nothing to check.
        </p>
      )}

      {state.status === 'failed' && (
        <p data-testid="ledger-failed" className="text-xs text-red-300">
          The ledger check itself could not be run. That says nothing about this area — try again.
        </p>
      )}

      {state.status === 'cannot_check' && (
        <div data-testid="ledger-cannot-check" className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            {state.heading}
          </p>
          <p className="text-xs leading-relaxed text-slate-400">{state.explanation}</p>
        </div>
      )}

      {state.status === 'reading' && (
        <div className="space-y-2">
          {/* The route's own sentence for this reading, verbatim. */}
          <p data-testid="ledger-reading" className="text-sm leading-relaxed text-slate-200">
            {state.data.reading}
          </p>
          <WindowCounts data={state.data} />
          {state.data.observationStartsAt && (
            <p className="text-xs text-slate-500">
              Counting from {formatInstant(state.data.observationStartsAt)}.
            </p>
          )}
          <p data-testid="ledger-caveat" className="text-xs leading-relaxed text-amber-300/80">
            {state.data.caveat}
          </p>
        </div>
      )}

      <p className="mt-2 border-t border-slate-800 pt-2 text-[11px] leading-relaxed text-slate-500">
        {PROPAGATION_NOTE}
      </p>
    </section>
  );
}
