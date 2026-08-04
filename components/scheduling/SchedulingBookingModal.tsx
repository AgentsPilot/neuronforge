'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Clock, User, Mail, Phone, Calendar, FileText, CheckCircle, XCircle, AlertCircle, Search, UserPlus, X, Plus, Globe, Facebook, MessageCircle, Users as UsersIcon, Check, Trash2, CreditCard, Tag } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import en from 'react-phone-number-input/locale/en';
import 'react-phone-number-input/style.css';
import { SearchableCountrySelect } from '@/components/crm/SearchableCountrySelect';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { SchedulingBooking, SchedulingService } from '@/lib/repositories/SchedulingRepository';
import type { WeeklyAvailability } from './AvailabilityEditor';
import type { Country } from 'react-phone-number-input';

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
  prefilledDateTime?: PrefilledDateTime;
  prefilledContact?: PrefilledContact; // Skip contact search when provided
  existingBookings?: SchedulingBooking[]; // For filtering out booked slots
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
function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Get default times based on user availability
function getDefaultTimes(availability?: WeeklyAvailability, serviceDurationMinutes: number = 60): { start: string; end: string } {
  const now = new Date();
  const today = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Try to find availability for today or the next available day
  for (let i = 0; i < 7; i++) {
    const dayIndex = (today + i) % 7;
    const dayKey = DAY_KEYS[dayIndex];
    const daySlots = availability?.[dayKey] || [];

    if (daySlots.length > 0) {
      const slot = daySlots[0];
      const [startHour, startMinute] = slot.start.split(':').map(Number);

      // Calculate the target date
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + i);
      targetDate.setHours(startHour, startMinute, 0, 0);

      // If it's today and the start time has passed, try to find a slot that works
      if (i === 0 && targetDate < now) {
        // Round up current time to next 30-minute mark
        const roundedNow = new Date(now);
        const minutes = roundedNow.getMinutes();
        roundedNow.setMinutes(minutes < 30 ? 30 : 60, 0, 0);
        if (minutes >= 30) roundedNow.setHours(roundedNow.getHours() + 1);

        const [endHour, endMinute] = slot.end.split(':').map(Number);
        const slotEnd = new Date(targetDate);
        slotEnd.setHours(endHour, endMinute, 0, 0);

        // Check if there's still time in today's slot
        if (roundedNow < slotEnd) {
          const endTime = new Date(roundedNow.getTime() + serviceDurationMinutes * 60 * 1000);
          // Make sure end time doesn't exceed slot end
          if (endTime <= slotEnd) {
            return {
              start: formatDateTimeLocal(roundedNow),
              end: formatDateTimeLocal(endTime)
            };
          }
        }
        // Today's slot is not available, continue to next day
        continue;
      }

      // Return the start of the available slot
      const endTime = new Date(targetDate.getTime() + serviceDurationMinutes * 60 * 1000);
      return {
        start: formatDateTimeLocal(targetDate),
        end: formatDateTimeLocal(endTime)
      };
    }
  }

  // Fallback: no availability set, use 9:00 AM tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const endTime = new Date(tomorrow.getTime() + serviceDurationMinutes * 60 * 1000);

  return {
    start: formatDateTimeLocal(tomorrow),
    end: formatDateTimeLocal(endTime)
  };
}

// Get availability for a specific day
function getAvailabilityForDay(date: Date, availability?: WeeklyAvailability): { start: string; end: string } | null {
  if (!availability) return null;
  const dayKey = DAY_KEYS[date.getDay()];
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

// Format date for display (e.g., "Mon, Jan 15")
function formatDateShort(date: Date, language: string = 'en'): string {
  const locale = LOCALE_MAP[language] || 'en-US';
  return date.toLocaleDateString(locale, {
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
function getNextAvailableSlots(
  availability: WeeklyAvailability | undefined,
  serviceDurationMinutes: number,
  maxSlots: number = 6,
  existingBookings: SchedulingBooking[] = [],
  externalBusySlots: ExternalBusySlot[] = []
): QuickPickSlot[] {
  if (!availability) return [];

  const slots: QuickPickSlot[] = [];
  const now = new Date();
  const today = now.getDay();

  // Look ahead up to 14 days
  for (let dayOffset = 0; dayOffset < 14 && slots.length < maxSlots; dayOffset++) {
    const dayIndex = (today + dayOffset) % 7;
    const dayKey = DAY_KEYS[dayIndex];
    const daySlots = availability[dayKey] || [];

    if (daySlots.length === 0) continue;

    // Calculate the target date
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + dayOffset);
    targetDate.setSeconds(0, 0);

    for (const slot of daySlots) {
      if (slots.length >= maxSlots) break;

      const [startHour, startMinute] = slot.start.split(':').map(Number);
      const [endHour, endMinute] = slot.end.split(':').map(Number);

      // Calculate available time blocks within this slot
      let currentStart = new Date(targetDate);
      currentStart.setHours(startHour, startMinute, 0, 0);

      const slotEnd = new Date(targetDate);
      slotEnd.setHours(endHour, endMinute, 0, 0);

      // If it's today, start from current time (rounded up to next 30 min)
      if (dayOffset === 0) {
        const roundedNow = new Date(now);
        const minutes = roundedNow.getMinutes();
        roundedNow.setMinutes(minutes < 30 ? 30 : 60, 0, 0);
        if (minutes >= 30) roundedNow.setHours(roundedNow.getHours());

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
  isOpen,
  onClose,
  onBookingUpdated,
  availability,
  prefilledDateTime,
  prefilledContact,
  existingBookings = []
}: SchedulingBookingModalProps) {
  const { t, language } = useLanguage();
  const [formData, setFormData] = useState({
    service_id: '',
    contact_id: '' as string | null,
    client_first_name: '',
    client_last_name: '',
    client_email: '',
    client_phone: '',
    start_time: '',
    end_time: '',
    timezone: 'UTC',
    notes: '',
    status: 'confirmed' as 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  });
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  // External calendar busy slots
  const [externalBusySlots, setExternalBusySlots] = useState<ExternalBusySlot[]>([]);

  useEffect(() => {
    if (booking) {
      // Use formatDateTimeLocal to convert UTC times to local datetime-local format
      setFormData({
        service_id: booking.service_id,
        contact_id: booking.contact_id || null,
        client_first_name: booking.client_first_name,
        client_last_name: booking.client_last_name || '',
        client_email: booking.client_email,
        client_phone: booking.client_phone || '',
        start_time: formatDateTimeLocal(new Date(booking.start_time)),
        end_time: formatDateTimeLocal(new Date(booking.end_time)),
        timezone: booking.timezone || 'UTC',
        notes: booking.notes || '',
        status: booking.status
      });
      setShowClientSearch(false); // Hide search when editing
    } else {
      // Get first active service for defaults
      const activeServices = services.filter(s => s.status === 'active');
      const defaultService = activeServices[0];
      const serviceDuration = defaultService?.duration_minutes || 60;

      let startTime: string;
      let endTime: string;

      // If prefilled from calendar slot click, use that
      if (prefilledDateTime) {
        const startDate = new Date(prefilledDateTime.date);
        startDate.setHours(prefilledDateTime.hour, 0, 0, 0);
        const endDate = new Date(startDate.getTime() + serviceDuration * 60 * 1000);
        // Format as local time for datetime-local input (YYYY-MM-DDTHH:MM)
        startTime = formatDateTimeLocal(startDate);
        endTime = formatDateTimeLocal(endDate);
      } else {
        const defaultTimes = getDefaultTimes(availability, serviceDuration);
        startTime = defaultTimes.start;
        endTime = defaultTimes.end;
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
          timezone: 'UTC',
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
          timezone: 'UTC',
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
  }, [booking, services, availability, prefilledDateTime, prefilledContact]);

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

  const handleServiceChange = (serviceId: string) => {
    const service = services.find(s => s.id === serviceId);
    if (service && !booking) {
      const start = new Date(formData.start_time);
      const end = new Date(start.getTime() + service.duration_minutes * 60 * 1000);
      setFormData(prev => ({
        ...prev,
        service_id: serviceId,
        end_time: end.toISOString().slice(0, 16)
      }));
    } else {
      setFormData(prev => ({ ...prev, service_id: serviceId }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent booking in the past (only for new bookings or when changing time)
    const startTime = new Date(formData.start_time);
    const now = new Date();
    if (!booking && startTime < now) {
      alert(t('scheduling.booking.error_past_time'));
      return;
    }

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
        start_time: new Date(formData.start_time).toISOString(),
        end_time: new Date(formData.end_time).toISOString(),
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

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        onBookingUpdated();
      }
    } catch (error) {
      console.error('Failed to save booking:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = async (action: 'cancel' | 'complete' | 'no-show') => {
    if (!booking) return;
    setLoading(true);

    try {
      const response = await fetch(`/api/scheduling/bookings/${booking.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
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

    try {
      const response = await fetch(`/api/scheduling/bookings/${booking.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        onBookingUpdated();
      }
    } catch (error) {
      console.error('Failed to delete booking:', error);
    } finally {
      setLoading(false);
      setShowDeleteConfirm(false);
    }
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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full sm:max-w-2xl h-[100vh] sm:h-auto sm:max-h-[90vh] flex flex-col bg-[var(--v2-surface)] border-[var(--v2-border)] p-0 overflow-hidden">
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
                  className="w-full bg-[var(--v2-bg)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20 rtl:flex-row-reverse rtl:text-right"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <SelectValue placeholder={t('scheduling.booking.select_service')} />
                </SelectTrigger>
                <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)] p-1">
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
            </div>
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
                      onChange={(e) => setFormData(prev => ({ ...prev, client_first_name: e.target.value }))}
                      placeholder={t('scheduling.booking.first_name_placeholder')}
                      required
                      className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
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
                    onChange={(e) => setFormData(prev => ({ ...prev, client_email: e.target.value }))}
                    placeholder={t('scheduling.booking.email_placeholder')}
                    required
                    className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
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
              const quickSlots = getNextAvailableSlots(availability, serviceDuration, 6, existingBookings, externalBusySlots);

              if (quickSlots.length === 0) return null;

              // Helper to get day label based on offset
              const getDayLabel = (offset: number, date: Date): string => {
                if (offset === 0) return t('scheduling.booking.today');
                if (offset === 1) return t('scheduling.booking.tomorrow');
                return formatDateShort(date, language);
              };

              // Helper to get time label
              const getTimeLabel = (date: Date): string => {
                const locale = LOCALE_MAP[language] || 'en-US';
                return date.toLocaleTimeString(locale, {
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
                        formData.start_time === formatDateTimeLocal(slot.start) &&
                        formData.end_time === formatDateTimeLocal(slot.end);

                      const dayLabel = getDayLabel(slot.dayOffset, slot.start);
                      const timeLabel = getTimeLabel(slot.start);

                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              start_time: formatDateTimeLocal(slot.start),
                              end_time: formatDateTimeLocal(slot.end)
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
                  const dayAvailability = getAvailabilityForDay(selectedDate, availability);
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
              {booking && ['completed', 'cancelled'].includes(booking.status) && (
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
                  onChange={(e) => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                  required
                  min={!booking ? formatDateTimeLocal(new Date()) : undefined}
                  disabled={booking && ['completed', 'cancelled'].includes(booking.status)}
                  className="datetime-input-scheduling w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-[var(--v2-bg)]/50"
                  style={{ borderRadius: 'var(--v2-radius-button)', colorScheme: 'inherit' }}
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-medium text-[var(--v2-text-primary)] mb-1.5 sm:mb-2">
                  {t('scheduling.booking.end_time')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => setFormData(prev => ({ ...prev, end_time: e.target.value }))}
                  required
                  min={formData.start_time || (!booking ? formatDateTimeLocal(new Date()) : undefined)}
                  disabled={booking && ['completed', 'cancelled'].includes(booking.status)}
                  className="datetime-input-scheduling w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-[var(--v2-bg)]/50"
                  style={{ borderRadius: 'var(--v2-radius-button)', colorScheme: 'inherit' }}
                />
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

          </div>

          {/* Sticky Footer */}
          <div className="flex-shrink-0 border-t border-[var(--v2-border)] bg-[var(--v2-surface)] px-4 sm:px-6 py-3 sm:py-4">
            {/* Delete confirmation overlay */}
            {showDeleteConfirm ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-red-600 dark:text-red-400 flex-1">
                  {t('scheduling.booking.delete_confirm_message')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
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
                        onClick={() => handleQuickAction('no-show')}
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
                      onClick={() => setShowDeleteConfirm(true)}
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
                    disabled={loading || !formData.service_id || !formData.client_first_name || !formData.client_email}
                    className="px-4 py-2 text-sm font-medium text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {loading ? t('scheduling.booking.saving') : booking ? t('scheduling.booking.save_changes') : t('scheduling.booking.create_booking')}
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
    </Dialog>
  );
}
