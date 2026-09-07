/**
 * GET /api/business-os/stats - Get Business OS dashboard statistics
 * Returns capability activation status and stats for each capability
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteAnalyticsRepository } from '@/lib/repositories/WebsiteAnalyticsRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';
import {
  grossRevenue,
  netRevenue,
  processorFees,
  revenueByCurrency,
} from '@/lib/payments/revenueMath';
import { channelConnectionRepository } from '@/lib/repositories/ChannelConnectionRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import {
  isBusinessProfileComplete,
  missingProfileFields,
  isInvoicingComplete,
  missingInvoiceFields,
  isThemeCustomized,
  type ProfileField,
  type InvoiceField,
} from '@/lib/business-os/setup/profileReadiness';
import { UNATTRIBUTED_SERVICE_ID } from '@/lib/business-os/reports/constants';

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

/**
 * What the onboarding chat decided about how this business runs.
 *
 * Written to the profile at signup and, until now, read by almost nothing —
 * which is why the dashboard asked every business the same nine setup questions
 * regardless of what it had already been told.
 */
interface BusinessShapeStats {
  /**
   * Payment plans defined on services.
   *
   * 'automatic' means at least one charges by itself, which runs as a Stripe
   * subscription schedule on the connected account — so the processor stops
   * being optional whatever the business said about how it usually takes money.
   */
  plans: 'none' | 'manual' | 'automatic';
  payment_mode: string | null;
  /** The explicit answer, once the chat starts asking how money is collected. */
  collection_method: string | null;
  online_presence_mode: string | null;
  has_priced_services: boolean;
}

interface CapabilityStats {
  /** The three answers that decide what this business has to configure. */
  business_shape: BusinessShapeStats;
  website: {
    status: 'active' | 'inactive';
    visitors_30d: number;
    bookings_30d: number;
    page_count: number;
    wants_website: boolean;
    has_live_pages: boolean;
    /** Live pages split by kind, and active smart links. */
    live_website_count?: number;
    live_landing_count?: number;
    smart_links_count?: number;
    /** Built and unpublished — "publish" rather than "create". */
    draft_website_count?: number;
    draft_landing_count?: number;
    /**
     * A client has some way to reach and book: a published site, a landing
     * page, or a smart link. Any one of them will do — which is the whole
     * point, since a business can sell without ever building a website.
     */
    is_reachable: boolean;
    has_smart_links: boolean;
    /**
     * The business has chosen its own colours and fonts, rather than sitting on
     * the platform's. Not only a website concern: the same theme is drawn on
     * the invoice PDF and every transactional email.
     */
    theme_customized: boolean;
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
    /** Services a client picks a time for — decides whether hours are needed. */
    scheduled_services_count: number;
    /** Priced services collected by card at booking — decides whether Stripe is needed. */
    online_services_count: number;
    /** Priced services billed afterwards — decides whether bank details are needed. */
    invoiced_services_count: number;
    /** Names of active services with no description — the website cannot describe them. */
    services_without_description: string[];
    open_days_count: number;
    stripe_connected: boolean;
    calendar_synced: boolean;
    calendar_provider: 'google_calendar' | 'outlook' | null;
    intake_enabled: boolean;
    /**
     * A form exists but nobody has approved it.
     *
     * The state every business lands in the moment onboarding writes their
     * intake, and the one the readiness card has to act on: `intake_enabled`
     * alone cannot tell "never set up" from "written, waiting to be read", and
     * those need different sentences.
     */
    intake_draft_pending: boolean;
    /**
     * A form exists and has been approved — regardless of the on/off switch.
     *
     * Separate from `intake_enabled`, which also asks whether the business
     * currently wants it. Without the distinction, a business that set intake
     * up and deliberately switched it off was told to "set up your intake" —
     * sent back to finish work it had finished and chosen to pause.
     */
    intake_published: boolean;
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
  /**
   * The two readiness steps that live in user settings. Absent — not false —
   * when the fields could not be read, so the dashboard can tell "not done"
   * apart from "not known" and omit the chips rather than nag wrongly.
   */
  profile_readiness?: {
    profile_complete: boolean;
    invoicing_complete: boolean;
    profile_missing: ProfileField[];
    invoicing_missing: InvoiceField[];
  };
  /** Connected social/analytics accounts. Null per platform = not connected. */
  channels: Record<
    'meta' | 'instagram' | 'google_analytics' | 'google_business_profile',
    { account_name: string | null; is_backfilling: boolean; needs_reconnect: boolean } | null
  >;
  payments: {
    status: 'active' | 'inactive';
    revenue_30d: number;
    /** Collected before refunds, over the reporting period. */
    gross_revenue_30d: number;
    /** Refunds ISSUED in the period, from the ledger — not refunds of this period's sales. */
    refunds_amount_30d: number;
    /** gross − refunds. */
    net_revenue_30d: number;
    /** What the processor kept out of the period's payments. */
    processor_fees_30d: number;
    /** How many of the period's payments the fee is known for, and for how many it is not. */
    processor_fees_known: number;
    processor_fees_unknown: number;
    /** Fees paid to collect money that was later refunded. Never returned. */
    refund_fees_kept_30d?: number;
    /** gross − refunds − fees. The figure that matches what the bank saw. */
    banked_revenue_30d: number;
    /** The currency every total in this block is denominated in. */
    primary_currency?: string | null;
    /**
     * The same figures per currency.
     *
     * The flat numbers add every currency together, as this endpoint always
     * has. This is the breakdown that does not.
     */
    revenue_by_currency: {
      currency: string;
      gross: number;
      refunds: number;
      net: number;
      refunds_issued: number;
    }[];
    revenue_paid_30d: number;
    revenue_owed_30d: number;
    /** Unpaid plan installments — owed money that is not an invoice. */
    plan_owed_amount: number;
    plan_pending_count: number;
    /** Revenue by origin, each payment counted once; these sum to revenue_30d. */
    source_direct_amount: number;
    source_direct_count: number;
    source_invoices_paid: number;
    source_invoices_outstanding: number;
    source_plans_paid: number;
    source_plans_outstanding: number;
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
    /** Charges accepted, whatever happened to the money afterwards. */
    charged_transactions_30d?: number;
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

    // An invoice past its due date is only counted as overdue once something
    // writes that status, and until now nothing did — the dashboard reported no
    // overdue invoices while they aged. Idempotent, and it usually writes
    // nothing, so it is cheap enough to do on the read that displays the count.
    const overdueRefresh = await paymentInvoiceRepository.markOverdueInvoices(user.id);
    if (overdueRefresh.error) {
      requestLogger.warn({ err: overdueRefresh.error, userId: user.id }, 'Could not refresh overdue invoices');
    }

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
      { data: serviceShapes },
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
      // Active smart links
      { count: activeSmartLinks },
      // Payment plan templates
      { data: paymentPlans },
      // Website bookings (bookings from website source)
      { count: websiteBookings30d },
      // === DETAILED BREAKDOWN RESULTS ===
      { data: bookingsByStatus },
      { data: contactsBySource },
      { count: activeLeads },
      { count: activeClients },
      { data: allTransactions30d },
      { data: allInvoices30d },
      { data: overdueInvoicesData },
      { count: formSubmissions30d },
      { data: revenueThisWeekData },
      { data: revenueLastWeekData },
      { data: paidInvoicesThisWeekData },
      { data: paidInvoicesLastWeekData },
      { data: paidInvoices30dData },
      { count: bookingsThisWeek },
      { count: bookingsLastWeek },
      { data: serviceRevenueTransactions, error: serviceRevenueTransactionsError },
      { data: serviceRevenueInvoices, error: serviceRevenueInvoicesError },
      { data: servicesForRevenue },
      { data: bookedValueThisWeekData },
      { data: bookedValueLastWeekData },
      { data: bookedValuePeriodData },
      { data: refundLedger30d },
      intakeSettingsResult,
      intakePublishedResult,
      intakeDraftResult,
      channelConnectionsResult,
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
      // Business profile: availability, userCode, and the answers that decide
      // what the dashboard asks for.
      //
      // The select used to name two columns while five were read off the
      // result. `online_presence_mode`, `payment_mode`, `collection_method`
      // and the calendar fields all came back undefined, so a business that
      // had chosen a booking link looked like one that had answered nothing —
      // and every rule downstream fell back to its "we don't know" branch,
      // which is what told it to publish a website it had declined.
      supabaseServer
        .from('business_profiles')
        .select(`
          scheduling_availability,
          user_code,
          online_presence_mode,
          payment_mode,
          collection_method,
          calendar_sync_enabled,
          calendar_sync_provider,
          theme
        `)
        .eq('user_id', user.id)
        .maybeSingle(),
      // Check for paid services (price > 0)
      supabaseServer
        .from('scheduling_services')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gt('price', 0),
      // The shape of what this business sells.
      //
      // Whether it needs working hours, a card processor or company and bank
      // details is not a property of the business — it is read off the
      // services. A practice taking a card for a session and invoicing for a
      // programme needs both; a consultancy that invoices for everything needs
      // no processor at all and must never be asked for one.
      supabaseServer
        .from('scheduling_services')
        // `service_name` and `description` ride along on the query that was
        // already being made: the website's copy for a service is written from
        // its description, so a service without one gets a paragraph the model
        // guessed from its name.
        .select('service_name, description, is_scheduled, collection, price')
        .eq('user_id', user.id)
        .eq('status', 'active'),
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
      //
      // `metadata` says whether a payment is a plan installment. Without it the
      // revenue-sources breakdown could only split money two ways — direct or
      // invoiced — and a plan payment was filed under "direct", which is the
      // one thing it is not.
      /*
       * `refunded` as well as `succeeded`, and `refunded_amount` alongside the
       * amount.
       *
       * These two go together and neither is safe alone. A FULL refund flips
       * `status` to 'refunded', so filtering on 'succeeded' deleted the sale
       * from revenue entirely — the business appeared never to have made it. A
       * PARTIAL refund leaves the status alone, so the whole original amount
       * went on counting as revenue. Widening the filter without subtracting
       * would raise the number; subtracting without widening would leave full
       * refunds invisible.
       *
       * `currency` because a refund must only ever be subtracted from money in
       * its own currency.
       */
      supabaseServer
        .from('payment_transactions')
        .select('amount, refunded_amount, currency, processor_fee, invoice_id, metadata')
        .eq('user_id', user.id)
        .in('status', ['succeeded', 'refunded'])
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
        .select('id, status, subdomain, custom_domain, page_type, theme')
        .eq('user_id', user.id),
      // A smart link is the third way a client can reach a booking page, and
      // the only one that needs no site at all.
      supabaseServer
        .from('smart_links')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_active', true),
      // Payment plans defined on services — the offer, not any one client's
      // agreement. Their processors decide whether Stripe is compulsory.
      supabaseServer
        .from('payment_plans')
        .select('allowed_processors, preferred_processor')
        .eq('user_id', user.id)
        .eq('is_active', true),
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
      // Payments: revenue this week (last 7 days). invoice_id comes along so a
      // paid invoice and the transaction that settled it count once, not twice.
      supabaseServer
        .from('payment_transactions')
        .select('amount, refunded_amount, currency, invoice_id')
        .eq('user_id', user.id)
        .in('status', ['succeeded', 'refunded'])
        .gte('created_at', sevenDaysAgo),
      // Payments: revenue last week (7-14 days ago)
      supabaseServer
        .from('payment_transactions')
        .select('amount, refunded_amount, currency, invoice_id')
        .eq('user_id', user.id)
        .in('status', ['succeeded', 'refunded'])
        .gte('created_at', fourteenDaysAgoDate)
        .lt('created_at', sevenDaysAgo),
      // Paid invoices this week (paid_at in last 7 days)
      /*
       * A refunded invoice was still PAID.
       *
       * `status` becomes 'refunded' or 'partially_refunded' by trigger, so
       * `.eq('status', 'paid')` silently dropped those invoices out of revenue
       * — money that genuinely arrived, vanishing because some of it later went
       * back. The refunded part is subtracted below rather than deleted here.
       */
      supabaseServer
        .from('payment_invoices')
        .select('id, amount, refunded_amount, currency')
        .eq('user_id', user.id)
        .in('status', ['paid', 'refunded', 'partially_refunded'])
        .gte('paid_at', sevenDaysAgo),
      // Paid invoices last week (paid_at 7-14 days ago)
      /*
       * A refunded invoice was still PAID.
       *
       * `status` becomes 'refunded' or 'partially_refunded' by trigger, so
       * `.eq('status', 'paid')` silently dropped those invoices out of revenue
       * — money that genuinely arrived, vanishing because some of it later went
       * back. The refunded part is subtracted below rather than deleted here.
       */
      supabaseServer
        .from('payment_invoices')
        .select('id, amount, refunded_amount, currency')
        .eq('user_id', user.id)
        .in('status', ['paid', 'refunded', 'partially_refunded'])
        .gte('paid_at', fourteenDaysAgoDate)
        .lt('paid_at', sevenDaysAgo),
      // Paid invoices 30 days (for total revenue)
      /*
       * A refunded invoice was still PAID.
       *
       * `status` becomes 'refunded' or 'partially_refunded' by trigger, so
       * `.eq('status', 'paid')` silently dropped those invoices out of revenue
       * — money that genuinely arrived, vanishing because some of it later went
       * back. The refunded part is subtracted below rather than deleted here.
       */
      supabaseServer
        .from('payment_invoices')
        .select('id, amount, refunded_amount, currency')
        .eq('user_id', user.id)
        .in('status', ['paid', 'refunded', 'partially_refunded'])
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
      // Revenue by service — money charged for a service, whichever way it came
      // in. Two sources, merged into one row per service below:
      //   * payment_transactions — direct/checkout payments
      //   * payment_invoices     — what was billed for the service
      // An invoice settled through Stripe also produces a transaction carrying
      // invoice_id, so the two are joined on that key rather than summed twice.
      supabaseServer
        .from('payment_transactions')
        .select('service_id, invoice_id, amount')
        .eq('user_id', user.id)
        .eq('status', 'succeeded')
        .gte('created_at', periodStart),
      supabaseServer
        .from('payment_invoices')
        .select('id, service_id, booking_id, amount, status')
        .eq('user_id', user.id)
        .in('status', ['pending', 'sent', 'overdue', 'paid'])
        .gte('created_at', periodStart),
      // Service names for those rows. Names live only on the service row, so a
      // deleted service leaves its revenue attributed but unnamed.
      supabaseServer
        .from('scheduling_services')
        .select('id, service_name')
        .eq('user_id', user.id),
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
      /*
       * Refunds that HAPPENED in this period, from the ledger.
       *
       * Deliberately not the `refunded_amount` columns, which are attributed to
       * the SALE's date: a refund issued today against a sale from two months
       * ago would silently restate a closed month, and the owner would watch a
       * number they had already reported change underneath them.
       *
       * The ledger carries the refund's own date, which is when a refund
       * belongs — the same basis every accounting system uses. `succeeded` only:
       * a pending or failed refund is not money that has left.
       */
      supabaseServer
        .from('payment_refunds')
        .select('amount, currency, succeeded_at')
        .eq('user_id', user.id)
        .eq('status', 'succeeded')
        .gte('succeeded_at', periodStart),
      // Intake form configuration (repository — no row means never set up)
      intakeRepository.getSettings(user.id),
      // The approved form, if there is one. `is_enabled` says the business
      // wants intake; only this says a client could actually receive it.
      intakeFormRepository.getPublished(user.id),
      intakeFormRepository.getDraft(user.id),
      // Connected social/analytics channels, for the readiness chips
      channelConnectionRepository.findByUser(user.id),
    ]);

    // Business profile and invoice details — the two readiness steps that live
    // in user settings rather than in the configuration dialog.
    //
    // Started here and awaited at the end, so it runs alongside the analytics
    // and milestone fetches below rather than adding a fourth sequential round
    // trip to an endpoint that already makes three.
    //
    // Kept out of the batch above and wrapped in its own catch because it reads
    // `logo_url`, which only exists once the business-logo migration has run.
    // A failure here means one absent block and two hidden chips, never a
    // degraded stats response.
    const profileReadinessPromise: Promise<
      | {
          profile_complete: boolean;
          invoicing_complete: boolean;
          profile_missing: ProfileField[];
          invoicing_missing: InvoiceField[];
        }
      | undefined
    > = (async () => {
      try {
        const [{ data: profileRow, error: profileError }, { data: orgRow }] = await Promise.all([
          supabaseServer
            .from('business_profiles')
            .select(
              'company_name, vertical, logo_url, invoice_company_name, invoice_tax_id, invoice_address, invoice_bank_name, invoice_bank_account, invoice_payment_instructions'
            )
            .eq('user_id', user.id)
            .maybeSingle(),
          // The rest of the same settings form. Keyed by owner, not user_id.
          supabaseServer
            .from('organizations')
            .select('settings')
            .eq('owner_user_id', user.id)
            .maybeSingle(),
        ]);

        if (profileError) throw profileError;

        const orgSettings = (orgRow?.settings ?? {}) as Record<string, string | null>;

        return {
          profile_complete: isBusinessProfileComplete(profileRow, orgSettings),
          invoicing_complete: isInvoicingComplete(profileRow),
          profile_missing: missingProfileFields(profileRow, orgSettings),
          invoicing_missing: missingInvoiceFields(profileRow),
        };
      } catch (err) {
        // Left undefined so the dashboard omits both chips. Claiming a step is
        // unfinished because we could not read it would nag about work that
        // may well be done.
        requestLogger.warn({ err }, 'Could not read profile readiness — chips omitted');
        return undefined;
      }
    })();

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

    // Revenue is collected money, and it is collected in exactly two shapes: a
    // payment_transaction, or an invoice marked paid outside one. An invoice
    // settled through Stripe is both — the transaction carries its invoice_id —
    // so the invoice side drops whatever a transaction already accounts for.
    type MoneyRow = {
      amount: number | string | null;
      refunded_amount?: number | string | null;
      currency?: string | null;
      processor_fee?: number | string | null;
    };
    type TransactionRow = MoneyRow & { invoice_id: string | null };
    type PaidInvoiceRow = MoneyRow & { id: string };

    /*
     * NET, not gross. The rules are in `lib/payments/revenueMath`, tested
     * there — this route is 1,500 lines and the arithmetic behind a number the
     * owner reports to other people should not be buried in the middle of it.
     */
    const sumNet = (rows: unknown): number => netRevenue((rows as MoneyRow[] | null) || []);
    const sumGross = (rows: unknown): number => grossRevenue((rows as MoneyRow[] | null) || []);

    const sumAmounts = sumNet;

    const settledInvoiceIdsIn = (transactions: unknown): Set<string> =>
      new Set(
        ((transactions as TransactionRow[] | null) || [])
          .map(t => t.invoice_id)
          .filter((id): id is string => !!id)
      );

    const invoicesNotSettledByTransaction = (invoices: unknown, transactions: unknown): PaidInvoiceRow[] => {
      const settled = settledInvoiceIdsIn(transactions);
      return ((invoices as PaidInvoiceRow[] | null) || []).filter(inv => !settled.has(inv.id));
    };

    // Net here as well: an invoice paid by bank transfer and later refunded is
    // money that came in and went back out, and only the difference is revenue.
    const sumInvoicesNotSettledByTransaction = (invoices: unknown, transactions: unknown): number =>
      sumNet(invoicesNotSettledByTransaction(invoices, transactions));

    const paymentTransactionsRevenue30d = sumAmounts(paymentsData);
    const paymentRevenueThisWeek = sumAmounts(revenueThisWeekData);
    const paymentRevenueLastWeek = sumAmounts(revenueLastWeekData);

    const invoiceRevenueThisWeek = sumInvoicesNotSettledByTransaction(paidInvoicesThisWeekData, revenueThisWeekData);
    const invoiceRevenueLastWeek = sumInvoicesNotSettledByTransaction(paidInvoicesLastWeekData, revenueLastWeekData);
    const invoiceRevenue30d = sumInvoicesNotSettledByTransaction(paidInvoices30dData, paymentsData);

    /*
     * Gross, refunds and net — shown together, because a net figure alone
     * cannot be checked.
     *
     * An owner looking at a number that dropped needs to see whether they sold
     * less or refunded more, and those are entirely different problems.
     */
    const invoicesOutsideTransactions30d = invoicesNotSettledByTransaction(
      paidInvoices30dData,
      paymentsData
    );

    const grossRevenue30d =
      sumGross(paymentsData) + sumGross(invoicesOutsideTransactions30d);

    // From the ledger, by the refund's own date — see the query.
    const refundsAmount30d =
      ((refundLedger30d as Array<{ amount: number | string | null }> | null) || []).reduce(
        (sum, row) => sum + (Number(row.amount) || 0),
        0
      );

    /*
     * Net is gross minus refunds ISSUED in the period, not minus the refunded
     * amounts carried on this period's sales. The two differ whenever a refund
     * crosses a month boundary, and this is the one that does not restate a
     * month that has already been reported.
     */
    const netRevenue30d = Math.round((grossRevenue30d - refundsAmount30d) * 100) / 100;

    /*
     * What the processor kept.
     *
     * Transactions only — an invoice settled outside Stripe (bank transfer, cash)
     * has no processing fee, and counting it as unknown would make the coverage
     * figure below look worse than it is.
     */
    const fees30d = processorFees(((paymentsData as MoneyRow[] | null) || []));

    /*
     * What the refunds cost in fees.
     *
     * Stripe keeps its processing fee on a refunded payment — that is what
     * makes a refund cost the business money instead of being neutral. So the
     * true cost of refunding is the refunded amount PLUS the fee that was
     * already paid to collect it and is not coming back.
     *
     * Distinct from `processor_fees_30d`, which is every fee on every payment.
     * These two coincide only on an account where everything was refunded.
     *
     * Read off the transaction, not off `payment_refunds.refund_fee`: that
     * column exists and is documented in the catalog, but nothing has ever
     * written to it, so it is null on every row.
     */
    const refundFeesKept30d =
      (((paymentsData as MoneyRow[] | null) || []))
        .filter(row => (Number(row.refunded_amount) || 0) > 0)
        .reduce((sum, row) => sum + (Number(row.processor_fee) || 0), 0);

    const revenueCurrencies = revenueByCurrency([
      ...(((paymentsData as MoneyRow[] | null) || [])),
      ...invoicesOutsideTransactions30d,
    ]);

    // Refunds counted the same way the money is: how much went back in each
    // currency, never added across them.
    const refundsByCurrency = (() => {
      const totals: Record<string, number> = {};
      for (const row of ((refundLedger30d as Array<{ amount: number | string | null; currency: string | null }> | null) || [])) {
        const currency = (row.currency || 'unknown').toUpperCase();
        totals[currency] = (totals[currency] ?? 0) + (Number(row.amount) || 0);
      }
      return totals;
    })();

    // Total weekly revenue = payment_transactions plus invoices paid outside them.
    // Bookings carry no amount of their own since total_amount was dropped, so
    // there is no third term here any more.
    const revenueThisWeek = paymentRevenueThisWeek + invoiceRevenueThisWeek;
    const revenueLastWeek = paymentRevenueLastWeek + invoiceRevenueLastWeek;

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

    /*
     * Payment transactions breakdown.
     *
     * A REFUNDED CHARGE SUCCEEDED. The card was charged; the money was returned
     * later, which is a separate event with its own row in `payment_refunds`.
     * The success rate on the reports page divides succeeded by
     * succeeded + failed, so every refunded sale used to vanish from BOTH sides
     * — an account with two refunded sales and two clean ones reported "2 of 2"
     * when four charges went through, and any account with failures alongside
     * refunds got a rate that was simply wrong.
     *
     * `charged` is what that rate should be built on: every charge the
     * processor accepted, whatever happened to the money afterwards.
     */
    const transactionCounts = { succeeded: 0, failed: 0, refunded: 0 };
    (allTransactions30d || []).forEach((t: { status: string }) => {
      if (t.status in transactionCounts) {
        transactionCounts[t.status as keyof typeof transactionCounts]++;
      }
    });
    const chargedTransactions30d = transactionCounts.succeeded + transactionCounts.refunded;

    // Invoice breakdown
    const invoiceCounts = { sent: 0, paid: 0 };
    let totalInvoiceAmount = 0;
    let paidInvoiceCount = 0;
    (allInvoices30d || []).forEach((inv: { status: string; amount: number }) => {
      /*
       * Everything that reached a client counts as sent — and OVERDUE is the
       * one that mattered.
       *
       * `markOverdueInvoices` rewrites a late invoice from 'sent' to 'overdue',
       * and this counted neither 'overdue' nor 'refunded'. So an invoice going
       * unpaid quietly left the denominator, and the collection rate climbed
       * back toward 100% as invoices aged — the rate reporting best at exactly
       * the moment collection was going worst, which is the failure this KPI
       * exists to catch.
       *
       * A refunded invoice was sent AND paid; the refund is a later event and
       * belongs to the refund rate, not to whether the client ever paid.
       * Draft and cancelled stay out: neither was ever owed.
       */
      if (
        inv.status === 'sent' ||
        inv.status === 'paid' ||
        inv.status === 'overdue' ||
        inv.status === 'refunded'
      ) {
        invoiceCounts.sent++;
      }
      if (inv.status === 'paid' || inv.status === 'refunded') invoiceCounts.paid++;
      // The average-invoice figures below stay on genuinely paid invoices: a
      // refunded one is money that came and went, and averaging it in would
      // overstate what a typical invoice is worth.
      if (inv.status === 'paid') {
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

    /**
     * Money owed on payment plans, which is owed money too.
     *
     * An installment is not an invoice — it becomes one only when it is charged
     * — so every figure here was blind to plan money: a business eleven months
     * into a twelve-month plan was reported as owed nothing, on the reports page
     * and on the dashboard both. The payments list already counted it, so the
     * two screens disagreed about the same debt.
     *
     * `paid` is settled and `cancelled` was called off; `pending` and `overdue`
     * are still coming. Not windowed, matching the pending-invoice figures above,
     * which are also all-time despite the `_30d` in the names they feed.
     *
     * Its own query rather than a 49th entry in the fan-out above: that array is
     * already the heaviest thing on this route, and this is one indexed read.
     */
    const { data: unpaidInstallments, error: installmentError } = await supabaseServer
      .from('payment_plan_installments')
      .select('amount')
      .eq('user_id', user.id)
      .in('status', ['pending', 'overdue']);

    if (installmentError) {
      // Said out loud. Swallowed, this reports a business with live plans as
      // owed nothing — which is the bug this block exists to fix.
      requestLogger.warn({ err: installmentError }, 'Could not read plan installments for owed totals');
    }

    const planOwedAmount = (unpaidInstallments || []).reduce(
      (sum: number, row: { amount: number }) => sum + (Number(row.amount) || 0),
      0
    );
    const planPendingCount = unpaidInstallments?.length || 0;

    /** Everything a client still owes, however it was arranged. */
    const totalOwedAmount = pendingInvoicesAmount + planOwedAmount;

    /**
     * Where the money came from, counted once each.
     *
     * The breakdown under the cards had two rows and summed to less than the
     * headline above it. Two reasons, both visible on one small account:
     *
     *   - Every succeeded payment was filed under "direct", including the ones
     *     settling an invoice and the ones paying a plan installment. The
     *     invoices row then had to SUBTRACT anything a payment had settled to
     *     avoid double counting — so an invoice paid by card showed as a row
     *     reading "1 invoice, 0.00", and its money appeared under direct.
     *   - Plans were not a row at all, so a plan's money — collected and owed
     *     alike — was missing from a total the reader compares against the
     *     headline figure.
     *
     * Each payment is now attributed to exactly one origin, which is what makes
     * the three rows add up to the revenue card above them.
     */
    const succeededPayments = (paymentsData || []) as Array<{
      amount: number;
      invoice_id: string | null;
      metadata: Record<string, unknown> | null;
    }>;

    const isPlanPayment = (row: { metadata: Record<string, unknown> | null }) =>
      row.metadata?.source === 'payment_plan';

    const planCollected = succeededPayments
      .filter(isPlanPayment)
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

    const invoiceCollected = succeededPayments
      .filter(row => !isPlanPayment(row) && row.invoice_id)
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

    const directPayments = succeededPayments.filter(row => !isPlanPayment(row) && !row.invoice_id);
    const directCollected = directPayments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

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

    // Three answers, all read from the services rather than asked.
    const shapes = (serviceShapes || []) as Array<{ service_name?: string | null; description?: string | null; is_scheduled?: boolean | null; collection?: string | null; price?: number | null }>;
    /** Services the website has nothing to say about. */
    const servicesWithoutDescription = shapes
      .filter(x => !x.description || x.description.trim().length === 0)
      .map(x => x.service_name || '')
      .filter(Boolean);
    const scheduledServicesCount = shapes.filter(x => x.is_scheduled !== false).length;
    const onlineServicesCount = shapes.filter(x => x.collection === 'online' && (x.price || 0) > 0).length;
    const invoicedServicesCount = shapes.filter(x => x.collection === 'invoice' && (x.price || 0) > 0).length;

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

    /**
     * Can this business be paid?
     *
     * One definition, shared with the charge paths, the refund path and the
     * public booking endpoints. There were three, and they disagreed: this one
     * read `onboarding_completed` — which is stored as `charges_enabled AND
     * payouts_enabled`, so it also refused a business whose money was merely
     * held pending verification — while the setup checklist used
     * `charges_enabled OR onboarding_completed`, which marked payments complete
     * for an account that could not charge at all.
     *
     * `charges_enabled` is Stripe's own answer to the only question being
     * asked, and it is the flag Stripe enforces when a charge is created.
     */
    const stripeCapability = await resolvePaymentCollectionCapability(supabaseServer, user.id);
    const stripeConnected = stripeCapability.canCollect;
    // Calendar sync status from business profile
    const calendarSynced = !!(businessProfile as any)?.calendar_sync_enabled;
    const calendarProvider = (businessProfile as any)?.calendar_sync_provider || null;

    // Calculate website stats
    const allPages = websitePages || [];
    const livePages = allPages.filter((p: any) => p.status === 'live');
    const hasLivePages = livePages.length > 0;
    /**
     * Whether this business wants a website at all.
     *
     * The presence mode is the business's own answer, given in onboarding, and
     * it overrules everything else: `booking_only` means a link they can paste
     * into WhatsApp and no site. The website capability is activated for
     * almost every account — it is what makes the builder available — so
     * reading it as "they want a site" told a business that had explicitly
     * declined one to go and publish it.
     *
     * A page that already exists still counts, whatever the mode says: someone
     * who has started building has changed their mind in the only way that
     * matters.
     */
    const presenceMode = (businessProfile as any)?.online_presence_mode ?? null;
    const wantsWebsite = allPages.length > 0
      || (presenceMode === 'booking_only' || presenceMode === 'none'
        ? false
        : activeCapabilityKeys.has('website'));

    // Can a client actually reach a booking page? Publishing a website is only
    // one of the three ways: a live landing page or an active smart link sells
    // just as well, and a business that took the smart-link route was being
    // told to build a site it does not need.
    const hasSmartLinks = (activeSmartLinks || 0) > 0;

    // Does any plan actually intend to charge by itself?
    //
    // Read from `preferred_processor` alone. `allowed_processors` defaults to
    // every processor the platform supports, so treating "stripe is allowed" as
    // "stripe will be used" classified virtually every plan as automatic —
    // inferring an intention out of a default nobody chose.
    //
    // Either way this only decides whether a card processor is OFFERED. A plan
    // never makes one compulsory: instalments are a schedule, and a business
    // can invoice each one and take a transfer.
    const planKind: 'none' | 'manual' | 'automatic' = (() => {
      const plans = paymentPlans || [];
      if (plans.length === 0) return 'none';

      const chargesItself = plans.some(
        (plan: any) => plan.preferred_processor && plan.preferred_processor !== 'manual'
      );

      return chargesItself ? 'automatic' : 'manual';
    })();
    const isReachable = hasLivePages || hasSmartLinks;

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

    // Has the business chosen a look of its own? The homepage carries the theme
    // the emails and invoice PDF are drawn from, so this is not only a website
    // question.
    // The business's own look first, a page's second.
    //
    // Read from the homepage alone, the design step could never complete for a
    // business without a website — the very businesses that now can set a look,
    // and whose invoices and emails use it.
    const themePage = allPages.find((p: any) => p.page_type === 'homepage') || allPages[0];
    const themeCustomized = isThemeCustomized(
      ((businessProfile as any)?.theme) ?? themePage?.theme
    );

    // === REVENUE BY SERVICE ===
    // One row per service, whatever the money came in through: a direct payment
    // or an invoice. An invoice settled through Stripe exists on both sides —
    // the transaction carries invoice_id — so those are counted once.
    //
    // An invoice names its service in service_id, or implies it through the
    // booking it was raised for. Plenty of money legitimately belongs to no
    // catalogue service — ad-hoc invoices, deposits, work billed one-off — and
    // older invoices predate the service_id column. None of it is guessed at
    // from line-item text; it collects in one unattributed row instead, so the
    // breakdown always adds up to the revenue shown above it.
    if (serviceRevenueTransactionsError || serviceRevenueInvoicesError) {
      requestLogger.warn({
        err: serviceRevenueTransactionsError || serviceRevenueInvoicesError
      }, 'Revenue-by-service source query failed; the breakdown will be short');
    }

    const serviceNameById = new Map<string, string>(
      (servicesForRevenue || []).map((s: { id: string; service_name: string }) => [s.id, s.service_name])
    );

    // Resolve the service for invoices that only know their booking.
    type RevenueInvoice = {
      id: string;
      service_id: string | null;
      booking_id: string | null;
      amount: number | string | null;
      status: string;
    };
    const revenueInvoices = (serviceRevenueInvoices || []) as RevenueInvoice[];
    const bookingServiceById = new Map<string, string>();
    const unattributedBookingIds = Array.from(new Set(
      revenueInvoices
        .filter(inv => !inv.service_id && inv.booking_id)
        .map(inv => inv.booking_id as string)
    ));
    if (unattributedBookingIds.length > 0) {
      const { data: invoiceBookings, error: invoiceBookingsError } = await supabaseServer
        .from('scheduling_bookings')
        .select('id, service_id')
        .eq('user_id', user.id)
        .in('id', unattributedBookingIds);
      if (invoiceBookingsError) {
        requestLogger.warn({ err: invoiceBookingsError }, 'Failed to resolve invoice bookings for revenue by service');
      }
      (invoiceBookings || []).forEach((b: { id: string; service_id: string | null }) => {
        if (b.service_id) bookingServiceById.set(b.id, b.service_id);
      });
    }

    const invoiceServiceId = (inv: RevenueInvoice): string | null =>
      inv.service_id || (inv.booking_id ? bookingServiceById.get(inv.booking_id) ?? null : null);

    const serviceRevenueMap: Record<string, { service_name: string; revenue: number; count: number }> = {};
    const addServiceRevenue = (serviceId: string | null, amount: number | string | null) => {
      const key = serviceId || UNATTRIBUTED_SERVICE_ID;
      if (!serviceRevenueMap[key]) {
        serviceRevenueMap[key] = {
          // The client localizes the unattributed row; a service that has since
          // been deleted keeps its money but loses its name.
          service_name: serviceId ? serviceNameById.get(serviceId) || 'Unknown Service' : 'Other',
          revenue: 0,
          count: 0
        };
      }
      // amount is DECIMAL and may arrive as a string.
      serviceRevenueMap[key].revenue += Number(amount) || 0;
      serviceRevenueMap[key].count += 1;
    };

    const invoiceById = new Map<string, RevenueInvoice>(revenueInvoices.map(inv => [inv.id, inv]));
    const settledInvoiceIds = new Set<string>();

    type RevenueTransaction = { service_id: string | null; invoice_id: string | null; amount: number | string | null };
    ((serviceRevenueTransactions || []) as RevenueTransaction[]).forEach(tx => {
      const linkedInvoice = tx.invoice_id ? invoiceById.get(tx.invoice_id) : undefined;
      if (linkedInvoice) settledInvoiceIds.add(linkedInvoice.id);
      // A payment raised against an invoice inherits that invoice's service.
      addServiceRevenue(tx.service_id || (linkedInvoice ? invoiceServiceId(linkedInvoice) : null), tx.amount);
    });

    revenueInvoices.forEach(inv => {
      if (settledInvoiceIds.has(inv.id)) return; // already counted as its transaction
      addServiceRevenue(invoiceServiceId(inv), inv.amount);
    });

    // Biggest service first, with the unattributed row pinned last however large
    // it is — it is a remainder, not a service competing for the top of the list.
    const serviceRevenueArray = Object.entries(serviceRevenueMap)
      .map(([service_id, data]) => ({
        service_id,
        service_name: data.service_name,
        revenue: data.revenue,
        count: data.count
      }))
      .sort((a, b) => {
        if (a.service_id === UNATTRIBUTED_SERVICE_ID) return 1;
        if (b.service_id === UNATTRIBUTED_SERVICE_ID) return -1;
        return b.revenue - a.revenue;
      });

    // What the service rows add up to. This is the same money already counted in
    // payments.revenue_30d, sliced by service — reporting it under `scheduling`
    // as well is a second view of it, not a second amount to be added anywhere.
    const serviceRevenueTotal = serviceRevenueArray.reduce((sum, s) => sum + s.revenue, 0);

    // Started well above so it overlapped the analytics and milestone fetches.
    const profileReadiness = await profileReadinessPromise;

    // 7. Build capability stats object
    // A capability is "active" if:
    // - It's a core capability (is_core=true in capabilities table), OR
    // - It's in user_capabilities with is_active=true, OR
    // - It has data (for capabilities that auto-activate on first use)
    const stats: CapabilityStats = {
      business_shape: {
        plans: planKind,
        payment_mode: (businessProfile as any)?.payment_mode ?? null,
        collection_method: (businessProfile as any)?.collection_method ?? null,
        online_presence_mode: presenceMode,
        has_priced_services: hasPaidServices,
      },
      website: {
        status: activeCapabilityKeys.has('website') ? 'active' : 'inactive',
        visitors_30d: websiteVisitors30d,
        bookings_30d: websiteBookings30d || 0,
        page_count: allPages.length,
        wants_website: wantsWebsite,
        has_live_pages: hasLivePages,
        is_reachable: isReachable,
        has_smart_links: hasSmartLinks,
        /*
         * The owned surfaces, counted apart.
         *
         * `has_live_pages` is true for a site OR a landing page, which is the
         * right test for "can a client reach you" and the wrong one for naming
         * what they reach. A business whose only live page is a landing page
         * was shown a row that said "Website" — claiming something it does not
         * have, and hiding the thing it does.
         *
         * `page_type` is already in the select above, so this costs no query.
         */
        live_website_count: livePages.filter((p: any) => p.page_type === 'homepage').length,
        live_landing_count: livePages.filter((p: any) => p.page_type === 'landing').length,
        smart_links_count: activeSmartLinks || 0,
        /*
         * Built but not published — a different prompt from having nothing.
         *
         * Offering "create a landing page" to a business that already wrote one
         * and left it in draft is the platform failing to look. The panel says
         * "publish" instead, which is one click from done.
         */
        draft_website_count: allPages.filter(
          (p: any) => p.page_type === 'homepage' && p.status !== 'live'
        ).length,
        draft_landing_count: allPages.filter(
          (p: any) => p.page_type === 'landing' && p.status !== 'live'
        ).length,
        theme_customized: themeCustomized,
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
        scheduled_services_count: scheduledServicesCount,
        online_services_count: onlineServicesCount,
        invoiced_services_count: invoicedServicesCount,
        services_without_description: servicesWithoutDescription,
        open_days_count: openDaysCount,
        stripe_connected: stripeConnected,
        calendar_synced: calendarSynced,
        calendar_provider: calendarProvider,
        /*
         * Complete means a client could receive it: switched on AND published.
         *
         * This read `is_enabled` alone, which marked the step done for a
         * business whose only form was an unread draft — the readiness card
         * said "configured" about something that sends nobody anything.
         */
        intake_enabled:
          !!intakeSettingsResult?.data?.is_enabled && !!intakePublishedResult?.data,
        // Written, not yet approved. The card turns this into "review and
        // publish" rather than "set up".
        intake_draft_pending:
          !!intakeDraftResult?.data && !intakePublishedResult?.data,
        intake_published: !!intakePublishedResult?.data,
        // Weekly comparison
        bookings_this_week: bookingsThisWeek || 0,
        bookings_last_week: bookingsLastWeek || 0,
        // Detailed breakdown
        confirmed_30d: bookingStatusCounts.confirmed,
        completed_30d: bookingStatusCounts.completed,
        cancelled_30d: bookingStatusCounts.cancelled,
        no_show_30d: bookingStatusCounts.no_show,
        // What the service_revenue rows below add up to — the same money as
        // payments.revenue_30d, restricted to what could be tied to a service.
        total_revenue_30d: serviceRevenueTotal,
        // Value of what was booked (ordered), paid or not — priced from the
        // service. Distinct from total_revenue_30d above, which is money billed
        // or collected rather than ordered.
        booked_value_this_week: bookedValueThisWeek,
        booked_value_last_week: bookedValueLastWeek,
        booked_value_period: bookedValuePeriod,
        // Revenue by service
        service_revenue: serviceRevenueArray,
        // Milestone data
        first_booking_date: firstBookingDate,
        // first_booking_amount removed - total_amount no longer on scheduling_bookings
      },
      // The two readiness steps configured in user settings. Omitted entirely
      // when the fields could not be read, so the dashboard can tell "not done"
      // apart from "not known" and hide the chips rather than nag wrongly.
      ...(profileReadiness ? { profile_readiness: profileReadiness } : {}),
      // Social and analytics accounts the user has opted into having analysed.
      // Drives the readiness chips; absent rows simply mean "not connected".
      channels: (() => {
        const rows = channelConnectionsResult?.data ?? [];
        const enabled = rows.filter(c => c.insights_enabled);
        const staleBefore = Date.now() - 48 * 60 * 60 * 1000;

        const forPlatform = (platform: string) => {
          const row = enabled.find(c => c.platform === platform);
          if (!row) return null;
          const syncedAt = row.last_synced_at ? new Date(row.last_synced_at).getTime() : 0;
          return {
            account_name: row.account_name,
            // Only set on a successful sync, so a repeatedly failing connection
            // must not read as "still fetching" indefinitely.
            is_backfilling: !row.backfill_completed_at && !row.last_sync_error,
            // Meta tokens are long-lived but not refreshable, so connections do
            // expire — surfaced as a reconnect prompt rather than silent staleness.
            needs_reconnect: !!row.last_sync_error || (syncedAt > 0 && syncedAt < staleBefore),
          };
        };

        return {
          meta: forPlatform('facebook_page'),
          instagram: forPlatform('instagram'),
          google_analytics: forPlatform('ga4'),
          google_business_profile: forPlatform('google_business_profile'),
        };
      })(),
      payments: {
        // Core capability - always active
        status: activeCapabilityKeys.has('payments') ? 'active' : 'inactive',
        // Total revenue = paid + owed (pending invoices).
        // The by-service breakdown is a view over these same transactions and
        // invoices, never a third source, so it is not added here.
        revenue_30d: paymentTransactionsRevenue30d + invoiceRevenue30d + totalOwedAmount,
        /*
         * What the money actually did this period.
         *
         * `revenue_30d` above is collected PLUS owed — a forecast, not takings —
         * and it is what several cards already read, so it is left alone. These
         * three are the accounting view: what came in, what went back, and the
         * difference.
         */
        gross_revenue_30d: Math.round(grossRevenue30d * 100) / 100,
        refunds_amount_30d: Math.round(refundsAmount30d * 100) / 100,
        net_revenue_30d: netRevenue30d,
        /*
         * What Stripe kept, and what the business actually banked.
         *
         * No fee column existed anywhere before this, so every figure this
         * endpoint returned was what the CLIENT paid. On a ₪200 card payment
         * that overstates the business's takings by about ₪6.30 — and a refunded
         * payment by the whole fee, since Stripe does not give it back.
         */
        processor_fees_30d: fees30d.total,
        /*
         * How many payments the fee is actually known for.
         *
         * Published rather than hidden: fees are backfilled from Stripe, so a
         * business mid-backfill would otherwise see a suspiciously small fee
         * total with nothing saying why.
         */
        processor_fees_known: fees30d.known,
        processor_fees_unknown: fees30d.unknown,
        /** Fees already paid on money that was then refunded, and not returned. */
        refund_fees_kept_30d: Math.round(refundFeesKept30d * 100) / 100,
        /** gross − refunds − fees. What the bank balance actually moved by. */
        banked_revenue_30d: Math.round((netRevenue30d - fees30d.total) * 100) / 100,
        /** The same three per currency, since only these may honestly be added. */
        revenue_by_currency: revenueCurrencies.map(row => ({
          ...row,
          refunds_issued: Math.round((refundsByCurrency[row.currency] ?? 0) * 100) / 100,
        })),
        /*
         * WHICH CURRENCY THE FIGURES ABOVE ARE IN.
         *
         * Every total on this response is a bare number, and the dashboard was
         * stamping a symbol on it chosen from the UI LANGUAGE — Hebrew meant
         * shekels. A business billing in dollars and working in Hebrew read
         * every figure as ₪, so $523 refunded appeared as ₪523. Not a
         * conversion: a mislabel, and at roughly 3.7 to 1 it is not a small one.
         *
         * The currency of money is a property of the money. This reports the
         * one the period's revenue is actually in — the largest by gross where
         * a business bills in more than one, since the totals above are already
         * summed and a single label is the only honest thing to put on them.
         * `revenue_by_currency` remains the answer for anyone who needs them
         * kept apart.
         *
         * Null when nothing was collected: there is no currency to name, and
         * the caller should fall back to its own default rather than be handed
         * a guess.
         */
        primary_currency:
          revenueCurrencies.length > 0
            ? revenueCurrencies.reduce((biggest, row) =>
                row.gross > biggest.gross ? row : biggest
              ).currency
            : null,
        // Revenue already collected (paid)
        revenue_paid_30d: paymentTransactionsRevenue30d + invoiceRevenue30d,
        // Revenue owed: unpaid invoices AND unpaid plan installments. An
        // installment is owed money that is not an invoice, and counting only
        // invoices reported a live payment plan as nothing outstanding.
        revenue_owed_30d: totalOwedAmount,
        /** The plan half of what is owed, so a caller can name it separately. */
        plan_owed_amount: planOwedAmount,
        plan_pending_count: planPendingCount,

        // Revenue by origin, each payment counted once. These three add up to
        // `revenue_30d`, which the two-row breakdown they replace did not.
        source_direct_amount: directCollected,
        source_direct_count: directPayments.length,
        source_invoices_paid: invoiceCollected + invoiceRevenue30d,
        source_invoices_outstanding: pendingInvoicesAmount,
        source_plans_paid: planCollected,
        source_plans_outstanding: planOwedAmount,
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
        /** Charges the processor accepted, refunded ones included. */
        charged_transactions_30d: chargedTransactions30d,
        /*
         * How many refunds were ISSUED, not how many transactions ended up
         * fully refunded.
         *
         * This counted `status === 'refunded'`, which only a FULL refund
         * produces — so a month of partial refunds reported zero, and a
         * transaction refunded twice counted once. The ledger has one row per
         * refund, which is the thing being counted.
         */
        refunded_30d: (refundLedger30d ?? []).length,
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
