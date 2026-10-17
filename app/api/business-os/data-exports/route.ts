// app/api/business-os/data-exports/route.ts
//
// POST: "Download my data" as ONE zip (data export DE-8b,
// BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §3.2, §5.1; requirement §0.4.1 A,
// C, E; SA review 2026-10-17, C-1 ... C-16).
//
// One request, at most 60 s (below the 90 s stale rule of the start function):
//   auth (getUser, identity only) -> strict EMPTY body (a missing body is {};
//   anything else, a `userId` included, is 400; SA C-7) -> request throttle
//   (the existing `create` rule; SA Q-15) -> startForOwner(user.id) (the
//   database's 1 at a time / 3 a day; 409 with retryAt) -> DATA_EXPORT_REQUESTED
//   -> runZipExport (pre-flight ceilings, bounded records, downloads, zip,
//   upload, markReady) -> sign a 120 s URL -> owner_downloaded_at (SA Q-9) ->
//   DATA_EXPORT_READY -> 200.
//
// The ONLY account id is the session's (SA DE-8a C-10). There is no id from a
// body, header or query.
//
// No env flag (SA ruling 2026-10-17): DE-9 switched all four "Download my
// data" entry points to this route and retired the JSON route; merging DE-9
// was the switch. The route acts only on the caller's own data, behind
// getUser(), the database limit and the throttle.
//
// GET (DE-9): "Last export …" for the control. See GET below.
//
// SA C-1: after markReady succeeded, a signing failure keeps the job `ready`
// and answers 500 `export_ready_sign_failed` (DE-9 offers "download again");
// no markFailed, no remove. Every exit before that settles inside
// runZipExport (markFailed + remove).
//
// SA C-3: the signed URL (token + business name) and the file name are NEVER
// logged or audited; they are in the 200 body only. Logs and audit details
// carry ids, counts, bytes and durations.
//
// WC-7: DATA_EXPORT_READY and DATA_EXPORT_FAILED are written with logAndFlush
// (bounded, never rejecting); REQUESTED and the replaced-export EXPIRED rows
// are non-blocking `log().catch()`.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrail } from '@/lib/services/AuditTrailService';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { businessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { businessOsDataExportStorageRepository } from '@/lib/repositories/BusinessOsDataExportStorageRepository';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';
import { runZipExport } from '@/lib/business-os/data-export/zipExport';
import { zipExportDeps } from '@/lib/business-os/data-export/zipExportDeps';
import { exportZipFileNames } from '@/lib/business-os/data-export/fileName';
import type { ExportContext } from '@/lib/business-os/data-export/sections';

const logger = createLogger({ module: 'BusinessOsDataExportsAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// ≤ 60 s, safely below the start function's 90 s stale rule (DE-8a).
export const maxDuration = 60;

const NO_STORE = 'no-store, no-cache, must-revalidate';
const FORMAT_VERSION = 2;

/** SA C-7: the body is empty. `{}` or no body at all; any key is a 400. */
const emptyBody = z.object({}).strict();

/** The §0.4.1 C sentence; `code` is what the client keys on (same as the JSON route). */
const TOO_LARGE_MESSAGE =
  'Your account holds more than the on-screen download can package (over 40 MB of files or 150 files). Nothing was downloaded. Please contact support and we will prepare your export.';

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

/** A missing or blank body reads as `{}`; invalid JSON is a 400 (never a 500). */
async function readBody(request: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await request.text();
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * GET: "Last export …" for the one "Download my data" control (data export
 * DE-9, workplan §3.1; SA DE-9 Q3, C-4).
 *
 * There is no input. The query string is IGNORED (a `?userId=` changes
 * nothing): the only account is the session's. No audit, because it is a read
 * of the owner's own status; no counts and no file name leave the server. A
 * job id is sent only while that export can still be downloaded, and only for
 * an owner-requested job (the repository filters requested_by_kind).
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return json({ success: false, error: 'Unauthorized' }, 401);

    const throttle = await rateLimit(request, 'data-export-status', RATE_LIMITS.read);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

    const latest = await businessOsDataExportJobRepository.findLatestCompletedForUser(user.id);
    if (latest.error) {
      requestLogger.error({ userId: user.id }, 'Data export status could not be read');
      return json({ success: false, error: 'Could not read your last export. Please try again.' }, 500);
    }

    const job = latest.data;
    if (!job) {
      requestLogger.debug({ userId: user.id, hasLastExport: false }, 'Data export status read');
      return json({ success: true, data: { lastExport: null } }, 200);
    }

    const isDownloadable = job.status === 'ready' && !!job.expires_at && Date.parse(job.expires_at) > Date.now();
    requestLogger.debug({ userId: user.id, jobId: job.id, isDownloadable }, 'Data export status read');
    return json(
      {
        success: true,
        data: {
          lastExport: {
            createdAt: job.created_at,
            downloadable: isDownloadable ? { jobId: job.id, expiresAt: job.expires_at } : null,
          },
        },
      },
      200
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Data export status request failed');
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

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return json({ success: false, error: 'Unauthorized' }, 401);
    const startedAt = Date.now();

    const body = await readBody(request);
    if (!body.ok) return json({ success: false, error: 'Invalid input', details: 'Request body is not valid JSON' }, 400);
    const parsed = emptyBody.safeParse(body.value);
    if (!parsed.success) {
      return json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        400
      );
    }

    const throttle = await rateLimit(request, 'data-export-start', RATE_LIMITS.create);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.create.windowSeconds);

    // ── Start: the database's limit (1 at a time, 3 a day) ─────────────────
    const start = await businessOsDataExportJobRepository.startForOwner(user.id);
    if (start.error || !start.data) {
      requestLogger.error({ err: start.error, userId: user.id }, 'Data export could not start');
      return json({ success: false, error: 'Could not start the export. Please try again.' }, 500);
    }
    if (start.data.outcome !== 'started') {
      const code = start.data.outcome === 'in_progress' ? 'export_in_progress' : 'export_daily_limit';
      requestLogger.info({ userId: user.id, code }, 'Data export refused by the start limit');
      return json(
        {
          success: false,
          code,
          retryAt: start.data.retryAt,
          error:
            code === 'export_in_progress'
              ? 'An export is already being prepared. Please wait a minute and try again.'
              : 'You have prepared 3 exports in the last 24 hours. Please try again later.',
        },
        409
      );
    }
    const jobId = start.data.jobId;

    AuditTrail.log({
      action: AUDIT_EVENTS.DATA_EXPORT_REQUESTED,
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      resourceName: 'Data export',
      details: { job_id: jobId, requested_by_kind: 'owner' },
      severity: 'info',
      complianceFlags: ['GDPR', 'SOC2'],
    }).catch((err) => requestLogger.error({ err, userId: user.id, jobId }, 'Audit failed (non-blocking)'));

    // ── Build (settles the job itself on every failure, C-1/C-2) ────────────
    const ctx: ExportContext = {
      userId: user.id,
      authUser: { id: user.id, email: user.email ?? null, created_at: user.created_at },
    };
    const outcome = await runZipExport({ ctx, jobId, startedAt }, zipExportDeps(requestLogger), requestLogger);

    if (outcome.kind !== 'ready') {
      await logAndFlush(
        {
          action: AUDIT_EVENTS.DATA_EXPORT_FAILED,
          entityType: 'user',
          entityId: user.id,
          userId: user.id,
          resourceName: 'Data export',
          details: {
            job_id: jobId,
            reason: outcome.reason,
            bytes: outcome.measured.zipBytes ?? outcome.measured.fileBytes ?? null,
            file_count: outcome.measured.fileCount ?? null,
            row_count: outcome.measured.rows ?? null,
            ceiling_over: outcome.over,
            duration_ms: outcome.durationMs,
          },
          severity: 'warning',
          complianceFlags: ['GDPR'],
        },
        requestLogger,
        { reason: 'data export failed', continues: 'the refusal is unaffected' }
      );
      if (outcome.reason === 'over_ceiling') {
        return json({ success: false, code: 'export_too_large', error: TOO_LARGE_MESSAGE }, 413);
      }
      if (outcome.reason === 'timeout') {
        return json({ success: false, code: 'export_timeout', error: 'We could not prepare your export in time. Please try again.' }, 503);
      }
      return json({ success: false, code: 'export_failed', error: 'We could not prepare your export. Please try again.' }, 500);
    }

    // ── Ready: audit, replaced exports, sign ────────────────────────────────
    await logAndFlush(
      {
        action: AUDIT_EVENTS.DATA_EXPORT_READY,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: 'Data export',
        details: {
          job_id: jobId,
          section_counts: outcome.sectionCounts,
          failed_sections: outcome.failedSections,
          bytes: outcome.sizes.bytes,
          file_count: outcome.sizes.fileCount,
          row_count: outcome.sizes.rowCount,
          missing_files: outcome.missingFiles,
          ceiling_use_pct: outcome.ceilingUsePct,
          duration_ms: outcome.durationMs,
          format_version: FORMAT_VERSION,
        },
        severity: 'info',
        complianceFlags: ['GDPR', 'SOC2'],
      },
      requestLogger,
      { reason: 'data export ready', continues: 'the export is still returned' }
    );
    // SA C-12: a replaced export is recorded as expired, reason 'replaced'.
    for (const oldJobId of outcome.replacedJobIds) {
      AuditTrail.log({
        action: AUDIT_EVENTS.DATA_EXPORT_EXPIRED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: 'Data export',
        details: { job_id: oldJobId, reason: 'replaced' },
        severity: 'info',
        complianceFlags: ['GDPR'],
      }).catch((err) => requestLogger.error({ err, userId: user.id, jobId: oldJobId }, 'Audit failed (non-blocking)'));
    }

    // C-8: stamped from the job's created_at (the day it started), as "download again" does.
    const names = exportZipFileNames(new Date(outcome.job.created_at), outcome.timezone, outcome.businessName);
    const signed = await businessOsDataExportStorageRepository.sign(
      user.id,
      jobId,
      EXPORT_JOB_POLICY.OWNER_SIGNED_URL_TTL_SECONDS,
      names.fileName
    );
    if (signed.error || !signed.data) {
      // C-1: the export stays ready; "download again" works.
      requestLogger.error({ userId: user.id, jobId }, 'Data export ready but the download link could not be made');
      return json(
        {
          success: false,
          code: 'export_ready_sign_failed',
          jobId,
          error: 'Your export is ready, but the download link could not be made. Please use "download again".',
        },
        500
      );
    }

    // Q-9 / BC-6: handing over the link counts as the owner's download.
    const downloaded = await businessOsDataExportJobRepository.markOwnerDownloaded(jobId, user.id);
    if (downloaded.error) requestLogger.warn({ userId: user.id, jobId }, 'Data export: the download was not recorded');

    return json(
      {
        success: true,
        data: {
          jobId,
          downloadUrl: signed.data,
          fileName: names.fileName,
          asciiFileName: names.asciiFileName,
          expiresAt: outcome.job.expires_at,
          failedSections: outcome.failedSections,
          missingFiles: outcome.missingFiles,
        },
      },
      200
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Data export request failed');
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
