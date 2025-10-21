// app/api/admin/users/[id]/login-stats/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const userId = params.id;

    // Get login statistics from audit_trail table
    const { data: auditLogs, error: auditError } = await supabase
      .from('audit_trail')
      .select('action, ip_address, created_at')
      .eq('user_id', userId)
      .or('action.eq.USER_LOGIN,action.eq.USER_LOGIN_FAILED');

    if (auditError) {
      console.error('Error fetching audit logs:', auditError);
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
    console.error('Error in GET /api/admin/users/[id]/login-stats:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
