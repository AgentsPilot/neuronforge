// /app/api/user/data-export/route.ts
// GDPR Article 15 & 20: Right to access and data portability
//
// Every read goes through a repository (CLAUDE.md rule 1;
// DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md), each a `...ForUserDataExport`
// / `listOwnerEntriesForExport` method keyed on the authenticated user's id.
// The repositories read with the service role (`supabaseServer`), as this route
// always has. A read error is ignored on purpose and gives an empty section,
// as before: the audit read fails on every export until FU-1 is fixed, so
// failing the route on it would break every export.
//
// BD-26 (user decision, 2026-10-04): the owner's export leaves out internal
// admin audit entries — every OWNER_HIDDEN_ENTITY_TYPES type and any Business
// OS AI action event — the same rule as the owner RLS policy and
// AuditTrailRepository.listOwnerEntries (lib/audit/ownerVisibility.ts). Both
// exclusions live in AuditTrailRepository.listOwnerEntriesForExport, kept
// there by a source guard (lib/audit/__tests__/ownerAuditReads.guard.test.ts).
//
// Known, deliberately unchanged here (workplan FU-1): the audit read filters
// on `timestamp`, a column that does not exist, so it exports no audit rows
// today.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';
import { agentRepository } from '@/lib/repositories/AgentRepository';
import { ExecutionRepository } from '@/lib/repositories/ExecutionRepository';
import { agentConfigurationRepository } from '@/lib/repositories/AgentConfigurationRepository';
import { pluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';
import { userSubscriptionRepository } from '@/lib/repositories/UserSubscriptionRepository';
import { creditTransactionRepository } from '@/lib/repositories/CreditTransactionRepository';
import { auditTrailRepository } from '@/lib/repositories/AuditTrailRepository';

const logger = createLogger({ module: 'UserDataExportAPI' });

// ExecutionRepository defaults to the browser anon client, which would export
// no executions under RLS; this read needs the service role like the others.
const executionRepository = new ExecutionRepository(supabaseServer);

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
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

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

    requestLogger.info({ userId: user.id }, 'Data export started');

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
    const { data: profile } = await userProfileRepository.findForUserDataExport(user.id);

    exportData.user_profile = {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      ...profile,
    };

    // 2. Agents Data
    const { data: agents } = await agentRepository.listForUserDataExport(user.id);

    exportData.agents = agents || [];

    // 3. Agent Executions (last 90 days for reasonable size)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // At most 1000 rows, to prevent massive exports.
    const { data: executions } = await executionRepository.listForUserDataExport(user.id, ninetyDaysAgo.toISOString());

    exportData.agent_executions = executions || [];

    // 4. Agent Configurations
    const { data: configurations } = await agentConfigurationRepository.listForUserDataExport(user.id);

    exportData.agent_configurations = configurations || [];

    // 5. Plugin Connections (sensitive - credentials are never selected)
    const { data: connections } = await pluginConnectionRepository.listForUserDataExport(user.id);

    exportData.plugin_connections = (connections || []).map(conn => ({
      plugin_key: conn.plugin_key,
      connected_at: conn.created_at,
      last_updated: conn.updated_at,
      metadata: conn.metadata,
      // Credentials excluded for security
    }));

    // 6. Subscription & Billing Data
    const { data: subscription } = await userSubscriptionRepository.findForUserDataExport(user.id);

    exportData.subscriptions = subscription ? [subscription] : [];

    // 7. Credit Transactions (last 12 months)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const { data: transactions } = await creditTransactionRepository.listForUserDataExport(user.id, oneYearAgo.toISOString());

    exportData.transactions = transactions || [];

    // 8. Audit Logs (last 90 days, user-specific actions only). Owner-hidden
    // entries are left out inside the repository method (BD-26): the hidden
    // entity types, and any AI action event whatever its type.
    const { data: auditLogs } = await auditTrailRepository.listOwnerEntriesForExport(user.id, ninetyDaysAgo.toISOString());

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

    requestLogger.info(
      {
        userId: user.id,
        totalAgents: exportData.summary.total_agents,
        totalExecutions: exportData.summary.total_executions,
        totalConfigurations: exportData.summary.total_configurations,
        totalPluginConnections: exportData.summary.total_plugin_connections,
        totalTransactions: exportData.summary.total_transactions,
        totalAuditLogs: exportData.summary.total_audit_logs,
        exportSizeKb: exportData.summary.export_size_kb,
        durationMs: exportData.summary.export_duration_ms,
      },
      'Data export completed'
    );

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
      requestLogger.info({ userId: user.id }, 'Data export audit logged');
    } catch (auditError) {
      requestLogger.error({ err: auditError, userId: user.id }, 'Data export audit logging failed (non-critical)');
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
    requestLogger.error({ err: error }, 'Data export failed');

    return NextResponse.json(
      {
        error: 'Data export failed',
        message: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
