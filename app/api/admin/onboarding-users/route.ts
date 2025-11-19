import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

/**
 * GET /api/admin/onboarding-users
 * Fetch all users with their onboarding status and quotas
 */
export async function GET(request: NextRequest) {
  try {
    // Get filter from query params
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';

    // Get users with their profile and subscription data
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, company, job_title, onboarding_goal, onboarding_mode, role, onboarding, created_at')
      .order('created_at', { ascending: false });

    if (profilesError) throw profilesError;

    // Get subscription data
    const { data: subscriptions, error: subsError } = await supabase
      .from('user_subscriptions')
      .select('user_id, balance, storage_quota_mb, executions_quota');

    if (subsError) throw subsError;

    // Get auth users for email using admin API
    const { data: { users: authUsers }, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) throw authError;

    // Combine the data
    let combinedUsers = (profiles || []).map(profile => {
      const authUser = authUsers?.find(u => u.id === profile.id);
      const subscription = subscriptions?.find(s => s.user_id === profile.id);

      return {
        id: profile.id,
        email: authUser?.email || 'N/A',
        full_name: profile.full_name || 'N/A',
        created_at: profile.created_at,
        onboarding_completed: profile.onboarding || false,
        company: profile.company,
        job_title: profile.job_title,
        onboarding_goal: profile.onboarding_goal,
        onboarding_mode: profile.onboarding_mode,
        role: profile.role,
        balance: subscription?.balance,
        storage_quota_mb: subscription?.storage_quota_mb,
        executions_quota: subscription?.executions_quota,
      };
    });

    // Apply filter
    if (filter === 'completed') {
      combinedUsers = combinedUsers.filter(u => u.onboarding_completed);
    } else if (filter === 'incomplete') {
      combinedUsers = combinedUsers.filter(u => !u.onboarding_completed);
    }

    // Calculate stats
    const stats = {
      total: profiles?.length || 0,
      completed: profiles?.filter(p => p.onboarding).length || 0,
      incomplete: profiles?.filter(p => !p.onboarding).length || 0,
    };

    console.log('[API] Fetched onboarding users:', {
      total: combinedUsers.length,
      filter,
      stats
    });

    return NextResponse.json({
      success: true,
      data: combinedUsers,
      stats
    });

  } catch (error) {
    console.error('[API] Error fetching onboarding users:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch users'
      },
      { status: 500 }
    );
  }
}
