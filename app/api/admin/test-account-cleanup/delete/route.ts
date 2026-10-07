/**
 * Test-account cleanup, the DELETE (OX-1r).
 *
 *   POST /api/admin/test-account-cleanup/delete   body { email, tag, confirmEmail }
 *
 * ⚠️ DESTRUCTIVE AND LIVE once the second secret is set and the function is
 * applied (BQ-1): it removes one TEST account completely, login included, so
 * the email can sign up again. Every guard G-1 to G-18 runs inside the
 * generated, secret-gated database function; this route adds none and
 * removes none.
 *
 * Order, and nothing before it: `requireAdmin` (401 / 403) -> body, Zod
 * `.strict()` (400) -> the second secret present, else 503 (the off switch) ->
 * `runCleanupDelete`: G-3, the check, the function version (R-6, 503 before
 * any storage call), storage only when every blocker is G-12, then the delete
 * with its own G-12 re-check (SA-6). A refused secret (42501) or a missing
 * function is a 503, audited as refused.
 *
 * Audit: the success row is written INSIDE the transaction by the function, with
 * the admin as actor (SA-5). A refused or failed attempt writes
 * BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED from here, flushed before responding,
 * never failing the request (BQ-5). No email, no tag in either.
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
 *
 * @module app/api/admin/test-account-cleanup/delete
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { logAndFlush, type AuditFlushLogger } from '@/lib/audit/boundedAuditFlush';
import { isTestCleanupConfigured } from '@/lib/server/testCleanupSecret';
import { TestAccountCleanupRepository, cleanupErrorFacts } from '@/lib/repositories/TestAccountCleanupRepository';
import { cleanupDeleteBodySchema } from '@/lib/business-os/test-account-cleanup/schemas';
import { runCleanupDelete } from '@/lib/business-os/test-account-cleanup/runCleanupDelete';

const logger = createLogger({ module: 'TestAccountCleanupDeleteAPI' });

// Node: Pino and the service-role client. Never cached. 60 s: the check, the storage step and the delete (TQ-7).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The refused/failed row (SA-5): guard ids, target login id, correlationId. Never the email or the tag. */
async function auditRefused(
  request: NextRequest,
  requestLogger: AuditFlushLogger,
  adminId: string,
  correlationId: string,
  facts: { reason: string; targetUserId: string | null; guards: string[]; filesRemoved: number }
): Promise<void> {
  await logAndFlush(
    {
      action: AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED,
      entityType: 'user',
      entityId: facts.targetUserId,
      userId: adminId,
      actorId: adminId,
      details: {
        source: 'admin_page',
        reason: facts.reason,
        guards: facts.guards,
        target_user_id: facts.targetUserId,
        files_removed: facts.filesRemoved,
        correlation_id: correlationId,
      },
      request,
    },
    requestLogger,
    { reason: 'test-account removal refused', continues: 'responding anyway' }
  );
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'test-account-cleanup-delete', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 });
  }
  const parsed = cleanupDeleteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'invalid_body',
        details: process.env.NODE_ENV === 'development' ? parsed.error.issues[0]?.message : undefined,
      },
      { status: 400 }
    );
  }

  if (!isTestCleanupConfigured()) {
    requestLogger.warn({}, 'Test-account cleanup delete refused: not configured');
    await auditRefused(request, requestLogger, adminId, correlationId, {
      reason: 'not_configured',
      targetUserId: null,
      guards: [],
      filesRemoved: 0,
    });
    return NextResponse.json(
      { success: false, error: 'not_configured', message: 'The cleanup is not configured on this deployment.', correlationId },
      { status: 503 }
    );
  }

  const started = Date.now();
  try {
    const outcome = await runCleanupDelete(new TestAccountCleanupRepository(), parsed.data, adminId);

    if (outcome.kind === 'removed') {
      requestLogger.info(
        {
          targetUserId: outcome.targetUserId,
          rows: outcome.report.total.rowsRemoved,
          tables: outcome.report.total.tablesRemoved,
          filesRemoved: outcome.filesRemoved,
          elapsedMs: Date.now() - started,
        },
        'Test account removed'
      );
      return NextResponse.json({
        success: true,
        data: { targetUserId: outcome.targetUserId, filesRemoved: outcome.filesRemoved, report: outcome.report },
        correlationId,
      });
    }

    if (outcome.kind === 'refused') {
      requestLogger.warn(
        {
          targetUserId: outcome.targetUserId,
          reason: outcome.reason,
          guards: outcome.guards,
          filesRemoved: outcome.filesRemoved,
          elapsedMs: Date.now() - started,
        },
        'Test-account removal refused'
      );
      await auditRefused(request, requestLogger, adminId, correlationId, {
        reason: outcome.reason,
        targetUserId: outcome.targetUserId,
        guards: outcome.guards,
        filesRemoved: outcome.filesRemoved,
      });
      return NextResponse.json(
        {
          success: false,
          error: outcome.reason,
          message: outcome.message,
          guards: outcome.guards,
          blockers: outcome.blockers,
          filesRemoved: outcome.filesRemoved,
          correlationId,
        },
        { status: outcome.reason === 'confirmation_mismatch' ? 400 : 409 }
      );
    }

    if (outcome.kind === 'unavailable') {
      requestLogger.error(
        {
          err: outcome.error ? cleanupErrorFacts(outcome.error) : undefined,
          reason: outcome.reason,
          targetUserId: outcome.targetUserId,
          filesRemoved: outcome.filesRemoved,
          elapsedMs: Date.now() - started,
        },
        'Test-account removal refused: the cleanup function is not usable'
      );
      await auditRefused(request, requestLogger, adminId, correlationId, {
        reason: outcome.reason,
        targetUserId: outcome.targetUserId,
        guards: [],
        filesRemoved: outcome.filesRemoved,
      });
      return NextResponse.json(
        {
          success: false,
          error: outcome.reason,
          // A 42501 or a missing function can surface on the delete call AFTER
          // the storage step, so say what was really removed (QA Low-1).
          message:
            (outcome.reason === 'function_out_of_date'
              ? 'The database function is out of date. Apply the current migration.'
              : 'The cleanup is not available on this deployment.') +
            (outcome.filesRemoved > 0
              ? ' Files removed, account kept. Nothing else was removed.'
              : ' Nothing was removed.'),
          filesRemoved: outcome.filesRemoved,
          correlationId,
        },
        { status: 503 }
      );
    }

    const facts = cleanupErrorFacts(outcome.error);
    requestLogger.error(
      {
        err: facts,
        stage: outcome.stage,
        targetUserId: outcome.targetUserId,
        filesRemoved: outcome.filesRemoved,
        elapsedMs: Date.now() - started,
      },
      'Test-account removal failed'
    );
    await auditRefused(request, requestLogger, adminId, correlationId, {
      reason: `${outcome.stage}_failed`,
      targetUserId: outcome.targetUserId,
      guards: [],
      filesRemoved: outcome.filesRemoved,
    });
    return NextResponse.json(
      {
        success: false,
        error: `${outcome.stage}_failed`,
        message:
          outcome.stage === 'storage'
            ? 'The storage step failed, so some files may be gone. The account was kept. Run the check again.'
            : outcome.filesRemoved > 0
              ? 'Files removed, account kept: the delete did not run to the end. Nothing else was removed.'
              : 'The removal did not run. Nothing was removed.',
        filesRemoved: outcome.filesRemoved,
        details: process.env.NODE_ENV === 'development' ? facts.message : undefined,
        correlationId,
      },
      { status: 500 }
    );
  } catch (error) {
    requestLogger.error({ err: cleanupErrorFacts(error) }, 'Test-account removal failed unexpectedly');
    // Recorded like every other failed attempt (SA review item 2). The target
    // and the file count are unknown here; logAndFlush never throws.
    await auditRefused(request, requestLogger, adminId, correlationId, {
      reason: 'unexpected_failed',
      targetUserId: null,
      guards: [],
      filesRemoved: 0,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'The removal stopped unexpectedly. Run the check again before retrying.',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
        correlationId,
      },
      { status: 500 }
    );
  }
}
