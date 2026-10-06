/**
 * Admin delete AD-2a: an admin deletes ONE business at the Purge level, from
 * the admin Businesses page (requirement FR-A4 … FR-A13; workplan §2.5; SA
 * AC2-6, AC2-11).
 *
 *   POST /api/admin/users/<uuid>/deletion/commit
 *   body: { "token": "<the preview's commitToken>", "confirmText": "<business name or email>" }
 *
 * ⚠️ ONCE `purge_business_data` IS APPLIED AND THE OFF SWITCH IS ON, THIS
 * DELETES A CUSTOMER'S BUSINESS DATA. It ships INACTIVE: the off switch
 * (`ADMIN_BUSINESS_DELETE_ENABLED`, BQ-1, default off) refuses 409
 * `admin_delete_disabled` before anything is read, and with the switch on the
 * orchestrator still refuses `rpc_not_applied` until the function is applied.
 *
 * Order, and nothing before it: `requireAdmin` (401 / 403) → the path id, Zod
 * uuid, lower-cased (400, before any lookup) → the body, read as text,
 * malformed JSON → 400, then a `.strict()` schema of exactly `{ token,
 * confirmText }`, so a `userId`, `level`, `options` or any other key is a 400
 * → the composition (`commitAdminDeletion`), which owns steps 5 … 12. The
 * target comes ONLY from the path (FR-A4, tenant-isolation-guard); level and
 * options are fixed on the server (SC-2) and bound into the token.
 *
 * Every refusal is an admin-owned, awaited `BUSINESS_DATA_PURGE_BLOCKED` row;
 * the write-ahead and outcome rows are confirmed (`writeNow`). Pino carries
 * ids, codes and counts only: never the email, the business name or the token.
 *
 * @module app/api/admin/users/[id]/deletion/commit
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { commitAdminDeletion } from '@/lib/business-os/purge/AdminDeletionCommit';

const logger = createLogger({ module: 'AdminDeletionCommitAPI' });

// Node: Pino, crypto and the repositories are Node-only. Never cached. 60 s:
// two refusal evaluations, the verified snapshot, the RPC and storage removal.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const targetIdSchema = z.string().uuid();
/** Exactly the token and the typed text. Any other key (a `userId`, a `level`, `options`) is a 400. */
const bodySchema = z
  .object({
    token: z.string().min(1).max(4096),
    // Trimmed before the length check: whitespace-only text is invalid input, not a mismatch.
    confirmText: z.string().trim().min(1).max(500),
  })
  .strict();

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'admin-deletion-commit', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  const parsedId = targetIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return NextResponse.json({ success: false, error: 'invalid_user_id' }, { status: 400 });
  }
  // Canonical form: Postgres matches uuids case-insensitively, JS equality (R-1, the token) does not.
  const targetId = parsedId.data.toLowerCase();

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 });
  }
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'invalid_body',
        details: process.env.NODE_ENV === 'development' ? parsedBody.error.issues[0]?.message : undefined,
      },
      { status: 400 }
    );
  }

  try {
    const outcome = await commitAdminDeletion({
      admin: { id: adminId, email: gate.user.email ?? null },
      targetId,
      token: parsedBody.data.token,
      confirmText: parsedBody.data.confirmText,
      correlationId,
      request,
    });

    if (outcome.kind === 'refused') {
      return NextResponse.json(
        {
          success: false,
          error: outcome.code,
          message: outcome.message,
          refusals: outcome.refusals,
          snapshotWritten: outcome.snapshotWritten,
          expectedKind: outcome.expectedKind,
          detail: outcome.detail,
          correlationId,
        },
        { status: outcome.httpStatus }
      );
    }

    requestLogger.info({ targetId, rows: outcome.result.rows.total }, 'Admin deleted a business');
    return NextResponse.json({ success: true, data: outcome.result });
  } catch (error) {
    requestLogger.error({ err: error, targetId }, 'Admin deletion commit failed unexpectedly');
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
