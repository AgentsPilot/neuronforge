/**
 * Scheduling Repository
 * Handles all database operations for scheduling services and bookings
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'SchedulingRepository' });

// ==================== SERVICE TYPES ====================

export type ServiceStatus = 'draft' | 'active' | 'inactive';
export type ServiceSource = 'manual' | 'ai_generated' | 'template' | 'imported';
export type ServiceCurrency = 'USD' | 'EUR' | 'ILS' | 'GBP';
export type PaymentType = 'full' | 'installments';
export type InstallmentFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
export type FirstPaymentDue = 'on_booking' | 'days_after';

/**
 * How money for one service arrives.
 *
 * Per service, not per business: a practice can sell an appointment paid by
 * card and a programme billed against an invoice, and only the first of those
 * needs a card processor connected. Null means the service is free, or that
 * nobody has said yet.
 */
export type ServiceCollection = 'online' | 'invoice';

/**
 * Whether a client can buy this outright, or has to be quoted first.
 *
 * The third fact that decides a service's client journey, beside
 * `is_scheduled` and `collection`. `proposal` means the journey stops after
 * the client leaves their details: there is no price to show and no card to
 * take until the owner has quoted the job.
 */
export type ServiceSaleMode = 'direct' | 'proposal';

export interface ServiceAISuggestions {
  reasoning: string;
  confidence: number;
  source: 'bio_extraction' | 'vertical_default' | 'industry_standard';
}

export interface SchedulingService {
  id: string;
  user_id: string;
  service_name: string;
  description: string | null;
  /** Null for a service not booked against a time — a product or deliverable. */
  duration_minutes: number | null;
  price: number | null;
  currency: ServiceCurrency;
  /** Does booking this involve picking a time? False for a product. */
  is_scheduled: boolean;
  /** How the money arrives. Null while the service is free. */
  collection: ServiceCollection | null;
  /** Bought outright, or quoted first. NOT NULL DEFAULT 'direct'. */
  sale_mode: ServiceSaleMode;
  buffer_minutes: number;
  max_bookings_per_day: number | null;
  advance_booking_days: number;
  min_notice_hours: number;
  availability: Record<string, any>; // JSONB
  is_active: boolean;
  status: ServiceStatus;
  source: ServiceSource;
  ai_suggestions: ServiceAISuggestions | null;
  // Payment options
  payment_type: PaymentType;
  installment_count: number;
  installment_frequency: InstallmentFrequency;
  first_payment_due: FirstPaymentDue;
  first_payment_days: number;
  created_at: string;
  updated_at: string;
}

export interface SchedulingServiceInsert {
  user_id: string;
  service_name: string;
  description?: string | null;
  duration_minutes?: number | null;
  price?: number | null;
  currency?: ServiceCurrency;
  is_scheduled?: boolean;
  collection?: ServiceCollection | null;
  sale_mode?: ServiceSaleMode;
  buffer_minutes?: number;
  max_bookings_per_day?: number | null;
  advance_booking_days?: number;
  min_notice_hours?: number;
  availability?: Record<string, any>;
  is_active?: boolean;
  status?: ServiceStatus;
  source?: ServiceSource;
  ai_suggestions?: ServiceAISuggestions | null;
  // Payment options
  payment_type?: PaymentType;
  installment_count?: number;
  installment_frequency?: InstallmentFrequency;
  first_payment_due?: FirstPaymentDue;
  first_payment_days?: number;
}

export interface SchedulingServiceUpdate {
  service_name?: string;
  description?: string | null;
  duration_minutes?: number | null;
  price?: number | null;
  currency?: ServiceCurrency;
  is_scheduled?: boolean;
  collection?: ServiceCollection | null;
  sale_mode?: ServiceSaleMode;
  buffer_minutes?: number;
  max_bookings_per_day?: number | null;
  advance_booking_days?: number;
  min_notice_hours?: number;
  availability?: Record<string, any>;
  is_active?: boolean;
  status?: ServiceStatus;
  // Payment options
  payment_type?: PaymentType;
  installment_count?: number;
  installment_frequency?: InstallmentFrequency;
  first_payment_due?: FirstPaymentDue;
  first_payment_days?: number;
}

// ==================== BOOKING TYPES ====================

export type CalendarSyncProvider = 'google_calendar' | 'outlook';

// Contact data returned from JOIN
export interface BookingContact {
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
}

export interface SchedulingBooking {
  id: string;
  user_id: string;
  service_id: string;
  contact_id: string; // Required - client data is in crm_contacts
  start_time: string;
  end_time: string;
  timezone: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  cancellation_reason: string | null;
  payment_status: 'pending' | 'paid' | 'refunded';
  payment_id: string | null;
  notes: string | null;
  internal_notes: string | null;
  booking_source: string;
  reminder_24hr_sent: boolean;
  reminder_2hr_sent: boolean;
  // Calendar sync fields
  external_calendar_event_id: string | null;
  calendar_sync_provider: CalendarSyncProvider | null;
  calendar_synced_at: string | null;
  calendar_sync_error: string | null;
  // Intake fields
  intake_responses: {
    template_id: string;
    template_key: string;
    responses: Record<string, unknown>;
  } | null;
  intake_completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Contact data from JOIN (populated by repository when using findById/list with JOIN)
  contact?: BookingContact;
  // Convenience fields (derived from contact for backward compatibility)
  client_first_name?: string | null;
  client_last_name?: string | null;
  client_email?: string;
  client_phone?: string | null;
  // Invoice data from JOIN (populated by repository when using findById/list with JOIN)
  invoice?: {
    id: string;
    status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
    amount: number;
    paid_at: string | null;
    due_date: string | null;
    sent_at: string | null;
  } | null;
}

export interface SchedulingBookingInsert {
  user_id: string;
  service_id: string;
  contact_id: string; // Required - must create/find contact first
  start_time: string;
  end_time: string;
  timezone?: string;
  status?: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  payment_status?: 'pending' | 'paid' | 'refunded';
  notes?: string | null;
  internal_notes?: string | null;
  booking_source?: string;
}

export interface SchedulingBookingUpdate {
  status?: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  cancellation_reason?: string | null;
  payment_status?: 'pending' | 'paid' | 'refunded';
  payment_id?: string | null;
  internal_notes?: string | null;
  reminder_24hr_sent?: boolean;
  reminder_2hr_sent?: boolean;
  // Rescheduling fields
  start_time?: string;
  end_time?: string;
  // Calendar sync fields
  external_calendar_event_id?: string | null;
  calendar_sync_provider?: CalendarSyncProvider | null;
  calendar_synced_at?: string | null;
  calendar_sync_error?: string | null;
  // Intake fields
  intake_responses?: {
    template_id: string;
    template_key: string;
    responses: Record<string, unknown>;
  } | null;
  intake_completed_at?: string | null;
}

export interface SchedulingRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== SCHEDULING SERVICE REPOSITORY ====================

export class SchedulingServiceRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Create a new service
   */
  async create(
    service: SchedulingServiceInsert
  ): Promise<SchedulingRepositoryResult<SchedulingService>> {
    try {
      logger.info({
        userId: service.user_id,
        serviceName: service.service_name,
        status: service.status || 'active',
        source: service.source || 'manual'
      }, 'Creating scheduling service');

      const { data, error } = await this.supabase
        .from('scheduling_services')
        .insert({
          ...service,
          buffer_minutes: service.buffer_minutes ?? 15,
          advance_booking_days: service.advance_booking_days ?? 30,
          min_notice_hours: service.min_notice_hours ?? 24,
          availability: service.availability || {},
          is_active: service.is_active ?? true,
          status: service.status ?? 'active',
          source: service.source ?? 'manual',
          currency: service.currency ?? 'ILS',
          ai_suggestions: service.ai_suggestions || null
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ serviceId: data.id, userId: service.user_id, status: data.status }, 'Scheduling service created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: service.user_id }, 'Failed to create scheduling service');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create multiple services at once (for AI-generated drafts)
   */
  async createMany(
    services: SchedulingServiceInsert[]
  ): Promise<SchedulingRepositoryResult<SchedulingService[]>> {
    try {
      if (services.length === 0) {
        return { data: [], error: null };
      }

      const userId = services[0].user_id;
      logger.info({ userId, count: services.length }, 'Creating multiple scheduling services');

      const insertData = services.map(service => ({
        ...service,
        buffer_minutes: service.buffer_minutes ?? 15,
        advance_booking_days: service.advance_booking_days ?? 30,
        min_notice_hours: service.min_notice_hours ?? 24,
        availability: service.availability || {},
        is_active: service.is_active ?? false, // Drafts start inactive
        status: service.status ?? 'draft',
        source: service.source ?? 'ai_generated',
        currency: service.currency ?? 'ILS',
        ai_suggestions: service.ai_suggestions || null
      }));

      const { data, error } = await this.supabase
        .from('scheduling_services')
        .insert(insertData)
        .select();

      if (error) throw error;

      logger.info({ userId, created: data?.length || 0 }, 'Multiple scheduling services created');
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create multiple scheduling services');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Publish a draft service (change status from draft to active)
   */
  async publish(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingService>> {
    try {
      logger.info({ serviceId: id, userId }, 'Publishing draft service');

      const { data, error } = await this.supabase
        .from('scheduling_services')
        .update({ status: 'active', is_active: true })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', 'draft') // Only publish drafts
        .select()
        .single();

      if (error) throw error;

      logger.info({ serviceId: id, userId }, 'Draft service published');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, serviceId: id, userId }, 'Failed to publish draft service');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List draft services for user
   */
  async listDrafts(
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingService[]>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_services')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list draft services');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find service by ID
   */
  async findById(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingService>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_services')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, serviceId: id, userId }, 'Failed to find scheduling service');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List all services for user
   */
  /**
   * What "bookable" means, in one place.
   *
   * Two independent flags have to hold: `is_active` is the Power toggle the
   * owner flips, and `status` is draft versus published. They answer different
   * questions, and every public surface has to ask both — filtering on one let
   * a deactivated service disappear from the website while every smart link
   * went on selling it.
   *
   * Exported as a rule rather than repeated as a pair of `.eq()` calls so the
   * next surface cannot pick one and forget the other.
   */
  static readonly BOOKABLE = { is_active: true, status: 'active' as const };

  async listAll(
    userId: string,
    activeOnly: boolean = false
  ): Promise<SchedulingRepositoryResult<SchedulingService[]>> {
    try {
      let query = this.supabase
        .from('scheduling_services')
        .select('*')
        .eq('user_id', userId);

      if (activeOnly) {
        query = query.match(SchedulingServiceRepository.BOOKABLE);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list scheduling services');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update service
   */
  async update(
    id: string,
    userId: string,
    updates: SchedulingServiceUpdate
  ): Promise<SchedulingRepositoryResult<SchedulingService>> {
    try {
      logger.info({ serviceId: id, userId }, 'Updating scheduling service');

      const { data, error } = await this.supabase
        .from('scheduling_services')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ serviceId: id, userId }, 'Scheduling service updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, serviceId: id, userId }, 'Failed to update scheduling service');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Count bookings for a service
   * Used to check if a service can be deleted
   */
  async countBookings(
    serviceId: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<number>> {
    try {
      // Count bookings for this service, scoped to the owner. `user_id` is included (not just
      // `service_id`) so this method is safe to call standalone — e.g. as the `count_bookings`
      // plugin operation — without leaking another tenant's counts for a guessed service_id.
      const { count, error } = await this.supabase
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('service_id', serviceId)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ serviceId, userId, bookingCount: count }, 'Counted service bookings');
      return { data: count ?? 0, error: null };
    } catch (error) {
      logger.error({ err: error, serviceId, userId }, 'Failed to count service bookings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete service (only if no bookings exist)
   */
  async delete(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<{ deleted: boolean; bookingCount?: number }>> {
    try {
      logger.info({ serviceId: id, userId }, 'Attempting to delete scheduling service');

      // First check if service has any bookings
      const bookingCountResult = await this.countBookings(id, userId);
      if (bookingCountResult.error) throw bookingCountResult.error;

      const bookingCount = bookingCountResult.data ?? 0;
      if (bookingCount > 0) {
        logger.warn({ serviceId: id, userId, bookingCount }, 'Cannot delete service with existing bookings');
        return { data: { deleted: false, bookingCount }, error: null };
      }

      const { error } = await this.supabase
        .from('scheduling_services')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ serviceId: id, userId }, 'Scheduling service deleted');
      return { data: { deleted: true }, error: null };
    } catch (error) {
      logger.error({ err: error, serviceId: id, userId }, 'Failed to delete scheduling service');
      return { data: null, error: error as Error };
    }
  }
}

// ==================== SCHEDULING BOOKING REPOSITORY ====================


/**
 * How much of a booking's money has gone back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A booking's payments are attached two different ways, and a booking can have
 * both at once: a website sale writes `booking_id` on the transaction, while an
 * invoice raised for the booking carries the link on the invoice.
 *
 * So both are summed — and the invoice's own `refunded_amount` is DERIVED from
 * its transactions by trigger, which means a transaction carrying both links
 * would be counted twice. Those are excluded by invoice id.
 *
 * Needed because the CRM's journey strip showed nothing for a refund: a partial
 * refund leaves `payment_status` at `paid`, and a payment-plan booking has no
 * invoice at all, so neither of the two things the tab was reading could see it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function refundedTotalFor(
  invoice: { id?: string; refunded_amount?: number | string | null } | null | undefined,
  payments: { invoice_id?: string | null; refunded_amount?: number | string | null; status?: string }[]
): number {
  const fromInvoice = Number(invoice?.refunded_amount ?? 0) || 0;

  const fromPayments = (payments ?? [])
    .filter(p => p.status === 'succeeded' || p.status === 'refunded')
    // Already represented in the invoice's figure.
    .filter(p => !invoice?.id || p.invoice_id !== invoice.id)
    .reduce((sum, p) => sum + (Number(p.refunded_amount ?? 0) || 0), 0);

  return Math.round((fromInvoice + fromPayments) * 100) / 100;
}

export class SchedulingBookingRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Check for overlapping bookings (double booking prevention)
   * Returns bookings that overlap with the given time range
   */
  async checkOverlap(
    userId: string,
    startTime: string,
    endTime: string,
    excludeBookingId?: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking[]>> {
    try {
      // Find bookings that overlap with the requested time slot
      // Overlap occurs when: existing_start < new_end AND existing_end > new_start
      let query = this.supabase
        .from('scheduling_bookings')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['confirmed', 'completed']) // Only check active bookings
        .lt('start_time', endTime)
        .gt('end_time', startTime);

      // Exclude current booking when editing
      if (excludeBookingId) {
        query = query.neq('id', excludeBookingId);
      }

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, startTime, endTime }, 'Failed to check booking overlap');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create a new booking
   */
  async create(
    booking: SchedulingBookingInsert
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    try {
      logger.info(
        { userId: booking.user_id, serviceId: booking.service_id, contactId: booking.contact_id },
        'Creating booking'
      );

      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .insert({
          user_id: booking.user_id,
          service_id: booking.service_id,
          contact_id: booking.contact_id,
          start_time: booking.start_time,
          end_time: booking.end_time,
          timezone: booking.timezone || 'UTC',
          status: booking.status || 'confirmed',
          payment_status: booking.payment_status || 'pending',
          notes: booking.notes,
          internal_notes: booking.internal_notes,
          booking_source: booking.booking_source || 'manual'
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ bookingId: data.id, userId: booking.user_id, contactId: booking.contact_id }, 'Booking created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: booking.user_id }, 'Failed to create booking');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find booking by ID with contact data and invoice status
   */
  async findById(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    try {
      // JOIN to crm_contacts for client data and payment_invoices for accurate payment status
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select(`
          *,
          contact:crm_contacts(
            first_name,
            last_name,
            email,
            phone
          ),
          invoice:payment_invoices!payment_invoices_booking_id_fkey(id, status, amount, paid_at, due_date, sent_at, refunded_amount, refund_status, refunded_at),
          payments:payment_transactions!payment_transactions_booking_id_fkey(id, amount, refunded_amount, status, invoice_id)
        `)
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      // Extract contact data from JOIN result
      const contact = Array.isArray(data?.contact) ? data.contact[0] : data?.contact;
      // Get invoice if exists
      const invoice = Array.isArray(data?.invoice) ? data.invoice[0] : data?.invoice;

      // Determine payment status - prefer invoice status if it shows 'paid' but booking doesn't
      let paymentStatus = data?.payment_status || 'pending';
      if (invoice?.status === 'paid' && paymentStatus !== 'paid') {
        paymentStatus = 'paid';
      }

      // Normalize booking and add convenience fields for backward compatibility
      const normalizedData = data ? {
        ...data,
        status: data.status || 'confirmed',
        payment_status: paymentStatus,
        // Convenience fields for backward compatibility with code that uses client_* fields
        client_first_name: contact?.first_name || null,
        client_last_name: contact?.last_name || null,
        client_email: contact?.email || '',
        client_phone: contact?.phone || null,
        // Include invoice data for payment timeline display
        invoice: invoice ? {
          id: invoice.id,
          status: invoice.status,
          amount: invoice.amount,
          paid_at: invoice.paid_at,
          due_date: invoice.due_date,
          sent_at: invoice.sent_at,
          // Same list as `list()` above: a booking that showed its refund on one
          // screen and not another is the bug this is fixing.
          refunded_amount: invoice.refunded_amount ?? 0,
          refund_status: invoice.refund_status ?? 'none',
          refunded_at: invoice.refunded_at ?? null
        } : null,
        // Same derivation as `list()`: both ways money attaches to a booking.
        refunded_total: refundedTotalFor(
          invoice,
          Array.isArray(data?.payments) ? data.payments : []
        )
      } : null;

      return { data: normalizedData, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId: id, userId }, 'Failed to find booking');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List bookings with date range filtering and contact data
   */
  async list(
    userId: string,
    options: {
      serviceId?: string;
      contactId?: string;
      status?: string | string[];
      startDate?: string;
      endDate?: string;
      /**
       * Exclusive upper bound on start_time.
       *
       * `endDate` is inclusive (`lte`), which is right for a date but wrong for
       * a day window: a booking at exactly tomorrow's midnight belongs to
       * tomorrow, and an inclusive bound counts it in both days. Callers
       * working in half-open [start, end) windows — anything derived from
       * businessDayFor — want this instead.
       */
      endBefore?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<SchedulingRepositoryResult<SchedulingBooking[]>> {
    try {
      const {
        serviceId,
        contactId,
        status,
        startDate,
        endDate,
        endBefore,
        search,
        limit = 50,
        offset = 0
      } = options;

      // JOIN to crm_contacts for client data, scheduling_services for service info,
      // and payment_invoices for accurate payment status (in case booking.payment_status wasn't updated)
      let query = this.supabase
        .from('scheduling_bookings')
        .select(`
          *,
          contact:crm_contacts(first_name, last_name, email, phone),
          service:scheduling_services(service_name, price, currency, payment_type, installment_count, installment_frequency, sale_mode),
          invoice:payment_invoices!payment_invoices_booking_id_fkey(id, status, amount, paid_at, due_date, sent_at, refunded_amount, refund_status, refunded_at),
          payments:payment_transactions!payment_transactions_booking_id_fkey(id, amount, refunded_amount, status, invoice_id)
        `)
        .eq('user_id', userId);

      if (serviceId) {
        query = query.eq('service_id', serviceId);
      }

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      if (status) {
        query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status);
      }

      if (startDate) {
        query = query.gte('start_time', startDate);
      }

      if (endDate) {
        query = query.lte('start_time', endDate);
      }

      if (endBefore) {
        query = query.lt('start_time', endBefore);
      }

      // Client name search - search in JOINed crm_contacts table
      // Note: For search we need to use a different approach since we can't filter on joined fields directly
      // We'll filter in memory for now, or this could be done via an RPC function
      // TODO: Consider adding an RPC function for efficient contact name search

      query = query
        .order('start_time', { ascending: false }) // Newest first - shows recent/upcoming bookings
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      // Normalize bookings and add convenience fields
      let normalizedData = (data || []).map(booking => {
        const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;
        // Get invoice if exists - could be array or single object depending on join
        const invoice = Array.isArray(booking.invoice) ? booking.invoice[0] : booking.invoice;
        const payments = Array.isArray(booking.payments) ? booking.payments : [];

        // Determine payment status - prefer invoice status if it shows 'paid' but booking doesn't
        // This handles cases where webhook updated invoice but not booking
        let paymentStatus = booking.payment_status || 'pending';
        if (invoice?.status === 'paid' && paymentStatus !== 'paid') {
          paymentStatus = 'paid';
        }

        return {
          ...booking,
          status: booking.status || 'confirmed',
          payment_status: paymentStatus,
          // Convenience fields for backward compatibility
          client_first_name: contact?.first_name || null,
          client_last_name: contact?.last_name || null,
          client_email: contact?.email || '',
          client_phone: contact?.phone || null,
          // Include invoice data for payment timeline display
          invoice: invoice ? {
            id: invoice.id,
            status: invoice.status,
            amount: invoice.amount,
            paid_at: invoice.paid_at,
            due_date: invoice.due_date,
            sent_at: invoice.sent_at,
            /*
             * What has gone back.
             *
             * This object is rebuilt field by field rather than spread, so every
             * column added to the query above is silently dropped here unless it
             * is also listed — which is exactly what happened: the booking tab
             * asked for the refund figures, got them from Postgres, and lost
             * them one line before the response.
             *
             * `refund_status` rides along because a FULL refund and a partial
             * one need different words, and the amount alone cannot tell them
             * apart when the refund happens to equal the invoice total.
             */
            refunded_amount: invoice.refunded_amount ?? 0,
            refund_status: invoice.refund_status ?? 'none',
            refunded_at: invoice.refunded_at ?? null
          } : null,
          /*
           * The booking's refunded total, across BOTH ways its money attaches.
           *
           * A separate field from `invoice.refunded_amount` because a payment
           * plan has no invoice — its periods are transactions — so the invoice
           * figure alone left every plan refund invisible on this screen.
           */
          refunded_total: refundedTotalFor(invoice, payments)
        };
      });

      // Client-side filtering for search (search in contact name)
      if (search) {
        const searchLower = search.toLowerCase();
        normalizedData = normalizedData.filter(booking => {
          const fullName = `${booking.client_first_name || ''} ${booking.client_last_name || ''}`.toLowerCase();
          return fullName.includes(searchLower);
        });
      }

      return { data: normalizedData, error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list bookings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get upcoming bookings
   */
  async getUpcoming(
    userId: string,
    limit: number = 20
  ): Promise<SchedulingRepositoryResult<SchedulingBooking[]>> {
    const now = new Date().toISOString();
    return this.list(userId, {
      status: 'confirmed',
      startDate: now,
      limit
    });
  }

  /**
   * Get bookings for a specific contact
   */
  async getForContact(
    contactId: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking[]>> {
    return this.list(userId, { contactId });
  }

  /**
   * Update booking
   */
  async update(
    id: string,
    userId: string,
    updates: SchedulingBookingUpdate
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    try {
      logger.info({ bookingId: id, userId }, 'Updating booking');

      // Update and return with contact data via JOIN
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select(`
          *,
          contact:crm_contacts(
            first_name,
            last_name,
            email,
            phone
          )
        `)
        .single();

      if (error) throw error;

      // Extract contact data and add convenience fields
      const contact = Array.isArray(data?.contact) ? data.contact[0] : data?.contact;
      const normalizedData = data ? {
        ...data,
        client_first_name: contact?.first_name || null,
        client_last_name: contact?.last_name || null,
        client_email: contact?.email || '',
        client_phone: contact?.phone || null
      } : null;

      logger.info({ bookingId: id, userId }, 'Booking updated');
      return { data: normalizedData, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId: id, userId }, 'Failed to update booking');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Link a booking to the contact who completed its intake form, and stamp
   * `intake_completed_at`.
   *
   * Deliberately a dedicated method rather than fields on `SchedulingBookingUpdate`:
   * `scheduling_bookings.contact_id` is `REFERENCES crm_contacts(id)` with **no
   * same-tenant constraint**, so exposing it on the generic update would publish an
   * API surface where a caller could link another tenant's contact to its own booking.
   *
   * INVARIANT — `contactId` must be **owner-verified**: it may only come from a
   * `user_id`-scoped repository call (e.g. `CRMContactRepository.findByEmail(email, userId)`
   * or a `create({ user_id: userId })`), never from caller-supplied input. The caller is
   * the tenant-isolation boundary here (see the `tenant-isolation-guard` skill).
   * The booking itself is scoped by `user_id`, so a foreign `bookingId` matches no row.
   */
  async linkIntakeContact(
    bookingId: string,
    userId: string,
    contactId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    try {
      logger.info({ bookingId, userId, contactId }, 'Linking intake contact to booking');

      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .update({
          contact_id: contactId,
          intake_completed_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .eq('user_id', userId)
        .select()
        // maybeSingle, not single: a booking id belonging to another tenant (or simply
        // absent) is an expected outcome on a public endpoint, not an error condition.
        // It returns { data: null, error: null } so the caller can treat it as a miss
        // without this logging at error level.
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        logger.warn({ bookingId, userId }, 'No booking matched for intake link (absent or not owned)');
        return { data: null, error: null };
      }

      logger.info({ bookingId, userId, contactId }, 'Intake contact linked to booking');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId, userId }, 'Failed to link intake contact to booking');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Cancel booking
   */
  async cancel(
    id: string,
    userId: string,
    reason?: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    return this.update(id, userId, {
      status: 'cancelled',
      cancellation_reason: reason || null
    });
  }

  /**
   * Mark booking as completed
   */
  async complete(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    return this.update(id, userId, { status: 'completed' });
  }

  /**
   * Mark booking as no-show
   */
  async markNoShow(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    return this.update(id, userId, { status: 'no_show' });
  }

  /**
   * Delete booking
   */
  async delete(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<void>> {
    try {
      logger.info({ bookingId: id, userId }, 'Deleting booking');

      const { error } = await this.supabase
        .from('scheduling_bookings')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ bookingId: id, userId }, 'Booking deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId: id, userId }, 'Failed to delete booking');
      return { data: null, error: error as Error };
    }
  }

  // ==================== CALENDAR SYNC METHODS ====================

  /**
   * Get bookings that need calendar sync (confirmed bookings without external_calendar_event_id)
   */
  async getBookingsNeedingSync(
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking[]>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .is('external_calendar_event_id', null)
        .order('start_time', { ascending: true });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get bookings needing sync');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get bookings with calendar events (for sync all / re-sync)
   */
  async getBookingsWithCalendarEvents(
    userId: string,
    provider?: CalendarSyncProvider
  ): Promise<SchedulingRepositoryResult<SchedulingBooking[]>> {
    try {
      let query = this.supabase
        .from('scheduling_bookings')
        .select('*')
        .eq('user_id', userId)
        .not('external_calendar_event_id', 'is', null);

      if (provider) {
        query = query.eq('calendar_sync_provider', provider);
      }

      query = query.order('start_time', { ascending: true });

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, provider }, 'Failed to get bookings with calendar events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update calendar sync status for a booking
   */
  async updateCalendarSync(
    id: string,
    userId: string,
    syncData: {
      external_calendar_event_id?: string | null;
      calendar_sync_provider?: CalendarSyncProvider | null;
      calendar_synced_at?: string | null;
      calendar_sync_error?: string | null;
    }
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    try {
      logger.info({ bookingId: id, userId, syncData }, 'Updating booking calendar sync status');

      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .update(syncData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId: id, userId }, 'Failed to update booking calendar sync status');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Clear calendar sync for a booking (when event is deleted from external calendar)
   */
  async clearCalendarSync(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    return this.updateCalendarSync(id, userId, {
      external_calendar_event_id: null,
      calendar_sync_provider: null,
      calendar_synced_at: null,
      calendar_sync_error: null
    });
  }

  /**
   * Get sync statistics for a user
   */
  async getSyncStats(
    userId: string
  ): Promise<SchedulingRepositoryResult<{ total: number; synced: number; failed: number }>> {
    try {
      // Get total confirmed bookings
      const { count: total, error: totalError } = await this.supabase
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'confirmed');

      if (totalError) throw totalError;

      // Get synced bookings (have external_calendar_event_id)
      const { count: synced, error: syncedError } = await this.supabase
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .not('external_calendar_event_id', 'is', null);

      if (syncedError) throw syncedError;

      // Get failed bookings (have calendar_sync_error)
      const { count: failed, error: failedError } = await this.supabase
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .not('calendar_sync_error', 'is', null);

      if (failedError) throw failedError;

      return {
        data: {
          total: total ?? 0,
          synced: synced ?? 0,
          failed: failed ?? 0
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get sync stats');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton exports (initialized with server-side Supabase client)
import { supabaseServer } from '@/lib/supabaseServer';
export const schedulingServiceRepository = new SchedulingServiceRepository(supabaseServer);
export const schedulingBookingRepository = new SchedulingBookingRepository(supabaseServer);
