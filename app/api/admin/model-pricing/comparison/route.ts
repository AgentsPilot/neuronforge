/**
 * GET /api/admin/model-pricing/comparison: what we charge today versus the
 * newest pending provider price, per model and unit, with the coverage colour
 * and the Business OS areas using each model (AI model price review slice 3;
 * UF-2, SA RR-3, RR-4).
 *
 * Read-only: no audit row (a read), no write anywhere. Computed per request
 * (the area resolver caches 60 s; the price read is not cached).
 *
 * Takes no query parameters: an unknown parameter is a 400, so nothing can
 * start to mean something by accident.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { buildComparison } from '@/lib/ai/pricing-research/comparisonModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'ModelPricingComparisonAPI' });
const ROUTE = '/api/admin/model-pricing/comparison';

const ComparisonQuerySchema = z.object({}).strict();

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement: nothing above it reads the query or the database.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  const parsed = ComparisonQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'This view takes no query parameters.', code: 'invalid_input' },
      { status: 400 }
    );
  }

  try {
    const data = await buildComparison();
    requestLogger.info({ adminUserId: adminId, rows: data.rows.length }, 'Price comparison built');
    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId }, 'Price comparison failed');
    return NextResponse.json(
      {
        success: false,
        error: 'The price comparison could not be loaded.',
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
