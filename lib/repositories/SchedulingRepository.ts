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
  duration_minutes: number;
  price: number | null;
  currency: ServiceCurrency;
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
  duration_minutes: number;
  price?: number | null;
  currency?: ServiceCurrency;
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
  duration_minutes?: number;
  price?: number | null;
  currency?: ServiceCurrency;
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

export interface SchedulingBooking {
  id: string;
  user_id: string;
  service_id: string;
  contact_id: string | null;
  client_first_name: string;
  client_last_name: string | null;
  client_email: string;
  client_phone: string | null;
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
}

export interface SchedulingBookingInsert {
  user_id: string;
  service_id: string;
  contact_id?: string | null;
  client_first_name: string;
  client_last_name?: string | null;
  client_email: string;
  client_phone?: string | null;
  start_time: string;
  end_time: string;
  timezone?: string;
  status?: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
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
        // Filter by both is_active flag AND status field
        // This ensures draft/inactive services don't show on public website
        query = query.eq('is_active', true).eq('status', 'active');
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
        { userId: booking.user_id, serviceId: booking.service_id, clientEmail: booking.client_email },
        'Creating booking'
      );

      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .insert({
          ...booking,
          timezone: booking.timezone || 'UTC',
          status: booking.status || 'confirmed',
          booking_source: booking.booking_source || 'manual'
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ bookingId: data.id, userId: booking.user_id }, 'Booking created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: booking.user_id }, 'Failed to create booking');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find booking by ID
   */
  async findById(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      // Normalize booking - ensure status is never null
      const normalizedData = data ? {
        ...data,
        status: data.status || 'confirmed',
        payment_status: data.payment_status || 'pending'
      } : null;

      return { data: normalizedData, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId: id, userId }, 'Failed to find booking');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List bookings with date range filtering
   */
  async list(
    userId: string,
    options: {
      serviceId?: string;
      contactId?: string;
      status?: string | string[];
      startDate?: string;
      endDate?: string;
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
        search,
        limit = 50,
        offset = 0
      } = options;

      let query = this.supabase
        .from('scheduling_bookings')
        .select('*, service:scheduling_services(service_name, price, currency)')
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

      // Client name search - searches in client_first_name and client_last_name
      if (search) {
        const searchPattern = `%${search}%`;
        query = query.or(`client_first_name.ilike.${searchPattern},client_last_name.ilike.${searchPattern}`);
      }

      query = query
        .order('start_time', { ascending: true })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      // Normalize bookings - ensure status is never null (default to 'confirmed')
      const normalizedData = (data || []).map(booking => ({
        ...booking,
        status: booking.status || 'confirmed',
        payment_status: booking.payment_status || 'pending'
      }));

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

      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ bookingId: id, userId }, 'Booking updated');
      return { data, error: null };
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
