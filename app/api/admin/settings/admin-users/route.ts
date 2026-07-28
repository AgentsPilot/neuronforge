import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'AdminUsersAPI' });

// GET - Fetch all admin users
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

    requestLogger.info({ userId: user.id }, 'Fetching admin users');

    // Fetch admin users from system_settings_config
    const { data: adminConfig, error: configError } = await supabaseServer
      .from('system_settings_config')
      .select('value')
      .eq('key', 'admin_users')
      .single();

    if (configError && configError.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine for first setup
      requestLogger.error({ err: configError }, 'Failed to fetch admin config');
      throw configError;
    }

    let adminUserIds: Array<{ user_id: string; role: string; added_at: string; added_by?: string }> =
      adminConfig?.value || [];

    // If no admin users configured, auto-add the current user as super_admin (bootstrap)
    if (adminUserIds.length === 0) {
      requestLogger.info({ userId: user.id }, 'No admin users configured, bootstrapping current user as super_admin');

      // Get current user's profile (full_name only, email comes from auth user)
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('id, full_name')
        .eq('id', user.id)
        .single();

      const bootstrapAdmin = {
        user_id: user.id,
        role: 'super_admin',
        added_at: new Date().toISOString(),
        added_by: 'system_bootstrap'
      };

      // Save to database
      await supabaseServer
        .from('system_settings_config')
        .upsert({
          key: 'admin_users',
          value: [bootstrapAdmin],
          category: 'admin',
          description: 'List of admin users with access to the admin console',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'key'
        });

      // Return the bootstrapped admin (email from auth user object)
      return NextResponse.json({
        success: true,
        users: [{
          id: user.id,
          email: user.email || 'Unknown',
          full_name: profile?.full_name || '',
          role: 'super_admin',
          created_at: bootstrapAdmin.added_at,
          added_by: 'system_bootstrap'
        }]
      });
    }

    // Fetch user details from profiles (full_name only)
    const userIds = adminUserIds.map(a => a.user_id);
    const { data: profiles, error: profilesError } = await supabaseServer
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    if (profilesError) {
      requestLogger.error({ err: profilesError }, 'Failed to fetch profiles');
      throw profilesError;
    }

    // Fetch emails from auth.users via admin API
    const { data: authUsersData } = await supabaseServer.auth.admin.listUsers();
    const authUsers = authUsersData?.users || [];

    // Combine admin config with profile and auth data
    const users = adminUserIds.map(admin => {
      const profile = profiles?.find(p => p.id === admin.user_id);
      const authUser = authUsers.find(u => u.id === admin.user_id);
      return {
        id: admin.user_id,
        email: authUser?.email || 'Unknown',
        full_name: profile?.full_name || '',
        role: admin.role,
        created_at: admin.added_at,
        added_by: admin.added_by
      };
    });

    return NextResponse.json({
      success: true,
      users
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch admin users');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch admin users' },
      { status: 500 }
    );
  }
}

// POST - Add or remove admin users
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { action, email, role, userId } = body;

    requestLogger.info({ userId: user.id, action }, 'Admin user management action');

    // Fetch current admin users
    const { data: adminConfig, error: configError } = await supabaseServer
      .from('system_settings_config')
      .select('value')
      .eq('key', 'admin_users')
      .single();

    let adminUsers: Array<{ user_id: string; role: string; added_at: string; added_by?: string }> = [];

    if (!configError || configError.code === 'PGRST116') {
      adminUsers = adminConfig?.value || [];
    }

    if (action === 'add') {
      // Find user by email via auth admin API
      const { data: authUsersData } = await supabaseServer.auth.admin.listUsers();
      const targetAuthUser = authUsersData?.users?.find(u => u.email === email);

      if (!targetAuthUser) {
        return NextResponse.json(
          { success: false, error: 'User not found. They must have an account first.' },
          { status: 404 }
        );
      }

      const targetUser = { id: targetAuthUser.id, email: targetAuthUser.email };

      // Check if already admin
      if (adminUsers.some(a => a.user_id === targetUser.id)) {
        return NextResponse.json(
          { success: false, error: 'User is already an admin' },
          { status: 400 }
        );
      }

      // Add new admin
      adminUsers.push({
        user_id: targetUser.id,
        role: role || 'admin',
        added_at: new Date().toISOString(),
        added_by: user.id
      });

      requestLogger.info({ targetUserId: targetUser.id, role }, 'Adding admin user');

    } else if (action === 'remove') {
      // Prevent removing self (last super_admin protection)
      const currentUserAdmin = adminUsers.find(a => a.user_id === user.id);
      if (userId === user.id && currentUserAdmin?.role === 'super_admin') {
        const superAdminCount = adminUsers.filter(a => a.role === 'super_admin').length;
        if (superAdminCount <= 1) {
          return NextResponse.json(
            { success: false, error: 'Cannot remove the last super admin' },
            { status: 400 }
          );
        }
      }

      // Remove admin
      adminUsers = adminUsers.filter(a => a.user_id !== userId);
      requestLogger.info({ targetUserId: userId }, 'Removing admin user');

    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid action' },
        { status: 400 }
      );
    }

    // Save updated admin users
    const { error: updateError } = await supabaseServer
      .from('system_settings_config')
      .upsert({
        key: 'admin_users',
        value: adminUsers,
        category: 'admin',
        description: 'List of admin users with access to the admin console',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'key'
      });

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to update admin users');
      throw updateError;
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    requestLogger.error({ err: error }, 'Admin user management failed');
    return NextResponse.json(
      { success: false, error: 'Operation failed' },
      { status: 500 }
    );
  }
}
