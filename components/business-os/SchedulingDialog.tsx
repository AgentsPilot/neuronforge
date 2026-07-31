'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SchedulingCalendarView } from '@/components/scheduling/SchedulingCalendarView';
import { SchedulingBookingModal } from '@/components/scheduling/SchedulingBookingModal';
import { Calendar, Plus, Loader2, X, Search, UserPlus } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
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

// Format a Date to local datetime-local input format (YYYY-MM-DDTHH:MM)
function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Format date for display (e.g., "Mon, Jan 15")
function formatDateShort(date: Date, language: string = 'en'): string {
  const locale = LOCALE_MAP[language] || 'en-US';
  return date.toLocaleDateString(locale, {
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
  return existingBookings.some(booking => {
    if (booking.status === 'cancelled' || booking.status === 'no_show') return false;
    const bookingStart = new Date(booking.start_time);
    const bookingEnd = new Date(booking.end_time);
    return slotStart < bookingEnd && slotEnd > bookingStart;
  });
}

// Generate next available slots based on availability
function getNextAvailableSlots(
  availability: WeeklyAvailability | undefined,
  serviceDurationMinutes: number,
  maxSlots: number = 4,
  existingBookings: SchedulingBooking[] = []
): QuickPickSlot[] {
  if (!availability) return [];

  const slots: QuickPickSlot[] = [];
  const now = new Date();
  const today = now.getDay();

  for (let dayOffset = 0; dayOffset < 14 && slots.length < maxSlots; dayOffset++) {
    const dayIndex = (today + dayOffset) % 7;
    const dayKey = DAY_KEYS[dayIndex];
    const daySlots = availability[dayKey] || [];

    if (daySlots.length === 0) continue;

    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + dayOffset);
    targetDate.setSeconds(0, 0);

    for (const slot of daySlots) {
      if (slots.length >= maxSlots) break;

      const [startHour, startMinute] = slot.start.split(':').map(Number);
      const [endHour, endMinute] = slot.end.split(':').map(Number);

      let currentStart = new Date(targetDate);
      currentStart.setHours(startHour, startMinute, 0, 0);

      const slotEnd = new Date(targetDate);
      slotEnd.setHours(endHour, endMinute, 0, 0);

      if (dayOffset === 0) {
        const roundedNow = new Date(now);
        const minutes = roundedNow.getMinutes();
        roundedNow.setMinutes(minutes < 30 ? 30 : 60, 0, 0);
        if (minutes >= 30) roundedNow.setHours(roundedNow.getHours());
        if (roundedNow > currentStart) {
          currentStart = roundedNow;
        }
      }

      while (slots.length < maxSlots) {
        const potentialEnd = new Date(currentStart.getTime() + serviceDurationMinutes * 60 * 1000);
        if (potentialEnd > slotEnd) break;
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

  // Side panel booking form state
  const [showBookingPanel, setShowBookingPanel] = useState(false);
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

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setShowBookingPanel(false);
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

      if (servicesData.success) setServices(servicesData.services);
      if (bookingsData.success) setBookings(bookingsData.bookings);
      if (availabilityData.success && availabilityData.availability) {
        setAvailability(parseAvailability(availabilityData.availability));
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
  };

  const initializeNewBookingForm = (prefillDate?: Date, prefillHour?: number) => {
    const activeServices = services.filter(s => s.status === 'active');
    const defaultService = activeServices[0];
    const serviceDuration = defaultService?.duration_minutes || 60;

    let startTime: string;
    let endTime: string;

    if (prefillDate && prefillHour !== undefined) {
      const startDate = new Date(prefillDate);
      startDate.setHours(prefillHour, 0, 0, 0);
      const endDate = new Date(startDate.getTime() + serviceDuration * 60 * 1000);
      startTime = formatDateTimeLocal(startDate);
      endTime = formatDateTimeLocal(endDate);
    } else {
      // Default to first available slot
      const quickSlots = getNextAvailableSlots(availability, serviceDuration, 1, bookings);
      if (quickSlots.length > 0) {
        startTime = formatDateTimeLocal(quickSlots[0].start);
        endTime = formatDateTimeLocal(quickSlots[0].end);
      } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        const endDate = new Date(tomorrow.getTime() + serviceDuration * 60 * 1000);
        startTime = formatDateTimeLocal(tomorrow);
        endTime = formatDateTimeLocal(endDate);
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

  const handleSlotClick = (date: Date, hour: number) => {
    initializeNewBookingForm(date, hour);
    setShowBookingPanel(true);
  };

  const handleNewBooking = () => {
    initializeNewBookingForm();
    setShowBookingPanel(true);
  };

  const handleBookingClick = (booking: SchedulingBooking) => {
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
      const end = new Date(start.getTime() + service.duration_minutes * 60 * 1000);
      setFormData(prev => ({
        ...prev,
        service_id: serviceId,
        end_time: formatDateTimeLocal(end)
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);

    try {
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
          timezone: 'UTC',
          notes: formData.notes || undefined
        })
      });

      if (response.ok) {
        setShowBookingPanel(false);
        resetForm();
        refreshBookingsSilently();
        onBookingCreated?.();
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to create booking');
    } finally {
      setFormLoading(false);
    }
  };

  // Quick pick slots
  const selectedService = services.find(s => s.id === formData.service_id);
  const serviceDuration = selectedService?.duration_minutes || 60;
  const quickSlots = getNextAvailableSlots(availability, serviceDuration, 4, bookings);

  const getDayLabel = (offset: number, date: Date): string => {
    if (offset === 0) return language === 'he' ? 'היום' : 'Today';
    if (offset === 1) return language === 'he' ? 'מחר' : 'Tomorrow';
    return formatDateShort(date, language);
  };

  const getTimeLabel = (date: Date): string => {
    const locale = LOCALE_MAP[language] || 'en-US';
    return date.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: language !== 'he'
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex flex-col p-0 overflow-hidden"
        style={{
          maxWidth: '95vw',
          width: '1200px',
          maxHeight: '90vh',
          height: '85vh',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 pe-14 py-4 border-b border-[var(--v2-border)]"
          style={{ background: `linear-gradient(135deg, ${SCHEDULING_COLOR}08 0%, transparent 100%)` }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `${SCHEDULING_COLOR}15` }}
            >
              <Calendar className="w-5 h-5" style={{ color: SCHEDULING_COLOR }} />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-[var(--v2-text-primary)]">
                {language === 'he' ? 'יומן פגישות' : 'Calendar'}
              </DialogTitle>
              <p className="text-xs text-[var(--v2-text-muted)]">
                {language === 'he' ? 'נהל את הפגישות שלך' : 'Manage your appointments'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewBooking}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#14B8A6] focus:ring-offset-2 focus:ring-offset-[var(--v2-surface)]"
              style={{ background: SCHEDULING_COLOR }}
            >
              <Plus className="w-4 h-4" />
              {language === 'he' ? 'פגישה חדשה' : 'New Booking'}
            </button>
          </div>
        </div>

        {/* Content - Calendar + Side Panel */}
        <div className="flex-1 overflow-hidden flex">
          {/* Calendar View - takes remaining space */}
          <div className={`flex-1 overflow-hidden p-4 transition-all duration-300 ${showBookingPanel ? 'opacity-50' : ''}`}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: SCHEDULING_COLOR }} />
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

          {/* Side Panel - Booking Form */}
          <div
            className={`flex-shrink-0 border-s border-[var(--v2-border)] bg-[var(--v2-surface)] transition-all duration-300 overflow-hidden ${
              showBookingPanel ? 'w-[380px]' : 'w-0'
            }`}
          >
            {showBookingPanel && (
              <form onSubmit={handleSubmit} className="h-full flex flex-col">
                {/* Panel Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
                  <h3 className="font-semibold text-[var(--v2-text-primary)]">
                    {language === 'he' ? 'פגישה חדשה' : 'New Booking'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBookingPanel(false);
                      resetForm();
                    }}
                    className="p-1.5 hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-[var(--v2-text-muted)]" />
                  </button>
                </div>

                {/* Scrollable Form Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  {/* Service Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wide">
                      {language === 'he' ? 'שירות' : 'Service'}
                    </label>
                    <Select
                      value={formData.service_id}
                      onValueChange={handleServiceChange}
                    >
                      <SelectTrigger
                        className="w-full bg-[var(--v2-bg)] border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:border-[#14B8A6] focus:ring-[#14B8A6]/20"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <SelectValue placeholder={language === 'he' ? 'בחר שירות' : 'Select service'} />
                      </SelectTrigger>
                      <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)] p-1">
                        {services
                          .filter(service => service.status === 'active')
                          .map(service => (
                            <SelectItem
                              key={service.id}
                              value={service.id}
                              className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488] py-2 px-3 cursor-pointer text-sm"
                            >
                              <div className="flex items-center justify-between gap-2 w-full">
                                <span>{service.service_name}</span>
                                <span className="text-xs text-[var(--v2-text-muted)]">{service.duration_minutes}m</span>
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Client Section */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wide">
                      {language === 'he' ? 'לקוח' : 'Client'}
                    </label>

                    {/* Selected Contact Display */}
                    {selectedContact && !showClientSearch && (
                      <div
                        className="flex items-center justify-between p-3 bg-[#14B8A6]/10 border border-[#14B8A6]/30"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10">
                            {(selectedContact.first_name?.[0] || '') + (selectedContact.last_name?.[0] || '')}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                              {selectedContact.first_name} {selectedContact.last_name}
                            </p>
                            <p className="text-xs text-[var(--v2-text-muted)]">{selectedContact.email}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={clearSelectedContact}
                          className="p-1 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Client Search */}
                    {showClientSearch && (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
                          <input
                            type="text"
                            value={clientSearchQuery}
                            onChange={(e) => setClientSearchQuery(e.target.value)}
                            placeholder={language === 'he' ? 'חפש לקוח...' : 'Search client...'}
                            className="w-full ps-9 pe-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                          {isSearching && (
                            <div className="absolute end-3 top-1/2 -translate-y-1/2">
                              <div className="w-3.5 h-3.5 border-2 border-[#14B8A6] border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                        </div>

                        {/* Search Results */}
                        {clientSearchResults.length > 0 && (
                          <div
                            className="max-h-32 overflow-y-auto border border-[var(--v2-border)] bg-[var(--v2-surface)] divide-y divide-[var(--v2-border)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            {clientSearchResults.map(contact => (
                              <button
                                key={contact.id}
                                type="button"
                                onClick={() => selectContact(contact)}
                                className="w-full flex items-center gap-2 p-2 hover:bg-[#14B8A6]/10 transition-colors text-start"
                              >
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 flex-shrink-0">
                                  {(contact.first_name?.[0] || '') + (contact.last_name?.[0] || '')}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                                    {contact.first_name} {contact.last_name}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Add New Client Button */}
                        <button
                          type="button"
                          onClick={() => setShowClientSearch(false)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[#14B8A6] bg-[#14B8A6]/10 border border-[#14B8A6]/30 hover:bg-[#14B8A6]/20 transition-all"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          {language === 'he' ? 'לקוח חדש' : 'New client'}
                        </button>
                      </div>
                    )}

                    {/* Manual Client Entry */}
                    {!showClientSearch && !selectedContact && (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => setShowClientSearch(true)}
                          className="text-xs text-[#14B8A6] hover:underline flex items-center gap-1"
                        >
                          <Search className="h-3 w-3" />
                          {language === 'he' ? 'חפש לקוח קיים' : 'Search existing'}
                        </button>

                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={formData.client_first_name}
                            onChange={(e) => setFormData(prev => ({ ...prev, client_first_name: e.target.value }))}
                            placeholder={language === 'he' ? 'שם פרטי *' : 'First name *'}
                            required
                            className="px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                          <input
                            value={formData.client_last_name}
                            onChange={(e) => setFormData(prev => ({ ...prev, client_last_name: e.target.value }))}
                            placeholder={language === 'he' ? 'שם משפחה' : 'Last name'}
                            className="px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                        </div>

                        <input
                          type="email"
                          value={formData.client_email}
                          onChange={(e) => setFormData(prev => ({ ...prev, client_email: e.target.value }))}
                          placeholder={language === 'he' ? 'אימייל *' : 'Email *'}
                          required
                          className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        />

                        <input
                          type="tel"
                          value={formData.client_phone}
                          onChange={(e) => setFormData(prev => ({ ...prev, client_phone: e.target.value }))}
                          placeholder={language === 'he' ? 'טלפון' : 'Phone'}
                          className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Quick Pick Time Slots */}
                  {quickSlots.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wide">
                        {language === 'he' ? 'זמנים פנויים' : 'Available'}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {quickSlots.map((slot, index) => {
                          const isSelected =
                            formData.start_time === formatDateTimeLocal(slot.start) &&
                            formData.end_time === formatDateTimeLocal(slot.end);

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
                              className={`flex flex-col items-center p-2 text-xs transition-all ${
                                isSelected
                                  ? 'bg-[#14B8A6] text-white'
                                  : 'bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:border-[#14B8A6] hover:bg-[#14B8A6]/10'
                              }`}
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <span className={`text-[10px] ${isSelected ? 'text-white/80' : 'text-[var(--v2-text-muted)]'}`}>
                                {getDayLabel(slot.dayOffset, slot.start)}
                              </span>
                              <span className="font-semibold" dir="ltr">{getTimeLabel(slot.start)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Custom Time Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wide">
                      {language === 'he' ? 'זמן' : 'Time'}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="datetime-local"
                        value={formData.start_time}
                        onChange={(e) => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                        required
                        className="px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-xs focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                      <input
                        type="datetime-local"
                        value={formData.end_time}
                        onChange={(e) => setFormData(prev => ({ ...prev, end_time: e.target.value }))}
                        required
                        className="px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-xs focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wide">
                      {language === 'he' ? 'הערות' : 'Notes'}
                    </label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder={language === 'he' ? 'הערות...' : 'Notes...'}
                      rows={2}
                      className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all resize-none"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                  </div>
                </div>

                {/* Form Footer */}
                <div className="flex-shrink-0 flex gap-2 p-4 border-t border-[var(--v2-border)]">
                  <button
                    type="button"
                    onClick={() => {
                      setShowBookingPanel(false);
                      resetForm();
                    }}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {language === 'he' ? 'ביטול' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    disabled={formLoading || !formData.service_id || !formData.client_first_name || !formData.client_email}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-[#14B8A6] hover:bg-[#0D9488] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {formLoading
                      ? (language === 'he' ? 'שומר...' : 'Saving...')
                      : (language === 'he' ? 'צור' : 'Create')
                    }
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </DialogContent>

      {/* Edit Booking Modal */}
      <SchedulingBookingModal
        booking={editingBooking}
        services={services}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingBooking(undefined);
        }}
        onBookingUpdated={() => {
          fetchAllData();
          setShowEditModal(false);
          setEditingBooking(undefined);
        }}
        availability={availability}
        existingBookings={bookings}
      />
    </Dialog>
  );
}
