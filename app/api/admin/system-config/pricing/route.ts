/**
 * GET /api/admin/system-config/pricing — the `ai_model_pricing` rows behind the
 * Model pricing page (`app/admin/system-config/page.tsx`), which uses them for
 * the row ids, the dates and the retired rows (AI model price review slice 4).
 *
 * READ-ONLY since AI model price review slice 6 (MP-FR-11, user decision Q9):
 * the single-row PUT (edit), POST (create) and DELETE (hard delete) were
 * removed, together with the Sync route. Next.js answers 405 to a method this
 * file does not export. No app path writes a live price; slice 8's apply RPC
 * will be the one writer (pinned by
 * `lib/ai/pricing-research/__tests__/livePriceWrites.guard.test.ts`).
 *
 * ADMIN ONLY, gated here in the route (middleware does not protect `/api`)
 * through `requireAdmin` → AdminAccessService (the `admin_users` table), never
 * the user-writable profile role field.
 *
 * Data access goes through `aiModelPricingRepository` (the repository pattern —
 * CLAUDE.md mandatory rule 1). The route holds no Supabase client: the service
 * role, and why `ai_model_pricing` has no `user_id` to scope by, are documented
 * in the repository's header. Authorisation for this platform-wide table is this
 * route's `requireAdmin` gate. GET takes no input, so there is no schema.
 *
 * @module app/api/admin/system-config/pricing
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { aiModelPricingRepository } from '@/lib/repositories/AiModelPricingRepository';

const logger = createLogger({ module: 'AdminPricingAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Internal error text is for the server log and for development only. */
function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const { data: pricing, error } = await aiModelPricingRepository.listAll();

    if (error) throw error;

    requestLogger.info(
      { userId: gate.user.id, count: pricing?.length ?? 0 },
      'Fetched AI model pricing'
    );

    return NextResponse.json({ success: true, data: pricing || [] });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error fetching pricing');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pricing information', details: devDetails(error) },
      { status: 500 }
    );
  }
}
