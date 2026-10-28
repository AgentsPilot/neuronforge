/**
 * Scheduling Repository
 * Handles all database operations for scheduling services and bookings
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient, type PostgrestError } from '@supabase/supabase-js';
import type { CancelledBy } from '@/lib/business-os/cancellationReasons';
import type { BookingStatus, MeetingStatus } from '@/lib/business-os/bookingStatus';
import { MEETING_HOLDS_SLOT_FILTER, isSlotTakenError } from '@/lib/business-os/bookingStatus';
import type { IntakeQuestion } from '@/lib/business-os/intake/types';
import { createLogger } from '@/lib/logger';
import { recordBusinessEvent } from '@/lib/business-os/insight/events/recordEvent';

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
  /**
   * Whether this service's currency is frozen because it has been sold.
   *
   * Computed by the list route, not stored: the authority is
   * `service_currency_lock` (20261008), and duplicating it in a column would
   * give the two something to disagree about. Absent on rows that did not come
   * from that route, which correctly reads as "not known to be locked".
   */
  currency_locked?: boolean;
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

/**
 * One arranged appointment, from `scheduling_meetings`.
 *
 * Narrow on purpose: this is what a journey row needs to say when it happened
 * and how it went. The booking beside it carries everything else — the client,
 * the service, the money — so none of that is repeated here.
 */
/**
 * Who recorded an outcome.
 *
 * `system` is a real actor, not a fallback: a lead reply that auto-completes a
 * booking was recorded by no person, and naming the owner would attribute a
 * decision they did not make.
 */
export type MeetingOutcomeActor = 'owner' | 'client' | 'system';

/**
 * A meeting to be written directly, rather than mirrored from a booking.
 *
 * Only a package needs this: its sessions have no booking of their own to be
 * synced from. Everything else reaches `scheduling_meetings` through
 * `syncMeeting`, which keeps one row per booking in step with the booking's
 * clock, and must go on doing so.
 */
export interface SchedulingMeetingInsert {
  user_id: string;
  /** The container — the purchase, which carries no time itself. */
  booking_id: string;
  start_time: string;
  end_time: string;
  /** The business's zone, for the hour the confirmation prints. */
  timezone: string | null;
  /**
   * Which SESSION of the package this is, counted from the order sold.
   *
   * Kept apart from `occurrence_number`, which counts ATTEMPTS at this one
   * session: moving session 3 writes `session_number: 3, occurrence_number: 2`
   * (20261086). One column answering both questions renumbers a package's
   * sessions the first time one is moved.
   */
  session_number: number;
  /** Which attempt at that session. 1 for a session nobody has moved yet. */
  occurrence_number: number;
  /**
   * The session this one was booked IN PLACE of.
   *
   * Set only by the replacement toggle on the cancel and no-show dialogs. A
   * session something points at has already been made up, which is what stops
   * the drawer offering to move it — see 20261095.
   */
  replaces_meeting_id?: string | null;
}

export interface SchedulingMeetingAttempt {
  id: string;
  booking_id: string;
  /**
   * The session this attempt was booked IN PLACE of, if any.
   *
   * Read the other way round by the card: a session that something points at
   * has been made up, and is not offered Reschedule. Null on every ordinary
   * session and on every row written before 20261095.
   */
  replaces_meeting_id?: string | null;
  /** Who recorded `meeting_status`. NULL on rows predating 20261078. */
  outcome_by: MeetingOutcomeActor | null;
  /** When it was recorded, so the rail can place it among the emails. */
  outcome_at: string | null;
  /**
   * Who caused this attempt to exist (20261082), for one a move created.
   *
   * NULL on attempt #1, which the booking put there rather than a move, and on
   * every row predating the column. The journey reports such a move without
   * naming a side — it used to say the owner had done it, which was false for
   * every reschedule a client made from the public portal.
   */
  moved_by: MeetingOutcomeActor | null;
  start_time: string;
  end_time: string;
  timezone: string | null;
  /** `held` | `no_show` | `cancelled`, or null while nobody has said. */
  meeting_status: MeetingStatus | null;
  /**
   * Which SESSION of a package this is (20261086), or NULL on an ordinary
   * booking, which has one appointment.
   *
   * Readers that list a package group by this and take the highest
   * `occurrence_number` in each group as the session's current time.
   */
  session_number: number | null;
  /** 1 for the first arrangement, incrementing for each later attempt. */
  occurrence_number: number;
  created_at: string | null;
}

export interface SchedulingBooking {
  id: string;
  user_id: string;
  service_id: string;
  contact_id: string; // Required - client data is in crm_contacts
  start_time: string;
  end_time: string;
  timezone: string;
  status: BookingStatus;
  /**
   * What happened at the APPOINTMENT, independent of the job.
   *
   * `null` means nobody has said yet, which is the ordinary state of a past
   * meeting. See the note on `MeetingStatus` for why this is not `status`.
   */
  meeting_status?: MeetingStatus;
  /**
   * Who recorded that outcome (`outcome_by`, 20261078).
   *
   * Travels with the status it describes. `auto_complete_meetings` stamps
   * `'system'` here when a clock, rather than a person, closed the meeting —
   * which is what lets the drawer offer the owner a correction.
   */
  outcome_by?: MeetingOutcomeActor | null;
  outcome_at?: string | null;
  cancellation_reason: string | null;
  /** Structured cancellation: the code, the note, and who called it off. */
  cancel_reason?: string | null;
  cancel_note?: string | null;
  cancelled_by?: CancelledBy | null;
  /**
   * The owner's answer when a meeting was cancelled on a quoted job
   * (20261083): is the quote still coming?
   *
   * NULL where nobody was asked, which is not the same as yes. `false` is what
   * makes the journey ask whether the booking should be closed — work nobody
   * will quote for should not sit open.
   */
  proposal_continues?: boolean | null;
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
    /**
     * The form and version answered, and a SNAPSHOT of the questions.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This type said `{ template_id, template_key, responses }`, which is not
     * what is stored and has not been for some time: all 8 live submissions on
     * this account carry `{ form_id, version, questions, responses }`, written
     * by the client's own submit route.
     *
     * The old names survived because they were never read for anything that
     * failed loudly — `.responses` is present in both shapes, so every reader
     * that mattered kept working while `template_id` quietly resolved to
     * `undefined` wherever it was asked for.
     *
     * The questions travel WITH the answers on purpose: a form edited or
     * republished later would otherwise render an old submission as a list of
     * values with nothing saying what was asked.
     * ─────────────────────────────────────────────────────────────────────────
     */
    form_id: string;
    version: number;
    questions?: IntakeQuestion[];
    responses: Record<string, unknown>;
  } | null;
  /**
   * When the form was emailed, and when the client was nudged about it.
   *
   * On the row all along — `SchedulingBookingUpdate` declares both and
   * `IntakeReminderService` filters on them — and only this READ type omitted
   * them. So a reader holding a booking could not tell an unasked form from an
   * unanswered one, which is the distinction the whole intake step is about.
   */
  intake_sent_at?: string | null;
  intake_reminded_at?: string | null;
  intake_completed_at: string | null;
  /** A package's meeting: its purchase, and which of the N it is. See the insert type. */
  parent_booking_id?: string | null;
  occurrence_number?: number | null;
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
  /**
   * Null for a service that is not scheduled.
   *
   * A course or a product is bought, not booked into a slot. The column has
   * always been nullable and the public booking route has always written null
   * for one; this type simply said otherwise, which is why the owner-side path
   * could not express it.
   */
  start_time: string | null;
  end_time: string | null;
  timezone?: string;
  status?: BookingStatus;
  payment_status?: 'pending' | 'paid' | 'refunded';
  notes?: string | null;
  internal_notes?: string | null;
  booking_source?: string;
  /**
   * A PACKAGE: the purchase this meeting belongs to, and which meeting it is.
   *
   * Set together or not at all. The container — the purchase itself — has
   * neither, which is what makes `parent_booking_id IS NULL` mean "a purchase"
   * for every reader that counts them. See
   * supabase/migrations/20261001_package_sessions.sql.
   */
  parent_booking_id?: string | null;
  occurrence_number?: number | null;
}

export interface SchedulingBookingUpdate {
  status?: BookingStatus;
  /** The meeting's own outcome. Written alongside `status`, never instead of it yet. */
  meeting_status?: MeetingStatus;
  /**
   * Who recorded that outcome (20261078).
   *
   * Nullable because `update()` clears it: moving an appointment after somebody
   * answered leaves the new attempt unanswered, so the actor goes with the
   * status it described.
   */
  outcome_by?: MeetingOutcomeActor | null;
  proposal_continues?: boolean | null;
  /**
   * WHEN that outcome was recorded (20261080).
   *
   * Stamped beside the status it describes. `updated_at` cannot answer this —
   * it moves for any write, including a calendar sync or a backfill.
   */
  outcome_at?: string | null;
  cancellation_reason?: string | null;
  cancel_reason?: string | null;
  cancel_note?: string | null;
  cancelled_by?: CancelledBy | null;
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
    /**
     * The form and version answered, and a SNAPSHOT of the questions.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This type said `{ template_id, template_key, responses }`, which is not
     * what is stored and has not been for some time: all 8 live submissions on
     * this account carry `{ form_id, version, questions, responses }`, written
     * by the client's own submit route.
     *
     * The old names survived because they were never read for anything that
     * failed loudly — `.responses` is present in both shapes, so every reader
     * that mattered kept working while `template_id` quietly resolved to
     * `undefined` wherever it was asked for.
     *
     * The questions travel WITH the answers on purpose: a form edited or
     * republished later would otherwise render an old submission as a list of
     * values with nothing saying what was asked.
     * ─────────────────────────────────────────────────────────────────────────
     */
    form_id: string;
    version: number;
    questions?: IntakeQuestion[];
    responses: Record<string, unknown>;
  } | null;
  /** When the form was emailed. Distinct from `intake_completed_at`: asked is not answered. */
  intake_sent_at?: string | null;
  intake_completed_at?: string | null;
}

export interface SchedulingRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

/**
 * supabase-js's result, passed through unchanged (the same error object), for
 * the Stripe webhook and plan-binding booking methods (CF-5 PR 4), which
 * neither catch nor log. `count` only where the write asked for one.
 */
export interface WebhookBookingResult<T> {
  data: T | null;
  error: PostgrestError | null;
  count?: number | null;
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
          /* 90, not 30 — see `DEFAULT_ADVANCE_BOOKING_DAYS`. */
          advance_booking_days: service.advance_booking_days ?? DEFAULT_ADVANCE_BOOKING_DAYS,
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
        advance_booking_days: service.advance_booking_days ?? DEFAULT_ADVANCE_BOOKING_DAYS,
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
   * Publish a service: make it active and bookable.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * IDEMPOTENT, and that is the fix rather than a nicety.
   *
   * This filtered on `status = 'draft'` and read the result with `.single()`, so
   * publishing something already published matched zero rows and threw
   * PGRST116 — "JSON object requested, multiple (or no) rows returned" — which
   * the route turned into a 400 and the owner saw as a failure to save.
   *
   * Reaching that state takes no misuse at all. Listing services has been
   * observed taking almost nine seconds, so a second click, a retry, a stale
   * list or a second tab all arrive at a service that is already active. And
   * "make this published" is a request about a DESIRED STATE: if it is already
   * true, the request succeeded.
   *
   * A row that cannot be published for any OTHER reason is still an error —
   * missing, owned by somebody else, or sitting in a status this was never
   * meant to move (`inactive` is a deliberate pause, and silently un-pausing it
   * would be a different operation wearing this one's name).
   * ───────────────────────────────────────────────────────────────────────────
   */
  async publish(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingService>> {
    try {
      logger.info({ serviceId: id, userId }, 'Publishing service');

      // `maybeSingle`, because "no row matched" is a state to inspect rather
      // than an exception to throw.
      const { data, error } = await this.supabase
        .from('scheduling_services')
        .update({ status: 'active', is_active: true })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', 'draft')
        .select()
        .maybeSingle();

      if (error) throw error;

      if (data) {
        logger.info({ serviceId: id, userId }, 'Draft service published');
        return { data, error: null };
      }

      /*
       * Nothing was updated. Find out why before calling it a failure — the
       * common case is that the work is already done.
       */
      const { data: existing, error: readError } = await this.supabase
        .from('scheduling_services')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (readError) throw readError;

      if (!existing) {
        logger.warn({ serviceId: id, userId }, 'Cannot publish: service not found for this user');
        return { data: null, error: new Error('Service not found') };
      }

      if (existing.status === 'active') {
        // Already where the caller wanted it. `is_active` is repaired if it
        // somehow disagrees with the status, since the two together are what
        // decides whether a client can book.
        if (existing.is_active === false) {
          const { data: repaired } = await this.supabase
            .from('scheduling_services')
            .update({ is_active: true })
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .maybeSingle();

          logger.info({ serviceId: id, userId }, 'Service was active but not bookable; re-enabled');
          return { data: repaired ?? existing, error: null };
        }

        logger.info({ serviceId: id, userId }, 'Service already published; nothing to do');
        return { data: existing, error: null };
      }

      logger.warn(
        { serviceId: id, userId, status: existing.status },
        'Cannot publish from this status'
      );
      return {
        data: null,
        error: new Error(`Cannot publish a service with status "${existing.status}"`),
      };
    } catch (error) {
      logger.error({ err: error, serviceId: id, userId }, 'Failed to publish service');
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
   * Ownership oracle: the service's id if `userId` owns it, else null.
   *
   * For service-role paths that were handed a service id by someone else (the
   * Stripe webhook vets metadata ids with it). `id` and `user_id` only; not
   * found is a normal answer and is not logged. No `deleted_at` / status
   * filter: this answers "whose is it", not "is it bookable".
   */
  async findOwnedId(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_services')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      return { data: data?.id ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, serviceId: id, userId }, 'Failed to check scheduling service ownership');
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
   * What this business publicly sells — one answer, for every public surface.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS EXISTS ALONGSIDE `listAll(userId, true)`
   *
   * Four public routes answered this question and only the three website ones
   * went through `BOOKABLE`; `website/booking/availability` and both conversion
   * routes each repeated `.eq('is_active', true).eq('status', 'active')` by hand.
   * All four happened to agree, which is the dangerous kind of correct: the
   * constant exists precisely so the next surface cannot pick one flag and
   * forget the other, and three surfaces bypassed it. They also disagreed on
   * ORDER — `service_name` on one, `created_at` ascending on two, descending on
   * `listAll` — so the same catalogue came back in three different sequences.
   *
   * NOT `listAll`, which selects `*`. These rows are returned to anonymous
   * visitors, and the table carries `ai_suggestions`, `source`, `availability`,
   * `max_bookings_per_day` and the booking-window settings — internal fields the
   * public routes deliberately never sent. Pointing them at `listAll` would have
   * unified the filter by widening the payload, which is a worse trade than the
   * duplication it removed.
   *
   * So: the same rule, and exactly the columns the four public callers already
   * used between them — `toServiceCard` reads `is_active`, so it stays; `status`
   * was selected by one route and read by none, so it does not.
   *
   * WHICH SERVICES a given surface then shows is still its own business: a smart
   * link excludes (`servicesForLink`), a landing page names one, a services
   * block hides. That narrowing is correct and stays where it is. This is only
   * the base set it narrows FROM.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /*
   * `advance_booking_days` is public because the CLIENT needs it.
   *
   * It is the business's own answer to "how far ahead will you take a
   * booking", and without it on this list the public widget had nothing to ask
   * and showed a hardcoded fortnight to everyone — including a business that
   * had set ninety days.
   */
  static readonly PUBLIC_COLUMNS =
    'id, service_name, description, duration_minutes, price, currency, ' +
    'is_active, is_scheduled, collection, sale_mode, advance_booking_days';

  async listBookable(userId: string): Promise<SchedulingRepositoryResult<SchedulingService[]>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_services')
        .select(SchedulingServiceRepository.PUBLIC_COLUMNS)
        .eq('user_id', userId)
        .match(SchedulingServiceRepository.BOOKABLE)
        // Alphabetical, because a client is scanning a list rather than reading a
        // changelog — and one order, so the same catalogue reads the same way on
        // every surface.
        .order('service_name', { ascending: true });

      if (error) throw error;

      return { data: (data || []) as unknown as SchedulingService[], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list bookable services');
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

      /*
       * A general update may not publish.
       *
       * `publish()` is not just a status write — it is guarded by
       * `.eq('status', 'draft')`, and its callers add a description check and
       * the journey-readiness gate before reaching it. None of that is reached
       * by writing `status: 'active'` here, and every one of those checks
       * exists because a client saw something that should not have been shown.
       *
       * This was live: the Settings pause switch wrote
       * `status: newActiveState ? 'active' : 'inactive'` on every flip, so
       * switching a draft off and on again published it, reviewed by nobody.
       * That call site is fixed, but it is one of four writers — the chat
       * executor and the plugin executor update services too, and a rule
       * enforced in one of them is a rule the others do not know about. Same
       * reasoning as the currency triggers in 20261008.
       *
       * Deliberately NOT refused: 'active' → 'inactive' (pausing), 'inactive'
       * → 'active' (un-pausing, which is the only path back and has no
       * publish route of its own), and 'active' → 'draft' (editing a live
       * service, which is how it returns for review).
       */
      if (updates.status === 'active') {
        const { data: current, error: readError } = await this.supabase
          .from('scheduling_services')
          .select('status')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle();

        if (readError) throw readError;

        if (current?.status === 'draft') {
          logger.warn(
            { serviceId: id, userId },
            'Refused to publish a draft through update() — use publish()'
          );
          return {
            data: null,
            error: new Error(
              'Cannot activate a draft service through an update. Publish it instead, ' +
              'so the description check and readiness gate are applied.'
            ),
          };
        }
      }

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

/**
 * Booking statuses worth recording as an event.
 *
 * `no_show` is the one a detector currently waits on and nothing writes, which
 * is why `RetNoShowSpikeDetector` has never been able to fire. `completed` is
 * written alongside it because it carries the money — two detectors estimate an
 * average booking value from it, and both fall back to a hardcoded $75 without.
 * `cancelled` completes the set: the three ways a booking ends.
 */
type EventedBookingStatus = 'no_show' | 'completed' | 'cancelled';

const EVENTED_BOOKING_STATUSES = new Set<string>(['no_show', 'completed', 'cancelled']);

/**
 * The booking plus its contact, used by both arms of `update()`.
 *
 * Declared once because the two writes must return the SAME shape: the
 * normalisation below reads `data.contact`, and a select that differed between
 * the claim path and the fallback would leave `client_email` populated on one
 * and empty on the other depending on which arm ran.
 */
const BOOKING_WITH_CONTACT = `
          *,
          contact:crm_contacts(
            first_name,
            last_name,
            email,
            phone
          )
        `;

/**
 * Record how a booking ended.
 *
 * The value goes on the event because that is what makes it useful later: a
 * no-show costs whatever the session was worth, and an average is only
 * meaningful over events that carry one. Taken from the charge on the booking,
 * falling back to the service's list price.
 */
/**
 * A joined booking row, as loose as PostgREST actually returns it.
 *
 * `SchedulingBooking` was the declared parameter type and the function's first
 * act was `booking as unknown as { … }`, so the signature claimed a guarantee
 * the body immediately threw away — and the call site then needed a cast of
 * its own to satisfy it. Taking the row loosely and narrowing here is the same
 * runtime behaviour with none of the fiction: the select carries a `contact`
 * join, so the result genuinely is not a `SchedulingBooking`.
 */
function emitBookingStatusEvent(
  userId: string,
  booking: Record<string, unknown>,
  status: EventedBookingStatus
): void {
  const row = booking as {
    id?: string;
    contact_id?: string | null;
    payment_amount?: number | string | null;
    service_id?: string | null;
  };

  if (!row.id) return;

  const charged = Number(row.payment_amount);
  const valueUsd = Number.isFinite(charged) && charged > 0 ? charged : undefined;

  /*
   * Routed through `recordBusinessEvent` rather than importing the service
   * here.
   *
   * This function owned its own copy of the dynamic import plus the
   * `void ... .catch()` at its call site, which was the original pattern and
   * the thing the wrapper was extracted from. Keeping both meant two shapes
   * for the same guarantee, and the money-spine emitters would have made it
   * eight. The value logic stays here because it is specific to a booking: the
   * charge on the row, which is what lets a no-show be costed at all.
   */
  recordBusinessEvent(userId, {
    eventType: `booking.${status}`,
    category: 'retention',
    entityType: 'booking',
    entityId: row.id,
    contactId: row.contact_id ?? undefined,
    valueUsd,
    sourceCapability: 'scheduling',
    metadata: { service_id: row.service_id ?? null },
  });
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
      /*
       * ───────────────────────────────────────────────────────────────────────
       * MEETINGS DECIDE, BOOKINGS SUPPLY THE NAMES
       *
       * Which times are taken is `busyMeetings`' question and it owns the
       * answer — see that file for why an appointment, not a job, is what
       * occupies an hour.
       *
       * But this method's callers do not just want a yes or no. The chat, the
       * plugin and the lifecycle service all tell the owner WHO has the slot,
       * reading `client_first_name` off these rows, so the contract is a list
       * of bookings and has to stay one. Hence the second read: meetings decide
       * which, bookings say whose.
       *
       * Two queries rather than one join, and that is the cheap side of the
       * trade. This is the owner's own double-booking check — a handful of rows
       * at the moment they move an appointment, not the public booking page.
       * ───────────────────────────────────────────────────────────────────────
       */
      let meetingQuery = this.supabase
        .from('scheduling_meetings')
        .select('booking_id')
        .eq('user_id', userId)
        /* existing_start < new_end AND existing_end > new_start */
        .lt('start_time', endTime)
        .gt('end_time', startTime)
        .or(MEETING_HOLDS_SLOT_FILTER);

      // Exclude current booking when editing
      if (excludeBookingId) {
        meetingQuery = meetingQuery.neq('booking_id', excludeBookingId);
      }

      const { data: busy, error: busyError } = await meetingQuery;

      if (busyError) throw busyError;

      const bookingIds = (busy ?? [])
        .map(m => m.booking_id as string | null)
        .filter((id): id is string => Boolean(id));

      /* Nothing in the way. Returning early also keeps `.in()` off an empty
         array, which PostgREST accepts but which costs a round trip. */
      if (bookingIds.length === 0) {
        return { data: [], error: null };
      }

      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select('*')
        .eq('user_id', userId)
        .in('id', bookingIds);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, startTime, endTime }, 'Failed to check booking overlap');
      return { data: null, error: error as Error };
    }
  }

  /**
   * One appointment on a job that has several — a package session.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY A PACKAGE CANNOT GO THROUGH `create()`
   *
   * Six sessions were six BOOKINGS hanging off a container by
   * `parent_booking_id`, each syncing one meeting. That made the series live in
   * the bookings table, where a reader asking "what has this client bought"
   * counts seven things and a reader asking "what is owed" has to know that six
   * of them are not purchases.
   *
   * The meetings table was built for exactly this — its own comment says a job
   * legitimately has several meetings — so a package is now ONE booking with
   * no time of its own and N rows here.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `occurrence_number` MEANS WHICH SESSION, AND THE CALLER DECIDES
   *
   * On an ordinary booking the number counts ATTEMPTS: #2 is the same
   * appointment at a new time, written by `syncMeeting` when the clock moves.
   * On a package it counts SESSIONS: #3 is the third of six, and all six are
   * current at once.
   *
   * One column, two meanings, told apart by nothing on the row — which is
   * exactly why the number is passed in rather than derived here. Deriving it
   * from a count would renumber a package's sessions the first time one of
   * them was rescheduled.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A CLASH IS THE CALLER'S TO HANDLE, NOT A FAILURE TO HIDE
   *
   * `scheduling_meetings_no_overlap` (20261085) refuses a session whose hour
   * went between the quote being sent and accepted, and it is the ONLY
   * constraint that can: the container carries no time, so the bookings
   * constraint skips it entirely.
   *
   * The error is returned rather than swallowed, so acceptance can create the
   * other five and name the one it lost. `isSlotTakenError` tells that apart
   * from a fault, and knows this constraint's name.
   */
  async createMeeting(
    meeting: SchedulingMeetingInsert
  ): Promise<SchedulingRepositoryResult<{ id: string }>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_meetings')
        .insert({
          user_id: meeting.user_id,
          booking_id: meeting.booking_id,
          start_time: meeting.start_time,
          end_time: meeting.end_time,
          timezone: meeting.timezone ?? null,
          session_number: meeting.session_number,
          occurrence_number: meeting.occurrence_number,
          /*
           * The session this one stands in for, when it came from the
           * replacement toggle. Null for every ordinary session, which is
           * almost all of them — see the column's own comment (20261095).
           */
          replaces_meeting_id: meeting.replaces_meeting_id ?? null,
          /*
           * Nobody has said what happened at a session that has not happened.
           * Null is that value, and it is also what makes the row hold its
           * hour — see `MEETING_HOLDS_SLOT_FILTER`.
           */
          meeting_status: null,
        })
        .select('id')
        .single();

      if (error) return { data: null, error: error as unknown as Error };

      return { data: { id: String(data.id) }, error: null };
    } catch (error) {
      logger.error(
        { err: error, bookingId: meeting.booking_id, occurrence: meeting.occurrence_number },
        'Failed to create a meeting'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record the calendar event for ONE meeting, rather than for its booking.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A package's six sessions are six entries in the owner's diary, and they
   * hang off ONE booking. Writing their event ids to that booking's single
   * `external_calendar_event_id` would keep only the last of the six — and the
   * next sync, finding no event recorded for the other five, would create them
   * all again. Six appointments, twelve calendar entries.
   *
   * `scheduling_meetings` carries `external_calendar_event_id` and
   * `calendar_synced_at` for this (20261073), and `calendar_sync_provider`
   * with `calendar_sync_error` since 20261087 — without the provider a
   * session's event could be created and never changed, because the update and
   * delete paths look the event up by it. Moving or cancelling one session
   * left a stale entry in the owner's diary.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async updateMeetingCalendarSync(
    meetingId: string,
    userId: string,
    fields: {
      external_calendar_event_id?: string | null;
      calendar_sync_provider?: string | null;
      calendar_synced_at?: string | null;
      calendar_sync_error?: string | null;
    }
  ): Promise<SchedulingRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('scheduling_meetings')
        .update(fields)
        .eq('id', meetingId)
        /* CLAUDE.md rule 4, on a service-role client. */
        .eq('user_id', userId);

      if (error) return { data: null, error: error as unknown as Error };
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, meetingId }, "Failed to record a meeting's calendar event");
      return { data: null, error: error as Error };
    }
  }

  /**
   * What happened at ONE session of a package.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY A SESSION CANNOT GO THROUGH `complete()`
   *
   * Every outcome path on this repository takes a BOOKING id and writes
   * `meeting_status` on the booking. That was the whole truth while a session
   * was its own child booking. A package is now one booking with N meetings,
   * and marking "the booking" held would claim all six happened at once.
   *
   * So this writes the outcome on the meeting, and the booking keeps a MIRROR
   * of it — see below.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE MIRROR IS WHY 88 READERS DID NOT HAVE TO MOVE
   *
   * `booking.meeting_status` is read in 88 places to answer "what is the state
   * of this job's appointment". For a package the honest answer is the state of
   * its NEXT UNSETTLED session — the one still to come — because that is the
   * appointment the job is waiting on. When every session is settled the answer
   * is the last one's outcome, so a package of six all held reads `held` and
   * the job reads finished, which is what those readers need.
   *
   * Derived, never authoritative. The meetings are the record; this column is a
   * convenience, which is what it has been since the separation began.
   *
   * @returns the container, so the caller can bill and audit against the job.
   */
  /**
   * Move ONE appointment to a new hour, keeping the one it had on the record.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The same `move_meeting` (20261087) that `syncMeeting` uses, reached
   * directly — because a package SESSION has no booking whose clock could
   * drive it. Moving session three cannot go through the booking: the booking
   * is the purchase, and changing its time would mean nothing.
   *
   * What comes back is a NEW row: the same `session_number`, the next
   * `occurrence_number`, the new hour, and nothing said about it yet. The row
   * it superseded keeps the time it was for and is stamped `moved`, so the
   * journey can still show the client the hour they were told about — and the
   * hour itself goes back on sale.
   *
   * Both halves happen in one transaction, which is the whole reason this is a
   * function and not two statements: releasing first avoids a 60-minute
   * appointment moved 30 minutes colliding with itself, and the transaction
   * stops a refused hour from leaving the appointment holding no time at all.
   *
   * @returns the new attempt's id, or an error. `isSlotTakenError` is true
   *          when the new hour is genuinely somebody else's, in which case
   *          nothing changed and the appointment keeps its time.
   */
  async moveMeeting(
    meetingId: string,
    userId: string,
    startTime: string,
    endTime: string,
    movedBy: MeetingOutcomeActor | null = 'owner'
  ): Promise<SchedulingRepositoryResult<{ id: string }>> {
    try {
      const { data, error } = await this.supabase.rpc('move_meeting', {
        p_meeting_id: meetingId,
        p_user_id: userId,
        p_start: startTime,
        p_end: endTime,
        p_moved_by: movedBy,
      });

      if (error) return { data: null, error: error as unknown as Error };

      /*
       * ───────────────────────────────────────────────────────────────────────
       * THE MONEY FOLLOWS THE SESSION TO ITS NEW HOUR.
       *
       * A stage is bound to a MEETING, and a move writes a NEW meeting — so
       * without this the stage goes on naming the attempt that was superseded.
       * `billSessionOnCompletion` keys on the meeting it is given, finds
       * nothing for the new attempt, and marking the rebooked session held
       * bills NOTHING. The client sits through a session nobody charges for,
       * and the owner has no sign of it: the stage is still there, still
       * pending, pointing at an hour that no longer happens.
       *
       * Only a stage that has not been billed moves. A billed one names a date
       * on an invoice the client is holding — and it cannot arise here anyway,
       * since billing requires `held` and a held session cannot be moved.
       * ───────────────────────────────────────────────────────────────────────
       */
      const { error: stageError } = await this.supabase
        .from('payment_plan_installments')
        .update({ meeting_id: String(data) })
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .is('invoice_id', null);

      if (stageError) {
        /*
         * Never fatal: the appointment HAS moved, which is the fact the owner
         * and the client are both acting on. A stage left on the old attempt
         * is visible in the drawer and recoverable; refusing the move over it
         * would leave an hour nobody can change.
         */
        logger.error(
          { err: stageError, meetingId, newAttempt: data },
          'The session moved but its stage still names the old attempt'
        );
      }

      /*
       * The job's mirror follows: its next unsettled session may now be a
       * different one, or at a different hour. Derived, never authoritative —
       * see `setMeetingOutcome`.
       */
      const { data: moved } = await this.supabase
        .from('scheduling_meetings')
        .select('booking_id')
        .eq('id', String(data))
        .eq('user_id', userId)
        .maybeSingle();

      if (moved?.booking_id) {
        await this.mirrorSessionOutcome(String(moved.booking_id), userId);
      }

      logger.info({ meetingId, newAttempt: data, to: startTime, movedBy }, 'Appointment moved');

      return { data: { id: String(data) }, error: null };
    } catch (error) {
      logger.error({ err: error, meetingId, startTime }, 'Failed to move a meeting');
      return { data: null, error: error as Error };
    }
  }

  /**
   * One meeting, by id, scoped to its owner.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Added for the outcome route's clock check: `held` and `no_show` are
   * assertions about the past and both bill, so the server has to know when the
   * session actually starts before it accepts one. The route cannot ask
   * Supabase itself (CLAUDE.md rule 1), and the only other reader here loads a
   * whole package's worth of attempts.
   *
   * Deliberately narrow in what it selects. A caller that needs more should
   * widen it knowingly rather than inherit a `*` that quietly grows.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async findMeetingById(
    meetingId: string,
    userId: string
  ): Promise<
    SchedulingRepositoryResult<{
      id: string;
      booking_id: string;
      start_time: string | null;
      end_time: string | null;
      meeting_status: string | null;
      session_number: number | null;
      /** Where this session's own diary entry lives, for moving or removing it.
          The BOOKING's column holds at most one event, so for a package it is
          the last session synced and useless to the other five. */
      external_calendar_event_id: string | null;
      calendar_sync_provider: string | null;
    } | null>
  > {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_meetings')
        .select(
          'id, booking_id, start_time, end_time, meeting_status, session_number, external_calendar_event_id, calendar_sync_provider'
        )
        .eq('id', meetingId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) return { data: null, error: error as unknown as Error };

      return {
        data: (data as {
          id: string;
          booking_id: string;
          start_time: string | null;
          end_time: string | null;
          meeting_status: string | null;
          session_number: number | null;
          external_calendar_event_id: string | null;
          calendar_sync_provider: string | null;
        } | null) ?? null,
        error: null,
      };
    } catch (error) {
      logger.error({ err: error, meetingId, userId }, 'Failed to read a meeting');
      return { data: null, error: error as Error };
    }
  }

  async setMeetingOutcome(
    meetingId: string,
    userId: string,
    status: 'held' | 'no_show' | 'cancelled',
    by: MeetingOutcomeActor = 'owner',
    /**
     * Release the session's unbilled stage even though it was not cancelled.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * WHAT THIS IS FOR: A NO-SHOW THE OWNER DECIDED NOT TO CHARGE.
     *
     * `no_show` used to do nothing to the money, and "nothing" is not one of
     * the two honest answers. Marking a missed session left its stage reading
     * `pending` for ever: never billed, because only `held` bills, and never
     * voided, because only `cancelled` voids. The client was neither charged
     * nor released, and their portal listed money against an hour no invoice
     * would ever be raised for.
     *
     * So a no-show now takes a decision, and when that decision is "do not
     * charge it" the stage has to be released exactly as a cancellation
     * releases one, down to lowering the plan's total. Hence a flag rather
     * than a second copy of that block: one definition of "this stage will
     * never be collected", used by both.
     * ─────────────────────────────────────────────────────────────────────────
     */
    options?: { releaseStage?: boolean }
  ): Promise<
    SchedulingRepositoryResult<{
      bookingId: string;
      sessionNumber: number | null;
      /** The session's own hour, which the client's mail has to name: the
          purchase carries no clock to take it from. */
      startTime: string | null;
    }>
  > {
    try {
      const { data: meeting, error } = await this.supabase
        .from('scheduling_meetings')
        .update({
          meeting_status: status,
          outcome_by: by,
          outcome_at: new Date().toISOString(),
        })
        .eq('id', meetingId)
        .eq('user_id', userId)
        /*
         * Never over an outcome already recorded. Two presses, or a chat and a
         * button racing, must leave the first answer standing rather than the
         * last — and the money keys on this: `billSessionOnCompletion` is
         * idempotent through the STAGE's claim, not through this write.
         *
         * `moved` is in the list on purpose. A superseded attempt gave its hour
         * back; saying something happened at it would put the hour back on hold
         * and contradict the attempt that replaced it.
         */
        .is('meeting_status', null)
        .select('id, booking_id, session_number, start_time')
        .maybeSingle();

      if (error) return { data: null, error: error as unknown as Error };

      if (!meeting) {
        /* Already answered, or not this owner's. Neither is a fault. */
        logger.info({ meetingId, userId, status }, 'Session outcome was already recorded');
        return { data: null, error: null };
      }

      const bookingId = String(meeting.booking_id);

      /*
       * ───────────────────────────────────────────────────────────────────────
       * A SESSION THAT WILL NOT HAPPEN IS NOT OWED FOR.
       *
       * A per-session stage bills when its session is marked HELD, so one
       * called off never bills — but the stage went on reading `pending`
       * against it. The owner saw "133.33 ₪ · ממתין" on a row that already
       * said בוטלה, the plan still totalled six sessions, and every figure
       * built from it claimed money that can never be collected.
       *
       * Only an UNBILLED stage. One already invoiced names an amount the
       * client is holding a document for; voiding that silently would put the
       * two out of step, and refunding is the deliberate action for it.
       *
       * A WAIVED NO-SHOW arrives here too, through `releaseStage`. The session
       * did not happen and the owner chose not to charge for it, which is the
       * same fact about the money as a cancellation even though it is a
       * different fact about the appointment: the row still reads לא הגיע, and
       * only the stage is released.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (status === 'cancelled' || options?.releaseStage) {
        const { data: voided, error: voidError } = await this.supabase
          .from('payment_plan_installments')
          .update({ status: 'cancelled' })
          .eq('meeting_id', meetingId)
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('invoice_id', null)
          .select('id, amount, payment_plan_id');

        if (voidError) {
          logger.error(
            { err: voidError, meetingId, bookingId, status },
            'A session will never be collected for but its stage still reads as owing'
          );
        }

        /*
         * The plan's total and its count follow its stages, the same way
         * adding one raises them. Left alone the plan says 800 over six while
         * five sessions can ever bill, and every figure built from it
         * disagrees with the invoices it raises.
         *
         * Shared with the whole-booking cancel, which did neither, so the plan
         * cannot disagree with itself depending on which button stopped the
         * work. The count was the half this path was missing.
         */
        const { lowerPlansForCancelledStages } = await import(
          '@/lib/payments/planFollowsItsStages'
        );
        await lowerPlansForCancelledStages(this.supabase, userId, voided ?? []);
      }

      await this.mirrorSessionOutcome(bookingId, userId);

      logger.info(
        { meetingId, bookingId, session: meeting.session_number, status, by },
        'Session outcome recorded'
      );

      return {
        data: {
          bookingId,
          sessionNumber: meeting.session_number === null ? null : Number(meeting.session_number),
          startTime: meeting.start_time === null ? null : String(meeting.start_time),
        },
        error: null,
      };
    } catch (error) {
      logger.error({ err: error, meetingId, status }, "Failed to record a session's outcome");
      return { data: null, error: error as Error };
    }
  }

  /**
   * Put the job's NEXT UNSETTLED session on the booking, for the 88 readers.
   *
   * Private to the outcome paths: nothing else should be writing a derived
   * column, and a caller that wants the truth reads the meetings.
   */
  private async mirrorSessionOutcome(bookingId: string, userId: string): Promise<void> {
    try {
      const { data: sessions } = await this.supabase
        .from('scheduling_meetings')
        .select('session_number, occurrence_number, meeting_status')
        .eq('booking_id', bookingId)
        .eq('user_id', userId)
        .not('session_number', 'is', null)
        .order('session_number', { ascending: true })
        .order('occurrence_number', { ascending: true });

      if (!sessions?.length) return;

      /*
       * The CURRENT attempt at each session — the last one read, since the
       * order above puts the highest occurrence last. A superseded attempt is
       * not the session's state; its replacement is.
       */
      const current = new Map<string, string | null>();
      for (const row of sessions) {
        const key = String(row.session_number);
        const outcome = row.meeting_status === null ? null : String(row.meeting_status);
        if (outcome === 'moved') continue;
        current.set(key, outcome);
      }

      const inOrder = [...current.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
      const unsettled = inOrder.find(([, outcome]) => outcome === null);

      /*
       * Still something to come, so the job's appointment is unanswered — which
       * is what `null` means and what every chaser and reminder reads.
       * Otherwise the last session's outcome, so a package whose sessions were
       * all held reads `held` and the job reads finished.
       */
      const mirror = unsettled ? null : (inOrder[inOrder.length - 1]?.[1] ?? null);

      await this.supabase
        .from('scheduling_bookings')
        .update({ meeting_status: mirror })
        .eq('id', bookingId)
        .eq('user_id', userId);
    } catch (err) {
      /*
       * Never fatal. The session's own outcome is written and is the record;
       * a stale mirror makes a card read the previous answer, which is visible
       * and self-corrects on the next outcome.
       */
      logger.warn({ err, bookingId }, 'Could not mirror the session outcome onto the job');
    }
  }

  /**
   * Every ATTEMPT at each of these bookings, oldest first.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT AN ATTEMPT IS
   *
   * One appointment that was actually arranged. A booking has one until it is
   * rescheduled after somebody said what happened — a no-show that was moved,
   * a consultation held and then booked again — and from then on it has one per
   * attempt, each keeping the time it was for and the outcome it got.
   *
   * This is the read behind the journey's meeting rows: three missed
   * appointments are three rows, in order, rather than one row whose date keeps
   * being overwritten.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * OPT-IN, AND THAT IS THE POINT
   *
   * Not folded into `list()`. That method is on several hot paths — the
   * calendar, the chat, the plugin executor — and none of them draw a journey,
   * so none of them should pay for this query. The caller that needs it asks
   * for it by calling this.
   *
   * Returns `[]` rather than failing: a journey that cannot read its attempts
   * should fall back to the single meeting node it drew before, not refuse to
   * render the booking.
   */
  async listAttempts(
    userId: string,
    bookingIds: string[]
  ): Promise<Record<string, SchedulingMeetingAttempt[]>> {
    const ids = [...new Set(bookingIds.filter(Boolean))];
    if (ids.length === 0) return {};

    try {
      const { data, error } = await this.supabase
        .from('scheduling_meetings')
        /* `session_number` (20261086) so a reader can tell a package's six
           sessions from six attempts at one appointment. Named explicitly:
           a column absent from a select is `undefined`, not null, and every
           session would read as "not a session". */
        /* `replaces_meeting_id` so a session that has already been made up can
           be told from one still waiting — see 20261095. */
        .select('id, booking_id, start_time, end_time, timezone, meeting_status, outcome_by, outcome_at, moved_by, session_number, occurrence_number, created_at, replaces_meeting_id')
        /* CLAUDE.md rule 4. The booking ids came from a list this user already
           owns, but a filter that depends on an earlier query being right is
           not a filter. */
        .eq('user_id', userId)
        .in('booking_id', ids)
        .order('occurrence_number', { ascending: true })
        /*
         * A deterministic tie-break.
         *
         * Postgres gives no order to rows that tie, and `occurrence_number`
         * HAS tied: a bug renumbered attempt #2 back to #1, leaving two rows
         * both numbered 1 — so which one the journey called "current" varied
         * between reads, and a reschedule looked like it had not refreshed.
         *
         * The numbering bug is fixed and the rows repaired, but ordering that
         * depends on no duplicates ever existing is ordering that will go
         * wrong again. `created_at` is the order attempts were arranged in,
         * which is the order they should read in regardless.
         */
        .order('created_at', { ascending: true });

      if (error) throw error;

      const byBooking: Record<string, SchedulingMeetingAttempt[]> = {};
      for (const row of data ?? []) {
        const key = String(row.booking_id);
        (byBooking[key] ??= []).push(row as unknown as SchedulingMeetingAttempt);
      }
      return byBooking;
    } catch (error) {
      logger.error({ err: error, userId, bookings: ids.length }, 'Failed to list meeting attempts');
      return {};
    }
  }

  /**
   * Create a new booking
   */
  /**
   * Keep `scheduling_meetings` in step with a booking's time and outcome.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE SHADOW COPY, WHILE IT IS STILL A SHADOW.
   *
   * `20261073` created the meetings table and backfilled it. Nothing READS it
   * yet — every query still asks `scheduling_bookings` — but unless something
   * writes it, every booking made from now on is missing its meeting and the
   * two tables drift apart silently. The first reader to move would then find
   * holes, and the holes would be weeks old.
   *
   * So: one row per timed booking, kept current. A booking with no
   * `start_time` is a service that is bought rather than booked and has no
   * appointment to record.
   *
   * NON-BLOCKING, DELIBERATELY. Nothing depends on this table yet, so a
   * failure here must never fail a booking an owner or a client just made. It
   * is logged and the booking stands — the backfill in the migration is
   * re-runnable and will catch anything that slipped.
   *
   * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 1)
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async syncMeeting(
    booking: Record<string, unknown> | null | undefined,
    /*
     * Who caused a move, when this call is one (20261082).
     *
     * Undefined where the caller does not know, which is honest and is what
     * every path that is not a reschedule passes. The journey says "the time
     * was changed" without naming anyone rather than assuming the owner — the
     * assumption being the defect this replaced.
     */
    movedBy?: MeetingOutcomeActor
  ): Promise<void> {
    if (!booking) return;
    /* See `MEETING_FIELDS` for why most updates skip this entirely. */

    const bookingId = booking.id as string | undefined;
    const userId = booking.user_id as string | undefined;
    const startTime = booking.start_time as string | null | undefined;
    if (!bookingId || !userId || !startTime) return;

    try {
      const endTime =
        (booking.end_time as string | null | undefined) ??
        new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();

      const row = {
        user_id: userId,
        booking_id: bookingId,
        start_time: startTime,
        end_time: endTime,
        timezone: (booking.timezone as string | null | undefined) ?? null,
        meeting_status: (booking.meeting_status as string | null | undefined) ?? null,
        /* Who said so. Travels with the status it describes, or the attempt
           records an outcome with nobody behind it. */
        outcome_by: (booking.outcome_by as string | null | undefined) ?? null,
        outcome_at: (booking.outcome_at as string | null | undefined) ?? null,
        occurrence_number: (booking.occurrence_number as number | null | undefined) ?? 1,
        external_calendar_event_id:
          (booking.external_calendar_event_id as string | null | undefined) ?? null,
        calendar_synced_at: (booking.calendar_synced_at as string | null | undefined) ?? null,
        updated_at: new Date().toISOString(),
      };

      /*
       * Read-then-write rather than an upsert: there is no unique constraint on
       * `booking_id` — a job legitimately has several meetings, which is what
       * the block below creates — so `onConflict` has nothing to key on.
       *
       * The LATEST attempt, by `occurrence_number`. Ordered and limited rather
       * than `maybeSingle()`, which raises on more than one row and would start
       * failing the moment the first appointment is rescheduled.
       */
      const { data: priorRows } = await this.supabase
        .from('scheduling_meetings')
        .select('id, start_time, end_time, meeting_status, occurrence_number')
        .eq('booking_id', bookingId)
        .eq('user_id', userId)
        .order('occurrence_number', { ascending: false })
        .limit(1);

      const latest = priorRows?.[0];

      if (!latest) {
        /*
         * ─────────────────────────────────────────────────────────────────────
         * THE FIRST ROW CAN ALSO BE A MOVE, AND IT HAS TO SAY SO.
         *
         * A booking's meeting row is materialised lazily, so a client who
         * reschedules before anything else touched the appointment CREATES it
         * — and this branch wrote it with no `moved_by`, which is the one field
         * the journey reads to tell "the client changed the time" from "you
         * changed the time".
         *
         * Observed: a client moved a 10:00 appointment to 11:30, the row was
         * inserted at that instant, and `moved_by` came out null — so the owner
         * was never told their client had moved it. `move_meeting` below
         * records it correctly; only this path lost it.
         *
         * `movedBy` is undefined for every update that is NOT a reschedule —
         * only `rescheduleBooking` passes it, and it always passes one — so
         * null here means "nobody moved anything, this row is the original
         * time", which is exactly right for an ordinary first insert.
         * ─────────────────────────────────────────────────────────────────────
         */
        await this.supabase
          .from('scheduling_meetings')
          .insert({ ...row, moved_by: movedBy ?? null });
        return;
      }

      /*
       * ───────────────────────────────────────────────────────────────────────
       * A SECOND ATTEMPT IS A SECOND MEETING
       *
       * The appointment was missed, held, or called off, and the booking has
       * since been given a new time. That is not an edit to what happened — it
       * is a fresh attempt at the same job, and both facts have to survive.
       *
       * Overwriting instead loses two things at once. The record of the missed
       * appointment goes (its time is replaced by the new one), and the row
       * that remains describes a FUTURE meeting still marked `no_show` — which
       * `MEETING_HOLDS_SLOT_FILTER` reads as free, so availability offers that
       * hour to somebody else and two clients arrive for it.
       *
       * This is also what makes the journey possible: three missed attempts are
       * three rows, in order, each with the time it was actually for.
       *
       * Both conditions are required. A settled outcome with the time unchanged
       * is the owner marking attendance — one row, updated. An unsettled
       * meeting being moved is an ordinary reschedule of an appointment nobody
       * has said anything about yet — also one row, updated, because there is
       * no history to keep.
       * ───────────────────────────────────────────────────────────────────────
       */
      const movedInTime =
        new Date(String(latest.start_time)).getTime() !== new Date(startTime).getTime();

      /*
       * ───────────────────────────────────────────────────────────────────────
       * EVERY MOVE IS AN ATTEMPT, NOT ONLY A MOVE AFTER AN OUTCOME.
       *
       * This also required the previous attempt to carry an outcome, on the
       * reasoning that moving an unmarked appointment has "no history worth
       * keeping". Watching it used proved otherwise: a booking went 13:00 →
       * 19:00 → 15:00, the middle move updated in place because nobody had
       * marked 19:00, and the journey showed 13:00 and 15:00 with no sign of
       * the 19:00 that two emails to the client referred to. The owner could
       * see the mail announcing a time that appeared nowhere.
       *
       * So the only test is whether the appointment MOVED. A time that was
       * communicated to a client is a fact about the job whether or not anyone
       * recorded what happened at it.
       *
       * An unmarked attempt that is no longer the latest was SUPERSEDED, not
       * awaiting an answer, and the journey labels it accordingly — nothing is
       * stored for that, it is simply "unmarked and not current".
       *
       * Still nothing new when the time is unchanged: marking attendance, or
       * re-saving the same slot, is the same appointment.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (movedInTime) {
        /*
         * ─────────────────────────────────────────────────────────────────────
         * ONE STEP, THROUGH `move_meeting` (20261087).
         *
         * This used to insert the new attempt and then stamp the old one —
         * that order, so that a refused insert left the old hour still held
         * rather than freeing a time nothing had replaced.
         *
         * The exclusion constraint ended that order. The attempt being left
         * behind still holds its hour while the new one is written, so a
         * 60-minute appointment moved 30 minutes collides WITH ITSELF and the
         * insert is refused with 23P01. Proved on live data: 14:30–15:30
         * refused 15:00–16:00.
         *
         * And the refusal was invisible. The booking's own update succeeds —
         * an exclusion constraint never compares a row with itself — so the
         * job took the new time while this table kept the old one, which left
         * availability blocking the hour the client was moved OFF and nothing
         * holding the hour they were moved TO.
         *
         * The function releases first and inserts second, inside one
         * transaction, so a genuinely taken hour rolls the release back. Both
         * orderings' guarantees, which no sequence of two statements from here
         * can have.
         * ─────────────────────────────────────────────────────────────────────
         */
        const { error: moveError } = await this.supabase.rpc('move_meeting', {
          p_meeting_id: latest.id,
          p_user_id: userId,
          p_start: startTime,
          p_end: endTime,
          p_moved_by: movedBy ?? null,
        });

        if (moveError) {
          /*
           * `23P01` here means the new hour is genuinely somebody else's, and
           * the appointment still holds the one it had. Everything else is a
           * fault. Non-blocking either way, which is this method's contract —
           * but it is logged as what it is rather than as a sync failure.
           */
          logger.warn(
            { err: moveError, bookingId, from: latest.start_time, to: startTime },
            isSlotTakenError(moveError)
              ? 'The new hour was taken; the appointment keeps the time it had'
              : 'Could not record the new attempt; leaving the previous one holding its hour'
          );
          return;
        }

        logger.info(
          {
            bookingId,
            from: latest.start_time,
            to: startTime,
            previousOutcome: latest.meeting_status ?? 'unmarked',
            attempt: (Number(latest.occurrence_number) || 1) + 1,
          },
          'Appointment moved; recorded a new attempt'
        );
        return;
      }

      /*
       * ───────────────────────────────────────────────────────────────────────
       * `occurrence_number` IS SET ONCE, AT INSERT, AND NEVER UPDATED.
       *
       * `row` takes it from the booking — `booking.occurrence_number ?? 1` —
       * which is correct for a package CHILD, whose number says which session
       * of the package it is. On an ordinary booking that column is NULL, so
       * the fallback is 1.
       *
       * Writing it on every update therefore reset the attempt's own number to
       * 1. Seen on booking ab48357a: attempt #2 was renumbered to #1 by an
       * ordinary reschedule, leaving two rows both numbered 1 — and
       * `listAttempts` orders by that column, so the history's order became
       * arbitrary and "the current attempt" could resolve to the older row.
       *
       * The number belongs to the ATTEMPT, not to the booking, so an update
       * must leave it exactly as the insert set it.
       * ───────────────────────────────────────────────────────────────────────
       */
      const { occurrence_number: _fixedAtInsert, ...movable } = row;
      void _fixedAtInsert;

      await this.supabase.from('scheduling_meetings').update(movable).eq('id', latest.id);
    } catch (err) {
      logger.warn({ err, bookingId }, 'Meeting row sync failed (non-blocking)');
    }
  }

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
          booking_source: booking.booking_source || 'manual',
          // Null on every ordinary booking, which is all of them but a
          // package's meetings. Listed explicitly because this payload is
          // built field by field: a column not named here is a column the
          // caller cannot write, however well the type describes it.
          parent_booking_id: booking.parent_booking_id ?? null,
          occurrence_number: booking.occurrence_number ?? null
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ bookingId: data.id, userId: booking.user_id, contactId: booking.contact_id }, 'Booking created');

      /*
       * `booking.created` is recorded by a DATABASE TRIGGER, not here.
       *
       * An audit on 2026-10-06 found that the client-facing booking route
       * (`app/api/website/booking/create/route.ts`) inserts into
       * `scheduling_bookings` directly rather than through this repository, so
       * an emit at this line captured only the bookings an OWNER typed in and
       * missed every booking a client made -- which is most of them. See
       * `supabase/migrations/20261006_business_event_triggers.sql`.
       *
       * The three status events below stay in this file: `update()` is the only
       * path that changes booking status, so they have no bypass, and one
       * writer per event type is what keeps the two mechanisms from
       * duplicating each other.
       */
      /* The meetings table follows the booking. Awaited so a create and its
         meeting land together; non-blocking inside, so it cannot fail this. */
      await this.syncMeeting(data as unknown as Record<string, unknown>);

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
          payments:payment_transactions!payment_transactions_booking_id_fkey(id, amount, refunded_amount, refunded_at, status, invoice_id, paid_at, processor_type)
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
   * Ownership oracle: the booking's id if `userId` owns it, else null.
   *
   * For service-role paths that were handed a booking id by someone else (the
   * Stripe webhook vets metadata ids with it, because a `booking_id` on a
   * payment row reaches the booking through the unscoped
   * `propagate_refund_to_booking` trigger). Deliberately not `findById`: that
   * embeds three resources by named foreign key, and an ownership check must
   * not fail closed on every call because an embed broke. Not found is a normal
   * answer and is not logged. No status filter: this answers "whose is it".
   */
  async findOwnedId(
    id: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      return { data: data?.id ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId: id, userId }, 'Failed to check booking ownership');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The soonest booking starting at or after `afterUtc`.
   *
   * `list` cannot answer this: it is ordered `start_time DESC` — newest first,
   * which is what a history table wants — so asking it for one row from a
   * forward window returns the LAST appointment on the books, not the next one.
   * Reversing the order there would change every caller that reads a list of
   * recent bookings, so the forward question gets its own method.
   *
   * Cancelled bookings are excluded: a slot someone cancelled is not what the
   * owner is being told to expect.
   */
  async findNextAfter(
    userId: string,
    afterUtc: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking | null>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select(`
          *,
          contact:crm_contacts(first_name, last_name, email, phone),
          service:scheduling_services(service_name)
        `)
        .eq('user_id', userId)
        /*
         * CONFIRMED ONLY. "Next" means one the owner still has to attend.
         *
         * `completed` used to be in this list, and a booking can carry that
         * status while still in the future — the owner marks a session done
         * ahead of time, or a recurring series pre-marks its first occurrence.
         * The morning briefing then told an owner their next appointment was on
         * Sunday the 4th, about a session already recorded as finished, and
         * they could see it was wrong.
         *
         * `summariseAppointments` makes the same distinction for today's
         * bookings and documents it at length: a session cannot have finished
         * before it began. This is that rule applied to tomorrow's.
         */
        .eq('status', 'confirmed')
        .gte('start_time', afterUtc)
        .order('start_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as SchedulingBooking) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, afterUtc }, 'Failed to find next booking');
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
          service:scheduling_services(service_name, price, currency, payment_type, installment_count, installment_frequency, sale_mode, is_scheduled),
          invoice:payment_invoices!payment_invoices_booking_id_fkey(id, status, amount, paid_at, due_date, sent_at, refunded_amount, refund_status, refunded_at),
          payments:payment_transactions!payment_transactions_booking_id_fkey(id, amount, refunded_amount, refunded_at, status, invoice_id, paid_at, processor_type),
          planPeriods:payment_plan_installments!payment_plan_installments_booking_id_fkey(id, installment_number, amount, currency, status, trigger, due_date, paid_at, invoice_id, transaction_id, label)
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
    updates: SchedulingBookingUpdate,
    /*
     * Who is moving it, when this update moves the time (20261082). Reaches
     * the new attempt so the journey can name the side that asked for it.
     */
    movedBy?: MeetingOutcomeActor
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    try {
      logger.info({ bookingId: id, userId }, 'Updating booking');

      /*
       * Did THIS call move the status, or had somebody already moved it?
       *
       * This used to read the status in one query and compare it after the
       * write in another, which cannot answer that question under concurrency:
       * three calls all read `confirmed`, all see `confirmed !== 'completed'`,
       * and all three emit. Live data from 2026-10-06 had exactly that --
       * `booking.completed` three times for one booking inside 0.7 seconds,
       * and `booking.cancelled` five times for another.
       *
       * The fix is to let the UPDATE itself be the test. `.neq('status', ...)`
       * makes the write match only a row whose status actually differs, and in
       * READ COMMITTED Postgres re-evaluates that condition after taking the
       * row lock: the first caller to commit sets the status, and every caller
       * behind it then fails the predicate and matches zero rows. So exactly
       * one of them gets a row back, and a returned row IS the transition.
       *
       * `ProposalRepository` has had this shape from the start -- its `send`,
       * `claimForAcceptance` and `decline` are each conditional on the status
       * they expect -- which is why the proposal events have never duplicated.
       *
       * It is also one query fewer than before on the common path: the pre-read
       * is gone.
       */
      /*
       * ───────────────────────────────────────────────────────────────────────
       * MOVING AN APPOINTMENT CLEARS WHAT WAS SAID ABOUT THE OLD ONE
       *
       * A booking given a new time is a fresh attempt, so an outcome recorded
       * against the previous one does not describe it.
       *
       * This lives HERE, not at the call sites, because there are four writers
       * of `start_time` — `rescheduleBooking`, this route's own PATCH (whose
       * comment says it "writes `start_time` itself instead of calling
       * `rescheduleBooking`"), the chat capability engine and the plugin
       * executor. The rule was added to the first one only, and the owner
       * rescheduled through the second: booking ab48357a arrived at its new
       * time still marked `no_show`, and so did the new attempt.
       *
       * That is not a cosmetic slip. `MEETING_HOLDS_SLOT_FILTER` reads a
       * no-show as free time, so the hour a client had just been given was not
       * held and availability would have sold it to somebody else.
       *
       * One read, and only when the time is actually moving.
       * ───────────────────────────────────────────────────────────────────────
       */
      if ('start_time' in updates && updates.start_time) {
        const { data: current } = await this.supabase
          .from('scheduling_bookings')
          .select('start_time, meeting_status')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle();

        const moved =
          current?.start_time != null &&
          new Date(String(current.start_time)).getTime() !==
            new Date(String(updates.start_time)).getTime();

        /* Only when somebody had already answered. An unmarked meeting being
           moved needs nothing cleared, and writing the key anyway would make
           every reschedule trip `MEETING_FIELDS` for no reason. */
        if (moved && current?.meeting_status != null && !('meeting_status' in updates)) {
          (updates as Record<string, unknown>).meeting_status = null;
          logger.info(
            { bookingId: id, previousOutcome: current.meeting_status },
            'Appointment moved after an outcome; the new attempt starts unmarked'
          );
        }
      }

      const evented = Boolean(updates.status && EVENTED_BOOKING_STATUSES.has(updates.status));

      let data: Record<string, unknown> | null = null;
      let claimedTransition = false;

      if (evented) {
        const { data: claimed, error: claimError } = await this.supabase
          .from('scheduling_bookings')
          .update(updates)
          .eq('id', id)
          .eq('user_id', userId)
          // The whole guarantee. Only a row not already at this status matches.
          .neq('status', updates.status as string)
          .select(BOOKING_WITH_CONTACT)
          .maybeSingle();

        if (claimError) throw claimError;
        if (claimed) {
          data = claimed;
          claimedTransition = true;
        }
      }

      if (!data) {
        /*
         * Either an ordinary update, or an evented one whose status was already
         * the target -- a re-save, or a loser of the race above. The fields
         * still have to be written; only the event is withheld.
         */
        const { data: plain, error } = await this.supabase
          .from('scheduling_bookings')
          .update(updates)
          .eq('id', id)
          .eq('user_id', userId)
          .select(BOOKING_WITH_CONTACT)
          .single();

        if (error) throw error;
        data = plain;
      }

      // Extract contact data and add convenience fields
      const contact = Array.isArray(data?.contact) ? data.contact[0] : data?.contact;
      /*
       * Cast once, here.
       *
       * `data` is declared `Record<string, unknown>` because it is assigned
       * from either of two selects above, and both carry a `contact` join that
       * no row interface describes. The spread therefore widens to an index
       * signature and stops matching the declared `SchedulingBooking` return.
       * The shape returned is unchanged from before the claim/lease rewrite --
       * the same spread with the same four convenience fields -- so this
       * records the structural looseness rather than altering what callers
       * receive.
       */
      const normalizedData = (data ? {
        ...data,
        client_first_name: contact?.first_name || null,
        client_last_name: contact?.last_name || null,
        client_email: contact?.email || '',
        client_phone: contact?.phone || null
      } : null) as SchedulingBooking | null;

      logger.info({ bookingId: id, userId }, 'Booking updated');

      /*
       * ───────────────────────────────────────────────────────────────────────
       * ONLY WHEN THE MEETING ACTUALLY CHANGED.
       *
       * This is the path that matters — a RESCHEDULE changes `start_time`, and
       * held and no-show change `meeting_status` — but it is also the busiest
       * method on this repository. `update()` is called to sync payment state,
       * to stamp reminder flags, to record an intake timestamp. None of those
       * touch an appointment, and syncing on each would add a read and a write
       * against a table NOTHING YET READS, on every one.
       *
       * So the gate: sync only when the update names a field a meeting is made
       * of. Everything else costs nothing. The cheapest query is the one that
       * is never sent, and current users should pay nothing for a table that is
       * not serving them yet.
       * ───────────────────────────────────────────────────────────────────────
       */
      const MEETING_FIELDS = [
        'start_time',
        'end_time',
        'timezone',
        'meeting_status',
        'outcome_by',
        'outcome_at',
        'external_calendar_event_id',
        'calendar_synced_at',
      ] as const;

      if (MEETING_FIELDS.some(field => field in updates)) {
        await this.syncMeeting(data as unknown as Record<string, unknown>, movedBy);
      }

      /*
       * Write down that this happened.
       *
       * The repository rather than the callers: six different places change a
       * booking's status — the API route, the chat capability engine, the
       * plugin executor, the lifecycle service — and an emit added to each is
       * an emit forgotten by the seventh. This is the only point they all pass
       * through.
       *
       * Fire-and-forget and swallowed, exactly as LeadAlertService does it:
       * nothing downstream is allowed to fail a booking update, and the table
       * may not be migrated everywhere.
       */
      if (claimedTransition && data) {
        emitBookingStatusEvent(userId, data, updates.status as EventedBookingStatus);
      }
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
   *
   * ───────────────────────────────────────────────────────────────────────────
   * AN ATTENDANCE THAT WAS RECORDED IS NOT OVERWRITTEN
   *
   * `status` is asked to hold two different facts: what happened to the
   * APPOINTMENT (held, no-show, still ahead) and what happened to the JOB
   * (running, stopped). For most bookings they are the same fact, so one
   * column is enough.
   *
   * A quoted job is where they come apart. The consultation is held, the owner
   * marks it so — `status: 'completed'` — and the quote is declined or goes
   * unpaid, so the owner cancels. There is no `completed_at` column, so writing
   * `cancelled` here does not hide that the meeting happened, it ERASES it: the
   * client journey then titles a meeting the owner sat through as
   * "הזמנה בוטלה / בוטלה", and nothing anywhere remembers otherwise.
   *
   * So a booking that already carries an answer about attendance keeps it. The
   * meeting WAS held; cancelling the job afterwards does not un-hold it. What
   * the cancellation needs to record still gets recorded — the code, the note
   * and who called it off are written below either way — and the job's own
   * state lives where it belongs: the proposal moves to `stopped` and its
   * stages to `cancelled`, which is what the badges already read.
   *
   * This is the same split the booking card makes between `attendanceRecorded`
   * and `jobIsOver`, which is what allows Cancel to be offered after a
   * consultation is marked held in the first place.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async cancel(
    id: string,
    userId: string,
    reason?: string,
    /**
     * The structured half: a code from `cancellationReasons`, the note behind it,
     * and who called it off.
     *
     * Separate from `reason` rather than replacing it. `reason` is the prose
     * `cancellation_reason` has always held — including the
     * `CLIENT_CANCELLED_PREFIX` that a gap and a detector still parse — and
     * rewriting it would break them. This adds the columns those readers should
     * move to, without moving them today.
     *
     * Optional at this layer only because rows cancelled by older code paths
     * exist; the API requires a code on everything new.
     */
    structured?: {
      code?: string | null;
      note?: string | null;
      cancelledBy?: CancelledBy | null;
    }
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    /*
     * Its own narrow read rather than `findById`, which JOINs the contact and
     * the invoices for a single column this does not otherwise need.
     *
     * A failure here does not block the cancellation. It leaves
     * `attendanceRecorded` false, so the status is written as it always was:
     * the worst case is the behaviour that shipped before this, not a
     * cancellation that silently did not happen.
     */
    let attendanceRecorded = false;
    let alreadyCancelled = false;
    const { data: current } = await this.supabase
      .from('scheduling_bookings')
      .select('status, meeting_status, cancelled_by, cancel_reason')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    /*
     * BOTH columns, and `meeting_status` is the one that matters now.
     *
     * `complete()` and `markNoShow()` no longer write `status` — that is the
     * whole point of the separation — so a meeting marked held today reads
     * `status = 'confirmed'` and only `meeting_status = 'held'`. Testing
     * `status` alone would call that "no attendance recorded", fall into the
     * branch below, and write `meeting_status: 'cancelled'` straight over the
     * `held` this guard exists to protect.
     *
     * `status` is still read for the rows that predate the split, where the
     * outcome lives there and nowhere else.
     */
    const outcomeOnMeeting =
      current?.meeting_status === 'held' || current?.meeting_status === 'no_show';
    const outcomeOnStatus =
      current?.status === 'completed' || current?.status === 'no_show';

    if (outcomeOnMeeting || outcomeOnStatus) {
      attendanceRecorded = true;
      alreadyCancelled = Boolean(current?.cancelled_by || current?.cancel_reason);
    }

    /*
     * ── SOMEBODY HAS ALREADY ANSWERED FOR THE MEETING ───────────────────────
     *
     * A WIDER question than `attendanceRecorded`, and it governs a different
     * pair of columns.
     *
     * `attendanceRecorded` asks whether the meeting HAPPENED, because that is
     * what decides whether `status` and `meeting_status` may be overwritten.
     * It deliberately excludes `cancelled`: a meeting called off has not
     * happened, so the job going off with it is no contradiction.
     *
     * But `outcome_by` and `outcome_at` describe WHO answered and WHEN, and a
     * cancellation is an answer. Stamping them again puts the moment the JOB
     * was stopped onto the meeting's own row — two different events reduced to
     * one timestamp, and the earlier one gone.
     *
     * Concretely: a meeting called off at 01:55 through `cancelMeeting`, then
     * the job stopped at 02:30, left the journey reading "you cancelled the
     * meeting 02:30". The owner's own rail lost the half-hour in which the
     * appointment was off and the work was not.
     *
     * So an answer that exists is never restamped. Null stays null where
     * nobody recorded one — rows predating `outcome_at` have no honest value,
     * and `now` is the one thing it certainly was not.
     */
    const meetingAlreadyAnswered = current?.meeting_status != null;

    const result = await this.update(id, userId, {
      /*
       * Omitted, not set to the old value: `update` stamps `updated_at` and
       * writes only the keys it is given, so leaving it out is what preserves it.
       *
       * `meeting_status` rides the SAME guard, and that is the point of the
       * pairing. A meeting that had not happened is off, so it is cancelled
       * with the job. A meeting already marked `held` or `no_show` keeps its
       * outcome: the consultation did take place, and calling off the work
       * afterwards does not un-happen it.
       *
       * This is the fact the platform could not previously record — it is why
       * five rows in production read `status = 'completed'` with a
       * `cancel_reason` beside them.
       */
      ...(attendanceRecorded
        ? {}
        : {
            status: 'cancelled' as const,
            meeting_status: 'cancelled' as const,
            /* Who called it off, on the appointment as well as the job — and
               only where the appointment had no answer of its own yet. See
               `meetingAlreadyAnswered`. */
            ...(meetingAlreadyAnswered
              ? {}
              : {
                  outcome_by: (structured?.cancelledBy ?? 'owner') as MeetingOutcomeActor,
                  outcome_at: new Date().toISOString(),
                }),
          }),
      cancellation_reason: reason || null,
      cancel_reason: structured?.code || null,
      // Trimmed to null: '' would read as a note that exists and says nothing.
      cancel_note: structured?.note?.trim() || null,
      cancelled_by: structured?.cancelledBy || null
    });

    /*
     * THE CANCELLATION STILL HAPPENED, SO IT STILL GETS AN EVENT.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * `update()` emits `booking.cancelled` only when the status write itself
     * claims the transition — deliberately, because the conditional UPDATE is
     * what stops three concurrent callers emitting three events for one
     * booking. Omitting `status` above therefore also withholds the event, and
     * `CashCancelledUnrefundedDetector` and the `booking_cancelled` gap are
     * what read it. A job stopped with the client's money still held is
     * precisely what that detector exists to surface, so going quiet there
     * would be the worse bug of the two.
     *
     * The column and the event answer different questions. The column is the
     * appointment's outcome, which is `completed`. The event is a record of
     * what happened, and a cancellation happened. Both are true at once.
     *
     * Exactly one emit on either path: `update()` fires it when it writes the
     * status, this fires it when it does not.
     *
     * `alreadyCancelled` keeps a re-cancel from emitting twice. It is a
     * pre-read rather than a claimed write, so two cancels landing in the same
     * instant on an already-held booking could both emit — narrower than the
     * window `update()` closes, and the cost is a duplicate retention event
     * rather than a duplicate email.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (attendanceRecorded && !alreadyCancelled && result.data) {
      emitBookingStatusEvent(userId, result.data as unknown as Record<string, unknown>, 'cancelled');
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * AND THE PACKAGE'S SESSIONS, WHICH THE BOOKING ROW CANNOT SPEAK FOR.
     *
     * Everything above writes `scheduling_bookings`. For an ordinary booking
     * that IS the appointment, so stamping `meeting_status` there releases the
     * hour and the job is done.
     *
     * A package is one booking with N rows in `scheduling_meetings`, and the
     * hours live on those rows: `busyMeetings` reads that table and nothing
     * else, and so does the `scheduling_meetings_no_overlap` constraint. So
     * stopping a package left all six sessions with `meeting_status = NULL`,
     * still holding six hours in the owner's diary for work that is off. They
     * would have gone on blocking new bookings indefinitely, and nothing would
     * ever have cleared them: 20261075 is a ONE-OFF backfill, not a trigger,
     * and there is no cascade from the booking to its meetings anywhere.
     *
     * Not yet visible in live data only because no package has been stopped
     * since packages became meetings.
     *
     * ── THE SAME GUARD AS THE BOOKING'S OWN ──────────────────────────────────
     * `meeting_status IS NULL` only. A session already marked `held`,
     * `no_show` or `moved` keeps its answer: those sessions DID happen, or
     * were already resolved, and stopping the work afterwards does not
     * un-happen them. It is the rule the booking update above applies to
     * itself through `attendanceRecorded`, and the rule 20261075's backfill
     * applied to the rows it fixed.
     *
     * Non-fatal, and after the booking write rather than before: the job being
     * cancelled is the fact that matters, and a session left holding an hour
     * is visible and fixable where a thrown error would leave the owner
     * believing nothing was cancelled at all.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (result.data) {
      const { data: sessions, error: sessionsError } = await this.supabase
        .from('scheduling_meetings')
        .update({
          meeting_status: 'cancelled',
          outcome_by: (structured?.cancelledBy ?? 'owner') as MeetingOutcomeActor,
          outcome_at: new Date().toISOString(),
        })
        .eq('booking_id', id)
        .eq('user_id', userId)
        .is('meeting_status', null)
        /* The rows this call actually stamped, so the diary sweep below settles
           exactly those and never an hour somebody already answered for. */
        .select('id, start_time, end_time, external_calendar_event_id, calendar_sync_provider');

      if (sessionsError) {
        logger.error(
          { err: sessionsError, bookingId: id, userId },
          'A job was cancelled but its sessions may still be holding their hours'
        );
      }

      /*
       * ───────────────────────────────────────────────────────────────────────
       * AND OUT OF THE DIARY, one entry per session.
       *
       * A package's events are recorded on the MEETING rows, so the booking
       * paths that remove "the" calendar event find nothing and leave all six
       * standing. The hours are free everywhere this platform decides from, and
       * the owner's own calendar says otherwise.
       *
       * The rule is `settleSessionDiaryEntry`'s, not this method's, and it is
       * the same rule one cancelled session gets: an hour still ahead has its
       * entry deleted, because it is genuinely bookable again; an hour already
       * past keeps its entry, labelled, because nothing can be booked into it
       * and deleting would erase the owner's own record of the day.
       *
       * Sequential rather than parallel: each one is an API call to the
       * owner's calendar provider, and six at once is how a rate limit turns
       * one cancellation into five stale entries.
       *
       * Never fatal, and last: the booking is cancelled and the hours are free
       * before this runs.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (sessions?.length) {
        try {
          const { settleSessionDiaryEntry } = await import(
            '@/lib/scheduling/settleSessionDiaryEntry'
          );

          const withEvents = sessions.filter(row => row.external_calendar_event_id);

          if (withEvents.length && result.data) {
            const { data: service } = result.data.service_id
              ? await schedulingServiceRepository.findById(
                  String(result.data.service_id),
                  userId
                )
              : { data: null };

            if (service) {
              for (const row of withEvents) {
                await settleSessionDiaryEntry({
                  booking: result.data as SchedulingBooking,
                  service,
                  userId,
                  meeting: {
                    id: String(row.id),
                    external_calendar_event_id: row.external_calendar_event_id as string,
                    calendar_sync_provider: row.calendar_sync_provider as never,
                    start_time: row.start_time as string | null,
                    end_time: row.end_time as string | null,
                  },
                  outcome: 'cancelled',
                });
              }
            }
          }
        } catch (err) {
          logger.error(
            { err, bookingId: id, userId },
            "A job was cancelled but its sessions' diary entries were not settled"
          );
        }
      }
    }

    return result;
  }

  /**
   * Mark booking as completed
   */
  async complete(
    id: string,
    userId: string,
    /**
     * Who recorded it.
     *
     * Defaults to `owner` because the drawer's buttons are the dominant path
     * and a human pressing one is the dominant case. The two paths where no
     * person is involved pass `system` explicitly:
     * `LeadResponseDispatchService`, which completes a booking when a lead
     * replies, and the plugin executor acting for an agent. Blaming the owner
     * for either would make the journey say something untrue.
     */
    by: MeetingOutcomeActor = 'owner'
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    /*
     * THE MEETING ONLY. THE JOB IS NOT TOUCHED.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * "The meeting took place" is a fact about an APPOINTMENT. It was also
     * writing `status = 'completed'`, which is a fact about the JOB — and on a
     * quoted service those are weeks apart: the consultation happened, and the
     * quote, the agreement and the money have not.
     *
     * That overload is what this whole change exists to end. Marking a
     * consultation held closed the booking, took Cancel away, settled the row
     * for every reader of `SETTLED_BOOKING_STATUSES`, and left the owner with a
     * job the platform believed was finished before it had been priced.
     *
     * Only `cancelBooking` writes `status` now. Held and no-show write here.
     *
     * `holdsSlot` and `attendanceRecorded` were moved onto this column in the
     * same change, so the calendar still frees a missed slot and the buttons
     * still hide once an outcome is recorded.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const result = await this.update(id, userId, { meeting_status: 'held', outcome_by: by, outcome_at: new Date().toISOString() });

    /*
     * THE EVENT STILL HAS TO FIRE, AND IT STOPPED.
     *
     * `update()` emits `booking.completed` only when its conditional status
     * write claims the transition — that is what stops concurrent callers
     * emitting twice. No status write now means no event, and the metrics that
     * count delivered work read nothing but events.
     *
     * The column and the event answer different questions, and both are true:
     * `meeting_status` is the appointment's outcome, the event is the record
     * that it happened. `cancel()` solved this the same way for the same
     * reason — see the note above it.
     */
    if (result.data) {
      emitBookingStatusEvent(userId, result.data as unknown as Record<string, unknown>, 'completed');
    }

    return result;
  }

  /**
   * Mark booking as no-show
   */
  /**
   * The APPOINTMENT is off. The job carries on.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS IS NOT `cancel()`
   *
   * `cancel()` ends the work: it writes `status: 'cancelled'`, stops the
   * proposal, cancels the payment stages and emails the client. That is the
   * right action when the job is off.
   *
   * This is the other case, and it has no other home: the owner and the client
   * agree to proceed WITHOUT meeting. The site visit is called off and the
   * quote still gets written. Before this, an owner in that position could only
   * cancel the whole job or leave an appointment nobody would attend sitting
   * there as an unanswered question.
   *
   * So: the outcome only. `status` is untouched, no proposal is stopped, no
   * money moves, and `journeyReadiness`, `quoteGate` and the badges all read
   * the job as alive — which it is.
   *
   * TWO CONSEQUENCES WORTH NAMING. `holdsSlot` excludes `cancelled`, so the
   * hour goes back on sale immediately, which is the point. And `quoteGate`
   * returns `open` for a cancelled meeting rather than asking what happened at
   * it, because nobody is going to answer that.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async cancelMeeting(
    id: string,
    userId: string,
    by: MeetingOutcomeActor = 'owner',
    /**
     * Is the quote still coming (20261083)?
     *
     * Kept, not merely used to pick an email sentence. An owner who answers no
     * has a booking still sitting open as live work, and nothing reminded them
     * because nothing remembered. `undefined` writes nothing, so a caller that
     * never asked leaves the column NULL rather than claiming an answer.
     */
    proposalContinues?: boolean
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    const result = await this.update(id, userId, {
      meeting_status: 'cancelled',
      outcome_by: by,
      outcome_at: new Date().toISOString(),
      ...(proposalContinues === undefined ? {} : { proposal_continues: proposalContinues }),
    } as SchedulingBookingUpdate);

    if (result.data) {
      logger.info({ bookingId: id, userId, by }, 'Meeting cancelled; the job continues');
    }

    return result;
  }

  async markNoShow(
    id: string,
    userId: string,
    /**
     * Who recorded it.
     *
     * Defaults to `owner` because the drawer's buttons are the dominant path
     * and a human pressing one is the dominant case. The two paths where no
     * person is involved pass `system` explicitly:
     * `LeadResponseDispatchService`, which completes a booking when a lead
     * replies, and the plugin executor acting for an agent. Blaming the owner
     * for either would make the journey say something untrue.
     */
    by: MeetingOutcomeActor = 'owner'
  ): Promise<SchedulingRepositoryResult<SchedulingBooking>> {
    /*
     * The meeting only, for the reason given on `complete()` above — and on a
     * quoted job this one mattered most. `no_show` is in
     * `SETTLED_BOOKING_STATUSES`, so a client missing a site visit settled the
     * whole job, while `quoteGate` was simultaneously reporting it alive and
     * still worth pricing. The two could not both be true.
     */
    const result = await this.update(id, userId, { meeting_status: 'no_show', outcome_by: by, outcome_at: new Date().toISOString() });

    /*
     * `retention.no_show_rate` is computed by COUNTING `booking.no_show`
     * events, and `RetNoShowSpikeDetector` watches that metric. Without this
     * the rate reads zero forever and the spike can never fire — while the
     * confirmation dialog goes on promising the owner that this "נספרת בשיעור
     * אי-ההגעות". See `complete()` above for why the emit lives here now.
     */
    if (result.data) {
      emitBookingStatusEvent(userId, result.data as unknown as Record<string, unknown>, 'no_show');
    }

    return result;
  }

  /**
   * Delete booking
   */
  /**
   * The meetings a PACKAGE bought, in the order they were sold.
   *
   * `occurrence_number` carries that order, so the caller never sorts: the
   * drawer, the calendar and the confirmation email all show "session 3 of 6"
   * and must agree about which one that is.
   *
   * Scoped by `user_id` as well as the parent (CLAUDE.md rule 4): a parent id
   * is a guess away from another business's package.
   */
  async findChildren(
    parentBookingId: string,
    userId: string
  ): Promise<SchedulingRepositoryResult<SchedulingBooking[]>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select('id, start_time, end_time, status, occurrence_number')
        .eq('parent_booking_id', parentBookingId)
        .eq('user_id', userId)
        .order('occurrence_number', { ascending: true });

      if (error) throw error;

      return { data: (data || []) as unknown as SchedulingBooking[], error: null };
    } catch (error) {
      logger.error(
        { err: error, parentBookingId, userId },
        'Failed to read the meetings of a package'
      );
      return { data: null, error: error as Error };
    }
  }

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

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // Moved out of `app/api/stripe/webhook/route.ts` with no behaviour change
  // (CF-5 PR 4, CLAUDE.md rule 1). Each method issues exactly the query the
  // route issued inline: same table, operation, payload and its key order,
  // filters in order, awaited with nothing read back. The webhook's
  // characterisation harness records the full chain.
  //
  // No `user_id` filter, as an exception to rule 4, bounded per
  // docs/REPOSITORY_STRATEGY.md ("unscoped by design"): each doc names the owner
  // check it relies on instead. A unit test asserts neither adds one. These set
  // `payment_status`; none filters on it (bookingPaymentStatusReaders.guard).
  //
  // Errors: supabase-js's own `{ data, error }`, with no try/catch and no
  // logging, unlike the methods above. The route logs every error it acts on; a
  // catch here would turn a thrown query into a quiet miss where the webhook
  // used to fail with 500 and let Stripe retry. Deliberately not `update()`:
  // that is user-scoped, pre-reads the status and returns a joined row.

  /**
   * ⟨unscoped-by-design⟩ Connect `invoice.paid`: the booking an invoice was
   * raised for is now paid.
   *
   * Owner check relied on: the id is the `booking_id` of an invoice the route
   * proved owned (`accountOwns`) before this write. The booking's own owner is
   * not re-checked, and there is no `user_id` filter (FU-4, pre-existing).
   */
  async markPaidUnscoped(id: string): Promise<WebhookBookingResult<null>> {
    const { error } = await this.supabase
      .from('scheduling_bookings')
      .update({
        payment_status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Connect checkout for an invoice: the invoice's booking
   * is now paid, and confirmed if it was only pending because money was owed.
   * The `status = 'pending'` filter keeps a cancelled or completed booking from
   * being brought back by a late event.
   *
   * Owner check relied on: as `markPaidUnscoped`, the `booking_id` of an invoice
   * proved owned (`accountOwns`); no `user_id` filter (FU-4, pre-existing).
   */
  async markPaidAndConfirmIfPending(id: string): Promise<WebhookBookingResult<null>> {
    const { error } = await this.supabase
      .from('scheduling_bookings')
      .update({
        payment_status: 'paid',
        status: 'confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending');
    return { data: null, error };
  }

  // Stripe webhook and plan binding: owner-scoped (CF-5 PR 4)
  //
  // The same moves as the section above, for the queries that already carried a
  // `user_id` filter inline (the webhook's plan period and checkout booking,
  // `bindPlanSubscription`'s plan link and contact read). They keep it, in the
  // same place, so a booking of another business matches no row. Same error
  // handling: no try/catch, no logging.

  /**
   * A plan period was collected: the plan's booking is paid. Scoped to the
   * plan's owner, which the webhook proved (`accountOwns`).
   */
  async markPaidForOwner(id: string, userId: string): Promise<WebhookBookingResult<null>> {
    const { error } = await this.supabase
      .from('scheduling_bookings')
      .update({ payment_status: 'paid', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    return { data: null, error };
  }

  /**
   * Connect checkout for a booking (Fix-1, F-2): the booking id is metadata the
   * connected account wrote, so the write is scoped to the business that owns
   * the sending account. Asks for `count` (never `.select()` after an update):
   * `0` is how the caller tells a foreign id from a booking it updated.
   */
  async markPaidForOwnerCounted(id: string, userId: string): Promise<WebhookBookingResult<null>> {
    const { error, count } = await this.supabase
      .from('scheduling_bookings')
      .update(
        {
          payment_status: 'paid',
          updated_at: new Date().toISOString(),
        },
        { count: 'exact' }
      )
      .eq('id', id)
      .eq('user_id', userId);
    return { data: null, error, count };
  }

  /**
   * `bindPlanSubscription`: tells a booking which plan it is sold under, so the
   * drawer never has to infer a plan. Scoped to the plan's owner; the booking id
   * was vetted against that owner first (Fix-1b).
   */
  async linkPaymentPlan(id: string, userId: string, paymentPlanId: string): Promise<WebhookBookingResult<null>> {
    const { error } = await this.supabase
      .from('scheduling_bookings')
      .update({ payment_plan_id: paymentPlanId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    return { data: null, error };
  }

  /**
   * `bindPlanSubscription`: the contact a plan's booking belongs to, or `null`.
   * Scoped to the owner, so a booking of another business reads as absent.
   */
  async findContactIdForOwner(
    id: string,
    userId: string
  ): Promise<WebhookBookingResult<{ contact_id: string | null }>> {
    const { data, error } = await this.supabase
      .from('scheduling_bookings')
      .select('contact_id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle<{ contact_id: string | null }>();
    return { data, error };
  }
}

// Singleton exports (initialized with server-side Supabase client)
import { supabaseServer } from '@/lib/supabaseServer';
import { DEFAULT_ADVANCE_BOOKING_DAYS } from '@/lib/scheduling/bookingWindow';
export const schedulingServiceRepository = new SchedulingServiceRepository(supabaseServer);
export const schedulingBookingRepository = new SchedulingBookingRepository(supabaseServer);
