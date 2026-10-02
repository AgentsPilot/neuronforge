/**
 * The owner's credit history — the read behind the "Credit history" panel.
 *
 *   GET /api/business-os/credits/history[?cursor=…]
 *
 * Credit deduction slice 7a (workplan §4.7; SA SQ-29, SQ-37, SQ-38). One page
 * of every charged action in the CARD'S OWN window (the current period, the
 * whole trial, or the calendar month with no plan row), newest first, 50 a
 * page. The first page also carries the summary (the card's own total and its
 * "by you" / "automatic" split). The payload shape is `OwnerCreditHistoryPage`
 * (`lib/business-os/credits/creditHistoryTypes.ts`): no tokens, no dollars, no
 * cost, no account id and no raw identifiers (FR-28).
 *
 * ── INPUT: ONE OPAQUE CURSOR, NOTHING ELSE ───────────────────────────────────
 * The only input read is `cursor`, Zod-validated and then decoded strictly
 * (`creditHistoryCursor.ts`); anything malformed or hostile is a 400 before
 * any read. Every other query parameter — `accountId` included — is never
 * read. The account is `user.id` from the verified session, resolved through
 * the account seam inside the window function.
 *
 * ── CLIENTS ──────────────────────────────────────────────────────────────────
 * The ledger is read with the caller's RLS client
 * (`createAuthenticatedServerClient`). This file imports no service-role
 * client and nothing from the entitlements module; the service-role reads (the
 * plan anchor and the pure period function) live in `ownerCreditUsageDeps.ts`.
 *
 * ── NEVER CACHED ─────────────────────────────────────────────────────────────
 * `force-dynamic`, and `Cache-Control: private, no-store` on every answer.
 *
 * Read-only: no write, no audit entry (a read of one's own figures).
 *
 * ── PARKED: OFF UNLESS THE FLAG IS ON (user decision 2026-10-02) ────────────
 * While `NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY` is off (the default) the route
 * answers 404 `Not found` to EVERY caller, before the session is read and
 * before anything else: it behaves as if it did not exist. That order leaks
 * nothing — not even that the route is there (a 401 to an anonymous caller
 * would) — and reads nothing. The server read is its own
 * (`isCreditHistoryRouteEnabled`), never the client rendering hint.
 *
 * @module app/api/business-os/credits/history
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { decodeHistoryCursor, MAX_HISTORY_CURSOR_LENGTH } from '@/lib/business-os/credits/creditHistoryCursor';
import { isCreditHistoryRouteEnabled } from '@/lib/business-os/credits/creditHistoryFlag';
import { readOwnerCreditHistory } from '@/lib/business-os/credits/ownerCreditHistory';
import { ownerCreditHistoryDeps } from '@/lib/business-os/credits/ownerCreditUsageDeps';
import { createLogger } from '@/lib/logger';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BusinessOsCreditHistoryAPI' });

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const QuerySchema = z.object({
  cursor: z.string().min(1).max(MAX_HISTORY_CURSOR_LENGTH).optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Parked: while the flag is off the route does not exist for anyone.
  if (!isCreditHistoryRouteEnabled()) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: NO_STORE });
  }

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    // ONLY `cursor` is read; every other parameter is ignored by construction.
    const rawCursor = request.nextUrl.searchParams.get('cursor');
    const parsed = QuerySchema.safeParse({ cursor: rawCursor ?? undefined });
    const cursor = parsed.success && parsed.data.cursor !== undefined ? decodeHistoryCursor(parsed.data.cursor) : null;
    if (!parsed.success || (parsed.data.cursor !== undefined && cursor === null)) {
      requestLogger.warn({ userId: user.id }, 'Credit history request refused: malformed cursor');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: process.env.NODE_ENV === 'development' ? 'The page position is not valid' : undefined,
        },
        { status: 400, headers: NO_STORE }
      );
    }

    // The caller's own RLS client: the ledger's owner policies apply to every read.
    const ownerClient = await createAuthenticatedServerClient();
    const result = await readOwnerCreditHistory(user.id, cursor, ownerCreditHistoryDeps(ownerClient), requestLogger);

    if (result.error || !result.data) {
      return NextResponse.json(
        {
          success: false,
          error: 'Could not load your credit history',
          details: process.env.NODE_ENV === 'development' ? result.error?.message : undefined,
        },
        { status: 500, headers: NO_STORE }
      );
    }

    const page = result.data;
    requestLogger.info(
      'restart' in page
        ? { userId: user.id, restart: true }
        : { userId: user.id, firstPage: cursor === null, lines: page.lines.length, hasMore: page.nextCursor !== null },
      'Owner credit history read'
    );

    return NextResponse.json({ success: true, data: page }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read the owner credit history');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not load your credit history',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500, headers: NO_STORE }
    );
  }
}
