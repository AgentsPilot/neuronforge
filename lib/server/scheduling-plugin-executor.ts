// lib/server/scheduling-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import {
  schedulingServiceRepository,
  schedulingBookingRepository,
  type SchedulingServiceInsert,
  type SchedulingServiceUpdate,
  type SchedulingBookingInsert,
  type SchedulingBookingUpdate,
} from '@/lib/repositories/SchedulingRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';

const pluginName = 'scheduling';

/**
 * Internal Scheduling plugin executor.
 *
 * Repository-backed: every operation delegates to the scheduling repositories
 * (`schedulingServiceRepository` / `schedulingBookingRepository`), the sole data path for the
 * scheduling tables. No external API and no OAuth — gated by the `db_active` access strategy,
 * so `connection.user_id` is a verified BOS tenant by the time an action runs.
 *
 * GUARDRAIL (roadmap recipe / SA T1/T2 finding): booking writes DELEGATE ONLY. The Postgres
 * triggers own the cross-capability side-effects — T1 creates/links the `crm_contacts` row and
 * T2 logs the `crm_activities` booking activity (only when `contact_id` is set, on INSERT or a
 * status change). The executor must NOT emit contacts/activities itself. Calendar-sync fields
 * (`external_calendar_event_id`, …) are owned by the calendar-sync routes and are ignored here.
 */
export class SchedulingPluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    const userId: string | undefined = connection?.user_id;
    if (!userId) {
      throw new Error('access_denied: missing user context for Scheduling operation');
    }
    const params = parameters || {};

    switch (actionName) {
      // ---------------- SERVICES ----------------
      case 'create_service':
        this.requireParam(params.service_name, 'service_name');
        this.requireParam(params.duration_minutes, 'duration_minutes');
        return this.unwrap(
          await schedulingServiceRepository.create(this.buildServiceInsert(userId, params))
        );

      case 'list_services':
        return this.unwrap(await schedulingServiceRepository.listAll(userId, params.active_only === true));

      case 'get_service':
        this.requireParam(params.id, 'id');
        return this.unwrap(await schedulingServiceRepository.findById(params.id, userId));

      case 'update_service':
        this.requireParam(params.id, 'id');
        return this.unwrap(
          await schedulingServiceRepository.update(params.id, userId, this.buildServiceUpdate(params))
        );

      case 'publish_service':
        this.requireParam(params.id, 'id');
        return this.unwrap(await schedulingServiceRepository.publish(params.id, userId));

      case 'delete_service':
        this.requireParam(params.id, 'id');
        return this.unwrap(await schedulingServiceRepository.delete(params.id, userId));

      // ---------------- BOOKINGS ----------------
      case 'create_booking':
        // Delegates to repo.create ONLY. T1 links the contact, T2 logs the booking activity —
        // the executor emits neither.
        this.requireParam(params.service_id, 'service_id');
        this.requireParam(params.client_first_name, 'client_first_name');
        this.requireParam(params.client_email, 'client_email');
        this.requireParam(params.start_time, 'start_time');
        this.requireParam(params.end_time, 'end_time');
        return this.unwrap(
          await schedulingBookingRepository.create(await this.buildBookingInsert(userId, params))
        );

      case 'list_bookings':
        return this.unwrap(
          await schedulingBookingRepository.list(userId, {
            serviceId: params.service_id,
            contactId: params.contact_id,
            status: params.status,
            startDate: params.start_date,
            endDate: params.end_date,
            search: params.search,
            limit: params.limit,
            offset: params.offset,
          })
        );

      case 'get_booking':
        this.requireParam(params.id, 'id');
        return this.unwrap(await schedulingBookingRepository.findById(params.id, userId));

      case 'update_booking':
        this.requireParam(params.id, 'id');
        return this.unwrap(
          await schedulingBookingRepository.update(params.id, userId, this.buildBookingUpdate(params))
        );

      case 'cancel_booking':
        this.requireParam(params.id, 'id');
        return this.unwrap(await schedulingBookingRepository.cancel(params.id, userId, params.reason));

      case 'complete_booking':
        this.requireParam(params.id, 'id');
        return this.unwrap(await schedulingBookingRepository.complete(params.id, userId));

      case 'mark_no_show':
        this.requireParam(params.id, 'id');
        return this.unwrap(await schedulingBookingRepository.markNoShow(params.id, userId));

      case 'reschedule_booking':
        this.requireParam(params.id, 'id');
        this.requireParam(params.new_start_time, 'new_start_time');
        return this.rescheduleBooking(userId, params.id, params.new_start_time);

      case 'count_bookings':
        // countBookings is user_id-scoped (M2), so a foreign service_id yields 0 — no leak.
        this.requireParam(params.service_id, 'service_id');
        return this.unwrap(await schedulingServiceRepository.countBookings(params.service_id, userId));

      case 'check_availability':
        this.requireParam(params.start_time, 'start_time');
        this.requireParam(params.end_time, 'end_time');
        return this.checkAvailability(userId, params.start_time, params.end_time);

      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  /** Internal plugins hold no token — trivial active status. */
  protected async performConnectionTest(connection: any): Promise<any> {
    return { status: 'active', internal: true, user_id: connection?.user_id };
  }

  // ---------------- Reschedule + availability (parity with SafeExecutionLayer) ----------------

  /**
   * Reschedule a booking: keep its duration, reject if the new time overlaps another booking or
   * falls outside configured availability, then update. Mirrors
   * SafeExecutionLayer.executeRescheduleBooking (minus the staged-confirmation flow — the plugin
   * path executes directly).
   */
  private async rescheduleBooking(userId: string, bookingId: string, newStartTime: string) {
    const booking = this.unwrap(await schedulingBookingRepository.findById(bookingId, userId));
    if (!booking) {
      throw new Error('not_found: booking not found');
    }

    const durationMs = new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime();
    const newStart = new Date(newStartTime);
    const newEnd = new Date(newStart.getTime() + durationMs);

    // Conflict check (exclude this booking).
    const overlaps = this.unwrap(
      await schedulingBookingRepository.checkOverlap(userId, newStart.toISOString(), newEnd.toISOString(), bookingId)
    );
    if (overlaps && overlaps.length > 0) {
      throw new Error(`conflict: the new time overlaps ${overlaps.length} existing booking(s)`);
    }

    // Availability-window check.
    const window = await this.checkAvailabilityWindow(userId, newStart, newEnd);
    if (!window.ok) {
      throw new Error(`unavailable: ${window.reason}`);
    }

    return this.unwrap(
      await schedulingBookingRepository.update(bookingId, userId, {
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
      })
    );
  }

  /**
   * Is a slot bookable? Returns a structured verdict (not a throw) — an unavailable slot is a
   * valid answer, not an error.
   */
  private async checkAvailability(userId: string, startTime: string, endTime: string) {
    const start = new Date(startTime);
    const end = new Date(endTime);

    const overlaps =
      this.unwrap(await schedulingBookingRepository.checkOverlap(userId, start.toISOString(), end.toISOString())) || [];
    if (overlaps.length > 0) {
      return {
        available: false,
        reason: `Overlaps ${overlaps.length} existing booking(s).`,
        // MERGE FIX (2026-09-02, F4): this read `b.client_first_name` / `b.client_last_name`,
        // columns dropped by 20260810_remove_client_fields_and_total_amount.sql. It produced
        // the literal string "undefined" rather than an error, and TypeScript could not catch
        // it because `unwrap()` returns `any`. The client now lives in crm_contacts; the
        // booking carries only `contact_id`, which is what an agent needs to look it up.
        conflicts: overlaps.map((b) => ({
          start: b.start_time,
          end: b.end_time,
          contact_id: b.contact_id,
        })),
      };
    }

    const window = await this.checkAvailabilityWindow(userId, start, end);
    if (!window.ok) {
      return { available: false, reason: window.reason };
    }

    return { available: true };
  }

  /**
   * Validate a [start, end] range against the account's configured availability
   * (`business_profiles.scheduling_availability`, per-weekday `{start,end}` HH:MM windows).
   * No config → no window restriction (parity with SafeExecutionLayer). Uses local-time
   * hours to match the existing behavior (a documented v1 timezone caveat).
   */
  private async checkAvailabilityWindow(
    userId: string,
    start: Date,
    end: Date
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { data: profile } = await businessProfileRepository.findByUserId(userId);
    const availability = (profile as { scheduling_availability?: Record<string, Array<{ start: string; end: string }>> } | null)
      ?.scheduling_availability;
    if (!availability) return { ok: true };

    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = days[start.getDay()];
    const daySlots = availability[dayOfWeek];
    if (!daySlots || daySlots.length === 0) {
      return { ok: false, reason: `Not available on ${dayOfWeek}s.` };
    }

    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const startStr = hhmm(start);
    const endStr = hhmm(end);
    const within = daySlots.some((slot) => slot.start <= startStr && slot.end >= endStr);
    if (!within) {
      return {
        ok: false,
        reason: `Time ${startStr} is outside available hours: ${daySlots.map((s) => `${s.start}-${s.end}`).join(', ')}`,
      };
    }
    return { ok: true };
  }

  // ---------------- helpers ----------------

  private unwrap<T>(result: { data: T | null; error: Error | null }): T | null {
    if (result.error) throw result.error;
    return result.data;
  }

  private requireParam(value: unknown, name: string): void {
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required parameter: ${name}`);
    }
  }

  private buildServiceInsert(userId: string, params: any): SchedulingServiceInsert {
    const insert: SchedulingServiceInsert = {
      user_id: userId,
      service_name: params.service_name,
      duration_minutes: params.duration_minutes,
    };
    for (const key of ['description', 'price', 'currency', 'buffer_minutes', 'max_bookings_per_day', 'advance_booking_days', 'min_notice_hours', 'status'] as const) {
      if (params[key] !== undefined) (insert as any)[key] = params[key];
    }
    return insert;
  }

  private buildServiceUpdate(params: any): SchedulingServiceUpdate {
    const update: SchedulingServiceUpdate = {};
    for (const key of ['service_name', 'description', 'duration_minutes', 'price', 'currency', 'buffer_minutes', 'max_bookings_per_day', 'advance_booking_days', 'min_notice_hours', 'is_active', 'status'] as const) {
      if (params[key] !== undefined) (update as any)[key] = params[key];
    }
    return update;
  }

  /**
   * MERGE FIX (2026-09-02, F4): `scheduling_bookings` no longer carries client_first_name /
   * client_last_name / client_email / client_phone -- migration
   * 20260810_remove_client_fields_and_total_amount.sql drops them and the client now lives in
   * `crm_contacts`, reached through the required `contact_id`.
   *
   * The plugin's declared contract is unchanged (`client_first_name` + `client_email` remain
   * the required inputs of create_booking), so the client is resolved to a contact here --
   * find-by-email, else create -- exactly as the public booking routes do
   * (app/api/website/booking/create). Writing the old columns would fail at PostgREST.
   *
   * An explicit `contact_id` param still wins; the lookup is skipped in that case.
   */
  private async buildBookingInsert(userId: string, params: any): Promise<SchedulingBookingInsert> {
    let contactId: string | undefined = params.contact_id;

    if (!contactId) {
      const existing = await crmContactRepository.findByEmail(params.client_email, userId);
      if (existing.data) {
        contactId = existing.data.id;
      } else {
        const created = await crmContactRepository.create({
          user_id: userId,
          first_name: params.client_first_name,
          last_name: params.client_last_name ?? null,
          email: params.client_email,
          phone: params.client_phone ?? null,
          source: 'scheduling_plugin',
        });
        if (created.error || !created.data) {
          throw new Error(`Failed to resolve contact for booking: ${created.error?.message ?? 'unknown error'}`);
        }
        contactId = created.data.id;
      }
    }

    const insert: SchedulingBookingInsert = {
      user_id: userId,
      service_id: params.service_id,
      contact_id: contactId,
      start_time: params.start_time,
      end_time: params.end_time,
    };
    for (const key of ['timezone', 'status', 'notes', 'internal_notes', 'booking_source'] as const) {
      if (params[key] !== undefined) (insert as any)[key] = params[key];
    }
    return insert;
  }

  private buildBookingUpdate(params: any): SchedulingBookingUpdate {
    const update: SchedulingBookingUpdate = {};
    for (const key of ['status', 'cancellation_reason', 'payment_status', 'internal_notes', 'start_time', 'end_time'] as const) {
      if (params[key] !== undefined) (update as any)[key] = params[key];
    }
    return update;
  }
}
