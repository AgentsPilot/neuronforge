/**
 * The self-delete drawer's pre-check (data export DE-10b.2; workplan §2.3;
 * SA workplan review O2-1, V-1, V-2).
 *
 *   GET /api/business-os/account/deletion-check
 *     → { enabled: false }                               the switch is off: the Danger Zone keeps today's body
 *     → { enabled: true, available: false, … }           this deployment cannot delete right now
 *     → { enabled: true, available: true, blockers, willKeepBilling, exportFacts }
 *
 * Read-only: the cleanup function runs in `anonymise_check` mode, which sets
 * its own transaction read-only, so the database guarantees it changes
 * nothing. Not audited (it changes nothing, and the drawer calls it on open).
 *
 * Order, nothing before it: the off switch (200 `{ enabled: false }`, before
 * any session read; the flag state is not a secret) → the session user, from
 * `getUser()` only (401) → throttle (429) → no login email, cleanup secret or
 * fingerprint key → `available: false` → the check → the export facts.
 *
 * Never in a response or a log line: the email, a guard's SQL text, a
 * database message. Logs carry ids, guard ids and counts.
 *
 * @module app/api/business-os/account/deletion-check
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { isAccountSelfDeleteEnabled } from '@/lib/utils/featureFlags';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { isTestCleanupConfigured } from '@/lib/server/testCleanupSecret';
import { isFingerprintKeyAvailable } from '@/lib/business-os/account-deletion/receiptFingerprint';
import { readSessionSubject, selfDeleteThrottleKey } from '@/lib/business-os/account-deletion/sessionSubject';
import { errorKindFacts, runAccountDeletionCheck } from '@/lib/business-os/account-deletion/selfServiceDeletion';
import { toBlockerViews, willKeepBilling } from '@/lib/business-os/account-deletion/blockerCopy';
import type { DeletionCheckData } from '@/lib/business-os/account-deletion/schemas';
import { BusinessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';

const logger = createLogger({ module: 'AccountDeletionCheckAPI' });

// Node: Pino and the service-role engine. Never cached: the answer is per session and changes.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = 'no-store, no-cache, must-revalidate';

function answer(data: DeletionCheckData, correlationId: string): NextResponse {
  return NextResponse.json({ success: true, data, correlationId }, { headers: { 'Cache-Control': NO_STORE } });
}

const NOT_AVAILABLE = (): DeletionCheckData => ({
  enabled: true,
  available: false,
  blockers: [],
  willKeepBilling: false,
  exportFacts: { lastReadyAt: null, downloaded: false },
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  // O2-1: off → today's Danger Zone body, before the session is read.
  if (!isAccountSelfDeleteEnabled()) return answer({ enabled: false }, correlationId);

  const requestLogger = logger.child({ correlationId });
  try {
    const subject = await readSessionSubject();
    if (!subject) {
      return NextResponse.json({ success: false, error: 'Unauthorized', correlationId }, { status: 401, headers: { 'Cache-Control': NO_STORE } });
    }

    const throttle = await rateLimit(request, selfDeleteThrottleKey('account-deletion-check', subject.id), RATE_LIMITS.read);
    if (!throttle.allowed) {
      // SA N-2: `no-store` on the 429 here; the shared helper is unchanged for its other callers.
      const response = tooManyRequests(RATE_LIMITS.read.windowSeconds);
      response.headers.set('Cache-Control', NO_STORE);
      return response;
    }

    // V-1: a login with no email cannot be resolved by the function; the key and the secret gate every delete (C2-5).
    if (subject.email === null || !isTestCleanupConfigured() || !isFingerprintKeyAvailable()) {
      requestLogger.warn(
        { subjectId: subject.id, hasEmail: subject.email !== null, cleanupConfigured: isTestCleanupConfigured(), keyAvailable: isFingerprintKeyAvailable() },
        'Account deletion check: not available on this deployment'
      );
      return answer(NOT_AVAILABLE(), correlationId);
    }

    const started = Date.now();
    const outcome = await runAccountDeletionCheck({ email: subject.email, subject: subject.id });
    if (outcome.kind === 'unavailable') {
      requestLogger.error(
        { subjectId: subject.id, reason: outcome.reason, err: outcome.error ? errorKindFacts(outcome.error) : undefined },
        'Account deletion check: the cleanup function is not usable'
      );
      return answer(NOT_AVAILABLE(), correlationId);
    }
    if (outcome.kind === 'failed') {
      requestLogger.error({ subjectId: subject.id, err: errorKindFacts(outcome.error) }, 'Account deletion check failed');
      return NextResponse.json(
        { success: false, error: 'check_failed', message: 'We could not check your account right now. Please try again.', correlationId },
        { status: 500, headers: { 'Cache-Control': NO_STORE } }
      );
    }

    // The export facts are shown, never required (requirement §3.2). A read failure shows "none on record".
    const facts = await new BusinessOsDataExportJobRepository().findDeletionFacts(subject.id);
    if (facts.error) requestLogger.warn({ subjectId: subject.id }, 'Account deletion check: export facts could not be read');

    const data: DeletionCheckData = {
      enabled: true,
      available: true,
      blockers: outcome.canDelete ? [] : toBlockerViews(outcome.blockers),
      willKeepBilling: willKeepBilling(outcome.notes),
      exportFacts: {
        lastReadyAt: facts.data?.ownerLastExportReadyAt ?? null,
        downloaded: Boolean(facts.data?.ownerExportDownloadedAt),
      },
    };
    requestLogger.info(
      {
        subjectId: subject.id,
        canDelete: outcome.canDelete,
        guards: outcome.guards,
        notes: [...new Set(outcome.notes.map((note) => note.guard))],
        blockers: data.blockers.map((blocker) => blocker.code),
        serverMs: outcome.serverMs,
        elapsedMs: Date.now() - started,
      },
      'Account deletion check ran'
    );
    return answer(data, correlationId);
  } catch (error) {
    requestLogger.error({ err: errorKindFacts(error) }, 'Account deletion check failed unexpectedly');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
        correlationId,
      },
      { status: 500, headers: { 'Cache-Control': NO_STORE } }
    );
  }
}
