/**
 * The `GET /api/admin/archiving` payload, shared by the route and the page.
 *
 * Types only, so the client page can agree with the route without importing
 * anything that runs on the server.
 *
 * Archived total, last run and run history are ABSENT, not `0` or `null`: there
 * is no table to read them from until Slice 2, and a field would claim a value
 * the server cannot know (SA Q-3). The page shows "Not available yet" for them.
 */

import type { ArchiveSourceKey, RetentionDays } from './config';

export interface RetentionOptionCount {
  retentionDays: RetentionDays;
  /** ISO timestamp, UTC. Rows created strictly before it are eligible. */
  cutoff: string;
  /** Rows with `created_at < cutoff`. */
  eligibleRows: number;
}

export interface ArchiveSourceOverview {
  key: ArchiveSourceKey;
  label: string;
  totalRows: number;
  /** `null` means the table is empty. */
  oldestRecordAt: string | null;
  /** All three options, in `RETENTION_DAYS_OPTIONS` order (condition C-9d). */
  options: RetentionOptionCount[];
}

export interface ArchivingOverview {
  generatedAt: string;
  /** Mirrors `ARCHIVE_RUNS_ENABLED`. */
  runsEnabled: boolean;
  sources: ArchiveSourceOverview[];
}
