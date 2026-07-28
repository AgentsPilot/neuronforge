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
    viewSchedule: 'View Schedule'
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
    viewSchedule: 'Ver Calendario'
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
    viewSchedule: 'צפה בלוח זמנים'
  }
};

interface ServiceOption {
  id: string;
  name: string;
  duration: number;
  price?: string;
}

export function BookingWidgetBlock({ content, styles, theme, locale, isRTL, className }: BlockRendererProps) {
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
  const [loading, setLoading] = useState(false);

  // Generate next 7 days
  const nextDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date;
  });

  // Mock available time slots (in real implementation, fetch from API)
  const mockTimeSlots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];

  useEffect(() => {
    // In real implementation, fetch services from API
    if (services.length > 0) {
      setServiceOptions(services.map((s, i) => ({
        id: `service-${i}`,
        name: s,
        duration: 60
      })));
    }
  }, [services]);

  useEffect(() => {
    if (selectedDate) {
      setLoading(true);
      // Simulate API call
      setTimeout(() => {
        setAvailableSlots(mockTimeSlots);
        setLoading(false);
      }, 500);
    }
  }, [selectedDate]);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleBook = () => {
    // In real implementation, redirect to booking page or open modal
    window.location.href = `/book?service=${selectedService}&date=${selectedDate?.toISOString()}&time=${selectedTime}`;
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
            style={{ fontFamily: theme?.fonts.heading }}
          >
            {title || labels.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-4 text-gray-600 dark:text-gray-300"
            style={{ fontFamily: theme?.fonts.body }}
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
                      {service.duration} min {service.price && `• ${service.price}`}
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
