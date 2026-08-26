/**
 * GET /api/business-os/stats - Get Business OS dashboard statistics
 * Returns capability activation status and stats for each capability
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteAnalyticsRepository } from '@/lib/repositories/WebsiteAnalyticsRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';

const logger = createLogger({ module: 'BusinessOSStatsAPI' });

/**
 * Reporting window. Defaults to `month` (30 days), which is the window this
 * route has always used — callers that omit the param, such as the dashboard,
 * get exactly the numbers they got before.
 *
 * The `*_30d` field names in the response are kept for compatibility; they now
 * mean "current period" rather than literally 30 days.
 */
const statsQuerySchema = z.object({
  period: z.enum(['week', 'month', 'year', 'all']).default('month')
});

const PERIOD_DAYS: Record<'week' | 'month' | 'year', number> = {
  week: 7,
  month: 30,
  year: 365
};

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
    draft_page_id?: string; // For quick publish from dashboard
    // Detailed breakdown
    visitors_7d: number;
    visitors_today: number;
    form_submissions_30d: number;
    // Milestone data
    first_visitor_date?: string;
    first_visitor_source?: string;
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
    // Milestone data
    first_contact_date?: string;
    first_response_time?: string;
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
    intake_enabled: boolean;
    // Weekly comparison
    bookings_this_week: number;
    bookings_last_week: number;
    // Detailed breakdown
    confirmed_30d: number;
    completed_30d: number;
    cancelled_30d: number;
    no_show_30d: number;
    total_revenue_30d: number;
    // Booked (ordered) value, paid or not
    booked_value_this_week: number;
    booked_value_last_week: number;
    booked_value_period: number;
    // Revenue by service
    service_revenue: { service_id: string; service_name: string; revenue: number; count: number }[];
    // Milestone data
    first_booking_date?: string;
    // Note: first_booking_amount removed - total_amount no longer on scheduling_bookings
  };
  payments: {
    status: 'active' | 'inactive';
    revenue_30d: number;
    revenue_paid_30d: number;
    revenue_owed_30d: number;
    // Revenue breakdown by source
    transactions_revenue_30d: number;
    invoices_paid_amount_30d: number;
    pending_invoices: number;
    pending_invoices_amount: number;
    // Weekly comparison
    revenue_this_week: number;
    revenue_last_week: number;
    // Detailed breakdown
    successful_transactions_30d: number;
    failed_transactions_30d: number;
    refunded_30d: number;
    invoices_sent_30d: number;
    invoices_paid_30d: number;
    invoices_overdue: number;
    invoices_overdue_amount: number;
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

    // 2. Validate input
    const parsedQuery = statsQuerySchema.safeParse({
      period: request.nextUrl.searchParams.get('period') ?? undefined
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid period. Expected week, month, year or all.' },
        { status: 400 }
      );
    }
    const { period } = parsedQuery.data;

    requestLogger.info({ userId: user.id, period }, 'Fetching Business OS stats');

    // 3. Calculate date ranges
    const now = new Date();
    // Reporting window. 'all' uses the epoch rather than dropping the filter, so
    // every query below keeps the same shape instead of branching 13 times.
    const periodStart = period === 'all'
      ? new Date(0).toISOString()
      : new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000).toISOString();
    // Week-over-week comparison is independent of the selected period — it always
    // compares the last 7 days with the 7 before that.
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgoDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // 4. Fetch user's enabled capabilities (DATABASE-DRIVEN)
    const { data: userCapabilities } = await supabaseServer
      .from('user_capabilities')
      .select(`
        is_active,
        capabilities (
          capability_key
        )
      `)
      .eq('user_id', user.id)
      .eq('is_active', true);

    // Create a set of active capability keys (database-driven, no hardcoded defaults)
    const activeCapabilityKeys = new Set<string>();

    // Add user's activated capabilities from database
    (userCapabilities || []).forEach((uc: any) => {
      if (uc.capabilities?.capability_key) {
        activeCapabilityKeys.add(uc.capabilities.capability_key);
      }
    });

    requestLogger.info(
      { userId: user.id, capabilities: Array.from(activeCapabilityKeys) },
      'Active capabilities for user'
    );

    // 5. Fetch pipeline stages for the user
    const { data: pipelineStages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key, stage_label, color, position')
      .eq('user_id', user.id)
      .order('position', { ascending: true });

    // 6. Fetch all stats in parallel
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
      { count: paidServicesCount },
      stripeConnectResult,
      stripePluginResult,
      // Payments stats
      { data: paymentsData },
      { count: pendingInvoices },
      { data: pendingInvoicesData },
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
      { data: overdueInvoicesData },
      { count: formSubmissions30d },
      { data: revenueThisWeekData },
      { data: revenueLastWeekData },
      { data: bookingRevenueThisWeekData },
      { data: bookingRevenueLastWeekData },
      { data: paidInvoicesThisWeekData },
      { data: paidInvoicesLastWeekData },
      { data: paidInvoices30dData },
      { count: bookingsThisWeek },
      { count: bookingsLastWeek },
      { data: serviceRevenueData },
      { data: bookedValueThisWeekData },
      { data: bookedValueLastWeekData },
      { data: bookedValuePeriodData },
      intakeSettingsResult,
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
        .gte('start_time', periodStart),
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
      // Business profile for availability and userCode (use maybeSingle to avoid error when no profile exists)
      supabaseServer
        .from('business_profiles')
        .select('scheduling_availability, user_code')
        .eq('user_id', user.id)
        .maybeSingle(),
      // Check for paid services (price > 0)
      supabaseServer
        .from('scheduling_services')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gt('price', 0),
      // Stripe connection check - stripe_connect_accounts table
      supabaseServer
        .from('stripe_connect_accounts')
        .select('stripe_account_id, onboarding_completed')
        .eq('user_id', user.id)
        .maybeSingle(),
      // Stripe connection check - plugin_connections table (OAuth)
      supabaseServer
        .from('plugin_connections')
        .select('profile_data, status, access_token')
        .eq('user_id', user.id)
        .eq('plugin_key', 'stripe')
        .maybeSingle(),
      // Payments: revenue in last 30 days (status='succeeded' per migration)
      supabaseServer
        .from('payment_transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'succeeded')
        .gte('created_at', periodStart),
      // Payments: pending invoices (sent, overdue, or pending - anything not paid/cancelled/draft)
      supabaseServer
        .from('payment_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['pending', 'sent', 'overdue']),
      // Payments: pending invoices with amounts (for total expected revenue)
      supabaseServer
        .from('payment_invoices')
        .select('amount')
        .eq('user_id', user.id)
        .in('status', ['pending', 'sent', 'overdue']),
      // Email: emails sent in last 30 days (use email_sends table)
      supabaseServer
        .from('email_sends')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'sent')
        .gte('sent_at', periodStart),
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
        .gte('started_at', periodStart),
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
        .gte('created_at', periodStart),
      // === DETAILED BREAKDOWN QUERIES ===
      // Scheduling: bookings by status in last 30 days
      supabaseServer
        .from('scheduling_bookings')
        .select('status')
        .eq('user_id', user.id)
        .gte('start_time', periodStart),
      // Scheduling: bookings with payment amounts (for total revenue)
      supabaseServer
        .from('scheduling_bookings')
        .select('total_amount')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('start_time', periodStart),
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
        .gte('created_at', periodStart),
      // Payments: invoices in 30 days (for breakdown)
      supabaseServer
        .from('payment_invoices')
        .select('status, amount')
        .eq('user_id', user.id)
        .gte('created_at', periodStart),
      // Payments: overdue invoices
      supabaseServer
        .from('payment_invoices')
        .select('amount, status')
        .eq('user_id', user.id)
        .eq('status', 'overdue'),
      // Website: form submissions in 30 days
      supabaseServer
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('source', 'website_form')
        .gte('created_at', periodStart),
      // Payments: revenue this week (last 7 days)
      supabaseServer
        .from('payment_transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'succeeded')
        .gte('created_at', sevenDaysAgo),
      // Payments: revenue last week (7-14 days ago)
      supabaseServer
        .from('payment_transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'succeeded')
        .gte('created_at', fourteenDaysAgoDate)
        .lt('created_at', sevenDaysAgo),
      // Booking revenue this week (completed bookings in last 7 days)
      supabaseServer
        .from('scheduling_bookings')
        .select('total_amount')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('start_time', sevenDaysAgo),
      // Booking revenue last week (completed bookings 7-14 days ago)
      supabaseServer
        .from('scheduling_bookings')
        .select('total_amount')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('start_time', fourteenDaysAgoDate)
        .lt('start_time', sevenDaysAgo),
      // Paid invoices this week (paid_at in last 7 days)
      supabaseServer
        .from('payment_invoices')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'paid')
        .gte('paid_at', sevenDaysAgo),
      // Paid invoices last week (paid_at 7-14 days ago)
      supabaseServer
        .from('payment_invoices')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'paid')
        .gte('paid_at', fourteenDaysAgoDate)
        .lt('paid_at', sevenDaysAgo),
      // Paid invoices 30 days (for total revenue)
      supabaseServer
        .from('payment_invoices')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'paid')
        .gte('paid_at', periodStart),
      // Bookings this week (all statuses, for weekly comparison)
      supabaseServer
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('start_time', sevenDaysAgo),
      // Bookings last week (7-14 days ago)
      supabaseServer
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('start_time', fourteenDaysAgoDate)
        .lt('start_time', sevenDaysAgo),
      // Revenue by service (completed bookings with service info)
      supabaseServer
        .from('scheduling_bookings')
        .select('service_id, total_amount, scheduling_services(service_name)')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('start_time', periodStart)
        .not('service_id', 'is', null),
      // Booked VALUE this week — what clients ordered in the last 7 days, priced
      // from the service, independent of whether payment has been collected.
      // Dated by created_at (when it was booked), not start_time (when it happens).
      supabaseServer
        .from('scheduling_bookings')
        .select('scheduling_services(price)')
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .gte('created_at', sevenDaysAgo),
      // Booked value last week (7-14 days ago), for the week-over-week trend
      supabaseServer
        .from('scheduling_bookings')
        .select('scheduling_services(price)')
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .gte('created_at', fourteenDaysAgoDate)
        .lt('created_at', sevenDaysAgo),
      // Booked value across the selected reporting period
      supabaseServer
        .from('scheduling_bookings')
        .select('scheduling_services(price)')
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .gte('created_at', periodStart),
      // Intake form configuration (repository — no row means never set up)
      intakeRepository.getSettings(user.id),
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

    // Fetch milestone data (first visitor, first contact, first booking)
    const [
      { data: firstVisitorData },
      { data: firstContactData },
      { data: firstBookingData },
    ] = await Promise.all([
      // First website visitor (from website_page_views table)
      supabaseServer
        .from('website_page_views')
        .select('created_at, referer')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      // First CRM contact
      supabaseServer
        .from('crm_contacts')
        .select('created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      // First booking (any booking)
      // Note: total_amount was removed from scheduling_bookings (now in payment_transactions)
      supabaseServer
        .from('scheduling_bookings')
        .select('created_at, status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    // Return raw dates - formatting will be done on client side with proper locale
    const firstVisitorDate = firstVisitorData?.created_at || undefined;
    const firstVisitorSource = firstVisitorData?.referer || 'direct';
    const firstContactDate = firstContactData?.created_at || undefined;
    const firstBookingDate = firstBookingData?.created_at || undefined;
    // Note: firstBookingAmount no longer available - total_amount was removed from scheduling_bookings

    // Debug log for milestone data
    requestLogger.info({
      firstVisitorData,
      firstContactData,
      firstBookingData,
    }, 'Milestone data fetched');

    // Calculate revenue from payments data (payment_transactions only)
    const paymentTransactionsRevenue30d = (paymentsData || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    // Calculate weekly revenue comparison
    // Note: Revenue should ONLY come from payment_transactions (single source of truth)
    // booking.total_amount was removed to prevent double-counting
    // Invoice payments are recorded in payment_transactions with invoice_id, so no need to sum separately
    const paymentRevenueThisWeek = (revenueThisWeekData || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    const paymentRevenueLastWeek = (revenueLastWeekData || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    // Legacy data compatibility: For old bookings that don't have payment_transactions yet
    // This will be 0 once all bookings use the new flow
    const bookingRevenueThisWeek = (bookingRevenueThisWeekData || []).reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0);
    const bookingRevenueLastWeek = (bookingRevenueLastWeekData || []).reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0);

    // Invoice revenue - only count invoices that were NOT paid via payment_transactions
    // (Invoices paid via Stripe are already in payment_transactions with invoice_id)
    const invoiceRevenueThisWeek = (paidInvoicesThisWeekData || []).reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
    const invoiceRevenueLastWeek = (paidInvoicesLastWeekData || []).reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
    const invoiceRevenue30d = (paidInvoices30dData || []).reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);

    // Total weekly revenue = payment_transactions only
    // (includes both booking payments and invoice payments that went through Stripe)
    const revenueThisWeek = paymentRevenueThisWeek + bookingRevenueThisWeek + invoiceRevenueThisWeek;
    const revenueLastWeek = paymentRevenueLastWeek + bookingRevenueLastWeek + invoiceRevenueLastWeek;

    // Booked value — the worth of what clients ordered, priced from the service,
    // whether or not it has been paid for. This is what the dashboard's
    // "booked this week" card means; revenue_* above is money actually collected.
    // PostgREST returns a to-one embed as an object, but returns an array when it
    // can't prove the relationship is to-one. Handle both so a shape change can't
    // silently turn this into zero. price is DECIMAL, so it may arrive as a string.
    type BookedRow = { scheduling_services?: { price?: number | string | null } | { price?: number | string | null }[] | null };
    const sumBookedValue = (rows: unknown): number =>
      ((rows as BookedRow[] | null) || []).reduce((sum, booking) => {
        const service = Array.isArray(booking.scheduling_services)
          ? booking.scheduling_services[0]
          : booking.scheduling_services;
        return sum + (Number(service?.price) || 0);
      }, 0);

    const bookedValueThisWeek = sumBookedValue(bookedValueThisWeekData);
    const bookedValueLastWeek = sumBookedValue(bookedValueLastWeekData);
    const bookedValuePeriod = sumBookedValue(bookedValuePeriodData);


    // === PROCESS DETAILED BREAKDOWN DATA ===

    // Scheduling breakdown by status
    const bookingStatusCounts = { confirmed: 0, completed: 0, cancelled: 0, no_show: 0 };
    (bookingsByStatus || []).forEach((b: { status: string }) => {
      if (b.status in bookingStatusCounts) {
        bookingStatusCounts[b.status as keyof typeof bookingStatusCounts]++;
      }
    });

    // Legacy: Total revenue from completed bookings with total_amount
    // This will be 0 for all new bookings (total_amount field removed from new bookings)
    // Kept for backward compatibility with old data
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
      // Count all invoices (sent or paid) as "sent"
      if (inv.status === 'sent' || inv.status === 'paid') invoiceCounts.sent++;
      if (inv.status === 'paid') {
        invoiceCounts.paid++;
        paidInvoiceCount++;
        totalInvoiceAmount += inv.amount || 0;
      }
    });
    const averageInvoiceAmount = paidInvoiceCount > 0 ? totalInvoiceAmount / paidInvoiceCount : 0;

    // Calculate overdue invoices count and amount
    const overdueInvoices = overdueInvoicesData?.length || 0;
    const overdueInvoicesAmount = (overdueInvoicesData || []).reduce((sum: number, inv: { amount: number }) => sum + (inv.amount || 0), 0);

    // Calculate pending invoices total amount (what clients owe)
    const pendingInvoicesAmount = (pendingInvoicesData || []).reduce((sum: number, inv: { amount: number }) => sum + (inv.amount || 0), 0);

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
    const hasPaidServices = (paidServicesCount || 0) > 0;

    // Get or generate user_code for lead capture links
    let userCode = businessProfile?.user_code || null;
    if (!userCode && businessProfile) {
      // Generate user_code if not set
      const userCodeResult = await businessProfileRepository.getUserCode(user.id);
      if (userCodeResult.data) {
        userCode = userCodeResult.data;
      }
    }

    // Check Stripe connection from multiple sources:
    // 1. stripe_connect_accounts table (Express/Standard accounts with onboarding completed)
    // 2. plugin_connections table (OAuth connected accounts)
    const { data: stripeConnectAccount } = stripeConnectResult;
    const { data: stripePluginConnection } = stripePluginResult;

    const hasStripeConnectAccount = !!(stripeConnectAccount?.stripe_account_id && stripeConnectAccount?.onboarding_completed);
    // For plugin_connections (OAuth), check if:
    // 1. Status is active AND
    // 2. There's an access_token (OAuth connected) OR profile_data has stripe_account_id
    const hasStripePluginConnection = !!(stripePluginConnection?.status === 'active' &&
      (stripePluginConnection?.access_token || stripePluginConnection?.profile_data?.stripe_account_id));

    const stripeConnected = hasStripeConnectAccount || hasStripePluginConnection;
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

    // Get draft page ID for quick publish from dashboard
    const draftPage = allPages.find((p: any) => p.status === 'draft' && p.subdomain);
    const draftPageId = draftPage?.id;

    // Process service revenue data from payment_transactions (not bookings)
    // This ensures accurate revenue tracking without double-counting
    // Note: serviceRevenueData query needs to be updated to query payment_transactions instead of scheduling_bookings
    const serviceRevenueMap: Record<string, { service_name: string; revenue: number; count: number }> = {};

    // Temporary: Still reading from bookings for legacy compatibility
    // TODO: Update the serviceRevenueData query to use payment_transactions.service_id
    (serviceRevenueData || []).forEach((booking: any) => {
      if (booking.service_id && booking.total_amount) {
        const serviceId = booking.service_id;
        const serviceName = booking.scheduling_services?.service_name || 'Unknown Service';
        const amount = booking.total_amount || 0;

        if (!serviceRevenueMap[serviceId]) {
          serviceRevenueMap[serviceId] = {
            service_name: serviceName,
            revenue: 0,
            count: 0
          };
        }

        serviceRevenueMap[serviceId].revenue += amount;
        serviceRevenueMap[serviceId].count += 1;
      }
    });

    // Convert to array and sort by revenue
    const serviceRevenueArray = Object.entries(serviceRevenueMap).map(([service_id, data]) => ({
      service_id,
      service_name: data.service_name,
      revenue: data.revenue,
      count: data.count
    }));

    // 7. Build capability stats object
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
        draft_page_id: draftPageId, // For quick publish from dashboard
        // Detailed breakdown
        visitors_7d: websiteVisitors7d,
        visitors_today: websiteVisitorsToday,
        form_submissions_30d: formSubmissions30d || 0,
        // Milestone data
        first_visitor_date: firstVisitorDate,
        first_visitor_source: firstVisitorSource,
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
        // Milestone data
        first_contact_date: firstContactDate,
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
        // Intake forms are opt-in: no settings row, or is_enabled false, both mean off.
        intake_enabled: !!intakeSettingsResult?.data?.is_enabled,
        // Weekly comparison
        bookings_this_week: bookingsThisWeek || 0,
        bookings_last_week: bookingsLastWeek || 0,
        // Detailed breakdown
        confirmed_30d: bookingStatusCounts.confirmed,
        completed_30d: bookingStatusCounts.completed,
        cancelled_30d: bookingStatusCounts.cancelled,
        no_show_30d: bookingStatusCounts.no_show,
        total_revenue_30d: schedulingRevenue30d,
        // Value of what was booked (ordered), paid or not — priced from the service.
        // Unlike total_revenue_30d above, this is not tied to the removed
        // scheduling_bookings.total_amount column, so it reflects current data.
        booked_value_this_week: bookedValueThisWeek,
        booked_value_last_week: bookedValueLastWeek,
        booked_value_period: bookedValuePeriod,
        // Revenue by service
        service_revenue: serviceRevenueArray,
        // Milestone data
        first_booking_date: firstBookingDate,
        // first_booking_amount removed - total_amount no longer on scheduling_bookings
      },
      payments: {
        // Core capability - always active
        status: activeCapabilityKeys.has('payments') ? 'active' : 'inactive',
        // Total revenue = paid + owed (pending invoices)
        revenue_30d: paymentTransactionsRevenue30d + schedulingRevenue30d + invoiceRevenue30d + pendingInvoicesAmount,
        // Revenue already collected (paid)
        revenue_paid_30d: paymentTransactionsRevenue30d + schedulingRevenue30d + invoiceRevenue30d,
        // Revenue owed (pending invoices not yet paid)
        revenue_owed_30d: pendingInvoicesAmount,
        // Revenue breakdown by source (for RevenueSourcesSection)
        transactions_revenue_30d: paymentTransactionsRevenue30d,
        invoices_paid_amount_30d: invoiceRevenue30d,
        pending_invoices: pendingInvoices || 0,
        pending_invoices_amount: pendingInvoicesAmount,
        // Weekly comparison - includes payment transactions + booking revenue + paid invoices
        revenue_this_week: revenueThisWeek,
        revenue_last_week: revenueLastWeek,
        // Detailed breakdown
        successful_transactions_30d: transactionCounts.succeeded,
        failed_transactions_30d: transactionCounts.failed,
        refunded_30d: transactionCounts.refunded,
        invoices_sent_30d: invoiceCounts.sent,
        invoices_paid_30d: invoiceCounts.paid,
        invoices_overdue: overdueInvoices || 0,
        invoices_overdue_amount: overdueInvoicesAmount || 0,
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
      // Lead capture data for LeadCaptureLinks component
      userCode,
      hasPaidServices,
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
