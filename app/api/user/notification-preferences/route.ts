// /app/api/user/notification-preferences/route.ts
// User notification preferences management with audit logging

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
 * GET /api/user/notification-preferences - Get notification preferences
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

    // Create service role client
    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch preferences (or create default if doesn't exist)
    let { data: preferences, error } = await serviceSupabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      // No preferences found - create default
      const defaultPreferences = {
        user_id: user.id,
        email_enabled: true,
        email_frequency: 'immediate',
        email_agent_updates: true,
        email_system_alerts: true,
        email_security_alerts: true,
        email_marketing: false,
        push_enabled: false,
        push_agent_updates: true,
        push_system_alerts: true,
        push_mentions: true,
        desktop_enabled: true,
        desktop_agent_updates: true,
        desktop_system_alerts: true,
        inapp_enabled: true,
        inapp_sounds: true,
        inapp_popups: true,
        quiet_hours_enabled: false,
        quiet_hours_start: '22:00:00',
        quiet_hours_end: '08:00:00',
        quiet_hours_timezone: 'UTC',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: created, error: createError } = await serviceSupabase
        .from('notification_settings')
        .insert(defaultPreferences)
        .select()
        .single();

      if (createError) {
        console.error('Failed to create default preferences:', createError);
        return NextResponse.json(
          { error: 'Failed to create preferences', details: createError.message },
          { status: 500 }
        );
      }

      preferences = created;
    } else if (error) {
      console.error('Failed to fetch preferences:', error);
      return NextResponse.json(
        { error: 'Failed to fetch preferences', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      preferences,
    });

  } catch (error: any) {
    console.error('Error fetching notification preferences:', error);
    return NextResponse.json(
      { error: 'Failed to fetch preferences', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/notification-preferences - Update notification preferences
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();

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

    console.log(`🔔 [NOTIFICATIONS] User ${user.id} updating notification preferences`);

    // Create service role client
    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch current preferences for audit trail
    const { data: currentPreferences, error: fetchError } = await serviceSupabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (fetchError) {
      console.error('Failed to fetch current preferences:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch current preferences', details: fetchError.message },
        { status: 500 }
      );
    }

    // Prepare update data
    const updateData: any = {
      ...body,
      updated_at: new Date().toISOString(),
    };

    // Remove fields that shouldn't be updated
    delete updateData.user_id;
    delete updateData.id;
    delete updateData.created_at;

    // Update preferences
    const { data: updatedPreferences, error: updateError } = await serviceSupabase
      .from('notification_settings')
      .update(updateData)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update preferences:', updateError);
      return NextResponse.json(
        { error: 'Failed to update preferences', details: updateError.message },
        { status: 500 }
      );
    }

    console.log(`✅ [NOTIFICATIONS] Notification preferences updated for user ${user.id}`);

    // AUDIT TRAIL: Log notification preferences update with change tracking
    try {
      const changes = generateDiff(currentPreferences, updatedPreferences);
      const hasChanges = changes && Object.keys(changes).length > 0;

      if (hasChanges) {
        await auditLog({
          action: AUDIT_EVENTS.SETTINGS_NOTIFICATIONS_UPDATED,
          entityType: 'settings',
          entityId: user.id,
          userId: user.id,
          resourceName: 'Notification Settings',
          changes, // Before/after for each changed setting
          details: {
            settings_changed: Object.keys(changes),
            timestamp: new Date().toISOString(),
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
            user_agent: req.headers.get('user-agent') || 'unknown',
          },
          severity: 'info',
          complianceFlags: ['GDPR'], // Notification settings are user preferences
        });
        console.log('✅ Notification preferences update audited');
      }
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    return NextResponse.json({
      success: true,
      message: 'Notification preferences updated successfully',
      preferences: updatedPreferences,
    });

  } catch (error: any) {
    console.error('Error updating notification preferences:', error);
    return NextResponse.json(
      { error: 'Failed to update preferences', message: error.message },
      { status: 500 }
    );
  }
}
