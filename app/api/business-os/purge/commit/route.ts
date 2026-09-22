// app/api/business-os/purge/commit/route.ts
//
// T20 — the Reset commit.
//
// ⚠️ THIS ROUTE DELETES DATA once `purge_business_data` is applied. Until then
// it refuses before writing anything, because `ResetService` probes for the
// function first. That refusal is the expected state until the service-role
// key is rotated and `20260916b` is applied.
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
// ── Not in slice 2: the signed dry-run token (AC-29) ───────────────────────
// Slice 2's "Delivers" list names typed confirmation and not the preview→commit
// token, so this route does not require a prior matching dry-run. The UI only
// offers the commit after a preview, but that is a rendering order, not an
// enforced one. AC-29 is therefore NOT satisfied by this slice and is carried
// forward — stated here so it is not mistaken for done.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { authorizePurge } from '@/lib/business-os/purge/purgeAuthz';
import { runReset } from '@/lib/business-os/purge/ResetService';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'PurgeCommitAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Snapshot (full row read + write + read-back) plus a 53-table transaction plus
 * recursive storage removal. 60s is the ceiling the gate budget was set against;
 * a Reset that exceeds it is killed by the platform mid-phase-3, which is
 * survivable (phase 2 already committed, residue is reported on the next
 * preview) but should be rare for a test business.
 */
export const maxDuration = 60;

const schema = z
  .object({
    level: z.literal('reset'),
    // Trimmed before the length check, so whitespace-only text is a validation
    // error rather than a confirmation that merely fails to match.
    confirmText: z.string().trim().min(1).max(500),
  })
  .strict();

/** Normalise for comparison: trimmed, case-insensitive, internal whitespace collapsed. */
const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

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
    const expected = await resolveConfirmationTarget(user.id, user.email ?? null);
    if (!expected) {
      return NextResponse.json(
        { success: false, error: 'Could not determine what to confirm against. Refusing.' },
        { status: 409 },
      );
    }

    if (normalise(validated.confirmText) !== normalise(expected.value)) {
      requestLogger.info({ userId: user.id }, 'Reset refused — confirmation text did not match');
      return NextResponse.json(
        {
          success: false,
          error: `Confirmation did not match. Type the ${expected.kind} exactly.`,
          expectedKind: expected.kind,
        },
        { status: 400 },
      );
    }

    requestLogger.warn(
      { userId: user.id, email: user.email },
      'Reset confirmed — starting the destructive sequence',
    );

    const outcome = await runReset({
      userId: user.id, // session user only — never from the request
      actorEmail: user.email ?? null,
      correlationId,
    });

    return NextResponse.json({ success: true, data: outcome });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 },
      );
    }
    requestLogger.error({ err: error }, 'Reset commit failed unexpectedly');
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

/**
 * What the user must type: the business name, or the account email if there is
 * no business name. Looked up server-side.
 */
async function resolveConfirmationTarget(
  userId: string,
  email: string | null,
): Promise<{ kind: 'business name' | 'account email'; value: string } | null> {
  try {
    const { data: profile } = await businessProfileRepository.findByUserId(userId);
    const name = profile?.company_name;
    if (name && name.trim()) return { kind: 'business name', value: name };
  } catch {
    // Fall through to email. A missing profile is normal for some test accounts.
  }
  return email ? { kind: 'account email', value: email } : null;
}
