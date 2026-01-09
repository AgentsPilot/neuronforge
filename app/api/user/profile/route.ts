// /app/api/user/profile/route.ts
// User profile management with audit logging

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createLogger } from '@/lib/logger';
import { UserProfileRepository, UpdateUserProfileInput } from '@/lib/repositories';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { generateDiff } from '@/lib/audit/diff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'API', route: '/api/user/profile' });

/**
 * GET /api/user/profile - Get user profile
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, method: 'GET' });
  const startTime = Date.now();

  requestLogger.info('Profile fetch request received');

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
      requestLogger.warn({ authError: authError?.message }, 'Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    requestLogger.debug({ userId: user.id }, 'User authenticated');

    // Use repository with authenticated client
    const profileRepo = new UserProfileRepository(supabase);
    const { data: profile, error } = await profileRepo.findById(user.id);

    if (error) {
      const duration = Date.now() - startTime;
      requestLogger.error({ err: error, userId: user.id, duration }, 'Failed to fetch profile');
      return NextResponse.json(
        { error: 'Failed to fetch profile', details: error.message },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    requestLogger.info({ userId: user.id, duration }, 'Profile fetched successfully');

    return NextResponse.json({
      success: true,
      profile: {
        ...profile,
        email: user.email, // Include email from auth
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Unexpected error fetching profile');
    return NextResponse.json(
      { error: 'Failed to fetch profile', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/profile - Update user profile
 */
export async function PUT(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, method: 'PUT' });
  const startTime = Date.now();

  requestLogger.info('Profile update request received');

  try {
    const body = await req.json();
    const { full_name, company, role, avatar_url, bio, timezone, language } = body;

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
      requestLogger.warn({ authError: authError?.message }, 'Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    requestLogger.debug({ userId: user.id }, 'User authenticated');

    // Use repository with authenticated client
    const profileRepo = new UserProfileRepository(supabase);

    // Build update input (only include provided fields)
    const updateInput: UpdateUserProfileInput = {};
    if (full_name !== undefined) updateInput.full_name = full_name;
    if (company !== undefined) updateInput.company = company;
    if (role !== undefined) updateInput.role = role;
    if (avatar_url !== undefined) updateInput.avatar_url = avatar_url;
    if (bio !== undefined) updateInput.bio = bio;
    if (timezone !== undefined) updateInput.timezone = timezone;
    if (language !== undefined) updateInput.language = language;

    const fieldsToUpdate = Object.keys(updateInput);
    requestLogger.debug({ userId: user.id, fieldsToUpdate }, 'Updating profile fields');

    // Update profile - repository returns both current and previous state
    const { data, error: updateError } = await profileRepo.update(user.id, updateInput);

    if (updateError || !data) {
      const duration = Date.now() - startTime;
      requestLogger.error({ err: updateError, userId: user.id, duration }, 'Failed to update profile');
      return NextResponse.json(
        { error: 'Failed to update profile', details: updateError?.message },
        { status: 500 }
      );
    }

    const { profile: updatedProfile, previousProfile } = data;

    const duration = Date.now() - startTime;
    requestLogger.info({ userId: user.id, fieldsUpdated: fieldsToUpdate, duration }, 'Profile updated successfully');

    // AUDIT TRAIL: Log profile update with change tracking
    try {
      const changes = generateDiff(previousProfile, updatedProfile);

      if (changes && Object.keys(changes).length > 0) {
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
        requestLogger.debug({ userId: user.id, changedFields: Object.keys(changes) }, 'Profile update audited');
      }
    } catch (auditError) {
      requestLogger.warn({ err: auditError, userId: user.id }, 'Audit logging failed (non-critical)');
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      profile: updatedProfile,
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Unexpected error updating profile');
    return NextResponse.json(
      { error: 'Failed to update profile', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
