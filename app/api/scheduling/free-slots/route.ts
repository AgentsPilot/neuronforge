/**
 * What the owner's booking dialog needs to pick an hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS ROUTE EXISTS
 *
 * `SchedulingBookingModal` receives `availability` — the weekly opening-hours
 * TEMPLATE — and prints it as a banner reading "שעות פנויות: 09:00–17:00"
 * beside a free-text `datetime-local` field. It cannot see existing meetings,
 * closed days or the owner's calendar, so the owner types an hour and learns it
 * clashes when the save fails.
 *
 * A client booking on the public site has had real slots all along. This is the
 * same answer for the person who actually runs the business, plus the part the
 * public page has no reason to compute: what each free hour would COST — the
 * gap it closes, the minutes it strands, the empty day it opens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT `/api/scheduling/availability`
 *
 * That path is taken, by the business's weekly working-hours SETTINGS — the
 * thing the configuration dialog reads and writes. This answers a different
 * question: given those settings, which hours are actually free, and what does
 * each one cost. Named for the answer rather than the subject, so the two
 * cannot be confused again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING HERE IS ALREADY SHARED
 *
 *   `computeOpenTime`   open hours minus closed days minus busy time
 *   `slotsInWindows`    those windows as discrete starts
 *   `busyMeetings`      what holds time, read from `scheduling_meetings`
 *   `slotIntelligence`  what each free hour costs
 *
 * This route composes them and adds no rule of its own. That is deliberate: a
 * second opinion about when a business is open is how the owner's dialog and
 * the client's page came to disagree in the first place.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { busyMeetings } from '@/lib/scheduling/busyMeetings';
import { externalCalendarEventRepository } from '@/lib/repositories/ExternalCalendarEventRepository';
import { computeOpenTime, slotsInWindows } from '@/lib/scheduling/openTime';
import { businessDateKey, shiftBusinessDateKey, safeTimezone } from '@/lib/scheduling/businessTime';
import { hasAnyAvailability } from '@/lib/scheduling/availabilityWindows';
import {
  analyseSlots,
  suggestSlots,
  type Slot,
  type AnalysedSlot,
} from '@/lib/scheduling/slotIntelligence';

const logger = createLogger({ module: 'OwnerFreeSlotsAPI' });

const QuerySchema = z.object({
  service_id: z.string().uuid('Invalid service id'),
  /** `YYYY-MM-DD` on the business's clock. Defaults to today. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** How many days the strip shows. Seven matches the dialog. */
  days: z.coerce.number().int().min(1).max(31).default(7),
  /**
   * How long the appointment runs, when the SERVICE cannot say.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Every slot below is built from a duration, and a package service has none:
   * it is bought rather than booked into an hour, so `duration_minutes` is null
   * on it and `is_scheduled` is false. Its SESSIONS are 60 minutes, and that
   * length lives on the quote that sold them, not on the service.
   *
   * Without this the strip asked for slots of zero minutes, the route refused
   * at the guard below, and the dialog said "אין שעות פנויות בשבוע הזה" —
   * about a week with nothing in it at all. The picker was open and empty.
   *
   * Only consulted when the service has no length of its own, so an ordinary
   * booking cannot be talked into a shorter slot than the service sells.
   * ───────────────────────────────────────────────────────────────────────────
   */
  duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
  /** The day whose slot grid is wanted. Defaults to the first with any. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /**
   * Whose booking this is.
   *
   * Only used to read their past meetings, so "the hour they usually choose"
   * can be offered. Absent for a new client, and the suggestion simply does
   * not appear.
   */
  contact_id: z.string().uuid().optional(),
  /**
   * The booking being EDITED, whose own hour must not read as taken.
   *
   * Rescheduling reads the same diary the appointment is already in, so
   * without this the owner is told its current hour is unavailable — by
   * itself — and that is the one hour the grid will not offer back.
   */
  exclude_booking_id: z.string().uuid().optional(),
  /**
   * An instant to open the window on, when it is not today.
   *
   * The booking being edited: its appointment is usually not in this week, and
   * a strip starting today would not contain the hour the owner came to change.
   *
   * An INSTANT rather than a date, because which day it falls on depends on the
   * business's zone and only this route knows it — a caller computing the day
   * itself would be off by one near midnight for every owner abroad.
   */
  around: z.string().datetime().optional(),
});

/** One day on the strip: enough to draw the shape bar without a second call. */
interface DaySummary {
  date: string;
  weekday: string;
  isWorkingDay: boolean;
  /** How many starts are bookable. The number under each date. */
  freeSlots: number;
  freeMinutes: number;
  bookedMinutes: number;
  /** True when nothing at all is booked — a day a booking would open. */
  isEmpty: boolean;
  /**
   * What is already taken, clipped to this day's working hours.
   *
   * Carried so the dialog can draw the day as a TIMELINE — where an hour sits
   * among what is already booked, not merely that it exists. A slot without
   * that context is a number; with it, the owner can see the gap they are
   * about to fill or split.
   *
   * Clipped by `computeOpenTime`, so a meeting running past closing does not
   * draw past the end of the bar.
   */
  busy: Array<{ start: string; end: string }>;
  /** The day's own opening and closing, for the timeline's axis. */
  opensAt: string | null;
  closesAt: string | null;
}

/**
 * How many of these starts could actually be taken together.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The slot list is candidate STARTS at a half-hour step, and they overlap each
 * other: on an empty nine-to-five day a 60-minute service has fifteen of them
 * and room for eight meetings. Taking 13:00 removes 12:30 and 13:30.
 *
 * Walk them in order, take the first, skip everything that collides with it
 * (including the gap the business keeps between appointments), repeat. For
 * fixed-length appointments that greedy pass is optimal, and it stays honest
 * where arithmetic would not: a 45-minute hole contributes nothing to an hour
 * long service, while dividing free minutes by duration would claim most of one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function meetingsThatFit(
  slots: Array<{ start: string; end: string }>,
  durationMinutes: number,
  bufferMinutes: number
): number {
  if (durationMinutes <= 0) return 0;

  const ordered = [...slots].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  let count = 0;
  let freeFrom = -Infinity;

  for (const slot of ordered) {
    const start = new Date(slot.start).getTime();
    if (start < freeFrom) continue;

    count += 1;
    freeFrom = new Date(slot.end).getTime() + bufferMinutes * 60_000;
  }

  return count;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const query = parsed.data;
    const ownerId = user.id;

    /*
     * The whole service row, through the repository.
     *
     * Not a hand-typed select: the public booking route named eight of thirty
     * columns and produced three silent bugs that way — `collection` omitted,
     * then `sale_mode` "one bug later", then the payment-plan columns. The
     * duration is what every slot below is built from, so a missing field here
     * would not be subtle.
     */
    const serviceResult = await schedulingServiceRepository.findById(query.service_id, ownerId);
    const service = serviceResult.data;

    if (!service) {
      return NextResponse.json({ success: false, error: 'Service not found' }, { status: 404 });
    }

    const durationMinutes = service.duration_minutes ?? query.duration_minutes ?? 0;
    /*
     * The gap this service keeps between appointments.
     *
     * Read at last: `buffer_minutes` has been on the row since the first
     * scheduling migration, defaults to 15 and is editable in the service
     * modal, and no booking path had ever consulted it — so every hour offered
     * here and on the client's own page was back to back.
     */
    const bufferMinutes = service.buffer_minutes ?? 0;

    const [prefs, profile] = await Promise.all([
      userPreferencesRepository.findTimezone(ownerId),
      businessProfileRepository.findByUserId(ownerId),
    ]);

    const timezone = safeTimezone(prefs.data ?? undefined);
    const availability = profile.data?.scheduling_availability ?? null;

    /*
     * Nothing configured means nothing bookable — the same answer the public
     * page gives. Asked of the WINDOWS rather than the keys: a profile whose
     * every day is an empty array has keys and no hours.
     *
     * A service with no duration is the same dead end, and worth refusing here
     * rather than in the stepping loop, where a zero step would never finish.
     */
    if (!hasAnyAvailability(availability) || durationMinutes <= 0) {
      return NextResponse.json({
        success: true,
        timezone,
        availabilityConfigured: hasAnyAvailability(availability),
        durationMinutes,
        selectedDate: null,
        days: [],
        slots: [],
        suggestions: [],
        nextFree: null,
      });
    }

    /*
     * ONE CLOCK FOR THE WHOLE RESPONSE.
     *
     * Read once rather than per use, so which day the window opens on, which
     * hours the grid offers, what the day counts say and which slots are
     * suggested cannot disagree about where "now" is. `suggestSlots` dropped
     * past hours and the grid did not, which is how the dialog came to offer
     * 09:00 at twenty past eleven with 11:30 suggested above it.
     */
    const now = new Date();

    /* The hour already chosen, as a day on the business's clock. */
    const aroundKey = query.around ? businessDateKey(new Date(query.around), timezone) : null;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * `around` SELECTS A DAY. IT ONLY MOVES THE WINDOW WHEN IT HAS TO.
     *
     * This read `query.from ?? aroundKey ?? today`, so any chosen hour dragged
     * the whole week onto its own day — and the dialog unmounts this panel
     * when the step collapses, so pressing "change" straight after picking
     * sent `around` and rebuilt the week from there.
     *
     * The owner saw the strip jump forward: the days before their choice
     * vanished, the suggestions were recomputed over a different week, and the
     * client's usual hour disappeared with the day it was on. Pick, reopen,
     * and the panel had quietly become a different panel.
     *
     * The window stays where it was whenever the chosen day is already inside
     * it, which is the ordinary case. It moves only when the hour genuinely
     * lies outside — an appointment next month, reopened for rescheduling.
     * Either way `selected` below opens the grid on that day.
     * ───────────────────────────────────────────────────────────────────────
     */
    const today = businessDateKey(now, timezone);
    const lastOfThisWindow = shiftBusinessDateKey(today, query.days - 1);

    const from =
      query.from ??
      (aroundKey && (aroundKey < today || aroundKey > lastOfThisWindow) ? aroundKey : today);

    const to = shiftBusinessDateKey(from, query.days);

    /*
     * Closed days for the whole window, in one read.
     *
     * The loop below walks a day at a time, and querying inside it would be one
     * request per day for an answer that does not change between them — the
     * reason the public route hoists it too.
     */
    const offResult = await schedulingTimeOffRepository.list(ownerId, { from, to });
    if (offResult.error) {
      requestLogger.warn(
        { err: offResult.error, ownerId },
        'Time off unreadable; offering the ordinary weekly hours'
      );
    }
    const timeOff = offResult.data ?? [];

    /*
     * What already holds time across the window.
     *
     * `scheduling_meetings`, not `scheduling_bookings` — the meeting carries
     * the clock since the two were separated, and a booking with no meeting
     * holds no slot. One read for the window, filtered per day in memory.
     */
    const windowStart = new Date(`${from}T00:00:00Z`).toISOString();
    const windowEnd = new Date(`${to}T23:59:59Z`).toISOString();
    const busy = await busyMeetings(
      supabaseServer,
      ownerId,
      windowStart,
      windowEnd,
      query.exclude_booking_id ?? null
    );

    /*
     * ───────────────────────────────────────────────────────────────────────
     * AND THE OWNER'S OWN CALENDAR.
     *
     * A synced Google or Outlook event holds the owner's time as surely as a
     * meeting booked here does. The client's booking page has always read
     * these, and so did the dialog this grid replaced — this endpoint did not,
     * so an hour the owner was already busy for was blocked for the client and
     * offered to the owner.
     *
     * Nothing downstream would have caught it either: the database's overlap
     * constraint knows about `scheduling_meetings` and nothing else, so the
     * booking would have been written without complaint.
     *
     * Merged into ONE busy list rather than carried separately, so the free
     * windows, the day counts, the slot labels and the suggestions all inherit
     * it at once and cannot disagree about what is taken.
     *
     * Fails soft, like `busyMeetings`: a calendar that cannot be read must not
     * blank the diary. The owner sees their own bookings and keeps working.
     * ───────────────────────────────────────────────────────────────────────
     */
    const external = await externalCalendarEventRepository.getBusySlots(
      ownerId,
      windowStart,
      windowEnd
    );

    if (external.error) {
      requestLogger.warn(
        { err: external.error, ownerId },
        'External calendar unreadable; offering hours from this diary alone'
      );
    }

    const busyAsIntervals = [
      ...busy.map(b => ({ start: b.start_time, end: b.end_time })),
      ...(external.data ?? []).map(e => ({ start: e.start, end: e.end })),
    ];

    const days: DaySummary[] = [];
    const slotsByDate = new Map<string, Slot[]>();

    let dayKey = from;

    for (let i = 0; i < query.days; i++) {
      const open = computeOpenTime({
        availability,
        date: dayKey,
        timeZone: timezone,
        bookings: busyAsIntervals,
        durationMinutes,
        timeOff,
        bufferMinutes,
      });

      const daySlots = slotsInWindows({
        date: dayKey,
        windows: open.free,
        timeZone: timezone,
        durationMinutes,
        /* An hour that has gone is not bookable, and the server refuses it —
           so offering it is a click that ends in a refusal. */
        notBefore: now,
        /*
         * One clock for the whole day. Without this the starts count from
         * each free window's own beginning, so a meeting ending at 10:00
         * with a 15-minute gap after it turned the rest of the day into
         * 10:15, 11:15, 12:15 — correct hours that nobody reads as hours.
         */
        anchor: open.windows[0]?.start,
      });

      slotsByDate.set(dayKey, daySlots);

      days.push({
        date: dayKey,
        weekday: open.weekday,
        isWorkingDay: open.isWorkingDay,
        /*
         * HOW MANY MEETINGS FIT, not how many start times exist.
         *
         * This was `daySlots.length`, and those are candidate starts at a
         * half-hour step: an empty nine-to-five day reported "15 free" for a
         * 60-minute service where eight fit. They are alternatives to each
         * other, not capacity — booking 13:00 takes 12:30 and 13:30 with it.
         *
         * The strip exists to compare days, so capacity is the honest number.
         * Counted from the FILTERED list, so the past and the buffer are both
         * already accounted for.
         */
        freeSlots: meetingsThatFit(daySlots, durationMinutes, bufferMinutes),
        freeMinutes: open.freeMinutes,
        bookedMinutes: open.bookedMinutes,
        isEmpty: open.bookedMinutes === 0,
        /* Already clipped and merged against the working windows. */
        busy: open.busy.map(w => ({ start: w.start, end: w.end })),
        opensAt: open.windows[0]?.start ?? null,
        closesAt: open.windows[open.windows.length - 1]?.end ?? null,
      });

      dayKey = shiftBusinessDateKey(dayKey, 1);
    }

    /*
     * The day whose grid is wanted: the one asked for, else the edited
     * booking's own day, else the first with any hours free.
     *
     * The middle case is what makes rescheduling read as rescheduling — the
     * grid opens on the day the appointment is on, with its current hour
     * offered rather than shown as taken (see `exclude_booking_id`).
     */
    const selected =
      (query.date && slotsByDate.has(query.date) && query.date) ||
      (aroundKey && slotsByDate.has(aroundKey) && aroundKey) ||
      days.find(d => d.freeSlots > 0)?.date ||
      from;

    /*
     * The client's own history, for "the hour they usually choose".
     *
     * Their past meetings, newest first and capped: a habit is visible in a
     * handful of bookings, and reading a decade of them to count hours is a
     * query nobody needs. Absent for a new client, and the suggestion simply
     * does not appear.
     *
     * Joined through the booking, because the CONTACT is on the booking while
     * the TIME is on the meeting — the two were separated, and this is the one
     * query that needs both halves.
     */
    let clientHistory: string[] | undefined;

    if (query.contact_id) {
      const { data: past, error: historyError } = await supabaseServer
        .from('scheduling_meetings')
        .select('start_time, scheduling_bookings!inner(contact_id)')
        .eq('user_id', ownerId)
        .eq('scheduling_bookings.contact_id', query.contact_id)
        .not('start_time', 'is', null)
        .order('start_time', { ascending: false })
        .limit(10);

      if (historyError) {
        /* A habit is a nicety. Losing it must not cost the owner the dialog. */
        requestLogger.warn(
          { err: historyError, contactId: query.contact_id },
          'Could not read the client history; offering slots without their usual hour'
        );
      }

      clientHistory = (past ?? [])
        .map(row => (row as unknown as { start_time: string }).start_time)
        .filter(Boolean);
    }

    /*
     * Every day's hours, labelled with what each would do to its own day.
     *
     * Analysed per day rather than in one pass, because "the gap this fills"
     * is a question about the day the hour sits in. `dayIsEmpty` is no longer
     * passed: that is a fact about the DAY, and stamping it on every hour is
     * what drowned out the per-hour labels — see `analyseSlots`.
     */
    const allAnalysed: AnalysedSlot[] = days.flatMap(day =>
      analyseSlots({
        slots: slotsByDate.get(day.date) ?? [],
        busy: busyAsIntervals,
        durationMinutes,
      })
    );

    const suggestions = suggestSlots({
      slots: allAnalysed,
      clientHistory,
      now,
      timeZone: timezone,
      /*
       * The days with nothing in them, so one row can warn that a booking
       * would spend a clear day — TODAY excluded, where it is close to
       * meaningless: today is already under way and the owner is working in it.
       */
      emptyDays: days
        .filter(d => d.isWorkingDay && d.isEmpty && d.date !== businessDateKey(now, timezone))
        .map(d => d.date),
    });

    /* Where to page to when the window opens on a full stretch. */
    const nextFree = days.find(d => d.freeSlots > 0)?.date ?? null;

    requestLogger.info(
      {
        ownerId,
        serviceId: query.service_id,
        from,
        days: query.days,
        selected,
        slots: allAnalysed.length,
        suggestions: suggestions.length,
      },
      'Owner free slots computed'
    );

    return NextResponse.json({
      success: true,
      timezone,
      availabilityConfigured: true,
      durationMinutes,
      selectedDate: selected,
      days,
      /*
       * EVERY day's hours, not just the selected one.
       *
       * The dialog filters these by the day the owner is looking at, and the
       * strip lets them look at any day in the window — so returning one day's
       * slots meant clicking any OTHER day emptied the grid and showed "no free
       * hours this week" beside a strip saying that day was free.
       *
       * `allAnalysed` is already computed for the suggestions, so this costs a
       * larger payload and no extra work: one week of half-hour starts.
       */
      slots: allAnalysed,
      suggestions: suggestions.map(s => ({
        start: s.slot.start,
        end: s.slot.end,
        reason: s.reason,
        consequence: s.slot.consequence,
        /* The evidence behind "the hour they chose in the previous three". */
        meetingCount: s.meetingCount,
        /* A caveat on the row, never the reason for it — see `opensDay`. */
        opensDay: s.opensDay,
      })),
      nextFree,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Owner free slots failed');

    return NextResponse.json(
      {
        success: false,
        error: 'Could not work out what is free',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
