'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { BookingStatus } from '@/lib/business-os/bookingStatus';
import { holdsSlot } from '@/lib/business-os/bookingStatus';
import {
  toBusinessLocalInput,
  fromBusinessLocalInput,
  safeTimezone,
  businessDateKey,
  businessInstant,
  shiftBusinessDateKey,
  endOfBusinessLocal,
  formatBusinessTime,
} from '@/lib/scheduling/businessTime';
import { windowsForDate, type TimeOffEntry } from '@/lib/scheduling/availabilityWindows';
import { closedDayVerdict, type ClosedDayVerdict } from '@/lib/scheduling/closedDay';
import { defaultServiceFor } from '@/lib/scheduling/defaultService';
import { JourneyGapNotice } from '@/components/business-os/setup/JourneyGapNotice';
/*
 * THE DIALOG AS A SEQUENCE OF QUESTIONS — see `BookingStep`.
 *
 * Every section below used to render open, always, in one scroll: the client
 * block alone is nearly five hundred lines and stayed expanded whether or not
 * anybody was choosing a client. The sections keep their own markup; only the
 * frame around them is new, so each one's history of fixes stays intact.
 */
import { BookingStep } from '@/components/scheduling/BookingStep';
import { BookingTimeStep } from '@/components/scheduling/BookingTimeStep';
import {
  planBookingSteps,
  bookingFooterSummary,
  type BookingStepKey,
} from '@/lib/scheduling/bookingSteps';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Clock, User, Mail, Phone, Calendar, FileText, CheckCircle, XCircle, AlertCircle, Search, X, Plus, Globe, Facebook, MessageCircle, Users as UsersIcon, Check, Trash2, CreditCard, Tag, ClipboardList, Loader2 } from 'lucide-react';
// The phone library is fetched after first paint, not with the page (PERF-2):
// see components/crm/usePhoneLib.ts. The stylesheet stays static so the
// cascade is unchanged.
import 'react-phone-number-input/style.css';
import { usePhoneLib } from '@/components/crm/usePhoneLib';
import { PhoneFieldPlaceholder } from '@/components/crm/PhoneFieldPlaceholder';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { NoShowConfirmDialog } from '@/components/scheduling/NoShowConfirmDialog';
import { CancelReasonDialog } from '@/components/scheduling/CancelReasonDialog';
import {
  useConfigurationDialogOptional,
  useConfigurationDialogOpen,
} from '@/components/business-os/ConfigurationDialogProvider';
import {
  businessCollectsIntake,
  intakeBlockReason,
  type IntakeBlockReason,
} from '@/lib/business-os/intakeReach';
import { createLogger } from '@/lib/logger';
import type { SchedulingBooking, SchedulingService } from '@/lib/repositories/SchedulingRepository';
import { journeySteps } from '@/lib/business-os/clientJourney';
import type { WeeklyAvailability } from './AvailabilityEditor';
import type { Country } from 'react-phone-number-input';

const logger = createLogger({ module: 'SchedulingBookingModal' });

interface CRMContact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  tags?: string[];
  source?: string | null;
}

interface PrefilledDateTime {
  date: Date;
  hour: number;
}

interface ExternalBusySlot {
  start: string;
  end: string;
  source: 'google_calendar' | 'outlook';
  is_all_day: boolean;
}

interface PrefilledContact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
}

interface SchedulingBookingModalProps {
  booking?: SchedulingBooking;
  /**
   * The SESSION being moved, when this dialog is open on one.
   *
   * A package's session has no booking of its own, so saving posts to
   * `/api/scheduling/meetings/[id]/reschedule` instead of putting a booking.
   * Absent for every ordinary booking.
   */
  rescheduleMeetingId?: string | null;
  /**
   * How long one session of this package runs.
   *
   * A package service keeps no `duration_minutes` of its own, so the length
   * comes from the quote that sold the sessions. Needed by the slot strip,
   * which otherwise asks for slots of zero minutes and finds none.
   */
  sessionMinutes?: number | null;
  services: SchedulingService[];
  isOpen: boolean;
  onClose: () => void;
  onBookingUpdated: () => void;
  availability?: WeeklyAvailability;
  /**
   * The business's timezone, not the browser's.
   *
   * Every time in this dialog is a wall clock, and a wall clock without a zone
   * is where three different answers for one appointment came from: the drawer
   * read the owner's laptop, the client's email read the booking row, and the
   * business kept a third. An owner checking their diary from abroad must see
   * the hours their clients will turn up at.
   *
   * Optional so a caller that has not been given one yet still renders; it
   * falls back to UTC rather than to the browser, because a wrong time that is
   * wrong the same way everywhere is the one you can find.
   */
  timezone?: string;
  prefilledDateTime?: PrefilledDateTime;
  prefilledContact?: PrefilledContact; // Skip contact search when provided
  /**
   * Whether the footer offers the booking's STATUS actions — mark held, mark
   * no-show, cancel, delete.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * They are the old way of recording what happened to a meeting, and the
   * journey in the contact drawer is the new one: the meeting stage carries
   * held / no-show / reschedule, and the card's footer carries Cancel.
   *
   * Opened to CHANGE A TIME, this modal is a date picker. Four status controls
   * in its footer offer an owner who came to move an appointment the chance to
   * mark it held instead — the same decisions, in a second place, under
   * different words, with none of the journey's guards around them.
   *
   * Still true where the modal IS the booking screen: opened from the header's
   * calendar button there is no journey underneath it, and these are the only
   * way to reach those actions. Hence a prop rather than a deletion.
   * ─────────────────────────────────────────────────────────────────────────
   */
  showStatusActions?: boolean;
  existingBookings?: SchedulingBooking[]; // For filtering out booked slots
  /**
   * The caller is still fetching the services.
   *
   * An empty list and a list that has not arrived look identical in a dropdown,
   * and the drawer opens this dialog immediately while six requests are still
   * in flight — so for a few seconds the picker offered nothing and gave no
   * reason. Saying which of the two it is costs one line and removes the only
   * thing about that wait that reads as broken.
   */
  servicesLoading?: boolean;
  /**
   * PICK A TIME AND HAND IT BACK, instead of writing a booking.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Adding a meeting to a running package needs everything this dialog knows —
   * the hours the service keeps, the days the owner closed, which slots are
   * already sold — and none of what it writes. A package's meeting is created
   * by `POST /api/scheduling/bookings/[id]/meetings`, which is what gives it a
   * `parent_booking_id`, an occurrence number, the container's service and
   * contact, and the charge decision. A booking written the ordinary way from
   * here would be a standalone appointment belonging to no purchase, and it
   * would not appear in the package's list at all.
   *
   * So the caller supplies this, and submit calls it with the chosen wall-clock
   * instants rather than posting. Throwing from it leaves the dialog open with
   * the message, exactly as a failed save does.
   * ───────────────────────────────────────────────────────────────────────────
   */
  onPickSlot?: (start: Date, end: Date) => Promise<void>;
  /** The service to open on and keep, where the caller has already decided it. */
  prefilledServiceId?: string;
  /**
   * The hour to open on, as the business's own wall clock (`YYYY-MM-DDTHH:MM`).
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Not `prefilledDateTime`, which carries a calendar CELL — a date and a whole
   * hour, because that is what a grid click means. A package's next meeting is
   * not on an hour boundary: it is a fortnight after the last one at 09:30, and
   * rounding that to 09:00 would offer an hour the series does not use.
   * ───────────────────────────────────────────────────────────────────────────
   */
  prefilledStartLocal?: string;
  /**
   * The dates THIS SERIES would fall on next, as business wall clocks.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The quick-pick chips offer the next six free slots from today, which is the
   * right answer when someone is booking an appointment and the wrong one when
   * they are adding a seventh session to a fortnightly course: today and
   * tomorrow are not candidates, and clicking one breaks the rhythm the client
   * is planning around.
   *
   * Given these, the chips become the series' own next dates instead. Absent
   * everywhere else, and the generic slots are offered exactly as before.
   * ───────────────────────────────────────────────────────────────────────────
   */
  seriesSlots?: string[];
  /**
   * One more yes/no the caller needs answered beside the date.
   *
   * Used for "bill this meeting like the others", which only a package can ask
   * and only this dialog is in a position to ask at the same moment as the
   * date. Absent everywhere else, and nothing renders.
   */
  extraToggle?: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    /**
     * Draw the eye to it, because missing it costs money.
     *
     * On a package billed per session every other session is charged, so an
     * unticked box means "give this one away" — a decision, not a default.
     * It was missed, and the only way back was to cancel the session and add
     * it again, which the client sees as two emails about one hour.
     *
     * Settles the moment it is touched: an attention cue that keeps pulsing
     * after it has been read is just noise.
     */
    attention?: boolean;
  };
}

// Source options for new clients (use existing CRM source keys)
const SOURCE_OPTIONS = [
  { value: 'google', labelKey: 'crm.source.google', icon: Search },
  { value: 'facebook', labelKey: 'crm.source.facebook', icon: Facebook },
  { value: 'instagram', labelKey: 'crm.source.instagram', icon: MessageCircle },
  { value: 'website', labelKey: 'crm.source.website', icon: Globe },
  { value: 'referral', labelKey: 'crm.source.referral', icon: UsersIcon },
  { value: 'phone_call', labelKey: 'crm.source.phone_call', icon: Phone },
  { value: 'in_person', labelKey: 'crm.source.in_person', icon: User }
];

// Scheduling theme color: Teal
const SCHEDULING_COLOR = '#14B8A6';

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  confirmed: { bg: 'bg-[#14B8A6]/10', text: 'text-[#0D9488] dark:text-[#5EEAD4]', border: 'border-[#14B8A6]/30' },
  cancelled: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/30' },
  completed: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30' },
  no_show: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30' },
  pending: { bg: 'bg-[var(--v2-border)]/30', text: 'text-[var(--v2-text-secondary)]', border: 'border-[var(--v2-border)]' }
};

// Day name mapping for WeeklyAvailability keys
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

// Format a Date to local datetime-local input format (YYYY-MM-DDTHH:MM)
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUSINESS'S CLOCK, NOT THE MACHINE'S.
 *
 * This used `getFullYear`/`getHours`, which read the BROWSER's zone. A booking
 * stored at 04:00Z therefore showed as 12:00 AM on a laptop in Toronto, 7:00 AM
 * in Tel Aviv, and 4:00 AM in the client's email — one appointment, three
 * answers, and the owner had no way to tell which one the client would keep.
 *
 * Worse than the display: `new Date("2026-09-21T12:00")` parses in the runtime
 * zone too, so an owner typing 12:00 while travelling SAVED a different instant
 * than the same owner typing 12:00 at home.
 *
 * Both directions now go through `businessTime`, which measures the zone's
 * offset on that particular date — so a booking either side of a daylight
 * saving change is still correct.
 */
function formatDateTimeLocal(date: Date, timezone: string): string {
  return toBusinessLocalInput(date, timezone);
}

/** A wall clock the owner typed, as the instant the business means by it. */
function parseDateTimeLocal(local: string, timezone: string): Date {
  return fromBusinessLocalInput(local, timezone);
}

// Get default times based on user availability

/**
 * The opening window for a given day.
 *
 * The weekday is the business's, not the browser's. `date.getDay()` answered
 * for the reader, so the hours shown beneath the date field could belong to the
 * neighbouring day whenever the two zones straddle midnight.
 */
function getAvailabilityForDay(
  date: Date,
  availability?: WeeklyAvailability,
  timezone: string = 'UTC'
): { start: string; end: string } | null {
  if (!availability) return null;
  const dayKey = DAY_KEYS[new Date(`${businessDateKey(date, timezone)}T00:00:00Z`).getUTCDay()];
  const slots = availability[dayKey];
  if (slots && slots.length > 0) {
    return slots[0];
  }
  return null;
}

// Format time for display (e.g., "9:00 AM")
function formatTimeDisplay(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  const period = hours < 12 ? 'AM' : 'PM';
  return `${h}:${m} ${period}`;
}

// Locale map for date formatting
const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  he: 'he-IL'
};

/**
 * Format date for display (e.g., "Mon, Jan 15").
 *
 * The zone matters for the WEEKDAY as much as the hour: a Monday evening
 * appointment in New York is already Tuesday in Jerusalem. Getting the hour
 * right and the weekday wrong is the worse failure, because it looks correct.
 */
function formatDateShort(date: Date, language: string = 'en', timezone?: string): string {
  const locale = LOCALE_MAP[language] || 'en-US';
  return date.toLocaleDateString(locale, {
    ...(timezone ? { timeZone: timezone } : {}),
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

// Interface for quick pick slots
interface QuickPickSlot {
  dayOffset: number; // 0 = today, 1 = tomorrow, etc.
  start: Date;
  end: Date;
}

// Check if a time slot overlaps with any existing booking
function isSlotBooked(
  slotStart: Date,
  slotEnd: Date,
  existingBookings: SchedulingBooking[],
  excludeBookingId?: string // Exclude this booking (when editing)
): boolean {
  return existingBookings.some(booking => {
    // Exclude the booking being edited
    if (excludeBookingId && booking.id === excludeBookingId) return false;

    // Skip cancelled and no_show bookings - those time slots are available
    /* See `holdsSlot`: a missed or called-off meeting frees its time even
       though the job's status is untouched. */
    if (!holdsSlot(booking)) return false;

    const bookingStart = new Date(booking.start_time);
    const bookingEnd = new Date(booking.end_time);

    // Check for overlap: slot_start < booking_end AND slot_end > booking_start
    return slotStart < bookingEnd && slotEnd > bookingStart;
  });
}

// Check if a time slot overlaps with any external busy slot
function isSlotBlockedByExternal(
  slotStart: Date,
  slotEnd: Date,
  externalBusySlots: ExternalBusySlot[]
): boolean {
  return externalBusySlots.some(busySlot => {
    const busyStart = new Date(busySlot.start);
    const busyEnd = new Date(busySlot.end);

    // Check for overlap: slot_start < busy_end AND slot_end > busy_start
    return slotStart < busyEnd && slotEnd > busyStart;
  });
}

// Generate next available slots based on availability
export function getNextAvailableSlots(
  availability: WeeklyAvailability | undefined,
  serviceDurationMinutes: number,
  timezone: string,
  maxSlots: number = 6,
  existingBookings: SchedulingBooking[] = [],
  externalBusySlots: ExternalBusySlot[] = [],
  /**
   * The days the business is closed, and the days it is open for less than
   * usual.
   *
   * Last and defaulted, so a caller that has not loaded them yet gets the
   * weekly pattern rather than nothing — and a suggested time is then checked
   * again on the server, which is what makes the omission recoverable.
   */
  timeOff: TimeOffEntry[] = []
): QuickPickSlot[] {
  if (!availability) return [];

  const slots: QuickPickSlot[] = [];
  const zone = safeTimezone(timezone);
  const now = new Date();
  /*
   * WHICH DAY IT IS WHERE THE WORK HAPPENS.
   *
   * At 9pm in New York it is already tomorrow in Tel Aviv, so a browser-local
   * date had the builder offering one day's hours against another day's date.
   * Every date below is stepped from this key, on the business's own calendar.
   */
  const todayKey = businessDateKey(now, zone);

  // Look ahead up to 14 days
  for (let dayOffset = 0; dayOffset < 14 && slots.length < maxSlots; dayOffset++) {
    // The business's calendar date for this offset, as a key the slot builder
    // below turns into instants. `setDate` on a browser Date would reintroduce
    // the browser's clock.
    const dateKey = shiftBusinessDateKey(todayKey, dayOffset);

    /*
     * This date's REAL hours, not its weekday's.
     *
     * `availability[dayKey]` offered times on days the owner had closed —
     * a holiday, a fortnight away — because the weekly pattern knows nothing
     * about dates. `windowsForDate` applies the closures the same way the
     * public booking page does, so the owner is never offered a slot a client
     * could not have been offered either.
     */
    const daySlots = windowsForDate(availability, dateKey, timeOff);

    if (daySlots.length === 0) continue;

    for (const slot of daySlots) {
      if (slots.length >= maxSlots) break;

      const [startHour, startMinute] = slot.start.split(':').map(Number);
      const [endHour, endMinute] = slot.end.split(':').map(Number);

      /*
       * The window's hours are the BUSINESS's, so they are built on its clock.
       *
       * `setHours` wrote the browser's: a window stored as 09:00-17:00 became
       * 9am wherever the laptop was, and the dialog offered a client hours the
       * business is closed for.
       */
      let currentStart = businessInstant(dateKey, slot.start, zone);
      const slotEnd = businessInstant(dateKey, slot.end, zone);

      // If it's today, start from current time (rounded up to next 30 min)
      if (dayOffset === 0) {
        /*
         * Now, rounded up to the next half hour.
         *
         * Done on the epoch rather than with `setMinutes`, which reads and
         * writes the BROWSER's clock — and whose `setMinutes(60)` rollover also
         * quietly moved the date near midnight. Rounding an instant to a
         * 30-minute boundary needs no zone at all.
         */
        const HALF_HOUR = 30 * 60 * 1000;
        const roundedNow = new Date(Math.ceil(now.getTime() / HALF_HOUR) * HALF_HOUR);

        if (roundedNow > currentStart) {
          currentStart = roundedNow;
        }
      }

      // Generate slots at 30-minute intervals
      while (slots.length < maxSlots) {
        const potentialEnd = new Date(currentStart.getTime() + serviceDurationMinutes * 60 * 1000);

        // Check if this slot fits within availability
        if (potentialEnd > slotEnd) break;

        // Check if this slot is already booked or blocked by external calendar
        if (!isSlotBooked(currentStart, potentialEnd, existingBookings) &&
            !isSlotBlockedByExternal(currentStart, potentialEnd, externalBusySlots)) {
          slots.push({
            dayOffset,
            start: new Date(currentStart),
            end: new Date(potentialEnd)
          });
        }

        // Move to next 30-minute slot
        currentStart = new Date(currentStart.getTime() + 30 * 60 * 1000);
      }
    }
  }

  return slots;
}

export function SchedulingBookingModal({
  booking,
  rescheduleMeetingId,
  sessionMinutes,
  services,
  servicesLoading = false,
  isOpen,
  onClose,
  onBookingUpdated,
  availability,
  prefilledDateTime,
  prefilledContact,
  onPickSlot,
  prefilledServiceId,
  prefilledStartLocal,
  seriesSlots,
  extraToggle,
  showStatusActions = true,
  existingBookings = [],
  timezone
}: SchedulingBookingModalProps) {
  /*
   * One zone for the whole dialog, resolved once.
   *
   * `safeTimezone` rather than the raw prop: a stored zone can be an old IANA
   * name or a hand-edited row, and `Intl` throws on those. A booking dialog
   * must not fail to open over a display detail.
   */
  const zone = safeTimezone(timezone);

  /**
   * Has the caller resolved the business zone yet?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `zone` is `UTC` both when the business really is on UTC and when the
   * parent's fetch has not landed — the placeholder is indistinguishable from
   * an answer. For DISPLAY that does not matter; a label corrects itself a
   * moment later.
   *
   * It matters for the slot builders, which use the zone to decide WHICH DAY IS
   * TODAY and then label their chips "Today" and "Tomorrow" from that. At 9pm in
   * New York it is already the next day in UTC, so a placeholder run offered a
   * chip reading "Today" whose real date was tomorrow — and the form, filled
   * from that first result, kept the wrong day even after the zone arrived.
   *
   * An absent prop is the signal. Callers pass `undefined` until they know, so
   * a business genuinely on UTC is not mistaken for one still loading.
   */
  const zoneReady = timezone !== undefined;

  const { t, language } = useLanguage();
  /*
   * Lets the intake warning below open Settings on the intake tab, and re-ask
   * whether the form is published once the owner closes it.
   *
   * OPTIONAL, because this modal also renders on the V1 `/scheduling` page,
   * which has no ConfigurationDialogProvider above it. The throwing hook would
   * take that whole page down to offer a shortcut; here the shortcut simply
   * does not appear, and the message beside it still names where to go.
   */
  const configurationDialog = useConfigurationDialogOptional();
  /*
   * The provider's answer, which covers a dialog opened by anything — not only
   * by the link below. It carries its own grace period past the close, so the
   * dismissal still in flight at that moment is caught.
   *
   * OR'd with the local flag because this modal also renders on the V1
   * `/scheduling` page, where there is no provider and the local one is all
   * there is.
   */
  const configurationOpen = useConfigurationDialogOpen();

  /**
   * Where the owner happens to be sitting. FOR DISPLAY ONLY.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Every time in this dialog is counted on the BUSINESS's zone, wherever in the
   * world the owner is. This is used for one thing: telling them what their own
   * clock says, underneath a field they are typing New York hours into. It never
   * reaches a calculation and never reaches the payload.
   *
   * Resolved in an effect rather than inline, because `Intl` answers differently
   * on the server and in the browser — read during render it is a hydration
   * mismatch, which is what the `typeof window` guard here used to paper over.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [viewerZone, setViewerZone] = useState<string | null>(null);

  useEffect(() => {
    setViewerZone(safeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, []);

  /** Only worth saying when the two clocks actually differ. */
  const showsViewerTime = zoneReady && !!viewerZone && viewerZone !== zone;

  /**
   * A field's business wall clock, as the owner's own clock reads it.
   *
   * The same instant, said twice. Built from the two helpers the rest of the
   * dialog uses, so this cannot drift from what gets saved: the typed string is
   * resolved on the BUSINESS's clock and then only FORMATTED on the viewer's.
   * Null for a half-typed field, so nothing flickers while they type.
   */
  const viewerTimeFor = (local: string): string | null => {
    if (!showsViewerTime || !local || !viewerZone) return null;
    const instant = fromBusinessLocalInput(local, zone);
    if (Number.isNaN(instant.getTime())) return null;
    return formatBusinessTime(instant, viewerZone, language === 'he' ? 'he-IL' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      // The day too: seven hours out is often a different date on their clock.
      day: 'numeric',
      month: 'short',
    });
  };

  const [formData, setFormData] = useState({
    service_id: '',
    contact_id: '' as string | null,
    client_first_name: '',
    client_last_name: '',
    client_email: '',
    client_phone: '',
    start_time: '',
    end_time: '',
    notes: '',
    status: 'confirmed' as BookingStatus
  });
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Why a delete didn't happen, shown inside the confirmation strip itself.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Client search state
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<CRMContact[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showClientSearch, setShowClientSearch] = useState(true);
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // New client CRM fields
  const [newClientTags, setNewClientTags] = useState<string[]>([]);
  const [newClientSource, setNewClientSource] = useState<string>('');
  const [newClientNotes, setNewClientNotes] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  /*
   * Seeded from the client's own number rather than hardcoded to US — the same
   * fault the CRM screens carried: a business outside the US opened every
   * booking on the wrong country, and the calling code it applied belonged
   * somewhere else. See `components/crm/phoneField.ts`.
   */
  const phoneLib = usePhoneLib();
  /*
   * The number the starting country is read from: `formData.client_phone` as it was
   * at mount, exactly what the initialiser read before. Held as a plain string
   * because the reading itself needs the phone library, which may still be
   * arriving at mount (PERF-2). Until the owner picks a country, the field's
   * country is `phoneFieldCountry(phoneSeed)`, the same answer as before.
   */
  const [phoneSeed] = useState(() => formData.client_phone);
  const [chosenPhoneCountry, setPhoneCountry] = useState<Country | undefined>(undefined);
  const phoneCountry: Country | undefined =
    chosenPhoneCountry ?? phoneLib?.phoneFieldCountry(phoneSeed);
  const [sendIntakeForm, setSendIntakeForm] = useState(false);

  /*
   * Which step the owner reopened, if any — see `planBookingSteps`. Null means
   * "whichever is next", which is what an empty dialog wants.
   */
  const [openedStep, setOpenedStep] = useState<BookingStepKey | null>(null);


  /*
   * The last set of DEFAULTS the initialising effect wrote, and the form as it
   * stands — the pair that lets a re-run tell "nobody has touched this" from
   * "the owner is halfway through filling it in". See the effect itself.
   *
   * Refs rather than deps on purpose: the form cannot be a dependency of the
   * effect that writes it, and the defaults are a comparison, not a trigger.
   */
  const lastDefaultsRef = useRef<typeof formData | null>(null);
  const formRef = useRef(formData);
  formRef.current = formData;

  /*
   * Whether the dialog was open on the previous run of the initialising
   * effect, so it can tell "the owner just opened me" from "some data
   * arrived". Every caller keeps this component mounted and toggles `isOpen`,
   * which is why opening is not the same event as mounting.
   */
  const wasOpenRef = useRef(false);


  // Intake form configuration status
  const [intakeConfigured, setIntakeConfigured] = useState<boolean | null>(null); // null = loading
  /**
   * WHY it cannot be sent, when it cannot.
   *
   * "Set up an intake form" was the only thing this could say, and it is the
   * wrong sentence for the state most businesses are actually in: a form that
   * exists, was written for them, and has not been published yet. Being sent to
   * create something they already have is how it stays unpublished.
   */
  const [intakeBlock, setIntakeBlock] = useState<IntakeBlockReason | null>(null);

  // External calendar busy slots
  const [externalBusySlots, setExternalBusySlots] = useState<ExternalBusySlot[]>([]);

  /*
   * The days the business is closed, and the days it is open for less than
   * usual.
   *
   * The owner closed 7 October and this dialog, knowing only the weekly
   * pattern, offered the day and booked a client into it: a confirmation email
   * naming a day the business was shut, and a reminder the morning of.
   */
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);

  /**
   * A closed day the SERVER refused, when this dialog did not know about it.
   *
   * The list above is fetched when the dialog opens, so a dialog left open
   * across the owner recording a holiday — or one whose fetch failed — can
   * still send a closed-day booking. The 409 carries the same three facts the
   * local verdict has, so it drives the same warning and the same button, in
   * the owner's own language rather than the server's English sentence.
   */
  const [serverClosedDay, setServerClosedDay] = useState<
    { kind: 'all_day' | 'short_day'; date: string; reason: string | null; hours: { start: string; end: string } | null } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/scheduling/time-off');
        const data = await response.json();
        if (!cancelled && data?.success && Array.isArray(data.data)) {
          setTimeOff(data.data as TimeOffEntry[]);
        }
      } catch {
        /*
         * An unreadable list leaves the dialog where it was before this
         * existed. It is not the last line of defence: the server checks the
         * day too and refuses with `closed_day`, which this dialog turns into
         * the same question below.
         */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Does the time currently in the form collide with something already booked?
   *
   * Uses the same predicate as the quick-pick row, so the warning and the
   * offered slots can never disagree. The booking being edited is excluded —
   * its own slot is not a conflict with itself.
   */
  /**
   * Is the time in the form on a day the owner closed?
   *
   * Read straight off the input's own text: a `datetime-local` value IS the
   * business's wall clock here (`formatDateTimeLocal(date, zone)` wrote it), so
   * `slice` gives the date and the hour with no conversion to get wrong — the
   * class of bug this file is full of notes about.
   *
   * A WARNING, not a block. Seeing one client during a holiday is a real thing
   * a business does; doing it by accident is not. Confirming sends
   * `allow_closed_day` and the server then permits exactly this booking.
   */
  const closedDay = ((): ClosedDayVerdict => {
    const start = formData.start_time;
    const end = formData.end_time;

    /*
     * The server's refusal wins while it still describes the time in the form.
     * Once the owner moves to another day it is stale and the local rule
     * answers again — which is why it is compared against the date rather than
     * simply cleared on every edit.
     */
    if (serverClosedDay && start.slice(0, 10) === serverClosedDay.date) {
      return serverClosedDay.kind === 'short_day' && serverClosedDay.hours
        ? { closed: true, kind: 'short_day', reason: serverClosedDay.reason, hours: serverClosedDay.hours }
        : { closed: true, kind: 'all_day', reason: serverClosedDay.reason };
    }

    if (!start || start.length < 16) return { closed: false } as const;

    // No end yet: ask only whether the DATE is closed. Passing the start as the
    // end would be a zero-length slot, which no short day contains — so a short
    // day would read as closed while the owner was still filling the form.
    if (!end || end.length < 16) return closedDayVerdict(timeOff, start.slice(0, 10));

    return closedDayVerdict(timeOff, start.slice(0, 10), {
      start: start.slice(11, 16),
      end: end.slice(11, 16),
    });
  })();

  const timeAlreadyBooked = (() => {
    if (!formData.start_time || !formData.end_time) return false;
    const start = parseDateTimeLocal(formData.start_time, zone);
    // Same clock as the start — see the note in the validator below. Read in
    // the browser's zone, this checked a New York start against an Israeli end,
    // so the overlap question was about a slot nobody had proposed.
    const end = parseDateTimeLocal(formData.end_time, zone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    return isSlotBooked(start, end, existingBookings, booking?.id);
  })();

  /*
   * The dialog no longer fetches a zone of its own.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * It used to open on the browser's zone and then race a `/api/user/profile`
   * fetch to correct it — and that route reads `profiles.timezone`, the OTHER of
   * the platform's two timezone columns, which its own comment records as having
   * drifted from `user_preferences` on live accounts. So this dialog could be
   * counting hours on a different clock from the booking routes, the
   * availability API and every client-facing email.
   *
   * The zone arrives as a prop instead, and all three callers take it from
   * `/api/scheduling/availability`, which reads `user_preferences.timezone` —
   * the authority. One clock, resolved once, by whoever already knew it.
   * ───────────────────────────────────────────────────────────────────────────
   */

  /*
   * Intake status, as a callable rather than a body inside the effect.
   *
   * The owner can now publish the form from inside this dialog, and when they
   * come back the toggle has to stop saying the form is unpublished. That means
   * asking again at a moment that is not "the dialog opened", so the question
   * had to become something we can re-ask.
   */
  const refreshIntakeSettings = useCallback(async () => {
      try {
        const response = await fetch('/api/intake/settings');
        if (response.ok) {
          const data = await response.json();
          /*
           * The shared predicate, not a third opinion.
           *
           * This asked for `template_id` and `collect_during_booking` — one
           * pointing at a catalogue that no longer exists, the other a flag the
           * settings API had already stopped returning. Both read as undefined,
           * so the toggle was permanently disabled and told every business to
           * go and configure the form it had just written.
           *
           * `businessCollectsIntake` is the OWNER's question — can I send this
           * myself — which is exactly what this toggle does.
           */
          const settings = data.settings;
          setIntakeConfigured(businessCollectsIntake(settings));
          setIntakeBlock(intakeBlockReason(settings));
        } else {
          setIntakeConfigured(false);
          setIntakeBlock(null);
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to fetch intake settings');
        setIntakeConfigured(false);
      }
  }, []);

  // Fetch intake configuration status
  useEffect(() => {
    if (!isOpen) return;
    void refreshIntakeSettings();
  }, [isOpen, refreshIntakeSettings]);

  useEffect(() => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * A DIALOG THAT OPENS IS A DIALOG THAT STARTS AGAIN.
     *
     * Every caller keeps this component MOUNTED and toggles `isOpen`, so
     * closing it does not unmount anything: the form state survives. And
     * `isOpen` was not among this effect's dependencies, so reopening did not
     * re-run it either. An owner who half-filled a booking, thought better of
     * it and closed the dialog found all of it still there the next time —
     * sometimes against a different client, since the drawer reuses the same
     * instance.
     *
     * The comment here used to say "when modal opens/closes", which is what it
     * was for and not what it did.
     *
     * `justOpened` also overrides the edited-since guard below. That guard
     * exists so late-arriving services cannot wipe a form being filled in;
     * a fresh open is the opposite case, and the one time wiping is right.
     * ───────────────────────────────────────────────────────────────────────
     */
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;

    /* Nothing to initialise while it is shut, and nothing to clear either —
       the next open does both. */
    if (!isOpen) return;

    // Clear form errors when the modal opens or the booking changes
    setFormErrors({});
    setDeleteError(null);
    setShowDeleteConfirm(false);

    /*
     * And which step is open, which is the same kind of state.
     *
     * Reopening the service step on one booking and then opening the dialog on
     * ANOTHER would leave that one showing step 1 expanded — asking a question
     * about a different appointment. Same for the typed-time fields.
     */
    setOpenedStep(null);

    if (booking) {
      // Use formatDateTimeLocal to convert UTC times to local datetime-local format
      setFormData({
        service_id: booking.service_id,
        contact_id: booking.contact_id || null,
        /* Both are nullable on the row and neither is on the form: a booking
           taken with only a phone number has no name and no email, and the
           inputs hold '' for "not given". */
        client_first_name: booking.client_first_name ?? '',
        client_last_name: booking.client_last_name || '',
        client_email: booking.client_email ?? '',
        client_phone: booking.client_phone || '',
        start_time: formatDateTimeLocal(new Date(booking.start_time), zone),
        end_time: formatDateTimeLocal(new Date(booking.end_time), zone),
        notes: booking.notes || '',
        status: booking.status
      });
      setShowClientSearch(false); // Hide search when editing
      /*
       * Off every time the modal opens, deliberately.
       *
       * This is a "send it now" ACTION taken on save, not a property of the
       * booking — leaving it on would email the client again on every
       * subsequent edit. It reads as a toggle that forgot itself, so the
       * description beside it now says it resets.
       */
      setSendIntakeForm(false);
    } else {
      /*
       * ───────────────────────────────────────────────────────────────────
       * A RE-RUN MAY ONLY REPLACE DEFAULTS NOBODY HAS CHANGED.
       *
       * This effect lists `services` and `availability` among its deps, and
       * both arrive AFTER the dialog opens: the CRM drawer fires six requests
       * when it opens and the modal can be up before they land. Each arrival
       * is a new array identity, so the effect re-ran and performed a full
       * reset — which is the reported fault. Picking a service and watching it
       * snap back to the default, or typing a client's email and losing it,
       * were the same bug: late data resetting a form being filled in.
       *
       * The deps are still right. What was wrong is that a re-run overwrote
       * the owner's own answers as well as the defaults, so a re-run now
       * happens only while the form still holds exactly what this effect last
       * wrote. One changed character and late data is ignored.
       * ───────────────────────────────────────────────────────────────────
       */
      const written = lastDefaultsRef.current;
      const edited =
        !justOpened &&
        written !== null &&
        (Object.keys(written) as Array<keyof typeof written>).some(
          key => formRef.current[key] !== written[key]
        );

      if (edited) return;

      /*
       * ONLY a service the caller named — see `defaultServiceFor`.
       *
       * This was `activeServices[0]`, the first row of an alphabetical list,
       * and that is a guess presented as an answer. It was at least a visible
       * guess while the picker was expanded; collapsed to a summary line it
       * reads as a decision the owner made, carrying a price and a duration
       * belonging to whichever service sorted first.
       *
       * With none named the field stays empty, Save stays disabled, and step 1
       * asks the question — which is what it is for.
       */
      const defaultService = defaultServiceFor(services, prefilledServiceId);
      /* 60 only to size the DEFAULT end time while no service is chosen. The
         real duration arrives with the choice, via `handleServiceChange`. */
      const serviceDuration = defaultService?.duration_minutes || 60;

      let startTime: string;
      let endTime: string;

      /*
       * The caller's own hour, where it named one — see `prefilledStartLocal`.
       * Asked first: it is the most specific thing anyone has said about when
       * this booking should be.
       */
      if (prefilledStartLocal) {
        startTime = prefilledStartLocal;
        endTime = formatDateTimeLocal(
          new Date(parseDateTimeLocal(prefilledStartLocal, zone).getTime() + serviceDuration * 60 * 1000),
          zone
        );
      } else if (prefilledDateTime) {
        /*
         * The calendar cell the owner clicked, as the instant it means.
         *
         * `prefilledDateTime.hour` is the GRID's hour, and the grid's hours are
         * the business's — they come from its availability. `setHours` wrote
         * that number onto the browser's clock, so clicking the 2pm cell from
         * another zone created a booking at 2pm there. The date is read off the
         * cell's calendar fields, which are the day it stands for; its instant
         * is a browser-local midnight and is not.
         */
        const cell = prefilledDateTime.date;
        const cellKey = `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, '0')}-${String(cell.getDate()).padStart(2, '0')}`;
        const startDate = businessInstant(cellKey, `${String(prefilledDateTime.hour).padStart(2, '0')}:00`, zone);
        const endDate = new Date(startDate.getTime() + serviceDuration * 60 * 1000);
        // Format as local time for datetime-local input (YYYY-MM-DDTHH:MM)
        startTime = formatDateTimeLocal(startDate, zone);
        endTime = formatDateTimeLocal(endDate, zone);
      } else if (!needsSchedule) {
        /*
         * Nothing to ask and nothing to seed: a product has no date step at
         * all, so the fields stay empty rather than carrying an hour the
         * journey never reaches.
         */
        startTime = '';
        endTime = '';
      } else {
        /*
         * NO HOUR UNTIL SOMEBODY CHOOSES ONE.
         *
         * ───────────────────────────────────────────────────────────────────
         * This filled the field with the next free slot, and that default was
         * doing real damage once the steps collapse: an answered step shows a
         * line instead of a form, so the owner was handed "Monday 19 Oct ·
         * 11:30" as a decision they had supposedly made, with the grid that
         * would have explained it closed behind it.
         *
         * Two things were invisible as a result, and both are machinery rather
         * than advice: a meeting less than 24 hours out never gets its 24-hour
         * reminder, and a client form emailed on confirmation has only the
         * hours until the meeting to come back. Those warnings live in the
         * hour step, so an hour nobody opened is an hour booked without them.
         *
         * The suggestion itself is not lost — it is the top-ranked slot in the
         * grid, where it reads as an offer and carries what it costs.
         *
         * A caller that genuinely names an hour (a clicked calendar cell, a
         * package's next date) is handled above and keeps its value.
         * ───────────────────────────────────────────────────────────────────
         */
        startTime = '';
        endTime = '';
      }

      // If prefilled contact provided, use it
      if (prefilledContact) {
        const defaults = {
          service_id: defaultService?.id || '',
          contact_id: prefilledContact.id,
          client_first_name: prefilledContact.first_name,
          client_last_name: prefilledContact.last_name || '',
          client_email: prefilledContact.email,
          client_phone: prefilledContact.phone || '',
          start_time: startTime,
          end_time: endTime,
          notes: '',
          status: 'confirmed' as const
        };
        lastDefaultsRef.current = defaults;
        setFormData(defaults);
        setShowClientSearch(false); // Hide search when contact is prefilled
        setSelectedContact({
          id: prefilledContact.id,
          first_name: prefilledContact.first_name,
          last_name: prefilledContact.last_name,
          email: prefilledContact.email,
          phone: prefilledContact.phone
        });
      } else {
        const defaults = {
          service_id: defaultService?.id || '',
          contact_id: null,
          client_first_name: '',
          client_last_name: '',
          client_email: '',
          client_phone: '',
          start_time: startTime,
          end_time: endTime,
          notes: '',
          status: 'confirmed' as const
        };
        lastDefaultsRef.current = defaults;
        setFormData(defaults);
        setShowClientSearch(true);
        setSelectedContact(null);
      }
      setClientSearchQuery('');
      setClientSearchResults([]);
      // Reset new client CRM fields
      setNewClientTags([]);
      setNewClientSource('');
      setNewClientNotes('');
      setNewTagInput('');
    }
    /*
     * `zone` and `zoneReady` belong here.
     *
     * The default start time is computed from the zone — which day is today,
     * which of today's hours are still ahead — and the zone arrives a moment
     * after the modal opens. Without them in the deps this effect ran once
     * against the UTC placeholder and never again, so the inputs kept a default
     * derived from the wrong day while the quick-pick chips beside them, which
     * re-render freely, corrected themselves. The two then disagreed on screen.
     *
     * Re-running is safe: it only replaces the DEFAULT, and the zone resolves
     * once, immediately after open, well before anyone has typed.
     */
  }, [isOpen, booking, services, availability, prefilledDateTime, prefilledContact, prefilledServiceId, prefilledStartLocal, zone, zoneReady]);

  /*
   * Does THIS service's client journey include picking a time?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Asked of `journeySteps`, the resolver the public booking dialog, the smart
   * link and the wizard already answer with — not re-derived here. The answer
   * is not `is_scheduled` alone: a quoted service that involves a consultation
   * books a time, and a product does not, so four facts decide it and they are
   * decided in one place.
   *
   * Why it matters on THIS dialog: an ADHD course is bought, not booked into an
   * hour. Its client journey has no scheduling step and no client was ever
   * shown a picker for it — yet the owner opening the same course from the CRM
   * drawer was made to choose a date and time, and could not save without one.
   *
   * Defaults to TRUE while no service is chosen, or if the resolver cannot
   * answer. Showing the time fields for something that turns out not to need
   * them is a question too many; hiding them for something that does silently
   * books an appointment at no particular time.
   *
   * `processorReady` is left at its default because only the PAYMENT step reads
   * it, and the one question asked here is about the date.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const selectedService = services.find(s => s.id === formData.service_id);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * EXCEPT WHEN THE THING BEING TIMED IS A SESSION, NOT THE PURCHASE.
   *
   * The rule above asks the SERVICE's client journey, and for a package that
   * answer is correctly "no time": an ADHD course is bought, not booked into an
   * hour, and `is_scheduled` is false on it.
   *
   * But a package's SESSIONS each have an hour, and this dialog is how both of
   * them are chosen. Asked of the service alone it hid the picker in exactly
   * the two places whose only job is to pick a time:
   *
   *   · moving one session — the dialog opened with no time fields at all, so
   *     there was nothing to change;
   *   · adding a seventh session — same, on a flow whose entire purpose is to
   *     name an hour.
   *
   * Both say so when they open this dialog, so neither has to be inferred from
   * the service: `rescheduleMeetingId` names the session being moved, and
   * `onPickSlot` means the caller wants an hour and nothing else. Either one
   * makes the question "does this need a time" already answered — yes.
   *
   * The purchase itself is untouched: opening the course from the drawer still
   * asks for no date, which is the bug the rule above exists for.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const timingAMeeting = Boolean(rescheduleMeetingId) || Boolean(onPickSlot);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * HOW LONG A SESSION RUNS, WHEN THE SERVICE CANNOT SAY.
   *
   * Every free slot is built from a duration, and a package service keeps
   * none: it is bought rather than booked into an hour, so `duration_minutes`
   * is null on it. The picker therefore opened and reported a week with no
   * free hours in it — not "this week is full", but zero-minute slots, of
   * which there are never any.
   *
   * The session itself knows. A move has the hour it is moving, and an added
   * one is told by the caller what the package's sessions run for.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const sessionLengthMinutes =
    sessionMinutes ??
    (rescheduleMeetingId && booking?.start_time && booking?.end_time
      ? Math.max(
          5,
          Math.round(
            (new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime()) / 60_000
          )
        )
      : undefined);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * AND NOTHING ELSE ON THE DIALOG IS EDITABLE WHILE ONE IS BEING TIMED.
   *
   * Every step carries a "change" link, which is right when this dialog is
   * editing a booking: the service, the client and the notes are all its own.
   *
   * They are not this session's. A package's service and client belong to the
   * PURCHASE and are shared by all six sessions, and the one thing being asked
   * for here is an hour. Worse than untidy: the link worked. An owner could
   * reopen the client step, change it, press save, and the move endpoint —
   * which reads a start and an end and nothing else — would write the new time
   * and silently discard the rest. A control that appears to work and does
   * nothing is the kind of thing nobody reports, they just stop trusting the
   * screen.
   *
   * The time step keeps its link, being the only thing a move can change.
   * ───────────────────────────────────────────────────────────────────────────
   */

  const needsSchedule =
    timingAMeeting ||
    (selectedService ? journeySteps(selectedService).includes('datetime') : true);

  /*
   * Late-loading services: resolve the one the CALLER named, nothing else.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The dialog can be open before its services arrive — the CRM drawer fires
   * six requests when it opens, and "new session" does not wait for them. A
   * caller that named a service needs that name resolved once the list lands.
   *
   * It must NOT fill in a default of its own. This read `activeServices[0]`
   * when nothing was named, so it was the second writer of the same guess: the
   * owner would see the picker empty, then watch the first service appear in
   * it a moment later, with no idea which of the two was the answer. Both
   * places now ask `defaultServiceFor`, which answers only where the caller
   * did.
   *
   * Still guarded on an empty `service_id`, which is what makes it safe to
   * re-run: a service the owner chose is never replaced.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    if (!booking && !formData.service_id && services.length > 0) {
      const defaultService = defaultServiceFor(services, prefilledServiceId);
      if (defaultService) {
        const serviceDuration = defaultService.duration_minutes || 60;
        // Update service_id and recalculate end time based on service duration
        setFormData(prev => {
          const startDate = prev.start_time ? new Date(prev.start_time) : new Date();
          const endDate = new Date(startDate.getTime() + serviceDuration * 60 * 1000);
          return {
            ...prev,
            service_id: defaultService.id,
            end_time: formatDateTimeLocal(endDate, zone)
          };
        });
      }
    }
  }, [booking, services, formData.service_id, prefilledServiceId, zone]);

  // Fetch external calendar busy slots
  useEffect(() => {
    const fetchExternalBusySlots = async () => {
      try {
        // Fetch busy slots for the next 30 days
        const now = new Date();
        const start = now.toISOString();
        const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const response = await fetch(
          `/api/scheduling/calendar-sync/busy-slots?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
        );
        const data = await response.json();

        if (data.success && data.busy_slots) {
          setExternalBusySlots(data.busy_slots);
        }
      } catch (err) {
        // Optional overlay: the dialog is usable without it, so this is noted
        // rather than surfaced.
        logger.debug({ err }, 'External busy slots could not be fetched');
      }
    };

    if (isOpen) {
      fetchExternalBusySlots();
    }
  }, [isOpen]);

  // Search for clients in CRM
  const searchClients = async (query: string) => {
    if (query.length < 2) {
      setClientSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`/api/crm/contacts?search=${encodeURIComponent(query)}&limit=10`);
      const data = await response.json();
      if (data.success) {
        setClientSearchResults(data.contacts || []);
      }
    } catch (err) {
      logger.error({ err, query }, 'Client search failed');
    } finally {
      setIsSearching(false);
    }
  };

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (clientSearchQuery.length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        searchClients(clientSearchQuery);
      }, 300);
    } else {
      setClientSearchResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [clientSearchQuery]);

  // Select a contact from search results
  const selectContact = (contact: CRMContact) => {
    setSelectedContact(contact);
    setFormData(prev => ({
      ...prev,
      contact_id: contact.id,
      client_first_name: contact.first_name,
      client_last_name: contact.last_name || '',
      client_email: contact.email,
      client_phone: contact.phone || ''
    }));
    setShowClientSearch(false);
    setClientSearchQuery('');
    setClientSearchResults([]);
  };

  // Clear selected contact and show manual entry
  const clearSelectedContact = () => {
    setSelectedContact(null);
    setFormData(prev => ({
      ...prev,
      contact_id: null,
      client_first_name: '',
      client_last_name: '',
      client_email: '',
      client_phone: ''
    }));
    setShowClientSearch(true);
  };

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT STANDS BETWEEN THIS SERVICE AND A CLIENT.
   *
   * Asked per SERVICE, not per business, because the answer differs inside one
   * catalogue: a free fifteen-minute intro needs nothing but a time, and a paid
   * programme cannot be billed without the invoice details behind it. The
   * service drives it, so the check moves with the picker.
   *
   * `journeyGaps` already decides this — `hours` when something asks for a time
   * and no availability exists, `invoicing` when money is owed and the business
   * cannot issue a document for it. A missing card processor is deliberately
   * NOT blocking: the booking falls back to an invoice, which is why the
   * invoicing gap is the one that matters.
   *
   * Fails OPEN, twice over: the endpoint answers `{ ready: true, checkFailed }`
   * on its own error, and a throw here is swallowed the same way. A failed
   * request must never stand between an owner and writing down a booking they
   * have already agreed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /**
   * This booking is a record of something that already happened.
   *
   * `completed` and `cancelled` are terminal: the meeting is in the past or it
   * is off, and neither can be rearranged. The time fields already knew this;
   * the rest of the form did not, so a settled appointment still offered to be
   * updated and the server accepted whatever came back.
   *
   * Notes stay writable deliberately. Writing up a session afterwards is the
   * normal use of this screen once the meeting is over, and nowhere else in the
   * product can edit them.
   */
  const isSettled = !!booking && ['completed', 'cancelled'].includes(booking.status);

  const [serviceGaps, setServiceGaps] = useState<Array<{ kind: string; message: string }>>([]);

  /*
   * True while the configuration dialog is open on top of this one.
   *
   * This dialog cannot simply close to make room, the way the invoice composer
   * does: by the time a gap is showing, a service is chosen and client details
   * may be typed, and discarding that to go and fill in a tax id would be a
   * worse bug than the one being fixed.
   *
   * So it stays and gives up its MODALITY instead. Radix traps focus while
   * `modal` is true and treats a click outside its own content as a dismissal,
   * which is why the settings dialog's close button needed pressing twice — the
   * dialog underneath was eating the first press. With modality dropped the
   * clicks land, and `onInteractOutside` below stops those same clicks from
   * closing this dialog and taking the form with it.
   */
  /*
   * A no-show is a judgement recorded against a person, so it is confirmed
   * rather than done on one click — and the confirmation is where the owner
   * decides whether to invite the client back. See `NoShowConfirmDialog`.
   */
  const [showNoShowConfirm, setShowNoShowConfirm] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);
  /*
   * The same fact as `configOpen`, readable synchronously.
   *
   * `onOpenChange` fires during Radix's own dismissal handling, before React
   * has re-rendered with a new state value — so the state alone cannot answer
   * "is this close caused by the settings dialog?" at the moment it is asked.
   * The ref can, and it guards the close PATH rather than the two individual
   * dismissal handlers, so it holds whichever route Radix takes.
   */
  const configOpenRef = useRef(false);

  /**
   * Open the configuration dialog from inside this one, and survive it.
   *
   * Lowering the flag when the settings dialog closes is NOT enough, and that
   * is the whole subtlety here: the closing click is still in flight. Radix
   * delivers it to this dialog immediately afterwards, and by then a
   * synchronous reset has already said "settings are closed", so the guards
   * wave the dismissal through. The booking closed, and the contact drawer
   * behind it went too.
   *
   * So the flag outlives the close by a beat. The delay only has to cover the
   * dismissal and the exit animation; a deliberate close a third of a second
   * later behaves exactly as it always did.
   */
  const openConfigurationFrom = useCallback(
    (tab: 'intake' | 'services' | 'availability' | 'payments', onClosed?: () => void) => {
      if (!configurationDialog) return;

      configOpenRef.current = true;
      setConfigOpen(true);

      configurationDialog.openConfiguration(tab, {
        onClose: () => {
          onClosed?.();
          setTimeout(() => {
            configOpenRef.current = false;
            setConfigOpen(false);
          }, 350);
        },
      });
    },
    [configurationDialog]
  );

  const checkServiceReadiness = useCallback(async (serviceId: string) => {
    if (!serviceId) {
      setServiceGaps([]);
      return;
    }
    try {
      const response = await fetch(
        `/api/business-os/journey-readiness?service_ids=${encodeURIComponent(serviceId)}`,
        { cache: 'no-store' }
      );
      const result = await response.json();
      // `gaps` carries only the blocking ones; `advisory` (the processor) is
      // deliberately ignored — saying so would invite a fix for something that
      // is working as designed.
      setServiceGaps(result?.success && !result.ready ? result.gaps ?? [] : []);
    } catch {
      setServiceGaps([]);
    }
  }, []);

  /*
   * Checked on open as well as on change, so an edit whose service has since
   * become blocked says so — and one that has since been fixed does not.
   */
  useEffect(() => {
    if (!isOpen) {
      setServiceGaps([]);
      // Reset too: this component stays mounted between openings, so a stale
      // `true` here would leave the next booking non-modal for no reason.
      configOpenRef.current = false;
      setConfigOpen(false);
      return;
    }
    /*
     * Nothing to gate on a meeting that is over.
     *
     * The readiness check asks whether this service can still be honoured —
     * whether anyone can book a time, whether the money can be collected. A
     * completed appointment needs none of that, and blocking its notes behind
     * a missing tax id would be an obstacle to recording history.
     */
    if (isSettled) {
      setServiceGaps([]);
      return;
    }
    checkServiceReadiness(formData.service_id);
    // Only the service matters here; the rest of the form does not change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, formData.service_id, checkServiceReadiness, isSettled]);

  const handleServiceChange = (serviceId: string) => {
    const service = services.find(s => s.id === serviceId);
    // `endOfBusinessLocal` answers null for a start that is not a usable wall
    // clock — an empty one, which a service with no date step leaves behind.
    // This used to format an Invalid Date, and `Intl` throws on one: choosing a
    // service could take the whole dialog down.
    // `|| 60`, the same default the start handler uses: `duration_minutes` is
    // nullable, and a service with no date step has no duration to read.
    const end = service && !booking
      ? endOfBusinessLocal(formData.start_time, service.duration_minutes || 60, zone)
      : null;

    if (end) {
      setFormData(prev => ({ ...prev, service_id: serviceId, end_time: end }));
    } else {
      setFormData(prev => ({ ...prev, service_id: serviceId }));
    }
    // Clear any service-related errors
    setFormErrors(prev => ({ ...prev, service_id: '' }));
  };

  // Handle start time change - auto-update end time based on service duration
  const handleStartTimeChange = (newStartTime: string) => {
    if (!newStartTime) {
      setFormData(prev => ({ ...prev, start_time: newStartTime }));
      return;
    }

    const service = services.find(s => s.id === formData.service_id);
    const serviceDuration = service?.duration_minutes || 60;

    /*
     * THE BUSINESS'S CLOCK, NOT THE BROWSER'S.
     *
     * ───────────────────────────────────────────────────────────────────────────
     * This was `new Date(newStartTime)`. A `datetime-local` string carries no
     * offset, so that reads the typed clock where the OWNER is sitting, and the
     * end was then written back on the business's clock — two clocks in one
     * subtraction. They cancel out only when the owner is in their own
     * business's zone, so it was invisible in development and in CI and wrong
     * for every owner abroad: in Israel with a New York business, typing 10:00
     * for an hour-long service produced an end of 04:00, seven hours out and
     * before the start. The validator then refused the booking, correctly, and
     * the dialog could not be used at all.
     *
     * Wherever the owner is, every time here is counted on the business's zone.
     * Null when the start is not a usable wall clock: keep the typed value and
     * leave the end alone rather than formatting an Invalid Date, which throws.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const end = endOfBusinessLocal(newStartTime, serviceDuration, zone);

    setFormData(prev => ({
      ...prev,
      start_time: newStartTime,
      ...(end ? { end_time: end } : {})
    }));

    // Clear time-related errors
    setFormErrors(prev => ({ ...prev, start_time: '', end_time: '' }));
  };

  // Validate form and return errors
  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!formData.service_id) {
      errors.service_id = t('scheduling.booking.error_service_required') || 'Please select a service';
    }

    if (!formData.client_email && !formData.contact_id) {
      errors.client_email = t('scheduling.booking.error_email_required') || 'Client email is required';
    } else if (formData.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.client_email)) {
      errors.client_email = t('scheduling.booking.error_invalid_email') || 'Please enter a valid email address';
    }

    if (!formData.client_first_name && !formData.contact_id) {
      errors.client_first_name = t('scheduling.booking.error_name_required') || 'Client name is required';
    }

    /*
     * Only when the journey has a date step. A course has no time to be
     * missing, so demanding one is an error the owner cannot clear — the field
     * they would fix is not on screen.
     */
    if (!needsSchedule) {
      // Nothing to validate. The remaining checks all describe a slot.
    } else if (!formData.start_time) {
      errors.start_time = t('scheduling.booking.error_start_required') || 'Start time is required';
    } else {
      const startTime = parseDateTimeLocal(formData.start_time, zone);
      const now = new Date();
      if (!booking && startTime < now) {
        errors.start_time = t('scheduling.booking.error_past_time') || 'Cannot book in the past';
      }
    }

    if (!needsSchedule) {
      // Same reason as the start: there is no slot on this booking.
    } else if (!formData.end_time) {
      errors.end_time = t('scheduling.booking.error_end_required') || 'End time is required';
    } else if (formData.start_time) {
      /*
       * BOTH sides parsed in the BUSINESS's zone, or this compares two
       * different clocks.
       *
       * The end used to go through `new Date()`, which reads a
       * `datetime-local` string in the BROWSER's zone, while the start went
       * through the business's. For an owner in Israel running a New York
       * business that is a seven-hour gap: 09:00 New York is 13:00 UTC, while
       * 10:00 read as Israel is 07:00 UTC — so the end landed six hours BEFORE
       * the start and the booking was refused.
       *
       * It fired for every appointment shorter than the offset, which is every
       * appointment, and only for owners whose own zone differs from the
       * business's — exactly who the timezone setting exists for. The submit
       * path below already parsed both correctly, so nothing was ever SAVED
       * wrong; the booking simply could not be made.
       */
      const startTime = parseDateTimeLocal(formData.start_time, zone);
      const endTime = parseDateTimeLocal(formData.end_time, zone);
      if (endTime <= startTime) {
        errors.end_time = t('scheduling.booking.error_end_before_start') || 'End time must be after start time';
      }
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    /*
     * The disabled button is not the gate; this is.
     *
     * Enter submits a form whose submit button is disabled, so a gate that
     * lives only in `disabled` is one keystroke from being bypassed. The
     * notice above already says why, so this returns silently rather than
     * raising a second complaint about the same thing.
     */
    if (!onPickSlot && !isSettled && serviceGaps.length > 0) return;

    // Validate form using custom validation
    const errors = validateForm();
    if (Object.keys(errors).some(key => errors[key])) {
      setFormErrors(errors);
      return;
    }

    // Clear any previous errors
    setFormErrors({});
    setLoading(true);

    try {
      /*
       * THE CALLER ONLY WANTED THE TIME — see `onPickSlot`.
       *
       * Returned before the request body is built, because none of it applies:
       * the client, the service and the status all come from the package this
       * meeting is joining, not from these fields.
       */
      if (onPickSlot) {
        await onPickSlot(
          parseDateTimeLocal(formData.start_time, zone),
          parseDateTimeLocal(formData.end_time, zone)
        );
        onClose();
        return;
      }

      /*
       * ───────────────────────────────────────────────────────────────────────
       * A PACKAGE SESSION IS MOVED AT ITS OWN ENDPOINT.
       *
       * A package is one booking with N meetings, so a session has no booking
       * to PUT: the booking is the purchase and carries no clock. Moving one
       * writes a second ATTEMPT at that session and releases the hour the old
       * one held, which `/meetings/[id]/reschedule` does in one transaction.
       *
       * `rescheduleMeetingId` is absent for every ordinary booking, which is
       * the common case and reaches the same two lines it always did.
       * ───────────────────────────────────────────────────────────────────────
       */
      const url = rescheduleMeetingId
        ? `/api/scheduling/meetings/${rescheduleMeetingId}/reschedule`
        : booking
          ? `/api/scheduling/bookings/${booking.id}`
          : '/api/scheduling/bookings';
      const method = rescheduleMeetingId ? 'POST' : booking ? 'PUT' : 'POST';

      // Build request body
      const requestBody: Record<string, any> = {
        service_id: formData.service_id,
        contact_id: formData.contact_id || undefined,
        client_first_name: formData.client_first_name,
        client_last_name: formData.client_last_name || undefined,
        client_email: formData.client_email,
        client_phone: formData.client_phone || undefined,
        /*
         * Omitted entirely when the journey has no date step.
         *
         * Sending a time for a course would write an hour nobody chose and
         * nobody sees — and `parseDateTimeLocal('')` is an invalid date, so
         * this previously produced `Invalid Date` and a 400 rather than a
         * saved booking. The route and the service layer both treat absent as
         * "not scheduled" and store null.
         */
        ...(needsSchedule
          ? {
              start_time: parseDateTimeLocal(formData.start_time, zone).toISOString(),
              end_time: parseDateTimeLocal(formData.end_time, zone).toISOString(),
            }
          : {}),
        /*
         * The BUSINESS's zone, or nothing at all.
         *
         * ─────────────────────────────────────────────────────────────────────
         * This sent the owner's BROWSER zone. It was seeded from
         * `Intl.DateTimeFormat().resolvedOptions().timeZone`, re-seeded on every
         * open, and raced by a `/api/user/profile` fetch that read
         * `profiles.timezone` — the other of the platform's two timezone
         * columns, which that route's own comment records as having drifted from
         * `user_preferences` on live accounts. Whichever won was written to
         * `scheduling_bookings.timezone`, so an owner in Israel stamped
         * `Asia/Jerusalem` on New York appointments.
         *
         * That column is the fallback clock for every client-facing email
         * (`getBusinessTimezone` prefers `user_preferences.timezone` and falls
         * back to the row), so it is latent until an account has no preferences
         * row and then it mails the wrong hour.
         *
         * Omitted while the zone is still resolving, because both routes then
         * resolve it from the owner's preferences — better than any guess this
         * dialog can make. Create: `validated.timezone || safeTimezone(
         * ownerPrefs?.timezone)`. Update: an absent field leaves the stored one
         * alone.
         * ─────────────────────────────────────────────────────────────────────
         */
        ...(zoneReady ? { timezone: zone } : {}),
        /*
         * Sent only when the owner has actually been shown the warning above —
         * `closedDay.closed` is the same verdict that drew it. Never a constant
         * true: that would put the original bug back, with a client confirmed
         * into a closed day and nobody having decided it.
         */
        ...(closedDay.closed ? { allow_closed_day: true } : {}),
        notes: formData.notes || undefined
      };

      // If editing a no-show booking with new time, auto-confirm it (rescheduling)
      // Only where there IS a time: a course has none to have changed.
      if (needsSchedule && booking && (booking.meeting_status === 'no_show' || booking.status === 'no_show')) {
        const originalStart = new Date(booking.start_time).getTime();
        /* `booking.start_time` is a stored instant; `formData.start_time` is the
           business's wall clock. Reading the second one in the browser's zone
           made the two disagree by the owner's offset, so an untouched no-show
           silently flipped to confirmed every time the form was saved. */
        const newStart = parseDateTimeLocal(formData.start_time, zone).getTime();
        // If time changed, mark as confirmed (rescheduled)
        if (originalStart !== newStart) {
          requestBody.status = 'confirmed';
        }
      }

      // Add new client CRM fields if this is a new client (no contact_id)
      if (!formData.contact_id && !booking) {
        requestBody.new_client_data = {
          tags: newClientTags.length > 0 ? newClientTags : undefined,
          source: newClientSource || 'booking',
          notes: newClientNotes || undefined
        };
      }

      // Add intake form flag for new bookings or editing existing bookings without intake
      if (sendIntakeForm) {
        requestBody.send_intake_form = true;
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (response.ok) {
        onBookingUpdated();
      } else if (data.code === 'closed_day' && data.closed) {
        /*
         * The server knew about a closure this dialog did not.
         *
         * Shown as the same warning a locally-known closure draws, so the
         * button becomes "Book anyway" and one more press books it. The
         * alternative — a red server sentence in English under the form — is
         * both a dead end and the wrong language for most owners.
         */
        setServerClosedDay(data.closed);
        setFormErrors({});
      } else {
        // Handle error response - show user-friendly error message
        const errorMessage = data.message || data.error || t('scheduling.booking.save_failed');
        setFormErrors({ submit: errorMessage });
      }
    } catch (err) {
      logger.error({ err, bookingId: booking?.id }, 'Saving the booking failed');
      /*
       * A slot handler's own words, where it has any. "That hour is taken" and
       * "you are closed that day" are the two commonest answers and both are
       * about the field being looked at — replacing them with a generic
       * "could not save" would throw away the only useful part.
       */
      setFormErrors({
        submit:
          onPickSlot && err instanceof Error && err.message
            ? err.message
            : t('scheduling.booking.save_failed'),
      });
    } finally {
      setLoading(false);
    }
  };

  /*
   * Waiting on a cancellation reason.
   *
   * Cancelling posted an empty body, which stopped working once the API began
   * requiring a reason — and asking is right anyway: nobody but the owner knows
   * why, and a default would put whichever reason it was at the top of the
   * report forever.
   */
  const [cancelTarget, setCancelTarget] = useState(false);

  const handleQuickAction = async (
    action: 'cancel' | 'complete' | 'no-show',
    /*
     * `notifyClient` belongs to a no-show, the reason to a cancellation. One bag
     * rather than two signatures: the body goes straight through and the route
     * validates whichever fields its own action needs.
     */
    options?: {
      notifyClient?: boolean;
      reason_code?: string;
      reason?: string;
      share_note_with_client?: boolean;
    }
  ) => {
    if (!booking) return;
    setLoading(true);

    try {
      const response = await fetch(`/api/scheduling/bookings/${booking.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options ?? {})
      });

      if (response.ok) {
        onBookingUpdated();
      }
    } catch (err) {
      logger.error({ err, action, bookingId: booking?.id }, 'Booking action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!booking) return;
    setLoading(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/scheduling/bookings/${booking.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        setShowDeleteConfirm(false);
        onBookingUpdated();
        return;
      }

      // A paid booking is refused rather than deleted — the money is a record to
      // refund deliberately. The confirmation strip stays open and states why,
      // so the answer appears where the click was, not somewhere else on screen.
      const data = await response.json().catch(() => null);
      if (data?.code === 'BOOKING_HAS_PAID_INVOICE') {
        setDeleteError(
          t('scheduling.booking.delete_blocked_paid')
            || 'This booking has already been paid for and cannot be deleted. Refund the payment first, or cancel the booking instead.'
        );
      } else if (data?.code === 'BOOKING_HAS_PAYMENT_PLAN') {
        /*
         * A payment plan points at this booking, so the DATABASE refuses the
         * delete — `payment_plan_subscriptions.booking_id` is ON DELETE RESTRICT.
         * It used to arrive as a flat 500 "Failed to delete booking", which told
         * the owner nothing and left them clicking it again.
         *
         * Two messages, because the way out differs: a plan still charging can
         * be stopped, while a finished one is history that deleting would erase,
         * and cancelling is the only route past it.
         */
        setDeleteError(
          data?.details?.plan_live === false
            ? t('scheduling.booking.delete_blocked_plan_past')
              || 'This booking has a payment plan on record, so it cannot be deleted without erasing that history. Cancel the booking instead.'
            : t('scheduling.booking.delete_blocked_plan')
              || 'This booking has a payment plan that is still charging the client. Stop the payment plan first, or cancel the booking instead.'
        );
      } else {
        setDeleteError(data?.error || t('scheduling.booking.delete_failed') || 'Failed to delete booking');
      }
    } catch (error) {
      logger.error({ err: error, bookingId: booking.id }, 'Failed to delete booking');
      setDeleteError(t('scheduling.booking.delete_failed') || 'Failed to delete booking');
    } finally {
      setLoading(false);
    }
  };

  const dismissDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setDeleteError(null);
  };

  const getClientInitials = () => {
    const first = formData.client_first_name?.[0] || '';
    const last = formData.client_last_name?.[0] || '';
    return (first + last).toUpperCase() || '?';
  };

  const getServiceName = () => {
    const service = services.find(s => s.id === formData.service_id);
    return service?.service_name || t('scheduling.booking.select_service');
  };

  const statusStyle = STATUS_COLORS[booking?.status || 'pending'];

  /* ───────────────────────────────────────────────────────────────────────────
     WHAT EACH ANSWERED STEP SAYS.

     Formatted here rather than in `planBookingSteps` because every one of
     these has a source that has been read from the wrong place before: the
     price belongs to the SERVICE's currency, not the business default, and
     the hour belongs to the BUSINESS's zone, not the owner's browser.
     ─────────────────────────────────────────────────────────────────────── */

  const serviceSummary = (() => {
    if (!selectedService) return null;

    const symbol =
      selectedService.currency === 'ILS' ? '₪'
        : selectedService.currency === 'EUR' ? '€'
        : selectedService.currency === 'GBP' ? '£'
        : '$';

    return [
      selectedService.service_name,
      selectedService.duration_minutes != null
        ? `${selectedService.duration_minutes} ${t('scheduling.service.minutes')}`
        : null,
      selectedService.price != null && selectedService.price > 0
        ? `${symbol}${selectedService.price}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
  })();

  const clientSummary = (() => {
    const name = `${formData.client_first_name || ''} ${formData.client_last_name || ''}`.trim();
    if (!name) return null;

    /* The email is how they are reached, so it belongs on the line that
       replaces the form — an owner checking a collapsed step is usually
       checking they picked the right person, not the right spelling. */
    return [name, formData.client_email || null].filter(Boolean).join(' · ');
  })();

  const whenSummary = (() => {
    /*
     * No hour is answered before the service is.
     *
     * The dialog seeds a start time on open so the grid has somewhere to
     * start, and with the service no longer defaulted that seed was collapsing
     * step 3 to "Date and time · Thursday 20 Nov · 10:00" while step 1 was
     * still asking which service this is — an hour presented as decided, whose
     * length had been guessed at sixty minutes.
     *
     * `formData.service_id` rather than `selectedService`: while EDITING, the
     * service list can arrive after the booking does, and asking whether the
     * row is in the list yet would open this step and shut it again.
     */
    if (!formData.service_id) return null;
    if (!needsSchedule || !formData.start_time || !zoneReady) return null;

    const start = parseDateTimeLocal(formData.start_time, zone);
    if (Number.isNaN(start.getTime())) return null;

    const locale = LOCALE_MAP[language] || 'en-US';
    const day = start.toLocaleDateString(locale, {
      timeZone: zone,
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
    const hour = start.toLocaleTimeString(locale, {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: language !== 'he',
    });

    return `${day} · ${hour}`;
  })();

  const detailsSummary = (() => {
    const parts = [
      formData.notes?.trim() ? t('scheduling.booking.details_notes_added') : null,
      sendIntakeForm ? t('scheduling.booking.details_intake_will_send') : null,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  const stepFacts = {
    service: serviceSummary,
    client: clientSummary,
    when: whenSummary,
    details: detailsSummary,
    needsSchedule,
    /* A completed or cancelled booking is read, not filled. */
    settled: isSettled,
    /*
     * What the dialog is refusing, so the step holding the message cannot
     * close over it. `serviceGaps` belongs here as well as the field errors:
     * it disables Save on its own, and collapsed it would leave the owner with
     * a dead button and nothing to read.
     */
    errors: {
      service: Boolean(formErrors.service_id) || serviceGaps.length > 0,
      client: Boolean(formErrors.client_first_name || formErrors.client_email),
      when: Boolean(formErrors.start_time || formErrors.end_time),
    },
  };

  const stepPlan = planBookingSteps(
    stepFacts,
    /*
     * ───────────────────────────────────────────────────────────────────────────
     * THE ORDINARY RULE, EVEN WHEN A SLOT IS BEING PICKED.
     *
     * This forced the hour step open for `onPickSlot`, on the reasoning that
     * the dialog "defaults a start time" — so every step read as answered and
     * the one question being asked would have opened collapsed.
     *
     * That default is no longer a default. The dialog now opens on the hour
     * the SERIES says comes next, at the same time as the others: an answer,
     * not a guess, and one the owner usually accepts. Forcing the picker open
     * put a week of slots in front of a decision already made.
     *
     * Collapsed with its "change" link, like every other answered step.
     *
     * Still forced open where nothing HAS answered it — a package with no
     * rhythm to read, so no date could be suggested. Then the hour really is
     * the one open question, and the picker is what the dialog is for.
     * ───────────────────────────────────────────────────────────────────────────
     */
    openedStep ?? (onPickSlot && !prefilledStartLocal ? 'when' : null)
  );

  const stepOf = (key: BookingStepKey) =>
    stepPlan.find(step => step.key === key) ?? {
      key,
      index: 0,
      state: 'pending' as const,
      summary: null,
    };

  /* Offered on an answered step, except where the answer is not the owner's to
     change: a settled booking, or a slot being picked for a package whose
     service and client came with it. */
  const reopen = (key: BookingStepKey) =>
    isSettled || (onPickSlot && key !== 'when')
      ? undefined
      : () => setOpenedStep(key);

  return (
    <Dialog
      open={isOpen}
      /*
       * Radix passes the REQUESTED state. This was `onOpenChange={onClose}`,
       * which ignored it and closed on any change at all — and it closed while
       * the settings dialog was dismissing, taking the booking and the drawer
       * behind it with it.
       */
      onOpenChange={open => {
        if (open) return;
        if (configOpenRef.current || configurationOpen) return;
        onClose();
      }}
      modal={!(configOpen || configurationOpen)}
    >
      {/* Wider than a form needs, because this is not only a form: it carries the
          quick-pick slot cards, the service summary and the intake panel, and at
          2xl those sat in a column narrow enough to wrap every one of them. */}
      <DialogContent
        className="w-full sm:max-w-3xl lg:max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[92dvh] flex flex-col bg-[var(--v2-surface)] border-[var(--v2-border)] p-0 overflow-hidden"
        /* While settings are open, every click lands "outside" this dialog —
           including the ones inside settings. Dismissing on those would close
           the booking form out from under the person fixing the thing it asked
           them to fix. */
        onInteractOutside={event => {
          if (configOpen || configurationOpen) event.preventDefault();
        }}
        onEscapeKeyDown={event => {
          if (configOpen || configurationOpen) event.preventDefault();
        }}
      >
        {/* Sticky Header */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-4 sm:px-6 py-4 sm:py-6 pe-12 sm:pe-14 bg-[var(--v2-surface)]">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg sm:rounded-xl flex items-center justify-center text-base sm:text-lg font-semibold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 flex-shrink-0">
              {getClientInitials()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <DialogHeader>
                  <DialogTitle className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)] rtl:text-right truncate">
                    {booking ? t('scheduling.booking.edit_booking') : t('scheduling.booking.new_booking')}
                  </DialogTitle>
                </DialogHeader>
                {booking && (
                  <Badge
                    variant="outline"
                    className={`${statusStyle.bg} ${statusStyle.text} ${statusStyle.border} text-xs sm:text-sm`}
                  >
                    {t(`scheduling.status.${booking.status}`)}
                  </Badge>
                )}
              </div>
              <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mt-1 hidden sm:block">
                {getServiceName()}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          {/* Scrollable Content */}
          {/* No padding and no `space-y` of its own: each step draws its own
              inset and the hairline under it, so the rows meet edge to edge
              the way the mockup has them rather than floating as cards. */}
          <div className="flex-1 overflow-y-auto">
          {/* Service Selection */}
          <BookingStep
            index={stepOf('service').index}
            label={t('scheduling.booking.service_section')}
            state={stepOf('service').state}
            summary={stepOf('service').summary}
            onEdit={timingAMeeting ? undefined : reopen('service')}
            editLabel={t('scheduling.booking.step_change')}
          >
          <div className="space-y-3 sm:space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                {t('scheduling.booking.service')} <span className="text-red-500">*</span>
              </label>
              <Select
                value={formData.service_id}
                onValueChange={handleServiceChange}
                /* Locked while editing one booking, and while picking a slot
                   for a package: the meeting inherits the container's service
                   whatever this said, so offering a choice would be a lie. */
                disabled={!!booking || Boolean(onPickSlot)}
              >
                <SelectTrigger
                  className={`w-full bg-[var(--v2-bg)] text-[var(--v2-text-primary)] rtl:flex-row-reverse rtl:text-right ${
                    formErrors.service_id
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                      : 'border-[var(--v2-border)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {/*
                    * The trigger says it in ONE line.
                    *
                    * Radix clones the chosen `SelectItem`'s children into the
                    * trigger, and those children are a two-row block — name
                    * above, duration and price below. That reads well in the
                    * open list and badly in a closed field, where it doubled the
                    * control's height and pushed the form around as soon as a
                    * service was picked.
                    *
                    * Passing children to `SelectValue` overrides the clone, so
                    * the list keeps its two rows and the field gets a summary.
                    */}
                  <SelectValue placeholder={t('scheduling.booking.select_service')}>
                    {(() => {
                      const selected = services.find(item => item.id === formData.service_id);
                      if (!selected) return null;

                      const symbol =
                        selected.currency === 'ILS' ? '₪'
                          : selected.currency === 'EUR' ? '€'
                          : selected.currency === 'GBP' ? '£'
                          : '$';

                      return (
                        <span className="flex items-center gap-2 min-w-0 rtl:flex-row-reverse">
                          <span className="truncate">{selected.service_name}</span>
                          {/* The meta is secondary here, so it recedes rather
                              than competing with the name it belongs to. */}
                          <span className="flex items-center gap-2 flex-shrink-0 text-xs text-[var(--v2-text-muted)] rtl:flex-row-reverse">
                            {selected.duration_minutes != null && (
                              <span>
                                {selected.duration_minutes} {t('scheduling.service.minutes')}
                              </span>
                            )}
                            {selected.price != null && selected.price > 0 && (
                              <span className="text-[#0D9488] font-medium">
                                <bdi>{symbol}{selected.price}</bdi>
                              </span>
                            )}
                          </span>
                        </span>
                      );
                    })()}
                  </SelectValue>
                </SelectTrigger>
{/* The cap lives in `components/ui/select.tsx` now: this dropdown
                    was capped at its call site while the wrapper stayed
                    unbounded, and the same bug then arrived in the
                    cancellation-reason list. */}
                <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)] p-1">
                  {/* `rtl:` variants, like every other row in this dropdown —
                      the spinner belongs on the side the text starts from, and
                      a left-aligned Hebrew line in a right-aligned list is the
                      one thing that looks unfinished. */}
                  {servicesLoading && services.length === 0 && (
                    <div className="flex items-center gap-2 px-3 py-3 text-sm text-[var(--v2-text-muted)] rtl:flex-row-reverse rtl:text-right">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('scheduling.booking.loading_services')}
                    </div>
                  )}
                  {!servicesLoading && services.filter(s => s.status === 'active').length === 0 && (
                    <div className="px-3 py-3 text-sm text-[var(--v2-text-muted)] rtl:text-right">
                      {t('scheduling.booking.no_services')}
                    </div>
                  )}
                  {services
                    .filter(service => service.status === 'active')
                    .map(service => {
                      const hasInstallments = service.payment_type === 'installments' && service.installment_count && service.installment_count > 1;
                      return (
                        <SelectItem
                          key={service.id}
                          value={service.id}
                          className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488] py-3 px-3 cursor-pointer"
                        >
                          <div className="flex flex-col gap-1.5 rtl:text-right">
                            <div className="flex items-center gap-2 rtl:flex-row-reverse">
                              <span className="font-medium">{service.service_name}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-[var(--v2-text-muted)] rtl:flex-row-reverse">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {service.duration_minutes} {t('scheduling.service.minutes')}
                              </span>
                              {service.price != null && service.price > 0 && (
                                <span className="flex items-center gap-1 text-[#0D9488] font-medium">
                                  <Tag className="h-3 w-3" />
                                  {service.currency === 'ILS' ? '₪' : service.currency === 'EUR' ? '€' : service.currency === 'GBP' ? '£' : '$'}{service.price}
                                </span>
                              )}
                              {hasInstallments && (
                                <span className="flex items-center gap-1 text-blue-500">
                                  <CreditCard className="h-3 w-3" />
                                  {service.installment_count} {t(`scheduling.modal.installment_${service.installment_frequency || 'monthly'}`)}
                                </span>
                              )}
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
              {formErrors.service_id && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {formErrors.service_id}
                </p>
              )}
            </div>

            {/* What this particular service still needs. Under the picker, not
                at the top of the form: the choice made just above is what
                raised it, and the rest of the form is still worth filling in. */}
            {serviceGaps.length > 0 && (
              <div className="mt-3">
                <JourneyGapNotice
                  gaps={serviceGaps}
                  /* The ref moves with the state — see `configOpenRef`. A
                     path that raised only one of the two would leave the close
                     guard reading the wrong answer. */
                  onFixOpened={() => {
                    configOpenRef.current = true;
                    setConfigOpen(true);
                  }}
                  onResolved={async () => {
                    configOpenRef.current = false;
                    setConfigOpen(false);
                    await checkServiceReadiness(formData.service_id);
                  }}
                />
              </div>
            )}
          </div>
          </BookingStep>

          {/* Client Info Section */}
          <BookingStep
            index={stepOf('client').index}
            label={t('scheduling.booking.client_info')}
            state={stepOf('client').state}
            summary={stepOf('client').summary}
            onEdit={timingAMeeting ? undefined : reopen('client')}
            editLabel={t('scheduling.booking.step_change')}
          >
          <div className="space-y-3 sm:space-y-4">

            {/* ────────────────────────────────────────────────────────────────
                WHICH KIND OF CLIENT, ASKED OUT LOUD.

                This was an implicit mode with an uneven way back: the search
                box came first, a full-width "Add new client" button switched to
                the form, and the only route back was a small underlined link
                reading "Search existing client" — weaker than the button that
                got you there, and easy to miss entirely once the form had
                pushed it up the panel.

                Two pills, always on screen, saying which state you are in and
                letting you leave it the same way you entered. Nothing is
                hidden behind the other one: picking a mode swaps what is asked,
                and the values behind each are left where they were.
                ──────────────────────────────────────────────────────────────── */}
            {!booking && !selectedContact && (
              <div
                role="group"
                className="inline-flex p-0.5 border border-[var(--v2-border)] bg-[var(--v2-bg)]"
                style={{ borderRadius: '999px' }}
              >
                {([true, false] as const).map(existing => (
                  <button
                    key={String(existing)}
                    type="button"
                    onClick={() => setShowClientSearch(existing)}
                    aria-pressed={showClientSearch === existing}
                    className={`px-3.5 py-1.5 text-[12.5px] transition-colors ${
                      showClientSearch === existing
                        ? 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] font-medium shadow-sm'
                        : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                    }`}
                    style={{ borderRadius: '999px' }}
                  >
                    {existing
                      ? t('scheduling.booking.client_existing')
                      : t('scheduling.booking.client_new')}
                  </button>
                ))}
              </div>
            )}

            {/* Selected Contact Display */}
            {selectedContact && !showClientSearch && (
              <div
                className="flex items-center justify-between p-4 bg-[#14B8A6]/10 border border-[#14B8A6]/30"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10">
                    {(selectedContact.first_name?.[0] || '') + (selectedContact.last_name?.[0] || '')}
                  </div>
                  <div>
                    <p className="font-medium text-[var(--v2-text-primary)]">
                      {selectedContact.first_name} {selectedContact.last_name}
                    </p>
                    <p className="text-sm text-[var(--v2-text-muted)]">{selectedContact.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearSelectedContact}
                  className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Client Search (for new bookings) */}
            {!booking && showClientSearch && (
              <div className="space-y-3">
                {/* Search Input */}
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
                  <input
                    type="text"
                    value={clientSearchQuery}
                    onChange={(e) => setClientSearchQuery(e.target.value)}
                    placeholder={t('scheduling.booking.search_client_placeholder')}
                    className="w-full ps-10 pe-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  {isSearching && (
                    <div className="absolute end-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-[#14B8A6] border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                {/* Search Results */}
                {clientSearchResults.length > 0 && (
                  <div
                    className="max-h-48 overflow-y-auto border border-[var(--v2-border)] bg-[var(--v2-surface)] divide-y divide-[var(--v2-border)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {clientSearchResults.map(contact => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => selectContact(contact)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-[#14B8A6]/10 transition-colors text-start"
                      >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 flex-shrink-0">
                          {(contact.first_name?.[0] || '') + (contact.last_name?.[0] || '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[var(--v2-text-primary)] truncate">
                            {contact.first_name} {contact.last_name}
                          </p>
                          <p className="text-xs text-[var(--v2-text-muted)] truncate">{contact.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No results message */}
                {clientSearchQuery.length >= 2 && !isSearching && clientSearchResults.length === 0 && (
                  <p className="text-sm text-[var(--v2-text-muted)] text-center py-2">
                    {t('scheduling.booking.no_clients_found')}
                  </p>
                )}

                {/* The "or · Add new client" button was here. It is the second
                    pill above now, so the two modes are one control rather than
                    a default and an escape. */}
              </div>
            )}

            {/* Manual Client Entry Form (shown when not searching or editing) */}
            {(!showClientSearch || booking) && !selectedContact && (
              <>
                {/* What saving this form will do, instead of a link back.
                    The way back is the first pill above, which is where the
                    reader chose to be here. */}
                {!booking && (
                  <p className="text-[12px] text-[var(--v2-text-muted)]">
                    {t('scheduling.booking.client_new_hint')}
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-[var(--v2-text-primary)] mb-1.5 sm:mb-2">
                      {t('scheduling.booking.first_name')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={formData.client_first_name}
                      onChange={(e) => {
                        setFormData(prev => ({ ...prev, client_first_name: e.target.value }));
                        setFormErrors(prev => ({ ...prev, client_first_name: '' }));
                      }}
                      placeholder={t('scheduling.booking.first_name_placeholder')}
                      className={`w-full px-4 py-2.5 bg-[var(--v2-bg)] border text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 transition-all ${
                        formErrors.client_first_name
                          ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                          : 'border-[var(--v2-border)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    {formErrors.client_first_name && (
                      <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {formErrors.client_first_name}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-[var(--v2-text-primary)] mb-1.5 sm:mb-2">
                      {t('scheduling.booking.last_name')}
                    </label>
                    <input
                      value={formData.client_last_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, client_last_name: e.target.value }))}
                      placeholder={t('scheduling.booking.last_name_placeholder')}
                      className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-medium text-[var(--v2-text-primary)] mb-1.5 sm:mb-2">
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[var(--v2-text-muted)]" />
                      {t('scheduling.booking.email')} <span className="text-red-500">*</span>
                    </div>
                  </label>
                  <input
                    type="email"
                    value={formData.client_email}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, client_email: e.target.value }));
                      setFormErrors(prev => ({ ...prev, client_email: '' }));
                    }}
                    placeholder={t('scheduling.booking.email_placeholder')}
                    className={`w-full px-4 py-2.5 bg-[var(--v2-bg)] border text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 transition-all ${
                      formErrors.client_email
                        ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                        : 'border-[var(--v2-border)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  {formErrors.client_email && (
                    <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {formErrors.client_email}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-medium text-[var(--v2-text-primary)] mb-1.5 sm:mb-2">
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[var(--v2-text-muted)]" />
                      {t('scheduling.booking.phone')}
                    </div>
                  </label>
                  <div className="flex gap-2" dir="ltr">
                    {phoneLib ? (
                    <>
                    <phoneLib.SearchableCountrySelect
                      value={phoneCountry}
                      /*
                        Choosing a country is a statement about the NUMBER, so it
                        rewrites the number. Wired to `setPhoneCountry` alone, picking
                        "United States" moved a dropdown and left `2013643030` national
                        — and the value that reached the database, `+2013643030`, reads
                        as Egypt.
                      */
                      onChange={(country) => {
                        setPhoneCountry(country);
                        setFormData(prev => ({
                          ...prev,
                          client_phone: phoneLib.applyCountryToPhone(prev.client_phone, country) ?? prev.client_phone,
                        }));
                      }}
                      labels={phoneLib.phoneCountryLabelsEn}
                    />
                    <phoneLib.PhoneInput
                      countryCallingCodeEditable={false}
                      country={phoneCountry}
                      value={phoneLib.phoneFieldValue(formData.client_phone, phoneCountry)}
                      onChange={(value) => setFormData(prev => ({ ...prev, client_phone: value || '' }))}
                      className="phone-input-scheduling flex-1"
                    />
                    </>
                    ) : (
                      <PhoneFieldPlaceholder className="phone-input-scheduling flex-1" />
                    )}
                  </div>
                </div>

                {/* New Client CRM Fields */}
                {!booking && (
                  <div className="space-y-4 pt-4 border-t border-[var(--v2-border)]">
                    <h4 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide">
                      {t('scheduling.booking.contact_details')}
                    </h4>

                    {/* Source - Clickable buttons with icons */}
                    <div>
                      <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                        {t('scheduling.booking.client_source')}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {SOURCE_OPTIONS.map(source => {
                          const Icon = source.icon;
                          return (
                            <button
                              key={source.value}
                              type="button"
                              onClick={() => setNewClientSource(source.value)}
                              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border transition-all ${
                                newClientSource === source.value
                                  ? 'border-[#14B8A6] bg-[#14B8A6]/10 text-[#0D9488] dark:text-[#5EEAD4]'
                                  : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#14B8A6]/50'
                              }`}
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <Icon className="h-4 w-4" />
                              {t(source.labelKey)}
                              {newClientSource === source.value && <Check className="h-4 w-4" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tags - with add tag input */}
                    <div>
                      <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                        {t('scheduling.booking.client_tags')}
                      </label>
                      {newClientTags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                          {newClientTags.map(tag => (
                            <Badge key={tag} className="bg-[#14B8A6]/20 text-[#0D9488] dark:text-[#5EEAD4] border-[#14B8A6]/30 gap-1 px-3 py-1">
                              {tag}
                              <button
                                type="button"
                                onClick={() => setNewClientTags(newClientTags.filter(t => t !== tag))}
                                className="hover:bg-[#14B8A6]/30 rounded-full p-0.5 transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (newTagInput.trim() && !newClientTags.includes(newTagInput.trim())) {
                                setNewClientTags([...newClientTags, newTagInput.trim()]);
                                setNewTagInput('');
                              }
                            }
                          }}
                          placeholder={t('scheduling.booking.add_tag_placeholder')}
                          className="flex-1 px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (newTagInput.trim() && !newClientTags.includes(newTagInput.trim())) {
                              setNewClientTags([...newClientTags, newTagInput.trim()]);
                              setNewTagInput('');
                            }
                          }}
                          className="px-4 py-2.5 text-sm font-medium text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Client Notes */}
                    <div>
                      <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                        {t('scheduling.booking.client_notes')}
                      </label>
                      <textarea
                        value={newClientNotes}
                        onChange={(e) => setNewClientNotes(e.target.value)}
                        placeholder={t('scheduling.booking.client_notes_placeholder')}
                        rows={2}
                        className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all resize-none"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          </BookingStep>

          {/*
            The whole scheduling region, only when the journey has a date step.
            ─────────────────────────────────────────────────────────────────
            An ADHD course is bought, not booked into an hour: `journeySteps`
            gives it no date step and no client was ever shown a picker for it.
            This dialog asked the owner for one anyway, and refused to save
            without it — a required field for a fact that does not exist.

            Wrapped rather than hidden field by field, because the quick-pick
            slots, the two inputs, the conflict warning and the timezone note
            are one subject. Everything below — notes, intake, payment — is
            unaffected: a course still has all of those.
          */}
          {needsSchedule && (
          <BookingStep
            index={stepOf('when').index}
            label={t('scheduling.booking.time_section')}
            state={stepOf('when').state}
            summary={stepOf('when').summary}
            onEdit={reopen('when')}
            editLabel={t('scheduling.booking.step_change')}
            /* The business's clock, named in the heading rather than beside
               each field — an owner in Israel running a New York business had
               no way to know that 10:00 meant 10:00 in New York. Shown only
               when their own clock differs, so the ordinary case gains no
               furniture. */
            note={showsViewerTime ? <span dir="ltr">{zone}</span> : isSettled ? `(${t('scheduling.booking.time_locked')})` : undefined}
          >
          {/*
            THE SLOT GRID, WHICH KNOWS WHAT AN HOUR COSTS.

            Six chips of the next free hours is what this had, and it answered
            the wrong question: which hours are free, not which hour to give
            away. The grid ranks them — the one that wastes nothing, the one
            that closes a window, the one that strands half an hour nobody can
            sell — and it reads the same `slotIntelligence` rules the client's
            own booking page does, so the two cannot drift apart again.

            It is the only way to pick an hour here: the two typed
            `datetime-local` fields that used to sit below it are gone, and
            with them the off-hours booking they allowed.
          */}
          {/* `!isSettled` as well as the collapsed step above it: a settled
              booking's hour always has a summary to collapse to, so this is
              belt and braces rather than the load-bearing guard — and it is
              the one that does not depend on a summary existing. */}
          {formData.service_id && !isSettled && (
            <BookingTimeStep
              serviceId={formData.service_id}
              durationMinutes={sessionLengthMinutes}
              contactId={formData.contact_id || null}
              value={
                formData.start_time && zoneReady
                  ? parseDateTimeLocal(formData.start_time, zone).toISOString()
                  : null
              }
              onChange={startIso => {
                if (!startIso) {
                  handleStartTimeChange('');
                  return;
                }
                /* Back onto the business's wall clock, which is the only form
                   the rest of this dialog and the validator understand. */
                handleStartTimeChange(formatDateTimeLocal(new Date(startIso), zone));
              }}
              /*
               * WHETHER A FORM IS COMING, NOT WHETHER THE TOGGLE IS ON.
               *
               * This read `sendIntakeForm`, which starts OFF and is switched
               * on in the step BELOW this one — so the lead-time warning was
               * absent at the only moment it could change the decision, and
               * present only once the hour step had collapsed over it.
               *
               * `intakeConfigured` is the business-level fact: a published
               * form that is enabled, which is emailed once the booking is
               * confirmed. That is what makes "the client has N hours to
               * return it" true, whatever this dialog's toggle says.
               */
              requiresIntake={intakeConfigured === true || sendIntakeForm}
              /* The name on the row about the hour they usually choose. */
              clientName={formData.client_first_name || undefined}
              /* Editing: its own hour must not read as taken, and the week
                 must open on the appointment rather than on today. */
              editingBookingId={booking?.id ?? null}
            />
          )}

          {/* ───────────────────────────────────────────────────────────────
              THE OLD CONTROLS, KEPT AND MOVED BEHIND A REQUEST.

              The grid above answers the ordinary question. These answer the
              two it cannot: an hour deliberately outside the business's
              working hours, and an end time that is not start + duration.
              Both are real, so they are hidden rather than removed — reached
              from "שעה אחרת…" in the grid.

              Always shown for a settled booking, which has no grid at all:
              there the two fields are how its hour is READ.
              ─────────────────────────────────────────────────────────────── */}
          {/* Quick Pick Available Slots - Show for both new and editing bookings */}
          {/*
            SHOWN ALSO WHEN THE CALLER NAMED THE DATES — see `seriesSlots`.

            For a recurring package these chips are not "the next six free
            hours", which is what the grid above works out for itself: they are
            the SERIES' own remaining dates, handed in by the drawer. Nothing
            in the slot endpoint knows them, so gating these behind "exact
            time" would have hidden the one set of dates that is not a
            suggestion but a schedule.
          */}
          {Boolean(seriesSlots?.length) && availability && (
            (() => {
              const serviceDuration = services.find(s => s.id === formData.service_id)?.duration_minutes || 60;
              // Not offered until the zone is known: a chip labelled from the
              // UTC placeholder names the wrong day. See `zoneReady`.
              /*
                The series' own next dates, where the caller named them — see
                `seriesSlots`. Ones already sold are dropped rather than shown
                struck through: a chip is an offer, and offering an hour that
                cannot be taken is worse than offering one fewer.
              */
              const seriesPicks: QuickPickSlot[] = (seriesSlots ?? [])
                .map(local => {
                  const start = parseDateTimeLocal(local, zone);
                  const end = new Date(start.getTime() + serviceDuration * 60 * 1000);
                  const todayKey = formatDateTimeLocal(new Date(), zone).slice(0, 10);
                  const dayKey = local.slice(0, 10);
                  const tomorrow = new Date(parseDateTimeLocal(`${todayKey}T12:00`, zone).getTime() + 86_400_000);
                  /* Only the two labels that are words need the offset; every
                     other distance formats as a date, so 2 stands for "later". */
                  const dayOffset =
                    dayKey === todayKey
                      ? 0
                      : dayKey === formatDateTimeLocal(tomorrow, zone).slice(0, 10)
                        ? 1
                        : 2;
                  return { dayOffset, start, end };
                })
                .filter(slot => !isSlotBooked(slot.start, slot.end, existingBookings, booking?.id))
                .slice(0, 6);

              const quickSlots = !zoneReady
                ? []
                : seriesSlots?.length
                  ? seriesPicks
                  : getNextAvailableSlots(availability, serviceDuration, zone, 6, existingBookings, externalBusySlots, timeOff);

              if (quickSlots.length === 0) return null;

              // Helper to get day label based on offset
              const getDayLabel = (offset: number, date: Date): string => {
                if (offset === 0) return t('scheduling.booking.today');
                if (offset === 1) return t('scheduling.booking.tomorrow');
                return formatDateShort(date, language, zone);
              };

              // Helper to get time label
              /*
                The business's clock, like the inputs below.

                This formatted in the BROWSER's zone while the Start Time field
                underneath formatted in the business's, so picking "Tomorrow
                10:00 AM" filled the field with 02:00 PM. Two controls, one
                click, two different answers.
              */
              const getTimeLabel = (date: Date): string => {
                const locale = LOCALE_MAP[language] || 'en-US';
                return date.toLocaleTimeString(locale, {
                  timeZone: zone,
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: language !== 'he' // Hebrew uses 24-hour format
                });
              };

              return (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {t('scheduling.booking.quick_pick')}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {quickSlots.map((slot, index) => {
                      const isSelected =
                        formData.start_time === formatDateTimeLocal(slot.start, zone) &&
                        formData.end_time === formatDateTimeLocal(slot.end, zone);

                      const dayLabel = getDayLabel(slot.dayOffset, slot.start);
                      const timeLabel = getTimeLabel(slot.start);

                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              start_time: formatDateTimeLocal(slot.start, zone),
                              end_time: formatDateTimeLocal(slot.end, zone)
                            }));
                          }}
                          className={`flex flex-col items-center p-3 text-sm transition-all ${
                            isSelected
                              ? 'bg-[#14B8A6] text-white shadow-md'
                              : 'bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:border-[#14B8A6] hover:bg-[#14B8A6]/10'
                          }`}
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <span className={`text-xs font-medium ${isSelected ? 'text-white/80' : 'text-[var(--v2-text-muted)]'}`}>
                            {dayLabel}
                          </span>
                          <span className="font-semibold" dir="ltr">{timeLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}

          {/*
            THE TWO TYPED `datetime-local` FIELDS WERE HERE, AND ARE GONE.

            Removed on request, and the grid above is what makes removing
            them safe: every hour it offers is one the working hours allow
            and nothing already holds, so the three warnings these fields
            needed — this day is closed, that hour is taken, your own clock
            reads differently — are now unreachable rather than unsaid.

            What went with them is the deliberate off-hours booking and a
            hand-set end time. If either is wanted back, it belongs in the
            GRID as something offered, not as a second way to answer a
            question the grid has already asked.
          */}
          </BookingStep>
          )}

          {/* Notes and the intake toggle are ONE step: both are things the
              owner adds to a booking that is otherwise already decided. */}
          <BookingStep
            index={stepOf('details').index}
            label={t('scheduling.booking.step_details')}
            state={stepOf('details').state}
            summary={stepOf('details').summary}
            onEdit={timingAMeeting ? undefined : reopen('details')}
            editLabel={t('scheduling.booking.step_change')}
          >
          {/* Notes Section */}
          <div className="space-y-3 sm:space-y-4">
            <h3 className="text-xs sm:text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t('scheduling.booking.notes_section')}
            </h3>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder={t('scheduling.booking.notes_placeholder')}
              rows={3}
              className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all resize-none"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>

          {/* Intake Form Toggle - Show for new bookings OR existing bookings without intake data */}
          {/*
            THE SWITCH HOLDS ITS WIDTH; THE TEXT HAS TO BE ALLOWED TO GIVE.

            `justify-between` positions these two, it does not stop them
            meeting. The switch is already `flexShrink: 0`, so when the row is
            narrower than its contents the only thing that can give is the text
            — and a flex child will not shrink below its min-content width
            unless `min-w-0` says it may. Without it the description kept its
            full width and simply ran UNDER the switch, which on a phone put the
            last words of the sentence behind the control.

            `gap-4` as well: once the text can shrink, `justify-between` has
            nothing left to space them with, and a sentence ending flush against
            a switch reads as touching it.
          */}
          {formData.service_id && (!booking || (booking && !booking.intake_responses && !booking.intake_completed_at)) && (
              <div
                className={`flex items-center justify-between gap-4 p-4 bg-[var(--v2-surface)] border ${
                  intakeConfigured === false ? 'border-amber-500/50' : 'border-[var(--v2-border)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* `shrink-0`: it is a 40px square, and letting it squash to
                      make room for text turns the icon into an oval. */}
                  <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${
                    intakeConfigured === false ? 'bg-amber-500/10 text-amber-500' : 'bg-[#14B8A6]/10 text-[#14B8A6]'
                  }`}>
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className={`font-medium text-sm ${
                      intakeConfigured === false ? 'text-[var(--v2-text-muted)]' : 'text-[var(--v2-text-primary)]'
                    }`}>
                      {t('scheduling.booking.send_intake_form')}
                    </p>
                    {intakeConfigured === false ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {/* Named, so the owner knows which of the two things to
                            go and do. A form written but not published is one
                            click from working. */}
                        {intakeBlock === 'not_published'
                          ? t('scheduling.booking.intake_not_published')
                          : t('scheduling.booking.intake_not_configured')}{' '}
                        {/*
                          The way to do it, next to the sentence asking for it.
                          Both messages end by naming Settings → Intake, and
                          the owner was left to close this dialog, find that
                          screen, publish, come back and start the booking
                          again. The dialog opens on the intake tab, and the
                          toggle re-asks on the way back — so a form that is one
                          click from working takes one click.
                        */}
                        {configurationDialog && (
                          <button
                            type="button"
                            onClick={() =>
                              openConfigurationFrom('intake', refreshIntakeSettings)
                            }
                            className="underline underline-offset-2 font-medium hover:no-underline"
                          >
                            {t('scheduling.booking.intake_open_settings')}
                          </button>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-[var(--v2-text-muted)]">
                        {booking
                          ? t('scheduling.booking.send_intake_form_edit_description')
                          : t('scheduling.booking.send_intake_form_description')}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sendIntakeForm}
                  onClick={() => intakeConfigured && setSendIntakeForm(!sendIntakeForm)}
                  disabled={!intakeConfigured}
                  style={{
                    position: 'relative',
                    display: 'block',
                    height: '24px',
                    width: '44px',
                    flexShrink: 0,
                    cursor: intakeConfigured ? 'pointer' : 'not-allowed',
                    borderRadius: '9999px',
                    backgroundColor: !intakeConfigured ? '#9CA3AF' : (sendIntakeForm ? '#14B8A6' : '#D1D5DB'),
                    transition: 'background-color 200ms ease-in-out',
                    border: 'none',
                    outline: 'none',
                    opacity: intakeConfigured === null ? 0.5 : 1
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '2px',
                      left: sendIntakeForm && intakeConfigured ? '22px' : '2px',
                      height: '20px',
                      width: '20px',
                      borderRadius: '9999px',
                      backgroundColor: 'white',
                      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
                      transition: 'left 200ms ease-in-out',
                      pointerEvents: 'none'
                    }}
                  />
                </button>
              </div>
          )}
          </BookingStep>

          </div>

          {/* Sticky Footer */}
          <div className="flex-shrink-0 border-t border-[var(--v2-border)] bg-[var(--v2-surface)] px-4 sm:px-6 py-3 sm:py-4">
            {/* Submit error message */}
            {formErrors.submit && (
              <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-lg">
                {formErrors.submit}
              </div>
            )}
            {/*
              WHERE THE BOOKING STANDS, BESIDE THE BUTTON THAT COMMITS IT.

              With the steps collapsed, the facts are spread up the dialog and
              the one being confirmed is whichever step is open. This is the
              whole appointment on one line, next to Save — so pressing it is
              answering a question you can still see.
            */}
            {!showDeleteConfirm && bookingFooterSummary(stepFacts) && (
              <p className="mb-3 truncate text-[13px] text-[var(--v2-text-secondary)]">
                {bookingFooterSummary(stepFacts)}
              </p>
            )}
            {/* Delete confirmation overlay — becomes the refusal when the
                delete is blocked, so the answer replaces the question in place
                instead of appearing elsewhere in the dialog. */}
            {showDeleteConfirm ? (
              <div className="flex items-center justify-between gap-3">
                {deleteError ? (
                  <>
                    <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 flex-1">
                      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <span>{deleteError}</span>
                    </p>
                    <button
                      type="button"
                      onClick={dismissDeleteConfirm}
                      className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {t('button.close') || t('button.cancel')}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-red-600 dark:text-red-400 flex-1">
                      {t('scheduling.booking.delete_confirm_message')}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={dismissDeleteConfirm}
                        disabled={loading}
                        className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {t('button.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-all disabled:opacity-50"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <Trash2 className="h-4 w-4" />
                        {loading ? t('scheduling.booking.deleting') : t('scheduling.booking.confirm_delete')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                {/* Left side - Quick actions for existing bookings */}
                <div className="flex items-center gap-2">
                  {booking && showStatusActions && booking.status === 'confirmed' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleQuickAction('complete')}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-500/10 transition-all disabled:opacity-50"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('scheduling.booking.mark_completed')}
                      >
                        <CheckCircle className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('scheduling.booking.mark_completed')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNoShowConfirm(true)}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-600 hover:bg-amber-500/10 transition-all disabled:opacity-50"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('scheduling.booking.mark_no_show')}
                      >
                        <AlertCircle className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('scheduling.booking.mark_no_show')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCancelTarget(true)}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/10 transition-all disabled:opacity-50"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('scheduling.booking.cancel_booking')}
                      >
                        <XCircle className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('scheduling.booking.cancel_booking')}</span>
                      </button>
                    </>
                  )}
                  {booking && showStatusActions && (
                    <button
                      type="button"
                      onClick={() => { setDeleteError(null); setShowDeleteConfirm(true); }}
                      disabled={loading}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/10 transition-all disabled:opacity-50"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      title={t('scheduling.booking.delete_booking')}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('scheduling.booking.delete_booking')}</span>
                    </button>
                  )}
                </div>

                {/* The caller's own question, asked where the date is — see
                    `extraToggle`. In the footer because it is part of the
                    decision being confirmed, not part of describing the
                    appointment. */}
                {extraToggle && (
                  /*
                    `me-auto`, which is the whole placement rule.
                    ─────────────────────────────────────────────────────────
                    The footer is `justify-between`, and for a NEW booking the
                    quick-actions group beside it is empty — so three children
                    spread out left the question floating near the middle. A
                    margin on the inline END pins it to the inline START, which
                    is the LEFT in English and the RIGHT in Hebrew, without
                    either side being named.

                    A switch rather than a checkbox: it is a setting being
                    turned on, next to two buttons, and `Switch` already knows
                    which way its thumb travels in each script. No `dir`
                    wrapper here — that would neutralise the `:dir(rtl)` rule
                    the component carries and correct the same thing twice.
                  */
                  <div className="me-auto flex items-center gap-2.5">
                    <Switch
                      id="booking-extra-toggle"
                      checked={extraToggle.checked}
                      onCheckedChange={extraToggle.onChange}
                    />
                    <label
                      htmlFor="booking-extra-toggle"
                      className={`cursor-pointer text-sm ${
                        extraToggle.attention && !extraToggle.checked
                          ? 'booking-toggle-attention font-medium'
                          : 'text-[var(--v2-text-secondary)]'
                      }`}
                      style={
                        extraToggle.attention && !extraToggle.checked
                          ? /*
                             * Amber, the same one this card already uses for
                             * an overdue figure — money that needs an answer,
                             * not an error. Red would say something is wrong;
                             * nothing is, until the dialog is saved with the
                             * question unanswered.
                             *
                             * Inline rather than a token class so the colour
                             * and the pulse are switched by one condition and
                             * cannot drift apart.
                             */
                            { color: '#D97706' }
                          : undefined
                      }
                    >
                      {extraToggle.label}
                    </label>
                  </div>
                )}

                {/* Right side - Cancel and Save */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {t('button.cancel')}
                  </button>
                  <button
                    type="submit"
                    /* `serviceGaps` only ever holds BLOCKING gaps — the route
                       filters the advisory processor out — so anything in it is
                       a reason this booking cannot be honoured. */
                    /* Choosing a slot asks for a TIME and nothing else: the
                       client and the service come from the package, and a
                       contact with only a phone number has neither a first
                       name nor an email — which would have left this button
                       permanently dead. */
                    /* And the hour, now that it is no longer pre-filled: a
                       booking with a date step and no hour is refused by the
                       validator anyway, and a button you can press for an
                       answer the dialog already knows is wrong is a round trip
                       for nothing. */
                    disabled={
                      onPickSlot
                        ? loading || !formData.start_time
                        : loading ||
                          !formData.service_id ||
                          !formData.client_first_name ||
                          !formData.client_email ||
                          (needsSchedule && !formData.start_time) ||
                          serviceGaps.length > 0
                    }
                    className="px-4 py-2 text-sm font-medium text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {loading
                      ? t('scheduling.booking.saving')
                      : closedDay.closed
                        /*
                         * The confirmation IS this label.
                         *
                         * The warning by the date field says the day is closed;
                         * pressing a button that says "Book anyway" is the owner
                         * answering, and that is what sends `allow_closed_day`.
                         * A button still reading "Create booking" beside a
                         * warning is a warning nobody has agreed to.
                         */
                        ? t('scheduling.closed_book_anyway')
                        : booking
                          ? t('scheduling.booking.save_changes')
                          : /*
                             * ADDING A SESSION CREATES A MEETING, NOT AN ORDER.
                             *
                             * "צור הזמנה" is right when this dialog sells
                             * something: a booking is an order, and the client
                             * is agreeing to it. A seventh session of a package
                             * is neither — the order was placed when the quote
                             * was accepted, and this adds an hour to it.
                             *
                             * `onPickSlot` is exactly that caller: it wants an
                             * hour and writes no booking at all.
                             */
                            onPickSlot
                            ? t('scheduling.booking.create_meeting')
                            : t('scheduling.booking.create_booking')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
        <style jsx global>{`
          /* react-phone-number-input custom styling for Scheduling module (green theme) */
          .phone-input-scheduling {
            display: flex;
          }

          .phone-input-scheduling .PhoneInputCountry {
            display: none;
          }

          .phone-input-scheduling .PhoneInputInput {
            flex: 1;
            background: var(--v2-surface);
            border: 1px solid var(--v2-border);
            border-radius: var(--v2-radius-button);
            padding: 0.5rem 0.75rem;
            color: var(--v2-text-primary);
            font-size: 0.875rem;
            outline: none;
            transition: all 0.2s ease;
          }

          .phone-input-scheduling .PhoneInputInput:focus {
            border-color: #14B8A6;
            box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.2);
          }

          .phone-input-scheduling .PhoneInputInput::placeholder {
            color: var(--v2-text-muted);
          }

          /* Datetime input dark mode styling for scheduling */
          /*
           * ───────────────────────────────────────────────────────────────
           * THE CHARGE QUESTION, WHILE IT IS STILL UNANSWERED.
           *
           * On a package billed per session, leaving this off gives the
           * session away — so it is a decision, not a default, and it was
           * being missed. The only way back was to cancel the session and add
           * it again, which the client sees as two emails about one hour.
           *
           * It keeps pulsing until it is answered, by the owner's own
           * instruction — the question is worth money and this dialog is
           * saved in a hurry. The class is dropped the moment the switch is
           * turned on, so the movement stops when it has done its job rather
           * than on a timer.
           *
           * prefers-reduced-motion gets the emphasis without the movement —
           * the point is to be noticed, and for some people movement is the
           * one thing that makes a screen unusable.
           * ───────────────────────────────────────────────────────────────
           */
          .booking-toggle-attention {
            animation: bookingTogglePulse 1.1s ease-in-out infinite;
          }

          @keyframes bookingTogglePulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }

          @media (prefers-reduced-motion: reduce) {
            .booking-toggle-attention {
              animation: none;
            }
          }

          .datetime-input-scheduling {
            color-scheme: light;
          }

          :root.dark .datetime-input-scheduling,
          html.dark .datetime-input-scheduling,
          .dark .datetime-input-scheduling {
            color-scheme: dark;
          }

          /*
            NO "filter: invert(1)" HERE -- it is the same correction twice.

            "color-scheme: dark" above is what tells the engine to draw its own
            calendar button in light ink; that is the whole purpose of the
            property. Inverting it afterwards turned that light ink back to
            near-black, on a near-black field, so the button looked ABSENT
            rather than mis-styled -- and an invisible control is
            indistinguishable from a missing feature.

            The same pair cancelled each other in the quote dialog's date
            fields; components/ui/input.tsx carries the fix and
            dateFieldInDarkMode.guard.test.ts the reasoning.

            (No backticks in here: this block is a template literal, and one
            would end the string.)
          */
          :root.dark .datetime-input-scheduling::-webkit-calendar-picker-indicator,
          html.dark .datetime-input-scheduling::-webkit-calendar-picker-indicator,
          .dark .datetime-input-scheduling::-webkit-calendar-picker-indicator {
            cursor: pointer;
            opacity: 0.8;
          }

          :root.dark .datetime-input-scheduling::-webkit-calendar-picker-indicator:hover,
          html.dark .datetime-input-scheduling::-webkit-calendar-picker-indicator:hover,
          .dark .datetime-input-scheduling::-webkit-calendar-picker-indicator:hover {
            opacity: 1;
          }
        `}</style>
      </DialogContent>

      {/*
        Inside the booking Dialog, so it stacks above it rather than replacing
        it: the owner confirms and returns to the booking they were looking at.
      */}
      {/* Cancelling asks for a reason, mandatory on every cancellation surface. */}
      <CancelReasonDialog
        open={cancelTarget}
        onOpenChange={setCancelTarget}
        clientName={booking?.client_first_name ?? null}
        onConfirm={async ({ reasonCode, note, shareNote }) => {
          await handleQuickAction('cancel', { reason_code: reasonCode, reason: note || undefined, share_note_with_client: shareNote });
          setCancelTarget(false);
        }}
      />

      <NoShowConfirmDialog
        open={showNoShowConfirm}
        onOpenChange={setShowNoShowConfirm}
        clientName={[booking?.client_first_name, booking?.client_last_name].filter(Boolean).join(' ') || null}
        onConfirm={async ({ notifyClient }) => {
          await handleQuickAction('no-show', { notifyClient });
        }}
      />
    </Dialog>
  );
}
