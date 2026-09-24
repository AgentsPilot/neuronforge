/**
 * Business OS entitlements — the launch operation (R2-1).
 *
 * ADMIN ONLY. `requireAdmin` is the first statement; the CI guard reads this
 * handler's own body.
 *
 *   POST /api/admin/business-os/entitlements/launch
 *   { "confirm": "launch_champion_existing", "reason": "...", "dryRun": true }
 *
 * ── WHAT THIS DOES, AND WHAT SLICE 1 SHIPS ──────────────────────────────────
 * At enforcement switch-on, every account without an in-force tier becomes an
 * open-ended champion (U-2, UD-3, UD-4) — that is what stops existing customers
 * waking up to a trial that has already expired.
 *
 * **Slice 1 ships the DRY RUN only.** A real run is refused with 409
 * `launch_preconditions_unmet` while no tier is configured, which is the same
 * condition UD-2 uses to refuse `enforce`: making every account a champion
 * before there is anything to buy would be a one-way change made early.
 *
 * The dry run is the useful half now — it answers "how many accounts would this
 * touch, and which?" from real data, before anyone commits to the switch-on.
 *
 * @module app/api/admin/business-os/entitlements/launch
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';

const logger = createLogger({ module: 'AdminBosEntitlementsLaunchAPI' });
const auditTrail = AuditTrailService.getInstance();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    confirm: z.literal('launch_champion_existing'),
    reason: z.string().trim().min(3),
    dryRun: z.boolean().optional(),
  })
  .strict();

/** One page of the walk. Keyset, like the report (RC-12). */
const PAGE_SIZE = 500;

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'bos-entitlements-launch' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 });
    }

    const config = getEntitlementConfig();
    const dryRun = parsed.data.dryRun !== false;

    // The precondition, and the reason the real run is not in Slice 1: with no
    // tier configured there is nothing for a champion to be an alternative to.
    if (!dryRun && config.tierOrder.length === 0) {
      requestLogger.warn({}, 'Launch refused: no tier is configured');
      return NextResponse.json(
        {
          success: false,
          error: 'launch_preconditions_unmet',
          details: { reason: 'no_tiers_configured' },
        },
        { status: 409 }
      );
    }

    if (!dryRun) {
      // Slice 2 owns the execution (§5): an idempotency marker, one audit entry
      // per account and a summary. Refusing here is better than half of it.
      return NextResponse.json(
        { success: false, error: 'not_implemented_until_slice_2', details: { dryRunAvailable: true } },
        { status: 501 }
      );
    }

    const now = new Date();
    let scanned = 0;
    let wouldBecomeChampion = 0;
    let alreadyChampion = 0;
    let hasTierInForce = 0;
    let truncated = false;
    let after: string | null = null;
    const sample: string[] = [];

    for (;;) {
      const page = await businessOsAccountPlanRepository.pagePlans({ afterUserId: after, limit: PAGE_SIZE });

      if (page.error || !page.data) {
        requestLogger.error({ err: page.error }, 'Launch dry run: page failed');
        truncated = true;
        break;
      }

      if (page.data.length === 0) break;

      for (const row of page.data) {
        scanned += 1;

        const tierInForce =
          row.tier !== null && (row.tier_expires_at === null || now.getTime() < Date.parse(row.tier_expires_at));

        if (tierInForce) {
          hasTierInForce += 1;
          continue;
        }
        if (row.cohort === 'champion') {
          alreadyChampion += 1;
          continue;
        }

        wouldBecomeChampion += 1;
        if (sample.length < 20) sample.push(row.user_id);
      }

      after = page.data[page.data.length - 1].user_id;
      if (page.data.length < PAGE_SIZE) break;
      if (scanned >= 20000) {
        truncated = true;
        break;
      }
    }

    requestLogger.info({ scanned, wouldBecomeChampion, alreadyChampion, hasTierInForce }, 'Launch dry run');

    // A dry run writes nothing to the entitlement tables — but it IS an admin
    // asking what a one-way change would do, and that is worth a record.
    await auditTrail
      .log({
        action: AUDIT_EVENTS.BOS_ENTITLEMENT_LAUNCH_DRY_RUN,
        entityType: 'system',
        entityId: null,
        actorId: gate.user.id,
        details: {
          reason: parsed.data.reason,
          correlationId,
          scanned,
          wouldBecomeChampion,
          alreadyChampion,
          hasTierInForce,
        },
        severity: 'info',
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

    return NextResponse.json({
      success: true,
      data: {
        dryRun: true,
        wroteNothing: true,
        scanned,
        wouldBecomeChampion,
        alreadyChampion,
        hasTierInForce,
        sample,
        truncated,
        tiersConfigured: config.tierOrder,
        note:
          'A real run is refused while no tier is configured (UD-2) and its execution lands in ' +
          'Slice 2. This is the count it would act on, from real data.',
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Launch dry run failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
