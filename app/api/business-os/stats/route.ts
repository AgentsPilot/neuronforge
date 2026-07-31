/**
 * GET /api/business-os/stats - Get Business OS dashboard statistics
 * Returns capability activation status and stats for each capability
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteAnalyticsRepository } from '@/lib/repositories/WebsiteAnalyticsRepository';

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
    bookings_30d: number;
    page_count: number;
    wants_website: boolean;
    has_live_pages: boolean;
    url?: string;
    // Detailed breakdown
    visitors_7d: number;
    visitors_today: number;
    form_submissions_30d: number;
  };
  crm: {
    status: 'active' | 'inactive';
    total_contacts: number;
    new_this_week: number;
    became_clients_this_week: number;
    went_quiet: number;
    pipeline_stages: PipelineStageCount[];
    // Detailed breakdown
    contacts_by_source: { source: string; count: number }[];
    active_leads: number;
    active_clients: number;
  };
  scheduling: {
    status: 'active' | 'inactive';
    bookings_30d: number;
    upcoming_count: number;
    services_count: number;
    active_services_count: number;
    open_days_count: number;
    stripe_connected: boolean;
    calendar_synced: boolean;
    calendar_provider: 'google_calendar' | 'outlook' | null;
    // Detailed breakdown
    confirmed_30d: number;
    completed_30d: number;
    cancelled_30d: number;
    no_show_30d: number;
    total_revenue_30d: number;
  };
  payments: {
    status: 'active' | 'inactive';
    revenue_30d: number;
    pending_invoices: number;
    // Detailed breakdown
    successful_transactions_30d: number;
    failed_transactions_30d: number;
    refunded_30d: number;
    invoices_sent_30d: number;
    invoices_paid_30d: number;
    invoices_overdue: number;
    average_invoice_amount: number;
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
      // Website bookings (bookings from website source)
      { count: websiteBookings30d },
      // === DETAILED BREAKDOWN RESULTS ===
      { data: bookingsByStatus },
      { data: completedBookingsWithRevenue },
      { data: contactsBySource },
      { count: activeLeads },
      { count: activeClients },
      { data: allTransactions30d },
      { data: allInvoices30d },
      { count: overdueInvoices },
      { count: formSubmissions30d },
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
      // CRM: contacts that became clients this week
      // Match stages that indicate client status across different verticals:
      // - 'active_client', 'client' (therapist/default)
      // - 'active' (coach/consultant - Active Client / Active Project)
      // - 'closed_won' (sales)
      // We check updated_at as a proxy for when they moved to this stage
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .or('stage.ilike.%client%,stage.eq.active,stage.eq.closed_won')
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
      // Website: bookings from website source in last 30 days
      supabaseServer
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('booking_source', 'website')
        .gte('created_at', thirtyDaysAgo),
      // === DETAILED BREAKDOWN QUERIES ===
      // Scheduling: bookings by status in last 30 days
      supabaseServer
        .from('scheduling_bookings')
        .select('status')
        .eq('user_id', user.id)
        .gte('start_time', thirtyDaysAgo),
      // Scheduling: bookings with payment amounts (for total revenue)
      supabaseServer
        .from('scheduling_bookings')
        .select('total_amount')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('start_time', thirtyDaysAgo),
      // CRM: contacts by source
      supabaseServer
        .from('crm_contacts')
        .select('source')
        .eq('user_id', user.id),
      // CRM: active leads (contacts in lead-type stages)
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('stage', ['lead', 'inquiry', 'contacted', 'meeting', 'proposal', 'negotiation', 'discovery', 'qualified']),
      // CRM: active clients
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .or('stage.ilike.%client%,stage.eq.active,stage.eq.closed_won'),
      // Payments: all transactions in 30 days (for breakdown by status)
      supabaseServer
        .from('payment_transactions')
        .select('status, amount')
        .eq('user_id', user.id)
        .gte('created_at', thirtyDaysAgo),
      // Payments: invoices in 30 days (for breakdown)
      supabaseServer
        .from('payment_invoices')
        .select('status, amount')
        .eq('user_id', user.id)
        .gte('created_at', thirtyDaysAgo),
      // Payments: overdue invoices
      supabaseServer
        .from('payment_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'overdue'),
      // Website: form submissions in 30 days
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('source', 'website_form')
        .gte('created_at', thirtyDaysAgo),
    ]);

    // Fetch website analytics
    let websiteVisitors30d = 0;
    let websiteVisitors7d = 0;
    let websiteVisitorsToday = 0;
    try {
      const analyticsRepo = new WebsiteAnalyticsRepository(supabaseServer);
      // Don't filter by subdomain - user_id is sufficient
      const analyticsResult = await analyticsRepo.getSummary(user.id);
      if (analyticsResult.data) {
        websiteVisitors30d = analyticsResult.data.visitors_30d;
        websiteVisitors7d = analyticsResult.data.visitors_7d;
        websiteVisitorsToday = analyticsResult.data.visitors_today;
      }
    } catch (err) {
      requestLogger.warn({ err }, 'Failed to fetch website analytics');
    }

    // Calculate revenue from payments data
    const revenue30d = (paymentsData || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    // === PROCESS DETAILED BREAKDOWN DATA ===

    // Scheduling breakdown by status
    const bookingStatusCounts = { confirmed: 0, completed: 0, cancelled: 0, no_show: 0 };
    (bookingsByStatus || []).forEach((b: { status: string }) => {
      if (b.status in bookingStatusCounts) {
        bookingStatusCounts[b.status as keyof typeof bookingStatusCounts]++;
      }
    });

    // Total revenue from completed bookings
    const schedulingRevenue30d = (completedBookingsWithRevenue || []).reduce(
      (sum: number, b: { total_amount: number | null }) => sum + (b.total_amount || 0), 0
    );

    // Contacts by source breakdown
    const sourceCountMap: Record<string, number> = {};
    (contactsBySource || []).forEach((c: { source: string | null }) => {
      const source = c.source || 'unknown';
      sourceCountMap[source] = (sourceCountMap[source] || 0) + 1;
    });
    const contactsBySourceArray = Object.entries(sourceCountMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 sources

    // Payment transactions breakdown
    const transactionCounts = { succeeded: 0, failed: 0, refunded: 0 };
    (allTransactions30d || []).forEach((t: { status: string }) => {
      if (t.status in transactionCounts) {
        transactionCounts[t.status as keyof typeof transactionCounts]++;
      }
    });

    // Invoice breakdown
    const invoiceCounts = { sent: 0, paid: 0 };
    let totalInvoiceAmount = 0;
    let paidInvoiceCount = 0;
    (allInvoices30d || []).forEach((inv: { status: string; amount: number }) => {
      if (inv.status === 'sent') invoiceCounts.sent++;
      if (inv.status === 'paid') {
        invoiceCounts.paid++;
        paidInvoiceCount++;
        totalInvoiceAmount += inv.amount || 0;
      }
    });
    const averageInvoiceAmount = paidInvoiceCount > 0 ? totalInvoiceAmount / paidInvoiceCount : 0;

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
    // Calendar sync status from business profile
    const calendarSynced = !!(businessProfile as any)?.calendar_sync_enabled;
    const calendarProvider = (businessProfile as any)?.calendar_sync_provider || null;

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
        visitors_30d: websiteVisitors30d,
        bookings_30d: websiteBookings30d || 0,
        page_count: allPages.length,
        wants_website: wantsWebsite,
        has_live_pages: hasLivePages,
        url: websiteUrl,
        // Detailed breakdown
        visitors_7d: websiteVisitors7d,
        visitors_today: websiteVisitorsToday,
        form_submissions_30d: formSubmissions30d || 0,
      },
      crm: {
        // Core capability - always active
        status: activeCapabilityKeys.has('crm') ? 'active' : 'inactive',
        total_contacts: totalContacts || 0,
        new_this_week: newContactsThisWeek || 0,
        became_clients_this_week: becameClientsThisWeek || 0,
        went_quiet: wentQuietCount,
        pipeline_stages: pipelineStagesWithCounts,
        // Detailed breakdown
        contacts_by_source: contactsBySourceArray,
        active_leads: activeLeads || 0,
        active_clients: activeClients || 0,
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
        calendar_synced: calendarSynced,
        calendar_provider: calendarProvider,
        // Detailed breakdown
        confirmed_30d: bookingStatusCounts.confirmed,
        completed_30d: bookingStatusCounts.completed,
        cancelled_30d: bookingStatusCounts.cancelled,
        no_show_30d: bookingStatusCounts.no_show,
        total_revenue_30d: schedulingRevenue30d,
      },
      payments: {
        // Core capability - always active
        status: activeCapabilityKeys.has('payments') ? 'active' : 'inactive',
        revenue_30d: revenue30d,
        pending_invoices: pendingInvoices || 0,
        // Detailed breakdown
        successful_transactions_30d: transactionCounts.succeeded,
        failed_transactions_30d: transactionCounts.failed,
        refunded_30d: transactionCounts.refunded,
        invoices_sent_30d: invoiceCounts.sent,
        invoices_paid_30d: invoiceCounts.paid,
        invoices_overdue: overdueInvoices || 0,
        average_invoice_amount: averageInvoiceAmount,
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
