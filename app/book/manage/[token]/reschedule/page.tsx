'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, Clock, ChevronLeft, ChevronRight, CheckCircle, ArrowLeft, X } from 'lucide-react';

interface RescheduleConfig {
  bookingId: string;
  serviceId: string;
  userId: string;
  currentStartTime: string;
  serviceConfig: {
    durationMinutes: number;
    advanceBookingDays: number;
    minNoticeHours: number;
  };
}

interface BusinessData {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
}

interface TimeSlot {
  start_time: string;
  end_time: string;
  display_time: string;
}

export default function RescheduleBookingPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [config, setConfig] = useState<RescheduleConfig | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date selection
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Time slots
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  // Rescheduling state
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduled, setRescheduled] = useState(false);
  const [newBookingTime, setNewBookingTime] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRescheduleConfig() {
      try {
        // First get booking details for business info
        const bookingResponse = await fetch(`/api/book/manage/${token}`);
        const bookingData = await bookingResponse.json();

        if (bookingData.success) {
          setBusiness(bookingData.business);
        }

        // Then get reschedule config
        const response = await fetch(`/api/book/manage/${token}/reschedule`);
        const data = await response.json();

        if (data.success) {
          setConfig(data);
        } else {
          setError(data.error || 'Cannot reschedule this booking');
        }
      } catch {
        setError('Failed to load reschedule options');
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      fetchRescheduleConfig();
    }
  }, [token]);

  // Fetch available slots when date is selected
  useEffect(() => {
    async function fetchSlots() {
      if (!selectedDate || !config) return;

      setLoadingSlots(true);
      setSlots([]);
      setSelectedSlot(null);

      try {
        // Use userId directly for availability lookup
        const response = await fetch(
          `/api/website/scheduling/availability?service_id=${config.serviceId}&date=${selectedDate}`
        );
        const data = await response.json();

        if (data.success && data.slots) {
          setSlots(data.slots);
        }
      } catch {
        // Silently fail, show no slots
      } finally {
        setLoadingSlots(false);
      }
    }

    fetchSlots();
  }, [selectedDate, config]);

  const handleReschedule = async () => {
    if (!selectedSlot || !config) return;

    setRescheduling(true);
    setError(null);

    try {
      const response = await fetch(`/api/book/manage/${token}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newStartTime: selectedSlot.start_time,
          newEndTime: selectedSlot.end_time
        })
      });

      const data = await response.json();

      if (data.success) {
        setRescheduled(true);
        setNewBookingTime(data.booking.startTime);
      } else {
        setError(data.error || 'Failed to reschedule booking');
      }
    } catch {
      setError('Failed to reschedule booking');
    } finally {
      setRescheduling(false);
    }
  };

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();

    const days: (number | null)[] = [];

    // Add empty cells for days before the first of the month
    for (let i = 0; i < startingDay; i++) {
      days.push(null);
    }

    // Add the days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    return days;
  };

  const isDateSelectable = (day: number) => {
    if (!config) return false;

    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Must be in the future
    if (date < today) return false;

    // Must be within advance booking days
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + config.serviceConfig.advanceBookingDays);
    if (date > maxDate) return false;

    return true;
  };

  const formatDateString = (day: number) => {
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    return `${year}-${month}-${dayStr}`;
  };

  const formatDisplayDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatNewBookingTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Cannot Reschedule</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push(`/book/manage/${token}`)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to booking
          </button>
        </div>
      </div>
    );
  }

  if (rescheduled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Booking Rescheduled!</h1>
          <p className="text-gray-600 mb-4">
            Your appointment has been rescheduled.
          </p>
          {newBookingTime && (
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <p className="text-sm text-gray-500 mb-1">New appointment time</p>
              <p className="text-gray-900 font-medium">{formatNewBookingTime(newBookingTime)}</p>
            </div>
          )}
          <p className="text-sm text-gray-500 mb-6">
            You will receive a confirmation email shortly.
          </p>
          <button
            onClick={() => router.push(`/book/manage/${token}`)}
            className="px-6 py-2 rounded-xl font-medium text-white transition-all"
            style={{ backgroundColor: business?.primaryColor || '#4F46E5' }}
          >
            View Updated Booking
          </button>
        </div>
      </div>
    );
  }

  if (!config) {
    return null;
  }

  const primaryColor = business?.primaryColor || '#4F46E5';
  const businessName = business?.name || 'Business';
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Back Button */}
        <button
          onClick={() => router.push(`/book/manage/${token}`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to booking
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          {business?.logoUrl && (
            <img
              src={business.logoUrl}
              alt={businessName}
              className="h-12 mx-auto mb-3"
            />
          )}
          <h1 className="text-2xl font-bold text-gray-900">Reschedule Appointment</h1>
          <p className="text-gray-600 mt-1">Select a new date and time</p>
        </div>

        {/* Calendar Card */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Calendar Header */}
          <div className="p-4 border-b flex items-center justify-between">
            <button
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-900">
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </h2>
            <button
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Calendar Grid */}
          <div className="p-4">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Days */}
            <div className="grid grid-cols-7 gap-1">
              {getDaysInMonth(currentMonth).map((day, index) => {
                if (day === null) {
                  return <div key={`empty-${index}`} className="aspect-square" />;
                }

                const dateStr = formatDateString(day);
                const isSelectable = isDateSelectable(day);
                const isSelected = selectedDate === dateStr;

                return (
                  <button
                    key={day}
                    onClick={() => isSelectable && setSelectedDate(dateStr)}
                    disabled={!isSelectable}
                    className={`
                      aspect-square rounded-lg text-sm font-medium transition-all
                      ${isSelected
                        ? 'text-white'
                        : isSelectable
                          ? 'text-gray-900 hover:bg-gray-100'
                          : 'text-gray-300 cursor-not-allowed'
                      }
                    `}
                    style={isSelected ? { backgroundColor: primaryColor } : undefined}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Date & Time Slots */}
          {selectedDate && (
            <div className="border-t">
              <div className="p-4 bg-gray-50 flex items-center gap-2">
                <Calendar className="w-4 h-4" style={{ color: primaryColor }} />
                <span className="text-sm font-medium text-gray-700">
                  {formatDisplayDate(selectedDate)}
                </span>
              </div>

              <div className="p-4">
                {loadingSlots ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-gray-600"></div>
                  </div>
                ) : slots.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">
                    No available times on this date
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map(slot => {
                      const isSelected = selectedSlot?.start_time === slot.start_time;
                      return (
                        <button
                          key={slot.start_time}
                          onClick={() => setSelectedSlot(slot)}
                          className={`
                            px-3 py-2 rounded-lg text-sm font-medium transition-all border
                            ${isSelected
                              ? 'text-white border-transparent'
                              : 'text-gray-700 border-gray-200 hover:border-gray-300'
                            }
                          `}
                          style={isSelected ? { backgroundColor: primaryColor } : undefined}
                        >
                          {slot.display_time}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="px-4 py-3 bg-red-50 border-t border-red-100">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="p-4 border-t space-y-3">
            <button
              onClick={handleReschedule}
              disabled={!selectedSlot || rescheduling}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              style={{ backgroundColor: primaryColor }}
            >
              {rescheduling ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  Rescheduling...
                </>
              ) : (
                <>
                  <Clock className="w-5 h-5" />
                  Confirm New Time
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-sm mt-6">
          Questions? Contact {businessName} directly.
        </p>
      </div>
    </div>
  );
}
