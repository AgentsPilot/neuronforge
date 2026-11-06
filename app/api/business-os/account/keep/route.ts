/**
 * KEEP MY ACCOUNT (account deletion lifecycle DL-1b / D6; requirement §3.4,
 * XC-2, XC-4; workplan docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §5;
 * BQ-33; SA W-8, W-14, Q-13).
 *
 *   POST /api/business-os/account/keep   {}
 *
 * Cancels the SESSION user's open deletion request at stage A, B or C. The
 * closure row moves to `kept` FIRST, then (only when renewal was on before the
 * request) the one plan engine is asked to renew (`closureKeep.ts`).
 *
 * NOT behind `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` (XC-4, D-11): an open
 * request must always be cancellable, whatever the switch says.
 *
 * `new-api-route` shape, with the DE-10b.2 deviations ruled for this module:
 * the session comes from `readSessionSubject()` (Supabase Auth `getUser()`,
 * never the `lib/auth` cache), every answer is `no-store`, and the audit is
 * awaited through the bounded `logAndFlush` (WC-7, never failing the request).
 * The body is `{}` `.strict()`: a `userId`, an `origin`, a `status` or any
 * other key is a 400 (W-8). The account and the closure are the session's.
 *
 * Answers:
 *   200 { kept: true, from, renewal }   renewal: restored | not_needed |
 *       not_restored_by_choice | failed (+ code, planEndsOn) | unknown
 *   401 / 400 / 429; 409 nothing_to_keep | request_in_progress | locked |
 *   state_changed (+ data.status); 503 try_again; 500 Internal server error
 *
 * Audit: ACCOUNT_DELETION_KEPT (`user_id` unset, so it survives stage E;
 * `actor_id` = the owner; `details.source: 'owner'`), and
 * BOS_BILLING_SUBSCRIPTION_REACTIVATED (`details.origin: 'deletion_keep'`)
 * when the engine reached the Stripe write. Refusals are logged, not audited
 * (the plan routes' rule). No email here: DL-3 sends "Your account is kept".
 *
 * @module app/api/business-os/account/keep
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import type { AuditLogInput } from '@/lib/audit/types';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { accountKeepBodySchema } from '@/lib/business-os/account-deletion/schemas';
import { readSessionSubject, selfDeleteThrottleKey } from '@/lib/business-os/account-deletion/sessionSubject';
import { errorKindFacts } from '@/lib/business-os/account-deletion/selfServiceDeletion';
import { CLOSURE_KEEP_REFUSAL_STATUS, runClosureKeep } from '@/lib/business-os/account-deletion/closureKeep';
import { closureKeepDeps } from '@/lib/business-os/account-deletion/closureKeepDeps';

const logger = createLogger({ module: 'AccountKeepAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE = 'no-store, no-cache, must-revalidate';
const MAX_BODY_BYTES = 1024;

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const baseLogger = logger.child({ correlationId });

  let subject: Awaited<ReturnType<typeof readSessionSubject>>;
  try {
    subject = await readSessionSubject();
  } catch (error) {
    baseLogger.error({ err: errorKindFacts(error) }, 'Keep: the session could not be verified');
    subject = null;
  }
  if (!subject) return json({ success: false, error: 'Unauthorized', correlationId }, 401);
  const subjectId = subject.id;
  const requestLogger = baseLogger.child({ subjectId });

  try {
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ success: false, error: 'invalid_body', correlationId }, 400);
    let body: unknown;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return json({ success: false, error: 'invalid_body', correlationId }, 400);
      body = text.trim() === '' ? {} : JSON.parse(text);
    } catch {
      return json({ success: false, error: 'invalid_body', correlationId }, 400);
    }
    const parsed = accountKeepBodySchema.safeParse(body);
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

    const throttle = await rateLimit(request, selfDeleteThrottleKey('account-keep', subjectId), RATE_LIMITS.write);
    if (!throttle.allowed) {
      const response = tooManyRequests(RATE_LIMITS.write.windowSeconds);
      response.headers.set('Cache-Control', NO_STORE);
      return response;
    }

    // The session's account, through the seam (W-8: never a request value).
    const accountId = resolveAccountId(subjectId);
    const outcome = await runClosureKeep({ subject: subjectId, accountId }, closureKeepDeps(requestLogger));

    if (!outcome.ok) {
      requestLogger.warn({ outcome: outcome.error, closureStatus: outcome.closureStatus ?? null }, 'Keep refused');
      return json(
        {
          success: false,
          error: outcome.error,
          ...(outcome.closureStatus !== undefined ? { data: { status: outcome.closureStatus } } : {}),
          correlationId,
        },
        CLOSURE_KEEP_REFUSAL_STATUS[outcome.error]
      );
    }

    const entries: AuditLogInput[] = [
      {
        action: AUDIT_EVENTS.ACCOUNT_DELETION_KEPT,
        entityType: 'user',
        entityId: subjectId,
        // W-14: `user_id` unset (the system user): the row survives a later stage E.
        actorId: subjectId,
        details: {
          closure_id: outcome.closureId,
          source: 'owner',
          from: outcome.from,
          renewal: outcome.renewal,
          ...(outcome.code ? { code: outcome.code } : {}),
          correlation_id: correlationId,
        },
        // SA CR-1: no `request`. This row outlives erasure, so no IP address, user agent or session value.
      },
    ];
    if (outcome.engineAudit) {
      const facts = outcome.engineAudit;
      entries.push({
        action: AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_REACTIVATED,
        entityType: 'business_os_billing_account',
        entityId: accountId,
        userId: subjectId,
        actorId: subjectId,
        details: {
          subscriptionId: facts.subscriptionId,
          outcome: facts.outcome,
          renewsOn: facts.renewsOn,
          livemode: facts.livemode,
          actor: 'owner',
          origin: facts.origin ?? 'deletion_keep',
          closure_id: outcome.closureId,
          correlationId,
        },
        request,
      });
    }
    await logAndFlush(entries, requestLogger, { reason: 'account kept', continues: 'the account is kept regardless' });

    return json(
      {
        success: true,
        data: {
          kept: true,
          from: outcome.from,
          renewal: outcome.renewal,
          ...(outcome.renewal === 'failed' ? { code: outcome.code, planEndsOn: outcome.planEndsOn ?? null } : {}),
        },
        correlationId,
      },
      200
    );
  } catch (error) {
    requestLogger.error({ err: errorKindFacts(error) }, 'Keep failed unexpectedly');
    return json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
        correlationId,
      },
      500
    );
  }
}
