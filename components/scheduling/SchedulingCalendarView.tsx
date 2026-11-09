'use client';

import { useState, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Clock, Calendar, Phone, Mail, CheckCircle, XCircle, AlertCircle, Trash2, Loader2, LayoutGrid, List } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { NoShowConfirmDialog } from '@/components/scheduling/NoShowConfirmDialog';
import { CancelReasonDialog } from '@/components/scheduling/CancelReasonDialog';
import { businessClock, businessDateKey, businessInstant, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';
import { windowsForDate, type TimeOffEntry } from '@/lib/scheduling/availabilityWindows';
import { closedDayVerdict } from '@/lib/scheduling/closedDay';
import { createLogger } from '@/lib/logger';
import type { SchedulingBooking, SchedulingService } from '@/lib/repositories/SchedulingRepository';
import type { WeeklyAvailability } from './AvailabilityEditor';

const logger = createLogger({ module: 'SchedulingCalendarView' });

interface ExternalBusySlot {
  start: string;
  end: string;
  source: 'google_calendar' | 'outlook';
  is_all_day: boolean;
}

interface SchedulingCalendarViewProps {
  bookings: SchedulingBooking[];
  services: SchedulingService[];
  onBookingClick: (booking: SchedulingBooking) => void;
  onBookingUpdated: () => void;
  onSlotClick?: (date: Date, hour: number) => void;
  availability?: WeeklyAvailability;
  externalEventsRefreshTrigger?: number;
  /**
   * The week on screen, so the owner of `bookings` can fetch exactly it.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * The grid used to be handed whatever the dialog had loaded — fifty rows,
   * newest first, with no date range at all. On the current week that looks
   * right, because the current week IS the newest; page back and the grid
   * thins out, not because nothing was booked but because those rows were
   * never fetched.
   *
   * Half-open: `[start, end)`. The end is the first instant of the NEXT week,
   * so an appointment at exactly that moment belongs there and not here, and
   * no appointment can fall into both weeks or neither.
   * ─────────────────────────────────────────────────────────────────────────
   */
  onWeekChange?: (start: Date, endExclusive: Date) => void;
}

// Day keys for availability lookup
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

// Scheduling theme color: Teal
const SCHEDULING_COLOR = '#14B8A6';

// Modern row height
const ROW_HEIGHT = 56;
// Default hours 6am - 10pm (will be overridden by availability if present)
const DEFAULT_HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

/*
 * EVERY CARD CARRIES ITS STAGE AT FULL STRENGTH.
 *
 * These were drawn faded and dashed for a while, on the reasoning that an
 * appointment which no longer holds its hour should not compete with one that
 * does. In a diary that is the wrong trade: the colour IS the information, and
 * a washed-out card makes the owner work out what they are looking at.
 *
 * A cancelled hour is fully red, a held one fully green, exactly as a confirmed
 * one is. Decluttering is the chips' job, and they remove the stage outright
 * rather than whispering it.
 */

/**
 * The three ways an appointment stops holding its hour, each shown separately.
 *
 * They are not one thing: a no-show is a client who did not come, a
 * cancellation is one who said so, and a moved appointment did happen, just
 * elsewhere in the week. Lumped into a single "hide cancelled" they could not
 * be told apart, and "how bad is it" has three different answers.
 *
 * The colours match the blocks they hide, so pressing a chip and watching that
 * colour leave the grid is one movement rather than a lookup.
 */
/**
 * What happened to THIS appointment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Not the same question as what happened to the job, and the two genuinely
 * disagree in live data. One Friday here reads `meeting_status: 'held'` on a
 * booking whose `status` is `'cancelled'`: the session went ahead, the job was
 * cancelled afterwards. Colouring from the job painted that block red — a
 * cancellation, in the owner's diary, for an hour they actually worked.
 *
 * The appointment's own outcome wins wherever it has one. The job's status is
 * the fallback for rows that predate `meeting_status` and for a job cancelled
 * before anything was ever scheduled.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function outcomeOf(booking: { meeting_status?: string | null; status?: string | null }): string {
  const outcome = booking.meeting_status;
  if (outcome === 'held' || outcome === 'cancelled' || outcome === 'no_show' || outcome === 'moved') {
    return outcome;
  }
  return booking.status ?? 'pending';
}

/**
 * Whether this appointment makes its hour unavailable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELIBERATELY NOT `holdsSlot`, and the difference is one outcome: a NO-SHOW.
 *
 * `holdsSlot` answers "may the booking engine sell this hour again", and for a
 * no-show it says yes — the client never came, so the time is notionally free.
 * That is the right answer for availability and the wrong one for a diary. The
 * owner WAS there. They held the hour, waited, and were stood up; showing it
 * as an open slot invites them to double-book an hour they already spent, and
 * erases the fact that it was wasted.
 *
 * A CANCELLATION is the opposite and is correctly bookable: the client said so
 * in advance, the hour went back on sale, and the grid should offer it. Same
 * for `moved` — that appointment is now somewhere else in the week.
 *
 * So: held, confirmed and no-show occupy their hour. Cancelled and moved do
 * not. This governs the calendar only; the booking engine keeps `holdsSlot`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function occupiesHour(booking: { meeting_status?: string | null; status?: string | null }): boolean {
  const outcome = outcomeOf(booking);
  return outcome !== 'cancelled' && outcome !== 'moved';
}

const RELEASED_OUTCOMES: { key: string; color: string }[] = [
  /* The ones that happened, so a week can be narrowed to its damage as easily
     as to its work. `held` was missing: the chips could remove everything the
     owner did NOT do, and nothing could isolate what they did. */
  { key: 'held', color: '#10b981' },
  { key: 'confirmed', color: '#14B8A6' },
  { key: 'cancelled', color: '#ef4444' },
  { key: 'no_show', color: '#f59e0b' },
  { key: 'moved', color: '#8b5cf6' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; dot: string; label: string; glow: string }> = {
  confirmed: {
    bg: 'bg-teal-500/15 backdrop-blur-sm',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-500/40',
    dot: 'bg-teal-500',
    label: 'confirmed',
    glow: 'shadow-teal-500/25'
  },
  cancelled: {
    bg: 'bg-red-500/15 backdrop-blur-sm',
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-500/40',
    dot: 'bg-red-500',
    label: 'cancelled',
    glow: 'shadow-red-500/25'
  },
  completed: {
    bg: 'bg-blue-500/15 backdrop-blur-sm',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/40',
    dot: 'bg-blue-500',
    label: 'completed',
    glow: 'shadow-blue-500/25'
  },
  no_show: {
    bg: 'bg-amber-500/15 backdrop-blur-sm',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-500/40',
    dot: 'bg-amber-500',
    label: 'no_show',
    glow: 'shadow-amber-500/25'
  },
  held: {
    bg: 'bg-emerald-500/15 backdrop-blur-sm',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-500/40',
    dot: 'bg-emerald-500',
    label: 'held',
    glow: 'shadow-emerald-500/25'
  },
  moved: {
    bg: 'bg-violet-500/15 backdrop-blur-sm',
    text: 'text-violet-600 dark:text-violet-400',
    border: 'border-violet-500/40',
    dot: 'bg-violet-500',
    label: 'moved',
    glow: 'shadow-violet-500/25'
  },
  pending: {
    bg: 'bg-slate-500/15 backdrop-blur-sm',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-500/40',
    dot: 'bg-slate-500',
    label: 'pending',
    glow: 'shadow-slate-500/25'
  }
};

// Status filter options
type StatusFilter = 'all' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

const STATUS_FILTERS: { key: StatusFilter; color: string; darkColor: string }[] = [
  { key: 'all', color: '#14B8A6', darkColor: '#5EEAD4' },
  { key: 'confirmed', color: '#14B8A6', darkColor: '#5EEAD4' },
  { key: 'completed', color: '#3b82f6', darkColor: '#93c5fd' },
  { key: 'cancelled', color: '#ef4444', darkColor: '#fca5a5' },
  { key: 'no_show', color: '#f59e0b', darkColor: '#fcd34d' }
];


/**
 * Where each booking sits when several share the same time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every block was positioned `absolute inset-x-1` — the full width of its day
 * column — with only `top` and `height` varying. Two appointments at 10:00
 * therefore occupied exactly the same rectangle, and the grid showed whichever
 * happened to render last. A week whose list said "3 bookings" drew one.
 *
 * That is not a rare case. It is the NORMAL one after a no-show: the original
 * slot, the rebooking and a cancellation all sit on the same hour, which is
 * precisely when the owner most needs to see that three things happened there.
 *
 * So concurrent bookings are laid out side by side, as a calendar does.
 * Overlapping runs are found by sweeping the day in start order and closing a
 * group when a booking starts after everything before it has ended — so two
 * appointments that merely touch (10:00-10:15, 10:15-10:30) stay full width,
 * and only genuine collisions are narrowed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * At most three abreast, then a count.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * One column per colliding appointment is right until it is not: eight on one
 * hour gives eight slices about two pixels wide, which carry no name, no time
 * and no colour anyone can read. The grid stops being a diary and becomes a
 * bar chart of its own congestion.
 *
 * So the width has a floor. Two appointments are drawn, and everything else on
 * that hour collapses into a "+N" the owner can open. Three columns rather
 * than four or five because a day column is narrow enough that a third is
 * already initials-only — `crowded` below switches to initials at exactly this
 * point — and a quarter would be unreadable at any volume.
 * ───────────────────────────────────────────────────────────────────────────
 */
const MAX_CONCURRENT_COLUMNS = 3;

interface SlotLayout {
  column: number;
  columns: number;
  /** Not drawn: it is one of the ones the chip is counting. */
  hidden?: boolean;
  /** Draw a "+N" here instead of this appointment. */
  overflow?: number;
}

function layoutConcurrentBookings(
  dayBookings: { id: string; appointment_key?: string; start_time: string; end_time: string }[]
): Map<string, SlotLayout> {
  const layout = new Map<string, SlotLayout>();

  /* Keyed per APPOINTMENT: a package's sessions share one booking id, so
     keying by that made each overwrite the previous one's column. */
  const keyOf = (b: { id: string; appointment_key?: string }) => b.appointment_key ?? b.id;

  const ordered = [...dayBookings].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  let group: typeof ordered = [];
  let groupEnd = 0;

  const flush = () => {
    if (group.length <= MAX_CONCURRENT_COLUMNS) {
      group.forEach((booking, index) =>
        layout.set(keyOf(booking), { column: index, columns: group.length })
      );
    } else {
      /*
       * The first two keep a column each. The third column belongs to the
       * chip, which stands for every remaining appointment on this hour —
       * itself included, which is why the count is the whole remainder.
       */
      const shown = MAX_CONCURRENT_COLUMNS - 1;

      group.forEach((booking, index) => {
        if (index < shown) {
          layout.set(keyOf(booking), { column: index, columns: MAX_CONCURRENT_COLUMNS });
          return;
        }
        layout.set(keyOf(booking), {
          column: shown,
          columns: MAX_CONCURRENT_COLUMNS,
          hidden: index > shown,
          overflow: index === shown ? group.length - shown : undefined,
        });
      });
    }

    group = [];
    groupEnd = 0;
  };

  for (const booking of ordered) {
    const start = new Date(booking.start_time).getTime();
    const end = new Date(booking.end_time).getTime();

    // A booking starting at or after everything so far has ended begins a new
    // group: it collides with none of them and should keep the full width.
    if (group.length && start >= groupEnd) flush();

    group.push(booking);
    groupEnd = Math.max(groupEnd, end);
  }
  flush();

  return layout;
}

export function SchedulingCalendarView({
  bookings,
  services,
  onBookingClick,
  onBookingUpdated,
  onSlotClick,
  availability,
  externalEventsRefreshTrigger,
  onWeekChange
}: SchedulingCalendarViewProps) {
  const { t, language, formatCurrency, timezone, timeZoneOptions } = useLanguage();

  // Israel/Hebrew uses Sunday-first weeks, most other locales use Monday-first
  const weekStartsOnSunday = language === 'he';

  const [currentWeek, setCurrentWeek] = useState(() => getStartOfWeek(new Date(), weekStartsOnSunday));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * HIDE THE APPOINTMENTS THAT NO LONGER HOLD THEIR HOUR.
   *
   * Off by default, deliberately. A week where most of the diary was cancelled
   * is a fact about the business, and a calendar that quietly tidied it away
   * would be hiding the owner's actual problem — one real account's week here
   * ran 62 appointments of which 45 were cancelled, moved or no-shows, against
   * 17 that happened.
   *
   * So they are drawn at full strength, in their own colour, and these are the
   * controls that clear them when the owner wants to see only what is really
   * booked. `outcomeOf` decides membership, so the chips, the card colour and
   * the counts all read the same rule.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THREE OUTCOMES, THREE CHIPS.
   *
   * They were one "hide cancelled" switch, and they are not one thing. A
   * no-show is a client who did not come; a cancellation is one who said so;
   * a moved appointment happened, somewhere else in the week. An owner asking
   * "how bad is it" wants those separated — and one real week here held 26
   * cancelled, 10 no-shows and 9 moved against 17 that happened.
   *
   * Hiding is also what buys back WIDTH: at most three appointments are drawn
   * abreast and the rest collapse into a count, so dropping one outcome lets
   * the others be drawn properly instead of counted.
   *
   * Off by default, all three. A week mostly made of cancellations is a fact
   * about the business, and a calendar that hid it by default would be tidying
   * away the owner's actual problem.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [hiddenOutcomes, setHiddenOutcomes] = useState<ReadonlySet<string>>(new Set());

  const toggleOutcome = (outcome: string) =>
    setHiddenOutcomes(previous => {
      const next = new Set(previous);
      if (next.has(outcome)) next.delete(outcome);
      else next.add(outcome);
      return next;
    });
  const [actionInProgress, setActionInProgress] = useState<{ bookingId: string; action: string } | null>(null);
  const [hoveredBooking, setHoveredBooking] = useState<string | null>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Expand mode: 'both' shows both, 'calendar' expands calendar to full, 'list' expands list to full
  // Default to 'calendar' for full-width calendar view when dialog opens
  const [expandMode, setExpandMode] = useState<'both' | 'calendar' | 'list'>('calendar');

  // External calendar busy slots
  const [externalBusySlots, setExternalBusySlots] = useState<ExternalBusySlot[]>([]);
  /*
   * The days the business is closed, and the days it is open for less than
   * usual.
   *
   * Read here rather than passed in because this is where they are drawn: the
   * table had been readable since July and no screen showed it, so an owner on
   * holiday saw an ordinary open week and booked into it.
   */
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);

  // Fetch external busy slots for current week - deferred to not block initial render
  useEffect(() => {
    // Defer this fetch to allow the main calendar UI to render first
    // External busy slots are a nice-to-have overlay, not critical for initial display
    const timeoutId = setTimeout(() => {
      const fetchExternalBusySlots = async () => {
        try {
          const weekStart = currentWeek;
          const weekEnd = new Date(currentWeek);
          weekEnd.setDate(weekEnd.getDate() + 7);

          const response = await fetch(
            `/api/scheduling/calendar-sync/busy-slots?start=${encodeURIComponent(weekStart.toISOString())}&end=${encodeURIComponent(weekEnd.toISOString())}`
          );
          const data = await response.json();

          if (data.success && data.busy_slots) {
            setExternalBusySlots(data.busy_slots);
          }
        } catch {
          // Silently fail - external busy slots are optional
        }
      };

      fetchExternalBusySlots();
    }, 150); // Delay by 150ms to prioritize main UI

    return () => clearTimeout(timeoutId);
  }, [currentWeek, externalEventsRefreshTrigger]);

  /*
   * Tell the owner of `bookings` which week to fetch.
   *
   * Fires on mount too, so the first paint is the right week rather than
   * whatever fifty rows happened to arrive first. `onWeekChange` is left out
   * of the dependencies deliberately: a parent that passes an inline arrow
   * would otherwise refetch on every one of its own renders.
   */
  useEffect(() => {
    if (!onWeekChange) return;

    const endExclusive = new Date(currentWeek);
    endExclusive.setDate(currentWeek.getDate() + 7);

    onWeekChange(currentWeek, endExclusive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWeek]);

  /*
   * Everything recorded, not just this week's.
   *
   * The screen pages back and forth and the list is a handful of rows, so one
   * request beats one per week — and the window filter is what makes a
   * fortnight booked off in December unfindable when the owner scrolls to it.
   */
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      (async () => {
        try {
          const response = await fetch('/api/scheduling/time-off');
          const data = await response.json();
          if (data?.success && Array.isArray(data.data)) {
            setTimeOff(data.data as TimeOffEntry[]);
          }
        } catch {
          /*
           * Silent, like the external busy slots above: an unreadable list
           * leaves the calendar showing ordinary hours, which is where it was
           * before this overlay existed. The booking itself is still checked
           * on the server, so a closed day cannot be booked unknowingly even
           * if this never arrives.
           */
        }
      })();
    }, 150);

    return () => clearTimeout(timeoutId);
  }, []);

  // Quick action handler
  /*
   * The booking awaiting a no-show confirmation, or null. A no-show is a
   * judgement recorded against a person and it reaches their timeline, so it is
   * confirmed rather than applied on one click — and the confirmation is where
   * the owner decides whether to invite them back.
   */
  const [noShowTarget, setNoShowTarget] = useState<{ id: string; name: string | null } | null>(null);
  /*
   * The booking waiting on a cancellation reason, or null.
   *
   * Cancelling used to fire on one click with no body, which stopped working the
   * moment the API began requiring a reason — and was never great anyway: a
   * mis-click emailed the client and freed the slot with nothing in between.
   */
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string | null } | null>(null);

  const handleQuickAction = async (
    bookingId: string,
    action: 'cancel' | 'complete' | 'no-show' | 'delete',
    e: React.MouseEvent,
    /*
     * `notifyClient` belongs to a no-show; the reason belongs to a cancellation.
     * One bag rather than two signatures — the body is passed straight through
     * and the route validates whichever fields its own action needs.
     */
    options?: {
      notifyClient?: boolean;
      reason_code?: string;
      reason?: string;
      share_note_with_client?: boolean;
    }
  ) => {
    e.stopPropagation();
    if (actionInProgress) return;

    setActionInProgress({ bookingId, action });

    try {
      const url = action === 'delete'
        ? `/api/scheduling/bookings/${bookingId}`
        : `/api/scheduling/bookings/${bookingId}/${action}`;
      const method = action === 'delete' ? 'DELETE' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: action === 'delete' ? undefined : JSON.stringify(options ?? {})
      });
      if (response.ok) {
        onBookingUpdated();
      }
    } catch (error) {
      logger.error({ err: error, action, bookingId }, 'Booking action failed');
    } finally {
      setActionInProgress(null);
    }
  };

  function getStartOfWeek(date: Date, sundayFirst: boolean = false) {
    const d = new Date(date);
    const day = d.getDay();

    if (sundayFirst) {
      d.setDate(d.getDate() - day);
    } else {
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
    }
    return d;
  }

  function getWeekDates() {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentWeek);
      date.setDate(currentWeek.getDate() + i);
      dates.push(date);
    }
    return dates;
  }

  function goToPreviousWeek() {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(currentWeek.getDate() - 7);
    setCurrentWeek(newWeek);
  }

  function goToNextWeek() {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(currentWeek.getDate() + 7);
    setCurrentWeek(newWeek);
  }

  function goToToday() {
    setCurrentWeek(getStartOfWeek(new Date(), weekStartsOnSunday));
  }

  const weekDates = getWeekDates();
  const dayNames = weekStartsOnSunday
    ? [t('scheduling.day.sun'), t('scheduling.day.mon'), t('scheduling.day.tue'), t('scheduling.day.wed'), t('scheduling.day.thu'), t('scheduling.day.fri'), t('scheduling.day.sat')]
    : [t('scheduling.day.mon'), t('scheduling.day.tue'), t('scheduling.day.wed'), t('scheduling.day.thu'), t('scheduling.day.fri'), t('scheduling.day.sat'), t('scheduling.day.sun')];

  const statusMatched = statusFilter === 'all'
    ? bookings
    : bookings.filter(booking => booking.status === statusFilter);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE ENTRY PER APPOINTMENT, NOT PER JOB.
   *
   * A calendar answers WHEN, and the authority on when is `scheduling_meetings`
   * — the same table availability reads. This grid used to key off
   * `booking.start_time`, which is the JOB's hour and is empty on any job whose
   * hours live on its sessions. `new Date(null)` is 1 Jan 1970, so those jobs
   * landed in no week and were simply never drawn.
   *
   * The owner saw a free 10:00, clicked it, and was refused a second later:
   * the slot really was taken, by an appointment this grid could not see. The
   * two layers were reading different tables.
   *
   * So a job expands into its appointments. A package of six draws six, which
   * is what a diary is for. The fallback keeps a job with no meeting rows but
   * an hour of its own — nothing in the current data, but a row written before
   * the meetings table existed would otherwise vanish, and dropping an
   * appointment is the one failure this change exists to end.
   *
   * Each entry keeps its job's id, status, client and price: those answer who,
   * what and how much, and they still come from the booking.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const expandedAppointments = statusMatched.flatMap(booking => {
    const meetings = booking.meetings ?? [];

    if (meetings.length === 0) {
      /* Its own id is unique already — there is one row and one appointment. */
      return booking.start_time ? [{ ...booking, appointment_key: booking.id }] : [];
    }

    return meetings.map(meeting => ({
      ...booking,
      start_time: meeting.start_time,
      end_time: meeting.end_time ?? booking.end_time,
      /* The appointment's own outcome, not the job's. A package can have one
         session attended and the next missed. */
      meeting_status: meeting.meeting_status ?? booking.meeting_status,
      /*
       * ───────────────────────────────────────────────────────────────────────
       * AN IDENTITY PER APPOINTMENT, NOT PER JOB.
       *
       * Spreading the booking keeps its `id`, so a package of six produced six
       * entries sharing one id. React was handed duplicate keys and said so:
       * "Encountered two children with the same key ... may cause children to
       * be duplicated and/or omitted".
       *
       * That is not a warning about tidiness. It is why a filtered block stayed
       * on screen, why it answered no hover, and why it wore the wrong colour:
       * React could not tell those siblings apart, so it kept stale nodes and
       * dropped live ones. `layoutConcurrentBookings` keyed its Map by the same
       * id, so overlapping sessions of one package also overwrote each other's
       * column.
       *
       * `id` stays the JOB's id, because every action — open, cancel, reschedule
       * — acts on the job. This is only for telling two rows apart.
       * ───────────────────────────────────────────────────────────────────────
       */
      appointment_key: meeting.id ?? `${booking.id}:${meeting.start_time}`,
    }));
  });

  /*
   * What the chips are hiding is still THERE. The grid draws `filteredBookings`;
   * anything asking whether an hour is occupied asks this.
   */
  const allAppointments = expandedAppointments;

  const filteredBookings = expandedAppointments.filter(
    entry => !hiddenOutcomes.has(outcomeOf(entry))
  );

  /*
   * The debug effect that used to sit here has been removed.
   *
   * It ran on every change to `bookings`, `filteredBookings`, `statusFilter`,
   * `currentWeek` and `weekDates` — so on effectively every render — and logged
   * every booking's id, status and both times to the browser console, plus a
   * per-day overlap trace hardcoded to Thursday. It was written to chase a
   * bug about which column a booking landed in; that bug was fixed by
   * `columnDateKey` and `businessDateKey`, which are now asserted by
   * `crossZone.guard.test.ts`.
   *
   * Nothing read it, it printed client data on every interaction, and
   * `console.*` is not a logging path in this codebase (CLAUDE.md rule 3).
   */

  /**
   * Which calendar day a column stands for, as a date key.
   *
   * `weekDates` are built with `setDate` and so are browser-local midnights.
   * Their calendar FIELDS are the day the column means; the instant they sit
   * at is not, which is why this reads the fields rather than converting.
   */
  const columnDateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const getBookingsForDay = (date: Date) => {
    /*
     * A booking belongs to the column whose date it falls on ON THE BUSINESS'S
     * CLOCK.
     *
     * This built the day's bounds with `setHours(0,0,0,0)` — the browser's
     * midnight — and tested overlap against them. For an owner away from the
     * business's zone those bounds are offset by hours, so a late evening
     * appointment showed in the next column and an early one in the previous.
     * Comparing date KEYS asks the question actually being asked: is this
     * booking on that day, where the business is.
     */
    const key = columnDateKey(date);
    return filteredBookings.filter(
      booking => businessDateKey(new Date(booking.start_time), timezone) === key
    );
  };

  const getWeekBookings = () => {
    // Set weekStart to beginning of day and weekEnd to end of day
    // Same reasoning as getBookingsForDay: the week is a range of business
    // days, and string keys compare exactly without a midnight to get wrong.
    const firstKey = columnDateKey(weekDates[0]);
    const lastKey = columnDateKey(weekDates[6]);

    return filteredBookings
      .filter(booking => {
        const key = businessDateKey(new Date(booking.start_time), timezone);
        return key >= firstKey && key <= lastKey;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  };

  const getServiceName = (serviceId: string) => {
    const service = services.find(s => s.id === serviceId);
    return service?.service_name || t('scheduling.unknown_service');
  };

  const localeMap: Record<string, string> = { en: 'en-US', es: 'es-ES', he: 'he-IL' };
  const currentLocale = localeMap[language] || 'en-US';

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    // Always use 12-hour format with AM/PM for better readability.
    // The zone is the BUSINESS's, not the browser's: an owner checking the week
    // from abroad must read the hours their clients turn up at.
    return date.toLocaleTimeString('en-US', timeZoneOptions({ hour: 'numeric', minute: '2-digit', hour12: true }));
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(currentLocale, timeZoneOptions({ weekday: 'short', month: 'short', day: 'numeric' }));
  };

  const getBookingPosition = (startTime: string) => {
    /*
     * The row a booking sits in is its hour ON THE BUSINESS'S CLOCK.
     *
     * This read `getHours()`, which is the browser's. The grid's hour labels
     * come from the business's availability, so the two disagreed the moment
     * the owner was not in the business's zone: a 2pm appointment drew in the
     * 7am row, on top of whatever was genuinely at 7am.
     */
    const { hour, minute } = businessClock(new Date(startTime), timezone);
    return ((hour - calendarStartHour) * ROW_HEIGHT) + (minute / 60 * ROW_HEIGHT);
  };

  const getBookingHeight = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end.getTime() - start.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    return Math.max(durationHours * ROW_HEIGHT, 32);
  };

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.[0] || '';
    const last = lastName?.[0] || '';
    return (first + last).toUpperCase() || '?';
  };

  const handleBookingMouseEnter = (bookingId: string) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => setHoveredBooking(bookingId), 200);
  };

  const handleBookingMouseLeave = () => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setHoveredBooking(null);
  };

  const getServiceDetails = (serviceId: string) => services.find(s => s.id === serviceId);

  /*
   * THE HOURS A GIVEN DATE IS ACTUALLY OPEN.
   *
   * `windowsForDate` is the one answer to that question in the product — the
   * public booking page, the smart link and the chat all ask it — so the
   * calendar showing something else is the bug it was written for. It applies,
   * in order: a closed range closes the date, a short day REPLACES its hours,
   * otherwise the weekly pattern stands.
   *
   * Keyed off the column's own date rather than its weekday, because time off
   * is recorded against dates.
   */
  const windowsForColumn = (date: Date) =>
    windowsForDate(availability, columnDateKey(date), timeOff);

  /** Why a date is closed, for the header badge. No hour: see `closedDayVerdict`. */
  const closedFor = (date: Date) => closedDayVerdict(timeOff, columnDateKey(date));

  /**
   * Is this hour already somebody's?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE CELL USED TO ACCEPT A CLICK ON ANY HOUR AT ALL.
   *
   * Only `isBlockedExternal` — the owner's other calendar — stopped one. An
   * hour holding one of OUR bookings looked exactly like a free one, so the
   * owner clicked 10:00 on Tuesday, chose a service, chose a client, and was
   * refused at the last step:
   *
   *     This time overlaps an existing booking
   *
   * The public booking page never offered that hour; the owner's own calendar
   * did. Three steps of work, then a refusal that was right all along.
   *
   * `occupiesHour` is the calendar's own rule — see its note — so a cancelled
   * or missed appointment correctly frees its hour again rather than blocking
   * the diary for ever.
   *
   * NOT a judgement about working hours. An owner books outside their usual
   * hours all the time and that stays unremarkable — this is only about an
   * hour that is genuinely occupied.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /** Whether a block the owner can actually see covers this cell. */
  const hasDrawnBooking = (date: Date, hour: number): boolean => {
    /* The business's clock, for the reason in `isHourTaken`. */
    const cellStart = businessInstant(columnDateKey(date), `${hour}:00`, timezone);
    const cellEnd = new Date(cellStart.getTime() + 60 * 60 * 1000);

    return getBookingsForDay(date).some(booking => {
      const start = new Date(booking.start_time).getTime();
      const end = new Date(booking.end_time ?? booking.start_time).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) return false;
      return start < cellEnd.getTime() && end > cellStart.getTime();
    });
  };

  const isHourTaken = (date: Date, hour: number): boolean => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE CELL'S HOUR, ON THE BUSINESS'S CLOCK.
     *
     * `setHours` writes the BROWSER's clock, while the day beside it is matched
     * with `businessDateKey` — the business's. For an owner in another zone the
     * day matched and the hour window sat hours away, so no appointment ever
     * overlapped its own cell and every occupied hour looked free. The grid
     * POSITIONS blocks on the business clock (`businessClock`), so the block
     * drew in the right row while this said the row was empty.
     * ───────────────────────────────────────────────────────────────────────
     */
    const key = columnDateKey(date);
    const cellStart = businessInstant(key, `${hour}:00`, timezone);
    const cellEnd = new Date(cellStart.getTime() + 60 * 60 * 1000);

    /*
     * ───────────────────────────────────────────────────────────────────────
     * OCCUPANCY IS A FACT, NOT A VIEW.
     *
     * This read the DISPLAYED list, so hiding a stage with the chips made its
     * hours look free: with everything filtered out, every hour in the week
     * accepted a click and opened the new-booking dialog on top of an
     * appointment that was still there. The server would have refused it a
     * second later, which is the exact split this guard exists to close.
     *
     * The chips decide what is DRAWN. `allAppointments` is every appointment
     * in the loaded set, filtered by nothing, which is what "is this hour
     * taken" has to ask.
     * ───────────────────────────────────────────────────────────────────────
     */
    return allAppointments.filter(
      booking => businessDateKey(new Date(booking.start_time), timezone) === key
    ).some(booking => {
      if (!occupiesHour(booking)) return false;

      const start = new Date(booking.start_time).getTime();
      const end = new Date(booking.end_time ?? booking.start_time).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) return false;

      /* existing_start < cell_end AND existing_end > cell_start — the same
         comparison the server's overlap check makes. */
      return start < cellEnd.getTime() && end > cellStart.getTime();
    });
  };

  const isHourAvailable = (date: Date, hour: number): boolean => {
    if (!availability) return false;

    for (const slot of windowsForColumn(date)) {
      const [startHour] = slot.start.split(':').map(Number);
      const [endHour] = slot.end.split(':').map(Number);
      if (hour >= startHour && hour < endHour) return true;
    }
    return false;
  };

  /**
   * Whether this cell is outside the hours, because of something the owner said
   * about THAT DATE — a closed day, or a short one.
   *
   * Distinct from `!isHourAvailable`, which is also false for every hour
   * outside the ordinary weekly pattern. An owner books outside their usual
   * hours all the time and that must stay unremarkable; a day they closed is a
   * statement, and worth drawing.
   */
  const isHourClosedByTimeOff = (date: Date, hour: number): boolean => {
    const dateKey = columnDateKey(date);
    if (closedDayVerdict(timeOff, dateKey).closed) return true;

    const verdict = closedDayVerdict(timeOff, dateKey, {
      start: `${String(hour).padStart(2, '0')}:00`,
      end: `${String(hour + 1).padStart(2, '0')}:00`,
    });
    return verdict.closed;
  };

  // Calculate visible hours based on availability
  const getVisibleHours = (): number[] => {
    if (!availability) return DEFAULT_HOURS;

    let minHour = 23;
    let maxHour = 0;
    let hasAnyAvailability = false;

    // Find the earliest start and latest end across all days
    for (const dayKey of DAY_KEYS) {
      const slots = availability[dayKey];
      if (slots && slots.length > 0) {
        hasAnyAvailability = true;
        for (const slot of slots) {
          const [startHour] = slot.start.split(':').map(Number);
          const [endHour] = slot.end.split(':').map(Number);
          if (startHour < minHour) minHour = startHour;
          if (endHour > maxHour) maxHour = endHour;
        }
      }
    }

    // If no availability defined, show default hours
    if (!hasAnyAvailability) return DEFAULT_HOURS;

    // Add 1 hour buffer before and after for visual context
    const bufferStart = Math.max(0, minHour - 1);
    const bufferEnd = Math.min(24, maxHour + 1);

    // Generate array of hours
    const hours: number[] = [];
    for (let h = bufferStart; h < bufferEnd; h++) {
      hours.push(h);
    }

    return hours.length > 0 ? hours : DEFAULT_HOURS;
  };

  const visibleHours = getVisibleHours();
  const calendarStartHour = visibleHours[0] || 6;

  const isDayAvailable = (date: Date): boolean => {
    if (!availability) return false;
    // Through `windowsForColumn`, so a closed date no longer reads as a working
    // day in the header — which is what the owner saw while on holiday.
    return windowsForColumn(date).length > 0;
  };

  // Get external busy slots for a specific day
  const getExternalBusySlotsForDay = (date: Date): ExternalBusySlot[] => {
    // The day's true bounds on the business's clock, so a slot lands in the
    // column a client would say it is in. Kept as an overlap test rather than
    // a key match because an external event can span days.
    const key = columnDateKey(date);
    const dayStart = businessInstant(key, '00:00', timezone);
    const dayEnd = businessInstant(shiftBusinessDateKey(key, 1), '00:00', timezone);

    return externalBusySlots.filter(slot => new Date(slot.start) < dayEnd && new Date(slot.end) > dayStart);
  };

  // Check if an hour is blocked by an external event
  const isHourBlockedByExternal = (date: Date, hour: number): boolean => {
    /*
     * The cell's own hour, as an instant on the business's clock.
     *
     * `setHours` made it the browser's hour, so a cell labelled 9am was
     * compared against a busy slot as though it were 9am somewhere else: an
     * owner abroad saw the wrong hours greyed out.
     */
    const key = columnDateKey(date);
    const hourStart = businessInstant(key, `${String(hour).padStart(2, '0')}:00`, timezone);
    const hourEnd = businessInstant(key, `${String(hour + 1).padStart(2, '0')}:00`, timezone);

    return externalBusySlots.some(slot => {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      // Check for overlap
      return hourStart < slotEnd && hourEnd > slotStart;
    });
  };

  // Get the position (top offset) for an external busy slot
  const getExternalSlotPosition = (slot: ExternalBusySlot): number => {
    const { hour, minute: minutes } = businessClock(new Date(slot.start), timezone);
    // Clamp to calendar start time
    const clampedHour = Math.max(hour, calendarStartHour);
    const clampedMinutes = hour < calendarStartHour ? 0 : minutes;
    return ((clampedHour - calendarStartHour) * ROW_HEIGHT) + (clampedMinutes / 60 * ROW_HEIGHT);
  };

  // Get the height for an external busy slot
  const getExternalSlotHeight = (slot: ExternalBusySlot): number => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const lastVisibleHour = visibleHours[visibleHours.length - 1] || 22;
    // Clamp start to first visible hour if earlier
    /*
     * Clamped against the business's hours, and `businessInstant` builds the
     * clamp rather than `setHours` — which wrote the browser's clock back onto
     * the date AND mutated it in place, so the same slot measured differently
     * on a second render.
     */
    const startKey = businessDateKey(start, timezone);
    const clampedStart =
      businessClock(start, timezone).hour < calendarStartHour
        ? businessInstant(startKey, `${String(calendarStartHour).padStart(2, '0')}:00`, timezone)
        : start;
    const clampedEnd =
      businessClock(end, timezone).hour >= lastVisibleHour
        ? businessInstant(businessDateKey(end, timezone), `${String(lastVisibleHour).padStart(2, '0')}:00`, timezone)
        : end;
    const durationMs = clampedEnd.getTime() - clampedStart.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    return Math.max(durationHours * ROW_HEIGHT, 20);
  };

  // Check if external slot is within visible hours
  const isExternalSlotVisible = (slot: ExternalBusySlot): boolean => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const lastVisibleHour = visibleHours[visibleHours.length - 1] || 22;
    // Slot is visible if it overlaps with visible hours range
    return businessClock(start, timezone).hour < lastVisibleHour && businessClock(end, timezone).hour >= calendarStartHour;
  };

  const totalBookings = weekDates.reduce((acc, date) => acc + getBookingsForDay(date).length, 0);

  /*
   * How many of each outcome this week holds, counted BEFORE the chips are
   * applied — a control cannot offer to bring back something it can no longer
   * see, and a chip that hid its own count would lose its number the moment it
   * was pressed.
   */
  const outcomeCounts = statusMatched
    .flatMap(booking => {
      const meetings = booking.meetings ?? [];
      if (meetings.length === 0) return booking.start_time ? [booking] : [];
      return meetings.map(meeting => ({
        ...booking,
        start_time: meeting.start_time,
        meeting_status: meeting.meeting_status ?? booking.meeting_status,
      }));
    })
    .reduce<Record<string, number>>((counts, entry) => {
      const when = new Date(entry.start_time);
      const inWeek =
        when >= weekDates[0] && when < new Date(weekDates[6].getTime() + 24 * 60 * 60 * 1000);
      if (!inWeek) return counts;

      const outcome = outcomeOf(entry);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      return counts;
    }, {});
  const weekBookings = getWeekBookings();

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header with navigation */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-[var(--v2-bg)]/80 backdrop-blur-sm rounded-full p-1 border border-white/10">
            <button
              onClick={goToPreviousWeek}
              className="p-2 hover:bg-white/10 rounded-full transition-all duration-200 active:scale-95"
            >
              <ChevronLeft className="h-4 w-4 text-[var(--v2-text-secondary)] rtl:rotate-180" />
            </button>
            <button
              onClick={goToNextWeek}
              className="p-2 hover:bg-white/10 rounded-full transition-all duration-200 active:scale-95"
            >
              <ChevronRight className="h-4 w-4 text-[var(--v2-text-secondary)] rtl:rotate-180" />
            </button>
          </div>
          <div className="text-base font-semibold text-[var(--v2-text-primary)]">
            {weekDates[0].toLocaleDateString(currentLocale, { month: 'short', day: 'numeric' })} — {weekDates[6].toLocaleDateString(currentLocale, { month: 'short', day: 'numeric' })}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-500/10 backdrop-blur-sm rounded-full border border-teal-500/20">
            <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
            <span className="text-sm font-medium text-teal-600 dark:text-teal-400">
              {totalBookings} {t('scheduling.bookings_count')}
            </span>
          </div>

          {/*
            * One chip per outcome, each carrying its own count.
            *
            * The count badge above follows them, because it counts what is
            * DRAWN: a badge reading 62 over a grid showing 17 is the kind of
            * disagreement that sends an owner hunting for a bug.
            *
            * A chip appears only when the week actually holds that outcome. A
            * dead control is worse than no control, and on a clean week all
            * three would sit there doing nothing.
            */}
          {RELEASED_OUTCOMES.map(outcome => {
            const count = outcomeCounts[outcome.key] ?? 0;
            if (count === 0) return null;

            const hidden = hiddenOutcomes.has(outcome.key);

            return (
              <button
                key={outcome.key}
                type="button"
                aria-pressed={hidden}
                onClick={() => toggleOutcome(outcome.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-200 active:scale-95 ${
                  hidden
                    ? 'bg-white/5 border-white/10 text-[var(--v2-text-muted)] line-through'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
                style={
                  hidden
                    ? undefined
                    : { color: outcome.color, borderColor: `${outcome.color}66`, backgroundColor: `${outcome.color}14` }
                }
                title={t('scheduling.outcome_toggle_hint')}
              >
                {t(`scheduling.status.${outcome.key}`)} ({count})
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* Expand toggle buttons */}
          <div className="flex items-center bg-[var(--v2-bg)]/80 backdrop-blur-sm rounded-full p-1 border border-white/10">
            <button
              onClick={() => setExpandMode(expandMode === 'calendar' ? 'both' : 'calendar')}
              className={`p-2 rounded-full transition-all duration-200 active:scale-95 border ${
                expandMode === 'calendar'
                  ? 'text-[#14B8A6] border-[#14B8A6] bg-[#14B8A6]/10'
                  : 'border-transparent hover:bg-white/10 text-[var(--v2-text-secondary)]'
              }`}
              title={expandMode === 'calendar' ? t('scheduling.view_both') : t('scheduling.expand_calendar')}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setExpandMode(expandMode === 'list' ? 'both' : 'list')}
              className={`p-2 rounded-full transition-all duration-200 active:scale-95 border ${
                expandMode === 'list'
                  ? 'text-[#14B8A6] border-[#14B8A6] bg-[#14B8A6]/10'
                  : 'border-transparent hover:bg-white/10 text-[var(--v2-text-secondary)]'
              }`}
              title={expandMode === 'list' ? t('scheduling.view_both') : t('scheduling.expand_list')}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={goToToday}
            className="px-4 py-2 text-sm font-medium text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 rounded-full transition-all duration-200 active:scale-95"
          >
            {t('scheduling.today')}
          </button>
        </div>
      </div>

      {/* Calendar and List side by side */}
      <div className={`flex-1 grid gap-4 min-h-0 overflow-hidden ${
        expandMode === 'both' ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'
      }`}>
        {/* Calendar - Takes 2/3 of the space (or full if expanded, hidden if list expanded) */}
        {expandMode !== 'list' && (
        <div className={`overflow-hidden ${expandMode === 'both' ? 'lg:col-span-2' : ''}`}>
          <div
            className="bg-gradient-to-br from-[var(--v2-surface)] to-[var(--v2-bg)] backdrop-blur-xl border border-white/10 dark:border-white/5 overflow-hidden shadow-xl shadow-black/5"
            style={{ borderRadius: '20px' }}
          >

        {/* Calendar Grid - Glass morphism */}
        <div
          className="overflow-auto scroll-smooth [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/30"
          /*
            `dvh`, not `vh`. This sits inside a dialog that is itself a
            full-height sheet on a phone, so a cap measured against a viewport
            that includes the address bar put the last hours of the day below
            the fold of a panel that cannot scroll any further.
          */
          style={{ maxHeight: '75dvh' }}
        >
          <div className="min-w-[500px]">
            {/* Modern Day Headers */}
            <div className="grid grid-cols-8 border-b border-white/10 dark:border-white/5 sticky top-0 bg-[var(--v2-surface)]/95 backdrop-blur-xl z-20">
              <div className="p-3 border-e border-white/5 w-14" />
              {weekDates.map((date, index) => {
                const isToday = date.toDateString() === new Date().toDateString();
                const dayBookings = getBookingsForDay(date);
                const hasAvailability = isDayAvailable(date);
                const closed = closedFor(date);
                return (
                  <div
                    key={index}
                    className={`py-3 px-2 text-center border-e border-white/5 last:border-e-0 transition-all duration-300 ${
                      isToday ? 'bg-gradient-to-b from-teal-500/20 to-transparent' : ''
                    }`}
                  >
                    <div className={`text-[10px] uppercase tracking-wider font-semibold mb-1 ${
                      isToday ? 'text-teal-500' : hasAvailability ? 'text-teal-600/70 dark:text-teal-400/70' : 'text-[var(--v2-text-muted)]'
                    }`}>
                      {dayNames[index]}
                    </div>
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={`text-lg font-bold transition-all ${
                          isToday
                            ? 'w-8 h-8 flex items-center justify-center rounded-full bg-teal-500 text-white shadow-lg shadow-teal-500/30'
                            : 'text-[var(--v2-text-primary)]'
                        }`}
                      >
                        {date.getDate()}
                      </span>
                      {dayBookings.length > 0 && !isToday && (
                        <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400 bg-teal-500/15 px-1.5 py-0.5 rounded-full">
                          {dayBookings.length}
                        </span>
                      )}
                    </div>
                    {/*
                      The reason, when the owner gave one — 'Sukkot' tells them
                      which closure this is, where 'Closed' sends them to the
                      settings dialog to find out.
                    */}
                    {closed.closed && (
                      <div
                        className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 truncate"
                        title={closed.reason || t('scheduling.closed')}
                      >
                        {closed.reason || t('scheduling.closed')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Time Rows - Modern style */}
            <div className="relative">
              {visibleHours.map((hour, hourIndex) => (
                <div
                  key={hour}
                  className={`grid grid-cols-8 border-b border-white/5 last:border-b-0 ${
                    hourIndex % 2 === 0 ? 'bg-white/[0.02]' : ''
                  }`}
                  style={{ height: `${ROW_HEIGHT}px` }}
                >
                  <div className="px-2 py-1 text-[11px] font-medium text-[var(--v2-text-muted)] text-end border-e border-white/5 w-14 flex items-start justify-end pt-1">
                    {hour > 12 ? `${hour - 12}` : hour === 12 ? '12' : `${hour}`}
                    <span className="text-[9px] ms-0.5 opacity-60">{hour >= 12 ? 'PM' : 'AM'}</span>
                  </div>
                  {weekDates.map((date, dayIndex) => {
                    const isToday = date.toDateString() === new Date().toDateString();
                    const isAvailable = isHourAvailable(date, hour);
                    const isBlockedExternal = isHourBlockedByExternal(date, hour);
                    /* Occupied by one of our own bookings — see `isHourTaken`. */
                    const isTaken = isHourTaken(date, hour);
                    /*
                      Drawn like an external busy slot — the hatch already means
                      "not an open hour" on this grid — but in amber rather than
                      grey, and STILL CLICKABLE. The two are different kinds of
                      obstacle: an event in the owner's own calendar blocks the
                      hour, while a day they closed is their own statement, and
                      the dialog asks before it books rather than refusing.
                    */
                    const isClosedByTimeOff = !isBlockedExternal && isHourClosedByTimeOff(date, hour);
                    /*
                      ───────────────────────────────────────────────────────────
                      TAKEN, BUT NOT DRAWN.
                      
                      The chips hide a stage; the hour it occupies is still
                      occupied. Without this the owner sees an empty cell that
                      refuses the click, with nothing to explain it — which is
                      the shape of a broken grid rather than a busy diary.
                      
                      Hatched, exactly as a Google busy slot is, because the
                      hatch already means "not an open hour" here and the owner
                      has already learnt it. The cause differs and the answer
                      does not: this hour is not for sale.
                      ───────────────────────────────────────────────────────────
                    */
                    const isTakenButHidden =
                      isTaken && !isBlockedExternal && !hasDrawnBooking(date, hour);
                    /*
                      ───────────────────────────────────────────────────────────
                      AN HOUR THAT HAS BEEN AND GONE TAKES NO BOOKINGS.
                      
                      Paging back a week and clicking an empty cell opened the
                      new-booking dialog on an hour in the past: the owner fills
                      in a client and a service, presses create, and only then
                      learns it cannot be booked. Nothing in the grid said so,
                      because every guard here was about the hour being OCCUPIED
                      and none about it being over.
                      
                      Measured against the cell's END, so the hour you are
                      currently in stays bookable until it is actually finished.
                      ───────────────────────────────────────────────────────────
                    */
                    /* Also the business's clock: "has this hour been and
                       gone" is asked where the business is. */
                    const isPast =
                      businessInstant(columnDateKey(date), `${hour}:00`, timezone).getTime() +
                        60 * 60 * 1000 <=
                      Date.now();
                    const isBookable = !isBlockedExternal && !isTaken && !isPast;

                    return (
                      <div
                        key={dayIndex}
                        onClick={() => isBookable && onSlotClick?.(date, hour)}
                        className={`border-e border-white/5 last:border-e-0 transition-all duration-200 group relative ${
                          /* The cursor must agree with the click. A pointer
                             over a cell that refuses is the part that reads as
                             broken — the owner presses, nothing happens, and
                             there is nothing to tell them why. */
                          isBookable ? 'cursor-pointer' : 'cursor-not-allowed'
                        } ${isPast ? 'opacity-40' : ''} ${
                          isBlockedExternal || isTakenButHidden || isClosedByTimeOff
                            ? ''
                            : isAvailable
                              ? 'bg-teal-500/10 hover:bg-teal-500/20'
                              : isToday
                                ? 'bg-teal-500/5 hover:bg-teal-500/10'
                                : 'hover:bg-white/5'
                        }`}
                        style={isBlockedExternal || isTakenButHidden ? {
                          /* The same hatch a synced busy slot wears — see
                             `isTakenButHidden`. */
                          background: 'repeating-linear-gradient(135deg, rgba(156, 163, 175, 0.15), rgba(156, 163, 175, 0.15) 4px, rgba(156, 163, 175, 0.08) 4px, rgba(156, 163, 175, 0.08) 8px)'
                        } : isClosedByTimeOff ? {
                          background: 'repeating-linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(245, 158, 11, 0.16) 4px, rgba(245, 158, 11, 0.07) 4px, rgba(245, 158, 11, 0.07) 8px)'
                        } : {}}
                      >
                        {/* Busy: a synced event, or an appointment the chips are hiding. */}
                        {(isBlockedExternal || isTakenButHidden) && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[9px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider opacity-60">
                              {t('scheduling.busy')}
                            </span>
                          </div>
                        )}
                        {/* Closed: the first row of the hatch carries the word, so a
                            run of closed hours is not a column of repeated labels. */}
                        {isClosedByTimeOff && hourIndex === 0 && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-[9px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider opacity-70">
                              {t('scheduling.closed')}
                            </span>
                          </div>
                        )}
                        {/* Hover indicator - only show if not blocked */}
                        {!isBlockedExternal && (
                          <div className="w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="w-1.5 h-1.5 rounded-full bg-teal-500/50" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Booking Overlays - Glass morphism cards */}
              {weekDates.map((date, dayIndex) => {
                const dayBookings = getBookingsForDay(date);
                const inlineStartPercent = ((dayIndex + 1) / 8) * 100;
                // Which side a hover tooltip opens on. It is a fixed 240px in a
                // column worth an eighth of the grid, so near the end of the week
                // it does not fit after the block and gets clipped by the
                // calendar overflow-hidden. That happens in BOTH directions,
                // because the end of the week is the left edge in Hebrew and the
                // right in English. Opening it back towards the middle is the
                // only place it has room. Two columns, from the widths this
                // dialog renders at: 240px needs a little over two of them.
                const flipTooltip = dayIndex >= weekDates.length - 2;
                const widthPercent = (1 / 8) * 100;
                return (
                  <div
                    key={dayIndex}
                    className="absolute top-0"
                    style={{ insetInlineStart: `${inlineStartPercent}%`, width: `${widthPercent}%` }}
                  >
                    {/* External Busy Slot Overlays */}
                    {getExternalBusySlotsForDay(date)
                      .filter(slot => !slot.is_all_day && isExternalSlotVisible(slot))
                      .map((slot, slotIndex) => (
                        <div
                          key={`external-${slotIndex}`}
                          className="absolute inset-x-1 z-5 rounded-lg border border-gray-400/30 overflow-hidden pointer-events-none"
                          style={{
                            top: `${getExternalSlotPosition(slot)}px`,
                            height: `${getExternalSlotHeight(slot)}px`,
                            background: 'repeating-linear-gradient(135deg, rgba(156, 163, 175, 0.2), rgba(156, 163, 175, 0.2) 4px, rgba(156, 163, 175, 0.1) 4px, rgba(156, 163, 175, 0.1) 8px)'
                          }}
                        >
                          <div className="h-full flex items-center justify-center">
                            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                              {t('scheduling.busy')}
                            </span>
                          </div>
                        </div>
                      ))
                    }
                    {(() => { const concurrency = layoutConcurrentBookings(dayBookings); return dayBookings.map(booking => {
                      /* The appointment's outcome, not the job's status —
                         see `outcomeOf`. A held hour must never be drawn as a
                         cancellation because the job was closed later. */
                      const statusStyle =
                        STATUS_COLORS[outcomeOf(booking)] || STATUS_COLORS.pending;
                      /*
                       * A completed meeting opens nothing.
                       *
                       * It is a record: it cannot be moved, reassigned or
                       * turned into a different service, so an edit dialog has
                       * nothing to offer but the discovery that everything in
                       * it is locked. Hovering already shows what it was, and
                       * that is the whole of what there is to know.
                       *
                       * The cursor says so too — a pointer over something that
                       * does not respond is the part that reads as broken.
                       */
                      /* `meeting_status` is where the outcome lives; without it a
                         held meeting stayed clickable and editable. */
                      const isRecord =
                        booking.meeting_status === 'held' || booking.status === 'completed';
                      const height = getBookingHeight(booking.start_time, booking.end_time);
                      const service = getServiceDetails(booking.service_id);
                      const isHovered = hoveredBooking === booking.id;
                      /*
                       * How many bookings share this block's time, and which of
                       * them this is. Drives BOTH the geometry below and how
                       * much of the content can be shown: at a third of a day
                       * column there is no room for a name, so a crowded slot
                       * degrades to initials and says how many it holds.
                       */
                      const slot = concurrency.get((booking as { appointment_key?: string }).appointment_key ?? booking.id);

                      /*
                       * Beyond the third column there is nothing legible to
                       * draw, so these are not drawn — they are COUNTED, on
                       * the block that holds the last column. See
                       * `layoutConcurrentBookings`.
                       */
                      if (slot?.hidden) return null;
                      const sharing = slot?.columns ?? 1;
                      const crowded = sharing > 1 && !isHovered;
                      return (
                        <div
                          /* The APPOINTMENT, not the job — see the note on
                             `appointment_key`. Duplicate keys here are what
                             left filtered blocks on screen. */
                          key={(booking as { appointment_key?: string }).appointment_key ?? booking.id}
                          onClick={isRecord ? undefined : () => onBookingClick(booking)}
                          onMouseEnter={() => handleBookingMouseEnter(booking.id)}
                          onMouseLeave={handleBookingMouseLeave}
                          className={`
                            absolute ${isRecord ? 'cursor-default' : 'cursor-pointer'}
                            ${statusStyle.bg} ${statusStyle.border} border
                            rounded-lg
                            transition-all duration-200
                            hover:scale-[1.02] hover:shadow-lg ${statusStyle.glow}
                            ${isHovered ? 'z-50 overflow-visible' : 'z-10 overflow-hidden'}
                          `}
                          style={{
                            top: `${getBookingPosition(booking.start_time)}px`,
                            height: `${height}px`,
                            /*
                             * Side by side when they collide, full width when
                             * they do not — see `layoutConcurrentBookings`.
                             * A hovered block takes the whole column so its
                             * detail is readable even at a third of the width.
                             */
                            ...(() => {
                              if (sharing < 2 || isHovered) {
                                return { insetInlineStart: '4px', insetInlineEnd: '4px' };
                              }
                              const share = 100 / sharing;
                              return {
                                insetInlineStart: `calc(${share * (slot?.column ?? 0)}% + 2px)`,
                                width: `calc(${share}% - 4px)`,
                              };
                            })(),
                          }}
                        >
                          <div className={`h-full flex items-center overflow-hidden ${crowded ? 'px-1 justify-center' : 'px-2'}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 flex-shrink-0">
                                {getInitials(booking.client_first_name, booking.client_last_name)}
                              </div>
                              {/* The name needs room. In a shared slot there is
                                  none, and a truncated "E…" reads as a glitch —
                                  the initials already say who it is, and hover
                                  widens the block back to full width. */}
                              {!crowded && (
                                <span className={`text-[11px] font-semibold truncate ${statusStyle.text}`}>
                                  {booking.client_first_name}
                                </span>
                              )}
                              {/* This block stands for itself and for the ones
                                  the grid had no width left to draw. */}
                              {slot?.overflow ? (
                                <span className="text-[10px] font-bold text-[var(--v2-text-secondary)] flex-shrink-0">
                                  +{slot.overflow - 1}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {/* Modern Tooltip */}
                          {isHovered && (
                            <div
                              className="absolute z-[100] w-[240px] bg-[var(--v2-surface)]/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/20 p-4 pointer-events-none"
                              style={{
                                borderRadius: '16px',
                                top: '0',
                                /*
                                 * LOGICAL, NOT `left`.
                                 *
                                 * This was `left: '100%'` with `marginLeft`, which
                                 * pins the tooltip to the physical right whatever
                                 * the writing direction. The day columns around it
                                 * already use `insetInlineStart` and mirror
                                 * correctly in Hebrew; the tooltip did not, so it
                                 * opened on the wrong side of its own block and was
                                 * clipped by the calendar's `overflow-hidden`.
                                 *
                                 * `insetInlineStart` opens it AFTER the block in
                                 * reading order: right in English, left in Hebrew.
                                 */
                                ...(flipTooltip
                                  ? { insetInlineEnd: '100%', marginInlineEnd: '12px' }
                                  : { insetInlineStart: '100%', marginInlineStart: '12px' }),
                              }}
                            >
                              {/*
                                "1 of 3 at this time" — the count lives HERE.
                                ─────────────────────────────────────────────
                                It was briefly a badge pinned to the block
                                itself, which cannot work: an hour is 56px, so
                                a 15-minute booking is FOURTEEN PIXELS tall and
                                `overflow-hidden` clipped anything that tried to
                                sit on it. The tooltip is the one surface in
                                this view with room to say it, and it is already
                                what the owner opens to read a crowded slot.
                              */}
                              {sharing > 1 && (
                                <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--v2-text-muted)]">
                                  {t('scheduling.slot.position', {
                                    position: (slot?.column ?? 0) + 1,
                                    total: sharing,
                                  })}
                                </div>
                              )}

                              {/* Client Name */}
                              <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10">
                                  {getInitials(booking.client_first_name, booking.client_last_name)}
                                </div>
                                <div>
                                  <div className="font-semibold text-sm text-[var(--v2-text-primary)]">
                                    {booking.client_first_name} {booking.client_last_name}
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] px-2 py-0.5 mt-1 ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                                  >
                                    {t(`scheduling.status.${statusStyle.label}`)}
                                  </Badge>
                                </div>
                              </div>

                              {/* Service */}
                              <div className="flex items-center gap-2.5 text-xs text-[var(--v2-text-secondary)] mb-2">
                                <div className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center">
                                  <Calendar className="h-3.5 w-3.5 text-teal-500" />
                                </div>
                                <span className="font-medium">{service?.service_name || t('scheduling.unknown_service')}</span>
                              </div>

                              {/* Time */}
                              <div className="flex items-center gap-2.5 text-xs text-[var(--v2-text-secondary)] mb-2">
                                <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                  <Clock className="h-3.5 w-3.5 text-blue-500" />
                                </div>
                                <span dir="ltr">{formatTime(booking.start_time)} - {formatTime(booking.end_time)}</span>
                              </div>

                              {/* Price */}
                              {service?.price != null && service.price > 0 && (
                                <div className="text-sm font-semibold text-teal-600 dark:text-teal-400 bg-teal-500/10 px-3 py-1.5 rounded-lg inline-block">
                                  {formatCurrency(service.price, { currencyOverride: service.currency ?? undefined })}
                                </div>
                              )}

                              {/* Contact info */}
                              {(booking.client_phone || booking.client_email) && (
                                <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                                  {booking.client_phone && (
                                    <div className="flex items-center gap-2.5 text-xs text-[var(--v2-text-muted)]">
                                      <Phone className="h-3.5 w-3.5" />
                                      <span dir="ltr">{booking.client_phone}</span>
                                    </div>
                                  )}
                                  {booking.client_email && (
                                    <div className="flex items-center gap-2.5 text-xs text-[var(--v2-text-muted)]">
                                      <Mail className="h-3.5 w-3.5" />
                                      <span className="truncate">{booking.client_email}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }); })()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
          </div>
        </div>
        )}

        {/* Bookings List - Takes 1/3 of the space (or full if expanded, hidden if calendar expanded) */}
        {expandMode !== 'calendar' && (
        <div className="overflow-hidden">
          <div
            className="bg-gradient-to-br from-[var(--v2-surface)] to-[var(--v2-bg)] backdrop-blur-xl border border-white/10 dark:border-white/5 overflow-hidden flex flex-col shadow-xl shadow-black/5 h-full"
            style={{ borderRadius: '20px' }}
          >
        {/* List Header */}
        <div className="px-5 py-4 border-b border-white/10 dark:border-white/5 flex-shrink-0 bg-gradient-to-r from-transparent via-teal-500/5 to-transparent">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
              {t('scheduling.bookings_list')}
            </h3>
            <div className="flex items-center gap-2 px-2.5 py-1 bg-teal-500/10 backdrop-blur-sm rounded-full border border-teal-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
              <span className="text-xs font-semibold text-teal-600 dark:text-teal-400">
                {weekBookings.length}
              </span>
            </div>
          </div>
          <p className="text-xs text-[var(--v2-text-muted)]">
            {weekDates[0].toLocaleDateString(currentLocale, { month: 'short', day: 'numeric' })} — {weekDates[6].toLocaleDateString(currentLocale, { month: 'short', day: 'numeric' })}
          </p>

          {/* Status Filter Pills */}
          <div className="flex flex-wrap gap-2 mt-4">
            {STATUS_FILTERS.map(filter => {
              const isActive = statusFilter === filter.key;
              const count = filter.key === 'all'
                ? bookings.filter(b => {
                    const bookingDate = new Date(b.start_time);
                    return bookingDate >= weekDates[0] && bookingDate <= new Date(weekDates[6].getTime() + 24 * 60 * 60 * 1000);
                  }).length
                : bookings.filter(b => {
                    const bookingDate = new Date(b.start_time);
                    return b.status === filter.key &&
                      bookingDate >= weekDates[0] &&
                      bookingDate <= new Date(weekDates[6].getTime() + 24 * 60 * 60 * 1000);
                  }).length;

              return (
                <button
                  key={filter.key}
                  onClick={() => setStatusFilter(filter.key)}
                  className={`px-3 py-1.5 text-[11px] font-semibold rounded-full transition-all duration-200 active:scale-95 border ${
                    isActive
                      ? ''
                      : 'bg-white/5 backdrop-blur-sm border-white/10 text-[var(--v2-text-secondary)] hover:bg-white/10 hover:border-white/20'
                  }`}
                  style={isActive ? {
                    color: filter.color,
                    borderColor: filter.color,
                    backgroundColor: `${filter.color}15`
                  } : {}}
                >
                  {t(`scheduling.filter.${filter.key}`)} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Bookings List */}
        <div className="flex-1 overflow-y-auto scroll-smooth [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/30">
          {weekBookings.length > 0 ? (
            <div className="p-4 space-y-3">
              {weekBookings.map(booking => {
                const statusStyle = STATUS_COLORS[booking.status] || STATUS_COLORS.pending;
                const isConfirmed = booking.status === 'confirmed';
                const service = getServiceDetails(booking.service_id);
                /* Same rule as the grid above: a completed meeting is a record,
                   and a record does not open an editor. */
                /* Same as the week view above. */
                const isRecord =
                  booking.meeting_status === 'held' || booking.status === 'completed';

                return (
                  <div
                    key={booking.id}
                    onClick={isRecord ? undefined : () => onBookingClick(booking)}
                    className={`p-4 transition-all duration-200 group relative overflow-hidden ${
                      isRecord
                        ? 'cursor-default'
                        : 'cursor-pointer hover:border-teal-500/50 active:scale-[0.995]'
                    }`}
                    style={{
                      borderRadius: '16px',
                      backgroundColor: 'var(--v2-surface)',
                      border: '1px solid var(--v2-border)',
                      boxShadow: 'var(--v2-shadow-card)'
                    }}
                  >
                    {/* Status indicator bar at left */}
                    <div className={`absolute top-0 bottom-0 left-0 w-1 ${statusStyle.dot}`} style={{ borderRadius: '16px 0 0 16px' }} />

                    {/* Main content - horizontal layout */}
                    <div className="flex items-center gap-4 ps-2">
                      {/* Avatar */}
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 flex-shrink-0">
                        {getInitials(booking.client_first_name, booking.client_last_name)}
                      </div>

                      {/* Client & Service Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm text-[var(--v2-text-primary)] truncate">
                            {booking.client_first_name} {booking.client_last_name}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[9px] px-2 py-0.5 rounded-full flex-shrink-0 ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                          >
                            {t(`scheduling.status.${statusStyle.label}`)}
                          </Badge>
                        </div>
                        <div className="text-xs text-[var(--v2-text-muted)] truncate">
                          {service?.service_name || t('scheduling.unknown_service')}
                        </div>
                      </div>

                      {/* Date & Time. `min-w-0` so a narrow pane truncates it
                          rather than pushing the row wider than the card. */}
                      <div className="flex items-center gap-4 flex-shrink min-w-0">
                        <div className="flex items-center gap-2 text-xs text-[var(--v2-text-secondary)]">
                          <div className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                            <Calendar className="h-3.5 w-3.5 text-teal-500" />
                          </div>
                          <span className="font-medium whitespace-nowrap">{formatDate(booking.start_time)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--v2-text-secondary)]">
                          <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                            <Clock className="h-3.5 w-3.5 text-blue-500" />
                          </div>
                          <span dir="ltr" className="font-medium whitespace-nowrap">{formatTime(booking.start_time)}</span>
                        </div>
                      </div>

                      {/*
                        Quick actions, FLOATED over the row rather than given
                        space in it.
                        ─────────────────────────────────────────────────────
                        This was `flex-shrink-0 w-[340px]`, so every row
                        reserved 340px for buttons that are invisible until
                        hover. In the bookings pane — a third of the dialog —
                        that reserve plus the non-shrinking date block exceeded
                        the card, and since neither could shrink the row
                        overflowed: the status badge came to rest on top of
                        "Thu, Sep 24".

                        Positioning them absolutely keeps the original intent
                        (nothing shifts when the button count differs, because
                        they never occupied the row) without charging every row
                        340px it does not have. The backdrop keeps the text
                        underneath from showing through while they are up.
                        ─────────────────────────────────────────────────────
                      */}
                      <div className="absolute inset-y-0 end-0 flex items-center justify-end gap-1.5 ps-8 pe-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto bg-gradient-to-l from-[var(--v2-surface)] via-[var(--v2-surface)] to-transparent rounded-e-2xl">
                        {isConfirmed && (
                          <>
                            <button
                              onClick={(e) => handleQuickAction(booking.id, 'complete', e)}
                              disabled={actionInProgress?.bookingId === booking.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-blue-500 bg-blue-500/10 border border-blue-500/30 rounded-full hover:bg-blue-500/20 active:scale-95 transition-all disabled:opacity-50"
                            >
                              {actionInProgress?.bookingId === booking.id && actionInProgress.action === 'complete' ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle className="h-3.5 w-3.5" />
                              )}
                              {t('scheduling.quick_action.done')}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setNoShowTarget({
                                  id: booking.id,
                                  name: [booking.client_first_name, booking.client_last_name]
                                    .filter(Boolean)
                                    .join(' ') || null,
                                });
                              }}
                              disabled={actionInProgress?.bookingId === booking.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-full hover:bg-amber-500/20 active:scale-95 transition-all disabled:opacity-50"
                            >
                              {actionInProgress?.bookingId === booking.id && actionInProgress.action === 'no-show' ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <AlertCircle className="h-3.5 w-3.5" />
                              )}
                              {t('scheduling.quick_action.no_show')}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                // Asks for a reason instead of firing. The API
                                // requires one, and a mis-click here emails a
                                // client and frees their slot.
                                setCancelTarget({
                                  id: booking.id,
                                  name: booking.contact
                                    ? `${booking.contact.first_name ?? ''} ${booking.contact.last_name ?? ''}`.trim() || null
                                    : null,
                                });
                              }}
                              disabled={actionInProgress?.bookingId === booking.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-red-500 bg-red-500/10 border border-red-500/30 rounded-full hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-50"
                            >
                              {actionInProgress?.bookingId === booking.id && actionInProgress.action === 'cancel' ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" />
                              )}
                              {t('scheduling.quick_action.cancel')}
                            </button>
                          </>
                        )}
                        <button
                          onClick={(e) => handleQuickAction(booking.id, 'delete', e)}
                          disabled={actionInProgress?.bookingId === booking.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-red-500 bg-red-500/10 border border-red-500/30 rounded-full hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-50"
                        >
                          {actionInProgress?.bookingId === booking.id && actionInProgress.action === 'delete' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          {t('scheduling.quick_action.delete')}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
                style={{ background: 'linear-gradient(135deg, rgba(20, 184, 166, 0.2) 0%, rgba(13, 148, 136, 0.1) 100%)' }}
              >
                <Calendar className="w-8 h-8 text-teal-500" />
              </div>
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-2">
                {t('scheduling.no_bookings')}
              </h3>
              <p className="text-sm text-[var(--v2-text-muted)] text-center max-w-[200px]">
                {t('scheduling.no_bookings_desc')}
              </p>
            </div>
          )}
        </div>
          </div>
        </div>
        )}
      </div>

      {/*
        Confirms before recording a no-show, and is where the owner chooses
        whether to invite the client to rebook. Off by default — see the dialog.
      */}
      {/* Cancelling asks for a reason — mandatory on every cancellation surface,
          and the pause a destructive one-click always needed. */}
      <CancelReasonDialog
        open={cancelTarget !== null}
        onOpenChange={open => !open && setCancelTarget(null)}
        clientName={cancelTarget?.name ?? null}
        onConfirm={async ({ reasonCode, note, shareNote }) => {
          if (!cancelTarget) return;
          await handleQuickAction(
            cancelTarget.id,
            'cancel',
            // Synthesised: the real click was the dialog's own button, and
            // `handleQuickAction` only needs something to stop propagating.
            { stopPropagation: () => {} } as React.MouseEvent,
            { reason_code: reasonCode, reason: note || undefined, share_note_with_client: shareNote }
          );
          setCancelTarget(null);
        }}
      />

      <NoShowConfirmDialog
        open={noShowTarget !== null}
        onOpenChange={open => !open && setNoShowTarget(null)}
        clientName={noShowTarget?.name ?? null}
        onConfirm={async ({ notifyClient }) => {
          if (!noShowTarget) return;
          await handleQuickAction(
            noShowTarget.id,
            'no-show',
            // Synthesised: the real click was on the dialog's own button, and
            // `handleQuickAction` only needs something to stop propagating.
            { stopPropagation: () => {} } as React.MouseEvent,
            { notifyClient }
          );
          setNoShowTarget(null);
        }}
      />
    </div>
  );
}
