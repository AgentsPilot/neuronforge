/**
 * Account cleanup, the read-only CHECK and the status probe (OX-1r, DE-10b.1).
 *
 *   GET  /api/admin/test-account-cleanup/check   -> { configured }   the section's banner probe
 *   POST /api/admin/test-account-cleanup/check
 *     { mode: 'hard', email, tag }          -> OK / BLOCKED report of the test-account delete
 *     { mode: 'anonymise', email, subject } -> OK / BLOCKED report of the close-and-anonymise,
 *                                              with the informational rows apart (`notes`)
 *
 * Calls the secret-gated cleanup function in check or anonymise_check mode,
 * which sets its own transaction read-only, so the database itself guarantees
 * it changes nothing. Checks are not audited (BQ-5): frequent, and they change
 * nothing. `subject` is the account id of the row the admin picked; guard G-2a
 * proves in the database that the email resolves to it.
 *
 * Order, and nothing before it: `requireAdmin` (401 / 403) -> body, Zod
 * `.strict()` (400) -> the second secret present, else 503 "not configured"
 * (the off switch) -> the check. A database refusal of the secret (42501) or a
 * missing function is also a 503, logged as an error.
 *
 * Pino: admin id, mode, target login id, guard ids, counts, elapsed ms. Never
 * the email, the tag or the secret (SA-12, R-5).
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
 *
 * @module app/api/admin/test-account-cleanup/check
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { isTestCleanupConfigured } from '@/lib/server/testCleanupSecret';
import { TestAccountCleanupRepository, cleanupErrorFacts } from '@/lib/repositories/TestAccountCleanupRepository';
import { cleanupCheckBodySchema } from '@/lib/business-os/test-account-cleanup/schemas';
import { unavailableReasonOf } from '@/lib/business-os/test-account-cleanup/runCleanupDelete';
import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';

const logger = createLogger({ module: 'TestAccountCleanupCheckAPI' });

// Node: Pino and the service-role client. Never cached. 60 s (TQ-7).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'test-account-cleanup-check', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  return NextResponse.json({ success: true, data: { configured: isTestCleanupConfigured() }, correlationId });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'test-account-cleanup-check', method: 'POST' }));
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
  const parsed = cleanupCheckBodySchema.safeParse(body);
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
    requestLogger.warn({}, 'Test-account cleanup check refused: not configured');
    return NextResponse.json(
      { success: false, error: 'not_configured', message: 'The cleanup is not configured on this deployment.', correlationId },
      { status: 503 }
    );
  }

  const started = Date.now();
  try {
    const repo = new TestAccountCleanupRepository();
    const input = parsed.data;
    const result =
      input.mode === 'hard'
        ? await repo.check({ email: input.email, tag: input.tag })
        : await repo.anonymiseCheck({ email: input.email, subject: input.subject });
    if (result.error || !result.data) {
      const facts = cleanupErrorFacts(result.error);
      const unavailable = unavailableReasonOf(result.error);
      requestLogger.error({ mode: input.mode, err: facts, elapsedMs: Date.now() - started }, 'Account cleanup check failed');
      return NextResponse.json(
        {
          success: false,
          error: unavailable ?? 'check_failed',
          message: unavailable
            ? 'The cleanup is not available on this deployment. Nothing was changed.'
            : 'The check could not run. Nothing was changed.',
          details: process.env.NODE_ENV === 'development' ? facts.message : undefined,
          correlationId,
        },
        { status: unavailable ? 503 : 500 }
      );
    }

    const check = result.data;
    const functionUpToDate = check.version === CLEANUP_FUNCTION_VERSION;
    requestLogger.info(
      {
        mode: input.mode,
        targetUserId: check.targetUserId,
        verdict: check.verdict,
        guards: [...new Set(check.blockers.map((blocker) => blocker.guard))],
        notes: [...new Set(check.notes.map((note) => note.guard))],
        storageObjects: check.storageObjects.length,
        rows: check.rows.length,
        functionUpToDate,
        serverMs: check.serverMs,
        elapsedMs: Date.now() - started,
      },
      'Test-account cleanup check ran'
    );
    return NextResponse.json({ success: true, data: { ...check, functionUpToDate }, correlationId });
  } catch (error) {
    requestLogger.error({ err: cleanupErrorFacts(error) }, 'Test-account cleanup check failed unexpectedly');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
        correlationId,
      },
      { status: 500 }
    );
  }
}
