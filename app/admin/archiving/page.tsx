'use client';

/**
 * Archiving — how much of the audit trail is old enough to move out, under each
 * retention choice, what earlier runs archived, and (Slice 2b) the controls to
 * start a run or continue one.
 *
 * ── Why this page adds no guard of its own ──────────────────────────────────
 * `app/admin/layout.tsx` awaits `requireAdminPage()` before this page's RSC
 * payload is produced, and a page cannot skip its parent layout. Protection is
 * a property of the route tree. A second check here would read as though the
 * first were optional (condition C-2).
 *
 * ── Starting a run, and what switches runs off ──────────────────────────────
 * Runs are ON. `ARCHIVE_RUNS_ENABLED` in lib/archiving/config.ts is `true`
 * (since archiving Slice 3, C-5), and the overview reports it as `runsEnabled`.
 * The Archive button opens a confirm dialog (FR-4, C-15) showing the retention,
 * the cutoff, the rows that will move and, at 180 or 90 days, what owners lose
 * (K-1). Continue appears on a partial, failed or stalled run and resumes it on
 * its stored cutoff. Both send `POST /api/admin/archiving/runs`. Nothing here
 * runs on a timer or on load: only an admin's click starts anything (AC-15).
 *
 * Switching runs off is a reviewed code change: set `ARCHIVE_RUNS_ENABLED` to
 * `false` (a constant, not an env var), and edit this paragraph in the same
 * diff, because __tests__/source.guard.test.ts ties "Runs are ON" to the
 * constant. The overview then says `runsEnabled: false`, and this page shows a
 * "Runs off" badge by the title, disables Confirm and Continue with the note
 * "Not switched on yet", and sends no request (SA Q-1). The server refuses
 * regardless (409 `runs_not_enabled`, C-5), which this page shows as
 * "Archiving is not switched on yet."
 *
 * ── The archive side ────────────────────────────────────────────────────────
 * The archived total, the "archived before" cutoff, the last run and the run
 * history are measured values from the tables migration M1 created. Each run's
 * status is a status chip, words and icon, never colour alone (§7
 * accessibility). A `running` run whose request has died shows as "Stalled".
 *
 * ── The dropdown ────────────────────────────────────────────────────────────
 * The overview carries the eligible count for every option, so changing the
 * retention is local state only, with no refetch (C-9d). The options come from
 * the same constant the server's Zod schema is built from (FR-2). The choice
 * lives on the page, not in the card, so the Eligible now tile follows it.
 *
 * ── Layout ──────────────────────────────────────────────────────────────────
 * Admin Layout Standard L-3: the shared header (with "Runs off" as the neutral
 * chip), the KPI strip, the Refresh-only bar, the shared states and the
 * standard table. A failed refresh clears the counts on purpose (§5.5): the
 * Archive dialog shows figures from the same overview, and stale counts in a
 * confirm before an irreversible move are what the clear prevents.
 *
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_2B_WORKPLAN.md
 * @see docs/workplans/ADMIN_LAYOUT_L3_WORKPLAN.md
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { Archive, History } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RETENTION_DAYS_OPTIONS,
  RUN_HISTORY_LIMIT,
  isRetentionDays,
  type ArchiveSourceKey,
  type RetentionDays,
} from '@/lib/archiving/config';
import type {
  ArchiveRunErrorCode,
  ArchiveRunSummary,
  ArchiveSourceOverview,
  ArchivingOverview,
} from '@/lib/archiving/types';
import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_BUTTON,
  ADMIN_COUNT_LINE,
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';

import { ArchiveConfirmDialog } from './components/ArchiveConfirmDialog';
import {
  ArchivingKpis,
  retentionFor,
  runStatus,
  type RetentionChoice,
} from './components/ArchivingKpis';

const WHAT = 'the archiving overview';
const PURPOSE =
  'How many old records each source holds, and how many would move to the archive under ' +
  'each retention choice. Archiving keeps the live tables small; nothing is lost.';
const RUNS_ROUTE = '/api/admin/archiving/runs';

/** What the admin reads for each refusal. Raw error text is never shown. */
const RUN_MESSAGES: Record<Exclude<ArchiveRunErrorCode, 'invalid_body'>, string> = {
  runs_not_enabled: 'Archiving is not switched on yet.',
  run_in_progress: 'Another run is in progress.',
  run_not_continuable: "This run can't be continued.",
  archive_batch_failed: 'A batch failed and nothing was lost. Press Continue to retry.',
  run_unfinished:
    'The run stopped before it was recorded. You can continue it in about 5 minutes.',
};

type RunRequest =
  | { action: 'start'; source: ArchiveSourceKey; retentionDays: RetentionDays }
  | { action: 'continue'; runId: string };

/** The fallback for an unrecognised failure, worded for what the admin pressed (SA L-3). */
const RUN_FAILED: Record<RunRequest['action'], string> = {
  start: 'The run could not be started.',
  continue: 'The run could not be continued.',
};

/** The server's run outcome, as one sentence. */
function runMessage(
  body: unknown,
  ok: boolean,
  action: RunRequest['action']
): { kind: 'ok' | 'error'; text: string } {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (ok && record.success === true) {
    const data = (record.data ?? {}) as Record<string, unknown>;
    const rows = typeof data.rowsArchived === 'number' ? formatCount(data.rowsArchived) : '0';
    return data.outcome === 'partial'
      ? { kind: 'ok', text: `Paused after ${rows} rows. Press Continue to archive the rest.` }
      : { kind: 'ok', text: `Done: ${rows} rows archived.` };
  }
  const code = record.error;
  const text =
    typeof code === 'string' && code in RUN_MESSAGES
      ? RUN_MESSAGES[code as keyof typeof RUN_MESSAGES]
      : RUN_FAILED[action];
  return { kind: 'error', text };
}

/** Partial, failed, or a running run whose request died: each can be resumed (C-12, SA Q-10). */
function isContinuable(run: ArchiveRunSummary): boolean {
  return run.status === 'partial' || run.status === 'failed' || (run.status === 'running' && run.isStale);
}

/** A run's status as a chip: the word, an icon and a tone (§5.9). A `<span>`, so it nests anywhere (F-62). */
function RunStatus({ run }: { run: ArchiveRunSummary }) {
  const { label, tone } = runStatus(run);
  return (
    <StatusChip tone={tone} testId={`run-status-${run.id}`}>
      {label}
    </StatusChip>
  );
}

/** "3 runs, newest first"; at the overview's cap, "The latest {RUN_HISTORY_LIMIT} runs, newest first" (SA M-3). */
function runCountLine(count: number): string {
  if (count === RUN_HISTORY_LIMIT) return `The latest ${count} runs, newest first`;
  return `${count} ${count === 1 ? 'run' : 'runs'}, newest first`;
}

/**
 * Dark colours for the shared Select on the admin shell (SA Q-4). The primitive
 * falls back to light colours because the admin shell does not load the
 * `--v2-*` tokens, and `cn()` concatenates rather than merges classes, so a
 * plain `bg-slate-800` would race `bg-[var(--v2-bg,white)]` on CSS order. The
 * `!` modifier makes the override deterministic without editing the primitive.
 */
const DARK_SELECT = '!border-slate-600 !bg-slate-800 !text-slate-100';

export default function ArchivingPage() {
  const [overview, setOverview] = useState<ArchivingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // On the page, not in the card: the Eligible now tile reads it too, and it
  // survives the card unmounting on a failed refresh (SA S-1).
  const [retention, setRetention] = useState<RetentionChoice>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only the fetch sits inside this try (the HealthGrid / Jobs shape, SA
      // M-2): a rejection here is a network failure, and nothing else is ever
      // labelled as one. The browser's own message is never shown (§5.10 rule 4).
      let response: Response;
      try {
        response = await fetch('/api/admin/archiving');
      } catch {
        // A failed refresh must not leave the previous counts looking current (§5.5).
        setOverview(null);
        setError(ADMIN_NETWORK_ERROR);
        return;
      }
      // readAdminResponse reads the body without throwing: a non-JSON reply (an
      // HTML 504 from the edge, say) falls to the fixed fallback sentence.
      const result = await readAdminResponse<ArchivingOverview>(response, { what: WHAT, sessionEndedCopy: true });
      if (!result.ok) {
        setOverview(null);
        setError(result.message);
        return;
      }
      setOverview(result.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runsEnabled = overview?.runsEnabled === true;

  /** Start or continue a run, then re-read the overview so every number is current. */
  const sendRun = useCallback(
    async (request: RunRequest): Promise<boolean> => {
      // The server refuses too; this keeps a disabled control from ever sending.
      if (!runsEnabled) return false;
      setBusy(true);
      setNotice(null);
      let ok = false;
      try {
        const response = await fetch(RUNS_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        });
        // The runs route answers codes, not admin copy, so the page's own map
        // words the outcome (SA Q-5); readJsonBody never throws.
        const body = await readJsonBody(response);
        const message = runMessage(body, response.ok, request.action);
        ok = message.kind === 'ok';
        setNotice(message);
      } catch {
        setNotice({ kind: 'error', text: RUN_FAILED[request.action] });
      } finally {
        setBusy(false);
      }
      await load();
      return ok;
    },
    [load, runsEnabled]
  );

  const chooseRetention = useCallback((key: ArchiveSourceKey, days: RetentionDays) => {
    setRetention((previous) => ({ ...previous, [key]: days }));
  }, []);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Archiving"
        purpose={PURPOSE}
        asOf={overview ? `As of ${formatUtc(overview.generatedAt)}.` : null}
        badge={overview && !runsEnabled ? { label: 'Runs off', testId: 'runs-off-badge' } : undefined}
      />

      <ArchivingKpis overview={overview} loading={loading} retention={retention} />

      <AdminFilterBar what={WHAT} busy={loading} onRefresh={() => void load()} />

      {/* Outside the busy wrapper: a run's outcome is announced while the
          overview is re-read straight after it. */}
      {notice && (
        <div
          data-testid="run-notice"
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border p-3 text-sm ${
            notice.kind === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-200'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
          }`}
        >
          {notice.text}
        </div>
      )}

      {error && <AdminError message={error} testId="page-error" onRetry={() => void load()} />}

      {!overview && loading && <AdminLoading what={WHAT} />}

      {overview && (
        <div data-testid="archiving-content" aria-busy={loading} className="space-y-6">
          <div id="sources" className="space-y-6">
            {overview.sources.map((source) => (
              <SourceCard
                key={source.key}
                source={source}
                retentionDays={retentionFor(retention, source.key)}
                onRetentionChange={(days) => chooseRetention(source.key, days)}
                runsEnabled={runsEnabled}
                busy={busy}
                onStart={(retentionDays) =>
                  sendRun({ action: 'start', source: source.key, retentionDays })
                }
              />
            ))}
          </div>

          {/* An id for the tiles' anchor and no accessible name, so no new
              landmark region (SA S-7, A-9). */}
          <section
            id="run-history"
            data-testid="run-history-panel"
            className="rounded-xl border border-slate-700 bg-slate-800/40 p-4"
          >
            <header className="mb-3 border-b border-slate-700 pb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <History className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Run history
              </h2>
            </header>
            <RunHistory
              runs={overview.runs}
              runsEnabled={runsEnabled}
              busy={busy}
              onContinue={(runId) => void sendRun({ action: 'continue', runId })}
            />
          </section>
        </div>
      )}
    </div>
  );
}

function SourceCard({
  source,
  retentionDays,
  onRetentionChange,
  runsEnabled,
  busy,
  onStart,
}: {
  source: ArchiveSourceOverview;
  retentionDays: RetentionDays;
  onRetentionChange: (days: RetentionDays) => void;
  runsEnabled: boolean;
  busy: boolean;
  onStart: (retentionDays: RetentionDays) => Promise<boolean>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const labelId = useId();

  const selected = source.options.find((option) => option.retentionDays === retentionDays);

  return (
    <section
      data-testid={`source-${source.key}`}
      className="rounded-xl border border-slate-700 bg-slate-800/40 p-4"
    >
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Archive className="h-4 w-4 text-slate-400" aria-hidden="true" />
        {source.label}
      </h2>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-400">Rows now</dt>
          <dd data-testid="total-rows" className="mt-1 text-sm tabular-nums text-slate-200">
            {formatCount(source.totalRows)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Oldest record</dt>
          <dd data-testid="oldest-record" className="mt-1 text-sm text-slate-200">
            {source.oldestRecordAt ? formatUtc(source.oldestRecordAt) : 'No records'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Archived total</dt>
          <dd data-testid="archived-total" className="mt-1 text-sm tabular-nums text-slate-200">
            {formatCount(source.archivedTotal)}
          </dd>
          <dd data-testid="archived-before" className="text-xs text-slate-400">
            {source.latestCutoff
              ? `Everything before ${formatUtc(source.latestCutoff)} is archived`
              : 'Archived before: none yet'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Last run</dt>
          <dd data-testid="last-run" className="mt-1 text-sm text-slate-200">
            {source.lastRun ? (
              <span className="flex flex-wrap items-center gap-2">
                <RunStatus run={source.lastRun} />
                <span className="tabular-nums">
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
              if (isRetentionDays(days)) onRetentionChange(days);
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
          <p className="text-xs text-slate-400">Eligible now</p>
          {selected ? (
            <>
              <p data-testid="eligible-rows" className="mt-1 text-sm tabular-nums text-slate-200">
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

        <ArchiveConfirmDialog
          sourceLabel={source.label}
          option={selected}
          runsEnabled={runsEnabled}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          busy={busy}
          onConfirm={() => {
            void onStart(retentionDays).then(() => setDialogOpen(false));
          }}
        />
      </div>
    </section>
  );
}

/** The run log, newest first. Counts and times only: no archived content (AC-14). */
function RunHistory({
  runs,
  runsEnabled,
  busy,
  onContinue,
}: {
  runs: ArchiveRunSummary[];
  runsEnabled: boolean;
  busy: boolean;
  onContinue: (runId: string) => void;
}) {
  const continueNoteId = useId();

  if (runs.length === 0) {
    return <AdminEmpty message="No runs yet." />;
  }

  return (
    <div className="space-y-2">
      <p data-testid="run-count" className={ADMIN_COUNT_LINE}>
        {runCountLine(runs.length)}
      </p>
      {!runsEnabled && runs.some(isContinuable) && (
        <p id={continueNoteId} className="text-xs text-slate-400">
          Not switched on yet
        </p>
      )}
      <div className={ADMIN_TABLE_WRAP}>
        <table aria-label="Run history" className={ADMIN_TABLE}>
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>Started</th>
              <th scope="col" className={ADMIN_TH}>By</th>
              <th scope="col" className={ADMIN_TH}>Retention</th>
              <th scope="col" className={ADMIN_TH}>Cutoff</th>
              <th scope="col" className={ADMIN_TH_NUM}>Rows archived</th>
              <th scope="col" className={ADMIN_TH_NUM}>Batches</th>
              <th scope="col" className={ADMIN_TH}>Status</th>
              <th scope="col" className={ADMIN_TH}>Finished</th>
              <th scope="col" className={ADMIN_TH}>Error</th>
              <th scope="col" className={ADMIN_TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {runs.map((run) => (
              <tr key={run.id} data-testid={`run-${run.id}`}>
                <td className={`${ADMIN_TD} whitespace-nowrap`}>{formatUtc(run.startedAt)}</td>
                <td className={ADMIN_TD}>{run.startedByLabel}</td>
                <td className={`${ADMIN_TD} whitespace-nowrap`}>{run.retentionDays} days</td>
                <td className={`${ADMIN_TD} whitespace-nowrap`}>{formatUtc(run.cutoff)}</td>
                <td className={ADMIN_TD_NUM}>{formatCount(run.rowsArchived)}</td>
                <td className={ADMIN_TD_NUM}>{formatCount(run.batches)}</td>
                <td className={ADMIN_TD}>
                  <RunStatus run={run} />
                </td>
                <td className={`${ADMIN_TD} whitespace-nowrap`}>
                  {run.finishedAt ? formatUtc(run.finishedAt) : '—'}
                </td>
                <td className={ADMIN_TD}>
                  {/* The route's code, styled as a code; rewording it is copy (F-61, the user's). */}
                  {run.errorCode ? <span className="font-mono text-[11px]">{run.errorCode}</span> : '—'}
                </td>
                <td className={ADMIN_TD}>
                  {isContinuable(run) && (
                    <button
                      type="button"
                      data-testid={`continue-${run.id}`}
                      onClick={() => onContinue(run.id)}
                      disabled={!runsEnabled || busy}
                      aria-describedby={runsEnabled ? undefined : continueNoteId}
                      className={ADMIN_BUTTON}
                    >
                      Continue
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
