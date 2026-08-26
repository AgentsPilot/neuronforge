'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, ArrowRight, Loader2 } from 'lucide-react';
import type { BlockRendererProps, CapabilityConfig } from './types';

interface BookingWidgetContent {
  title?: string;
  subtitle?: string;
  services?: string[];
  text?: string;
  capability_integration?: string;
  inline_calendar?: boolean;
  redirect_to_scheduler?: boolean;
  service_id?: string;
}

// Localized labels
const LABELS = {
  en: {
    title: 'Book an Appointment',
    subtitle: 'Choose a service and time that works for you',
    selectService: 'Select a service',
    selectDate: 'Select a date',
    selectTime: 'Select a time',
    book: 'Book Now',
    loading: 'Loading availability...',
    noServices: 'No services available',
    viewSchedule: 'View Schedule',
    minutes: 'min',
    hours: 'hr',
    availabilityNotConfigured: 'Booking is coming soon',
    availabilityNotConfiguredSubtitle: 'Our scheduling system is being set up. Please check back soon or contact us directly.'
  },
  es: {
    title: 'Reservar una Cita',
    subtitle: 'Elige un servicio y horario que te convenga',
    selectService: 'Selecciona un servicio',
    selectDate: 'Selecciona una fecha',
    selectTime: 'Selecciona una hora',
    book: 'Reservar Ahora',
    loading: 'Cargando disponibilidad...',
    noServices: 'No hay servicios disponibles',
    viewSchedule: 'Ver Calendario',
    minutes: 'min',
    hours: 'hr',
    availabilityNotConfigured: 'Reservas próximamente',
    availabilityNotConfiguredSubtitle: 'Nuestro sistema de programación está siendo configurado. Por favor vuelve pronto o contáctanos directamente.'
  },
  he: {
    title: 'קביעת תור',
    subtitle: 'בחר שירות ושעה שמתאימים לך',
    selectService: 'בחר שירות',
    selectDate: 'בחר תאריך',
    selectTime: 'בחר שעה',
    book: 'הזמן עכשיו',
    loading: '...טוען זמינות',
    noServices: 'אין שירותים זמינים',
    viewSchedule: 'צפה בלוח זמנים',
    minutes: 'דק׳',
    hours: 'שע׳',
    availabilityNotConfigured: 'הזמנות בקרוב',
    availabilityNotConfiguredSubtitle: 'מערכת התזמון שלנו נמצאת בהקמה. אנא בדקו שוב בקרוב או צרו איתנו קשר ישירות.'
  }
};

interface ServiceOption {
  id: string;
  name: string;
  duration: number;
  price?: string;
}

export function BookingWidgetBlock({ content, styles, theme, locale, isRTL, className, subdomain, clientFlow }: BlockRendererProps) {
  const {
    title,
    subtitle,
    services = [],
    text,
    inline_calendar = true,
    redirect_to_scheduler = false,
    service_id
  } = content as BookingWidgetContent;

  const labels = LABELS[locale] || LABELS.en;
  const primaryColor = theme?.colors.primary || '#4F6EF7';

  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [selectedService, setSelectedService] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [availabilityConfigured, setAvailabilityConfigured] = useState<boolean | null>(null);

  // Generate next 7 days
  const nextDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date;
  });

  // Fetch availability data from API
  useEffect(() => {
    if (!subdomain) {
      setLoading(false);
      return;
    }

    const fetchAvailability = async () => {
      try {
        const response = await fetch(`/api/website/booking/availability?subdomain=${subdomain}`);
        const data = await response.json();

        if (data.success) {
          setAvailabilityConfigured(data.availabilityConfigured);

          if (data.services && data.services.length > 0) {
            setServiceOptions(data.services.map((s: { id: string; name: string; duration_minutes: number; price?: number; currency?: string }) => ({
              id: s.id,
              name: s.name,
              duration: s.duration_minutes,
              price: s.price ? `${s.currency || 'USD'} ${s.price}` : undefined
            })));
          }
        }
      } catch (error) {
        console.error('Failed to fetch availability:', error);
        setAvailabilityConfigured(false);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailability();
  }, [subdomain]);

  // Fetch slots when service and date are selected
  useEffect(() => {
    if (!selectedDate || !selectedService || !subdomain || !availabilityConfigured) {
      return;
    }

    const fetchSlots = async () => {
      setLoading(true);
      try {
        const dateStr = selectedDate.toISOString().split('T')[0];
        const response = await fetch(
          `/api/website/booking/availability?subdomain=${subdomain}&service_id=${selectedService}&date=${dateStr}`
        );
        const data = await response.json();

        if (data.success && data.slots) {
          // Extract just the time from the ISO date strings
          const times = data.slots.map((slot: { start: string }) => {
            const date = new Date(slot.start);
            return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
          });
          setAvailableSlots(times);
        } else {
          setAvailableSlots([]);
        }
      } catch (error) {
        console.error('Failed to fetch slots:', error);
        setAvailableSlots([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSlots();
  }, [selectedDate, selectedService, subdomain, availabilityConfigured, locale]);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleBook = () => {
    // Build booking URL with service and flow parameters
    const params = new URLSearchParams();
    if (selectedService) params.set('service', selectedService);
    if (selectedDate) params.set('date', selectedDate.toISOString());
    if (selectedTime) params.set('time', selectedTime);

    // Pass client flow if configured (excluding confirmation)
    if (clientFlow && clientFlow.length > 0) {
      const flowSteps = clientFlow.filter(s => s !== 'confirmation');
      if (flowSteps.length > 0) {
        params.set('flow', flowSteps.join(','));
      }
    }

    window.location.href = `/book?${params.toString()}`;
  };

  // Button-only mode
  if (redirect_to_scheduler) {
    return (
      <section
        dir={isRTL ? 'rtl' : 'ltr'}
        className={`${styles?.padding || 'py-8 sm:py-12'} ${className || ''}`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <motion.a
            href="/schedule"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold text-white rounded-lg shadow-lg hover:opacity-90 transition-all"
            style={{
              backgroundColor: primaryColor,
              borderRadius: theme?.borderRadius || '0.5rem'
            }}
          >
            <Calendar className="w-5 h-5" />
            {text || labels.book}
            <ArrowRight className="w-5 h-5" />
          </motion.a>
        </div>
      </section>
    );
  }

  // Show loading state
  if (loading && availabilityConfigured === null) {
    return (
      <section
        dir={isRTL ? 'rtl' : 'ltr'}
        id="booking"
        className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
            <p className="mt-4 text-gray-500">{labels.loading}</p>
          </div>
        </div>
      </section>
    );
  }

  // Show message when availability is not configured
  if (availabilityConfigured === false) {
    return (
      <section
        dir={isRTL ? 'rtl' : 'ltr'}
        id="booking"
        className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 sm:p-12 text-center"
            style={{ borderRadius: theme?.borderRadius || '1rem' }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ backgroundColor: `${primaryColor}15` }}
            >
              <Clock className="w-8 h-8" style={{ color: primaryColor }} />
            </div>
            <h3
              className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-4"
              style={{ fontFamily: 'var(--website-font-heading)' }}
            >
              {labels.availabilityNotConfigured}
            </h3>
            <p
              className="text-gray-600 dark:text-gray-300 max-w-md mx-auto"
              style={{ fontFamily: 'var(--website-font-body)' }}
            >
              {labels.availabilityNotConfiguredSubtitle}
            </p>
          </motion.div>
        </div>
      </section>
    );
  }

  // Inline calendar mode
  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      id="booking"
      className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-10">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white"
            style={{ fontFamily: 'var(--website-font-heading)' }}
          >
            {title || labels.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-4 text-gray-600 dark:text-gray-300"
            style={{ fontFamily: 'var(--website-font-body)' }}
          >
            {subtitle || labels.subtitle}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 sm:p-8"
          style={{ borderRadius: theme?.borderRadius || '1rem' }}
        >
          {/* Service Selection */}
          {serviceOptions.length > 0 && (
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                {labels.selectService}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {serviceOptions.map((service) => (
                  <button
                    key={service.id}
                    onClick={() => setSelectedService(service.id)}
                    className={`p-4 text-start rounded-xl border-2 transition-all ${
                      selectedService === service.id
                        ? 'border-current'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                    }`}
                    style={{
                      borderColor: selectedService === service.id ? primaryColor : undefined,
                      backgroundColor: selectedService === service.id ? `${primaryColor}10` : undefined
                    }}
                  >
                    <p className="font-medium text-gray-900 dark:text-white">{service.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {service.duration} {labels.minutes} {service.price && `• ${service.price}`}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Date Selection */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              {labels.selectDate}
            </label>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {nextDays.map((date, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedDate(date)}
                  className={`flex-shrink-0 p-3 rounded-xl border-2 transition-all min-w-[80px] text-center ${
                    selectedDate?.toDateString() === date.toDateString()
                      ? 'border-current'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                  }`}
                  style={{
                    borderColor: selectedDate?.toDateString() === date.toDateString() ? primaryColor : undefined,
                    backgroundColor: selectedDate?.toDateString() === date.toDateString() ? `${primaryColor}10` : undefined
                  }}
                >
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {date.toLocaleDateString(locale, { weekday: 'short' })}
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {date.getDate()}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Time Selection */}
          {selectedDate && (
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                {labels.selectTime}
              </label>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  <span className="ms-2 text-gray-500">{labels.loading}</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {availableSlots.map((time) => (
                    <button
                      key={time}
                      onClick={() => setSelectedTime(time)}
                      className={`p-3 rounded-lg border-2 transition-all text-center ${
                        selectedTime === time
                          ? 'border-current'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                      }`}
                      style={{
                        borderColor: selectedTime === time ? primaryColor : undefined,
                        backgroundColor: selectedTime === time ? `${primaryColor}10` : undefined
                      }}
                    >
                      <span className="font-medium text-gray-900 dark:text-white">{time}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Book Button */}
          <button
            onClick={handleBook}
            disabled={!selectedDate || !selectedTime || (serviceOptions.length > 0 && !selectedService)}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 text-white font-semibold rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-all"
            style={{
              backgroundColor: primaryColor,
              borderRadius: theme?.borderRadius || '0.5rem'
            }}
          >
            <Calendar className="w-5 h-5" />
            {labels.book}
          </button>
        </motion.div>
      </div>
    </section>
  );
}
