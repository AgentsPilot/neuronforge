/**
 * GET /api/business-os/stats - Get Business OS dashboard statistics
 * Returns capability activation status and stats for each capability
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'BusinessOSStatsAPI' });

interface PipelineStageCount {
  stage_key: string;
  stage_label: string;
  color: string;
  count: number;
}

interface CapabilityStats {
  website: {
    status: 'active' | 'inactive';
    visitors_30d: number;
    page_count: number;
    wants_website: boolean;
    has_live_pages: boolean;
    url?: string;
  };
  crm: {
    status: 'active' | 'inactive';
    total_contacts: number;
    new_this_week: number;
    became_clients_this_week: number;
    went_quiet: number;
    pipeline_stages: PipelineStageCount[];
  };
  scheduling: {
    status: 'active' | 'inactive';
    bookings_30d: number;
    upcoming_count: number;
    services_count: number;
    active_services_count: number;
    open_days_count: number;
    stripe_connected: boolean;
  };
  payments: {
    status: 'active' | 'inactive';
    revenue_30d: number;
    pending_invoices: number;
  };
  email_automation: {
    status: 'active' | 'inactive';
    emails_sent_30d: number;
    active_sequences: number;
  };
  campaigns: {
    status: 'active' | 'inactive';
    active_campaigns: number;
    leads_30d: number;
  };
  automation_engine: {
    status: 'active' | 'inactive';
    workflows_count: number;
    executions_30d: number;
  };
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Fetching Business OS stats');

    // 2. Calculate date ranges
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 3. Fetch user's enabled capabilities AND core capabilities
    const [
      { data: userCapabilities },
      { data: coreCapabilities }
    ] = await Promise.all([
      // User's explicitly enabled capabilities
      supabaseServer
        .from('user_capabilities')
        .select(`
          is_active,
          capabilities (
            capability_key
          )
        `)
        .eq('user_id', user.id)
        .eq('is_active', true),
      // Core capabilities (always available to all users)
      supabaseServer
        .from('capabilities')
        .select('capability_key')
        .eq('is_core', true)
    ]);

    // Create a set of active capability keys (user-enabled + core capabilities)
    const activeCapabilityKeys = new Set<string>();

    // Add user's explicitly enabled capabilities
    (userCapabilities || []).forEach((uc: any) => {
      if (uc.capabilities?.capability_key) {
        activeCapabilityKeys.add(uc.capabilities.capability_key);
      }
    });

    // Add core capabilities from database (crm, scheduling, payments, email_automation)
    (coreCapabilities || []).forEach((c: any) => {
      if (c.capability_key) {
        activeCapabilityKeys.add(c.capability_key);
      }
    });

    // Fallback: Always mark core capabilities as active even if DB doesn't have them
    // This ensures the dashboard works even before migrations are run
    const CORE_CAPABILITY_KEYS = ['crm', 'scheduling', 'payments', 'email_automation'];
    CORE_CAPABILITY_KEYS.forEach(key => activeCapabilityKeys.add(key));

    // 4. Fetch pipeline stages for the user
    const { data: pipelineStages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key, stage_label, color, position')
      .eq('user_id', user.id)
      .order('position', { ascending: true });

    // 5. Fetch all stats in parallel
    const [
      // CRM stats
      { count: totalContacts },
      { count: newContactsThisWeek },
      { count: becameClientsThisWeek },
      { data: contactsWithActivity },
      { data: contactsByStage },
      // Scheduling stats
      { count: bookings30d },
      { count: upcomingBookings },
      { count: servicesCount },
      { count: activeServicesCount },
      businessProfileResult,
      // Payments stats
      { data: paymentsData },
      { count: pendingInvoices },
      // Email automation stats (use email_sends table)
      { count: emailsSent30d },
      { count: activeSequences },
      // Automation engine stats (agents)
      { count: workflowsCount },
      { count: executions30d },
      // Website pages
      { data: websitePages },
    ] = await Promise.all([
      // CRM: total contacts
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id),
      // CRM: new contacts this week
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', sevenDaysAgo),
      // CRM: contacts that became clients this week (stage contains 'client' and updated this week)
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .ilike('stage', '%client%')
        .gte('updated_at', sevenDaysAgo),
      // CRM: contacts with recent activity (to calculate "went quiet")
      supabaseServer
        .from('crm_contacts')
        .select('id, stage, updated_at')
        .eq('user_id', user.id)
        .in('stage', ['lead', 'client']),
      // CRM: contacts grouped by stage (get all contacts with their stages)
      supabaseServer
        .from('crm_contacts')
        .select('stage')
        .eq('user_id', user.id),
      // Scheduling: bookings in last 30 days
      supabaseServer
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('start_time', thirtyDaysAgo),
      // Scheduling: upcoming bookings
      supabaseServer
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('start_time', now.toISOString())
        .eq('status', 'confirmed'),
      // Scheduling: all services count
      supabaseServer
        .from('scheduling_services')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id),
      // Scheduling: active services count
      supabaseServer
        .from('scheduling_services')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active'),
      // Business profile for availability (use maybeSingle to avoid error when no profile exists)
      // Note: stripe_account_id column may not exist in all environments yet
      supabaseServer
        .from('business_profiles')
        .select('scheduling_availability')
        .eq('user_id', user.id)
        .maybeSingle(),
      // Payments: revenue in last 30 days (status='succeeded' per migration)
      supabaseServer
        .from('payment_transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'succeeded')
        .gte('created_at', thirtyDaysAgo),
      // Payments: pending invoices (sent, overdue, or pending - anything not paid/cancelled/draft)
      supabaseServer
        .from('payment_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['pending', 'sent', 'overdue']),
      // Email: emails sent in last 30 days (use email_sends table)
      supabaseServer
        .from('email_sends')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'sent')
        .gte('sent_at', thirtyDaysAgo),
      // Email: active sequences
      supabaseServer
        .from('email_sequences')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_active', true),
      // Automation engine: active workflows/agents
      supabaseServer
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active'),
      // Automation engine: executions in last 30 days
      supabaseServer
        .from('agent_executions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('started_at', thirtyDaysAgo),
      // Website: all pages
      supabaseServer
        .from('website_pages')
        .select('id, status, subdomain, custom_domain')
        .eq('user_id', user.id),
    ]);

    // Calculate revenue from payments data
    const revenue30d = (paymentsData || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    // Calculate "went quiet" - contacts in lead/client stage with no activity in last 14 days
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const wentQuietCount = (contactsWithActivity || []).filter((contact: { id: string; stage: string; updated_at: string }) => {
      const updatedAt = new Date(contact.updated_at);
      return updatedAt < fourteenDaysAgo;
    }).length;

    // Count contacts per pipeline stage
    const stageCountMap: Record<string, number> = {};
    (contactsByStage || []).forEach((contact: { stage: string }) => {
      stageCountMap[contact.stage] = (stageCountMap[contact.stage] || 0) + 1;
    });

    // Build pipeline_stages array with counts
    const pipelineStagesWithCounts: PipelineStageCount[] = (pipelineStages || []).map((stage: any) => ({
      stage_key: stage.stage_key,
      stage_label: stage.stage_label,
      color: stage.color || '#94A3B8',
      count: stageCountMap[stage.stage_key] || 0
    }));

    // Count open days from business profile availability
    const countOpenDays = (availabilityRaw: Record<string, any> | string | null): number => {
      if (!availabilityRaw) return 0;

      // Handle case where availability is stored as JSON string
      let availability: Record<string, any>;
      if (typeof availabilityRaw === 'string') {
        try {
          availability = JSON.parse(availabilityRaw);
        } catch {
          return 0;
        }
      } else {
        availability = availabilityRaw;
      }

      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

      // Count days that have slots
      const activeDays = dayNames.filter(day =>
        Array.isArray(availability[day]) && availability[day].length > 0
      );

      return activeDays.length;
    };

    // Extract business profile data
    const { data: businessProfile } = businessProfileResult;

    const openDaysCount = countOpenDays(businessProfile?.scheduling_availability);
    // stripe_account_id column may not exist in all environments yet - default to false
    const stripeConnected = !!(businessProfile as any)?.stripe_account_id;

    // Calculate website stats
    const allPages = websitePages || [];
    const livePages = allPages.filter((p: any) => p.status === 'live');
    const hasLivePages = livePages.length > 0;
    const wantsWebsite = activeCapabilityKeys.has('website') || allPages.length > 0;

    // Get website URL from first page with subdomain/custom_domain
    let websiteUrl: string | undefined;
    const pageWithDomain = allPages.find((p: any) => p.subdomain || p.custom_domain);
    if (pageWithDomain) {
      websiteUrl = pageWithDomain.custom_domain ||
        (pageWithDomain.subdomain ? `${pageWithDomain.subdomain}.agentspilot.site` : undefined);
    }

    // 6. Build capability stats object
    // A capability is "active" if:
    // - It's a core capability (is_core=true in capabilities table), OR
    // - It's in user_capabilities with is_active=true, OR
    // - It has data (for capabilities that auto-activate on first use)
    const stats: CapabilityStats = {
      website: {
        status: activeCapabilityKeys.has('website') ? 'active' : 'inactive',
        visitors_30d: 0, // Website analytics not yet implemented
        page_count: allPages.length,
        wants_website: wantsWebsite,
        has_live_pages: hasLivePages,
        url: websiteUrl,
      },
      crm: {
        // Core capability - always active
        status: activeCapabilityKeys.has('crm') ? 'active' : 'inactive',
        total_contacts: totalContacts || 0,
        new_this_week: newContactsThisWeek || 0,
        became_clients_this_week: becameClientsThisWeek || 0,
        went_quiet: wentQuietCount,
        pipeline_stages: pipelineStagesWithCounts,
      },
      scheduling: {
        // Core capability - always active
        status: activeCapabilityKeys.has('scheduling') ? 'active' : 'inactive',
        bookings_30d: bookings30d || 0,
        upcoming_count: upcomingBookings || 0,
        services_count: servicesCount || 0,
        active_services_count: activeServicesCount || 0,
        open_days_count: openDaysCount,
        stripe_connected: stripeConnected,
      },
      payments: {
        // Core capability - always active
        status: activeCapabilityKeys.has('payments') ? 'active' : 'inactive',
        revenue_30d: revenue30d,
        pending_invoices: pendingInvoices || 0,
      },
      email_automation: {
        // Core capability - always active
        status: activeCapabilityKeys.has('email_automation') ? 'active' : 'inactive',
        emails_sent_30d: emailsSent30d || 0,
        active_sequences: activeSequences || 0,
      },
      campaigns: {
        status: activeCapabilityKeys.has('campaigns') ? 'active' : 'inactive',
        active_campaigns: 0, // Campaigns not yet implemented
        leads_30d: 0,
      },
      automation_engine: {
        // Always active - this is the core platform feature (AI agents)
        status: 'active',
        workflows_count: workflowsCount || 0,
        executions_30d: executions30d || 0,
      },
    };

    requestLogger.info(
      { userId: user.id, stats },
      'Business OS stats fetched'
    );

    return NextResponse.json({
      success: true,
      stats,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch Business OS stats');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
