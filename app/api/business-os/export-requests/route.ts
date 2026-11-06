// app/api/business-os/export-requests/route.ts
//
// The per-module export's owner route (export redesign MX-1b, E5; workplan
// BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md §4, §5, §7; SA workplan review
// 2026-10-27, C-1 … C-12; requirement §3, §4.3, §4.4, §7 MX-1b, XC-8, XC-13,
// XC-15, XC-19, XC-21).
//
// POST: the owner asks for an export of the modules they ticked.
//   getUser (the ONLY account id; MX-3.1 removed the export switch)
//   -> strict body `{ modules }` (MX-0 ids, every one switched on; a `userId`
//   or any other key is a 400) -> throttle (the existing `create` rule) ->
//   a usable login email (else 409, nothing written) -> the database start
//   function (2 per rolling 24 h, one at a time: 409 with a code) ->
//   DATA_EXPORT_REQUESTED with logAndFlush (C-2) -> the one "Export requested"
//   email (awaited, best effort, 10 s guard; C-7) -> mark it sent -> 201.
//
// GET: the export history. Requests limited and ordered by the database
// (`requested_at DESC, id DESC`), then every job of exactly those requests,
// joined by the pure `assembleExportHistory`. MX-4b (workplan §5, H-1, N-1;
// SA C-4, C-5): the only query string accepted is the "Show older" keyset
// cursor `?before=<requestedAt>&beforeId=<uuid>` (both or neither, strict:
// any other key, a repeated key, a bad uuid or time is a 400). The account is
// always the session's; a cursor only moves within it. The answer adds
// `hasMore` (a page of 21 read, 20 returned) and `nextExportAt`, the owner's
// "export again at" hint computed from the start function's own counting rule
// (`findOwnerLimitAnchor` + `nextOwnerExportAt`), read on the first page only
// (an older page answers `nextExportAt: null` without the read). A failed hint read is
// `nextExportAt: null` and a warn: the history is still served, and the POST
// stays the authority (K-8).
//
// There is no kick to the worker (XC-8): the MX-3 cron picks the jobs up.
// Nothing here reads a plan, tier or lifecycle state, and nothing is imported
// from lib/business-os/entitlements (XC-19): export works in every state.
//
// Logs and audit carry ids, counts and codes only. The login email is never
// logged; it goes back only to its owner, in the 201 body (`sentTo`).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { requestedModulesSchema } from '@/lib/business-os/data-export/exportModuleSchema';
import { assembleExportHistory } from '@/lib/business-os/data-export/exportHistory';
import {
  EXPORT_REQUESTED_EMAIL_TIMEOUT_MS,
  sendExportRequestedEmail,
  type ExportRequestedEmailOutcome,
} from '@/lib/business-os/data-export/exportRequestedSend';
import { nextOwnerExportAt, ownerLimitWindowStart } from '@/lib/business-os/data-export/nextOwnerExportAt';
import { HISTORY_PAGE_SIZE, historyQuerySchema } from '@/lib/business-os/data-export/exportHistoryCursor';
import { isInvalidDomainRecipient } from '@/lib/notifications/emailTransport';
import { BusinessOsExportRequestRepository } from '@/lib/repositories/BusinessOsExportRequestRepository';
import { BusinessOsExportModuleJobRepository } from '@/lib/repositories/BusinessOsExportModuleJobRepository';

const logger = createLogger({ module: 'BusinessOsExportRequestsAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One RPC, a few short reads and one email.
export const maxDuration = 30;

const NO_STORE = 'no-store, no-cache, must-revalidate';

/**
 * The "Export requested" email gets this long before the route answers anyway
 * (C-7). MX-5 (SA-Q3 b): the guard and the send moved to
 * `lib/business-os/data-export/exportRequestedSend.ts`; same value, re-exported.
 */
export const REQUESTED_EMAIL_TIMEOUT_MS = EXPORT_REQUESTED_EMAIL_TIMEOUT_MS;

/** The body: the ticked modules and nothing else (SA C-7 of DE-8b: strict). */
const startBody = z.object({ modules: requestedModulesSchema() }).strict();

/** The query string as one object, or null when a key repeats (a repeated key is never silently collapsed). */
function queryObject(request: NextRequest): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (Object.prototype.hasOwnProperty.call(out, key)) return null;
    out[key] = value;
  }
  return out;
}

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

function devDetails(error: unknown): unknown {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : error;
}

/** A blank body is `{}` (then refused by the schema); invalid JSON is a 400, never a 500. */
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
 * The owner's "export again at" hint (MX-4b N-1), or null. Never throws and
 * never fails the history: a failed read is null and one warn, so Export stays
 * on and the POST decides (K-8). Server clock against the database's `now()`:
 * a few seconds of skew only moves when Export comes back on.
 */
async function readNextExportAt(
  requests: BusinessOsExportRequestRepository,
  userId: string,
  requestLogger: typeof logger
): Promise<string | null> {
  try {
    const anchor = await requests.findOwnerLimitAnchor(userId, ownerLimitWindowStart(Date.now()));
    if (anchor.error || !anchor.data) {
      const code = (anchor.error as (Error & { code?: string }) | null)?.code ?? null;
      requestLogger.warn({ userId, code: 'limit_anchor_unreadable', errorCode: code }, 'Export history: the limit hint could not be read');
      return null;
    }
    return nextOwnerExportAt(anchor.data.requestedAt);
  } catch (err) {
    requestLogger.warn({ err, userId, code: 'limit_anchor_unreadable' }, 'Export history: the limit hint read threw');
    return null;
  }
}

/**
 * GET: the owner's export history (workplan §5). No audit: a read of the
 * owner's own status.
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return json({ success: false, error: 'Unauthorized' }, 401);

    // MX-4b: the cursor is the only query accepted; the account is never taken from it.
    const rawQuery = queryObject(request);
    const query = rawQuery === null ? null : historyQuerySchema.safeParse(rawQuery);
    if (!query || !query.success) {
      requestLogger.info({ userId: user.id, code: 'invalid_input' }, 'Export history refused: invalid query');
      return json(
        {
          success: false,
          code: 'invalid_input',
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? (query ? query.error.flatten() : 'A query key is repeated') : undefined,
        },
        400
      );
    }
    const { before, beforeId } = query.data;
    const cursor = before !== undefined && beforeId !== undefined ? { requestedAt: before, id: beforeId } : undefined;

    const throttle = await rateLimit(request, 'export-request-history', RATE_LIMITS.read);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

    const requestRepository = new BusinessOsExportRequestRepository();
    // One row more than a page: its presence is `hasMore` (H-1).
    const [recent, nextExportAt] = await Promise.all([
      requestRepository.listRecentForUser(user.id, { limit: HISTORY_PAGE_SIZE + 1, ...(cursor ? { before: cursor } : {}) }),
      // The hint is for the drawer's open (first page) only; an older page answers null without the read.
      cursor ? Promise.resolve(null) : readNextExportAt(requestRepository, user.id, requestLogger),
    ]);
    if (recent.error || !recent.data) {
      requestLogger.error({ userId: user.id, code: 'history_requests_unreadable' }, 'Export history could not be read');
      return json({ success: false, error: 'Could not read your export history. Please try again.' }, 500);
    }
    const hasMore = recent.data.length > HISTORY_PAGE_SIZE;
    const page = recent.data.slice(0, HISTORY_PAGE_SIZE);
    const jobs = await new BusinessOsExportModuleJobRepository().listForRequestsOfUser(
      user.id,
      page.map((r) => r.id)
    );
    if (jobs.error || !jobs.data) {
      requestLogger.error({ userId: user.id, code: 'history_jobs_unreadable' }, 'Export history could not be read');
      return json({ success: false, error: 'Could not read your export history. Please try again.' }, 500);
    }

    const history = assembleExportHistory(page, jobs.data);
    if (history.anomalies > 0) {
      requestLogger.warn({ userId: user.id, anomalies: history.anomalies }, 'Export history: jobs and request modules did not match');
    }
    requestLogger.debug(
      { userId: user.id, requestCount: history.requests.length, hasMore, isOlderPage: cursor !== undefined, isLimited: nextExportAt !== null },
      'Export history read'
    );
    return json({ success: true, data: { requests: history.requests, hasMore, nextExportAt } }, 200);
  } catch (error) {
    requestLogger.error({ err: error }, 'Export history request failed');
    return json({ success: false, error: 'Internal server error', details: devDetails(error) }, 500);
  }
}

/** POST: start an export of the ticked modules (workplan §4.1). */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return json({ success: false, error: 'Unauthorized' }, 401);

    const body = await readBody(request);
    if (!body.ok) return json({ success: false, code: 'invalid_input', error: 'Invalid input', details: devDetails('Request body is not valid JSON') }, 400);
    const parsed = startBody.safeParse(body.value);
    if (!parsed.success) {
      requestLogger.info({ userId: user.id, code: 'invalid_input' }, 'Export request refused: invalid input');
      return json(
        {
          success: false,
          code: 'invalid_input',
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        400
      );
    }
    const modules = parsed.data.modules;

    const throttle = await rateLimit(request, 'export-request-start', RATE_LIMITS.create);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.create.windowSeconds);

    // D-7: the emails go to the login email; with none usable, nothing is written.
    const to = typeof user.email === 'string' ? user.email.trim() : '';
    if (!to || isInvalidDomainRecipient(to)) {
      requestLogger.warn({ userId: user.id, code: 'export_no_login_email' }, 'Export request refused: no usable login email');
      return json(
        { success: false, code: 'export_no_login_email', error: 'Your account has no email address the export can be sent to.' },
        409
      );
    }

    // ── Start: the database holds the limits (BQ-29) ───────────────────────
    const start = await new BusinessOsExportRequestRepository().startForOwner(user.id, modules);
    if (start.error || !start.data) {
      const code = (start.error as (Error & { code?: string }) | null)?.code ?? null;
      requestLogger.error({ userId: user.id, code }, 'Export request could not start');
      return json({ success: false, error: 'Could not start the export. Please try again.', details: devDetails(start.error) }, 500);
    }
    if (start.data.outcome === 'in_progress') {
      requestLogger.info({ userId: user.id, code: 'export_in_progress' }, 'Export request refused by the start limit');
      return json({ success: false, code: 'export_in_progress', error: 'An export is already running. Please try again when it has finished.' }, 409);
    }
    if (start.data.outcome === 'daily_limit') {
      requestLogger.info({ userId: user.id, code: 'export_daily_limit' }, 'Export request refused by the start limit');
      return json(
        { success: false, code: 'export_daily_limit', retryAt: start.data.retryAt, error: 'You have reached the export limit for now. Please try again later.' },
        409
      );
    }
    const requestId = start.data.requestId;

    // C-2: the only audit row of this request, flushed (bounded, never rejects).
    await logAndFlush(
      {
        action: AUDIT_EVENTS.DATA_EXPORT_REQUESTED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: 'Data export',
        details: { request_id: requestId, modules, origin: 'owner' },
        severity: 'info',
        complianceFlags: ['GDPR', 'SOC2'],
      },
      requestLogger,
      { reason: 'module export requested', continues: 'the export request stands' }
    );

    // D-6 / C-7: best effort; the request stands either way.
    // MX-5 (SA-Q3): the shared send, which never throws.
    const emailOutcome: ExportRequestedEmailOutcome = await sendExportRequestedEmail(
      { userId: user.id, requestId, to, modules, origin: 'owner' },
      requestLogger
    );
    let requestedEmailSent = false;
    if (emailOutcome === 'sent') {
      requestedEmailSent = true;
      const marked = await new BusinessOsExportRequestRepository().markRequestedEmailSent(requestId, user.id);
      if (marked.error) {
        // C-7: the mail went out, the column stays NULL. Logged, never fatal.
        requestLogger.warn({ requestId, code: 'mark_failed' }, 'Export requested email sent but not marked');
      }
    } else {
      requestLogger.warn({ requestId, code: emailOutcome }, 'Export requested email not confirmed');
    }

    requestLogger.info(
      { userId: user.id, requestId, moduleCount: modules.length, requestedEmailSent },
      'Export request started'
    );
    return json({ success: true, data: { requestId, sentTo: to, requestedEmailSent } }, 201);
  } catch (error) {
    requestLogger.error({ err: error }, 'Export request failed');
    return json({ success: false, error: 'Internal server error', details: devDetails(error) }, 500);
  }
}
