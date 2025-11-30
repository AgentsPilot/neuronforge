// /app/api/user/profile/route.ts
// User profile management with audit logging

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { generateDiff } from '@/lib/audit/diff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/user/profile - Get user profile
 */
export async function GET(req: NextRequest) {
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
      console.error('Failed to fetch profile:', error);
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
    console.error('Error fetching profile:', error);
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`👤 [PROFILE UPDATE] User ${user.id} updating profile`);

    // Fetch current profile for audit trail
    const { data: currentProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (fetchError) {
      console.error('Failed to fetch current profile:', fetchError);
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
    if (role !== undefined) updateData.role = role;
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
      console.error('Failed to update profile:', updateError);
      return NextResponse.json(
        { error: 'Failed to update profile', details: updateError.message },
        { status: 500 }
      );
    }

    console.log(`✅ [PROFILE UPDATE] Profile updated for user ${user.id}`);

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
        console.log('✅ Profile update audited');
      }
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      profile: updatedProfile,
    });

  } catch (error: any) {
    console.error('Error updating profile:', error);
    return NextResponse.json(
      { error: 'Failed to update profile', message: error.message },
      { status: 500 }
    );
  }
}
