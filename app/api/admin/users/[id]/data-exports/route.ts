/**
 * An admin's view of one account's "Download my data" exports, and the admin
 * prepare (data export DE-10a; BUSINESS_OS_DATA_EXPORT_DE10A_WORKPLAN.md §5.1,
 * §5.2; requirement §0.4.1 B, DX-4, DX-7; SA-1, SA-8, SA-10, SA-11, W10-1,
 * W10-2, W10-4, W10-5).
 *
 *   GET  /api/admin/users/<uuid>/data-exports              the last 10 exports
 *   POST /api/admin/users/<uuid>/data-exports  { reason }  prepare one
 *
 * ADMIN ONLY, and a deliberate CROSS-ACCOUNT action on one admin-selected
 * account. `requireAdmin` is the first statement of each handler; nothing is
 * read, parsed or written before it (W10-1). The target comes ONLY from the
 * path (Zod uuid, lower-cased, the AD-1b canonical form) and the admin ONLY
 * from the session (W10-2). The body is `{ reason }` and nothing else
 * (`.strict()`): a `userId`, `targetUserId` or `jobId` in it is a 400.
 *
 * GET: metadata only (status, times, sizes, who started it), never a link,
 * a file name or a business name; not audited, as the drawer's other reads
 * (SA-8). A failed read is a 500, never an empty list.
 *
 * POST: the same `runZipExport` as the owner route, with the TARGET's
 * context, so the zip, the ceilings and the database's 1-at-a-time / 3-a-day
 * limit are the owner's own (DX-4: an admin export counts against the
 * account's 3 a day). It returns NO download link (SA-10): the only admin
 * link is minted by the audited download route, after its write-ahead row.
 * The admin may not use this path on their own account (TL default BC-6).
 *
 * Audit (SA-1): every row is built by `adminExportAudit.ts` and placed on the
 * ADMIN (user and actor), the target as the entity, so the owner never sees
 * that an admin exported their data (BQ-SA-2). REQUESTED and the replaced
 * EXPIRED rows are non-blocking; READY and FAILED are bounded flushes (SA-8).
 *
 * Logs and audit rows carry ids, counts, bytes and durations only; never the
 * email, the business name or a file name (W10-5).
 *
 * @module app/api/admin/users/[id]/data-exports
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { AuditTrail } from '@/lib/services/AuditTrailService';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';
import { runZipExport } from '@/lib/business-os/data-export/zipExport';
import { zipExportDeps } from '@/lib/business-os/data-export/zipExportDeps';
import {
  adminExportFailedEntry,
  adminExportReadyEntry,
  adminExportReplacedEntry,
  adminExportRequestedEntry,
  type AdminExportAuditBase,
} from '@/lib/business-os/data-export/adminExportAudit';
import type { ExportContext } from '@/lib/business-os/data-export/sections';
import type { DataExportJob } from '@/lib/repositories/types';

const logger = createLogger({ module: 'AdminDataExportsAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// ≤ 60 s, safely below the start function's 90 s stale rule (DE-8a).
export const maxDuration = 60;

const NO_STORE = 'no-store, no-cache, must-revalidate';
const STATUS_LIMIT = 10;

const targetIdSchema = z.string().uuid();
/** W10-2: the reason only. Any other key, an id included, is a 400. */
const bodySchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

const TOO_LARGE_MESSAGE =
  'This account holds more than Phase 1 can package (over 40 MB of files or 150 files). Nothing was prepared.';

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

function serverError(error: unknown): NextResponse {
  return json(
    {
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
    },
    500
  );
}

/** One row of the status list: metadata only, never a link or a name. */
function statusRow(job: DataExportJob, adminId: string, nowMs: number) {
  const isAdminJob = job.requested_by_kind === 'admin';
  const isDownloadable = job.status === 'ready' && !!job.expires_at && Date.parse(job.expires_at) > nowMs;
  return {
    jobId: job.id,
    requestedByKind: job.requested_by_kind,
    // SA optimisation: the short form is derived here, so no full admin id reaches the browser.
    requestedByShort: isAdminJob ? job.requested_by.slice(0, 8) : null,
    isRequestedByYou: isAdminJob && job.requested_by.toLowerCase() === adminId.toLowerCase(),
    status: job.status,
    failureReason: job.failure_reason,
    createdAt: job.created_at,
    readyAt: job.ready_at,
    expiresAt: job.expires_at,
    ownerDownloadedAt: job.owner_downloaded_at,
    isDownloadable,
    bytes: job.bytes,
    fileCount: job.file_count,
    rowCount: job.row_count,
  };
}

/** An export the owner received: ready or expired, owner-requested (as DE-9's "Last export"). */
const isOwnerDelivered = (job: DataExportJob) => job.requested_by_kind === 'owner' && (job.status === 'ready' || job.status === 'expired');

/**
 * GET: the account's last exports, newest first (§5.1). Not audited (SA-8).
 */
export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'admin-data-exports', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    const parsedId = targetIdSchema.safeParse(context.params.id);
    if (!parsedId.success) return json({ success: false, error: 'invalid_user_id' }, 400);
    const targetId = parsedId.data.toLowerCase();

    const throttle = await rateLimit(request, 'admin-data-export-status', RATE_LIMITS.read);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

    const listed = await businessOsDataExportJobRepository.listForUser(targetId, { limit: STATUS_LIMIT });
    if (listed.error || !listed.data) {
      requestLogger.error({ targetUserId: targetId }, 'Admin data export status could not be read');
      return json({ success: false, error: 'The exports could not be read.' }, 500);
    }
    const jobs = listed.data;

    // BC-4: did the owner download their newest delivered export? When a full
    // page holds none of theirs, the newest one is read on its own.
    let latestOwner: DataExportJob | null = jobs.find(isOwnerDelivered) ?? null;
    if (!latestOwner && jobs.length >= STATUS_LIMIT) {
      const latest = await businessOsDataExportJobRepository.findLatestCompletedForUser(targetId);
      if (latest.error) {
        requestLogger.error({ targetUserId: targetId }, 'Admin data export status: the latest owner export could not be read');
        return json({ success: false, error: 'The exports could not be read.' }, 500);
      }
      latestOwner = latest.data;
    }

    const nowMs = Date.now();
    requestLogger.debug({ targetUserId: targetId, exports: jobs.length }, 'Admin read the data export status');
    return json(
      {
        success: true,
        data: {
          exports: jobs.map((job) => statusRow(job, adminId, nowMs)),
          ownerDownloadedLatest: latestOwner?.owner_downloaded_at != null,
          isOwnAccount: targetId === adminId.toLowerCase(),
          dailyLimit: EXPORT_JOB_POLICY.DAILY_LIMIT,
        },
      },
      200
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Admin data export status failed');
    return serverError(error);
  }
}

/**
 * POST: an admin prepares an export of the account (§5.2). No link is
 * returned (SA-10).
 */
export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'admin-data-exports', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const startedAt = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    const parsedId = targetIdSchema.safeParse(context.params.id);
    if (!parsedId.success) return json({ success: false, error: 'invalid_user_id' }, 400);
    const targetId = parsedId.data.toLowerCase();

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return json({ success: false, error: 'invalid_body' }, 400);
    }
    let body: unknown = {};
    if (rawBody.trim().length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return json({ success: false, error: 'invalid_body' }, 400);
      }
    }
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return json(
        {
          success: false,
          error: 'invalid_body',
          details: process.env.NODE_ENV === 'development' ? parsedBody.error.issues[0]?.message : undefined,
        },
        400
      );
    }
    const { reason } = parsedBody.data;

    const throttle = await rateLimit(request, 'admin-data-export-start', RATE_LIMITS.create);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.create.windowSeconds);

    // BC-6: an admin's own data goes through "Download my data", like any owner.
    if (targetId === adminId.toLowerCase()) {
      return json({ success: false, code: 'own_account', error: 'Use Download my data in your own settings for your own account.' }, 403);
    }

    // The account must exist; an identity read that fails is a 500, never a 404 (AD-1b D-1).
    const identity = await authAccountRepository.findUserIdentity(targetId);
    if (identity.error || (identity.data && !identity.data.createdAt)) {
      requestLogger.error({ targetUserId: targetId }, 'Admin data export: the account identity could not be read');
      return json({ success: false, error: 'identity_read_failed' }, 500);
    }
    if (!identity.data) return json({ success: false, error: 'user_not_found' }, 404);
    const account = identity.data;

    // ── Start: the account's own limit (DX-4: admin exports count) ──────────
    const start = await businessOsDataExportJobRepository.startForAdmin(targetId, adminId);
    if (start.error || !start.data) {
      requestLogger.error({ err: start.error, targetUserId: targetId }, 'Admin data export could not start');
      return json({ success: false, error: 'Could not start the export. Try again.' }, 500);
    }
    if (start.data.outcome !== 'started') {
      const code = start.data.outcome === 'in_progress' ? 'export_in_progress' : 'export_daily_limit';
      requestLogger.info({ targetUserId: targetId, code }, 'Admin data export refused by the start limit');
      return json(
        {
          success: false,
          code,
          retryAt: start.data.retryAt,
          error:
            code === 'export_in_progress'
              ? 'An export of this account is already being prepared. Wait a minute and try again.'
              : `This account has used its ${EXPORT_JOB_POLICY.DAILY_LIMIT} exports of the last 24 hours (the owner's and admins' together).`,
        },
        409
      );
    }
    const jobId = start.data.jobId;
    const base: AdminExportAuditBase = { adminId, targetId, correlationId, request };

    AuditTrail.log(adminExportRequestedEntry(base, { jobId, reason })).catch((err) =>
      requestLogger.error({ err, targetUserId: targetId, jobId }, 'Audit failed (non-blocking)')
    );

    // ── Build: the owner's engine with the TARGET's context (§0.4.1 C) ───────
    const ctx: ExportContext = {
      userId: targetId,
      authUser: { id: targetId, email: account.email, created_at: account.createdAt as string },
    };
    const outcome = await runZipExport({ ctx, jobId, startedAt }, zipExportDeps(requestLogger), requestLogger);

    if (outcome.kind !== 'ready') {
      await logAndFlush(
        adminExportFailedEntry(base, {
          jobId,
          reason: outcome.reason,
          bytes: outcome.measured.zipBytes ?? outcome.measured.fileBytes ?? null,
          fileCount: outcome.measured.fileCount ?? null,
          rowCount: outcome.measured.rows ?? null,
          ceilingOver: outcome.over,
          durationMs: outcome.durationMs,
        }),
        requestLogger,
        { reason: 'admin data export failed', continues: 'the refusal is unaffected' }
      );
      if (outcome.reason === 'over_ceiling') return json({ success: false, code: 'export_too_large', error: TOO_LARGE_MESSAGE }, 413);
      if (outcome.reason === 'timeout') {
        return json({ success: false, code: 'export_timeout', error: 'The export could not be prepared in time. Try again.' }, 503);
      }
      return json({ success: false, code: 'export_failed', error: 'The export could not be prepared. Try again.' }, 500);
    }

    await logAndFlush(
      adminExportReadyEntry(base, {
        jobId,
        sectionCounts: outcome.sectionCounts,
        failedSections: outcome.failedSections,
        bytes: outcome.sizes.bytes,
        fileCount: outcome.sizes.fileCount,
        rowCount: outcome.sizes.rowCount,
        missingFiles: outcome.missingFiles,
        ceilingUsePct: outcome.ceilingUsePct,
        durationMs: outcome.durationMs,
      }),
      requestLogger,
      { reason: 'admin data export ready', continues: 'the export is still reported ready' }
    );
    // SA C-12 / BC-3: an admin export replaces only older admin exports.
    for (const replacedJobId of outcome.replacedJobIds) {
      AuditTrail.log(adminExportReplacedEntry(base, { replacedJobId, byJobId: jobId })).catch((err) =>
        requestLogger.error({ err, targetUserId: targetId, jobId: replacedJobId }, 'Audit failed (non-blocking)')
      );
    }

    requestLogger.info({ targetUserId: targetId, jobId, bytes: outcome.sizes.bytes }, 'Admin prepared a data export');
    return json(
      {
        success: true,
        data: {
          jobId,
          expiresAt: outcome.job.expires_at,
          bytes: outcome.sizes.bytes,
          fileCount: outcome.sizes.fileCount,
          rowCount: outcome.sizes.rowCount,
          failedSections: outcome.failedSections,
          missingFiles: outcome.missingFiles,
        },
      },
      200
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Admin data export request failed');
    return serverError(error);
  }
}
