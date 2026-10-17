/**
 * An admin's AUDITED download of one account's ready export (data export
 * DE-10a; BUSINESS_OS_DATA_EXPORT_DE10A_WORKPLAN.md §5.3; requirement
 * §0.3.4, DX-7; SA-1, SA-5, SA-7, SA-10, SA-11, W10-1 ... W10-5, W10-9).
 *
 *   POST /api/admin/users/<uuid>/data-exports/<jobId>/parts/1/download  { reason }
 *
 * The ONLY route that hands an admin a download link (SA-10). The order is
 * fixed (W10-3) and nothing may move:
 *
 *   requireAdmin (first statement) -> the path (target uuid lower-cased,
 *   jobId uuid, partNo exactly '1') -> the body `{ reason }`, `.strict()` ->
 *   throttle (RATE_LIMITS.write, SA-11: every call writes a critical row) ->
 *   own account 403 (BC-6) -> findById(jobId, targetId): another account's
 *   job is a 404 exactly like a missing one -> not ready or past expires_at:
 *   410 -> WRITE-AHEAD DATA_EXPORT_DOWNLOADED_BY_ADMIN with writeNow
 *   (critical, the admin's reason, the admin as user and actor): not written,
 *   or a throw, is 503 `audit_unavailable` and NOTHING IS SIGNED -> the file
 *   name (the shared downloadName.ts rule, so it is the owner's name) -> sign
 *   60 s -> 200.
 *
 * Either kind of job may be downloaded (BC-2: an owner-made ready export
 * too). The owner's "downloaded" stamp is never set from here: the admin path
 * does not use the owner's download marker at all (SA-5, source-pinned).
 *
 * A signing failure after the row was written is a 500 with no compensating
 * row (SA-7): the row means "an admin was authorised and the link was
 * requested", the AD-2a STARTED-without-outcome precedent.
 *
 * W10-5: the signed URL, its token, the object path, the file name, the
 * business name and any email are NEVER logged or audited; they are in the
 * 200 body only.
 *
 * @module app/api/admin/users/[id]/data-exports/[jobId]/parts/[partNo]/download
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { businessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { businessOsDataExportStorageRepository } from '@/lib/repositories/BusinessOsDataExportStorageRepository';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';
import { exportDownloadNames } from '@/lib/business-os/data-export/downloadName';
import { adminExportDownloadedEntry } from '@/lib/business-os/data-export/adminExportAudit';

const logger = createLogger({ module: 'AdminDataExportDownloadAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = 'no-store, no-cache, must-revalidate';

const paramsSchema = z.object({ id: z.string().uuid(), jobId: z.string().uuid(), partNo: z.literal('1') }).strict();
/** W10-2: the reason only. Any other key, an id included, is a 400. */
const bodySchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

export async function POST(request: NextRequest, context: { params: { id: string; jobId: string; partNo: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'admin-data-export-download', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    const path = paramsSchema.safeParse(context.params);
    if (!path.success) return json({ success: false, error: 'invalid_path' }, 400);
    const targetId = path.data.id.toLowerCase();
    const jobId = path.data.jobId.toLowerCase();

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

    const throttle = await rateLimit(request, 'admin-data-export-download', RATE_LIMITS.write);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.write.windowSeconds);

    if (targetId === adminId.toLowerCase()) {
      return json({ success: false, code: 'own_account', error: 'Use Download my data in your own settings for your own account.' }, 403);
    }

    // Scoped by the PATH account (tenant-isolation-guard): another account's job is null, a 404.
    const found = await businessOsDataExportJobRepository.findById(jobId, targetId);
    if (found.error) {
      requestLogger.error({ targetUserId: targetId, jobId }, 'Admin data export download: job unreadable');
      return json({ success: false, error: 'The export could not be read. Try again.' }, 500);
    }
    const job = found.data;
    if (!job) return json({ success: false, error: 'Not found' }, 404);
    if (job.status !== 'ready' || !job.expires_at || Date.parse(job.expires_at) <= Date.now()) {
      return json({ success: false, code: 'export_expired', error: 'This export is no longer available. Prepare a new one.' }, 410);
    }

    // ── Write-ahead: no record, no link (§0.3.4, W10-3) ────────────────────
    let written = false;
    try {
      const outcome = await AuditTrailService.getInstance().writeNow(
        adminExportDownloadedEntry(
          { adminId, targetId, correlationId, request },
          { jobId, requestedByKind: job.requested_by_kind, reason }
        )
      );
      written = outcome.written === true;
    } catch (err) {
      requestLogger.error({ err, targetUserId: targetId, jobId }, 'Admin data export download: the audit write threw');
      written = false;
    }
    if (!written) {
      requestLogger.error({ targetUserId: targetId, jobId }, 'Admin data export download refused: the audit row was not written');
      return json(
        { success: false, code: 'audit_unavailable', error: 'The download could not be recorded, so it was not started. Try again.' },
        503
      );
    }

    // The file name rule shared with the owner (DX-10): the TARGET's clock and business name.
    const names = await exportDownloadNames(targetId, job.created_at, requestLogger);
    const signed = await businessOsDataExportStorageRepository.sign(
      targetId,
      jobId,
      EXPORT_JOB_POLICY.ADMIN_SIGNED_URL_TTL_SECONDS,
      names.fileName
    );
    if (signed.error || !signed.data) {
      // SA-7: the written row stays; ids only in the log, never the path or URL.
      requestLogger.error({ targetUserId: targetId, jobId, correlationId }, 'Admin data export download: the link could not be made');
      return json({ success: false, error: 'The download link could not be made. Try again.' }, 500);
    }

    requestLogger.info({ targetUserId: targetId, jobId, requestedByKind: job.requested_by_kind }, 'Admin downloaded a data export (audited)');
    return json(
      {
        success: true,
        data: {
          downloadUrl: signed.data,
          fileName: names.fileName,
          asciiFileName: names.asciiFileName,
          expiresAt: job.expires_at,
          linkSeconds: EXPORT_JOB_POLICY.ADMIN_SIGNED_URL_TTL_SECONDS,
        },
      },
      200
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Admin data export download failed');
    return json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      500
    );
  }
}
