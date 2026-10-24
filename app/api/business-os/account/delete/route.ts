/**
 * The customer self-delete (data export DE-10b.2; workplan §2.3; requirement
 * §3.3; SA Review 2 TQ-10, C2-10; SA workplan review O2-1 … O2-5, V-1 … V-7).
 *
 *   POST /api/business-os/account/delete   { statement, language }
 *
 * ⚠️ DESTRUCTIVE AND IRREVERSIBLE once `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED`
 * is `true`. Closes and anonymises the SESSION user's account with the
 * DE-10b.1 `anonymise` mode: business data deleted, our billing kept without
 * personal details, the login a closed tombstone. Every guard runs inside the
 * generated, secret-gated database function, which re-checks them all.
 *
 * Order, exactly (V-6), and each step stops before the next:
 *   1. the off switch → 404 (before the session is read)
 *   2. the session user, from `getUser()` only → 401
 *   3. the body, Zod `.strict()` → 400 (an `email`, `userId` or any other key)
 *   4. the throttle, per account and IP → 429
 *   5. the statement, against the SERVER's list → 400 `statement_mismatch`,
 *      counted in the failure budget, audited (reason only)
 *   6. no login email, cleanup secret or fingerprint key → 503 `not_available`
 *   7. the export facts (copied into the receipt)
 *   8. the engine: check → version → receipt → storage → anonymise (R-2: the
 *      receipt and the success audit row commit with the deletion)
 *
 * On success: the auth cookies on this request are expired (V-3), one email
 * goes to the address the account had (V-7, best-effort, never changes the
 * 200), and the answer carries the only redirect the client may follow.
 *
 * Audit (C2-10, O2-3, O2-4, SA addendum B-1): the success row is the
 * function's own `ACCOUNT_PSEUDONYMISED` (`user_id` NULL, in-function). A
 * refused or failed attempt writes `ACCOUNT_DELETION_REFUSED` with `user_id` =
 * `actor_id` = `entity_id` = the session user,
 * through `logAndFlush` (bounded, never failing the request). Never the email,
 * the statement text or the fingerprint, in an audit row or a log line.
 *
 * @module app/api/business-os/account/delete
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { logAndFlush, type AuditFlushLogger } from '@/lib/audit/boundedAuditFlush';
import { isAccountSelfDeleteEnabled } from '@/lib/utils/featureFlags';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { isTestCleanupConfigured } from '@/lib/server/testCleanupSecret';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { BusinessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { matchStatement, type StatementLanguage } from '@/lib/business-os/account-deletion/acknowledgement';
import { accountDeleteBodySchema, accountDeletedRedirect } from '@/lib/business-os/account-deletion/schemas';
import { toBlockerViews } from '@/lib/business-os/account-deletion/blockerCopy';
import { expireAuthCookies } from '@/lib/business-os/account-deletion/authCookies';
import { buildDeletionEmail } from '@/lib/business-os/account-deletion/deletionEmail';
import { buildOwnerReceipt } from '@/lib/business-os/account-deletion/receiptInput';
import {
  FINGERPRINT_KEY_VERSION,
  fingerprintEmail,
  isFingerprintKeyAvailable,
} from '@/lib/business-os/account-deletion/receiptFingerprint';
import { readSessionSubject, selfDeleteThrottleKey } from '@/lib/business-os/account-deletion/sessionSubject';
import { errorKindFacts, runSelfAccountAnonymise } from '@/lib/business-os/account-deletion/selfServiceDeletion';

const logger = createLogger({ module: 'AccountSelfDeleteAPI' });

// Node: Pino, crypto and the service-role engine. Never cached. 60 s: the check, the storage step and the anonymise.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = 'no-store, no-cache, must-revalidate';
/** SA N-6: the body is a statement of at most 500 characters; anything far larger is refused before it is read whole. */
export const MAX_BODY_BYTES = 4096;
/** The email may delay the answer by this much at most (V-7: it never changes the outcome). */
const EMAIL_DEADLINE_MS = 5000;

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

/** SA N-2: the shared 429, with `no-store` set here (the shared helper is left unchanged for its other callers). */
function throttled(): Response {
  const response = tooManyRequests(RATE_LIMITS.write.windowSeconds);
  response.headers.set('Cache-Control', NO_STORE);
  return response;
}

interface RefusalFacts {
  reason: string;
  guards: string[];
  filesRemoved: number;
}

/** The refused/failed row: reason, guard ids, file count, correlation id. Never the email or the statement. */
async function auditRefused(
  request: NextRequest,
  requestLogger: AuditFlushLogger,
  subjectId: string,
  correlationId: string,
  facts: RefusalFacts
): Promise<void> {
  await logAndFlush(
    {
      action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED,
      entityType: 'user',
      entityId: subjectId,
      // SA addendum B-1 (amends O2-4 / C2-10 for refusals): the session user. A NULL here is
      // rewritten by AuditTrailService.buildLogEntry to SYSTEM_ADMIN_USER_ID with
      // `system_action: true`, which would attribute the attempt to the platform. A refused
      // attempt leaves the account in place, so the row belongs to it.
      userId: subjectId,
      actorId: subjectId,
      details: {
        source: 'self_service',
        reason: facts.reason,
        guards: facts.guards,
        files_removed: facts.filesRemoved,
        correlation_id: correlationId,
      },
      request,
    },
    requestLogger,
    { reason: 'account self-delete refused', continues: 'responding anyway' }
  );
}

/** Send once, bounded, never throwing. Returns what happened, for an ids-only log line. */
async function sendConfirmation(to: string, language: StatementLanguage, deletedAt: Date): Promise<'sent' | 'not_sent' | 'timeout' | 'threw'> {
  const email = buildDeletionEmail(language, deletedAt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      sendEmail({ to: [to], subject: email.subject, html: email.html, text: email.text, kind: 'transactional', redactRecipientInLogs: true }).then(
        (result) => (result.sent ? ('sent' as const) : ('not_sent' as const))
      ),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), EMAIL_DEADLINE_MS);
      }),
    ]);
    return outcome;
  } catch {
    return 'threw';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  // 1. O2-1: off → 404, before anything is read.
  if (!isAccountSelfDeleteEnabled()) return json({ success: false, error: 'not_found' }, 404);

  const baseLogger = logger.child({ correlationId });
  // 2. The session user only (C2-10).
  let subject: Awaited<ReturnType<typeof readSessionSubject>>;
  try {
    subject = await readSessionSubject();
  } catch (error) {
    baseLogger.error({ err: errorKindFacts(error) }, 'Account self-delete: the session could not be verified');
    subject = null;
  }
  if (!subject) return json({ success: false, error: 'Unauthorized', correlationId }, 401);
  const subjectId = subject.id;
  const requestLogger = baseLogger.child({ subjectId });

  // 3. Zod `.strict()`: nothing but the statement and the UI language.
  // SA N-6: refuse an oversized body by its declared length, and again by what arrived (a chunked body has none).
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ success: false, error: 'body_too_large', correlationId }, 413);
  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return json({ success: false, error: 'body_too_large', correlationId }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ success: false, error: 'invalid_body', correlationId }, 400);
  }
  const parsed = accountDeleteBodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        success: false,
        error: 'invalid_body',
        details: process.env.NODE_ENV === 'development' ? parsed.error.issues[0]?.message : undefined,
        correlationId,
      },
      400
    );
  }
  const input = parsed.data;

  // 4. Per account and IP (O2-2). Fails open when the counter is down, as `rateLimit` documents.
  const throttleKey = selfDeleteThrottleKey('account-delete', subjectId);
  const throttle = await rateLimit(request, throttleKey, RATE_LIMITS.write);
  if (!throttle.allowed) return throttled();

  // 5. The server's own statement list (§3.3, V-5). The body's `language` is the UI's, not the match.
  const matched = matchStatement(input.statement);
  if (matched === null) {
    const failures = await rateLimit(request, throttleKey, RATE_LIMITS.write, 'failure');
    requestLogger.warn({ outcome: 'statement_mismatch', uiLanguage: input.language }, 'Account self-delete refused: the statement does not match');
    await auditRefused(request, requestLogger, subjectId, correlationId, { reason: 'statement_mismatch', guards: [], filesRemoved: 0 });
    if (!failures.allowed) return throttled();
    return json({ success: false, error: 'statement_mismatch', correlationId }, 400);
  }

  // 6. V-1 and C2-5: no email, no secret or no key → nothing is called.
  const email = subject.email;
  if (email === null || !isTestCleanupConfigured() || !isFingerprintKeyAvailable()) {
    requestLogger.warn(
      { outcome: 'not_available', hasEmail: email !== null, cleanupConfigured: isTestCleanupConfigured(), keyAvailable: isFingerprintKeyAvailable() },
      'Account self-delete refused: not available on this deployment'
    );
    await auditRefused(request, requestLogger, subjectId, correlationId, { reason: 'not_available', guards: [], filesRemoved: 0 });
    return json({ success: false, error: 'not_available', correlationId }, 503);
  }

  const started = Date.now();
  try {
    // 7. The export facts, for the receipt (the export rows go with the account).
    const facts = await new BusinessOsDataExportJobRepository().findDeletionFacts(subjectId);
    if (facts.error || !facts.data) {
      requestLogger.error({ outcome: 'facts_failed' }, 'Account self-delete failed: the export facts could not be read');
      await auditRefused(request, requestLogger, subjectId, correlationId, { reason: 'facts_failed', guards: [], filesRemoved: 0 });
      return json({ success: false, error: 'delete_failed', filesRemoved: false, correlationId }, 500);
    }
    const exportFacts = facts.data;
    const requestedAt = new Date();

    // 8. The engine. The receipt is built for the login the check resolved, which must be the session's.
    const outcome = await runSelfAccountAnonymise({ email, subject: subjectId }, async (targetUserId) => {
      if (targetUserId !== subjectId.toLowerCase()) throw new Error('The check resolved another login');
      return buildOwnerReceipt({
        // In memory only: the email itself never leaves this request.
        emailFingerprint: fingerprintEmail(email),
        fingerprintKeyVersion: FINGERPRINT_KEY_VERSION,
        statementLanguage: matched,
        statementText: input.statement,
        ownerLastExportReadyAt: exportFacts.ownerLastExportReadyAt,
        ownerExportDownloadedAt: exportFacts.ownerExportDownloadedAt,
        adminExportExisted: exportFacts.adminExportExisted,
        requestedAt,
        correlationId,
      });
    });

    if (outcome.kind === 'anonymised') {
      const response = json({ success: true, data: { redirect: accountDeletedRedirect(matched) }, correlationId }, 200);
      const expired = expireAuthCookies(request.cookies, response);
      const emailOutcome = await sendConfirmation(email, matched, new Date());
      requestLogger.info(
        {
          outcome: 'anonymised',
          receiptId: outcome.report.receiptId,
          receiptMode: outcome.report.receiptMode,
          rows: outcome.report.rowsRemoved,
          rowsBlanked: outcome.report.rowsBlanked,
          filesRemoved: outcome.filesRemoved,
          notes: [...new Set(outcome.notes.map((note) => note.guard))],
          cookiesExpired: expired.length,
          email: emailOutcome,
          serverMs: outcome.serverMs,
          elapsedMs: Date.now() - started,
        },
        'Account deleted by its owner'
      );
      return response;
    }

    if (outcome.kind === 'refused') {
      requestLogger.warn(
        {
          outcome: 'refused',
          reason: outcome.reason,
          guards: outcome.guards,
          filesRemoved: outcome.filesRemoved,
          serverMs: outcome.serverMs,
          elapsedMs: Date.now() - started,
        },
        'Account self-delete refused'
      );
      await auditRefused(request, requestLogger, subjectId, correlationId, {
        reason: outcome.reason,
        guards: outcome.guards,
        filesRemoved: outcome.filesRemoved,
      });
      // The check's rows when it refused there; the guard ids when the anonymise refused after it.
      const rows = outcome.blockers.length > 0 ? outcome.blockers : outcome.guards.map((guard) => ({ guard }));
      const mapped = toBlockerViews(rows.length > 0 ? rows : [{ guard: 'unknown' }]);
      // SA N-1: rows that all map to nothing (G-12 only) must still tell the customer something.
      const blockers = mapped.length > 0 ? mapped : [{ code: 'contact_support' as const }];
      return json(
        { success: false, error: 'blocked', blockers, filesRemoved: outcome.filesRemovedThenRefused, correlationId },
        409
      );
    }

    if (outcome.kind === 'unavailable') {
      requestLogger.error(
        {
          outcome: 'unavailable',
          reason: outcome.reason,
          err: outcome.error ? errorKindFacts(outcome.error) : undefined,
          filesRemoved: outcome.filesRemoved,
          elapsedMs: Date.now() - started,
        },
        'Account self-delete refused: the cleanup function is not usable'
      );
      await auditRefused(request, requestLogger, subjectId, correlationId, {
        reason: outcome.reason,
        guards: [],
        filesRemoved: outcome.filesRemoved,
      });
      return json({ success: false, error: 'not_available', filesRemoved: outcome.filesRemoved > 0, correlationId }, 503);
    }

    requestLogger.error(
      {
        outcome: 'failed',
        stage: outcome.stage,
        err: errorKindFacts(outcome.error),
        filesRemoved: outcome.filesRemoved,
        elapsedMs: Date.now() - started,
      },
      'Account self-delete failed'
    );
    await auditRefused(request, requestLogger, subjectId, correlationId, {
      reason: `${outcome.stage}_failed`,
      guards: [],
      filesRemoved: outcome.filesRemoved,
    });
    return json(
      {
        success: false,
        error: 'delete_failed',
        // A storage failure can have removed some files; the account is kept either way.
        filesRemoved: outcome.stage === 'storage' || outcome.filesRemoved > 0,
        correlationId,
      },
      500
    );
  } catch (error) {
    requestLogger.error({ outcome: 'unexpected', err: errorKindFacts(error) }, 'Account self-delete failed unexpectedly');
    await auditRefused(request, requestLogger, subjectId, correlationId, { reason: 'unexpected_failed', guards: [], filesRemoved: 0 });
    return json(
      {
        success: false,
        error: 'delete_failed',
        filesRemoved: false,
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
        correlationId,
      },
      500
    );
  }
}
