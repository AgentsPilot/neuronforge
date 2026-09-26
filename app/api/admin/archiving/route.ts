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
 * Any failed read fails the whole response (500). A partly-filled card would
 * present a missing number as if it were known.
 *
 * ── Read-only (Slice 1) ───────────────────────────────────────────────────
 * No POST, no input, so no Zod here: query strings are ignored, not parsed.
 * No audit event: reading counts is not a state change. Runs, their audit
 * events and `POST /api/admin/archiving/runs` arrive in Slice 2.
 *
 * @see docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import {
  ARCHIVE_RUNS_ENABLED,
  ARCHIVE_SOURCES,
  RETENTION_DAYS_OPTIONS,
  cutoffFor,
  type ArchiveSourceKey,
} from '@/lib/archiving/config';
import type {
  ArchiveSourceOverview,
  ArchivingOverview,
  RetentionOptionCount,
} from '@/lib/archiving/types';
import { createLogger } from '@/lib/logger';
import { archiveRepository, type ArchiveRepository } from '@/lib/repositories/ArchiveRepository';

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
) => Promise<Omit<ArchiveSourceOverview, 'key' | 'label'>>;

/**
 * One reader per registered source. Typed as a full `Record`, so a registry
 * entry without a reader is a compile error rather than a silent gap.
 */
const SOURCE_READERS: Record<ArchiveSourceKey, SourceReader> = {
  audit_trail: async (repo, now) => {
    const [total, oldest, ...eligible] = await Promise.all([
      repo.countAuditTrailAllAccounts(),
      repo.getOldestAuditTrailCreatedAtAllAccounts(),
      ...RETENTION_DAYS_OPTIONS.map((days) =>
        repo.countAuditTrailBeforeAllAccounts(cutoffFor(days, now))
      ),
    ]);

    if (oldest.error) throw oldest.error;
    const totalRows = measuredCount(total, 'total');

    const options: RetentionOptionCount[] = RETENTION_DAYS_OPTIONS.map((days, index) => ({
      retentionDays: days,
      cutoff: cutoffFor(days, now).toISOString(),
      eligibleRows: measuredCount(eligible[index], `eligible_${days}`),
    }));

    return { totalRows, oldestRecordAt: oldest.data, options };
  },
};

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'admin-archiving' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const now = new Date();

    const sources: ArchiveSourceOverview[] = await Promise.all(
      ARCHIVE_SOURCES.map(async (source) => ({
        key: source.key,
        label: source.label,
        ...(await SOURCE_READERS[source.key](archiveRepository, now)),
      }))
    );

    const overview: ArchivingOverview = {
      generatedAt: now.toISOString(),
      runsEnabled: ARCHIVE_RUNS_ENABLED,
      sources,
    };

    // Counts only: never row content, never the admin's email.
    requestLogger.info(
      {
        sources: sources.map((source) => ({
          source: source.key,
          totalRows: source.totalRows,
          eligible: source.options.map((option) => option.eligibleRows),
        })),
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
