'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { SchedulingCalendarView } from '@/components/scheduling/SchedulingCalendarView';
import { SchedulingServicesList } from '@/components/scheduling/SchedulingServicesList';
import { SchedulingServiceModal } from '@/components/scheduling/SchedulingServiceModal';
import { SchedulingBookingModal } from '@/components/scheduling/SchedulingBookingModal';
import { AvailabilityEditor, DEFAULT_AVAILABILITY, parseAvailability, type WeeklyAvailability } from '@/components/scheduling/AvailabilityEditor';
import { CalendarSyncSettings } from '@/components/scheduling/CalendarSyncSettings';
import { Calendar, List, Plus, Search, ArrowLeft, Clock } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { SchedulingService, SchedulingBooking } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'SchedulingPage' });

// Scheduling theme color: Teal
const SCHEDULING_COLOR = '#14B8A6';

type ViewMode = 'calendar' | 'services' | 'availability';

export default function SchedulingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  // Read initial tab from query params (e.g., ?tab=services)
  const initialTab = searchParams.get('tab') as ViewMode | null;
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialTab && ['calendar', 'services', 'availability'].includes(initialTab)
      ? initialTab
      : 'calendar'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [bookings, setBookings] = useState<SchedulingBooking[]>([]);
  const [selectedService, setSelectedService] = useState<SchedulingService | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<SchedulingBooking | null>(null);
  const [isNewServiceModalOpen, setIsNewServiceModalOpen] = useState(false);
  const [isNewBookingModalOpen, setIsNewBookingModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [availabilitySaved, setAvailabilitySaved] = useState(false);
  const [externalEventsRefreshTrigger, setExternalEventsRefreshTrigger] = useState(0);

  // Silent refresh of external calendar events
  const refreshExternalEvents = () => {
    setExternalEventsRefreshTrigger(prev => prev + 1);
  };

  useEffect(() => {
    fetchData();
    fetchAvailability();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [servicesResponse, bookingsResponse] = await Promise.all([
        fetch('/api/scheduling/services'),
        fetch('/api/scheduling/bookings')
      ]);

      const [servicesData, bookingsData] = await Promise.all([
        servicesResponse.json(),
        bookingsResponse.json()
      ]);

      if (servicesData.success) setServices(servicesData.services);
      if (bookingsData.success) setBookings(bookingsData.bookings);
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch scheduling data');
    } finally {
      setLoading(false);
    }
  };

  // Silent refresh - only updates bookings without showing loading state
  const refreshBookingsSilently = async () => {
    try {
      const response = await fetch('/api/scheduling/bookings');
      const data = await response.json();
      if (data.success) setBookings(data.bookings);
    } catch (error) {
      logger.error({ err: error }, 'Failed to refresh bookings');
    }
  };

  const fetchAvailability = async () => {
    try {
      const response = await fetch('/api/scheduling/availability');
      const data = await response.json();
      if (data.success && data.availability) {
        setAvailability(parseAvailability(data.availability));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch availability');
    }
  };

  const saveAvailability = async () => {
    try {
      setSavingAvailability(true);
      setAvailabilitySaved(false);
      const response = await fetch('/api/scheduling/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability })
      });
      const data = await response.json();
      if (data.success) {
        setAvailabilitySaved(true);
        setTimeout(() => setAvailabilitySaved(false), 3000);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to save availability');
    } finally {
      setSavingAvailability(false);
    }
  };

  const handleServiceCreated = () => {
    setIsNewServiceModalOpen(false);
    fetchData();
  };

  const handleServiceUpdated = () => {
    setSelectedService(null);
    fetchData();
  };

  const handleBookingCreated = () => {
    setIsNewBookingModalOpen(false);
    refreshBookingsSilently();
  };

  const handleBookingUpdated = () => {
    setSelectedBooking(null);
    refreshBookingsSilently();
  };

  // State for pre-filling booking from calendar slot click
  const [prefilledDateTime, setPrefilledDateTime] = useState<{ date: Date; hour: number } | null>(null);

  const handleSlotClick = (date: Date, hour: number) => {
    setPrefilledDateTime({ date, hour });
    setIsNewBookingModalOpen(true);
  };

  // Filter bookings based on search query
  const filteredBookings = bookings.filter(booking => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      booking.client_first_name?.toLowerCase().includes(searchLower) ||
      booking.client_last_name?.toLowerCase().includes(searchLower) ||
      booking.client_email?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]">
      <BusinessOSHeader />

      {/* Main Content with max-width like dashboard */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">

        {/* Back Button */}
        <button
          onClick={() => router.push('/business-os')}
          className="flex items-center gap-2 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors group"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          <span className="text-sm font-medium">{t('scheduling.back_to_dashboard')}</span>
        </button>

        {/* Page Header with teal theme (Scheduling capability color) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: 'rgba(20, 184, 166, 0.2)' }}
            >
              <Calendar className="w-6 h-6" style={{ color: SCHEDULING_COLOR }} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[var(--v2-text-primary)]">
                {t('capability.scheduling.name')}
              </h1>
              <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                {t('scheduling.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
              <input
                type="text"
                placeholder={t('scheduling.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10 pe-4 py-2 w-64 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[#14B8A6] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>
            {viewMode === 'calendar' && (
              <button
                onClick={() => setIsNewBookingModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-[#14B8A6] text-sm font-medium border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Plus className="h-4 w-4" />
                {t('scheduling.new_booking')}
              </button>
            )}
            {viewMode === 'services' && (
              <button
                onClick={() => setIsNewServiceModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-[#14B8A6] text-sm font-medium border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Plus className="h-4 w-4" />
                {t('scheduling.new_service')}
              </button>
            )}
          </div>
        </div>

        {/* Calendar Sync Banner - Prominent position at top like Stripe */}
        <CalendarSyncSettings onSyncChanged={refreshExternalEvents} />

        {/* View Mode Tabs - pill style like dashboard */}
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-1 inline-flex gap-1"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all border ${
              viewMode === 'calendar'
                ? 'text-[#14B8A6] border-[#14B8A6] bg-[#14B8A6]/10'
                : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
            }`}
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            onClick={() => setViewMode('calendar')}
          >
            <Calendar className="h-4 w-4" />
            {t('scheduling.tab_calendar')}
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all border ${
              viewMode === 'services'
                ? 'text-[#14B8A6] border-[#14B8A6] bg-[#14B8A6]/10'
                : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
            }`}
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            onClick={() => setViewMode('services')}
          >
            <List className="h-4 w-4" />
            {t('scheduling.tab_services')}
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all border ${
              viewMode === 'availability'
                ? 'text-[#14B8A6] border-[#14B8A6] bg-[#14B8A6]/10'
                : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
            }`}
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            onClick={() => setViewMode('availability')}
          >
            <Clock className="h-4 w-4" />
            {t('scheduling.tab_availability')}
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div
                className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto"
                style={{ borderColor: SCHEDULING_COLOR, borderTopColor: 'transparent' }}
              />
              <p className="text-[var(--v2-text-secondary)] font-medium">{t('scheduling.loading')}</p>
            </div>
          </div>
        ) : (
          <>
            {viewMode === 'calendar' && (
              <SchedulingCalendarView
                bookings={filteredBookings}
                services={services}
                onBookingClick={setSelectedBooking}
                onBookingUpdated={refreshBookingsSilently}
                onSlotClick={handleSlotClick}
                availability={availability}
                externalEventsRefreshTrigger={externalEventsRefreshTrigger}
              />
            )}
            {viewMode === 'services' && (
              <SchedulingServicesList
                services={services}
                onServiceClick={setSelectedService}
                onServicePublished={fetchData}
              />
            )}
            {viewMode === 'availability' && (
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <AvailabilityEditor
                  availability={availability}
                  onChange={setAvailability}
                />
                <div className="mt-6 pt-4 border-t border-[var(--v2-border)] flex items-center justify-end gap-3">
                  {availabilitySaved && (
                    <span className="text-sm text-[#14B8A6] font-medium">
                      {t('scheduling.availability.saved')}
                    </span>
                  )}
                  <button
                    onClick={saveAvailability}
                    disabled={savingAvailability}
                    className="flex items-center gap-2 px-6 py-2.5 text-[#14B8A6] text-sm font-medium border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all disabled:opacity-50"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {savingAvailability ? t('scheduling.availability.saving') : t('scheduling.availability.save')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Service Modal */}
      {(selectedService || isNewServiceModalOpen) && (
        <SchedulingServiceModal
          service={selectedService || undefined}
          isOpen={true}
          onClose={() => {
            setSelectedService(null);
            setIsNewServiceModalOpen(false);
          }}
          onServiceUpdated={isNewServiceModalOpen ? handleServiceCreated : handleServiceUpdated}
        />
      )}

      {/* Booking Modal */}
      {(selectedBooking || isNewBookingModalOpen) && (
        <SchedulingBookingModal
          booking={selectedBooking || undefined}
          services={services}
          isOpen={true}
          onClose={() => {
            setSelectedBooking(null);
            setIsNewBookingModalOpen(false);
            setPrefilledDateTime(null);
          }}
          onBookingUpdated={() => {
            if (isNewBookingModalOpen) {
              handleBookingCreated();
            } else {
              handleBookingUpdated();
            }
            setPrefilledDateTime(null);
          }}
          availability={availability}
          prefilledDateTime={prefilledDateTime || undefined}
          existingBookings={bookings}
        />
      )}
    </div>
  );
}
