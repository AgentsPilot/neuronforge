// /app/api/user/data-export/route.ts
// GDPR Article 15 & 20: Right to access and data portability

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Export all user data in machine-readable format (GDPR compliance)
 *
 * GDPR Requirements:
 * - Article 15: Right to access personal data
 * - Article 20: Right to data portability
 * - Format: JSON (machine-readable)
 * - Scope: All personal data held by the platform
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();

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

    console.log(`📦 [DATA EXPORT] Starting data export for user: ${user.id}`);

    // Create service role client for unrestricted access
    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Collect all user data from all tables
    const exportData: any = {
      export_metadata: {
        user_id: user.id,
        export_date: new Date().toISOString(),
        export_format: 'JSON',
        gdpr_article: 'Article 15 (Right to Access) & Article 20 (Data Portability)',
        data_controller: 'NeuronForge',
      },
      user_profile: {},
      agents: [],
      agent_executions: [],
      agent_configurations: [],
      plugin_connections: [],
      subscriptions: [],
      transactions: [],
      audit_logs: [],
    };

    // 1. User Profile Data
    const { data: profile } = await serviceSupabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    exportData.user_profile = {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      ...profile,
    };

    // 2. Agents Data
    const { data: agents } = await serviceSupabase
      .from('agents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    exportData.agents = agents || [];

    // 3. Agent Executions (last 90 days for reasonable size)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: executions } = await serviceSupabase
      .from('agent_executions')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', ninetyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(1000); // Limit to prevent massive exports

    exportData.agent_executions = executions || [];

    // 4. Agent Configurations
    const { data: configurations } = await serviceSupabase
      .from('agent_configurations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    exportData.agent_configurations = configurations || [];

    // 5. Plugin Connections (sensitive - credentials excluded)
    const { data: connections } = await serviceSupabase
      .from('plugin_connections')
      .select('user_id, plugin_key, created_at, updated_at, metadata')
      .eq('user_id', user.id);

    exportData.plugin_connections = (connections || []).map(conn => ({
      plugin_key: conn.plugin_key,
      connected_at: conn.created_at,
      last_updated: conn.updated_at,
      metadata: conn.metadata,
      // Credentials excluded for security
    }));

    // 6. Subscription & Billing Data
    const { data: subscription } = await serviceSupabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    exportData.subscriptions = subscription ? [subscription] : [];

    // 7. Credit Transactions (last 12 months)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const { data: transactions } = await serviceSupabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', oneYearAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(5000);

    exportData.transactions = transactions || [];

    // 8. Audit Logs (last 90 days, user-specific actions only)
    const { data: auditLogs } = await serviceSupabase
      .from('audit_trail')
      .select('*')
      .eq('user_id', user.id)
      .gte('timestamp', ninetyDaysAgo.toISOString())
      .order('timestamp', { ascending: false })
      .limit(10000);

    exportData.audit_logs = auditLogs || [];

    // 9. Summary Statistics
    exportData.summary = {
      total_agents: exportData.agents.length,
      total_executions: exportData.agent_executions.length,
      total_configurations: exportData.agent_configurations.length,
      total_plugin_connections: exportData.plugin_connections.length,
      total_transactions: exportData.transactions.length,
      total_audit_logs: exportData.audit_logs.length,
      export_size_kb: Math.round(JSON.stringify(exportData).length / 1024),
      export_duration_ms: Date.now() - startTime,
    };

    console.log(`✅ [DATA EXPORT] Export completed:`, exportData.summary);

    // AUDIT TRAIL: Log data export
    try {
      await auditLog({
        action: AUDIT_EVENTS.DATA_EXPORTED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: user.email || 'User Data',
        details: {
          export_timestamp: new Date().toISOString(),
          export_format: 'JSON',
          data_categories: Object.keys(exportData).filter(k => k !== 'export_metadata' && k !== 'summary'),
          summary: exportData.summary,
          gdpr_basis: 'Article 15 (Right to Access) & Article 20 (Data Portability)',
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
        },
        severity: 'info',
        complianceFlags: ['GDPR', 'SOC2'],
      });
      console.log('✅ Data export audit logged');
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    // Return data as downloadable JSON
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="neuronforge-data-export-${user.id}-${Date.now()}.json"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });

  } catch (error: any) {
    console.error('❌ [DATA EXPORT] Failed:', error);

    return NextResponse.json(
      {
        error: 'Data export failed',
        message: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
