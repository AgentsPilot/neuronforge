// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all'; // all, active, inactive
    const sortBy = searchParams.get('sortBy') || 'created_at';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    console.log('Admin users API called with params:', { search, status, sortBy, sortOrder });

    // Fetch users from auth.users with profiles data
    let query = supabase
      .from('profiles')
      .select('*')
      .order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply search filter
    if (search && search.trim() !== '') {
      query = query.or(`
        full_name.ilike.%${search}%,
        company.ilike.%${search}%,
        id.ilike.%${search}%
      `);
    }

    const { data: profiles, error: profilesError } = await query.limit(1000);

    if (profilesError) {
      console.error('Database query error:', profilesError);
      return NextResponse.json({
        error: 'Failed to fetch users',
        details: profilesError.message
      }, { status: 500 });
    }

    console.log(`Fetched ${profiles?.length || 0} user profiles`);

    // Enrich with auth metadata (email, last_sign_in, etc.)
    let enrichedUsers = profiles || [];

    if (profiles && profiles.length > 0) {
      try {
        // Fetch from auth.users using admin API
        const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();

        if (!authError && authUsers) {
          // Create a map for quick lookup
          const authUsersMap = new Map(authUsers.users.map(u => [u.id, u]));

          enrichedUsers = profiles.map(profile => {
            const authUser = authUsersMap.get(profile.id);
            return {
              ...profile,
              email: authUser?.email || 'N/A',
              email_confirmed: authUser?.email_confirmed_at ? true : false,
              last_sign_in_at: authUser?.last_sign_in_at || null,
              created_at: authUser?.created_at || profile.created_at,
              updated_at: authUser?.updated_at || profile.updated_at,
              phone: authUser?.phone || null,
              providers: authUser?.app_metadata?.providers || [],
              role: authUser?.role || 'authenticated',
            };
          });

          console.log(`Enriched ${enrichedUsers.length} users with auth data`);
        }
      } catch (enrichError) {
        console.log('Could not enrich with auth data, continuing with profile data:', enrichError);
      }
    }

    // Apply status filter
    let filteredUsers = enrichedUsers;
    if (status === 'active') {
      // Consider users active if they've signed in within the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filteredUsers = enrichedUsers.filter(u =>
        u.last_sign_in_at && new Date(u.last_sign_in_at) > thirtyDaysAgo
      );
    } else if (status === 'inactive') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filteredUsers = enrichedUsers.filter(u =>
        !u.last_sign_in_at || new Date(u.last_sign_in_at) <= thirtyDaysAgo
      );
    }

    // Calculate stats
    const stats = {
      totalUsers: filteredUsers.length,
      activeUsers: enrichedUsers.filter(u => {
        if (!u.last_sign_in_at) return false;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return new Date(u.last_sign_in_at) > thirtyDaysAgo;
      }).length,
      newUsersToday: enrichedUsers.filter(u => {
        if (!u.created_at) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return new Date(u.created_at) >= today;
      }).length,
    };

    console.log(`Successfully processed ${filteredUsers.length} users`);

    return NextResponse.json({
      success: true,
      data: filteredUsers,
      stats,
      pagination: {
        total: filteredUsers.length,
        page: 1,
        limit: 1000
      }
    });

  } catch (error) {
    console.error('Admin users API error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Health check endpoint
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
