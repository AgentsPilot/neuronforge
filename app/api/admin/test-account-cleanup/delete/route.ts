/**
 * Account cleanup, the DELETE (OX-1r, extended by data export DE-10b.1).
 *
 *   POST /api/admin/test-account-cleanup/delete
 *     { mode: 'hard', email, tag, confirmEmail, reason: { category: 'test_account' } }
 *     { mode: 'anonymise', email, subject, confirmEmail, reason }
 *
 * ⚠️ DESTRUCTIVE AND LIVE once the second secret is set and the function is
 * applied (BQ-1). `hard` removes one TEST account completely, login included,
 * so the email can sign up again. `anonymise` (DE-10b.1) closes and anonymises
 * a real account in place: its business data is deleted, our billing rows stay
 * with their personal columns blanked, and the login becomes a closed
 * tombstone. Every guard runs inside the generated, secret-gated database
 * function; this route adds none and removes none.
 *
 * Order, and nothing before it: `requireAdmin` (401 / 403) -> body, Zod
 * `.strict()` per mode (400) -> the second secret present, else 503 (the off
 * switch) -> the receipt fingerprint key present, else 503 `not_configured`
 * (C2-5: no receipt, no delete) -> the runner: G-3, the check, the function
 * version (R-6, 503 before any storage call), the receipt facts, storage only
 * when every blocker is G-12, then the delete or the anonymise with its own
 * re-check. The function writes the receipt last, in its transaction (R-2).
 *
 * Every admin delete needs a reason (BQ-4). The hard delete takes only "Test
 * account" (O-10): any other reason is a 400.
 *
 * Audit: the success row is written INSIDE the transaction by the function,
 * with the admin as actor (SA-5). A refused or failed attempt writes
 * BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED (hard) or ACCOUNT_DELETION_REFUSED
 * (anonymise, R-3) from here, flushed before responding, never failing the
 * request (BQ-5). Never the email, the tag, the reason note or the
 * fingerprint, in an audit row or a log line.
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md,
 * docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md
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
import { BusinessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { cleanupDeleteBodySchema, type CleanupDeleteBody } from '@/lib/business-os/test-account-cleanup/schemas';
import { runCleanupDelete, type CleanupDeleteOutcome, type PrepareReceipt } from '@/lib/business-os/test-account-cleanup/runCleanupDelete';
import { runAccountAnonymise, type AnonymiseRunOutcome } from '@/lib/business-os/account-deletion/runAccountAnonymise';
import {
  FINGERPRINT_KEY_VERSION,
  fingerprintEmail,
  isFingerprintKeyAvailable,
} from '@/lib/business-os/account-deletion/receiptFingerprint';
import { buildAdminReceipt } from '@/lib/business-os/account-deletion/receiptInput';
import { reasonNoteOf } from '@/lib/business-os/account-deletion/reason';
import type { CleanupAnonymiseView } from '@/lib/business-os/test-account-cleanup/cleanupApiTypes';

const logger = createLogger({ module: 'TestAccountCleanupDeleteAPI' });

// Node: Pino and the service-role client. Never cached. 60 s: the check, the storage step and the delete (TQ-7).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Mode = CleanupDeleteBody['mode'];

/**
 * The refused/failed row (SA-5, R-3): guard ids, target login id, correlationId.
 * Never the email, the tag, the reason note or the fingerprint.
 */
async function auditRefused(
  request: NextRequest,
  requestLogger: AuditFlushLogger,
  adminId: string,
  correlationId: string,
  mode: Mode | null,
  facts: { reason: string; targetUserId: string | null; guards: string[]; filesRemoved: number }
): Promise<void> {
  await logAndFlush(
    {
      action: mode === 'anonymise' ? AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED : AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED,
      entityType: 'user',
      entityId: facts.targetUserId,
      userId: adminId,
      actorId: adminId,
      details: {
        source: 'admin_page',
        mode: mode ?? 'unknown',
        reason: facts.reason,
        guards: facts.guards,
        target_user_id: facts.targetUserId,
        files_removed: facts.filesRemoved,
        correlation_id: correlationId,
      },
      request,
    },
    requestLogger,
    { reason: mode === 'anonymise' ? 'account deletion refused' : 'test-account removal refused', continues: 'responding anyway' }
  );
}

const notConfigured = (correlationId: string) =>
  NextResponse.json(
    { success: false, error: 'not_configured', message: 'The cleanup is not configured on this deployment.', correlationId },
    { status: 503 }
  );

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
  const input = parsed.data;

  if (!isTestCleanupConfigured()) {
    requestLogger.warn({ mode: input.mode }, 'Account cleanup delete refused: not configured');
    await auditRefused(request, requestLogger, adminId, correlationId, input.mode, {
      reason: 'not_configured',
      targetUserId: null,
      guards: [],
      filesRemoved: 0,
    });
    return notConfigured(correlationId);
  }

  // C2-5: no fingerprint key, no receipt, so no delete in either mode.
  if (!isFingerprintKeyAvailable()) {
    requestLogger.warn({ mode: input.mode }, 'Account cleanup delete refused: the receipt fingerprint key is not configured');
    await auditRefused(request, requestLogger, adminId, correlationId, input.mode, {
      reason: 'not_configured',
      targetUserId: null,
      guards: [],
      filesRemoved: 0,
    });
    return notConfigured(correlationId);
  }

  const requestedAt = new Date();
  // Runs after the check and before the storage step: a failure here (the key,
  // the export facts, a value the table would refuse) removes nothing.
  const prepareReceipt: PrepareReceipt = async (targetUserId) => {
    const facts = await new BusinessOsDataExportJobRepository().findDeletionFacts(targetUserId);
    if (facts.error || !facts.data) throw facts.error ?? new Error('No export facts');
    return buildAdminReceipt({
      // In memory only: the email itself never leaves this request.
      emailFingerprint: fingerprintEmail(input.email),
      fingerprintKeyVersion: FINGERPRINT_KEY_VERSION,
      adminEmail: gate.user.email ?? null,
      reasonCategory: input.reason.category,
      reasonNote: reasonNoteOf(input.reason),
      ownerLastExportReadyAt: facts.data.ownerLastExportReadyAt,
      ownerExportDownloadedAt: facts.data.ownerExportDownloadedAt,
      adminExportExisted: facts.data.adminExportExisted,
      requestedAt,
      correlationId,
    });
  };

  const started = Date.now();
  try {
    const repo = new TestAccountCleanupRepository();
    const outcome: CleanupDeleteOutcome | AnonymiseRunOutcome =
      input.mode === 'hard'
        ? await runCleanupDelete(repo, { email: input.email, tag: input.tag, confirmEmail: input.confirmEmail }, adminId, prepareReceipt)
        : await runAccountAnonymise(
            repo,
            { email: input.email, subject: input.subject, confirmEmail: input.confirmEmail },
            adminId,
            prepareReceipt
          );

    if (outcome.kind === 'removed') {
      requestLogger.info(
        {
          mode: input.mode,
          targetUserId: outcome.targetUserId,
          receiptId: outcome.receiptId,
          rows: outcome.report.total.rowsRemoved,
          tables: outcome.report.total.tablesRemoved,
          filesRemoved: outcome.filesRemoved,
          serverMs: outcome.serverMs,
          elapsedMs: Date.now() - started,
        },
        'Test account removed'
      );
      return NextResponse.json({
        success: true,
        data: {
          targetUserId: outcome.targetUserId,
          filesRemoved: outcome.filesRemoved,
          report: outcome.report,
          serverMs: outcome.serverMs,
        },
        correlationId,
      });
    }

    if (outcome.kind === 'anonymised') {
      const data: CleanupAnonymiseView = {
        mode: 'anonymise',
        targetUserId: outcome.targetUserId,
        filesRemoved: outcome.filesRemoved,
        ...outcome.report,
        serverMs: outcome.serverMs,
      };
      requestLogger.info(
        {
          mode: input.mode,
          targetUserId: outcome.targetUserId,
          receiptId: outcome.report.receiptId,
          receiptMode: outcome.report.receiptMode,
          rows: outcome.report.rowsRemoved,
          tables: outcome.report.tablesRemoved,
          rowsBlanked: outcome.report.rowsBlanked,
          filesRemoved: outcome.filesRemoved,
          notes: outcome.notes.map((note) => note.guard),
          serverMs: outcome.serverMs,
          elapsedMs: Date.now() - started,
        },
        'Account closed and anonymised'
      );
      return NextResponse.json({ success: true, data, correlationId });
    }

    if (outcome.kind === 'refused') {
      requestLogger.warn(
        {
          mode: input.mode,
          targetUserId: outcome.targetUserId,
          reason: outcome.reason,
          guards: outcome.guards,
          filesRemoved: outcome.filesRemoved,
          serverMs: outcome.serverMs,
          elapsedMs: Date.now() - started,
        },
        input.mode === 'anonymise' ? 'Account deletion refused' : 'Test-account removal refused'
      );
      await auditRefused(request, requestLogger, adminId, correlationId, input.mode, {
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
          mode: input.mode,
          err: outcome.error ? cleanupErrorFacts(outcome.error) : undefined,
          reason: outcome.reason,
          targetUserId: outcome.targetUserId,
          filesRemoved: outcome.filesRemoved,
          elapsedMs: Date.now() - started,
        },
        'Account cleanup refused: the cleanup function is not usable'
      );
      await auditRefused(request, requestLogger, adminId, correlationId, input.mode, {
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
        mode: input.mode,
        err: facts,
        stage: outcome.stage,
        targetUserId: outcome.targetUserId,
        filesRemoved: outcome.filesRemoved,
        elapsedMs: Date.now() - started,
      },
      'Account cleanup failed'
    );
    await auditRefused(request, requestLogger, adminId, correlationId, input.mode, {
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
    requestLogger.error({ mode: input.mode, err: cleanupErrorFacts(error) }, 'Account cleanup failed unexpectedly');
    // Recorded like every other failed attempt (SA review item 2). The target
    // and the file count are unknown here; logAndFlush never throws.
    await auditRefused(request, requestLogger, adminId, correlationId, input.mode, {
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
