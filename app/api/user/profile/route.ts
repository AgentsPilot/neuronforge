// /app/api/user/profile/route.ts
// User profile management with audit logging

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { generateDiff } from '@/lib/audit/diff';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UserProfileAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/user/profile - Get user profile
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Authenticate user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch profile
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to fetch profile');
      return NextResponse.json(
        { error: 'Failed to fetch profile', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      profile: {
        ...profile,
        email: user.email, // Include email from auth
      },
    });

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Error fetching profile');
    return NextResponse.json(
      { error: 'Failed to fetch profile', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/profile - Update user profile
 */
export async function PUT(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await req.json();

    /*
     * `role` is deliberately NOT read from the body.
     *
     * This route writes with a user-scoped (anon-key) client, so it writes with
     * the caller's own privileges — and the `profiles` UPDATE policy is
     * `USING (auth.uid() = id)` with no WITH CHECK and no column restriction.
     * Accepting `role` here therefore let any signed-in user PUT
     * `{ "role": "admin" }` at their own profile. Nothing authorizes on
     * `profiles.role` today, so nothing was exploitable — but the column looks
     * exactly like an authorization field, and the next `WHERE role = 'admin'`
     * anyone writes would make it one. Admin identity is `admin_users` via
     * AdminAccessService (docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md).
     *
     * Ignored rather than rejected, on purpose: every other column this route
     * does not list (`job_title`, `domain`, `onboarding_*`) is already dropped
     * without complaint, so a 400 here would make `role` the one field that
     * fails a save instead of skipping it — and it would break the save the
     * user actually asked for (their name, their timezone) over a field they
     * never touched. Silent to the client, logged for us.
     *
     * The database enforces the same rule underneath every write path, not just
     * this one — see
     * supabase/migrations/20261002_profiles_role_privilege_guard.sql. That
     * matters, because the settings UI writes `profiles` directly and never
     * reaches this route at all.
     */
    const { full_name, company, avatar_url, bio, timezone, language } = body;

    // Authenticate user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    requestLogger.info({ userId: user.id }, 'Updating profile');

    if (body.role !== undefined) {
      requestLogger.warn(
        { userId: user.id, attemptedRole: body.role },
        'Ignoring `role` in profile update body — not a user-settable field'
      );
    }

    // Fetch current profile for audit trail
    const { data: currentProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (fetchError) {
      requestLogger.error({ err: fetchError, userId: user.id }, 'Failed to fetch current profile');
      return NextResponse.json(
        { error: 'Failed to fetch current profile', details: fetchError.message },
        { status: 500 }
      );
    }

    // Prepare update data (only include provided fields)
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (full_name !== undefined) updateData.full_name = full_name;
    if (company !== undefined) updateData.company = company;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;
    if (bio !== undefined) updateData.bio = bio;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (language !== undefined) updateData.language = language;

    // Update profile
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      requestLogger.error({ err: updateError, userId: user.id }, 'Failed to update profile');
      return NextResponse.json(
        { error: 'Failed to update profile', details: updateError.message },
        { status: 500 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Profile updated');

    /*
     * The timezone lives in TWO columns, and both are read.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * `profiles.timezone` is what this route writes and what the Business OS
     * scheduling dialog reads. `user_preferences.timezone` is what the settings
     * page writes and what everything else reads: the availability API, the
     * booking routes, every client-facing email, and the language provider that
     * now supplies the clock to every screen.
     *
     * Nothing kept them in step, so they drifted. At the time of writing three
     * accounts had `profiles = Asia/Jerusalem` while `user_preferences = UTC` —
     * an owner in Israel whose confirmation emails went out on UTC.
     *
     * Writing both here is the same remedy the language already uses in
     * `LanguageContext`, which dual-writes `user_preferences` and
     * `business_profiles` for exactly this reason. Non-blocking: a failure to
     * mirror must not fail the profile save the user actually asked for, but it
     * must be loud, because a silent half-write is how the two drifted apart in
     * the first place.
     */
    if (timezone !== undefined) {
      await supabase
        .from('user_preferences')
        .upsert(
          { user_id: user.id, timezone, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        )
        .then(({ error: mirrorError }) => {
          if (mirrorError) {
            requestLogger.error(
              { err: mirrorError, userId: user.id },
              'Failed to mirror timezone to user_preferences'
            );
          }
        });
    }

    // AUDIT TRAIL: Log profile update with change tracking
    try {
      const changes = generateDiff(currentProfile, updatedProfile);
      const hasChanges = Object.keys(changes).length > 0;

      if (hasChanges) {
        await auditLog({
          action: AUDIT_EVENTS.PROFILE_UPDATED,
          entityType: 'profile',
          entityId: user.id,
          userId: user.id,
          resourceName: updatedProfile.full_name || user.email || 'User Profile',
          changes, // Before/after for each changed field
          details: {
            fields_changed: Object.keys(changes),
            timestamp: new Date().toISOString(),
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
            user_agent: req.headers.get('user-agent') || 'unknown',
          },
          severity: 'info',
          complianceFlags: ['GDPR'], // Profile contains PII
        });
        requestLogger.debug({ userId: user.id }, 'Profile update audited');
      }
    } catch (auditError) {
      requestLogger.error({ err: auditError, userId: user.id }, 'Audit logging failed (non-critical)');
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      profile: updatedProfile,
    });

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Error updating profile');
    return NextResponse.json(
      { error: 'Failed to update profile', message: error.message },
      { status: 500 }
    );
  }
}
