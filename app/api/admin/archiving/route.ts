/**
 * GET /api/admin/archiving — the read endpoint behind the Archiving admin page.
 *
 * ── The gate ──────────────────────────────────────────────────────────────
 * `requireAdmin` is the FIRST statement, with nothing above it that touches a
 * body, the database or a queue (condition C-1). It owns the 401/403 split and
 * fails closed. The CI guard proves the gate is present; its position is pinned
 * by this route's own test (I-10).
 *
 * ── What it returns ───────────────────────────────────────────────────────
 * For each registered source: total rows, the oldest record, and the eligible
 * count for EVERY retention option, so the page's dropdown switches without a
 * refetch (C-9d). All cutoffs come from one `now`, so the three counts agree
 * with each other and with the cutoff dates the page prints.
 *
 * Slice 2a adds the archive side, read from the tables migration M1 creates:
 * the archived total and the latest fully-archived cutoff per source, the last
 * run, and the run history (newest 20). Each run says whether it is stale: a
 * `running` run silent for longer than STALE_RUN_AFTER_MS belongs to a dead
 * request. This route only REPORTS that; it never writes. Recovering a stale
 * run is the POST's job (Slice 2b).
 *
 * Any failed COUNT or run read fails the whole response (500): a partly-filled
 * card would present a missing number as if it were known. The one exception is
 * the admin email shown beside a run: it is a label, not a measurement, so if
 * the admin list cannot be read the run shows a short id instead.
 *
 * ── Read-only ─────────────────────────────────────────────────────────────
 * No input, so no Zod here: query strings are ignored, not parsed. No audit
 * event: reading counts is not a state change.
 *
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_2_RUNS_WORKPLAN.md §2.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import {
  ARCHIVE_RUNS_ENABLED,
  ARCHIVE_RUN_STATUSES,
  ARCHIVE_SOURCES,
  ARCHIVE_SOURCE_KEYS,
  RETENTION_DAYS_OPTIONS,
  RUN_HISTORY_LIMIT,
  STALE_RUN_AFTER_MS,
  cutoffFor,
  isRetentionDays,
  type ArchiveRunStatus,
  type ArchiveSourceKey,
} from '@/lib/archiving/config';
import type {
  ArchiveRunSummary,
  ArchiveSourceOverview,
  ArchivingOverview,
  RetentionOptionCount,
} from '@/lib/archiving/types';
import { createLogger, type Logger } from '@/lib/logger';
import { adminUserRepository } from '@/lib/repositories/AdminUserRepository';
import {
  archiveRepository,
  type ArchiveRepository,
  type ArchiveRunRow,
} from '@/lib/repositories/ArchiveRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminArchivingAPI' });

/**
 * A count the repository actually measured, or a throw (→ 500). A null count
 * with no error is never turned into 0: the page would show a number nobody
 * measured (SA CR-3).
 */
function measuredCount(result: { data: number | null; error: Error | null }, what: string): number {
  if (result.error) throw result.error;
  if (typeof result.data !== 'number') {
    throw new Error(`Archiving overview: ${what} count missing without an error`);
  }
  return result.data;
}

type SourceReader = (
  repo: ArchiveRepository,
  now: Date
) => Promise<Pick<ArchiveSourceOverview, 'totalRows' | 'oldestRecordAt' | 'options' | 'archivedTotal' | 'latestCutoff'>>;

/**
 * One reader per registered source. Typed as a full `Record`, so a registry
 * entry without a reader is a compile error rather than a silent gap.
 */
const SOURCE_READERS: Record<ArchiveSourceKey, SourceReader> = {
  audit_trail: async (repo, now) => {
    const [total, oldest, archived, latest, ...eligible] = await Promise.all([
      repo.countAuditTrailAllAccounts(),
      repo.getOldestAuditTrailCreatedAtAllAccounts(),
      repo.countArchivedAllAccounts('audit_trail'),
      repo.getLatestCutoff('audit_trail'),
      ...RETENTION_DAYS_OPTIONS.map((days) =>
        repo.countAuditTrailBeforeAllAccounts(cutoffFor(days, now))
      ),
    ]);

    if (oldest.error) throw oldest.error;
    if (latest.error) throw latest.error;
    const totalRows = measuredCount(total, 'total');
    const archivedTotal = measuredCount(archived, 'archived');

    const options: RetentionOptionCount[] = RETENTION_DAYS_OPTIONS.map((days, index) => ({
      retentionDays: days,
      cutoff: cutoffFor(days, now).toISOString(),
      eligibleRows: measuredCount(eligible[index], `eligible_${days}`),
    }));

    return { totalRows, oldestRecordAt: oldest.data, options, archivedTotal, latestCutoff: latest.data };
  },
};

function isRunStatus(value: string): value is ArchiveRunStatus {
  return (ARCHIVE_RUN_STATUSES as readonly string[]).includes(value);
}

function isSourceKey(value: string): value is ArchiveSourceKey {
  return (ARCHIVE_SOURCE_KEYS as readonly string[]).includes(value);
}

/** "Admin 1a2b3c4d": for a run whose admin is no longer on the active list. */
function shortAdminLabel(userId: string): string {
  return `Admin ${userId.slice(0, 8)}`;
}

/**
 * A run row as the page shows it. A value the database constraints should make
 * impossible (an unknown status, a non-numeric count) is thrown, not guessed:
 * the history must never show a run as something it is not.
 */
function toRunSummary(row: ArchiveRunRow, now: Date, labels: Map<string, string>): ArchiveRunSummary {
  if (!isRunStatus(row.status)) throw new Error(`Archive run ${row.id}: unknown status`);
  if (!isSourceKey(row.source)) throw new Error(`Archive run ${row.id}: unknown source`);
  if (!isRetentionDays(row.retention_days)) throw new Error(`Archive run ${row.id}: unknown retention`);
  const rowsArchived = Number(row.rows_archived);
  if (!Number.isFinite(rowsArchived)) throw new Error(`Archive run ${row.id}: rows_archived is not a number`);

  const lastSignOfLife = new Date(row.last_batch_at ?? row.started_at).getTime();
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    retentionDays: row.retention_days,
    cutoff: row.cutoff,
    rowsArchived,
    batches: row.batches,
    startedBy: row.started_by,
    startedByLabel: labels.get(row.started_by) ?? shortAdminLabel(row.started_by),
    startedAt: row.started_at,
    lastBatchAt: row.last_batch_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    isStale: row.status === 'running' && now.getTime() - lastSignOfLife > STALE_RUN_AFTER_MS,
  };
}

/** Active admins' emails by auth user id. A failure is logged and yields no labels. */
async function adminLabels(requestLogger: Logger): Promise<Map<string, string>> {
  const { data, error } = await adminUserRepository.listActive();
  if (error || !data) {
    requestLogger.warn({ err: error }, 'Could not read admin labels; runs show a short id');
    return new Map();
  }
  return new Map(
    data.filter((admin) => admin.user_id).map((admin) => [admin.user_id as string, admin.email])
  );
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'admin-archiving' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const now = new Date();

    const [sourceParts, runRows] = await Promise.all([
      Promise.all(
        ARCHIVE_SOURCES.map(async (source) => ({
          key: source.key,
          label: source.label,
          ...(await SOURCE_READERS[source.key](archiveRepository, now)),
        }))
      ),
      archiveRepository.listRuns({ limit: RUN_HISTORY_LIMIT }),
    ]);

    if (runRows.error || !runRows.data) {
      throw runRows.error ?? new Error('Archiving overview: run list missing without an error');
    }

    const labels = runRows.data.length > 0 ? await adminLabels(requestLogger) : new Map<string, string>();
    const runs = runRows.data.map((row) => toRunSummary(row, now, labels));

    const sources: ArchiveSourceOverview[] = sourceParts.map((source) => ({
      ...source,
      lastRun: runs.find((run) => run.source === source.key) ?? null,
    }));

    const overview: ArchivingOverview = {
      generatedAt: now.toISOString(),
      runsEnabled: ARCHIVE_RUNS_ENABLED,
      sources,
      runs,
    };

    // Counts only: never row content, never an email.
    requestLogger.info(
      {
        sources: sources.map((source) => ({
          source: source.key,
          totalRows: source.totalRows,
          archivedTotal: source.archivedTotal,
          eligible: source.options.map((option) => option.eligibleRows),
        })),
        runs: runs.length,
      },
      'Archiving overview read'
    );

    return NextResponse.json({ success: true, data: overview });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to build the archiving overview');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not read the archiving overview',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
