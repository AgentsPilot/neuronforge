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
// joined by the pure `assembleExportHistory`. The query string is ignored.
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
import type { ExportModuleId } from '@/lib/business-os/data-export/exportModules';
import { assembleExportHistory } from '@/lib/business-os/data-export/exportHistory';
import { buildExportRequestedEmail, type ExportEmailLanguage } from '@/lib/business-os/data-export/exportRequestedEmail';
import { ownerClock } from '@/lib/business-os/data-export/ownerClock';
import { isInvalidDomainRecipient, platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { BusinessOsExportRequestRepository } from '@/lib/repositories/BusinessOsExportRequestRepository';
import { BusinessOsExportModuleJobRepository } from '@/lib/repositories/BusinessOsExportModuleJobRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';

const logger = createLogger({ module: 'BusinessOsExportRequestsAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One RPC, a few short reads and one email.
export const maxDuration = 30;

const NO_STORE = 'no-store, no-cache, must-revalidate';

/** The "Export requested" email gets this long before the route answers anyway (C-7). */
export const REQUESTED_EMAIL_TIMEOUT_MS = 10_000;

/** The body: the ticked modules and nothing else (SA C-7 of DE-8b: strict). */
const startBody = z.object({ modules: requestedModulesSchema() }).strict();

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

type EmailOutcome = 'sent' | 'email_failed' | 'email_timeout';

/**
 * The one "Export requested" email. Never throws. The 10 s guard does not
 * cancel the send (C-7): a send that loses the race may still arrive while
 * `requested_email_sent_at` stays NULL, so the outcome says `email_timeout`,
 * not `email_failed`.
 */
async function sendRequestedEmail(
  args: { userId: string; requestId: string; to: string; modules: ExportModuleId[] },
  requestLogger: typeof logger
): Promise<EmailOutcome> {
  const requests = new BusinessOsExportRequestRepository();

  const [language, clock, stored] = await Promise.all([
    userPreferencesRepository.findPreferredLanguage(args.userId).then(
      (result): ExportEmailLanguage => {
        if (result.error) requestLogger.warn({ userId: args.userId, code: 'language_unreadable' }, 'Export requested email: language unreadable, sent in English');
        // `SupportedLanguage` is the same three-language union, so no cast is needed (SA CR-5).
        return result.data ?? 'en';
      },
      (): ExportEmailLanguage => 'en'
    ),
    ownerClock(args.userId, requestLogger),
    // The database time of the request, not this server's clock.
    requests.findByIdForUser(args.requestId, args.userId),
  ]);
  let requestedAt = new Date();
  if (stored.data) requestedAt = new Date(stored.data.requested_at);
  else requestLogger.warn({ requestId: args.requestId, code: 'requested_at_unreadable' }, 'Export requested email: request time unreadable, server time used');

  const email = buildExportRequestedEmail({
    language,
    modules: args.modules,
    requestedAt,
    timezone: clock.timezone,
    isTimezoneSet: clock.isSet,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), REQUESTED_EMAIL_TIMEOUT_MS);
  });
  try {
    const send = sendEmail({
      kind: 'transactional',
      to: [args.to],
      from: platformSenderAddress(),
      subject: email.subject,
      html: email.html,
      text: email.text,
      redactRecipientInLogs: true,
    }).catch(() => ({ sent: false as const, provider: 'none' as const }));
    const result = await Promise.race([send, timeout]);
    if (result === 'timeout') return 'email_timeout';
    return result.sent ? 'sent' : 'email_failed';
  } finally {
    if (timer) clearTimeout(timer);
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

    const throttle = await rateLimit(request, 'export-request-history', RATE_LIMITS.read);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

    // The query string is ignored on purpose: the only account is the session's.
    const recent = await new BusinessOsExportRequestRepository().listRecentForUser(user.id);
    if (recent.error || !recent.data) {
      requestLogger.error({ userId: user.id, code: 'history_requests_unreadable' }, 'Export history could not be read');
      return json({ success: false, error: 'Could not read your export history. Please try again.' }, 500);
    }
    const jobs = await new BusinessOsExportModuleJobRepository().listForRequestsOfUser(
      user.id,
      recent.data.map((r) => r.id)
    );
    if (jobs.error || !jobs.data) {
      requestLogger.error({ userId: user.id, code: 'history_jobs_unreadable' }, 'Export history could not be read');
      return json({ success: false, error: 'Could not read your export history. Please try again.' }, 500);
    }

    const history = assembleExportHistory(recent.data, jobs.data);
    if (history.anomalies > 0) {
      requestLogger.warn({ userId: user.id, anomalies: history.anomalies }, 'Export history: jobs and request modules did not match');
    }
    requestLogger.debug({ userId: user.id, requestCount: history.requests.length }, 'Export history read');
    return json({ success: true, data: { requests: history.requests } }, 200);
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
    let emailOutcome: EmailOutcome;
    try {
      emailOutcome = await sendRequestedEmail({ userId: user.id, requestId, to, modules }, requestLogger);
    } catch (err) {
      requestLogger.warn({ err, requestId }, 'Export requested email threw');
      emailOutcome = 'email_failed';
    }
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
