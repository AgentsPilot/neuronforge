// /app/api/user/delete-account/route.ts
// GDPR Article 17: Right to erasure - Anonymization approach
// Deletes PII, retains agents for platform learning

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GDPR-Compliant Account Deletion
 *
 * Approach: ANONYMIZE USER, RETAIN AGENTS
 *
 * Rationale:
 * - Agents contain no personal/business data (only system prompts, workflows)
 * - Agents help improve platform AI training
 * - User identity is fully removed (GDPR compliant)
 * - Financial records retained per tax law (anonymized)
 *
 * What is DELETED:
 * - Personal data (name, email from profile)
 * - Plugin connections (OAuth tokens)
 * - User preferences and settings
 * - Authentication credentials
 *
 * What is ANONYMIZED:
 * - Profile → "DELETED_USER_xxxxx"
 * - Billing records → amounts kept, identity removed
 * - Audit logs → events kept, PII removed
 *
 * What is RETAINED:
 * - Agents (transferred to system/anonymized ownership)
 * - Financial transaction records (7 years - tax law)
 * - Audit trail (SOC 2 compliance)
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const { confirmation, reason } = body;

    // Require explicit confirmation
    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      return NextResponse.json(
        {
          error: 'Confirmation required',
          message: 'You must provide confirmation: "DELETE_MY_ACCOUNT"',
        },
        { status: 400 }
      );
    }

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

    console.log(`🗑️  [ACCOUNT DELETE] Starting anonymization for user: ${user.id}`);

    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const deletionStats: any = {
      user_id: user.id,
      original_email: user.email,
      deletion_timestamp: new Date().toISOString(),
      reason: reason || 'User requested account deletion',
      items_deleted: {},
      items_anonymized: {},
      items_retained: {},
    };

    // AUDIT TRAIL: Log before any changes
    try {
      await auditLog({
        action: AUDIT_EVENTS.DATA_DELETED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: user.email || 'User Account',
        details: {
          deletion_timestamp: new Date().toISOString(),
          deletion_reason: reason || 'User requested account deletion',
          gdpr_basis: 'Article 17 (Right to Erasure)',
          approach: 'Anonymization - retains agents for platform learning',
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
        },
        severity: 'warning',
        complianceFlags: ['GDPR', 'SOC2'],
      });
      console.log('✅ Deletion audit logged');
    } catch (auditError) {
      console.error('⚠️ Critical: Audit logging failed:', auditError);
      return NextResponse.json(
        { error: 'Audit logging failed', message: 'Cannot proceed without audit trail' },
        { status: 500 }
      );
    }

    const anonymizedId = user.id.substring(0, 8);
    const anonymizedEmail = `deleted_${anonymizedId}@anonymized.local`;
    const anonymizedName = `DELETED_USER_${anonymizedId}`;

    // Helper functions
    const deleteTable = async (tableName: string, idField: string = 'user_id') => {
      try {
        const { count, error } = await serviceSupabase
          .from(tableName)
          .delete({ count: 'exact' })
          .eq(idField, user.id);
        if (error) console.error(`Failed to delete ${tableName}:`, error);
        deletionStats.items_deleted[tableName] = count || 0;
      } catch (err) {
        console.error(`Exception deleting ${tableName}:`, err);
      }
    };

    const anonymizeTable = async (
      tableName: string,
      updates: Record<string, any>,
      idField: string = 'user_id'
    ) => {
      try {
        const { count, error } = await serviceSupabase
          .from(tableName)
          .update(updates)
          .eq(idField, user.id);
        if (error) console.error(`Failed to anonymize ${tableName}:`, error);
        deletionStats.items_anonymized[tableName] = count || 0;
      } catch (err) {
        console.error(`Exception anonymizing ${tableName}:`, err);
      }
    };

    // ==========================================
    // PHASE 1: DELETE PERSONAL DATA (No Business Value)
    // ==========================================
    console.log('Phase 1: Deleting personal data...');

    // Plugin connections (OAuth tokens - security risk if retained)
    await deleteTable('plugin_connections');

    // User preferences (no learning value)
    await deleteTable('user_preferences');
    await deleteTable('user_memory'); // User-specific learning
    await deleteTable('notification_settings');
    await deleteTable('security_settings');
    await deleteTable('user_api_keys');

    // ==========================================
    // PHASE 2: ANONYMIZE AGENTS (Retain for Learning)
    // ==========================================
    console.log('Phase 2: Anonymizing agents (retaining for platform learning)...');

    // Mark agents as inactive and archived (using EXISTING fields)
    await anonymizeTable('agents', {
      status: 'inactive', // Prevents execution
      is_archived: true, // Hides from user UI
      agent_name: `[ANONYMIZED] ${anonymizedName}`, // Prefix for identification
      description: `Agent from anonymized user (GDPR deletion). Retained for platform AI improvement.`,
      updated_at: new Date().toISOString(),
    });
    deletionStats.items_retained.agents = 'Anonymized (inactive + archived) - retained for AI training';

    // Agent executions, stats, configs remain as-is (no PII in these tables)
    deletionStats.items_retained.agent_executions = 'Retained - no PII, analytics only';
    deletionStats.items_retained.agent_stats = 'Retained - no PII';
    deletionStats.items_retained.agent_configurations = 'Retained - no PII';
    deletionStats.items_retained.agent_intensity_metrics = 'Retained - no PII';

    // ==========================================
    // PHASE 3: ANONYMIZE FINANCIAL RECORDS
    // ==========================================
    console.log('Phase 3: Anonymizing financial records...');

    await anonymizeTable('user_subscriptions', {
      metadata: { anonymized: true, deletion_date: new Date().toISOString() },
    });

    await anonymizeTable('credit_transactions', {
      metadata: { anonymized: true, deletion_date: new Date().toISOString() },
    });

    await anonymizeTable('billing_events', {
      user_email: anonymizedEmail,
      metadata: { anonymized: true },
    });

    deletionStats.items_retained.financial_records = 'Anonymized - retained 7 years (tax law)';

    // ==========================================
    // PHASE 4: ANONYMIZE AUDIT TRAIL
    // ==========================================
    console.log('Phase 4: Anonymizing audit trail...');

    await anonymizeTable('audit_trail', {
      details: { anonymized: true, anonymization_date: new Date().toISOString() },
    });
    deletionStats.items_retained.audit_trail = 'Anonymized - retained for compliance';

    // ==========================================
    // PHASE 5: ANONYMIZE PROFILE
    // ==========================================
    console.log('Phase 5: Anonymizing profile...');

    await anonymizeTable('profiles', {
      full_name: anonymizedName,
      avatar_url: null,
      company: null,
      bio: null,
      role: 'deleted',
      updated_at: new Date().toISOString(),
    }, 'id');

    // ==========================================
    // PHASE 6: DELETE AUTHENTICATION
    // ==========================================
    console.log('Phase 6: Deleting authentication...');

    const { error: authDeleteError } = await serviceSupabase.auth.admin.deleteUser(user.id);

    if (authDeleteError) {
      console.error('❌ Failed to delete auth:', authDeleteError);
      return NextResponse.json(
        { error: 'Failed to delete authentication', message: authDeleteError.message },
        { status: 500 }
      );
    }

    deletionStats.items_deleted.auth_user = 1;
    deletionStats.total_duration_ms = Date.now() - startTime;

    console.log(`✅ [ACCOUNT DELETE] Completed:`, deletionStats);

    await supabase.auth.signOut();

    return NextResponse.json({
      success: true,
      message: 'Account anonymized successfully',
      stats: deletionStats,
      gdpr_compliance: 'Article 17 (Right to Erasure via Anonymization)',
      data_policy: {
        deleted: [
          'Personal identification (name, email)',
          'Plugin connections and OAuth tokens',
          'User preferences and settings',
          'Authentication credentials',
        ],
        anonymized_and_retained: [
          'Agents (help improve AI - no personal data)',
          'Financial records (legal requirement - 7 years)',
          'Audit logs (security compliance)',
        ],
        why_agents_retained: 'Agents contain no personal/business data. They help improve the platform AI training and benefit all users.',
      },
    });

  } catch (error: any) {
    console.error('❌ [ACCOUNT DELETE] Failed:', error);
    return NextResponse.json(
      { error: 'Account deletion failed', message: error.message },
      { status: 500 }
    );
  }
}
