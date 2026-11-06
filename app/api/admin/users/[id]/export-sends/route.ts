/**
 * "Send export to owner": an admin sends one owner their own module export,
 * by email to the owner's login address (export redesign MX-5 / E8; workplan
 * BUSINESS_OS_EXPORT_MX5_WORKPLAN.md §4.1, §4.2; SA review 2026-11-03, M-1,
 * Q1 … Q10, S-1 … S-3; requirement §7 AC MX-5, XC-13, XC-19, XC-20, XC-21;
 * BQ-30 / BQ-30a answered "Yes, as suggested").
 *
 *   POST /api/admin/users/<uuid>/export-sends     body: { modules: [...] }
 *   GET  /api/admin/users/<uuid>/export-sends     (no query)
 *
 * ADMIN ONLY, and a deliberate CROSS-ACCOUNT action on one admin-selected
 * account. The admin never receives or sees the owner's data: the module
 * emails go to the owner's login email, read by the worker at send time by
 * the job's own user_id. No answer of this route carries that address.
 *
 * Not named `data-exports`: oneExportControl.guard forbids that folder (the
 * admin ZIP removed in MX-3.1).
 *
 * POST order, and nothing before step 1 (M-1):
 *   1 requireAdmin (401 / 403)
 *   2 the path id: Zod uuid, lower-cased (400)
 *   3 the body: blank = {}, invalid JSON = 400, strict `{ modules }` (400)
 *   4 the throttle (429)
 *   5 the admin's own account (409 admin_self_send, Q4)
 *   6 the owner's identity (`findUserIdentity`: error 500, none 404)
 *   7 a closed login (409 account_closed, DELETE's `isClosedAccountEmail`, Q1)
 *   8 a usable login email (409 export_no_login_email)
 *   9 the database start function (`startForAdmin`: the admin's own 2 per
 *     owner per rolling 24 h, one in flight; counted apart from the owner's)
 *  10 DATA_EXPORT_REQUESTED on the owner's account, the admin as actor
 *     (logAndFlush: bounded, never rejects)
 *  11 the "Export requested" email in support's voice (best effort, 10 s)
 *  12 201 `{ requestId, requestedEmailSent }`
 *
 * A refusal at steps 5 … 9 writes nothing: no request row, no allowance
 * used, no audit row (Q9: logged only), no email. A banned (locked) live
 * account passes: nothing here reads `banned_until`.
 *
 * GET: what the send dialog needs when the admin opens it (never on drawer
 * open, workplan E-20). `state` ('self' | 'not_found' | 'closed' |
 * 'no_login_email' | 'ready'), the switched-on modules with their English
 * names, the last 10 admin-origin sends with their module lines (BQ-E8-3),
 * and `nextSendAt` from the admin limit anchor (a hint; the POST decides).
 *
 * Service role: the repositories' documented choice (the tables are
 * server-write-only). Every call is keyed on the path id; the admin id comes
 * only from requireAdmin (tenant-isolation-guard). Nothing reads a plan, tier
 * or lifecycle state, and nothing imports lib/business-os/entitlements (XC-19).
 * Logs and the audit row carry ids, counts and codes only, never an email.
 *
 * @module app/api/admin/users/[id]/export-sends
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger, type Logger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { isClosedAccountEmail } from '@/lib/business-os/account-deletion/closedAccount';
import { requestedModulesSchema } from '@/lib/business-os/data-export/exportModuleSchema';
import { EXPORT_MODULES, enabledModules } from '@/lib/business-os/data-export/exportModules';
import { assembleExportHistory } from '@/lib/business-os/data-export/exportHistory';
import { sendExportRequestedEmail } from '@/lib/business-os/data-export/exportRequestedSend';
import { nextOwnerExportAt, ownerLimitWindowStart } from '@/lib/business-os/data-export/nextOwnerExportAt';
import { isInvalidDomainRecipient } from '@/lib/notifications/emailTransport';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { BusinessOsExportRequestRepository, EXPORT_REQUEST_ERROR } from '@/lib/repositories/BusinessOsExportRequestRepository';
import { BusinessOsExportModuleJobRepository } from '@/lib/repositories/BusinessOsExportModuleJobRepository';

const logger = createLogger({ module: 'AdminExportSendsAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One identity read, one RPC, a few short reads and one email.
export const maxDuration = 30;

const NO_STORE = 'no-store, no-cache, must-revalidate';

/** The admin box lists this many of support's sends. */
export const ADMIN_SEND_HISTORY_LIMIT = 10;

const targetIdSchema = z.string().uuid();
/** The body: the ticked modules and nothing else. A `userId`, `email`, `to` or `origin` is a 400. */
const sendBody = z.object({ modules: requestedModulesSchema() }).strict();

export type AdminExportSendState = 'self' | 'not_found' | 'closed' | 'no_login_email' | 'ready';

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

function devDetails(error: unknown): unknown {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : error;
}

function invalidInput(details?: unknown): NextResponse {
  return json({ success: false, code: 'invalid_input', error: 'Invalid input', details: process.env.NODE_ENV === 'development' ? details : undefined }, 400);
}

function refused(code: string, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return json({ success: false, code, error, ...extra }, 409);
}

/** A blank body is `{}` (then refused by the schema); invalid JSON is a 400, never a 500. */
async function readBody(request: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** A login email the export can go to: present, trimmed, not a reserved `.invalid` domain. */
function usableEmail(email: string | null): string | null {
  const to = typeof email === 'string' ? email.trim() : '';
  if (!to || isInvalidDomainRecipient(to)) return null;
  return to;
}

/** The English name of a module id; an id not in the map shows as itself. */
function moduleNameEn(id: string): string {
  return EXPORT_MODULES.find((module) => module.id === id)?.name.en ?? id;
}

/**
 * The admin's "send again at" hint, or null. Never throws and never fails the
 * GET: a failed read is null and one warn, and the POST decides (MX-4b K-8).
 */
async function readNextSendAt(
  requests: BusinessOsExportRequestRepository,
  ownerId: string,
  requestLogger: Logger
): Promise<string | null> {
  try {
    const anchor = await requests.findAdminLimitAnchor(ownerId, ownerLimitWindowStart(Date.now()));
    if (anchor.error || !anchor.data) {
      const code = (anchor.error as (Error & { code?: string }) | null)?.code ?? null;
      requestLogger.warn({ ownerId, code: 'limit_anchor_unreadable', errorCode: code }, 'Admin export sends: the limit hint could not be read');
      return null;
    }
    // The window arithmetic is the same for both origins: the anchor plus 24 hours.
    return nextOwnerExportAt(anchor.data.requestedAt);
  } catch (err) {
    requestLogger.warn({ err, ownerId, code: 'limit_anchor_unreadable' }, 'Admin export sends: the limit hint read threw');
    return null;
  }
}

/** GET: the send dialog's state, support's last sends and the limit hint. No audit: a read of metadata. */
export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'admin-export-sends', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    const parsedId = targetIdSchema.safeParse(context.params.id);
    if (!parsedId.success) return invalidInput('The account id is not a uuid');
    // Canonical form: Postgres matches uuids case-insensitively, JS equality (the self check) does not.
    const ownerId = parsedId.data.toLowerCase();

    // No query is accepted: the account is the path's only.
    if ([...request.nextUrl.searchParams.keys()].length > 0) return invalidInput('No query is accepted');

    const throttle = await rateLimit(request, 'admin-export-sends-read', RATE_LIMITS.read);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

    const modules = enabledModules().map((module) => ({ id: module.id, name: module.name.en }));
    const empty = (state: AdminExportSendState) => json({ success: true, data: { state, modules, sends: [], nextSendAt: null } }, 200);

    // S-1: the dialog knows before Send (the POST still refuses it, Q4).
    if (ownerId === adminId.toLowerCase()) return empty('self');

    const identity = await authAccountRepository.findUserIdentity(ownerId);
    if (identity.error) {
      requestLogger.error({ ownerId, code: 'identity_unreadable' }, 'Admin export sends: the account could not be read');
      return json({ success: false, error: 'Could not read the account. Please try again.' }, 500);
    }
    if (!identity.data) return empty('not_found');
    if (isClosedAccountEmail(identity.data.email)) return empty('closed');
    const state: AdminExportSendState = usableEmail(identity.data.email) === null ? 'no_login_email' : 'ready';

    const requestRepository = new BusinessOsExportRequestRepository();
    const [recent, nextSendAt] = await Promise.all([
      requestRepository.listRecentForUser(ownerId, { limit: ADMIN_SEND_HISTORY_LIMIT, origin: 'admin' }),
      readNextSendAt(requestRepository, ownerId, requestLogger),
    ]);
    if (recent.error || !recent.data) {
      requestLogger.error({ ownerId, code: 'history_requests_unreadable' }, 'Admin export sends could not be read');
      return json({ success: false, error: 'Could not read the export sends. Please try again.' }, 500);
    }
    // S-2: through the job repository, keyed on the owner's user_id AND these request ids.
    const jobs = await new BusinessOsExportModuleJobRepository().listForRequestsOfUser(
      ownerId,
      recent.data.map((r) => r.id)
    );
    if (jobs.error || !jobs.data) {
      requestLogger.error({ ownerId, code: 'history_jobs_unreadable' }, 'Admin export sends could not be read');
      return json({ success: false, error: 'Could not read the export sends. Please try again.' }, 500);
    }
    const history = assembleExportHistory(recent.data, jobs.data);
    if (history.anomalies > 0) {
      requestLogger.warn({ ownerId, anomalies: history.anomalies }, 'Admin export sends: jobs and request modules did not match');
    }
    const sends = history.requests.map((r) => ({
      requestId: r.requestId,
      requestedAt: r.requestedAt,
      modules: r.modules.map((line) => ({ ...line, name: moduleNameEn(line.module) })),
    }));

    requestLogger.debug({ ownerId, state, sendCount: sends.length, isLimited: nextSendAt !== null }, 'Admin export sends read');
    return json({ success: true, data: { state, modules, sends, nextSendAt } }, 200);
  } catch (error) {
    requestLogger.error({ err: error }, 'Admin export sends read failed');
    return json({ success: false, error: 'Internal server error', details: devDetails(error) }, 500);
  }
}

/** POST: send the owner an export of the ticked modules (workplan §4.1, the order in the header). */
export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'admin-export-sends', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    // 2: the path id.
    const parsedId = targetIdSchema.safeParse(context.params.id);
    if (!parsedId.success) return invalidInput('The account id is not a uuid');
    const ownerId = parsedId.data.toLowerCase();

    // 3: the body.
    const body = await readBody(request);
    if (!body.ok) return invalidInput('Request body is not valid JSON');
    const parsed = sendBody.safeParse(body.value);
    if (!parsed.success) {
      requestLogger.info({ ownerId, code: 'invalid_input' }, 'Admin export send refused: invalid input');
      return invalidInput(parsed.error.flatten());
    }
    const modules = parsed.data.modules;

    // 4: the throttle.
    const throttle = await rateLimit(request, 'admin-export-send', RATE_LIMITS.create);
    if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.create.windowSeconds);

    // 5: never to the admin's own account (Q4): it would be 2 extra self-exports a day.
    if (ownerId === adminId.toLowerCase()) {
      requestLogger.info({ ownerId, code: 'admin_self_send' }, 'Admin export send refused: own account');
      return refused('admin_self_send', 'You cannot send an export to your own account.');
    }

    // 6: the owner's identity.
    const identity = await authAccountRepository.findUserIdentity(ownerId);
    if (identity.error) {
      requestLogger.error({ ownerId, code: 'identity_unreadable' }, 'Admin export send: the account could not be read');
      return json({ success: false, error: 'Could not read the account. Please try again.' }, 500);
    }
    if (!identity.data) {
      requestLogger.info({ ownerId, code: 'account_not_found' }, 'Admin export send refused: no such account');
      return json({ success: false, code: 'account_not_found', error: 'No account has this id.' }, 404);
    }

    // 7: a closed (anonymised) login is refused before anything is written
    // (DELETE's rule, Q1: DELETE's helper, never a copy of its pattern). An
    // account closed between this check and step 9 is an accepted race (SA
    // Q1): the worker's no_recipient and the transport's `.invalid` refusal
    // stop every email, and the owner's data rows are already gone.
    if (isClosedAccountEmail(identity.data.email)) {
      requestLogger.warn({ ownerId, code: 'account_closed' }, 'Admin export send refused: the account is closed');
      return refused('account_closed', 'This account is closed. Nothing can be sent.');
    }

    // 8: a usable login email; with none, nothing is written.
    const to = usableEmail(identity.data.email);
    if (to === null) {
      requestLogger.warn({ ownerId, code: 'export_no_login_email' }, 'Admin export send refused: no usable login email');
      return refused('export_no_login_email', 'This account has no login email the export can be sent to.');
    }

    // 9: the database holds both limits and counts the admin's sends apart (BQ-30a).
    const start = await new BusinessOsExportRequestRepository().startForAdmin(ownerId, adminId, modules);
    if (start.error || !start.data) {
      const code = (start.error as (Error & { code?: string }) | null)?.code ?? null;
      if (code === EXPORT_REQUEST_ERROR.UNKNOWN_ACCOUNT) {
        requestLogger.info({ ownerId, code: 'account_not_found' }, 'Admin export send refused: no such account');
        return json({ success: false, code: 'account_not_found', error: 'No account has this id.' }, 404);
      }
      requestLogger.error({ ownerId, code }, 'Admin export send could not start');
      return json({ success: false, error: 'Could not start the export. Please try again.', details: devDetails(start.error) }, 500);
    }
    if (start.data.outcome === 'in_progress') {
      requestLogger.info({ ownerId, code: 'export_in_progress' }, 'Admin export send refused by the start limit');
      return refused('export_in_progress', 'An export sent by support is already running for this owner. Try again when it has finished.');
    }
    if (start.data.outcome === 'daily_limit') {
      requestLogger.info({ ownerId, code: 'export_daily_limit' }, 'Admin export send refused by the start limit');
      return refused('export_daily_limit', 'Support has reached the limit of 2 sends a day for this owner.', { retryAt: start.data.retryAt });
    }
    const requestId = start.data.requestId;

    // 10: the only audit row of this send, on the owner's account (XC-13), the admin as actor.
    await logAndFlush(
      {
        action: AUDIT_EVENTS.DATA_EXPORT_REQUESTED,
        entityType: 'user',
        entityId: ownerId,
        userId: ownerId,
        actorId: adminId,
        resourceName: 'Data export',
        details: { request_id: requestId, modules, origin: 'admin' },
        severity: 'info',
        complianceFlags: ['GDPR', 'SOC2'],
      },
      requestLogger,
      { reason: 'admin module export sent', continues: 'the export request stands' }
    );

    // 11: best effort; the request stands either way. Never throws.
    const emailOutcome = await sendExportRequestedEmail({ userId: ownerId, requestId, to, modules, origin: 'admin' }, requestLogger);
    let requestedEmailSent = false;
    if (emailOutcome === 'sent') {
      requestedEmailSent = true;
      const marked = await new BusinessOsExportRequestRepository().markRequestedEmailSent(requestId, ownerId);
      if (marked.error) requestLogger.warn({ requestId, code: 'mark_failed' }, 'Export requested email sent but not marked');
    } else {
      requestLogger.warn({ requestId, code: emailOutcome }, 'Export requested email not confirmed');
    }

    requestLogger.info({ ownerId, requestId, moduleCount: modules.length, requestedEmailSent }, 'Admin export send started');
    // 12: never the address (SA: no `sentTo` here).
    return json({ success: true, data: { requestId, requestedEmailSent } }, 201);
  } catch (error) {
    requestLogger.error({ err: error }, 'Admin export send failed');
    return json({ success: false, error: 'Internal server error', details: devDetails(error) }, 500);
  }
}
