// app/api/business-os/purge/commit/route.ts
//
// T20 — the Reset / Purge commit (Purge added in purge slice 3b).
//
// ⚠️ THIS ROUTE DELETES DATA once `purge_business_data` is applied. Until then
// it refuses before writing anything, because `ResetService` probes for the
// function first. That refusal is the expected state until the service-role
// key is rotated and `20260916b` is applied.
//
// ── Options (FR-4) ─────────────────────────────────────────────────────────
// `options` is a `.strict()` object of three booleans, each defaulting to
// false, so an unknown key is a 400. The `agents` key is ACCEPTED here and
// refused by the orchestrator with its own code (`agents_option_refused`,
// OQ-1 = (c), SA C-4): the refusal lives in one place, where it is audited,
// and cannot be bypassed by a caller that skips this route's schema.
//
// FR-2 / AC-28: the target is ALWAYS the session user. No user id is accepted
// anywhere — the schema is `.strict()`, so an injected `userId` is a 400 rather
// than an ignored field.
//
// ── Typed confirmation (FR-11) ─────────────────────────────────────────────
// The caller must type the business name, or the account email where there is
// no business name. It is compared SERVER-SIDE against a value the server looks
// up — not against anything the client supplied — so the confirmation cannot
// be satisfied by a client that simply echoes back what it was shown.
//
// ── Not in slices 2 or 3: the signed dry-run token (AC-29) ─────────────────
// Slice 2's "Delivers" list names typed confirmation and not the preview→commit
// token, so this route does not require a prior matching dry-run. The UI only
// offers the commit after a preview, but that is a rendering order, not an
// enforced one. AC-29 is therefore NOT satisfied by this slice and is carried
// forward (to AD-2 / slice 5) — stated here so it is not mistaken for done.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { authorizePurge } from '@/lib/business-os/purge/purgeAuthz';
import { runPurgeCommit } from '@/lib/business-os/purge/ResetService';
import { confirmationMatches, resolveConfirmationTarget } from '@/lib/business-os/purge/confirmation';

const logger = createLogger({ module: 'PurgeCommitAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Snapshot (full row read + write + read-back) plus a one-transaction delete
 * across every table in the run plus recursive storage removal. 60s is the ceiling the gate budget was set against;
 * a Reset that exceeds it is killed by the platform mid-phase-3, which is
 * survivable (phase 2 already committed, residue is reported on the next
 * preview) but should be rare for a test business.
 */
export const maxDuration = 60;

const schema = z
  .object({
    level: z.enum(['reset', 'purge']),
    options: z
      .object({
        integrations: z.boolean().default(false),
        agents: z.boolean().default(false),
        activityHistory: z.boolean().default(false),
      })
      .strict()
      .default({}),
    // Trimmed before the length check, so whitespace-only text is a validation
    // error rather than a confirmation that merely fails to match.
    confirmText: z.string().trim().min(1).max(500),
  })
  .strict();

export async function POST(request: NextRequest) {
  const correlationId =
    request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // E-2: a malformed JSON body is invalid input — a 400, not a 500. Unguarded,
    // `request.json()` throws a SyntaxError that falls through to the generic
    // handler and reports an internal server error for what is a client mistake.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: 'Request body is not valid JSON' },
        { status: 400 },
      );
    }
    const validated = schema.parse(body);

    const decision = await authorizePurge(
      { id: user.id, email: user.email ?? null },
      validated.level,
      'internal',
    );
    if (!decision.allowed) {
      return NextResponse.json(
        { success: false, error: decision.reason },
        { status: decision.status },
      );
    }

    // ── Typed confirmation, checked against a server-side value ───────────
    // Shared with the admin surface (AD-2a). A profile READ ERROR is a 500,
    // never the email fallback (SA AC2-8: the confirmation must not fail open).
    const target = await resolveConfirmationTarget(user.id, user.email ?? null);
    if (target.status === 'unverified') {
      requestLogger.error({ userId: user.id, level: validated.level }, 'Commit refused — confirmation target could not be read');
      return NextResponse.json(
        { success: false, error: 'Could not read what to confirm against. Nothing was changed. Try again.' },
        { status: 500 },
      );
    }
    if (target.status === 'none') {
      return NextResponse.json(
        { success: false, error: 'Could not determine what to confirm against. Refusing.' },
        { status: 409 },
      );
    }

    const expected = target;
    if (!confirmationMatches(validated.confirmText, expected.value)) {
      requestLogger.info({ userId: user.id, level: validated.level }, 'Commit refused — confirmation text did not match');
      return NextResponse.json(
        {
          success: false,
          error: `Confirmation did not match. Type the ${expected.kind} exactly.`,
          expectedKind: expected.kind,
        },
        { status: 400 },
      );
    }

    // Ids only (CLAUDE.md § Logging; AD-2a T-9): no address in this line.
    requestLogger.warn(
      { userId: user.id, level: validated.level, options: validated.options },
      'Commit confirmed — starting the destructive sequence',
    );

    const outcome = await runPurgeCommit({
      userId: user.id, // session user only — never from the request
      actorEmail: user.email ?? null,
      correlationId,
      level: validated.level,
      options: validated.options,
    });

    return NextResponse.json({ success: true, data: outcome });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 },
      );
    }
    requestLogger.error({ err: error }, 'Purge commit failed unexpectedly');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 },
    );
  }
}
