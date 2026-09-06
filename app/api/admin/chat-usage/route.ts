/**
 * Business OS chat usage — cost per question, cache hit rate, repair rate.
 *
 * ADMIN ONLY. This aggregates across every account, so it is gated by
 * `AdminAccessService` and never by `profiles.role`, which is user-writable.
 *
 * Deliberately not exposed to the business owner. They do not think in tokens,
 * and showing them a number they cannot act on invites anxiety about their bill
 * rather than confidence in the product. This is an operator view.
 *
 *   GET /api/admin/chat-usage?days=7[&userId=<uuid>]
 *
 * @module app/api/admin/chat-usage
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { getChatUsage } from '@/lib/business-os/bizql/telemetry/usageReport';

const logger = createLogger({ module: 'AdminChatUsageAPI' });

const QuerySchema = z.object({
  // Capped: this reads raw rows, and an unbounded window would scan the whole
  // table to answer a question nobody asked.
  days: z.coerce.number().int().min(1).max(90).default(7),
  userId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Same gate as every other admin route here — never `profiles.role`, which
    // is user-writable.
    const isAdmin = await AdminAccessService.getInstance().isAdmin({
      id: user.id,
      email: user.email,
    });

    if (!isAdmin) {
      requestLogger.warn({ userId: user.id }, 'Non-admin attempted to read chat usage');
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      days: url.searchParams.get('days') ?? undefined,
      userId: url.searchParams.get('userId') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid query' }, { status: 400 });
    }

    const from = new Date(Date.now() - parsed.data.days * 24 * 60 * 60 * 1000);
    const report = await getChatUsage({ from, userId: parsed.data.userId });

    requestLogger.info(
      { days: parsed.data.days, turns: report.turns, costPerTurn: report.costPerTurnUsd },
      'Chat usage reported'
    );

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to report chat usage');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
