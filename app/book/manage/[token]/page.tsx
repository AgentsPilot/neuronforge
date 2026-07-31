'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, Clock, User, Mail, X, RefreshCw } from 'lucide-react';

interface Service {
  id: string;
  service_name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
}

interface BookingData {
  id: string;
  clientName: string;
  clientEmail: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  paymentStatus: string;
  notes: string | null;
  service: Service;
  canReschedule: boolean;
  canCancel: boolean;
  hoursUntilBooking: number;
}

interface BusinessData {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  websiteUrl: string | null;
}

export default function BookingManagePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [booking, setBooking] = useState<BookingData | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Booking Not Found</h1>
          <p className="text-gray-600 mb-6">
            {error || 'This booking link may have expired or the booking no longer exists.'}
          </p>
        </div>
      </div>
    );
  }

  const primaryColor = business?.primaryColor || '#4F46E5';
  const businessName = business?.name || 'Business';
  const isCancelled = booking.status === 'cancelled';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {business?.logoUrl && (
            <img
              src={business.logoUrl}
              alt={businessName}
              className="h-12 mx-auto mb-3"
            />
          )}
          <h1 className="text-2xl font-bold text-gray-900">{businessName}</h1>
          <p className="text-gray-600 mt-1">Manage Your Booking</p>
        </div>

        {/* Booking Card */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Status Banner */}
          <div
            className="px-6 py-3 text-white text-center font-medium"
            style={{ backgroundColor: isCancelled ? '#DC2626' : primaryColor }}
          >
            {isCancelled ? 'Cancelled' : booking.status === 'confirmed' ? 'Confirmed' : 'Pending'}
          </div>

          {/* Service Info */}
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{booking.service.service_name}</h2>

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

          {/* Client Info */}
          <div className="p-6 bg-gray-50 border-b">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">Your Details</h3>
            <div className="space-y-2">
              <div className="flex items-center text-gray-700">
                <User className="w-4 h-4 mr-3 text-gray-400" />
                <span>{booking.clientName}</span>
              </div>
              <div className="flex items-center text-gray-700">
                <Mail className="w-4 h-4 mr-3 text-gray-400" />
                <span>{booking.clientEmail}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {booking.notes && (
            <div className="p-6 border-b">
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
              <p className="text-gray-700">{booking.notes}</p>
            </div>
          )}

          {/* Actions */}
          {!isCancelled && (
            <div className="p-6 space-y-3">
              {booking.canReschedule && (
                <button
                  onClick={() => router.push(`/book/manage/${token}/reschedule`)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all"
                  style={{
                    backgroundColor: `${primaryColor}15`,
                    color: primaryColor
                  }}
                >
                  <RefreshCw className="w-5 h-5" />
                  Reschedule Appointment
                </button>
              )}

              {booking.canCancel && (
                <button
                  onClick={() => router.push(`/book/manage/${token}/cancel`)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-all"
                >
                  <X className="w-5 h-5" />
                  Cancel Appointment
                </button>
              )}

              {!booking.canReschedule && !booking.canCancel && (
                <p className="text-center text-gray-500 text-sm py-2">
                  Changes can only be made more than 24 hours before your appointment.
                </p>
              )}
            </div>
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
