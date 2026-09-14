/**
 * Put a booking in the calendar the owner actually looks at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN MODULE
 *
 * `CalendarSyncService.syncBookingToCalendar` had exactly one caller:
 * `createBooking` in `BookingLifecycleService`, which is reached only from
 * `/api/scheduling/bookings` — the OWNER-facing route.
 *
 * The public booking routes — `/api/website/booking/create`, `/confirm` and
 * `/finalize`, which is how every client who is not the owner books — never
 * called it. So the asymmetry was exact and backwards:
 *
 *   a booking the owner made themselves    → in their calendar
 *   a booking a CLIENT made                → nowhere
 *
 * The second is the one they need to be told about. They already know about the
 * first. And the `calendar-sync` cron does not close the gap: it runs
 * `syncExternalEvents`, which is the INBOUND direction — pulling the owner's
 * existing events in to block availability — and never pushes a booking out.
 *
 * So a client could pick a slot, pay for it, and receive a confirmation, while
 * the business's calendar showed the hour as free and nothing told them
 * otherwise. This closes that.
 *
 * THE SAME GAP EXISTS FOR CHANGES, AND IS WORSE
 *
 * When a CLIENT cancels or reschedules through their manage link, neither route
 * touched the calendar at all. So a cancelled 9am stayed blocked in the owner's
 * calendar — held for somebody who was not coming — and a rescheduled
 * appointment stayed at the OLD time, which is a phantom meeting plus a missed
 * real one. The owner-facing paths have always done this correctly, which is
 * the same asymmetry: what the owner does themselves is handled; what a client
 * does is not.
 *
 * TAKES AN ID, NOT OBJECTS
 *
 * The sync needs a whole booking row — the client's name and email, both
 * timestamps — and a whole service row. The public routes hold narrow selects
 * (`id, start_time, end_time`), so handing them straight over would either not
 * compile or sync an event with nobody's name on it. Fetching here keeps every
 * call site to one line, and keeps the "what does the sync need" question in
 * one place.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/scheduling/syncBookingCalendar
 */

import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { schedulingBookingRepository, schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { createLogger, type Logger } from '@/lib/logger';

const defaultLogger = createLogger({ service: 'SyncBookingCalendar' });

/** What the sync says when the business has never linked a calendar. */
const NOT_CONNECTED = 'Calendar sync not enabled';

export interface SyncBookingCalendarResult {
  synced: boolean;
  /** Why not, when it did not. `not_connected` is the normal case. */
  reason?: 'not_connected' | 'booking_not_found' | 'service_not_found' | 'sync_failed' | 'threw';
}

/**
 * Sync one booking to the owner's calendar. Never throws.
 *
 * Every caller treats this as non-blocking: an appointment that exists but is
 * not mirrored is a smaller problem than a booking request that failed because
 * a calendar plugin was slow.
 *
 * @param bookingId the booking to mirror
 * @param userId    the OWNER — always derived server-side, never from a request body
 */
export async function syncBookingToOwnerCalendar(
  bookingId: string,
  userId: string,
  log: Logger = defaultLogger
): Promise<SyncBookingCalendarResult> {
  try {
    // Both reads are scoped to the owner. This runs on public routes where
    // `supabaseServer` bypasses RLS, so the scope here IS the boundary.
    const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
    const booking = bookingResult.data;
    if (!booking) {
      log.warn({ bookingId, userId }, 'Calendar sync: booking not found');
      return { synced: false, reason: 'booking_not_found' };
    }

    const serviceId = booking.service_id;
    if (!serviceId) {
      return { synced: false, reason: 'service_not_found' };
    }

    const serviceResult = await schedulingServiceRepository.findById(serviceId, userId);
    const service = serviceResult.data;
    if (!service) {
      log.warn({ bookingId, serviceId, userId }, 'Calendar sync: service not found');
      return { synced: false, reason: 'service_not_found' };
    }

    const sync = await CalendarSyncService.syncBookingToCalendar(booking, service, userId);
    if (sync.success) return { synced: true };

    /*
     * "Not connected" is not a failure.
     *
     * Most businesses have never linked a calendar, so warning here would fire
     * on the normal path for a feature they never switched on — and a warning
     * that fires normally stops being read, taking the real ones with it. Same
     * reasoning as the owner-facing path in `BookingLifecycleService`.
     */
    if (sync.error === NOT_CONNECTED) {
      log.debug({ bookingId }, 'No calendar connected; skipping sync');
      return { synced: false, reason: 'not_connected' };
    }

    log.warn({ bookingId, error: sync.error }, 'Calendar sync failed');
    return { synced: false, reason: 'sync_failed' };
  } catch (err) {
    log.warn({ err, bookingId }, 'Calendar sync threw');
    return { synced: false, reason: 'threw' };
  }
}

/**
 * Move the calendar event after a client reschedules. Never throws.
 *
 * A no-op when the booking was never synced — `updateCalendarEvent` says so
 * itself, and a business with no calendar connected has nothing to move.
 */
export async function updateOwnerCalendarEvent(
  bookingId: string,
  userId: string,
  log: Logger = defaultLogger
): Promise<SyncBookingCalendarResult> {
  return withBookingAndService(bookingId, userId, log, async (booking, service) => {
    const sync = await CalendarSyncService.updateCalendarEvent(booking, service, userId);
    return sync.success
      ? { synced: true }
      : { synced: false, reason: unlinked(sync.error) ? 'not_connected' : 'sync_failed' };
  });
}

/**
 * Remove the calendar event after a client cancels. Never throws.
 *
 * This is the one that costs money when it is missing: without it the hour
 * stays blocked and the owner holds it for somebody who has already said they
 * are not coming.
 */
export async function removeOwnerCalendarEvent(
  bookingId: string,
  userId: string,
  log: Logger = defaultLogger
): Promise<SyncBookingCalendarResult> {
  return withBookingAndService(bookingId, userId, log, async booking => {
    const sync = await CalendarSyncService.deleteCalendarEvent(booking, userId);
    return sync.success
      ? { synced: true }
      : { synced: false, reason: unlinked(sync.error) ? 'not_connected' : 'sync_failed' };
  });
}

/** "Never synced" and "not connected" are both normal, and neither is an error. */
function unlinked(error?: string): boolean {
  return error === NOT_CONNECTED || error === 'No calendar event linked';
}

/**
 * Load a booking and its service, both scoped to the owner, then act.
 *
 * Shared by all three operations so the ownership scope and the "not found"
 * handling are written once. These run on public routes where `supabaseServer`
 * bypasses RLS, so the scope here IS the boundary.
 */
async function withBookingAndService(
  bookingId: string,
  userId: string,
  log: Logger,
  act: (
    booking: Awaited<ReturnType<typeof schedulingBookingRepository.findById>>['data'] & object,
    service: Awaited<ReturnType<typeof schedulingServiceRepository.findById>>['data'] & object
  ) => Promise<SyncBookingCalendarResult>
): Promise<SyncBookingCalendarResult> {
  try {
    const bookingResult = await schedulingBookingRepository.findById(bookingId, userId);
    const booking = bookingResult.data;
    if (!booking) return { synced: false, reason: 'booking_not_found' };

    if (!booking.service_id) return { synced: false, reason: 'service_not_found' };

    const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
    const service = serviceResult.data;
    if (!service) return { synced: false, reason: 'service_not_found' };

    return await act(booking, service);
  } catch (err) {
    log.warn({ err, bookingId }, 'Calendar change threw');
    return { synced: false, reason: 'threw' };
  }
}
