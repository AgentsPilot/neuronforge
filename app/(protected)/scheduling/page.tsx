'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { SchedulingCalendarView } from '@/components/scheduling/SchedulingCalendarView';
import { SchedulingServicesList } from '@/components/scheduling/SchedulingServicesList';
import { SchedulingServiceModal } from '@/components/scheduling/SchedulingServiceModal';
import { SchedulingBookingModal } from '@/components/scheduling/SchedulingBookingModal';
import { parseAvailability, DEFAULT_AVAILABILITY, type WeeklyAvailability } from '@/components/scheduling/AvailabilityEditor';
import { Calendar, List, Plus } from 'lucide-react';
import type { SchedulingService, SchedulingBooking } from '@/lib/repositories/SchedulingRepository';

type ViewMode = 'calendar' | 'services';

export default function SchedulingPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [bookings, setBookings] = useState<SchedulingBooking[]>([]);
  const [selectedService, setSelectedService] = useState<SchedulingService | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<SchedulingBooking | null>(null);
  const [isNewServiceModalOpen, setIsNewServiceModalOpen] = useState(false);
  const [isNewBookingModalOpen, setIsNewBookingModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);

  useEffect(() => {
    fetchData();
    fetchAvailability();
  }, []);

  const fetchAvailability = async () => {
    try {
      const response = await fetch('/api/scheduling/availability');
      const data = await response.json();
      if (data.success && data.availability) {
        setAvailability(parseAvailability(data.availability));
      }
    } catch (error) {
      console.error('Failed to fetch availability:', error);
    }
  };

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
      console.error('Failed to fetch scheduling data:', error);
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
      console.error('Failed to refresh bookings:', error);
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

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold text-slate-900">📅 Scheduling</h1>
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'calendar' ? 'default' : 'ghost'}
                onClick={() => setViewMode('calendar')}
                size="sm"
                className="gap-2"
              >
                <Calendar className="h-4 w-4" />
                Calendar
              </Button>
              <Button
                variant={viewMode === 'services' ? 'default' : 'ghost'}
                onClick={() => setViewMode('services')}
                size="sm"
                className="gap-2"
              >
                <List className="h-4 w-4" />
                Services
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {viewMode === 'calendar' && (
              <Button
                onClick={() => setIsNewBookingModalOpen(true)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                New Booking
              </Button>
            )}
            {viewMode === 'services' && (
              <Button
                onClick={() => setIsNewServiceModalOpen(true)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                New Service
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-500">Loading...</div>
          </div>
        ) : (
          <>
            {viewMode === 'calendar' && (
              <SchedulingCalendarView
                bookings={bookings}
                services={services}
                onBookingClick={setSelectedBooking}
                onBookingUpdated={refreshBookingsSilently}
              />
            )}
            {viewMode === 'services' && (
              <SchedulingServicesList
                services={services}
                onServiceClick={setSelectedService}
              />
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
          }}
          onBookingUpdated={isNewBookingModalOpen ? handleBookingCreated : handleBookingUpdated}
          availability={availability}
          existingBookings={bookings}
        />
      )}
    </div>
  );
}
