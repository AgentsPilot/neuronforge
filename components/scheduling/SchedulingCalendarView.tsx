'use client';

import { useState, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Clock, Calendar, Phone, Mail, CheckCircle, XCircle, AlertCircle, Trash2, Loader2, LayoutGrid, List } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { SchedulingBooking, SchedulingService } from '@/lib/repositories/SchedulingRepository';
import type { WeeklyAvailability } from './AvailabilityEditor';

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
}

// Day keys for availability lookup
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

// Scheduling theme color: Teal
const SCHEDULING_COLOR = '#14B8A6';

// Modern row height
const ROW_HEIGHT = 56;
// Default hours 6am - 10pm (will be overridden by availability if present)
const DEFAULT_HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

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

export function SchedulingCalendarView({
  bookings,
  services,
  onBookingClick,
  onBookingUpdated,
  onSlotClick,
  availability,
  externalEventsRefreshTrigger
}: SchedulingCalendarViewProps) {
  const { t, language, formatCurrency } = useLanguage();

  // Israel/Hebrew uses Sunday-first weeks, most other locales use Monday-first
  const weekStartsOnSunday = language === 'he';

  const [currentWeek, setCurrentWeek] = useState(() => getStartOfWeek(new Date(), weekStartsOnSunday));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [actionInProgress, setActionInProgress] = useState<{ bookingId: string; action: string } | null>(null);
  const [hoveredBooking, setHoveredBooking] = useState<string | null>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Expand mode: 'both' shows both, 'calendar' expands calendar to full, 'list' expands list to full
  // Default to 'calendar' for full-width calendar view when dialog opens
  const [expandMode, setExpandMode] = useState<'both' | 'calendar' | 'list'>('calendar');

  // External calendar busy slots
  const [externalBusySlots, setExternalBusySlots] = useState<ExternalBusySlot[]>([]);

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

  // Quick action handler
  const handleQuickAction = async (bookingId: string, action: 'cancel' | 'complete' | 'no-show' | 'delete', e: React.MouseEvent) => {
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
        body: action === 'delete' ? undefined : JSON.stringify({})
      });
      if (response.ok) {
        onBookingUpdated();
      }
    } catch (error) {
      console.error(`Failed to ${action} booking:`, error);
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

  const filteredBookings = statusFilter === 'all'
    ? bookings
    : bookings.filter(booking => booking.status === statusFilter);

  const getBookingsForDay = (date: Date) => {
    // Create start and end of the day in local timezone
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return filteredBookings.filter(booking => {
      const bookingStart = new Date(booking.start_time);
      const bookingEnd = new Date(booking.end_time);
      // Check if booking overlaps with this day (handles timezone edge cases)
      return bookingStart < dayEnd && bookingEnd > dayStart;
    });
  };

  const getWeekBookings = () => {
    // Set weekStart to beginning of day and weekEnd to end of day
    const weekStart = new Date(weekDates[0]);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekDates[6]);
    weekEnd.setHours(23, 59, 59, 999);

    return filteredBookings.filter(booking => {
      const bookingDate = new Date(booking.start_time);
      return bookingDate >= weekStart && bookingDate <= weekEnd;
    }).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  };

  const getServiceName = (serviceId: string) => {
    const service = services.find(s => s.id === serviceId);
    return service?.service_name || t('scheduling.unknown_service');
  };

  const localeMap: Record<string, string> = { en: 'en-US', es: 'es-ES', he: 'he-IL' };
  const currentLocale = localeMap[language] || 'en-US';

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    // Always use 12-hour format with AM/PM for better readability
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(currentLocale, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const getBookingPosition = (startTime: string) => {
    const date = new Date(startTime);
    const hour = date.getHours();
    const minutes = date.getMinutes();
    // Calendar starts at the first visible hour
    return ((hour - calendarStartHour) * ROW_HEIGHT) + (minutes / 60 * ROW_HEIGHT);
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

  const isHourAvailable = (date: Date, hour: number): boolean => {
    if (!availability) return false;
    const dayKey = DAY_KEYS[date.getDay()];
    const slots = availability[dayKey];
    if (!slots || slots.length === 0) return false;

    for (const slot of slots) {
      const [startHour] = slot.start.split(':').map(Number);
      const [endHour] = slot.end.split(':').map(Number);
      if (hour >= startHour && hour < endHour) return true;
    }
    return false;
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
    const dayKey = DAY_KEYS[date.getDay()];
    const slots = availability[dayKey];
    return slots && slots.length > 0;
  };

  // Get external busy slots for a specific day
  const getExternalBusySlotsForDay = (date: Date): ExternalBusySlot[] => {
    // Create start and end of the day in local timezone
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return externalBusySlots.filter(slot => {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      // Check if slot overlaps with this day (handles multi-day and timezone edge cases)
      return slotStart < dayEnd && slotEnd > dayStart;
    });
  };

  // Check if an hour is blocked by an external event
  const isHourBlockedByExternal = (date: Date, hour: number): boolean => {
    const hourStart = new Date(date);
    hourStart.setHours(hour, 0, 0, 0);
    const hourEnd = new Date(date);
    hourEnd.setHours(hour + 1, 0, 0, 0);

    return externalBusySlots.some(slot => {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      // Check for overlap
      return hourStart < slotEnd && hourEnd > slotStart;
    });
  };

  // Get the position (top offset) for an external busy slot
  const getExternalSlotPosition = (slot: ExternalBusySlot): number => {
    const start = new Date(slot.start);
    const hour = start.getHours();
    const minutes = start.getMinutes();
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
    const clampedStart = start.getHours() < calendarStartHour ? new Date(start.setHours(calendarStartHour, 0, 0, 0)) : start;
    // Clamp end to last visible hour if later
    const clampedEnd = end.getHours() >= lastVisibleHour ? new Date(end.setHours(lastVisibleHour, 0, 0, 0)) : end;
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
    return start.getHours() < lastVisibleHour && end.getHours() >= calendarStartHour;
  };

  const totalBookings = weekDates.reduce((acc, date) => acc + getBookingsForDay(date).length, 0);
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
          style={{ maxHeight: '75vh' }}
        >
          <div className="min-w-[500px]">
            {/* Modern Day Headers */}
            <div className="grid grid-cols-8 border-b border-white/10 dark:border-white/5 sticky top-0 bg-[var(--v2-surface)]/95 backdrop-blur-xl z-20">
              <div className="p-3 border-e border-white/5 w-14" />
              {weekDates.map((date, index) => {
                const isToday = date.toDateString() === new Date().toDateString();
                const dayBookings = getBookingsForDay(date);
                const hasAvailability = isDayAvailable(date);
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
                    return (
                      <div
                        key={dayIndex}
                        onClick={() => !isBlockedExternal && onSlotClick?.(date, hour)}
                        className={`border-e border-white/5 last:border-e-0 transition-all duration-200 group relative ${
                          isBlockedExternal
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer'
                        } ${
                          isBlockedExternal
                            ? ''
                            : isAvailable
                              ? 'bg-teal-500/10 hover:bg-teal-500/20'
                              : isToday
                                ? 'bg-teal-500/5 hover:bg-teal-500/10'
                                : 'hover:bg-white/5'
                        }`}
                        style={isBlockedExternal ? {
                          background: 'repeating-linear-gradient(135deg, rgba(156, 163, 175, 0.15), rgba(156, 163, 175, 0.15) 4px, rgba(156, 163, 175, 0.08) 4px, rgba(156, 163, 175, 0.08) 8px)'
                        } : {}}
                      >
                        {/* External busy indicator */}
                        {isBlockedExternal && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[9px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider opacity-60">
                              {t('scheduling.busy')}
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
                    {dayBookings.map(booking => {
                      const statusStyle = STATUS_COLORS[booking.status] || STATUS_COLORS.pending;
                      const height = getBookingHeight(booking.start_time, booking.end_time);
                      const service = getServiceDetails(booking.service_id);
                      const isHovered = hoveredBooking === booking.id;
                      return (
                        <div
                          key={booking.id}
                          onClick={() => onBookingClick(booking)}
                          onMouseEnter={() => handleBookingMouseEnter(booking.id)}
                          onMouseLeave={handleBookingMouseLeave}
                          className={`
                            absolute inset-x-1 cursor-pointer
                            ${statusStyle.bg} ${statusStyle.border} border
                            rounded-lg
                            transition-all duration-200
                            hover:scale-[1.02] hover:shadow-lg ${statusStyle.glow}
                            ${isHovered ? 'z-50 overflow-visible' : 'z-10 overflow-hidden'}
                          `}
                          style={{
                            top: `${getBookingPosition(booking.start_time)}px`,
                            height: `${height}px`,
                          }}
                        >
                          <div className="h-full flex items-center px-2 overflow-hidden">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 flex-shrink-0">
                                {getInitials(booking.client_first_name, booking.client_last_name)}
                              </div>
                              <span className={`text-[11px] font-semibold truncate ${statusStyle.text}`}>
                                {booking.client_first_name}
                              </span>
                            </div>
                          </div>

                          {/* Modern Tooltip */}
                          {isHovered && (
                            <div
                              className="absolute z-[100] w-[240px] bg-[var(--v2-surface)]/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/20 p-4 pointer-events-none"
                              style={{
                                borderRadius: '16px',
                                top: '0',
                                left: '100%',
                                marginLeft: '12px'
                              }}
                            >
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
                    })}
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

                return (
                  <div
                    key={booking.id}
                    onClick={() => onBookingClick(booking)}
                    className="p-4 cursor-pointer transition-all duration-200 group relative overflow-hidden hover:border-teal-500/50 active:scale-[0.995]"
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

                      {/* Date & Time - fixed width container for consistent positioning */}
                      <div className="flex items-center gap-4 flex-shrink-0">
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

                      {/* Quick Action Buttons - fixed width container so date/time stays aligned regardless of button count */}
                      <div className="flex items-center justify-end gap-1.5 flex-shrink-0 w-[340px] opacity-0 group-hover:opacity-100 transition-all duration-200">
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
                              onClick={(e) => handleQuickAction(booking.id, 'no-show', e)}
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
                              onClick={(e) => handleQuickAction(booking.id, 'cancel', e)}
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
    </div>
  );
}
