'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, Clock, AlertTriangle, CheckCircle, ArrowLeft, X } from 'lucide-react';

interface BookingData {
  id: string;
  clientName: string;
  clientEmail: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  service: {
    service_name: string;
    duration_minutes: number;
  };
  canCancel: boolean;
  hoursUntilBooking: number;
}

interface BusinessData {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
}

export default function CancelBookingPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [booking, setBooking] = useState<BookingData | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    async function fetchBooking() {
      try {
        const response = await fetch(`/api/book/manage/${token}`);
        const data = await response.json();

        if (data.success) {
          setBooking(data.booking);
          setBusiness(data.business);
        } else {
          setError(data.error || 'Failed to load booking');
        }
      } catch {
        setError('Failed to load booking details');
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      fetchBooking();
    }
  }, [token]);

  const formatDate = (dateStr: string, timezone: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: timezone
      });
    } catch {
      return new Date(dateStr).toLocaleDateString();
    }
  };

  const formatTime = (dateStr: string, timezone: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone
      });
    } catch {
      return new Date(dateStr).toLocaleTimeString();
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);

    try {
      const response = await fetch(`/api/book/manage/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined })
      });

      const data = await response.json();

      if (data.success) {
        setCancelled(true);
      } else {
        setError(data.error || 'Failed to cancel booking');
      }
    } catch {
      setError('Failed to cancel booking');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Unable to Load Booking</h1>
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

  if (cancelled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Booking Cancelled</h1>
          <p className="text-gray-600 mb-6">
            Your appointment has been cancelled. You will receive a confirmation email shortly.
          </p>
          <p className="text-sm text-gray-500">
            If you need to book a new appointment, please visit {business?.name || 'our'} website.
          </p>
        </div>
      </div>
    );
  }

  if (!booking) {
    return null;
  }

  const primaryColor = business?.primaryColor || '#4F46E5';
  const businessName = business?.name || 'Business';

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
          <h1 className="text-2xl font-bold text-gray-900">Cancel Appointment</h1>
        </div>

        {/* Warning Card */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Warning Banner */}
          <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-800 font-medium">Are you sure you want to cancel?</p>
              <p className="text-amber-700 text-sm mt-1">This action cannot be undone.</p>
            </div>
          </div>

          {/* Booking Details */}
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{booking.service.service_name}</h2>

            <div className="space-y-3">
              <div className="flex items-center text-gray-600">
                <Calendar className="w-5 h-5 mr-3" style={{ color: primaryColor }} />
                <span>{formatDate(booking.startTime, booking.timezone)}</span>
              </div>

              <div className="flex items-center text-gray-600">
                <Clock className="w-5 h-5 mr-3" style={{ color: primaryColor }} />
                <span>
                  {formatTime(booking.startTime, booking.timezone)} - {formatTime(booking.endTime, booking.timezone)}
                  <span className="text-gray-400 ml-2">({booking.service.duration_minutes} min)</span>
                </span>
              </div>
            </div>
          </div>

          {/* Can Cancel Check */}
          {!booking.canCancel ? (
            <div className="p-6 bg-gray-50">
              <p className="text-gray-600 text-center">
                Bookings must be cancelled at least 24 hours in advance.
                <br />
                <span className="text-sm text-gray-500">
                  This booking is in {booking.hoursUntilBooking} hours.
                </span>
              </p>
            </div>
          ) : (
            <>
              {/* Reason Input */}
              <div className="p-6 border-b">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for cancellation (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Let us know why you're cancelling..."
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                  rows={3}
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="px-6 py-3 bg-red-50 border-b border-red-100">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              {/* Actions */}
              <div className="p-6 space-y-3">
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {cancelling ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <X className="w-5 h-5" />
                      Confirm Cancellation
                    </>
                  )}
                </button>

                <button
                  onClick={() => router.push(`/book/manage/${token}`)}
                  className="w-full px-4 py-3 rounded-xl font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-all"
                >
                  Keep My Appointment
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-sm mt-6">
          Questions? Contact {businessName} directly.
        </p>
      </div>
    </div>
  );
}
