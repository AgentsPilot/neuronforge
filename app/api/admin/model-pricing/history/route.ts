/**
 * GET /api/admin/model-pricing/history?kind=token|image&provider=…&model=…
 * (AI model price review slice 9; MP-FR-17, UF-4, SA RR-6): every stored price
 * of one model, current and retired, newest first, with who changed it and why,
 * read from the database (`lib/ai/pricing-research/priceHistory.ts`).
 *
 * Read-only: no audit row (a read, as the comparison route), no write anywhere,
 * nothing about a charge changes.
 *
 * Order: `requireAdmin` (401/403) is the first statement; then a repeated key
 * (400) and the strict Zod query (400: unknown key, provider outside the list,
 * model failing the id rule); then the reads. A model with no stored row is a
 * 200 with no units (an in-code-only or unpriced model has a real, empty
 * history), never a 404. Any read failing, the admin name lookup included
 * (SA SC9-2), is a 500 with generic words.
 *
 * The repositories are wired here and injected into the builder, so the
 * admin-only methods are called from `app/api/admin/**` only
 * (`adminReadMethods.guard.test.ts`).
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { isInputOnlyPricedModel } from '@/lib/ai/pricing';
import { loadPriceHistory, systemActorIdsFromEnv, type PriceHistoryDeps } from '@/lib/ai/pricing-research/priceHistory';
import { PriceHistoryQuerySchema } from '@/lib/ai/pricing-research/priceHistorySchema';
import { createLogger } from '@/lib/logger';
import { adminUserRepository } from '@/lib/repositories/AdminUserRepository';
import { aiModelImagePricingRepository } from '@/lib/repositories/AiModelImagePricingRepository';
import { aiModelPricingRepository } from '@/lib/repositories/AiModelPricingRepository';
import { aiPriceApplyRepository } from '@/lib/repositories/AiPriceApplyRepository';
import { aiPriceProposalRepository } from '@/lib/repositories/AiPriceProposalRepository';
import { auditTrailRepository, type AdminAuditReadContext } from '@/lib/repositories/AuditTrailRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'ModelPricingHistoryAPI' });
const ROUTE = '/api/admin/model-pricing/history';

/** The reads, wired to the repositories (the admin-only ones need the admin read context). */
function historyDeps(context: AdminAuditReadContext): PriceHistoryDeps {
  return {
    listTokenHistory: (key) => aiModelPricingRepository.listHistoryExact(key),
    listImageHistory: (key) => aiModelImagePricingRepository.listHistoryExact(key),
    findLines: (ids) => aiPriceProposalRepository.findAppliedLinesByIds(ids),
    findBatches: (ids) => aiPriceApplyRepository.findBatchesByIds(ids),
    listRowEvents: (rowIds) => auditTrailRepository.listAdminPricingRowEvents(context, rowIds),
    listSyncRuns: () => auditTrailRepository.listAdminPricingSyncRuns(context),
    findAdminEmails: (userIds) => adminUserRepository.findEmailsByUserIds(userIds),
    isInputOnly: isInputOnlyPricedModel,
    systemActorIds: systemActorIdsFromEnv(),
  };
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement: nothing above it reads the query or the database.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  const params = request.nextUrl.searchParams;
  const keys = [...params.keys()];
  const repeated = keys.length !== new Set(keys).size;
  const parsed = repeated ? null : PriceHistoryQuerySchema.safeParse(Object.fromEntries(params.entries()));
  if (!parsed || !parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Ask for one model: kind (token or image), provider and model.',
        code: 'invalid_input',
        details: process.env.NODE_ENV === 'development' && parsed && !parsed.success ? parsed.error.flatten() : undefined,
      },
      { status: 400 }
    );
  }
  const query = parsed.data;

  try {
    const data = await loadPriceHistory(query, historyDeps({ correlationId, adminId }));
    const rowCount = data.units.reduce((total, unit) => total + unit.rows.length, 0);
    requestLogger.info(
      { adminUserId: adminId, kind: query.kind, provider: query.provider, rows: rowCount, truncated: data.truncated },
      'Price history built'
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId, kind: query.kind, provider: query.provider }, 'Price history failed');
    return NextResponse.json(
      {
        success: false,
        error: 'The price history could not be loaded.',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
