/**
 * GET /api/admin/jobs-queues/webhook-events — the "Stripe webhook events"
 * block on the Scheduled jobs & queues page (plan payments P-8b.3b, AM-4;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md "Plan:
 * P-8b.3" D3-3, SA rulings P3-SA-3, P3-SA-5 and P3-SA-6).
 *
 * Order: requireAdmin FIRST (401/403) → strict empty query (400, after the
 * gate) → the server key's Stripe mode (409 with the `WEBHOOK_EVENTS_MODE_UNKNOWN`
 * words when it cannot be read: no figure for a guessed mode) → three reads
 * through the read-only repository (500 with fixed words on any failure) →
 * the pure builder → 200. Every response is `no-store`.
 *
 * Read-only and across all webhook events, through the service-role read
 * repository, which is intentional: the claim table has no owner, and the
 * only way here is `requireAdmin`. No caller-supplied id, no Stripe call and
 * no audit (a read, as `GET /api/admin/jobs-queues`).
 *
 * ── What never leaves this route (P3-SA-6) ───────────────────────────────
 * A row's `failure_message` may hold customer text. It is read only so the
 * builder can classify it; it is not in the response, in any log line or in
 * an error's details. A 500's development details carry the read error's
 * NAME only. The log line carries the mode, counts and timings only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { currentStripeMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import { WEBHOOK_EVENTS_MODE_UNKNOWN } from '@/lib/admin/jobs/webhookEventsTypes';
import { buildWebhookEventsView } from '@/lib/admin/jobs/webhookEventsView';
import {
  ADMIN_WEBHOOK_READ_PER_STATE,
  ADMIN_WEBHOOK_STALE_AFTER_MS,
  adminWebhookEventReadRepository,
} from '@/lib/repositories/AdminWebhookEventReadRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminWebhookEventsAPI' });
const ROUTE = '/api/admin/jobs-queues/webhook-events';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** No input. Strict, so no parameter can ever start to mean something silently. */
const WebhookEventsQuerySchema = z.object({}).strict();

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function errorResponse(status: number, error: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { success: false, error, details: process.env.NODE_ENV === 'development' ? details : undefined },
    { status, headers: NO_STORE }
  );
}

/** The error's name only (P3-SA-6): never its message, which a driver may fill with row content. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function serverMode(): StripeMode | null {
  try {
    return currentStripeMode();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  // FIRST statement. Nothing above it reads the query or the database; the
  // gate owns the 401/403 split and fails closed.
  const gate = await requireAdmin(logger.child({ route: ROUTE, method: 'GET' }));
  if (gate instanceof NextResponse) return noStore(gate);

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE, adminUserId: gate.user.id });
  const startedAt = Date.now();

  try {
    // After the gate: 401/403 always win over 400.
    const parsed = WebhookEventsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      requestLogger.warn({}, 'Rejected a webhook events request with query parameters');
      return errorResponse(400, 'This endpoint takes no parameters', parsed.error.issues[0]?.message);
    }

    const mode = serverMode();
    if (mode === null) {
      requestLogger.warn({ reason: 'stripe_mode_unknown' }, 'Webhook events refused: Stripe key mode unknown');
      return errorResponse(409, WEBHOOK_EVENTS_MODE_UNKNOWN, { code: 'stripe_mode_unknown' });
    }

    // The clock is read ONCE: the stale cutoff and every age use it.
    const now = new Date();
    const livemode = mode === 'live';
    const [counts, lists, noMode] = await Promise.all([
      adminWebhookEventReadRepository.countUnfinishedAllEvents({ livemode, now }),
      adminWebhookEventReadRepository.listUnfinishedAllEvents({ livemode, now }),
      adminWebhookEventReadRepository.countUnfinishedNoModeAllEvents({ now }),
    ]);
    const failedRead = [
      { read: 'counts', error: counts.error, missing: !counts.data },
      { read: 'list', error: lists.error, missing: !lists.data },
      { read: 'no_mode', error: noMode.error, missing: !noMode.data },
    ].find((entry) => entry.error || entry.missing);
    if (failedRead || !counts.data || !lists.data || !noMode.data) {
      const name = errorName(failedRead?.error ?? null);
      requestLogger.error({ err: failedRead?.error ?? undefined, read: failedRead?.read }, 'Webhook events read failed');
      return errorResponse(500, 'Could not read the webhook events. Try again.', { errName: name });
    }

    const payload = buildWebhookEventsView({
      mode,
      now,
      counts: counts.data,
      lists: lists.data,
      noMode: noMode.data,
      readPerState: ADMIN_WEBHOOK_READ_PER_STATE,
      staleAfterMs: ADMIN_WEBHOOK_STALE_AFTER_MS,
    });

    // The mode, counts and timings only: no event id, type or message.
    requestLogger.info(
      {
        mode,
        failed: payload.tiles.failed,
        stuck: payload.tiles.stuck,
        listed: payload.listed,
        matching: payload.matching,
        oldestAtLeast: payload.tiles.oldestAtLeast,
        noMode: payload.noMode,
        durationMs: Date.now() - startedAt,
      },
      'Webhook events served'
    );

    return NextResponse.json({ success: true, data: payload }, { headers: NO_STORE });
  } catch (error) {
    const name = errorName(error);
    requestLogger.error({ err: error }, 'Webhook events route failed');
    return errorResponse(500, 'Could not read the webhook events. Try again.', { errName: name });
  }
}
