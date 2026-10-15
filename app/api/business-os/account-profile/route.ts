/**
 * GET / PATCH /api/business-os/account-profile
 *
 * The server side of the Business OS settings page's profile card (settings
 * drawer D-2). The card used to read and upsert `profiles` from the browser,
 * which breaks CLAUDE.md rule 1. It now comes here and goes through
 * `UserProfileRepository`, scoped to the SESSION user (the id is never read
 * from the body or the query string).
 *
 * Not `/api/user/profile` (agent-platform route, direct table calls, no Zod;
 * F-9) and not `/api/business-os/profile` (that is `business_profiles`, the
 * business, not the person; F-10).
 *
 *   GET    { full_name, avatar_url, job_title }, each a string; a missing row
 *          or a NULL column is `''` (not 404).
 *   PATCH  { full_name?, job_title? }, strict. Anything else is a 400:
 *            - `role` is never writable here (CLAUDE.md Security Rules);
 *            - `avatar_url` is read-only here: D-3 owns its write;
 *            - the timezone is never touched (F-24): this route imports no
 *              preferences repository and no timezone mirror, so a name
 *              save cannot stamp `timezone_confirmed_at`.
 *
 * Neither a name nor a job title is ever logged or audited: only the user id
 * and the names of the fields sent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';

const logger = createLogger({ module: 'BusinessOsAccountProfileAPI' });
const auditTrail = AuditTrailService.getInstance();

// Final (C-17, C-18): at or above the longest stored value, so a save never
// refuses a name the account already has. Live check L-1, 2026-10-15: the
// longest stored full_name is 11 characters and the longest job_title 17;
// none is over these limits.
const FULL_NAME_MAX_LENGTH = 120;
const JOB_TITLE_MAX_LENGTH = 100;

// `.trim()` runs before `.max()`, so the limit is on the stored value. Empty is
// allowed (the page could always save an empty name). No content rule: this
// must not be stricter than the browser upsert it replaces (C-18).
const accountProfilePatchSchema = z
  .object({
    full_name: z.string().trim().max(FULL_NAME_MAX_LENGTH).optional(),
    job_title: z.string().trim().max(JOB_TITLE_MAX_LENGTH).optional(),
  })
  .strict()
  .refine((v) => v.full_name !== undefined || v.job_title !== undefined, {
    message: 'Nothing to update',
  });

/** Top-level key names of a body, for logging a refused request. Never values. */
function topLevelKeys(body: unknown): string[] {
  return body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await userProfileRepository.findSettingsCard(user.id);
    if (error) {
      // Already reduced to { code, message } by the repository (CR-1).
      requestLogger.error({ userId: user.id, err: error }, 'Profile card read failed');
      return NextResponse.json({ success: false, error: 'Failed to load the profile' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        full_name: data?.full_name ?? '',
        avatar_url: data?.avatar_url ?? '',
        job_title: data?.job_title ?? '',
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Profile card read request failed');
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
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = accountProfilePatchSchema.safeParse(body);
    if (!parsed.success) {
      // Key names only (SA-D2-6): never the body, never the issues, because an
      // over-long name is exactly what arrives here.
      requestLogger.info({ userId: user.id, fields: topLevelKeys(body) }, 'Profile card update refused');
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const validated = parsed.data;

    const fields = Object.keys(validated);
    requestLogger.info({ userId: user.id, fields }, 'Profile card update requested');

    const { error } = await userProfileRepository.saveSettingsCard(user.id, validated);
    if (error) {
      requestLogger.error({ userId: user.id, fields, err: error }, 'Profile card save failed');
      return NextResponse.json({ success: false, error: 'Failed to save the profile' }, { status: 500 });
    }

    // Field names only: no `changes`, no values (C-17).
    auditTrail
      .log({
        action: AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        details: { fields },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // The saved (trimmed) fields, so the page can show exactly what was stored.
    return NextResponse.json({ success: true, data: validated });
  } catch (error) {
    requestLogger.error({ err: error }, 'Profile card update request failed');
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
      { status: 500 }
    );
  }
}
