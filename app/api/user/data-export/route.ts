// /app/api/user/data-export/route.ts
// GDPR Article 15 & 20: Right to access and data portability
//
// Every read goes through a repository (CLAUDE.md rule 1;
// DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md), each a `...ForUserDataExport`
// / `listOwnerEntriesForExport` method keyed on the authenticated user's id.
// The repositories read with the service role (`supabaseServer`), as this route
// always has. A read error is ignored on purpose and gives an empty section,
// as before, so one failing table never blocks the person's whole download;
// the repository logs the error.
//
// Every read names its columns (DATA_EXPORT_FOLLOWUPS_WORKPLAN.md, FU-P1): each
// repository method selects a column-list constant next to it (the audit read
// reuses OWNER_COLUMNS), so a column added to a table later is not exported
// until someone decides it should be. Plugin
// credentials are never read; the provider profile (`profile_data`) is read but
// only allow-listed string fields of it reach the body (`accountProfile`).
//
// BD-26 (user decision, 2026-10-04): the owner's export leaves out internal
// admin audit entries — every OWNER_HIDDEN_ENTITY_TYPES type and any Business
// OS AI action event — the same rule as the owner RLS policy and
// AuditTrailRepository.listOwnerEntries (lib/audit/ownerVisibility.ts). Both
// exclusions live in AuditTrailRepository.listOwnerEntriesForExport, kept
// there by a source guard (lib/audit/__tests__/ownerAuditReads.guard.test.ts).
//
// The audit read filters and orders on `created_at` (FU-1). Until that fix it
// used `timestamp`, a column that does not exist, so no export before it held
// any audit history; the plugin connection read likewise named a column that
// does not exist (`metadata`, NF-1), so none held plugin connections either.

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
 * The provider profile fields a person gets back in their export (SA C-1,
 * DATA_EXPORT_FOLLOWUPS_WORKPLAN.md). An ALLOW-list on purpose: some providers
 * store an access token inside `profile_data`, under names nobody can predict,
 * so stripping known secret keys would fail open. Only these top-level keys,
 * and only when the value is a string or an array of strings. Never an id /
 * `sub`, never a token key, never a nested object. Changing this changes what
 * the export holds: a privacy decision.
 */
const ACCOUNT_PROFILE_KEYS: readonly string[] = [
  'name', 'given_name', 'family_name', 'email', 'mail', 'picture', 'avatar_url', 'locale',
  'language', 'country', 'displayName', 'givenName', 'surname', 'jobTitle', 'mobilePhone',
  'businessPhones', 'officeLocation', 'preferredLanguage', 'userPrincipalName', 'nickname',
  'preferred_username',
];

/** The allow-listed part of a raw `profile_data` value; anything else is dropped. */
function accountProfile(profileData: unknown): Record<string, string | string[]> {
  const profile: Record<string, string | string[]> = {};
  if (typeof profileData !== 'object' || profileData === null || Array.isArray(profileData)) return profile;
  const source = profileData as Record<string, unknown>;
  for (const key of ACCOUNT_PROFILE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (typeof value === 'string') {
      profile[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      profile[key] = [...(value as string[])];
    }
  }
  return profile;
}

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

    // 5. Plugin Connections (sensitive - credentials are never selected). The
    // raw `profile_data` never reaches the body: only its allow-listed fields.
    const { data: connections } = await pluginConnectionRepository.listForUserDataExport(user.id);

    exportData.plugin_connections = (connections || []).map(conn => ({
      plugin_key: conn.plugin_key,
      plugin_name: conn.plugin_name,
      account_username: conn.username,
      account_email: conn.email,
      account_profile: accountProfile(conn.profile_data),
      scope: conn.scope,
      status: conn.status,
      connected_at: conn.connected_at ?? conn.created_at,
      last_updated: conn.updated_at,
      last_used: conn.last_used,
      disconnected_at: conn.disconnected_at,
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

  } catch (error: unknown) {
    requestLogger.error({ err: error }, 'Data export failed');

    // FU-P2: the cause stays in the log line above; the body carries it only in
    // development (CLAUDE.md error response format).
    return NextResponse.json(
      {
        success: false,
        error: 'Data export failed',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}
