// /app/api/user/change-password/route.ts
// User password change with security audit logging

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change user password with security audit trail
 *
 * Security Requirements:
 * - Requires current password verification
 * - Minimum 6 characters for new password
 * - Logs all password change attempts (successful and failed)
 * - SOC2 compliance logging
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { currentPassword, newPassword } = body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          message: 'Both current password and new password are required',
        },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        {
          error: 'Password too short',
          message: 'New password must be at least 6 characters long',
        },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        {
          error: 'Same password',
          message: 'New password must be different from current password',
        },
        { status: 400 }
      );
    }

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

    console.log(`🔐 [PASSWORD CHANGE] User ${user.id} attempting password change`);

    // Verify current password by attempting to sign in
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });

    if (verifyError) {
      console.log(`❌ [PASSWORD CHANGE] Current password verification failed for user ${user.id}`);

      // AUDIT TRAIL: Log failed password change attempt
      try {
        await auditLog({
          action: 'USER_PASSWORD_CHANGE_FAILED',
          entityType: 'user',
          entityId: user.id,
          userId: user.id,
          resourceName: user.email || 'User',
          details: {
            timestamp: new Date().toISOString(),
            reason: 'Current password verification failed',
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
            user_agent: req.headers.get('user-agent') || 'unknown',
          },
          severity: 'warning',
          complianceFlags: ['SOC2'],
        });
        console.log('✅ Failed password change attempt audited');
      } catch (auditError) {
        console.error('⚠️ Audit logging failed (non-critical):', auditError);
      }

      return NextResponse.json(
        {
          error: 'Invalid password',
          message: 'Current password is incorrect',
        },
        { status: 401 }
      );
    }

    // Update password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      console.error(`❌ [PASSWORD CHANGE] Password update failed for user ${user.id}:`, updateError);

      // AUDIT TRAIL: Log failed password change
      try {
        await auditLog({
          action: 'USER_PASSWORD_CHANGE_FAILED',
          entityType: 'user',
          entityId: user.id,
          userId: user.id,
          resourceName: user.email || 'User',
          details: {
            timestamp: new Date().toISOString(),
            reason: updateError.message,
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
            user_agent: req.headers.get('user-agent') || 'unknown',
          },
          severity: 'warning',
          complianceFlags: ['SOC2'],
        });
      } catch (auditError) {
        console.error('⚠️ Audit logging failed (non-critical):', auditError);
      }

      return NextResponse.json(
        {
          error: 'Password update failed',
          message: updateError.message,
        },
        { status: 500 }
      );
    }

    console.log(`✅ [PASSWORD CHANGE] Password updated successfully for user ${user.id}`);

    // AUDIT TRAIL: Log successful password change
    try {
      await auditLog({
        action: AUDIT_EVENTS.USER_PASSWORD_CHANGED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: user.email || 'User',
        details: {
          timestamp: new Date().toISOString(),
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
          // Never log actual passwords
        },
        severity: 'warning', // Security change = warning level
        complianceFlags: ['SOC2'],
      });
      console.log('✅ Password change audited');
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    });

  } catch (error: any) {
    console.error('❌ [PASSWORD CHANGE] Unexpected error:', error);

    return NextResponse.json(
      {
        error: 'Password change failed',
        message: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
