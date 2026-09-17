'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SchedulingCalendarView } from '@/components/scheduling/SchedulingCalendarView';
import { SchedulingBookingModal } from '@/components/scheduling/SchedulingBookingModal';
import { Calendar, Plus, Loader2, X, Search, UserPlus } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { businessDayFor, wallClockToUtc } from '@/lib/business-os/businessDay';
import { safeTimezone, toBusinessLocalInput, businessDateKey, businessInstant, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';
import { DEFAULT_AVAILABILITY, parseAvailability, type WeeklyAvailability } from '@/components/scheduling/AvailabilityEditor';
import type { SchedulingService, SchedulingBooking } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'SchedulingDialog' });

// Scheduling theme color: Teal
const SCHEDULING_COLOR = '#14B8A6';

// Day name mapping for WeeklyAvailability keys
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

// Locale map for date formatting
const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  he: 'he-IL'
};

/**
 * Format a Date for a `datetime-local` input (YYYY-MM-DDTHH:MM).
 *
 * The input has no concept of a zone — it shows exactly the string it is given
 * — so the string must already be the BUSINESS's wall clock. This was built
 * from `getFullYear`/`getHours`, which is the browser's, so an owner away from
 * the business's zone opened the form pre-filled with the wrong hour and, near
 * midnight, the wrong day.
 */
function formatDateTimeLocal(date: Date, timezone: string): string {
  return toBusinessLocalInput(date, timezone);
}

/**
 * The DAY a slot falls on, where the business is.
 *
 * Without `timeZone` this answers in the reader's zone, and near either end of
 * the day the two disagree about the date itself — a nine o'clock Monday
 * appointment in New York is Monday afternoon in Jerusalem, but a six o'clock
 * evening one is already Tuesday. Getting the hour right and the weekday wrong
 * is a worse failure than getting both wrong, because it looks correct.
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

interface CRMContact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
}

interface QuickPickSlot {
  dayOffset: number;
  start: Date;
  end: Date;
}

interface SchedulingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: string; // ISO date string to focus on
  initialBookingId?: string; // Booking ID to view/edit
  onBookingCreated?: () => void;
  onBookingUpdated?: () => void;
}

// Check if a time slot overlaps with any existing booking
function isSlotBooked(
  slotStart: Date,
  slotEnd: Date,
  existingBookings: SchedulingBooking[]
): boolean {
  // Convert local slot times to UTC ISO strings for comparison
  const slotStartUTC = slotStart.toISOString();
  const slotEndUTC = slotEnd.toISOString();

  return existingBookings.some(booking => {
    if (booking.status === 'cancelled' || booking.status === 'no_show') return false;
    // booking.start_time and booking.end_time are already UTC ISO strings
    // Overlap check: slot_start < booking_end AND slot_end > booking_start
    return slotStartUTC < booking.end_time && slotEndUTC > booking.start_time;
  });
}

/**
 * The next bookable slots, in the BUSINESS's timezone.
 *
 * Availability is stored as wall-clock strings — "09:00" means nine in the
 * morning where the business is — so turning one into a real moment needs that
 * zone and nothing else. This built them with `setHours` instead, which uses
 * whichever zone the reader's browser is in: a New York business viewed from
 * Jerusalem was offered 09:00–17:00 Israel time, which is 02:00–10:00 at home,
 * almost entirely outside the hours it actually works.
 *
 * Bookings are stored as UTC instants, so comparison needs no conversion once
 * the slot is a real instant rather than a browser-local guess.
 */
function getNextAvailableSlots(
  availability: WeeklyAvailability | undefined,
  serviceDurationMinutes: number,
  maxSlots: number = 4,
  existingBookings: SchedulingBooking[] = [],
  timezone: string = 'UTC'
): QuickPickSlot[] {
  if (!availability) return [];

  const slots: QuickPickSlot[] = [];
  const now = new Date();

  for (let dayOffset = 0; dayOffset < 14 && slots.length < maxSlots; dayOffset++) {
    /*
     * Which day this is WHERE THE BUSINESS IS.
     *
     * `now.getDay()` gave the browser's answer, so for most of the evening a
     * Jerusalem reader was looking up tomorrow's opening hours against a New
     * York business still working today.
     *
     * The weekday is read off the business's own date string at midday UTC —
     * far enough from either boundary that no offset can push it onto the
     * neighbouring day.
     */
    const day = businessDayFor(now, timezone, dayOffset);
    const [dayYear, dayMonth, dayDate] = day.date.split('-').map(Number);
    const dayKey = DAY_KEYS[new Date(`${day.date}T12:00:00Z`).getUTCDay()];
    const daySlots = availability[dayKey] || [];

    if (daySlots.length === 0) continue;

    for (const slot of daySlots) {
      if (slots.length >= maxSlots) break;

      const [startHour, startMinute] = slot.start.split(':').map(Number);
      const [endHour, endMinute] = slot.end.split(':').map(Number);

      let currentStart = wallClockToUtc(dayYear, dayMonth, dayDate, startHour, startMinute, timezone);
      const slotEnd = wallClockToUtc(dayYear, dayMonth, dayDate, endHour, endMinute, timezone);

      // For today, skip past time slots
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

      // Generate 30-minute slots within the availability window
      while (slots.length < maxSlots) {
        const potentialEnd = new Date(currentStart.getTime() + serviceDurationMinutes * 60 * 1000);
        if (potentialEnd > slotEnd) break;

        // isSlotBooked handles UTC conversion internally
        if (!isSlotBooked(currentStart, potentialEnd, existingBookings)) {
          slots.push({
            dayOffset,
            start: new Date(currentStart),
            end: new Date(potentialEnd)
          });
        }
        currentStart = new Date(currentStart.getTime() + 30 * 60 * 1000);
      }
    }
  }

  return slots;
}

export function SchedulingDialog({
  isOpen,
  onClose,
  onBookingCreated,
}: SchedulingDialogProps) {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [bookings, setBookings] = useState<SchedulingBooking[]>([]);
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);
  /*
   * The zone the business works in — not the one the reader is sitting in.
   *
   * Availability is wall-clock ("09:00" = nine where the business is) and every
   * displayed time is read against this, so both the slots offered and the
   * hours shown are meaningless without it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THIS USED TO BE TWO STATES, AND THEY DISAGREED
   *
   * There was a `bookingTimezone` fed from the availability API, which reads
   * `user_preferences.timezone`, AND a `timezone` seeded from the BROWSER and
   * then replaced from `/api/user/profile`, which reads `profiles.timezone`.
   * Two columns, two fetches, one component: the slot builder used one and the
   * modals were handed the other.
   *
   * The two columns had genuinely drifted — three accounts read
   * `profiles = Asia/Jerusalem` against `user_preferences = UTC` — so this was
   * not a theoretical hazard. `/api/user/profile` now mirrors a timezone change
   * into `user_preferences`, and this component reads that one source, arriving
   * with the availability it describes.
   *
   * `UTC` until it arrives rather than the browser's zone, deliberately: a
   * placeholder that happens to be right for an owner sitting in the office is
   * one that hides the bug until they travel.
   */
  const [timezone, setTimezone] = useState<string>('UTC');
  /**
   * Has the real zone arrived yet?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE PLACEHOLDER WAS BEING USED AS AN ANSWER
   *
   * `timezone` starts at `UTC` and is replaced a moment later by the value the
   * availability fetch carries. For DISPLAY that placeholder is harmless — a
   * label is briefly wrong and then corrects itself.
   *
   * The quick-pick builder is different: it uses the zone to decide WHICH DAY
   * IS TODAY, and then labels its slots "Today" and "Tomorrow" from that. At
   * 9pm in New York it is already the next day in UTC, so the placeholder run
   * produced slots stamped `dayOffset: 0` whose real date was tomorrow. The
   * chip read "Today" while the Start Time field beneath it — correctly zoned —
   * read tomorrow. Two controls, one slot, two different days.
   *
   * The memo re-runs when the zone lands, but the form is initialised from the
   * FIRST result, so the wrong day was already in the inputs.
   *
   * So the builder waits. A placeholder is fine to show and not fine to compute
   * with.
   */
  const [timezoneReady, setTimezoneReady] = useState(false);

  // Side panel booking form state
  /** The slot a click landed on, handed to the shared modal as its start time. */
  const [prefilledSlot, setPrefilledSlot] = useState<{ date: Date; hour: number } | undefined>();
  const [formData, setFormData] = useState({
    service_id: '',
    contact_id: null as string | null,
    client_first_name: '',
    client_last_name: '',
    client_email: '',
    client_phone: '',
    start_time: '',
    end_time: '',
    notes: ''
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Client search state
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<CRMContact[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showClientSearch, setShowClientSearch] = useState(true);
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Edit booking modal state
  const [editingBooking, setEditingBooking] = useState<SchedulingBooking | undefined>(undefined);
  const [showEditModal, setShowEditModal] = useState(false);

  // Fetch data when dialog opens - all requests in parallel for performance
  useEffect(() => {
    if (isOpen) {
      fetchAllData();
    }
  }, [isOpen]);

  // Reset when the dialog closes.
  useEffect(() => {
    if (!isOpen) {
      setShowEditModal(false);
      setEditingBooking(undefined);
      setPrefilledSlot(undefined);
      resetForm();
    }
  }, [isOpen]);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      // Fetch all data in parallel to minimize total wait time
      const [servicesResponse, bookingsResponse, availabilityResponse] = await Promise.all([
        fetch('/api/scheduling/services'),
        fetch('/api/scheduling/bookings'),
        fetch('/api/scheduling/availability')
      ]);

      const [servicesData, bookingsData, availabilityData] = await Promise.all([
        servicesResponse.json(),
        bookingsResponse.json(),
        availabilityResponse.json()
      ]);

      // Debug logging
      console.log('📊 SchedulingDialog fetchAllData:', {
        servicesCount: servicesData.success ? servicesData.services?.length : 0,
        bookingsCount: bookingsData.success ? bookingsData.bookings?.length : 0,
        bookingsData: bookingsData.success ? bookingsData.bookings : null,
        availabilityExists: availabilityData.success && !!availabilityData.availability
      });

      if (servicesData.success) setServices(servicesData.services);
      if (bookingsData.success) {
        console.log('📅 Setting bookings:', bookingsData.bookings);
        setBookings(bookingsData.bookings);
      }
      if (availabilityData.success && availabilityData.availability) {
        const parsed = parseAvailability(availabilityData.availability);
        console.log('⏰ AVAILABILITY DEBUG:', {
          raw: availabilityData.availability,
          parsed,
          today: DAY_KEYS[new Date().getDay()],
          todaySlots: parsed[DAY_KEYS[new Date().getDay()]]
        });
        setAvailability(parsed);
        if (availabilityData?.timezone) setTimezone(safeTimezone(availabilityData.timezone as string));
        // Ready even when the response carried no zone: UTC is then the real
        // answer for this business, not a placeholder standing in for one.
        setTimezoneReady(true);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch scheduling data');
    } finally {
      setLoading(false);
    }
  };

  const refreshBookingsSilently = async () => {
    try {
      const response = await fetch('/api/scheduling/bookings');
      const data = await response.json();
      if (data.success) setBookings(data.bookings);
    } catch (error) {
      logger.error({ err: error }, 'Failed to refresh bookings');
    }
  };

  const resetForm = () => {
    setFormData({
      service_id: '',
      contact_id: null,
      client_first_name: '',
      client_last_name: '',
      client_email: '',
      client_phone: '',
      start_time: '',
      end_time: '',
      notes: ''
    });
    setSelectedContact(null);
    setClientSearchQuery('');
    setClientSearchResults([]);
    setShowClientSearch(true);
    setFormError(null);
  };

  const initializeNewBookingForm = (prefillDate?: Date, prefillHour?: number) => {
    const activeServices = services.filter(s => s.status === 'active');
    const defaultService = activeServices[0];
    const serviceDuration = defaultService?.duration_minutes || 60;

    let startTime: string;
    let endTime: string;

    if (prefillDate && prefillHour !== undefined) {
      /*
       * The cell the owner clicked, as the instant it means.
       *
       * `prefillHour` is the grid's hour, and the grid's hours are the
       * BUSINESS's — they come from its availability. `setHours` wrote that
       * number onto the browser's clock instead, so clicking the 2pm cell from
       * another zone created a booking at 2pm THERE.
       *
       * The date comes off `prefillDate`'s calendar fields rather than by
       * converting it: it is a browser-local midnight standing for a column, so
       * the fields are the day meant and the instant is not.
       */
      const cellKey = `${prefillDate.getFullYear()}-${String(prefillDate.getMonth() + 1).padStart(2, '0')}-${String(prefillDate.getDate()).padStart(2, '0')}`;
      const startDate = businessInstant(cellKey, `${String(prefillHour).padStart(2, '0')}:00`, timezone);
      const endDate = new Date(startDate.getTime() + serviceDuration * 60 * 1000);
      startTime = formatDateTimeLocal(startDate, timezone);
      endTime = formatDateTimeLocal(endDate, timezone);
    } else {
      /*
       * Default to the first available slot — but only once the zone is known.
       *
       * Same reason the quick-pick memo waits: this builder decides which day
       * is today from the zone, and against the UTC placeholder it pre-filled
       * the form with the wrong day. See `timezoneReady`.
       */
      const quickSlots = timezoneReady
        ? getNextAvailableSlots(availability, serviceDuration, 1, bookings, timezone)
        : [];

      if (quickSlots.length > 0) {
        startTime = formatDateTimeLocal(quickSlots[0].start, timezone);
        endTime = formatDateTimeLocal(quickSlots[0].end, timezone);
      } else {
        /*
         * Nine tomorrow, on the BUSINESS's calendar.
         *
         * `setDate`/`setHours` built that on the browser's, which near midnight
         * is a different day and, for a travelling owner, a different hour.
         */
        const tomorrowKey = shiftBusinessDateKey(businessDateKey(new Date(), timezone), 1);
        const tomorrow = businessInstant(tomorrowKey, '09:00', timezone);
        const endDate = new Date(tomorrow.getTime() + serviceDuration * 60 * 1000);
        startTime = formatDateTimeLocal(tomorrow, timezone);
        endTime = formatDateTimeLocal(endDate, timezone);
      }
    }

    setFormData({
      service_id: defaultService?.id || '',
      contact_id: null,
      client_first_name: '',
      client_last_name: '',
      client_email: '',
      client_phone: '',
      start_time: startTime,
      end_time: endTime,
      notes: ''
    });
    setShowClientSearch(true);
    setSelectedContact(null);
  };

  /*
   * One booking dialog, reached three ways.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Clicking an existing booking opened `SchedulingBookingModal`. Clicking an
   * empty slot, or "new booking", opened a 327-line form written into this file
   * instead — a second implementation of the same act.
   *
   * They had drifted, as two of anything do. The shared modal has the quick-pick
   * slots, the conflict warning, the intake toggle, contact search, payment
   * plans, and its strings come from the translation dictionary; this panel had
   * none of that and spelled its own labels inline as
   * `language === 'he' ? 'ביטול' : 'Cancel'`. Every fix made to booking went to
   * the modal, and the calendar quietly did not receive any of them.
   *
   * The modal already accepts `prefilledDateTime`, which is exactly what a slot
   * click has to say. So the panel is gone and all three routes arrive at the
   * same dialog.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const handleSlotClick = (date: Date, hour: number) => {
    setEditingBooking(undefined);
    setPrefilledSlot({ date, hour });
    setShowEditModal(true);
  };

  const handleNewBooking = () => {
    setEditingBooking(undefined);
    setPrefilledSlot(undefined);
    setShowEditModal(true);
  };

  const handleBookingClick = (booking: SchedulingBooking) => {
    /*
     * A backstop, not the gate.
     *
     * The calendar already refuses the click and drops the pointer cursor for a
     * completed booking, which is what the reader actually experiences. This is
     * here so that a future caller of `onBookingClick` — another view, a
     * keyboard handler — cannot reopen an editor over a settled meeting just by
     * forgetting the rule.
     */
    if (booking.status === 'completed') return;

    setEditingBooking(booking);
    setShowEditModal(true);
  };

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
      logger.error({ err: error }, 'Failed to search clients');
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

  const handleServiceChange = (serviceId: string) => {
    const service = services.find(s => s.id === serviceId);
    if (service) {
      const start = new Date(formData.start_time);
      const end = new Date(start.getTime() + (service.duration_minutes || 0) * 60 * 1000);
      setFormData(prev => ({
        ...prev,
        service_id: serviceId,
        end_time: formatDateTimeLocal(end, timezone)
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);

    try {
      // Debug logging
      console.log('📅 Creating booking:', {
        startTime: formData.start_time,
        endTime: formData.end_time,
        startISO: new Date(formData.start_time).toISOString(),
        endISO: new Date(formData.end_time).toISOString(),
        currentBookings: bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show').map(b => ({
          start: b.start_time,
          end: b.end_time,
          status: b.status
        }))
      });

      const response = await fetch('/api/scheduling/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: formData.service_id,
          contact_id: formData.contact_id || undefined,
          client_first_name: formData.client_first_name,
          client_last_name: formData.client_last_name || undefined,
          client_email: formData.client_email,
          client_phone: formData.client_phone || undefined,
          start_time: new Date(formData.start_time).toISOString(),
          end_time: new Date(formData.end_time).toISOString(),
          /* The zone these times were composed in. It said 'UTC' regardless,
             so every confirmation email and client-facing page downstream
             presented the appointment at the wrong hour. */
          timezone,
          notes: formData.notes || undefined
        })
      });

      const data = await response.json();

      if (response.ok) {
        resetForm();
        refreshBookingsSilently();
        onBookingCreated?.();
      } else {
        // Handle specific error cases
        if (response.status === 409) {
          // Time slot conflict
          const errorMsg = language === 'he'
            ? 'מועד זה תפוס. אנא בחר זמן אחר.'
            : language === 'es'
            ? 'Este horario ya está reservado. Por favor elige otro horario.'
            : 'This time slot is already booked. Please choose a different time.';
          setFormError(data.message || errorMsg);
        } else {
          const errorMsg = language === 'he'
            ? 'שגיאה ביצירת הפגישה. נסה שוב.'
            : language === 'es'
            ? 'Error al crear la reserva. Inténtalo de nuevo.'
            : 'Failed to create booking. Please try again.';
          setFormError(data.error || errorMsg);
        }
        logger.warn({ status: response.status, error: data, formData }, 'Booking creation failed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to create booking');
      setFormError('An unexpected error occurred. Please try again.');
    } finally {
      setFormLoading(false);
    }
  };

  // Quick pick slots - recalculate whenever bookings change
  const selectedService = services.find(s => s.id === formData.service_id);
  const serviceDuration = selectedService?.duration_minutes || 60;
  const quickSlots = React.useMemo(() => {
    /*
     * Nothing until the zone is known. See `timezoneReady`: the builder decides
     * which day is "today" from the zone, so running it against the UTC
     * placeholder produced chips labelled Today whose real date was tomorrow.
     */
    if (!timezoneReady) return [];

    return getNextAvailableSlots(availability, serviceDuration, 4, bookings, timezone);
    // `timezone` matters: it arrives a moment after mount, and without it here
    // the slots stay as first computed.
  }, [availability, serviceDuration, bookings, timezone, timezoneReady]);

  const getDayLabel = (offset: number, date: Date): string => {
    if (offset === 0) return language === 'he' ? 'היום' : 'Today';
    if (offset === 1) return language === 'he' ? 'מחר' : 'Tomorrow';
    return formatDateShort(date, language, timezone);
  };

  /*
   * Rendered in the BUSINESS's zone.
   *
   * Without `timeZone` this formats in the reader's, so a nine o'clock New York
   * appointment read as four in the afternoon from Jerusalem — the booking was
   * right, the label was not.
   */
  const getTimeLabel = (date: Date): string => {
    const locale = LOCALE_MAP[language] || 'en-US';
    return date.toLocaleTimeString(locale, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: language !== 'he'
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        /* `100dvh`, not `100vh`. A phone reports `vh` against the viewport
           WITHOUT the address bar, so a full-height sheet ran under the browser
           chrome — the toolbar at the foot of the calendar sat below the fold
           with nothing to scroll. The `max-h` already said `dvh`; the `h` did
           not, and the taller of the two is what pushed the content down. */
        className="flex flex-col p-0 overflow-hidden w-full sm:w-[95vw] max-w-full sm:max-w-[1200px] h-[100dvh] sm:h-[85dvh] max-h-[100dvh] sm:max-h-[90dvh]"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 sm:py-4 border-b border-[var(--v2-border)]"
          style={{ background: `linear-gradient(135deg, ${SCHEDULING_COLOR}08 0%, transparent 100%)` }}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 pe-2 sm:pe-0">
            <div
              className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${SCHEDULING_COLOR}15` }}
            >
              <Calendar className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: SCHEDULING_COLOR }} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base sm:text-lg font-semibold text-[var(--v2-text-primary)] truncate">
                {language === 'he' ? 'יומן פגישות' : 'Calendar'}
              </DialogTitle>
              <p className="text-xs text-[var(--v2-text-muted)] hidden sm:block">
                {language === 'he' ? 'נהל את הפגישות שלך' : 'Manage your appointments'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 me-8 sm:me-12">
            <button
              onClick={handleNewBooking}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-white transition-all hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#14B8A6] focus:ring-offset-2 focus:ring-offset-[var(--v2-surface)]"
              style={{ background: SCHEDULING_COLOR }}
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{language === 'he' ? 'פגישה חדשה' : 'New Booking'}</span>
            </button>
          </div>
        </div>

        {/* Content - Calendar + Side Panel */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Calendar View - takes remaining space */}
          <div className="flex-1 overflow-hidden p-2 sm:p-3 md:p-4">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin" style={{ color: SCHEDULING_COLOR }} />
              </div>
            ) : (
              <SchedulingCalendarView
                bookings={bookings}
                services={services}
                onBookingClick={handleBookingClick}
                onBookingUpdated={refreshBookingsSilently}
                onSlotClick={handleSlotClick}
                availability={availability}
              />
            )}
          </div>

        </div>
      </DialogContent>

      {/* The booking dialog — new bookings and existing ones alike. */}
      <SchedulingBookingModal
        booking={editingBooking}
        services={services}
        servicesLoading={loading}
        isOpen={showEditModal}
        prefilledDateTime={prefilledSlot}
        onClose={() => {
          setShowEditModal(false);
          setEditingBooking(undefined);
          setPrefilledSlot(undefined);
        }}
        onBookingUpdated={() => {
          fetchAllData();
          setShowEditModal(false);
          setEditingBooking(undefined);
          setPrefilledSlot(undefined);
        }}
        availability={availability}
        timezone={timezoneReady ? timezone : undefined}
        existingBookings={bookings}
      />
    </Dialog>
  );
}
