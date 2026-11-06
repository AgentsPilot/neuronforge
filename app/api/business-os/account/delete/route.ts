/**
 * The account deletion REQUEST (account deletion lifecycle DL-1b / D6;
 * requirement §3.3, XC-2, XC-5, XC-6; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §4; SA W-1 to W-14).
 * Until DL-1b this route anonymised the account at once (DE-10b.2); it now
 * only RECORDS a request. NOTHING IS DELETED HERE (XC-6, pinned by the
 * `no-deletion-paths` guard, family 6): the account closes later, through the
 * lifecycle (DL-3 to DL-5).
 *
 *   POST /api/business-os/account/delete   { statement, language, reasonCode }
 *
 * Behind `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` (default off; XC-15: the
 * request switch). The Keep route is not behind it (XC-4).
 *
 * Order, exactly, and each step stops before the next:
 *   1. the off switch → 404 (before the session is read)
 *   2. the session user, from `getUser()` only (`readSessionSubject`) → 401
 *   3. the body, size-capped, Zod `.strict()` → 413 / 400 (an `email`,
 *      `userId`, `origin` or any other key; a missing or unknown `reasonCode`)
 *   4. the throttle, per account and IP → 429
 *   5. the statement, against the SERVER's list → 400 `statement_mismatch`,
 *      counted in the failure budget, audited (reason only)
 *   6. no login email, cleanup secret or fingerprint key → 503 `not_available`
 *   7. `runClosureRequest` (closureRequest.ts): the open-row read, our billing
 *      row, the check with the XC-5 filter, the `requesting` row, then the free
 *      path (`grace` with the lock date) or the one "don't renew" engine and
 *      `pending`
 *
 * Kept from DE-10b.2 (XC-6): the switch, the session, the body cap, the
 * statement match, the throttle and the refusal audit shape, the "available"
 * gate, `runAccountDeletionCheck`. Removed: the export facts, the receipt, the
 * anonymise, the fingerprint, the cookie expiry, the "deleted" email, the
 * `/account-deleted` redirect. No email is sent (D-8): DL-3 sends "Deletion
 * requested" from its claim.
 *
 * Audit (XC-13; SA W-14), flushed bounded before the answer (WC-7), never
 * failing the request:
 *   - BOS_BILLING_SUBSCRIPTION_CANCELLED when the engine reached the Stripe
 *     write (`user_id` = the session user; `details.origin: 'deletion_request'`)
 *   - ACCOUNT_DELETION_REQUESTED (and ACCOUNT_GRACE_STARTED for a free account)
 *     with `user_id` UNSET (the system user, so the row survives stage E) and
 *     `actor_id` = the session user
 *   - ACCOUNT_DELETION_REFUSED for a refused or failed attempt, `user_id` =
 *     `actor_id` = `entity_id` = the session user (B-1), `details.source:
 *     'self_service'`, `stage: 'request'`
 * Never the email, the statement text, a reason text or a Stripe / database
 * message, in an audit row, a log line or the answer.
 *
 * @module app/api/business-os/account/delete
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { logAndFlush, type AuditFlushLogger } from '@/lib/audit/boundedAuditFlush';
import type { AuditLogInput } from '@/lib/audit/types';
import { isAccountSelfDeleteEnabled } from '@/lib/utils/featureFlags';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { isTestCleanupConfigured } from '@/lib/server/testCleanupSecret';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import type { PlanManageAuditFacts } from '@/lib/business-os/billing/planSubscriptionManage';
import { matchStatement } from '@/lib/business-os/account-deletion/acknowledgement';
import { accountDeleteBodySchema } from '@/lib/business-os/account-deletion/schemas';
import { isFingerprintKeyAvailable } from '@/lib/business-os/account-deletion/receiptFingerprint';
import { readSessionSubject, selfDeleteThrottleKey } from '@/lib/business-os/account-deletion/sessionSubject';
import { errorKindFacts } from '@/lib/business-os/account-deletion/selfServiceDeletion';
import { CLOSURE_REQUEST_REFUSAL_STATUS, runClosureRequest, type ClosureRequestOutcome } from '@/lib/business-os/account-deletion/closureRequest';
import { closureRequestDeps } from '@/lib/business-os/account-deletion/closureRequestDeps';

const logger = createLogger({ module: 'AccountDeletionRequestAPI' });

// Node: Pino and the service-role repositories. Never cached. 60 s: the check plus one Stripe write.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = 'no-store, no-cache, must-revalidate';
/** SA N-6: the body is a statement of at most 500 characters; anything far larger is refused before it is read whole. */
export const MAX_BODY_BYTES = 4096;

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

/** SA N-2: the shared 429, with `no-store` set here (the shared helper is left unchanged for its other callers). */
function throttled(): Response {
  const response = tooManyRequests(RATE_LIMITS.write.windowSeconds);
  response.headers.set('Cache-Control', NO_STORE);
  return response;
}

/** The refused/failed row (B-1): the session user owns it, the account stays. Codes only. */
function refusedEntry(request: NextRequest, subjectId: string, correlationId: string, reason: string, guards: string[]): AuditLogInput {
  return {
    action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED,
    entityType: 'user',
    entityId: subjectId,
    // SA addendum B-1: the session user, never the system user, for a refusal.
    userId: subjectId,
    actorId: subjectId,
    details: {
      // SA W-14: the DE-10b.2 value kept, so older and newer rows filter alike.
      source: 'self_service',
      stage: 'request',
      reason,
      guards,
      correlation_id: correlationId,
    },
    request,
  };
}

/** The money row when the engine reached the Stripe write (the plain cancel route's fields + origin). */
function cancelledEntry(request: NextRequest, subjectId: string, accountId: string, correlationId: string, facts: PlanManageAuditFacts, closureId: string | undefined): AuditLogInput {
  return {
    action: AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_CANCELLED,
    entityType: 'business_os_billing_account',
    entityId: accountId,
    userId: subjectId,
    actorId: subjectId,
    details: {
      subscriptionId: facts.subscriptionId,
      outcome: facts.outcome,
      endsOn: facts.endsOn,
      mode: facts.mode,
      livemode: facts.livemode,
      reasonCode: facts.reasonCode,
      actor: 'owner',
      origin: facts.origin ?? 'deletion_request',
      closure_id: closureId ?? null,
      correlationId,
    },
    request,
  };
}

async function flush(entries: AuditLogInput[], requestLogger: AuditFlushLogger): Promise<void> {
  await logAndFlush(entries, requestLogger, { reason: 'account deletion request', continues: 'responding anyway' });
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
    baseLogger.error({ err: errorKindFacts(error) }, 'Account deletion request: the session could not be verified');
    subject = null;
  }
  if (!subject) return json({ success: false, error: 'Unauthorized', correlationId }, 401);
  const subjectId = subject.id;
  const requestLogger = baseLogger.child({ subjectId });

  // 3. Zod `.strict()`: the statement, the UI language and the reason code. Nothing else.
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
    requestLogger.warn({ outcome: 'statement_mismatch', uiLanguage: input.language }, 'Account deletion request refused: the statement does not match');
    await flush([refusedEntry(request, subjectId, correlationId, 'statement_mismatch', [])], requestLogger);
    if (!failures.allowed) return throttled();
    return json({ success: false, error: 'statement_mismatch', correlationId }, 400);
  }

  // 6. V-1 and XC-5: no email, no secret or no key → nothing is called.
  const email = subject.email;
  if (email === null || !isTestCleanupConfigured() || !isFingerprintKeyAvailable()) {
    requestLogger.warn(
      { outcome: 'not_available', hasEmail: email !== null, cleanupConfigured: isTestCleanupConfigured(), keyAvailable: isFingerprintKeyAvailable() },
      'Account deletion request refused: not available on this deployment'
    );
    await flush([refusedEntry(request, subjectId, correlationId, 'not_available', [])], requestLogger);
    return json({ success: false, error: 'not_available', correlationId }, 503);
  }

  // The session's account, through the seam (W-8: never a request value).
  const accountId = resolveAccountId(subjectId);
  const started = Date.now();
  let outcome: ClosureRequestOutcome;
  try {
    // 7. The request: the order and the XC-2 invariant live in closureRequest.ts.
    outcome = await runClosureRequest(
      { subject: subjectId, email, accountId, statementLanguage: matched, reasonCode: input.reasonCode },
      closureRequestDeps(requestLogger)
    );
  } catch (error) {
    requestLogger.error({ outcome: 'unexpected', err: errorKindFacts(error), elapsedMs: Date.now() - started }, 'Account deletion request failed unexpectedly');
    await flush([refusedEntry(request, subjectId, correlationId, 'unexpected_failed', [])], requestLogger);
    return json(
      {
        success: false,
        error: 'request_failed',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
        correlationId,
      },
      500
    );
  }

  if (!outcome.ok) {
    const entries: AuditLogInput[] = [];
    if (outcome.engineAudit) entries.push(cancelledEntry(request, subjectId, accountId, correlationId, outcome.engineAudit, outcome.closureId));
    if (outcome.auditRefusal) entries.push(refusedEntry(request, subjectId, correlationId, outcome.reason, outcome.guards));
    if (entries.length > 0) await flush(entries, requestLogger);
    requestLogger.warn(
      { outcome: outcome.error, reason: outcome.reason, guards: outcome.guards, closureId: outcome.closureId ?? null, elapsedMs: Date.now() - started },
      'Account deletion request not recorded'
    );
    return json(
      {
        success: false,
        error: outcome.error,
        ...(outcome.blockers ? { blockers: outcome.blockers } : {}),
        ...(outcome.closureStatus !== undefined ? { data: { status: outcome.closureStatus } } : {}),
        ...(outcome.outcomeUnknown ? { outcomeUnknown: true } : {}),
        correlationId,
      },
      CLOSURE_REQUEST_REFUSAL_STATUS[outcome.error]
    );
  }

  // Success. W-14: `userId` unset (the system user) so these survive stage E; the owner is the actor.
  // SA CR-1: NO `request` on these. With it, the audit service stores the IP address, the user
  // agent and a session value, and a row that outlives erasure must hold uuids, codes and dates only.
  const shared = {
    entityType: 'user',
    entityId: subjectId,
    actorId: subjectId,
  } as const;
  const entries: AuditLogInput[] = [];
  if (outcome.status === 'pending') {
    if (outcome.engineAudit) entries.push(cancelledEntry(request, subjectId, accountId, correlationId, outcome.engineAudit, outcome.closureId));
    entries.push({
      ...shared,
      action: AUDIT_EVENTS.ACCOUNT_DELETION_REQUESTED,
      details: {
        closure_id: outcome.closureId,
        status: 'pending',
        renewal_was_on: outcome.renewalWasOn,
        plan_ends_on: outcome.planEndsOn,
        reason_code: input.reasonCode,
        statement_language: matched,
        source: 'self_service',
        stage: 'request',
        correlation_id: correlationId,
      },
    });
  } else {
    entries.push(
      {
        ...shared,
        action: AUDIT_EVENTS.ACCOUNT_DELETION_REQUESTED,
        details: {
          closure_id: outcome.closureId,
          status: 'grace',
          renewal_was_on: false,
          plan_ends_on: null,
          lock_at: outcome.lockAt,
          reason_code: input.reasonCode,
          statement_language: matched,
          source: 'self_service',
          stage: 'request',
          correlation_id: correlationId,
        },
      },
      {
        ...shared,
        action: AUDIT_EVENTS.ACCOUNT_GRACE_STARTED,
        details: {
          closure_id: outcome.closureId,
          grace_starts_at: outcome.graceStartsAt,
          lock_at: outcome.lockAt,
          lock_timezone: outcome.lockTimezone,
          correlation_id: correlationId,
        },
      }
    );
  }
  await flush(entries, requestLogger);
  requestLogger.info({ outcome: outcome.status, closureId: outcome.closureId, elapsedMs: Date.now() - started }, 'Account deletion requested');

  const data =
    outcome.status === 'pending'
      ? { status: 'pending' as const, planEndsOn: outcome.planEndsOn, renewalWasOn: outcome.renewalWasOn }
      : { status: 'grace' as const, lockAt: outcome.lockAt, lockTimezone: outcome.lockTimezone };
  return json({ success: true, data, correlationId }, 200);
}
