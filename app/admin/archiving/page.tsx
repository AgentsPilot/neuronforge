'use client';

/**
 * Archiving — how much of the audit trail is old enough to move out, under each
 * retention choice, and what earlier runs archived. Read-only (Slice 2a).
 *
 * ── Why this page adds no guard of its own ──────────────────────────────────
 * `app/admin/layout.tsx` awaits `requireAdminPage()` before this page's RSC
 * payload is produced, and a page cannot skip its parent layout. Protection is
 * a property of the route tree. A second check here would read as though the
 * first were optional (condition C-2).
 *
 * ── Why nothing here can start a run ────────────────────────────────────────
 * The route that starts a run arrives in Slice 2b, and runs stay switched off
 * until Slice 3 (C-5). The Archive button is disabled with no handler, and the
 * only request this page makes is the overview GET (AC-15).
 *
 * ── The archive side (Slice 2a) ─────────────────────────────────────────────
 * The archived total, the "archived before" cutoff, the last run and the run
 * history are read from the tables migration M1 creates, so a 0 or "No runs
 * yet" is now a measured fact, not a guess. Each run's status is a text badge,
 * never colour alone (§7 accessibility). A `running` run whose request has died
 * shows as "Stalled"; Slice 2b adds the Continue that recovers it.
 *
 * ── The dropdown ────────────────────────────────────────────────────────────
 * The overview carries the eligible count for every option, so changing the
 * retention is local state only, with no refetch (C-9d). The options come from
 * the same constant the server's Zod schema is built from (FR-2).
 *
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { AlertCircle, Archive, History, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_RETENTION_DAYS,
  RETENTION_DAYS_OPTIONS,
  isRetentionDays,
  type RetentionDays,
} from '@/lib/archiving/config';
import type {
  ArchiveRunSummary,
  ArchiveSourceOverview,
  ArchivingOverview,
} from '@/lib/archiving/types';

const LOAD_FAILED = 'Could not read the archiving overview';

/**
 * A run's status as the admin reads it: a word first, colour second. The `!`
 * overrides follow the dark-shell rule explained at `DARK_SELECT`.
 */
function statusBadge(run: ArchiveRunSummary): { label: string; className: string } {
  if (run.status === 'running' && run.isStale) {
    return { label: 'Stalled', className: '!bg-amber-500/20 !text-amber-300' };
  }
  switch (run.status) {
    case 'running':
      return { label: 'Running', className: '!bg-sky-500/20 !text-sky-300' };
    case 'succeeded':
      return { label: 'Succeeded', className: '!bg-emerald-500/20 !text-emerald-300' };
    case 'partial':
      return { label: 'Partial', className: '!bg-amber-500/20 !text-amber-300' };
    case 'failed':
      return { label: 'Failed', className: '!bg-rose-500/20 !text-rose-300' };
  }
}

function RunStatus({ run }: { run: ArchiveRunSummary }) {
  const { label, className } = statusBadge(run);
  return (
    <Badge data-testid={`run-status-${run.id}`} className={`!rounded ${className}`}>
      {label}
    </Badge>
  );
}

/**
 * Dark colours for the shared Select on the admin shell (SA Q-4). The primitive
 * falls back to light colours because the admin shell does not load the
 * `--v2-*` tokens, and `cn()` concatenates rather than merges classes, so a
 * plain `bg-slate-800` would race `bg-[var(--v2-bg,white)]` on CSS order. The
 * `!` modifier makes the override deterministic without editing the primitive.
 */
const DARK_SELECT = '!border-slate-600 !bg-slate-800 !text-slate-100';

/** `2025-09-26 14:05 UTC`. Always UTC: the cutoff is a UTC instant (FR-3). */
function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export default function ArchivingPage() {
  const [overview, setOverview] = useState<ArchivingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/archiving');
      // A non-JSON reply (an HTML 504 from the edge, say) must not surface the
      // parser's message; it falls through to the friendly text below.
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        throw new Error(typeof body?.error === 'string' ? body.error : LOAD_FAILED);
      }
      setOverview(body.data as ArchivingOverview);
    } catch (err) {
      // A failed refresh must not leave the previous counts looking current.
      setOverview(null);
      setError(err instanceof Error ? err.message : LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
          <div>
            <div className="mb-1 flex items-center gap-3">
              <h1 className="text-xl font-semibold text-white">Archiving</h1>
              <Badge className="!rounded !bg-purple-500/20 !text-purple-400">Read-only</Badge>
            </div>
            <p className="max-w-3xl text-sm text-slate-400">
              How many old records each source holds, and how many would move to the archive under
              each retention choice. Archiving keeps the live tables small; nothing is lost.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div
          data-testid="page-error"
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden="true" />
          <div>
            <p className="text-sm text-rose-100">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-sm text-rose-200 underline hover:text-white"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loading && !overview && <p className="text-sm text-slate-400">Reading the counts…</p>}

      {overview && (
        <>
          {overview.sources.map((source) => (
            <SourceCard key={source.key} source={source} />
          ))}

          <section
            data-testid="run-history-panel"
            className="rounded-lg border border-slate-700 bg-slate-800/40 p-4"
          >
            <header className="mb-3 border-b border-slate-700 pb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <History className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Run history
              </h2>
            </header>
            <RunHistory runs={overview.runs} />
          </section>
        </>
      )}
    </div>
  );
}

function SourceCard({ source }: { source: ArchiveSourceOverview }) {
  const [retentionDays, setRetentionDays] = useState<RetentionDays>(DEFAULT_RETENTION_DAYS);
  const labelId = useId();
  const noteId = useId();

  const selected = source.options.find((option) => option.retentionDays === retentionDays);

  return (
    <section
      data-testid={`source-${source.key}`}
      className="rounded-lg border border-slate-700 bg-slate-800/40 p-4"
    >
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Archive className="h-4 w-4 text-slate-400" aria-hidden="true" />
        {source.label}
      </h2>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Rows now</dt>
          <dd data-testid="total-rows" className="mt-1 text-lg font-semibold text-slate-100">
            {formatCount(source.totalRows)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Oldest record</dt>
          <dd data-testid="oldest-record" className="mt-1 text-sm text-slate-200">
            {source.oldestRecordAt ? formatUtc(source.oldestRecordAt) : 'No records'}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Archived total</dt>
          <dd data-testid="archived-total" className="mt-1 text-lg font-semibold text-slate-100">
            {formatCount(source.archivedTotal)}
          </dd>
          <dd data-testid="archived-before" className="text-xs text-slate-400">
            {source.latestCutoff
              ? `Everything before ${formatUtc(source.latestCutoff)} is archived`
              : 'Archived before: none yet'}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Last run</dt>
          <dd data-testid="last-run" className="mt-1 text-sm text-slate-200">
            {source.lastRun ? (
              <span className="flex flex-wrap items-center gap-2">
                <RunStatus run={source.lastRun} />
                <span>
                  {formatUtc(source.lastRun.startedAt)} · {formatCount(source.lastRun.rowsArchived)} rows
                </span>
              </span>
            ) : (
              <span className="text-slate-400">No runs yet</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap items-end gap-6 border-t border-slate-700 pt-4">
        <div className="w-48">
          <label id={labelId} className="mb-1 block text-sm text-slate-300">
            Keep records live for
          </label>
          <Select
            value={String(retentionDays)}
            onValueChange={(value) => {
              const days = Number(value);
              if (isRetentionDays(days)) setRetentionDays(days);
            }}
          >
            <SelectTrigger
              aria-labelledby={labelId}
              data-testid="retention-select"
              className={DARK_SELECT}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={DARK_SELECT}>
              {RETENTION_DAYS_OPTIONS.map((days) => (
                <SelectItem
                  key={days}
                  value={String(days)}
                  className="focus:!bg-slate-700 focus:!text-white"
                >
                  {days} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div data-testid="eligible" className="min-w-[14rem] flex-1">
          <p className="text-xs uppercase tracking-wide text-slate-500">Eligible now</p>
          {selected ? (
            <>
              <p data-testid="eligible-rows" className="mt-1 text-lg font-semibold text-slate-100">
                {formatCount(selected.eligibleRows)}
              </p>
              <p data-testid="eligible-cutoff" className="text-sm text-slate-400">
                Records created before {formatUtc(selected.cutoff)} would be archived
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">Not available</p>
          )}
        </div>

        <div>
          {/* Disabled with no handler: nothing on this page can start a run (AC-15). */}
          <button
            type="button"
            disabled
            aria-describedby={noteId}
            className="flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            Archive
          </button>
          <p id={noteId} className="mt-1 text-xs text-slate-500">
            Not switched on yet
          </p>
        </div>
      </div>
    </section>
  );
}

/** The run log, newest first. Counts and times only: no archived content (AC-14). */
function RunHistory({ runs }: { runs: ArchiveRunSummary[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-slate-400">No runs yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm text-slate-300">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">Started</th>
            <th scope="col" className="py-2 pr-4 font-medium">By</th>
            <th scope="col" className="py-2 pr-4 font-medium">Retention</th>
            <th scope="col" className="py-2 pr-4 font-medium">Cutoff</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Rows archived</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Batches</th>
            <th scope="col" className="py-2 pr-4 font-medium">Status</th>
            <th scope="col" className="py-2 pr-4 font-medium">Finished</th>
            <th scope="col" className="py-2 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} data-testid={`run-${run.id}`} className="border-t border-slate-700/60">
              <td className="py-2 pr-4 whitespace-nowrap">{formatUtc(run.startedAt)}</td>
              <td className="py-2 pr-4">{run.startedByLabel}</td>
              <td className="py-2 pr-4 whitespace-nowrap">{run.retentionDays} days</td>
              <td className="py-2 pr-4 whitespace-nowrap">{formatUtc(run.cutoff)}</td>
              <td className="py-2 pr-4 text-right">{formatCount(run.rowsArchived)}</td>
              <td className="py-2 pr-4 text-right">{formatCount(run.batches)}</td>
              <td className="py-2 pr-4">
                <RunStatus run={run} />
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {run.finishedAt ? formatUtc(run.finishedAt) : '—'}
              </td>
              <td className="py-2">{run.errorCode ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
