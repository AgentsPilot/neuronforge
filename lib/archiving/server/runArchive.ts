/**
 * The archive runner: moves batches for one run until the source has nothing
 * left before the run's cutoff, a batch fails, or the time budget is spent.
 *
 * ── Server-only, by folder ──────────────────────────────────────────────────
 * It lives under `lib/archiving/server/` so the page's source guard can forbid
 * the whole folder: nothing here may reach the browser bundle.
 *
 * ── One caller ──────────────────────────────────────────────────────────────
 * `POST /api/admin/archiving/runs`, AFTER its `ARCHIVE_RUNS_ENABLED` check. That
 * route's source test pins it (SA R-1): this function is the only caller of
 * `runBatchAllAccounts`, and the route is the only caller of this function, so
 * no path moves a row while runs are switched off.
 *
 * ── The cutoff ──────────────────────────────────────────────────────────────
 * Every batch uses `run.cutoff`, the value stored when the run started, passed
 * as the exact string the database returned. The move function compares it
 * exactly, and refuses a run that is not `running` with that cutoff (FR-3).
 *
 * ── Outcomes ────────────────────────────────────────────────────────────────
 *   succeeded  a batch selected 0 rows: nothing is left before the cutoff
 *   partial    the budget ran out first; Continue resumes the same run
 *   failed     a batch raised. It was rolled back in the database (FR-5), so
 *              nothing is lost, and Continue retries (C-12). Also the outcome,
 *              with no batch at all, when the row's source is not in the
 *              registry (error code `batch_failed`, the allowed set)
 * `run` is the finished row, or `null` when `finishRun` itself failed. The run
 * then stays `running`, goes stale after 5 minutes, and the next POST's takeover
 * flips it to `partial` so Continue can finish it. Nothing is thrown.
 *
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_2B_WORKPLAN.md §2.3
 */

import type { Logger } from '@/lib/logger';
import type { ArchiveRepository, ArchiveRunRow } from '@/lib/repositories/ArchiveRepository';
import { ARCHIVE_SOURCES } from '@/lib/archiving/config';

export type ArchiveOutcome = 'succeeded' | 'partial' | 'failed';

export interface RunArchiveDeps {
  repo: Pick<ArchiveRepository, 'runBatchAllAccounts' | 'finishRun'>;
  /** The created or claimed row. Its cutoff is the only cutoff used. */
  run: ArchiveRunRow;
  /** Stop starting new batches after this long (45 s inside `maxDuration` 60). */
  budgetMs: number;
  /** Injected so tests can move time. */
  clock: () => number;
  logger: Logger;
}

export interface RunArchiveResult {
  outcome: ArchiveOutcome;
  /** The finished run row, or `null` when it could not be recorded. */
  run: ArchiveRunRow | null;
}

export async function runArchive(deps: RunArchiveDeps): Promise<RunArchiveResult> {
  const { repo, run, budgetMs, clock, logger } = deps;
  const startedAt = clock();
  const runLogger = logger.child({ runId: run.id, source: run.source, retentionDays: run.retention_days });

  let outcome: ArchiveOutcome = 'partial';

  // The runner owns the source lookup (SA L-1): the batch size and the source
  // key both come from the registry entry for the row's source.
  const source = ARCHIVE_SOURCES.find((entry) => entry.key === run.source);

  if (!source) {
    // The database and the registry disagree. Do not guess a function; record
    // the run as failed rather than leaving it `running` until the takeover.
    runLogger.error({}, 'Archive run has an unknown source');
    outcome = 'failed';
  } else {
    // The budget is checked BEFORE each batch, so no batch starts after it.
    while (clock() - startedAt < budgetMs) {
      const batchStart = clock();
      const batch = await repo.runBatchAllAccounts(source.key, run.id, run.cutoff, source.batchSize);
      if (batch.error || !batch.data) {
        runLogger.error({ err: batch.error, elapsedMs: clock() - startedAt }, 'Archive batch failed');
        outcome = 'failed';
        break;
      }

      runLogger.info(
        {
          selected: batch.data.selected,
          inserted: batch.data.inserted,
          deleted: batch.data.deleted,
          batchMs: clock() - batchStart,
          elapsedMs: clock() - startedAt,
        },
        'Archive batch moved'
      );

      if (batch.data.selected === 0) {
        outcome = 'succeeded';
        break;
      }
    }
  }

  const finished = await repo.finishRun(run.id, {
    status: outcome,
    errorCode: outcome === 'failed' ? 'batch_failed' : null,
    now: new Date(clock()),
  });

  if (finished.error || !finished.data) {
    runLogger.error({ err: finished.error, outcome }, 'Archive run could not be recorded as finished');
    return { outcome, run: null };
  }

  runLogger.info(
    { outcome, rowsArchived: Number(finished.data.rows_archived), batches: finished.data.batches },
    'Archive run request finished'
  );
  return { outcome, run: finished.data };
}
