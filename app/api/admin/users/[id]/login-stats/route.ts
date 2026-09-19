// app/api/admin/users/[id]/login-stats/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { createLogger } from '@/lib/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const logger = createLogger({ module: 'AdminUserLoginStatsAPI' });
const ROUTE = '/api/admin/users/[id]/login-stats';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Admin only (Layer 3 step 0, Q-3). Middleware does not protect /api, and
    // this route reads every account's audit rows with the service role, so it
    // gates itself: 401 signed out, 403 not an admin. Admin identity comes from
    // AdminAccessService (the admin_users table), never a user-writable role.
    const adminUser = await getUser();
    if (!adminUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    let isAdmin = false;
    try {
      isAdmin = await AdminAccessService.getInstance().isAdmin({ id: adminUser.id, email: adminUser.email });
    } catch (err) {
      // Fail closed: an admin check that cannot answer is a "no".
      logger.error({ err, userId: adminUser.id }, 'Admin check threw; denying access');
    }
    if (!isAdmin) {
      logger.warn({ userId: adminUser.id, route: ROUTE }, 'Non-admin attempted to read audit data');
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const userId = params.id;

    // Get login statistics from audit_trail table
    const { data: auditLogs, error: auditError } = await supabase
      .from('audit_trail')
      .select('action, ip_address, created_at')
      .eq('user_id', userId)
      .or('action.eq.USER_LOGIN,action.eq.USER_LOGIN_FAILED');

    if (auditError) {
      logger.error({ err: auditError, targetUserId: userId }, 'Fetching login audit logs failed');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch login statistics' },
        { status: 500 }
      );
    }

    // Calculate statistics
    const totalLogins = auditLogs?.filter((log: any) => log.action === 'USER_LOGIN').length || 0;
    const failedLogins = auditLogs?.filter((log: any) => log.action === 'USER_LOGIN_FAILED').length || 0;

    const uniqueIps = new Set(
      auditLogs
        ?.filter((log: any) => log.ip_address)
        .map((log: any) => log.ip_address)
    ).size;

    const lastLoginLog = auditLogs
      ?.filter((log: any) => log.action === 'USER_LOGIN')
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    const stats = {
      total_logins: totalLogins,
      failed_logins: failedLogins,
      unique_ips: uniqueIps,
      last_login_ip: lastLoginLog?.ip_address || null,
      last_login_at: lastLoginLog?.created_at || null,
    };

    return NextResponse.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error({ err: error }, 'Admin user login-stats request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
