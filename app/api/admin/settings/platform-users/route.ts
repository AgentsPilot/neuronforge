import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'PlatformUsersAPI' });

// GET - Fetch all platform users (for admin user selection)
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchQuery = request.nextUrl.searchParams.get('search') || '';

    requestLogger.info({ userId: user.id, search: searchQuery }, 'Fetching platform users');

    // Fetch all auth users
    const { data: authUsersData, error: authError } = await supabaseServer.auth.admin.listUsers();

    if (authError) {
      requestLogger.error({ err: authError }, 'Failed to fetch auth users');
      throw authError;
    }

    const authUsers = authUsersData?.users || [];

    // Get profile data for full names
    const userIds = authUsers.map(u => u.id);
    const { data: profiles } = await supabaseServer
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    // Get existing admin user IDs to mark them
    const { data: adminConfig } = await supabaseServer
      .from('system_settings_config')
      .select('value')
      .eq('key', 'admin_users')
      .single();

    const adminUserIds = (adminConfig?.value || []).map((a: { user_id: string }) => a.user_id);

    // Combine data and filter
    let users = authUsers
      .filter(u => !u.email?.includes('@neuronforge.internal')) // Exclude system users
      .map(authUser => {
        const profile = profiles?.find(p => p.id === authUser.id);
        return {
          id: authUser.id,
          email: authUser.email || '',
          full_name: profile?.full_name || '',
          created_at: authUser.created_at,
          is_admin: adminUserIds.includes(authUser.id)
        };
      });

    // Apply search filter if provided
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      users = users.filter(u =>
        u.email.toLowerCase().includes(query) ||
        u.full_name.toLowerCase().includes(query)
      );
    }

    // Sort by email
    users.sort((a, b) => a.email.localeCompare(b.email));

    return NextResponse.json({
      success: true,
      users,
      total: users.length
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch platform users');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
