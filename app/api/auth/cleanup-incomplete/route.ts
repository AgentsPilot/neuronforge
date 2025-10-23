// app/api/auth/cleanup-incomplete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// This endpoint is called by Vercel Cron to clean up users who haven't completed onboarding within 24 hours
// Configured in vercel.json to run daily at 2 AM

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Verify the request is from Vercel Cron
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('❌ CRON_SECRET not configured');
      return NextResponse.json(
        { success: false, error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.error('❌ Invalid authorization for cleanup job');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Use service role to bypass RLS and access auth.users
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    console.log('🧹 Starting cleanup of incomplete onboarding users...');

    // Get all users from auth.users
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch users' },
        { status: 500 }
      );
    }

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    let deletedCount = 0;
    let skippedCount = 0;
    const deletedUsers: string[] = [];
    const errors: string[] = [];

    console.log(`📊 Total users to check: ${users.length}`);

    for (const user of users) {
      const createdAt = new Date(user.created_at);
      const onboardingCompleted = user.user_metadata?.onboarding_completed;

      // Skip if onboarding is completed
      if (onboardingCompleted === true) {
        skippedCount++;
        continue;
      }

      // Skip if user was created less than 24 hours ago (give them time)
      if (createdAt > twentyFourHoursAgo) {
        skippedCount++;
        continue;
      }

      // User created > 24 hours ago and onboarding not completed - delete
      const userAge = Math.round((now.getTime() - createdAt.getTime()) / (60 * 60 * 1000));
      console.log(`🗑️  Deleting user: ${user.email} (created ${userAge}h ago, onboarding: ${onboardingCompleted})`);

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

      if (deleteError) {
        console.error(`❌ Failed to delete user ${user.email}:`, deleteError);
        errors.push(`${user.email}: ${deleteError.message}`);
      } else {
        deletedCount++;
        deletedUsers.push(user.email || user.id);
        console.log(`✅ Deleted: ${user.email}`);
      }
    }

    const summary = {
      success: true,
      message: 'Cleanup completed successfully',
      timestamp: now.toISOString(),
      stats: {
        total_users_checked: users.length,
        deleted: deletedCount,
        kept: skippedCount,
        errors: errors.length
      },
      deleted_users: deletedUsers,
      errors: errors
    };

    console.log('✅ Cleanup complete:', JSON.stringify(summary.stats, null, 2));

    return NextResponse.json(summary);

  } catch (error: any) {
    console.error('❌ Cleanup job failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
