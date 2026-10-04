/**
 * The owner's own credits — the read behind the dashboard's "Credits" card.
 *
 *   GET /api/business-os/usage
 *
 * Credit deduction slice 6a (workplan §4.5, SA SQ-28): replaced in place. It
 * answers from the credit ledger — credits used and left of the owner's own
 * plan allowance, for their own billing period, split "by you" / "automatic".
 * The payload shape is `OwnerCreditUsage`
 * (`lib/business-os/credits/ownerCreditUsageTypes.ts`); it carries no tokens,
 * no dollars, no cost and no account id (FR-28).
 *
 * Since credit deduction slice 11d it also carries `extraCredits`: credits
 * added on top of the plan, a SEPARATE figure that never enters `remaining`
 * or the percentage (boost R-5 (c)). The lots behind it are read with the
 * same RLS client; nothing about where they came from is in the payload.
 *
 * ── THE TENANT ISOLATION PROPERTY, AND WHY IT IS STRUCTURAL ────────────────
 * **This handler accepts no input at all.** No path parameter, no query string,
 * no body. The account is `user.id` from the verified session, resolved through
 * the account seam, and there is no code path by which a caller can name a
 * different one. That is also why there is no Zod schema: Zod validates input,
 * and the absence of input is the property being protected (the `my-plan`
 * precedent). The route test asserts the handler reads no `searchParams`, no
 * body and no params, and that `?accountId=` and `?range=` are ignored.
 *
 * ── CLIENTS ──────────────────────────────────────────────────────────────────
 * The ledger is read with the caller's RLS client
 * (`createAuthenticatedServerClient`). This file imports no service-role client
 * and nothing from the entitlements module; the service-role reads (the plan
 * anchor and the pure period function) live in `ownerCreditUsageDeps.ts`.
 *
 * ── NEVER CACHED ─────────────────────────────────────────────────────────────
 * `force-dynamic`, and `Cache-Control: private, no-store` on every answer: the
 * card re-reads after each owner action and must see the new figure.
 *
 * Read-only: no write, no audit entry (a read of one's own figures).
 *
 * @module app/api/business-os/usage
 */

import { NextRequest, NextResponse } from 'next/server';

import { getUser } from '@/lib/auth';
import { readOwnerCreditUsage } from '@/lib/business-os/credits/ownerCreditUsage';
import { ownerCreditUsageDeps } from '@/lib/business-os/credits/ownerCreditUsageDeps';
import { createLogger } from '@/lib/logger';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BusinessOsUsageAPI' });

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    // The caller's own RLS client: the ledger's owner policies apply to every read.
    const ownerClient = await createAuthenticatedServerClient();
    const result = await readOwnerCreditUsage(user.id, ownerCreditUsageDeps(ownerClient), requestLogger);

    if (result.error || !result.data) {
      return NextResponse.json(
        {
          success: false,
          error: 'Could not load your credits',
          details: process.env.NODE_ENV === 'development' ? result.error?.message : undefined,
        },
        { status: 500, headers: NO_STORE }
      );
    }

    requestLogger.info(
      {
        userId: user.id,
        periodKind: result.data.period.kind,
        gauged: result.data.allowance !== null,
        used: result.data.used,
        // Whether the account has extra credits, never the figure (slice 11d, SA W11d-8).
        hasExtra: result.data.extraCredits > 0,
      },
      'Owner credits read'
    );

    return NextResponse.json({ success: true, data: result.data }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read the owner credits');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not load your credits',
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
