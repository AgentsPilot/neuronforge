'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Clock, X, Plus } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// Configuration theme color (matches Services tab)
const CONFIG_COLOR = '#D14E97';

export interface TimeSlot {
  start: string;
  end: string;
}

export interface WeeklyAvailability {
  sunday: TimeSlot[];
  monday: TimeSlot[];
  tuesday: TimeSlot[];
  wednesday: TimeSlot[];
  thursday: TimeSlot[];
  friday: TimeSlot[];
  saturday: TimeSlot[];
}

interface AvailabilityEditorProps {
  availability: WeeklyAvailability;
  onChange: (availability: WeeklyAvailability) => void;
  daysToAdd?: string[]; // Days to auto-add with default time slot (from chat)
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type DayKey = typeof DAYS[number];


// Convert HH:MM to minutes from midnight
const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// Convert minutes from midnight to HH:MM
const minutesToTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// Format time for display with minutes (e.g., "9:00" or "17:30")
const formatTimeDisplay = (time: string): string => {
  const [hours, minutes] = time.split(':').map(Number);
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  const period = hours < 12 ? 'AM' : 'PM';
  return `${h}:${m} ${period}`;
};

// Format hour marker (e.g., "6AM", "12PM")
const formatHourMarker = (hour: number): string => {
  if (hour === 0 || hour === 24) return '12AM';
  if (hour === 12) return '12PM';
  if (hour < 12) return `${hour}AM`;
  return `${hour - 12}PM`;
};

interface TimeRangeSliderProps {
  startTime: string;
  endTime: string;
  onStartChange: (time: string) => void;
  onEndChange: (time: string) => void;
  isRTL?: boolean;
}

function TimeRangeSlider({ startTime, endTime, onStartChange, onEndChange, isRTL = false }: TimeRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  const MIN_MINUTES = 0;     // 00:00
  const MAX_MINUTES = 1440;  // 24:00
  const STEP = 30;           // 30 minute increments
  const MIN_GAP = 60;        // Minimum 1 hour between start and end

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  // For RTL, we flip the percentage calculations
  const startPercent = isRTL
    ? 100 - ((startMinutes - MIN_MINUTES) / (MAX_MINUTES - MIN_MINUTES)) * 100
    : ((startMinutes - MIN_MINUTES) / (MAX_MINUTES - MIN_MINUTES)) * 100;
  const endPercent = isRTL
    ? 100 - ((endMinutes - MIN_MINUTES) / (MAX_MINUTES - MIN_MINUTES)) * 100
    : ((endMinutes - MIN_MINUTES) / (MAX_MINUTES - MIN_MINUTES)) * 100;

  const getMinutesFromPosition = useCallback((clientX: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    let percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // For RTL, flip the percentage
    if (isRTL) {
      percent = 1 - percent;
    }
    const minutes = MIN_MINUTES + percent * (MAX_MINUTES - MIN_MINUTES);
    return Math.round(minutes / STEP) * STEP;
  }, [isRTL]);

  const handleMouseDown = (type: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(type);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const newMinutes = getMinutesFromPosition(e.clientX);

    if (dragging === 'start') {
      const maxStart = endMinutes - MIN_GAP;
      const clampedMinutes = Math.max(MIN_MINUTES, Math.min(maxStart, newMinutes));
      onStartChange(minutesToTime(clampedMinutes));
    } else {
      const minEnd = startMinutes + MIN_GAP;
      const clampedMinutes = Math.max(minEnd, Math.min(MAX_MINUTES, newMinutes));
      onEndChange(minutesToTime(clampedMinutes));
    }
  }, [dragging, startMinutes, endMinutes, getMinutesFromPosition, onStartChange, onEndChange]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Use useEffect for global event listeners
  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  // Hour markers - flip for RTL
  const hourMarkers = isRTL ? [24, 18, 12, 6, 0] : [0, 6, 12, 18, 24];

  // Calculate active range position for RTL
  const rangeLeft = isRTL ? endPercent : startPercent;
  const rangeWidth = isRTL ? startPercent - endPercent : endPercent - startPercent;

  return (
    <div className="flex items-center gap-3" dir="ltr">
      {/* Slider track - always LTR for consistent behavior */}
      <div
        ref={trackRef}
        className="relative h-5 flex-1 cursor-pointer select-none"
      >
        {/* Background track */}
        <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-[var(--v2-border)] rounded-full" />

        {/* Active range */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full"
          style={{
            left: `${rangeLeft}%`,
            width: `${rangeWidth}%`,
            backgroundColor: CONFIG_COLOR
          }}
        />

        {/* Start thumb */}
        <div
          onMouseDown={handleMouseDown('start')}
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow-md cursor-grab transition-transform hover:scale-110 ${dragging === 'start' ? 'scale-110 cursor-grabbing' : ''}`}
          style={{ left: `${isRTL ? startPercent : startPercent}%`, borderWidth: '2px', borderStyle: 'solid', borderColor: CONFIG_COLOR }}
        />

        {/* End thumb */}
        <div
          onMouseDown={handleMouseDown('end')}
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow-md cursor-grab transition-transform hover:scale-110 ${dragging === 'end' ? 'scale-110 cursor-grabbing' : ''}`}
          style={{ left: `${isRTL ? endPercent : endPercent}%`, borderWidth: '2px', borderStyle: 'solid', borderColor: CONFIG_COLOR }}
        />
      </div>

      {/* Time display - compact on the right */}
      <div className="flex items-center gap-1 text-xs whitespace-nowrap" dir={isRTL ? 'rtl' : 'ltr'}>
        <span className="font-medium" style={{ color: CONFIG_COLOR }}>{formatTimeDisplay(startTime)}</span>
        <span className="text-[var(--v2-text-muted)]">–</span>
        <span className="font-medium" style={{ color: CONFIG_COLOR }}>{formatTimeDisplay(endTime)}</span>
      </div>
    </div>
  );
}

export function AvailabilityEditor({ availability, onChange, daysToAdd }: AvailabilityEditorProps) {
  const { t, isRTL } = useLanguage();
  const [daysAddedFromChat, setDaysAddedFromChat] = useState(false);

  // Auto-add days with default time slot when daysToAdd prop is provided
  useEffect(() => {
    if (daysToAdd?.length && !daysAddedFromChat) {
      const updatedAvailability = { ...availability };
      let hasChanges = false;

      for (const day of daysToAdd) {
        const normalizedDay = day.toLowerCase() as DayKey;
        if (DAYS.includes(normalizedDay)) {
          const existingSlots = updatedAvailability[normalizedDay] || [];
          // Only add if the day doesn't already have slots
          if (existingSlots.length === 0) {
            // Find default slot from first active day, or use 9-5
            const firstActiveDay = DAYS.find(d => (updatedAvailability[d] || []).length > 0);
            const defaultSlot = firstActiveDay
              ? { ...updatedAvailability[firstActiveDay][0] }
              : { start: '09:00', end: '17:00' };
            updatedAvailability[normalizedDay] = [defaultSlot];
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        onChange(updatedAvailability);
      }
      setDaysAddedFromChat(true);
    }
  }, [daysToAdd, availability, onChange, daysAddedFromChat]);

  // Reset the flag when dialog closes (daysToAdd becomes undefined)
  useEffect(() => {
    if (!daysToAdd) {
      setDaysAddedFromChat(false);
    }
  }, [daysToAdd]);

  const toggleDay = (day: DayKey) => {
    const existingSlots = availability[day] || [];
    if (existingSlots.length > 0) {
      onChange({ ...availability, [day]: [] });
    } else {
      // Copy hours from first active day, or default to 9-5
      const firstActiveDay = DAYS.find(d => (availability[d] || []).length > 0);
      const defaultSlot = firstActiveDay
        ? { ...availability[firstActiveDay][0] }
        : { start: '09:00', end: '17:00' };
      onChange({ ...availability, [day]: [defaultSlot] });
    }
  };

  const updateSlotTime = (day: DayKey, slotIndex: number, field: 'start' | 'end', value: string) => {
    const existingSlots = availability[day] || [];
    if (slotIndex >= existingSlots.length) return;
    const updatedSlots = existingSlots.map((slot, i) =>
      i === slotIndex ? { ...slot, [field]: value } : slot
    );
    onChange({ ...availability, [day]: updatedSlots });
  };

  const addSlot = (day: DayKey) => {
    const existingSlots = availability[day] || [];
    // Find a gap after the last slot, default to evening hours
    const lastSlot = existingSlots[existingSlots.length - 1];
    const lastEndMinutes = lastSlot ? timeToMinutes(lastSlot.end) : 540; // 9:00 AM default
    const newStart = Math.min(lastEndMinutes + 60, 1320); // At least 1 hour gap, max 10 PM start
    const newEnd = Math.min(newStart + 120, 1440); // 2 hours duration, max midnight

    const newSlot: TimeSlot = {
      start: minutesToTime(newStart),
      end: minutesToTime(newEnd)
    };
    onChange({ ...availability, [day]: [...existingSlots, newSlot] });
  };

  const removeSlot = (day: DayKey, slotIndex: number) => {
    const existingSlots = availability[day] || [];
    const updatedSlots = existingSlots.filter((_, i) => i !== slotIndex);
    onChange({ ...availability, [day]: updatedSlots });
  };

  const getDayName = (day: string) => {
    return t(`scheduling.day.${day}`);
  };

  // Get active days for the per-day sliders
  const activeDays = DAYS.filter(day => (availability[day] || []).length > 0);

  return (
    <div className="space-y-5">
      {/* Days Toggle Row */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm font-medium text-[var(--v2-text-primary)] flex-shrink-0">
          {t('scheduling.availability.working_days') || 'Working days:'}
        </span>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(day => {
            const daySlots = availability[day] || [];
            const isActive = daySlots.length > 0;

            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`
                  px-4 py-2 text-sm font-medium transition-all border
                  ${isActive
                    ? 'border-[#D14E97] bg-[#D14E97]/10'
                    : 'bg-[var(--v2-surface)] text-[var(--v2-text-muted)] border-[var(--v2-border)] hover:border-[#D14E97]/50'
                  }
                `}
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  color: isActive ? CONFIG_COLOR : undefined
                }}
              >
                {getDayName(day)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-Day Time Sliders */}
      {activeDays.length > 0 && (
        <div className="space-y-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {activeDays.map(day => {
            const slots = availability[day];
            return (
              <div key={day} className="space-y-2">
                {slots.map((slot, slotIndex) => (
                  <div
                    key={`${day}-${slotIndex}`}
                    className="flex items-center gap-4"
                  >
                    {/* Day label - only show on first slot */}
                    <span className={`text-sm font-medium w-24 flex-shrink-0 ${slotIndex === 0 ? 'text-[var(--v2-text-primary)]' : 'text-transparent'}`}>
                      {slotIndex === 0 ? getDayName(day) : getDayName(day)}
                    </span>
                    {/* Slider */}
                    <div className="flex-1">
                      <TimeRangeSlider
                        startTime={slot.start}
                        endTime={slot.end}
                        isRTL={isRTL}
                        onStartChange={(newTime) => updateSlotTime(day, slotIndex, 'start', newTime)}
                        onEndChange={(newTime) => updateSlotTime(day, slotIndex, 'end', newTime)}
                      />
                    </div>
                    {/* Remove slot button */}
                    <button
                      type="button"
                      onClick={() => removeSlot(day, slotIndex)}
                      className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors flex-shrink-0"
                      title={t('scheduling.availability.remove_slot') || 'Remove time slot'}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {/* Add slot button */}
                <div className="flex items-center gap-4">
                  <span className="w-24 flex-shrink-0" />
                  <button
                    type="button"
                    onClick={() => addSlot(day)}
                    className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
                    style={{ color: CONFIG_COLOR }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('scheduling.availability.add_slot') || 'Add time slot'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {activeDays.length === 0 && (
        <div className="py-6 px-4 bg-[var(--v2-surface)] border border-dashed border-[var(--v2-border)] text-center" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <p className="text-sm text-[var(--v2-text-muted)]">
            {t('scheduling.availability.no_days_selected')}
          </p>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            const defaultSlots = [{ start: '09:00', end: '17:00' }];
            onChange({
              sunday: [],
              monday: [...defaultSlots],
              tuesday: [...defaultSlots],
              wednesday: [...defaultSlots],
              thursday: [...defaultSlots],
              friday: [...defaultSlots],
              saturday: []
            });
          }}
          className="px-4 py-2 text-sm font-medium transition-colors"
          style={{
            borderRadius: 'var(--v2-radius-button)',
            color: CONFIG_COLOR,
            backgroundColor: `${CONFIG_COLOR}15`
          }}
        >
          {t('scheduling.availability.set_business_hours')}
        </button>
        <button
          type="button"
          onClick={() => {
            // Apply same hours to all active days (copy all slots from first day)
            if (activeDays.length === 0) return;
            const firstDaySlots = availability[activeDays[0]];
            const newAvailability = { ...availability };
            activeDays.forEach(day => {
              newAvailability[day] = firstDaySlots.map(slot => ({ ...slot }));
            });
            onChange(newAvailability);
          }}
          disabled={activeDays.length < 2}
          className="px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderRadius: 'var(--v2-radius-button)',
            color: CONFIG_COLOR,
            backgroundColor: `${CONFIG_COLOR}15`
          }}
        >
          {t('scheduling.availability.apply_to_all')}
        </button>
        <button
          type="button"
          onClick={() => {
            onChange({
              sunday: [],
              monday: [],
              tuesday: [],
              wednesday: [],
              thursday: [],
              friday: [],
              saturday: []
            });
          }}
          className="px-4 py-2 text-sm font-medium text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-surface)] hover:bg-[var(--v2-bg)] border border-[var(--v2-border)] transition-colors"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {t('scheduling.availability.clear_all')}
        </button>
      </div>
    </div>
  );
}

// Default empty availability
export const DEFAULT_AVAILABILITY: WeeklyAvailability = {
  sunday: [],
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: []
};

// Helper to parse availability from DB (might be empty object or null)
export function parseAvailability(data: Record<string, any> | null | undefined): WeeklyAvailability {
  if (!data || typeof data !== 'object') {
    return DEFAULT_AVAILABILITY;
  }

  return {
    sunday: Array.isArray(data.sunday) ? data.sunday : [],
    monday: Array.isArray(data.monday) ? data.monday : [],
    tuesday: Array.isArray(data.tuesday) ? data.tuesday : [],
    wednesday: Array.isArray(data.wednesday) ? data.wednesday : [],
    thursday: Array.isArray(data.thursday) ? data.thursday : [],
    friday: Array.isArray(data.friday) ? data.friday : [],
    saturday: Array.isArray(data.saturday) ? data.saturday : []
  };
}
