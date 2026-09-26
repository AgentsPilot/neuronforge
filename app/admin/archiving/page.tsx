'use client';

/**
 * Archiving — how much of the audit trail is old enough to move out, under each
 * retention choice. Read-only in Slice 1.
 *
 * ── Why this page adds no guard of its own ──────────────────────────────────
 * `app/admin/layout.tsx` awaits `requireAdminPage()` before this page's RSC
 * payload is produced, and a page cannot skip its parent layout. Protection is
 * a property of the route tree. A second check here would read as though the
 * first were optional (condition C-2).
 *
 * ── Why nothing here can start a run ────────────────────────────────────────
 * There is no run to start until Slice 2, and runs stay switched off until
 * Slice 3 (C-5). The Archive button is disabled with no handler, and the only
 * request this page makes is the overview GET (AC-15).
 *
 * ── Why "Not available yet" rather than 0 ───────────────────────────────────
 * The archived total, the last run and the run history do not exist until
 * Slice 2 creates the tables. The payload does not carry them, and the page
 * says so plainly instead of showing a zero nobody measured.
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
import type { ArchiveSourceOverview, ArchivingOverview } from '@/lib/archiving/types';

const NOT_AVAILABLE = 'Not available yet';
const LOAD_FAILED = 'Could not read the archiving overview';

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
            <p className="text-sm text-slate-400">
              {NOT_AVAILABLE}. Runs are recorded once archiving is switched on.
            </p>
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
          <dd data-testid="archived-total" className="mt-1 text-sm text-slate-400">
            {NOT_AVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Last run</dt>
          <dd data-testid="last-run" className="mt-1 text-sm text-slate-400">
            {NOT_AVAILABLE}
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
            <p className="mt-1 text-sm text-slate-400">{NOT_AVAILABLE}</p>
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
