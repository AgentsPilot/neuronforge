/**
 * THE OPEN DELETION REQUEST, READ ONLY (account deletion lifecycle DL-2a;
 * workplan docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §5.1, D-2;
 * SA W-4).
 *
 *   GET /api/business-os/account/closure
 *     → 200 { closure: null }                    no request is open
 *     → 200 { closure: ClosureStatusView }       requesting | pending | grace | locked
 *
 * NOT behind `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED`: the Keep route is not
 * (XC-4, DL-1b D-11), so an owner with an open request must be able to reach
 * Keep my account even after the switch is turned off.
 *
 * NO REQUEST INPUT IS READ (SA W-4 c; CLAUDE.md rule 2). The route takes no
 * body, no query value and no header but the session cookie and the
 * correlation id, so there is nothing to validate with Zod: a `?userId=` or
 * `?status=` is ignored, and the only id used is the session user's, from
 * `readSessionSubject()` (Supabase Auth `getUser()`, never the `lib/auth`
 * cache). The ANSWER is the shape of `closureStatusResponseSchema`, which the
 * Danger Zone parses and the route tests check.
 *
 * Every answer is `no-store` (200, 401, 429, 503, 500). `details` only in
 * development. Not audited: it reads and changes nothing (the pre-check's
 * rule). Never in an answer or a log line: the reason code, the statement
 * language, an email, a database message. Logs carry the subject id, the
 * status and codes.
 *
 * `new-api-route` shape with this module's ruled deviations (the session from
 * `readSessionSubject`, `no-store` on every answer).
 *
 * @module app/api/business-os/account/closure
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { readSessionSubject, selfDeleteThrottleKey } from '@/lib/business-os/account-deletion/sessionSubject';
import { errorKindFacts } from '@/lib/business-os/account-deletion/selfServiceDeletion';
import { closureStatusView, needsTimezone, type TimezoneRead } from '@/lib/business-os/account-deletion/closureStatusView';
import { closureStatusDeps } from '@/lib/business-os/account-deletion/closureStatusDeps';
import type { ClosureStatusData } from '@/lib/business-os/account-deletion/schemas';

const logger = createLogger({ module: 'AccountClosureStatusAPI' });

// Node: Pino and the service-role repository. Never cached: the answer is per session and changes.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const NO_STORE = 'no-store, no-cache, must-revalidate';

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE } });
}

// `request` is used for the correlation id and the throttle's hashed IP only (W-4 c).
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const baseLogger = logger.child({ correlationId });

  let subject: Awaited<ReturnType<typeof readSessionSubject>>;
  try {
    subject = await readSessionSubject();
  } catch (error) {
    baseLogger.error({ err: errorKindFacts(error) }, 'Closure status: the session could not be verified');
    subject = null;
  }
  if (!subject) return json({ success: false, error: 'Unauthorized', correlationId }, 401);
  const subjectId = subject.id;
  const requestLogger = baseLogger.child({ subjectId });

  try {
    const throttle = await rateLimit(request, selfDeleteThrottleKey('account-closure', subjectId), RATE_LIMITS.read);
    if (!throttle.allowed) {
      const response = tooManyRequests(RATE_LIMITS.read.windowSeconds);
      response.headers.set('Cache-Control', NO_STORE);
      return response;
    }

    const deps = closureStatusDeps();
    const open = await deps.readOpen(subjectId);
    if (open.error) {
      requestLogger.warn({ outcome: 'try_again' }, 'Closure status: the open request could not be read');
      return json({ success: false, error: 'try_again', correlationId }, 503);
    }

    let data: ClosureStatusData;
    if (!open.data) {
      data = { closure: null };
    } else {
      const zone: TimezoneRead = needsTimezone(open.data.status) ? await deps.readTimezone(subjectId) : { ok: true, stored: null };
      if (!zone.ok) requestLogger.warn({ closureStatus: open.data.status, outcome: 'timezone_unreadable' }, 'Closure status: the timezone could not be read; no dates sent');
      data = { closure: closureStatusView(open.data, zone) };
    }

    requestLogger.info({ closureStatus: data.closure?.status ?? null }, 'Closure status read');
    return json({ success: true, data, correlationId }, 200);
  } catch (error) {
    requestLogger.error({ err: errorKindFacts(error) }, 'Closure status failed unexpectedly');
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
