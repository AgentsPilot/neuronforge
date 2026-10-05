/**
 * The admin AI Activity drill-down (Gap B slice B2a: FR-B2, FR-B12, SA-RC-11,
 * SA-RC-12, NFR-1, NFR-10, AC-B2, AC-B5, AC-B8, AC-B14). Workplan
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B2_WORKPLAN.md § F.
 *
 *   GET /api/admin/business-os/ai-activity/drill-down?actionId=<uuid>
 *
 * ADMIN ONLY. One Business OS AI action: its charge, the other charges of its
 * grouping id ON ITS ACCOUNT, their corrections, and their audit entries. The
 * action id is the ONLY input (SA-RC-11): the account and the grouping id are
 * read from the charge row, so no request value can steer or widen a read. An
 * `accountId`, a `groupId` or any other key is refused (400), not ignored.
 *
 * Order, and nothing before it: requireAdmin (401/403) → repeated key (400) →
 * Zod, strict (400) → lower-case the id (SA-B2-8) → the reads → 404 when the
 * builder finds nothing it opens → 200.
 *
 * NOT FOUND (OQ-9): one identical body for an unknown id, an adjustment's id,
 * a deleted account's charge and a platform account's charge. It reveals
 * nothing about which.
 *
 * READ-ONLY. No audit entry (the list's precedent); the accountability is one
 * `info` log with the admin id, the correlation id, the action id, the account
 * id and counts (AC-B8). Never a business name, a model, or a row.
 *
 * @module app/api/admin/business-os/ai-activity/drill-down
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { AiActivityDrillDownReadError, buildAiActivityDrillDown } from '@/lib/business-os/credits/aiActivityDrillDown';
import { aiActivityDrillDownLedger } from '@/lib/business-os/credits/aiActivityDrillDownDeps';
import { aiActivityArchive } from '@/lib/business-os/credits/aiActivityDeps';
import { auditTrailRepository } from '@/lib/repositories/AuditTrailRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'AdminBosAiActivityDrillDownAPI' });

// Node: Pino and the repositories are Node-only. An admin- and cookie-dependent
// GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({ actionId: z.string().uuid('actionId must be a UUID') })
  // Strict: the action id is the ONLY input (SA-RC-11). An accountId, a groupId
  // or any other key is refused, so nothing in the request can steer a read.
  .strict();

// One body for every "not found" (OQ-9): unknown, adjustment, deleted account, platform account.
const NOT_FOUND_BODY = { success: false, error: 'This AI action could not be found' } as const;

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const baseLogger = logger.child({ correlationId });

  // Admin gate. Nothing above this line may touch a request body,
  // the database, a job queue, or an outbound message.
  const gate = await requireAdmin(baseLogger);
  if (gate instanceof NextResponse) return gate;

  const requestLogger = baseLogger.child({ adminId: gate.user.id });
  const startedAt = Date.now();

  try {
    const params = request.nextUrl.searchParams;
    const keys = [...params.keys()];
    // A repeated key would be silently collapsed by Object.fromEntries.
    if (new Set(keys).size !== keys.length) {
      return NextResponse.json({ success: false, error: 'Each query parameter may appear once' }, { status: 400 });
    }

    const parsed = QuerySchema.safeParse(Object.fromEntries(params.entries()));
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? 'Invalid query',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }
    // SA-B2-8: Zod's uuid() accepts upper case, and `action_id` reads back
    // lower-case. Normalised once, before the lookup and the log line.
    const actionId = parsed.data.actionId.toLowerCase();

    const now = new Date();
    const payload = await buildAiActivityDrillDown(actionId, requestLogger, {
      ledger: aiActivityDrillDownLedger(),
      // Admin identity reads are called only from app/api/admin/** (repository guard).
      findNames: (ids) => businessProfileRepository.findAdminIdentitiesByUserIds(ids),
      // Admin-pinned too; the group ids come from the charge rows, never the request.
      listAuditEntries: (groupIds, auditWindow) =>
        auditTrailRepository.listAiActionEntriesAllAccountsByGroupIds(
          { correlationId, adminId: gate.user.id },
          groupIds,
          auditWindow
        ),
      archive: aiActivityArchive(),
      now: () => now,
    });

    if (payload === null) {
      // Ids only. Which kind of "not found" it was is not logged or returned.
      requestLogger.info({ actionId, found: false, durationMs: Date.now() - startedAt }, 'Admin opened an AI action that was not found');
      return NextResponse.json(NOT_FOUND_BODY, { status: 404 });
    }

    // Ids and counts only: never a business name, never a row.
    requestLogger.info(
      {
        actionId,
        found: true,
        accountId: payload.account.accountId,
        // QA-B2a-4: when the group read failed, only the opened charge is known; no count is claimed.
        chargedActions: payload.group.status === 'failed' ? null : payload.group.chargedActions,
        atLeast: payload.group.atLeast,
        group: payload.group.status,
        names: payload.names,
        adjustments: payload.adjustments,
        unresolvedAdjustments: payload.unresolvedAdjustments,
        // Never silent: an amount that could not be read counts as 0, and is counted here.
        unreadableAmounts: payload.unreadableAmounts,
        audit: { status: payload.audit.status, archive: payload.audit.archive, noEntry: payload.audit.noEntry },
        durationMs: Date.now() - startedAt,
      },
      'Admin opened a Business OS AI action'
    );

    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    if (error instanceof AiActivityDrillDownReadError) {
      // Already logged by the builder with the read that failed.
      return NextResponse.json({ success: false, error: 'The AI action could not be read. Try again.' }, { status: 500 });
    }
    requestLogger.error({ err: error }, 'Business OS AI activity drill-down failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
