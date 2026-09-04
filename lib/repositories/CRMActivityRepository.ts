/**
 * CRM Activity Repository
 * Handles all database operations for CRM activities (logs, notes, interactions)
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'CRMActivityRepository' });

// Type definitions
export interface CRMActivity {
  id: string;
  user_id: string;
  contact_id: string;
  activity_type: string; // 'note', 'email', 'call', 'meeting', 'booking', 'payment'
  title: string;
  description: string | null;
  auto_logged: boolean;
  source_capability: string | null; // 'scheduling', 'payments', 'email', 'campaigns', 'manual'
  source_entity_id: string | null;
  activity_date: string;
  created_at: string;
}

export interface CRMActivityInsert {
  user_id: string;
  contact_id: string;
  activity_type: string;
  title: string;
  description?: string | null;
  auto_logged?: boolean;
  source_capability?: string | null;
  source_entity_id?: string | null;
  activity_date?: string;
}

export interface CRMActivityRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export interface CRMActivityListOptions {
  contact_id?: string;
  activity_type?: string;
  source_capability?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'activity_date' | 'created_at';
  orderDirection?: 'asc' | 'desc';
}

export class CRMActivityRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Create a new activity
   */
  async create(
    activity: CRMActivityInsert
  ): Promise<CRMActivityRepositoryResult<CRMActivity>> {
    try {
      logger.info(
        { userId: activity.user_id, contactId: activity.contact_id, type: activity.activity_type },
        'Creating CRM activity'
      );

      const { data, error } = await this.supabase
        .from('crm_activities')
        .insert({
          ...activity,
          auto_logged: activity.auto_logged ?? false,
          activity_date: activity.activity_date || new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ activityId: data.id, userId: activity.user_id }, 'CRM activity created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: activity.user_id }, 'Failed to create CRM activity');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find activity by ID
   */
  async findById(
    id: string,
    userId: string
  ): Promise<CRMActivityRepositoryResult<CRMActivity>> {
    try {
      const { data, error } = await this.supabase
        .from('crm_activities')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, activityId: id, userId }, 'Failed to find CRM activity');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List activities with filtering and pagination
   */
  async list(
    userId: string,
    options: CRMActivityListOptions = {}
  ): Promise<CRMActivityRepositoryResult<CRMActivity[]>> {
    try {
      const {
        contact_id,
        activity_type,
        source_capability,
        limit = 50,
        offset = 0,
        orderBy = 'activity_date',
        orderDirection = 'desc'
      } = options;

      let query = this.supabase
        .from('crm_activities')
        .select('*')
        .eq('user_id', userId);

      // Filter by contact
      if (contact_id) {
        query = query.eq('contact_id', contact_id);
      }

      // Filter by activity type
      if (activity_type) {
        query = query.eq('activity_type', activity_type);
      }

      // Filter by source capability
      if (source_capability) {
        query = query.eq('source_capability', source_capability);
      }

      // Ordering
      query = query.order(orderBy, { ascending: orderDirection === 'asc' });

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list CRM activities');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get activities for a specific contact
   */
  async getForContact(
    contactId: string,
    userId: string,
    limit: number = 50
  ): Promise<CRMActivityRepositoryResult<CRMActivity[]>> {
    return this.list(userId, {
      contact_id: contactId,
      limit,
      orderBy: 'activity_date',
      orderDirection: 'desc'
    });
  }

  /**
   * Get recent activities across all contacts
   */
  async getRecent(
    userId: string,
    limit: number = 20
  ): Promise<CRMActivityRepositoryResult<CRMActivity[]>> {
    return this.list(userId, {
      limit,
      orderBy: 'activity_date',
      orderDirection: 'desc'
    });
  }

  /**
   * Delete activity
   */
  async delete(
    id: string,
    userId: string
  ): Promise<CRMActivityRepositoryResult<void>> {
    try {
      logger.info({ activityId: id, userId }, 'Deleting CRM activity');

      const { error } = await this.supabase
        .from('crm_activities')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ activityId: id, userId }, 'CRM activity deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, activityId: id, userId }, 'Failed to delete CRM activity');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Log booking activity (auto-logged from scheduling capability)
   *
   * Facts, not a sentence: the drawer composes the wording at render, in the
   * reader's language. These used to write `Booking: {service}` and
   * `Scheduled for {date}` in English, into a database read by three locales.
   */
  async logBooking(
    userId: string,
    contactId: string,
    bookingId: string,
    serviceName: string,
    startTime: string | null,
    timeZone?: string,
    locale?: string
  ): Promise<CRMActivityRepositoryResult<CRMActivity>> {
    return this.create({
      user_id: userId,
      contact_id: contactId,
      activity_type: 'booking',
      title: activitySentence(
        startTime ? 'booking_created_dated' : 'booking_created',
        { service: serviceName, date: activityMoment(startTime, locale, timeZone) || '' },
        locale
      ),
      description: JSON.stringify({
        kind: 'booking_created',
        service: serviceName,
        // Omitted when the booking has no time — a course or a product. Passed
        // through `new Date()` regardless, it rendered as 12/31/1969.
        bookingDate: startTime || undefined,
        timeZone,
      }),
      auto_logged: true,
      source_capability: 'scheduling',
      source_entity_id: bookingId,
      activity_date: startTime || undefined
    });
  }

  /**
   * Log payment activity (auto-logged from payments capability)
   *
   * The currency travels with the amount. This wrote `Payment Received: $${amount}`
   * — a dollar sign on every payment, whatever the business actually billed in.
   */
  async logPayment(
    userId: string,
    contactId: string,
    paymentId: string,
    amount: number,
    currency: string,
    note?: string
  ): Promise<CRMActivityRepositoryResult<CRMActivity>> {
    return this.create({
      user_id: userId,
      contact_id: contactId,
      activity_type: 'payment',
      title: `${new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount)}`,
      description: JSON.stringify({
        kind: 'payment_received',
        amount,
        currency,
        note: note || undefined,
      }),
      auto_logged: true,
      source_capability: 'payments',
      source_entity_id: paymentId
    });
  }

  /**
   * Log email activity (auto-logged from email capability)
   *
   * Kept for a genuinely one-off message. Routine mail about a booking is
   * already recorded by the event it belongs to — logging both put the same
   * thing on the timeline twice, which is what made it unreadable.
   */
  async logEmail(
    userId: string,
    contactId: string,
    emailId: string,
    subject: string,
    sequenceName?: string
  ): Promise<CRMActivityRepositoryResult<CRMActivity>> {
    return this.create({
      user_id: userId,
      contact_id: contactId,
      activity_type: 'email',
      title: subject,
      description: JSON.stringify({
        kind: 'email_sent',
        subject,
        sequence: sequenceName || undefined,
      }),
      auto_logged: true,
      source_capability: 'email_automation',
      source_entity_id: emailId
    });
  }
}

// Singleton export (will be initialized with server-side Supabase client)
import { activitySentence, activityMoment } from '@/lib/business-os/activityText';
import { supabaseServer } from '@/lib/supabaseServer';
export const crmActivityRepository = new CRMActivityRepository(supabaseServer);
