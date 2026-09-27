/**
 * Archiving: the shared constants every layer reads.
 *
 * ── Why this file imports nothing ───────────────────────────────────────────
 * The `/admin/archiving` page is a client component and reads the retention
 * options from here, so this module must never pull a server module into the
 * browser bundle. It imports nothing at all, which makes that a property of the
 * file rather than a convention (pinned by `__tests__/config.test.ts`).
 *
 * ── One list of retention options ───────────────────────────────────────────
 * The dropdown and the server's Zod schema (`lib/validation/archiving.ts`) are
 * both built from `RETENTION_DAYS_OPTIONS`, so they cannot drift apart (FR-2).
 *
 * @see docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md
 */

/** How long records stay live, in days. Order is the dropdown order. */
export const RETENTION_DAYS_OPTIONS = [365, 180, 90] as const;

export type RetentionDays = (typeof RETENTION_DAYS_OPTIONS)[number];

/** Preselected in the dropdown (FR-1). */
export const DEFAULT_RETENTION_DAYS: RetentionDays = 365;

/**
 * True only for one of the three numbers. Does not coerce: `"365"` is false.
 * The list is widened to `number[]` for the lookup rather than casting `value`,
 * so the guard stays honest for anything that is not a number (SA Q-1).
 */
export function isRetentionDays(value: unknown): value is RetentionDays {
  return (
    typeof value === 'number' && (RETENTION_DAYS_OPTIONS as readonly number[]).includes(value)
  );
}

/**
 * Archivable sources.
 *
 * `batchSize` is the row count one call of the source's move function takes
 * (TQ-3: 1,000). The function NAME is deliberately not here: it lives in the
 * server-only repository, so no database object name reaches the browser bundle
 * (Slice 2 SA Q-6). There is no `exclusions` field: exclusions live in each
 * source's SQL function (condition C-9b).
 */
export const ARCHIVE_SOURCES = [
  { key: 'audit_trail', label: 'Audit trail', batchSize: 1000 },
] as const;

export type ArchiveSourceKey = (typeof ARCHIVE_SOURCES)[number]['key'];

/** The source keys as a non-empty tuple, for `z.enum`. */
export const ARCHIVE_SOURCE_KEYS = ARCHIVE_SOURCES.map((source) => source.key) as [
  ArchiveSourceKey,
  ...ArchiveSourceKey[],
];

/**
 * Off until Slice 3 merges (condition C-5). A code constant rather than an env
 * var, so switching runs on is a reviewed diff with no dependency on Vercel access.
 */
export const ARCHIVE_RUNS_ENABLED = false;

/** A run's lifecycle. Mirrors the `archive_runs.status` CHECK (pinned by the migration test). */
export const ARCHIVE_RUN_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;

export type ArchiveRunStatus = (typeof ARCHIVE_RUN_STATUSES)[number];

/**
 * A `running` run with no sign of life for this long belongs to a dead request:
 * the route's `maxDuration` is 60 s, so no live request can be this quiet (TQ-1).
 */
export const STALE_RUN_AFTER_MS = 5 * 60_000;

/** How many runs the overview lists, newest first. */
export const RUN_HISTORY_LIMIT = 20;

const MS_PER_DAY = 86_400_000;

/**
 * `now` minus `days`, as a UTC instant. One function, so Slice 2's run-start
 * cutoff cannot differ from the overview's. Calendar and DST arithmetic do not
 * apply to a UTC instant, so plain milliseconds are exact here.
 */
export function cutoffFor(days: RetentionDays, now: Date): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}
