// app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts
//
// POST: "download again" for the owner's own ready export, within its 3 days
// (data export DE-8b, BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §5.2;
// requirement §0.4.1 A).
//
// POST, not GET (SA C-7, amending §0.3.2 / §0.4.1 A): it has side effects
// (`owner_downloaded_at`, DATA_EXPORT_DOWNLOADED) that feed DE-10a's delete
// warning, and a cross-site top-level GET carries the Lax session cookie, so
// a link on another site could mark an export "downloaded". Strict empty body.
//
// auth -> Zod on the path (`jobId` a uuid; `partNo` exactly '1' in Phase 1)
// and the empty body -> throttle (the existing `read` rule; SA Q-15) ->
// findById(jobId, user.id): a foreign id returns null, so it is a 404 exactly
// like a missing one -> `ready` and `expires_at` in the future, else 410
// `export_expired` -> the file name re-derived (SA C-8: the job's created_at,
// the owner's timezone and business name read again, never stored; a failed
// name read gives the fallback name and a warn, never a failed download) ->
// sign 120 s -> markOwnerDownloaded -> DATA_EXPORT_DOWNLOADED (non-blocking)
// -> 200, no-store.
//
// SA C-3: neither the URL nor the file name is ever logged or audited.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrail } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { businessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { businessOsDataExportStorageRepository } from '@/lib/repositories/BusinessOsDataExportStorageRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';
import { exportZipFileNames } from '@/lib/business-os/data-export/fileName';
import { ownerTimezone } from '@/lib/business-os/data-export/ownerClock';
import { cleanBusinessName } from '@/lib/business-os/data-export/readme';

const logger = createLogger({ module: 'BusinessOsDataExportDownloadAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = 'no-store, no-cache, must-revalidate';

const paramsSchema = z.object({ jobId: z.string().uuid(), partNo: z.literal('1') }).strict();
const emptyBody = z.object({}).strict();

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

async function readBody(request: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await request.text();
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** The business name, read again (C-8). A failed read is the fallback name, never a failed download. */
async function businessName(userId: string, log: { warn: (c: Record<string, unknown>, m: string) => void }): Promise<string | null> {
  try {
    const { data, error } = await businessProfileRepository.findCompanyName(userId);
    if (error) {
      log.warn({ userId }, 'Data export download: business name unreadable, fallback file name');
      return null;
    }
    return cleanBusinessName(data);
  } catch (err) {
    log.warn({ err, userId }, 'Data export download: business name unreadable, fallback file name');
    return null;
  }
}

export async function POST(request: NextRequest, { params }: { params: { jobId: string; partNo: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return json({ success: false, error: 'Unauthorized' }, 401);

    const path = paramsSchema.safeParse(params);
    const body = await readBody(request);
    if (!path.success || !body.ok || !emptyBody.safeParse(body.value).success) {
      return json({ success: false, error: 'Invalid input' }, 400);
    }
    const { jobId } = path.data;

    const throttle = await rateLimit(request, 'data-export-download', RATE_LIMITS.read);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

    // Scoped by the session id: another account's job id is null, a 404 like a missing one.
    const found = await businessOsDataExportJobRepository.findById(jobId, user.id);
    if (found.error) {
      requestLogger.error({ userId: user.id, jobId }, 'Data export download: job unreadable');
      return json({ success: false, error: 'Could not read the export. Please try again.' }, 500);
    }
    const job = found.data;
    if (!job) return json({ success: false, error: 'Not found' }, 404);
    if (job.status !== 'ready' || !job.expires_at || Date.parse(job.expires_at) <= Date.now()) {
      return json({ success: false, code: 'export_expired', error: 'This export is no longer available. Please prepare a new one.' }, 410);
    }

    const [timezone, name] = await Promise.all([ownerTimezone(user.id, requestLogger), businessName(user.id, requestLogger)]);
    const names = exportZipFileNames(new Date(job.created_at), timezone, name);

    const signed = await businessOsDataExportStorageRepository.sign(
      user.id,
      jobId,
      EXPORT_JOB_POLICY.OWNER_SIGNED_URL_TTL_SECONDS,
      names.fileName
    );
    if (signed.error || !signed.data) {
      requestLogger.error({ userId: user.id, jobId }, 'Data export download: the link could not be made');
      return json({ success: false, error: 'Could not make the download link. Please try again.' }, 500);
    }

    const downloaded = await businessOsDataExportJobRepository.markOwnerDownloaded(jobId, user.id);
    if (downloaded.error) requestLogger.warn({ userId: user.id, jobId }, 'Data export download: the download was not recorded');

    AuditTrail.log({
      action: AUDIT_EVENTS.DATA_EXPORT_DOWNLOADED,
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      resourceName: 'Data export',
      details: { job_id: jobId, part_no: 1 },
      severity: 'info',
      complianceFlags: ['GDPR'],
    }).catch((err) => requestLogger.error({ err, userId: user.id, jobId }, 'Audit failed (non-blocking)'));

    return json(
      {
        success: true,
        data: { downloadUrl: signed.data, fileName: names.fileName, asciiFileName: names.asciiFileName, expiresAt: job.expires_at },
      },
      200
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Data export download failed');
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
