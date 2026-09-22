/**
 * Business OS entitlements — the shadow report (S1-T12b).
 *
 * ADMIN ONLY. `requireAdmin` is the first statement; the CI guard reads this
 * handler's own body.
 *
 *   GET /api/admin/business-os/entitlements/shadow-report
 *       ?from=YYYY-MM-DD&to=YYYY-MM-DD      observed usage + the replay window
 *       &asTier=<tier>                       "what would this tier cost?"
 *       &asTierReadRule=domain_group|read_only_plans_need_search
 *       &includeSetupAi=true                 the slow section (B-12 sizing)
 *
 * Read-only: it writes nothing and therefore records no audit entry — the
 * accountability for a read is this route's structured log. The builder lives
 * in `lib/business-os/entitlements/report.ts` and was shipped with component 4;
 * this is the gate in front of it.
 *
 * **What it may not contain (RC-16):** account ids and aggregates only. No
 * business names, no emails, no override reason text. That is a property of the
 * builder, asserted by its own tests — the route adds no fields of its own.
 *
 * @module app/api/admin/business-os/entitlements/shadow-report
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { buildShadowReport } from '@/lib/business-os/entitlements/report';
import { getEntitlementMode } from '@/lib/business-os/entitlements/mode';

const logger = createLogger({ module: 'AdminBosEntitlementsReportAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const querySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    asTier: z.string().min(1).optional(),
    asTierReadRule: z.enum(['domain_group', 'read_only_plans_need_search']).optional(),
    includeSetupAi: z.enum(['true', 'false']).optional(),
  })
  .strict()
  // A window is both dates or neither: one alone is a typo, and silently
  // widening it to "everything" is how a report gets read as a month's data.
  .refine((value) => (value.from === undefined) === (value.to === undefined), {
    message: 'from and to must be supplied together',
  })
  .refine((value) => !value.asTier || value.from !== undefined, {
    message: 'asTier needs a window to replay',
  });

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'bos-entitlements-shadow-report' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      asTier: url.searchParams.get('asTier') ?? undefined,
      asTierReadRule: url.searchParams.get('asTierReadRule') ?? undefined,
      includeSetupAi: url.searchParams.get('includeSetupAi') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'invalid_query', details: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const report = await buildShadowReport({
      from: parsed.data.from,
      to: parsed.data.to,
      asTier: parsed.data.asTier,
      asTierReadRule: parsed.data.asTierReadRule,
      includeSetupAi: parsed.data.includeSetupAi === 'true',
    });

    requestLogger.info(
      {
        mode: getEntitlementMode(),
        accountsScanned: report.static.accountsScanned,
        asTier: parsed.data.asTier ?? null,
        window: parsed.data.from ? `${parsed.data.from}..${parsed.data.to}` : null,
      },
      'Admin read the entitlement shadow report'
    );

    return NextResponse.json({ success: true, data: { mode: getEntitlementMode(), ...report } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to build the shadow report');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
