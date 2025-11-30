// /app/api/user/change-email/route.ts
// User email change with security audit logging

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change user email with security audit trail
 *
 * Security Requirements:
 * - Requires password verification
 * - Sends confirmation email to new address
 * - Logs all email change attempts
 * - SOC2 compliance logging
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { newEmail, password } = body;

    // Validate input
    if (!newEmail || !password) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          message: 'Both new email and password are required',
        },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return NextResponse.json(
        {
          error: 'Invalid email',
          message: 'Please provide a valid email address',
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

    const oldEmail = user.email;

    if (newEmail === oldEmail) {
      return NextResponse.json(
        {
          error: 'Same email',
          message: 'New email is the same as current email',
        },
        { status: 400 }
      );
    }

    console.log(`📧 [EMAIL CHANGE] User ${user.id} attempting to change email from ${oldEmail} to ${newEmail}`);

    // Verify password by attempting to sign in
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: oldEmail!,
      password: password,
    });

    if (verifyError) {
      console.log(`❌ [EMAIL CHANGE] Password verification failed for user ${user.id}`);

      // AUDIT TRAIL: Log failed email change attempt
      try {
        await auditLog({
          action: 'USER_EMAIL_CHANGE_FAILED',
          entityType: 'user',
          entityId: user.id,
          userId: user.id,
          resourceName: oldEmail || 'User',
          details: {
            timestamp: new Date().toISOString(),
            reason: 'Password verification failed',
            attempted_new_email: newEmail,
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
            user_agent: req.headers.get('user-agent') || 'unknown',
          },
          severity: 'warning',
          complianceFlags: ['SOC2'],
        });
        console.log('✅ Failed email change attempt audited');
      } catch (auditError) {
        console.error('⚠️ Audit logging failed (non-critical):', auditError);
      }

      return NextResponse.json(
        {
          error: 'Invalid password',
          message: 'Password is incorrect',
        },
        { status: 401 }
      );
    }

    // Update email (sends confirmation email to new address)
    const { error: updateError } = await supabase.auth.updateUser({
      email: newEmail,
    });

    if (updateError) {
      console.error(`❌ [EMAIL CHANGE] Email update failed for user ${user.id}:`, updateError);

      // AUDIT TRAIL: Log failed email change
      try {
        await auditLog({
          action: 'USER_EMAIL_CHANGE_FAILED',
          entityType: 'user',
          entityId: user.id,
          userId: user.id,
          resourceName: oldEmail || 'User',
          details: {
            timestamp: new Date().toISOString(),
            reason: updateError.message,
            attempted_new_email: newEmail,
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
          error: 'Email update failed',
          message: updateError.message,
        },
        { status: 500 }
      );
    }

    console.log(`✅ [EMAIL CHANGE] Email change initiated for user ${user.id}`);

    // AUDIT TRAIL: Log email change request (before confirmation)
    try {
      await auditLog({
        action: AUDIT_EVENTS.USER_EMAIL_CHANGED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: oldEmail || 'User',
        changes: {
          before: { email: oldEmail },
          after: { email: newEmail },
        },
        details: {
          timestamp: new Date().toISOString(),
          old_email: oldEmail,
          new_email: newEmail,
          status: 'pending_confirmation',
          confirmation_sent_to: newEmail,
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
        },
        severity: 'warning', // Security change = warning level
        complianceFlags: ['SOC2', 'GDPR'], // Email is PII
      });
      console.log('✅ Email change request audited');
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    return NextResponse.json({
      success: true,
      message: 'Confirmation email sent to new address. Please check your email to confirm the change.',
      pendingConfirmation: true,
    });

  } catch (error: any) {
    console.error('❌ [EMAIL CHANGE] Unexpected error:', error);

    return NextResponse.json(
      {
        error: 'Email change failed',
        message: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
