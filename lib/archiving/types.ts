/**
 * The `GET /api/admin/archiving` payload, shared by the route and the page.
 *
 * Types only, so the client page can agree with the route without importing
 * anything that runs on the server.
 *
 * Slice 2a adds the archive side: the archived total, the latest cutoff that is
 * fully archived, the last run and the run history. Each is a MEASURED value
 * read from the tables M1 creates, so a `0` here is a real zero and "no runs"
 * is a real empty list.
 */

import type { ArchiveRunStatus, ArchiveSourceKey, RetentionDays } from './config';

export interface RetentionOptionCount {
  retentionDays: RetentionDays;
  /** ISO timestamp, UTC. Rows created strictly before it are eligible. */
  cutoff: string;
  /** Rows with `created_at < cutoff`. */
  eligibleRows: number;
}

/** One archive run, as the page shows it. Counts and times only, never content. */
export interface ArchiveRunSummary {
  id: string;
  source: ArchiveSourceKey;
  status: ArchiveRunStatus;
  retentionDays: RetentionDays;
  /** ISO, UTC. Fixed when the run started; every batch and Continue uses it. */
  cutoff: string;
  rowsArchived: number;
  batches: number;
  /** The admin's auth user id. */
  startedBy: string;
  /** The admin's email when they are still an active admin, otherwise a short id. */
  startedByLabel: string;
  startedAt: string;
  lastBatchAt: string | null;
  finishedAt: string | null;
  /** A short code (for example `batch_failed`), never error text. */
  errorCode: string | null;
  /** `running`, but silent for longer than `STALE_RUN_AFTER_MS`: its request is dead. */
  isStale: boolean;
}

export interface ArchiveSourceOverview {
  key: ArchiveSourceKey;
  label: string;
  totalRows: number;
  /** `null` means the table is empty. */
  oldestRecordAt: string | null;
  /** All three options, in `RETENTION_DAYS_OPTIONS` order (condition C-9d). */
  options: RetentionOptionCount[];
  /** Rows of this source now in the archive. */
  archivedTotal: number;
  /** The latest cutoff among succeeded runs: everything before it is archived. `null` = none yet. */
  latestCutoff: string | null;
  /** The newest run of this source, or `null` when it has never run. */
  lastRun: ArchiveRunSummary | null;
}

export interface ArchivingOverview {
  generatedAt: string;
  /** Mirrors `ARCHIVE_RUNS_ENABLED`. */
  runsEnabled: boolean;
  sources: ArchiveSourceOverview[];
  /** Newest first, at most `RUN_HISTORY_LIMIT` (config). */
  runs: ArchiveRunSummary[];
}
