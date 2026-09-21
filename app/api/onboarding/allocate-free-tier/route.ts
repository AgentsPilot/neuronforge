import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { freeTierGrantService } from '@/lib/services/FreeTierGrantService';

const logger = createLogger({ module: 'AllocateFreeTierAPI' });
const auditTrail = AuditTrailService.getInstance();

/**
 * The body is optional. `userId` is accepted ONLY so that client bundles cached
 * from before the S-6 fix (which still send `{ userId: <own id> }`) keep working
 * during the rollout. It is never used as the grant target: the target is always
 * the session user, and a mismatch is refused (workplan §2.2, SA Q5).
 * `.strict()` rejects any other key (injected `balance`, `account_frozen`, ...).
 */
const bodySchema = z
  .object({
    userId: z.string().uuid().optional(),
  })
  .strict();

const isDevelopment = () => process.env.NODE_ENV === 'development';

/** RC-6: `details` exists only in development, and is only ever a message string. */
function errorBody(error: string, detail?: string): { success: false; error: string; details?: string } {
  return isDevelopment() && detail ? { success: false, error, details: detail } : { success: false, error };
}

/**
 * POST /api/onboarding/allocate-free-tier
 *
 * Grants the free tier (tokens, storage, executions) to the SIGNED-IN user, once.
 * Repeat calls are no-ops that return `alreadyGranted: true`. A frozen account is
 * never granted and never unfrozen here. See
 * docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md.
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  // Hoisted so a 500 after authentication still carries the user in its log line (SA F-3).
  let sessionUserId: string | undefined;

  try {
    // 1. Authenticate. The session user is the only account this route can touch.
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    sessionUserId = user.id;
    const userLogger = requestLogger.child({ userId: user.id });

    // 2. Validate input. `request.json()` throws on an empty body, which is the normal case now.
    const rawBody = await request.text();
    let json: unknown = {};
    if (rawBody.trim().length > 0) {
      try {
        json = JSON.parse(rawBody);
      } catch {
        return NextResponse.json(errorBody('Invalid input', 'Body is not valid JSON'), { status: 400 });
      }
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        errorBody('Invalid input', parsed.error.issues.map((i) => i.message).join('; ')),
        { status: 400 }
      );
    }

    // 3. A body userId must be the caller's own (compared lower-cased, SA RC-5).
    const bodyUserId = parsed.data.userId;
    if (bodyUserId !== undefined && bodyUserId.toLowerCase() !== user.id.toLowerCase()) {
      // Both ids, never the raw body (SA.7).
      userLogger.warn(
        { sessionUserId: user.id, attemptedUserId: bodyUserId },
        'free-tier grant: body userId mismatch'
      );
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    userLogger.info('Free-tier grant requested');

    // 4. Grant (once, race-safe).
    const result = await freeTierGrantService.grant(user.id, userLogger);

    switch (result.status) {
      case 'GRANTED': {
        // 5. Audit, only on an actual grant, never awaited.
        auditTrail
          .log({
            action: AUDIT_EVENTS.FREE_TIER_ALLOCATED,
            entityType: 'subscription',
            entityId: user.id,
            userId: user.id,
            resourceName: 'Free Tier Quotas',
            details: {
              pilot_tokens: result.allocation.pilot_tokens,
              raw_tokens: result.allocation.raw_tokens,
              storage_mb: result.allocation.storage_mb,
              executions: result.allocation.executions === null ? 'unlimited' : result.allocation.executions,
              path: result.path,
            },
            request,
          })
          .catch((err) => userLogger.error({ err }, 'Audit failed (non-blocking)'));

        return NextResponse.json({
          success: true,
          alreadyGranted: false,
          allocation: result.allocation,
          message: 'Free tier quotas allocated successfully',
        });
      }

      case 'ALREADY_GRANTED':
        return NextResponse.json({
          success: true,
          alreadyGranted: true,
          allocation: null,
          message: 'Free tier already granted',
        });

      case 'INELIGIBLE_FROZEN':
        return NextResponse.json(
          { success: false, error: 'Free tier not available for this account' },
          { status: 409 }
        );

      case 'RETRY_EXHAUSTED':
        // Already logged at error level by the service (RC-3).
        return NextResponse.json({ success: false, error: 'Please try again' }, { status: 503 });
    }
  } catch (error) {
    requestLogger.error({ err: error, userId: sessionUserId }, 'Free-tier grant failed');
    return NextResponse.json(
      errorBody('Failed to allocate free tier', error instanceof Error ? error.message : String(error)),
      { status: 500 }
    );
  }
}
