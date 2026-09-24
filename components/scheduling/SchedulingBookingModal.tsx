'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { BookingStatus } from '@/lib/business-os/bookingStatus';
import {
  toBusinessLocalInput,
  fromBusinessLocalInput,
  safeTimezone,
  businessDateKey,
  businessInstant,
  shiftBusinessDateKey,
} from '@/lib/scheduling/businessTime';
import { JourneyGapNotice } from '@/components/business-os/setup/JourneyGapNotice';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Clock, User, Mail, Phone, Calendar, FileText, CheckCircle, XCircle, AlertCircle, Search, UserPlus, X, Plus, Globe, Facebook, MessageCircle, Users as UsersIcon, Check, Trash2, CreditCard, Tag, ClipboardList, Loader2 } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import en from 'react-phone-number-input/locale/en';
import 'react-phone-number-input/style.css';
import { SearchableCountrySelect } from '@/components/crm/SearchableCountrySelect';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { NoShowConfirmDialog } from '@/components/scheduling/NoShowConfirmDialog';
import {
  useConfigurationDialogOptional,
  useConfigurationDialogOpen,
} from '@/components/business-os/ConfigurationDialogProvider';
import { clientLogger } from '@/lib/logger/client';
import {
  businessCollectsIntake,
  intakeBlockReason,
  type IntakeBlockReason,
} from '@/lib/business-os/intakeReach';
import { createLogger } from '@/lib/logger';
import type { SchedulingBooking, SchedulingService } from '@/lib/repositories/SchedulingRepository';
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
function getDefaultTimes(availability: WeeklyAvailability | undefined, serviceDurationMinutes: number, timezone: string): { start: string; end: string } {
  const zone = timezone;
  const now = new Date();
  /*
   * The weekday WHERE THE BUSINESS IS, read off the same clock as the date
   * below.
   *
   * `now.getDay()` is the browser's. It was paired with a `dateKey` built from
   * `businessDateKey(now, zone)`, so the two could name different days: the
   * loop looked up Wednesday's opening hours and stamped them onto Thursday's
   * date. Silent, and only for a reader whose zone differs from the business's
   * across midnight — which is precisely the case this whole change exists for.
   */
  const today = new Date(`${businessDateKey(now, zone)}T00:00:00Z`).getUTCDay();

  // Try to find availability for today or the next available day
  for (let i = 0; i < 7; i++) {
    const dayIndex = (today + i) % 7;
    const dayKey = DAY_KEYS[dayIndex];
    const daySlots = availability?.[dayKey] || [];

    if (daySlots.length > 0) {
      const slot = daySlots[0];
      // The business's calendar date for this offset, and the window's opening
      // hour on the business's clock. `setHours` here wrote the browser's.
      const dateKey = shiftBusinessDateKey(businessDateKey(now, zone), i);
      const targetDate = businessInstant(dateKey, slot.start, zone);

      // If it's today and the start time has passed, try to find a slot that works
      if (i === 0 && targetDate < now) {
        /*
         * Now, rounded up to the next half hour — on the epoch, not with
         * `setMinutes`/`setHours`, which read and write the BROWSER's clock and
         * whose rollover also moved the date near midnight.
         */
        const HALF_HOUR = 30 * 60 * 1000;
        const roundedNow = new Date(Math.ceil(now.getTime() / HALF_HOUR) * HALF_HOUR);

        const slotEnd = businessInstant(dateKey, slot.end, zone);

        // Check if there's still time in today's slot
        if (roundedNow < slotEnd) {
          const endTime = new Date(roundedNow.getTime() + serviceDurationMinutes * 60 * 1000);
          // Make sure end time doesn't exceed slot end
          if (endTime <= slotEnd) {
            return {
              start: formatDateTimeLocal(roundedNow, zone),
              end: formatDateTimeLocal(endTime, zone)
            };
          }
        }
        // Today's slot is not available, continue to next day
        continue;
      }

      // Return the start of the available slot
      const endTime = new Date(targetDate.getTime() + serviceDurationMinutes * 60 * 1000);
      return {
        start: formatDateTimeLocal(targetDate, zone),
        end: formatDateTimeLocal(endTime, zone)
      };
    }
  }

  /*
   * Fallback: nine tomorrow, on the BUSINESS's calendar.
   *
   * `setDate`/`setHours` built that on the browser's, which near midnight is a
   * different day and, for an owner away from the business, a different hour.
   */
  const tomorrow = businessInstant(shiftBusinessDateKey(businessDateKey(now, zone), 1), '09:00', zone);
  const endTime = new Date(tomorrow.getTime() + serviceDurationMinutes * 60 * 1000);

  return {
    start: formatDateTimeLocal(tomorrow, zone),
    end: formatDateTimeLocal(endTime, zone)
  };
}

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
    if (booking.status === 'cancelled' || booking.status === 'no_show') return false;

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
  externalBusySlots: ExternalBusySlot[] = []
): QuickPickSlot[] {
  if (!availability) return [];

  const slots: QuickPickSlot[] = [];
  const zone = safeTimezone(timezone);
  const now = new Date();
  /*
   * Which day it is WHERE THE WORK HAPPENS.
   *
   * `now.getDay()` answers for the browser, and at 9pm in New York it is
   * already tomorrow in Tel Aviv — so the builder read Monday's hours while
   * offering Tuesday's dates. The weekday is taken from the business's own
   * calendar date for the same reason every other time here is.
   */
  const todayKey = businessDateKey(now, zone);
  const today = new Date(`${todayKey}T00:00:00Z`).getUTCDay();

  // Look ahead up to 14 days
  for (let dayOffset = 0; dayOffset < 14 && slots.length < maxSlots; dayOffset++) {
    const dayIndex = (today + dayOffset) % 7;
    const dayKey = DAY_KEYS[dayIndex];
    const daySlots = availability[dayKey] || [];

    if (daySlots.length === 0) continue;

    // The business's calendar date for this offset, as a key the slot builder
    // below turns into instants. `setDate` on a browser Date would reintroduce
    // the browser's clock.
    const dateKey = shiftBusinessDateKey(todayKey, dayOffset);

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
  services,
  servicesLoading = false,
  isOpen,
  onClose,
  onBookingUpdated,
  availability,
  prefilledDateTime,
  prefilledContact,
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
  // Get browser timezone synchronously as initial default
  const browserTimezone = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';
  const [formData, setFormData] = useState({
    service_id: '',
    contact_id: '' as string | null,
    client_first_name: '',
    client_last_name: '',
    client_email: '',
    client_phone: '',
    start_time: '',
    end_time: '',
    timezone: browserTimezone,
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
  const [phoneCountry, setPhoneCountry] = useState<Country>('US');
  const [sendIntakeForm, setSendIntakeForm] = useState(false);

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

  /**
   * Does the time currently in the form collide with something already booked?
   *
   * Uses the same predicate as the quick-pick row, so the warning and the
   * offered slots can never disagree. The booking being edited is excluded —
   * its own slot is not a conflict with itself.
   */
  const timeAlreadyBooked = (() => {
    if (!formData.start_time || !formData.end_time) return false;
    const start = parseDateTimeLocal(formData.start_time, zone);
    const end = new Date(formData.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    return isSlotBooked(start, end, existingBookings, booking?.id);
  })();

  // Fetch user's timezone from profile (non-blocking - dialog opens immediately with browser timezone,
  // then updates to profile timezone when available)
  useEffect(() => {
    if (!isOpen) return; // Only fetch when modal is open

    const fetchUserTimezone = async () => {
      try {
        const response = await fetch('/api/user/profile');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.profile?.timezone) {
            // Update form with user's configured timezone
            setFormData(prev => ({ ...prev, timezone: data.profile.timezone }));
          }
        }
      } catch (error) {
        // Silently fail - browser timezone is already set as fallback
        console.error('Failed to fetch user timezone:', error);
      }
    };
    fetchUserTimezone();
  }, [isOpen]);

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
        clientLogger.error({ err: error }, 'Failed to fetch intake settings');
        setIntakeConfigured(false);
      }
  }, []);

  // Fetch intake configuration status
  useEffect(() => {
    if (!isOpen) return;
    void refreshIntakeSettings();
  }, [isOpen, refreshIntakeSettings]);

  useEffect(() => {
    // Clear form errors when modal opens/closes or booking changes
    setFormErrors({});
    setDeleteError(null);
    setShowDeleteConfirm(false);

    if (booking) {
      // Use formatDateTimeLocal to convert UTC times to local datetime-local format
      setFormData({
        service_id: booking.service_id,
        contact_id: booking.contact_id || null,
        client_first_name: booking.client_first_name,
        client_last_name: booking.client_last_name || '',
        client_email: booking.client_email,
        client_phone: booking.client_phone || '',
        start_time: formatDateTimeLocal(new Date(booking.start_time), zone),
        end_time: formatDateTimeLocal(new Date(booking.end_time), zone),
        timezone: booking.timezone || 'UTC',
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
      // Get first active service for defaults
      const activeServices = services.filter(s => s.status === 'active');
      const defaultService = activeServices[0];
      const serviceDuration = defaultService?.duration_minutes || 60;

      let startTime: string;
      let endTime: string;

      // If prefilled from calendar slot click, use that
      if (prefilledDateTime) {
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
      } else {
        /*
         * The first slot that is actually FREE, not the first the calendar allows.
         *
         * `getDefaultTimes` reads the weekly availability and nothing else, so it
         * proposed the opening of the next working day whether or not somebody
         * was already booked into it. The owner opened the dialog and was handed
         * a time they had sold — and the quick-pick row underneath, which does
         * consult the bookings, disagreed with the field above it.
         *
         * `getNextAvailableSlots` is that same filter, already written and
         * already correct: it skips existing bookings (ignoring cancelled and
         * no-show) and external busy time. Taking its first result means one
         * definition of "free" rather than two that drift.
         *
         * It falls back to `getDefaultTimes` when there is no availability
         * configured at all, which is the case that function exists for.
         */
        // Nothing computed against the placeholder: see `zoneReady`.
        const [firstFree] = zoneReady
          ? getNextAvailableSlots(availability, serviceDuration, zone, 1, existingBookings, externalBusySlots)
          : [];

        if (firstFree) {
          startTime = formatDateTimeLocal(firstFree.start, zone);
          endTime = formatDateTimeLocal(firstFree.end, zone);
        } else {
          const defaultTimes = getDefaultTimes(availability, serviceDuration, zone);
          startTime = defaultTimes.start;
          endTime = defaultTimes.end;
        }
      }

      // If prefilled contact provided, use it
      if (prefilledContact) {
        setFormData({
          service_id: defaultService?.id || '',
          contact_id: prefilledContact.id,
          client_first_name: prefilledContact.first_name,
          client_last_name: prefilledContact.last_name || '',
          client_email: prefilledContact.email,
          client_phone: prefilledContact.phone || '',
          start_time: startTime,
          end_time: endTime,
          timezone: browserTimezone,
          notes: '',
          status: 'confirmed'
        });
        setShowClientSearch(false); // Hide search when contact is prefilled
        setSelectedContact({
          id: prefilledContact.id,
          first_name: prefilledContact.first_name,
          last_name: prefilledContact.last_name,
          email: prefilledContact.email,
          phone: prefilledContact.phone
        });
      } else {
        setFormData({
          service_id: defaultService?.id || '',
          contact_id: null,
          client_first_name: '',
          client_last_name: '',
          client_email: '',
          client_phone: '',
          start_time: startTime,
          end_time: endTime,
          timezone: browserTimezone,
          notes: '',
          status: 'confirmed'
        });
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
  }, [booking, services, availability, prefilledDateTime, prefilledContact, browserTimezone, zone, zoneReady]);

  // Handle late-loading services: if service_id is empty but services just loaded, set the default
  useEffect(() => {
    if (!booking && !formData.service_id && services.length > 0) {
      const activeServices = services.filter(s => s.status === 'active');
      const defaultService = activeServices[0];
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
  }, [booking, services, formData.service_id]);

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
      } catch (error) {
        // Silently fail - external busy slots are optional
        console.debug('Failed to fetch external busy slots:', error);
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
    } catch (error) {
      console.error('Failed to search clients:', error);
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
    if (service && !booking) {
      const start = parseDateTimeLocal(formData.start_time, zone);
      const end = new Date(start.getTime() + service.duration_minutes * 60 * 1000);
      setFormData(prev => ({
        ...prev,
        service_id: serviceId,
        end_time: formatDateTimeLocal(end, zone)
      }));
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

    const startDate = new Date(newStartTime);
    const endDate = new Date(startDate.getTime() + serviceDuration * 60 * 1000);

    setFormData(prev => ({
      ...prev,
      start_time: newStartTime,
      end_time: formatDateTimeLocal(endDate, zone)
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

    if (!formData.start_time) {
      errors.start_time = t('scheduling.booking.error_start_required') || 'Start time is required';
    } else {
      const startTime = parseDateTimeLocal(formData.start_time, zone);
      const now = new Date();
      if (!booking && startTime < now) {
        errors.start_time = t('scheduling.booking.error_past_time') || 'Cannot book in the past';
      }
    }

    if (!formData.end_time) {
      errors.end_time = t('scheduling.booking.error_end_required') || 'End time is required';
    } else if (formData.start_time) {
      const startTime = parseDateTimeLocal(formData.start_time, zone);
      const endTime = new Date(formData.end_time);
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
    if (!isSettled && serviceGaps.length > 0) return;

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
      const url = booking ? `/api/scheduling/bookings/${booking.id}` : '/api/scheduling/bookings';
      const method = booking ? 'PUT' : 'POST';

      // Build request body
      const requestBody: Record<string, any> = {
        service_id: formData.service_id,
        contact_id: formData.contact_id || undefined,
        client_first_name: formData.client_first_name,
        client_last_name: formData.client_last_name || undefined,
        client_email: formData.client_email,
        client_phone: formData.client_phone || undefined,
        start_time: parseDateTimeLocal(formData.start_time, zone).toISOString(),
        end_time: parseDateTimeLocal(formData.end_time, zone).toISOString(),
        timezone: formData.timezone,
        notes: formData.notes || undefined
      };

      // If editing a no-show booking with new time, auto-confirm it (rescheduling)
      if (booking && booking.status === 'no_show') {
        const originalStart = new Date(booking.start_time).getTime();
        const newStart = new Date(formData.start_time).getTime();
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
      } else {
        // Handle error response - show user-friendly error message
        const errorMessage = data.message || data.error || t('scheduling.booking.save_failed');
        setFormErrors({ submit: errorMessage });
      }
    } catch (error) {
      console.error('Failed to save booking:', error);
      setFormErrors({ submit: t('scheduling.booking.save_failed') });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = async (
    action: 'cancel' | 'complete' | 'no-show',
    options?: { notifyClient?: boolean }
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
    } catch (error) {
      console.error(`Failed to ${action} booking:`, error);
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
        className="w-full sm:max-w-3xl lg:max-w-4xl h-[100vh] sm:h-auto sm:max-h-[92dvh] flex flex-col bg-[var(--v2-surface)] border-[var(--v2-border)] p-0 overflow-hidden"
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
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          {/* Service Selection */}
          <div className="space-y-3 sm:space-y-4">
            <h3 className="text-xs sm:text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t('scheduling.booking.service_section')}
            </h3>
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                {t('scheduling.booking.service')} <span className="text-red-500">*</span>
              </label>
              <Select
                value={formData.service_id}
                onValueChange={handleServiceChange}
                disabled={!!booking}
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

          {/* Client Info Section */}
          <div className="space-y-3 sm:space-y-4">
            <h3 className="text-xs sm:text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
              <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t('scheduling.booking.client_info')}
            </h3>

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

                {/* Divider with "or" */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[var(--v2-border)]" />
                  <span className="text-xs text-[var(--v2-text-muted)]">{t('scheduling.booking.or')}</span>
                  <div className="flex-1 h-px bg-[var(--v2-border)]" />
                </div>

                {/* Add New Client Button */}
                <button
                  type="button"
                  onClick={() => setShowClientSearch(false)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-[#14B8A6] bg-[#14B8A6]/10 border border-[#14B8A6]/30 hover:bg-[#14B8A6]/20 transition-all"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <UserPlus className="h-4 w-4" />
                  {t('scheduling.booking.add_new_client')}
                </button>
              </div>
            )}

            {/* Manual Client Entry Form (shown when not searching or editing) */}
            {(!showClientSearch || booking) && !selectedContact && (
              <>
                {/* Back to search button for new bookings */}
                {!booking && (
                  <button
                    type="button"
                    onClick={() => setShowClientSearch(true)}
                    className="text-sm text-[#14B8A6] hover:underline flex items-center gap-1"
                  >
                    <Search className="h-3.5 w-3.5" />
                    {t('scheduling.booking.search_existing_client')}
                  </button>
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
                    <SearchableCountrySelect
                      value={phoneCountry}
                      onChange={setPhoneCountry}
                      labels={en}
                    />
                    <PhoneInput
                      international
                      countryCallingCodeEditable={false}
                      country={phoneCountry}
                      value={formData.client_phone}
                      onChange={(value) => setFormData(prev => ({ ...prev, client_phone: value || '' }))}
                      className="phone-input-scheduling flex-1"
                    />
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

          {/* Quick Pick Available Slots - Show for both new and editing bookings */}
          {availability && (
            (() => {
              const serviceDuration = services.find(s => s.id === formData.service_id)?.duration_minutes || 60;
              // Not offered until the zone is known: a chip labelled from the
              // UTC placeholder names the wrong day. See `zoneReady`.
              const quickSlots = zoneReady
                ? getNextAvailableSlots(availability, serviceDuration, zone, 6, existingBookings, externalBusySlots)
                : [];

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

          {/* Availability Info for Selected Day - Show for both new and editing bookings */}
          {formData.start_time && availability && (
            <div className="p-3 bg-[#14B8A6]/10 border border-[#14B8A6]/30" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-[#14B8A6]" />
                <span className="font-medium text-[#0D9488]">{t('scheduling.booking.available_hours')}:</span>
                {(() => {
                  const selectedDate = new Date(formData.start_time);
                  const dayAvailability = getAvailabilityForDay(selectedDate, availability, zone);
                  if (dayAvailability) {
                    return (
                      <span className="text-[var(--v2-text-primary)]" dir="ltr">
                        {formatTimeDisplay(dayAvailability.start)} - {formatTimeDisplay(dayAvailability.end)}
                      </span>
                    );
                  }
                  return <span className="text-[var(--v2-text-muted)]">{t('scheduling.booking.no_availability')}</span>;
                })()}
              </div>
            </div>
          )}

          {/* Time Section */}
          <div className="space-y-3 sm:space-y-4">
            <h3 className="text-xs sm:text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t('scheduling.booking.time_section')}
              {/* Show indicator when time editing is disabled (only for completed/cancelled) */}
              {isSettled && (
                <span className="text-xs font-normal text-[var(--v2-text-muted)] normal-case">
                  ({t('scheduling.booking.time_locked')})
                </span>
              )}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-[var(--v2-text-primary)] mb-1.5 sm:mb-2">
                  {t('scheduling.booking.start_time')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={formData.start_time}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  min={!booking ? formatDateTimeLocal(new Date(), zone) : undefined}
                  disabled={isSettled}
                  className={`datetime-input-scheduling w-full px-4 py-2.5 bg-[var(--v2-bg)] border text-[var(--v2-text-primary)] text-sm focus:outline-none focus:ring-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-[var(--v2-bg)]/50 ${
                    formErrors.start_time
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                      : 'border-[var(--v2-border)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)', colorScheme: 'inherit' }}
                />
                {formErrors.start_time ? (
                  <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {formErrors.start_time}
                  </p>
                ) : timeAlreadyBooked ? (
                  /*
                   * Said before Save, not after.
                   *
                   * The server refuses an overlap with a 409, so this was never
                   * a way to double-book — but the owner only found out once
                   * they had filled the whole form. It also covers the case the
                   * default cannot: the bookings list arrives from a secondary
                   * fetch, so a dialog opened quickly may have chosen its
                   * default before there was anything to check against.
                   */
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {t('scheduling.booking.time_already_booked')}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-medium text-[var(--v2-text-primary)] mb-1.5 sm:mb-2">
                  {t('scheduling.booking.end_time')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, end_time: e.target.value }));
                    setFormErrors(prev => ({ ...prev, end_time: '' }));
                  }}
                  min={formData.start_time || (!booking ? formatDateTimeLocal(new Date(), zone) : undefined)}
                  disabled={isSettled}
                  className={`datetime-input-scheduling w-full px-4 py-2.5 bg-[var(--v2-bg)] border text-[var(--v2-text-primary)] text-sm focus:outline-none focus:ring-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-[var(--v2-bg)]/50 ${
                    formErrors.end_time
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                      : 'border-[var(--v2-border)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)', colorScheme: 'inherit' }}
                />
                {formErrors.end_time && (
                  <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {formErrors.end_time}
                  </p>
                )}
              </div>
            </div>
          </div>

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
          {formData.service_id && (!booking || (booking && !booking.intake_responses && !booking.intake_completed_at)) && (
              <div
                className={`flex items-center justify-between p-4 bg-[var(--v2-surface)] border ${
                  intakeConfigured === false ? 'border-amber-500/50' : 'border-[var(--v2-border)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    intakeConfigured === false ? 'bg-amber-500/10 text-amber-500' : 'bg-[#14B8A6]/10 text-[#14B8A6]'
                  }`}>
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div>
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

          </div>

          {/* Sticky Footer */}
          <div className="flex-shrink-0 border-t border-[var(--v2-border)] bg-[var(--v2-surface)] px-4 sm:px-6 py-3 sm:py-4">
            {/* Submit error message */}
            {formErrors.submit && (
              <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-lg">
                {formErrors.submit}
              </div>
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
                  {booking && booking.status === 'confirmed' && (
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
                        onClick={() => handleQuickAction('cancel')}
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
                  {booking && (
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
                    disabled={
                      loading ||
                      !formData.service_id ||
                      !formData.client_first_name ||
                      !formData.client_email ||
                      serviceGaps.length > 0
                    }
                    className="px-4 py-2 text-sm font-medium text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {loading
                      ? t('scheduling.booking.saving')
                      : booking
                        ? t('scheduling.booking.save_changes')
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
          .datetime-input-scheduling {
            color-scheme: light;
          }

          :root.dark .datetime-input-scheduling,
          html.dark .datetime-input-scheduling,
          .dark .datetime-input-scheduling {
            color-scheme: dark;
          }

          :root.dark .datetime-input-scheduling::-webkit-calendar-picker-indicator,
          html.dark .datetime-input-scheduling::-webkit-calendar-picker-indicator,
          .dark .datetime-input-scheduling::-webkit-calendar-picker-indicator {
            filter: invert(1) brightness(0.8);
            cursor: pointer;
            opacity: 0.7;
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
