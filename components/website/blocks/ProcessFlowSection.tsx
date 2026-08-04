'use client';

/**
 * Process Flow Section
 *
 * A unified, self-contained section that orchestrates the entire client journey:
 * Services → DateTime → Details → Payment → Intake → Confirmation
 *
 * This section:
 * - Uses existing block designs for consistency
 * - Fetches capabilities dynamically (Scheduling, Payments, Forms)
 * - Provides slider navigation between steps (RTL-aware)
 * - Connects data between steps (service → booking → payment)
 *
 * The flow is configured via the `flow` prop which determines which steps are shown.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Clock, CreditCard, FileText, Check, ArrowLeft, ArrowRight,
  Loader2, User, Mail, Phone, ChevronLeft, ChevronRight, Shield, Lock,
  ClipboardList
} from 'lucide-react';
import type { BlockRendererProps, FlowStep, FormField } from './types';
import { flowHasScheduling, flowHasClientInfo } from './types';
import { IntakeFormStep, type IntakeTemplate } from './IntakeFormStep';
import { StripePaymentForm } from './StripePaymentForm';

// ============================================================================
// TYPES
// ============================================================================

interface Service {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
  icon?: string;
}

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
  display_time?: string; // Pre-formatted display time from API
}

interface ProcessFlowContent {
  title?: string;
  subtitle?: string;
  flow?: FlowStep[];
  intake_form_id?: string;
  intake_fields?: FormField[];
  /** Pre-selected service - skips service selection step */
  initialService?: {
    id: string;
    name: string;
    description: string | null;
    duration_minutes: number;
    price: number | null;
    currency: string;
  };
}

type CurrentStep = 'services' | 'datetime' | 'details' | 'payment' | 'intake' | 'confirmation';

// Localized labels
const LABELS = {
  en: {
    chooseService: 'Choose a Service',
    selectDate: 'Select a Date',
    selectTime: 'Select a Time',
    yourDetails: 'Your Details',
    name: 'Your Name',
    email: 'Email Address',
    phone: 'Phone Number',
    notes: 'Notes (optional)',
    notesPlaceholder: 'Any special requests or notes...',
    backToServices: 'Back to services',
    backToDateTime: 'Back to date & time',
    back: 'Back',
    noServices: 'No services available at this time.',
    noSlots: 'No available times for this date',
    loading: 'Loading...',
    bookNow: 'Book Now',
    continueToPayment: 'Continue to Payment',
    continueToQuestions: 'Continue to Questions',
    confirmBooking: 'Confirm Booking',
    completePayment: 'Complete Payment',
    securePayment: 'Secure payment for your booking',
    pay: 'Pay',
    securePaymentLabel: 'Secure payment',
    poweredByStripe: 'Powered by Stripe',
    processing: 'Processing...',
    confirmingBooking: 'Confirming booking...',
    submitting: 'Submitting...',
    aFewQuestions: 'A Few Questions',
    helpUsPrepare: 'Help us prepare for your appointment',
    completeBooking: 'Complete Booking',
    bookingConfirmed: 'Booking Confirmed!',
    confirmationEmailSent: 'We\'ve sent a confirmation email to',
    bookingDetails: 'Booking Details',
    service: 'Service',
    date: 'Date',
    time: 'Time',
    duration: 'Duration',
    bookAnotherService: 'Book Another Service',
    minutes: 'min',
    hours: 'hours',
    hour: 'hour',
    days: 'days',
    day: 'day',
    free: 'Free'
  },
  es: {
    chooseService: 'Elige un Servicio',
    selectDate: 'Selecciona una Fecha',
    selectTime: 'Selecciona una Hora',
    yourDetails: 'Tus Datos',
    name: 'Tu Nombre',
    email: 'Correo Electrónico',
    phone: 'Teléfono',
    notes: 'Notas (opcional)',
    notesPlaceholder: 'Solicitudes especiales o notas...',
    backToServices: 'Volver a servicios',
    backToDateTime: 'Volver a fecha y hora',
    back: 'Volver',
    noServices: 'No hay servicios disponibles en este momento.',
    noSlots: 'No hay horarios disponibles para esta fecha',
    loading: 'Cargando...',
    bookNow: 'Reservar Ahora',
    continueToPayment: 'Continuar al Pago',
    continueToQuestions: 'Continuar a Preguntas',
    confirmBooking: 'Confirmar Reserva',
    completePayment: 'Completar Pago',
    securePayment: 'Pago seguro para tu reserva',
    pay: 'Pagar',
    securePaymentLabel: 'Pago seguro',
    poweredByStripe: 'Desarrollado por Stripe',
    processing: 'Procesando...',
    confirmingBooking: 'Confirmando reserva...',
    submitting: 'Enviando...',
    aFewQuestions: 'Unas Preguntas',
    helpUsPrepare: 'Ayúdanos a preparar tu cita',
    completeBooking: 'Completar Reserva',
    bookingConfirmed: '¡Reserva Confirmada!',
    confirmationEmailSent: 'Hemos enviado un email de confirmación a',
    bookingDetails: 'Detalles de la Reserva',
    service: 'Servicio',
    date: 'Fecha',
    time: 'Hora',
    duration: 'Duración',
    bookAnotherService: 'Reservar Otro Servicio',
    minutes: 'min',
    hours: 'horas',
    hour: 'hora',
    days: 'días',
    day: 'día',
    free: 'Gratis'
  },
  he: {
    chooseService: 'בחר שירות',
    selectDate: 'בחר תאריך',
    selectTime: 'בחר שעה',
    yourDetails: 'הפרטים שלך',
    name: 'השם שלך',
    email: 'כתובת אימייל',
    phone: 'מספר טלפון',
    notes: 'הערות (אופציונלי)',
    notesPlaceholder: 'בקשות מיוחדות או הערות...',
    backToServices: 'חזרה לשירותים',
    backToDateTime: 'חזרה לתאריך ושעה',
    back: 'חזרה',
    noServices: 'אין שירותים זמינים כרגע.',
    noSlots: 'אין שעות זמינות לתאריך זה',
    loading: '...טוען',
    bookNow: 'הזמן עכשיו',
    continueToPayment: 'המשך לתשלום',
    continueToQuestions: 'המשך לשאלות',
    confirmBooking: 'אשר הזמנה',
    completePayment: 'השלם תשלום',
    securePayment: 'תשלום מאובטח להזמנה שלך',
    pay: 'שלם',
    securePaymentLabel: 'תשלום מאובטח',
    poweredByStripe: 'מופעל על ידי Stripe',
    processing: '...מעבד',
    confirmingBooking: '...מאשר הזמנה',
    submitting: '...שולח',
    aFewQuestions: 'כמה שאלות',
    helpUsPrepare: 'עזור לנו להתכונן לפגישה שלך',
    completeBooking: 'השלם הזמנה',
    bookingConfirmed: '!ההזמנה אושרה',
    confirmationEmailSent: 'שלחנו אימייל אישור אל',
    bookingDetails: 'פרטי ההזמנה',
    service: 'שירות',
    date: 'תאריך',
    time: 'שעה',
    duration: 'משך',
    bookAnotherService: 'הזמן שירות נוסף',
    minutes: 'דק׳',
    hours: 'שעות',
    hour: 'שעה',
    days: 'ימים',
    day: 'יום',
    free: 'חינם'
  }
};

// Helper function to format duration in days/hours/minutes
function formatDuration(minutes: number, labels: typeof LABELS['en']): string {
  if (minutes < 60) {
    return `${minutes} ${labels.minutes}`;
  }

  const days = Math.floor(minutes / (24 * 60));
  const remainingMinutes = minutes % (24 * 60);
  const hours = Math.floor(remainingMinutes / 60);
  const mins = remainingMinutes % 60;

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} ${days === 1 ? labels.day : labels.days}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? labels.hour : labels.hours}`);
  }
  if (mins > 0 && days === 0) { // Only show minutes if no days (avoid too much detail)
    parts.push(`${mins} ${labels.minutes}`);
  }

  return parts.join(' ');
}

// Helper function to format amount with currency
function formatAmount(amount: number | null, currency: string, locale: string, freeLabel: string): string {
  if (amount === null || amount === 0) return freeLabel;
  // Map currency symbols to ISO codes
  const currencyMap: Record<string, string> = {
    '₪': 'ILS', '$': 'USD', '€': 'EUR', '£': 'GBP',
    'ILS': 'ILS', 'USD': 'USD', 'EUR': 'EUR', 'GBP': 'GBP'
  };
  const isoCode = currencyMap[currency] || currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: isoCode
    }).format(amount);
  } catch {
    // Fallback if currency code is still invalid
    return `${currency}${amount.toFixed(2)}`;
  }
}

// ============================================================================
// STEP INDICATOR (from existing design pattern)
// ============================================================================

interface StepIndicatorProps {
  steps: CurrentStep[];
  currentStep: CurrentStep;
  completedSteps: CurrentStep[];
  primaryColor: string;
  isRTL: boolean;
}

function StepIndicator({ steps, currentStep, completedSteps, primaryColor, isRTL }: StepIndicatorProps) {
  const stepIcons: Record<CurrentStep, React.ReactNode> = {
    services: <Calendar className="w-4 h-4" />,
    datetime: <Clock className="w-4 h-4" />,
    details: <User className="w-4 h-4" />,
    payment: <CreditCard className="w-4 h-4" />,
    intake: <FileText className="w-4 h-4" />,
    confirmation: <Check className="w-4 h-4" />
  };

  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-2 mb-8" dir={isRTL ? 'rtl' : 'ltr'}>
      {steps.map((step, index) => {
        const isActive = step === currentStep;
        const isCompleted = completedSteps.includes(step);
        const isPast = index < currentIndex;

        return (
          <div key={step} className="flex items-center">
            {index > 0 && (
              <div
                className={`w-8 h-0.5 mx-1 transition-colors ${
                  isPast || isCompleted ? '' : 'bg-gray-200 dark:bg-gray-700'
                }`}
                style={isPast || isCompleted ? { backgroundColor: primaryColor } : {}}
              />
            )}
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-all ${
                isActive
                  ? 'text-white shadow-lg'
                  : isCompleted || isPast
                  ? 'text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
              }`}
              style={
                isActive || isCompleted || isPast
                  ? { backgroundColor: primaryColor, opacity: isActive ? 1 : 0.7 }
                  : {}
              }
            >
              {isCompleted ? <Check className="w-4 h-4" /> : stepIcons[step]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// SERVICES STEP (matches ServicesBlock design)
// ============================================================================

interface ServicesStepProps {
  services: Service[];
  loading: boolean;
  primaryColor: string;
  onSelect: (service: Service) => void;
  isRTL: boolean;
  labels: typeof LABELS.en;
  theme?: BlockRendererProps['theme'];
}

function ServicesStep({ services, loading, primaryColor, onSelect, isRTL, labels, theme }: ServicesStepProps) {
  const formatPrice = (price: number | null, currency: string) => {
    if (price === null) return labels.free;
    const symbols: Record<string, string> = { USD: '$', EUR: '€', ILS: '₪', GBP: '£' };
    return `${symbols[currency] || '$'}${price}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>{labels.noServices}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
      <h3
        className="text-lg font-semibold text-gray-900 dark:text-white mb-4"
        style={{ fontFamily: 'var(--website-font-heading)' }}
      >
        {labels.chooseService}
      </h3>
      {services.map((service) => (
        <button
          key={service.id}
          onClick={() => onSelect(service)}
          className="w-full p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl text-left hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm transition-all group"
          style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h4
                className="font-medium text-gray-900 dark:text-white group-hover:opacity-80"
                style={{ fontFamily: 'var(--website-font-heading)' }}
              >
                {service.name}
              </h4>
              {service.description && (
                <p
                  className="text-sm text-gray-600 dark:text-gray-300 mt-1 line-clamp-2"
                  style={{ fontFamily: 'var(--website-font-body)' }}
                >
                  {service.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-sm text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {service.duration_minutes} {labels.minutes}
                </span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="font-semibold" style={{ color: primaryColor }}>
                {formatPrice(service.price, service.currency)}
              </span>
              <div className="mt-2">
                {isRTL ? (
                  <ChevronLeft className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
                )}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// DATE TIME STEP (matches BookingWidgetBlock design)
// ============================================================================

interface DateTimeStepProps {
  service: Service;
  selectedDate: string;
  selectedSlot: TimeSlot | null;
  slots: TimeSlot[];
  loadingSlots: boolean;
  primaryColor: string;
  onDateSelect: (date: string) => void;
  onSlotSelect: (slot: TimeSlot) => void;
  onBack?: () => void;
  isRTL: boolean;
  labels: typeof LABELS.en;
  theme?: BlockRendererProps['theme'];
  locale?: string;
}

function DateTimeStep({
  service,
  selectedDate,
  selectedSlot,
  slots,
  loadingSlots,
  primaryColor,
  onDateSelect,
  onSlotSelect,
  onBack,
  isRTL,
  labels,
  theme,
  locale = 'en'
}: DateTimeStepProps) {
  // Generate dates for next 14 days
  const dates = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date.toISOString().split('T')[0];
  });

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Back button - only show if onBack is provided */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
        >
          {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          {labels.backToServices}
        </button>
      )}

      {/* Selected service summary */}
      <div
        className="p-4 bg-gray-50 dark:bg-slate-700 rounded-xl"
        style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Calendar className="w-5 h-5" style={{ color: primaryColor }} />
          </div>
          <div>
            <h4 className="font-medium text-gray-900 dark:text-white">{service.name}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">{service.duration_minutes} {labels.minutes}</p>
          </div>
        </div>
      </div>

      {/* Date Selection */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{labels.selectDate}</h4>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {dates.map((date) => {
            // Parse date parts to avoid timezone issues
            // new Date('2026-07-29') creates midnight UTC which shifts in local timezone
            const [year, month, day] = date.split('-').map(Number);
            const dateObj = new Date(year, month - 1, day, 12, 0, 0); // noon local time
            return (
              <button
                key={date}
                onClick={() => onDateSelect(date)}
                className={`flex-shrink-0 px-4 py-3 rounded-lg border text-center transition-all min-w-[70px] ${
                  selectedDate === date
                    ? 'border-transparent text-white'
                    : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
                style={selectedDate === date ? { backgroundColor: primaryColor } : {}}
              >
                <div className="text-xs font-medium">
                  {dateObj.toLocaleDateString(locale, { weekday: 'short' })}
                </div>
                <div className="text-lg font-semibold">{day}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Slots */}
      {selectedDate && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{labels.selectTime}</h4>
          {loadingSlots ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : slots.length === 0 ? (
            <p className="text-center py-8 text-gray-500 dark:text-gray-400">{labels.noSlots}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {slots.map((slot, idx) => (
                <button
                  key={idx}
                  onClick={() => onSlotSelect(slot)}
                  className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    selectedSlot?.start === slot.start
                      ? 'border-transparent text-white'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
                  style={selectedSlot?.start === slot.start ? { backgroundColor: primaryColor } : {}}
                >
                  {slot.display_time || formatTime(slot.start)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DETAILS STEP (Contact Form - matches ContactFormBlock design)
// ============================================================================

interface DetailsStepProps {
  service: Service;
  slot: TimeSlot | null; // Optional - null when flow doesn't include scheduling
  name: string;
  email: string;
  phone: string;
  notes: string;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  primaryColor: string;
  isRTL: boolean;
  labels: typeof LABELS.en;
  theme?: BlockRendererProps['theme'];
  locale?: string;
  nextStepLabel: string;
  /** Whether flow includes scheduling (shows back to datetime vs back to services) */
  hasScheduling?: boolean;
}

function DetailsStep({
  service,
  slot,
  name,
  email,
  phone,
  notes,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onNotesChange,
  onBack,
  onSubmit,
  submitting,
  error,
  primaryColor,
  isRTL,
  labels,
  theme,
  locale = 'en',
  nextStepLabel,
  hasScheduling = true
}: DetailsStepProps) {
  const formatFullDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
      >
        {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
        {hasScheduling ? labels.backToDateTime : labels.backToServices}
      </button>

      {/* Service/Booking summary */}
      <div
        className="p-4 bg-gray-50 dark:bg-slate-700 rounded-xl"
        style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${primaryColor}15` }}
            >
              <Calendar className="w-5 h-5" style={{ color: primaryColor }} />
            </div>
            <div>
              <h4 className="font-medium text-gray-900 dark:text-white">{service.name}</h4>
              {slot ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formatFullDate(slot.start)} at {formatTime(slot.start)}
                </p>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formatDuration(service.duration_minutes, labels)}
                </p>
              )}
            </div>
          </div>
          {/* Show price if service has one */}
          {service.price !== null && service.price > 0 && (
            <div className="text-lg font-bold" style={{ color: primaryColor }}>
              {formatAmount(service.price, service.currency, locale, labels.free)}
            </div>
          )}
        </div>
      </div>

      {/* Contact Form */}
      <form onSubmit={handleSubmit} className="space-y-4 overflow-visible">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {labels.name} *
          </label>
          <div className="relative">
            <User className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none`} />
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              required
              className={`w-full ${isRTL ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 bg-white dark:bg-slate-700 border-2 border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none text-gray-900 dark:text-white placeholder:text-gray-400 transition-colors`}
              style={{ borderRadius: theme?.borderRadius || '0.5rem', borderColor: undefined }}
              onFocus={(e) => e.target.style.borderColor = primaryColor}
              onBlur={(e) => e.target.style.borderColor = ''}
              placeholder="John Smith"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {labels.email} *
          </label>
          <div className="relative">
            <Mail className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none`} />
            <input
              type="email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              required
              className={`w-full ${isRTL ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 bg-white dark:bg-slate-700 border-2 border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none text-gray-900 dark:text-white placeholder:text-gray-400 transition-colors`}
              style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
              onFocus={(e) => e.target.style.borderColor = primaryColor}
              onBlur={(e) => e.target.style.borderColor = ''}
              placeholder="john@example.com"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {labels.phone}
          </label>
          <div className="relative">
            <Phone className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none`} />
            <input
              type="tel"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              className={`w-full ${isRTL ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 bg-white dark:bg-slate-700 border-2 border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none text-gray-900 dark:text-white placeholder:text-gray-400 transition-colors`}
              style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
              onFocus={(e) => e.target.style.borderColor = primaryColor}
              onBlur={(e) => e.target.style.borderColor = ''}
              placeholder="+1 (555) 123-4567"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {labels.notes}
          </label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={3}
            className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border-2 border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none resize-none text-gray-900 dark:text-white placeholder:text-gray-400 transition-colors"
            style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
            onFocus={(e) => e.target.style.borderColor = primaryColor}
            onBlur={(e) => e.target.style.borderColor = ''}
            placeholder={labels.notesPlaceholder}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !name || !email}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: primaryColor, borderRadius: theme?.borderRadius || '0.5rem' }}
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {labels.processing}
            </>
          ) : (
            <>
              {nextStepLabel}
              {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// PAYMENT STEP (matches PaymentButtonBlock design)
// ============================================================================

interface PaymentStepProps {
  service: Service;
  bookingId: string;
  primaryColor: string;
  onBack: () => void;
  onComplete: () => Promise<void> | void;
  submitting?: boolean; // From parent - indicates booking confirmation is in progress
  error?: string | null; // From parent - booking confirmation error
  isRTL: boolean;
  labels: typeof LABELS.en;
  theme?: BlockRendererProps['theme'];
  locale?: string;
  subdomain?: string;
  customerName: string;
  customerEmail: string;
  isPreview?: boolean;
}

// Track payment intents created per booking to prevent duplicates across re-renders
// Using a global object that survives HMR better than Map
if (typeof window !== 'undefined' && !(window as unknown as Record<string, unknown>).__paymentIntentsCache) {
  (window as unknown as Record<string, Record<string, { clientSecret: string; publishableKey: string; connectedAccountId?: string }>>).__paymentIntentsCache = {};
}

function getPaymentIntentCache(): Record<string, { clientSecret: string; publishableKey: string; connectedAccountId?: string }> {
  if (typeof window === 'undefined') return {};
  return (window as unknown as Record<string, Record<string, { clientSecret: string; publishableKey: string; connectedAccountId?: string }>>).__paymentIntentsCache || {};
}

function PaymentStep({ service, bookingId, primaryColor, onBack, onComplete, submitting: parentSubmitting, error: parentError, isRTL, labels, theme, locale = 'en', subdomain, customerName, customerEmail, isPreview }: PaymentStepProps) {
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [paymentReady, setPaymentReady] = useState(false);
  const [paymentData, setPaymentData] = useState<{
    clientSecret: string;
    publishableKey: string;
    connectedAccountId?: string;
  } | null>(() => {
    // Initialize from cache if available
    if (bookingId) {
      const cached = getPaymentIntentCache()[bookingId];
      if (cached) return cached;
    }
    return null;
  });

  // Use parent error if provided, otherwise local error
  const displayError = parentError || localError;
  // Use parent submitting if provided (for booking confirmation), otherwise local processing
  const isProcessing = parentSubmitting || processing;

  // Initialize Stripe PaymentIntent when component mounts
  // Use bookingId as the key dependency - it's stable and unique per booking
  useEffect(() => {
    // Skip if no bookingId
    if (!bookingId) {
      return;
    }

    // Check if we already have payment data (from initial state or previous render)
    if (paymentData) {
      setPaymentReady(true);
      return;
    }

    // Check cache again (in case it was set by another instance)
    const cached = getPaymentIntentCache()[bookingId];
    if (cached) {
      setPaymentData(cached);
      setPaymentReady(true);
      return;
    }

    // Skip payment initialization for free services
    if (!service.price || service.price <= 0) {
      setPaymentReady(true);
      return;
    }

    let cancelled = false;

    const initializePayment = async () => {
      // Double-check cache before API call (race condition protection)
      const cachedBeforeCall = getPaymentIntentCache()[bookingId];
      if (cachedBeforeCall) {
        setPaymentData(cachedBeforeCall);
        setPaymentReady(true);
        return;
      }

      try {
        setProcessing(true);
        // In preview mode, don't pass subdomain - use authenticated user instead
        const response = await fetch('/api/website/payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subdomain: isPreview ? '' : (subdomain || ''),
            booking_id: bookingId,
            service_id: service.id,
            amount: service.price,
            currency: service.currency,
            customer_email: customerEmail,
            description: service.name,
            metadata: {
              customer_name: customerName
            }
          })
        });

        if (cancelled) return;

        const data = await response.json();

        if (data.success && data.clientSecret && data.publishableKey) {
          const paymentInfo = {
            clientSecret: data.clientSecret,
            publishableKey: data.publishableKey,
            connectedAccountId: data.connectedAccountId
          };

          // Store in window cache to survive HMR and re-renders
          getPaymentIntentCache()[bookingId] = paymentInfo;

          setPaymentData(paymentInfo);
          setPaymentReady(true);
        } else if (data.error?.includes('Payment processing is not set up') || data.error?.includes('Payment processing is not configured')) {
          // Stripe not configured - allow skip for testing
          setPaymentReady(true);
        } else {
          setLocalError(data.error || 'Failed to initialize payment');
        }
      } catch {
        if (!cancelled) {
          setLocalError('Failed to initialize payment. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setProcessing(false);
        }
      }
    };

    initializePayment();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]); // Only depend on bookingId - it's the unique identifier for this payment

  const handlePaymentSuccess = async (paymentIntentId: string) => {
    // Payment succeeded - finalize the booking
    setProcessing(true);
    try {
      // Update booking payment status via finalize endpoint
      const response = await fetch('/api/website/booking/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain: isPreview ? '' : (subdomain || ''),
          booking_id: bookingId,
          payment_intent_id: paymentIntentId,
          payment_status: 'paid'
        })
      });

      const result = await response.json();
      if (!result.success) {
        // Payment succeeded but finalization failed - still show success
        // The booking can be reconciled later
        console.error('Booking finalization failed:', result.error);
      }

      await onComplete();
    } catch (err) {
      console.error('Failed to finalize booking:', err);
      // Still proceed to confirmation since payment was successful
      await onComplete();
    } finally {
      setProcessing(false);
    }
  };

  const handlePaymentError = (error: string) => {
    setLocalError(error);
  };

  const handleSkipPayment = async () => {
    // For free services or when Stripe is not configured
    setProcessing(true);
    try {
      await onComplete();
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
      >
        {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
        {labels.back}
      </button>

      <div className="text-center py-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <CreditCard className="w-8 h-8" style={{ color: primaryColor }} />
        </div>
        <h3
          className="text-xl font-semibold text-gray-900 dark:text-white mb-2"
          style={{ fontFamily: 'var(--website-font-heading)' }}
        >
          {labels.completePayment}
        </h3>
        <p className="text-gray-600 dark:text-gray-300">{labels.securePayment}</p>
      </div>

      {/* Payment summary */}
      <div
        className="p-4 bg-gray-50 dark:bg-slate-700 rounded-xl"
        style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-gray-900 dark:text-white">{service.name}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">{formatDuration(service.duration_minutes, labels)}</p>
          </div>
          <div className="text-xl font-bold" style={{ color: primaryColor }}>
            {formatAmount(service.price, service.currency, locale, labels.free)}
          </div>
        </div>
      </div>

      {displayError && <p className="text-sm text-red-600 text-center">{displayError}</p>}

      {/* Payment form - show embedded Stripe Elements or fallback button */}
      {!paymentReady ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : paymentData ? (
        // Embedded Stripe payment form
        <StripePaymentForm
          publishableKey={paymentData.publishableKey}
          clientSecret={paymentData.clientSecret}
          connectedAccountId={paymentData.connectedAccountId}
          amount={service.price || 0}
          currency={service.currency}
          onSuccess={handlePaymentSuccess}
          onError={handlePaymentError}
          primaryColor={primaryColor}
          locale={(locale || 'en') as 'en' | 'es' | 'he'}
          isRTL={isRTL}
          borderRadius={theme?.borderRadius || '0.5rem'}
        />
      ) : (
        // Fallback: Free service or Stripe not configured
        <>
          <button
            onClick={handleSkipPayment}
            disabled={isProcessing}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: primaryColor, borderRadius: theme?.borderRadius || '0.5rem' }}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {parentSubmitting ? labels.confirmingBooking || 'Confirming booking...' : labels.processing}
              </>
            ) : (
              <>
                <Check className="w-5 h-5" />
                {service.price && service.price > 0 ? labels.continueToPayment : labels.confirmBooking}
              </>
            )}
          </button>

          {/* Security badges */}
          <div className="flex items-center justify-center gap-4 text-sm text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <Lock className="w-4 h-4" />
              <span>{labels.securePaymentLabel}</span>
            </div>
            <div className="flex items-center gap-1">
              <Shield className="w-4 h-4" />
              <span>{labels.poweredByStripe}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// INTAKE STEP (matches IntakeFormBlock design)
// ============================================================================

interface IntakeStepProps {
  fields: FormField[];
  answers: Record<string, string>;
  onAnswerChange: (fieldName: string, value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  primaryColor: string;
  isRTL: boolean;
  labels: typeof LABELS.en;
  theme?: BlockRendererProps['theme'];
}

function IntakeStep({
  fields,
  answers,
  onAnswerChange,
  onBack,
  onSubmit,
  submitting,
  error,
  primaryColor,
  isRTL,
  labels,
  theme
}: IntakeStepProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  if (fields.length === 0) {
    // No intake fields configured - auto-proceed
    useEffect(() => {
      onSubmit();
    }, []);
    return null;
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
      >
        {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
        {labels.back}
      </button>

      <div className="text-center py-2">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <ClipboardList className="w-8 h-8" style={{ color: primaryColor }} />
        </div>
        <h3
          className="text-xl font-semibold text-gray-900 dark:text-white mb-2"
          style={{ fontFamily: 'var(--website-font-heading)' }}
        >
          {labels.aFewQuestions}
        </h3>
        <p className="text-gray-600 dark:text-gray-300">{labels.helpUsPrepare}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {fields.map((field) => (
          <div key={field.name}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {field.label} {field.required && '*'}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                value={answers[field.name] || ''}
                onChange={(e) => onAnswerChange(field.name, e.target.value)}
                required={field.required}
                rows={3}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent resize-none text-gray-900 dark:text-white placeholder:text-gray-400"
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                placeholder={field.placeholder}
              />
            ) : field.type === 'select' && field.options ? (
              <select
                value={answers[field.name] || ''}
                onChange={(e) => onAnswerChange(field.name, e.target.value)}
                required={field.required}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent text-gray-900 dark:text-white"
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
              >
                <option value="">Select an option</option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type || 'text'}
                value={answers[field.name] || ''}
                onChange={(e) => onAnswerChange(field.name, e.target.value)}
                required={field.required}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent text-gray-900 dark:text-white placeholder:text-gray-400"
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                placeholder={field.placeholder}
              />
            )}
          </div>
        ))}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: primaryColor, borderRadius: theme?.borderRadius || '0.5rem' }}
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {labels.submitting}
            </>
          ) : (
            <>
              {labels.completeBooking}
              {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// CONFIRMATION STEP
// ============================================================================

interface ConfirmationStepProps {
  service: Service;
  slot: TimeSlot | null; // Optional - null when flow doesn't include scheduling
  clientEmail: string;
  primaryColor: string;
  onReset: () => void;
  isRTL: boolean;
  labels: typeof LABELS.en;
  theme?: BlockRendererProps['theme'];
  locale?: string;
}

function ConfirmationStep({ service, slot, clientEmail, primaryColor, onReset, isRTL, labels, theme, locale = 'en' }: ConfirmationStepProps) {
  const formatFullDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div className="text-center py-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', duration: 0.5 }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <Check className="w-8 h-8" style={{ color: primaryColor }} />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h3
          className="text-2xl font-bold text-gray-900 dark:text-white mb-2"
          style={{ fontFamily: 'var(--website-font-heading)' }}
        >
          {labels.bookingConfirmed}
        </h3>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          {labels.confirmationEmailSent} <strong>{clientEmail}</strong>
        </p>

        <div
          className="bg-gray-50 dark:bg-slate-700 rounded-xl p-6 text-left max-w-sm mx-auto mb-8"
          style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
        >
          <h4 className="font-semibold text-gray-900 dark:text-white mb-4">{labels.bookingDetails}</h4>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{labels.service}</span>
              <span className="font-medium text-gray-900 dark:text-white">{service.name}</span>
            </div>
            {/* Only show date/time if slot exists (scheduled booking) */}
            {slot && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{labels.date}</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatFullDate(slot.start)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{labels.time}</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatTime(slot.start)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{labels.duration}</span>
              <span className="font-medium text-gray-900 dark:text-white">{formatDuration(service.duration_minutes, labels)}</span>
            </div>
          </div>
        </div>

        <button
          onClick={onReset}
          className="px-6 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-all"
          style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
        >
          {labels.bookAnotherService}
        </button>
      </motion.div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

type CurrentStepType = 'services' | 'datetime' | 'details' | 'payment' | 'intake' | 'confirmation';

interface ProcessFlowSectionProps extends BlockRendererProps {
  /** Callback when step changes - used by BookingModal to sync sticky header */
  onStepChange?: (step: CurrentStepType, completedSteps: CurrentStepType[]) => void;
}

export function ProcessFlowSection({ content, styles, theme, isRTL, className, locale = 'en', subdomain, isPreview, onStepChange }: ProcessFlowSectionProps) {
  const typedContent = content as unknown as ProcessFlowContent;
  const {
    title,
    subtitle,
    // Default to new split steps - scheduling + client_info for bookable services
    flow = ['scheduling', 'client_info', 'confirmation'],
    intake_fields = [],
    initialService
  } = typedContent;

  const primaryColor = theme?.colors?.primary || '#4F6EF7';
  const labels = LABELS[locale as keyof typeof LABELS] || LABELS.en;

  // Flow configuration determines which steps to show
  // Use helper functions to handle both legacy 'booking' and new 'scheduling'/'client_info' steps
  const hasScheduling = flowHasScheduling(flow);
  const hasClientInfo = flowHasClientInfo(flow);
  const hasPayment = flow.includes('payment');

  // Determine initial step - skip to datetime if service is pre-selected
  const hasInitialService = !!initialService;

  // State - start from appropriate step based on initial service and flow configuration
  // If we have an initial service:
  //   - If flow has scheduling, start from datetime
  //   - If no scheduling but has client_info, start from details
  const getInitialStep = (): CurrentStep => {
    if (!hasInitialService) return 'services';
    if (hasScheduling) return 'datetime';
    if (hasClientInfo) return 'details';
    return 'services';
  };
  const [currentStep, setCurrentStep] = useState<CurrentStep>(getInitialStep());
  const [completedSteps, setCompletedSteps] = useState<CurrentStep[]>(hasInitialService ? ['services'] : []);
  const [slideDirection, setSlideDirection] = useState<'forward' | 'backward'>('forward');

  // Services
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(!hasInitialService);

  // Selected data - pre-populate with initial service if provided
  const [selectedService, setSelectedService] = useState<Service | null>(
    initialService ? {
      id: initialService.id,
      name: initialService.name,
      description: initialService.description,
      duration_minutes: initialService.duration_minutes,
      price: initialService.price,
      currency: initialService.currency
    } : null
  );
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

  // Slots
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Contact details
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientNotes, setClientNotes] = useState('');

  // Intake - capability-based template
  const [intakeTemplate, setIntakeTemplate] = useState<IntakeTemplate | null>(null);
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, any>>({});

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if intake is part of the flow configuration (must be defined before hasIntake)
  const flowIncludesIntake = flow.includes('intake');

  // Intake is shown ONLY if 'intake' is in the flow AND (template fetched OR legacy intake_fields exist)
  // The flow configuration from the landing page/website is the source of truth
  const hasIntake = flowIncludesIntake && (!!intakeTemplate || intake_fields.length > 0);

  // Build step sequence dynamically based on capabilities
  // - 'services' is always first (unless pre-selected)
  // - 'datetime' is included only if scheduling is needed
  // - 'details' (client info) is included if client_info is in flow OR scheduling is in flow
  const stepSequence: CurrentStep[] = ['services'];
  if (hasScheduling) stepSequence.push('datetime');
  if (hasClientInfo) stepSequence.push('details');
  if (hasPayment) stepSequence.push('payment');
  if (hasIntake) stepSequence.push('intake');
  stepSequence.push('confirmation');

  // When initialService changes, reset state to start from appropriate step with pre-selected service
  useEffect(() => {
    if (initialService) {
      // Determine starting step based on flow configuration
      const startStep = hasScheduling ? 'datetime' : (hasClientInfo ? 'details' : 'services');
      setCurrentStep(startStep);
      setCompletedSteps(['services']);
      setSelectedService({
        id: initialService.id,
        name: initialService.name,
        description: initialService.description,
        duration_minutes: initialService.duration_minutes,
        price: initialService.price,
        currency: initialService.currency
      });
      setSelectedDate('');
      setSelectedSlot(null);
      setSlots([]);
      setLoadingServices(false);
    }
  }, [initialService, hasScheduling, hasClientInfo]);

  // Sync step changes with parent (for BookingModal sticky header)
  useEffect(() => {
    if (onStepChange) {
      onStepChange(currentStep, completedSteps);
    }
  }, [currentStep, completedSteps, onStepChange]);

  // Fetch services on mount (skip if we have an initial service)
  useEffect(() => {
    if (!hasInitialService) {
      fetchServices();
    }
  }, [hasInitialService]);

  // Fetch intake template from capability API - ONLY if intake is in the flow
  useEffect(() => {
    // Skip fetch if intake is not part of the client journey
    if (!flowIncludesIntake) {
      setIntakeTemplate(null);
      return;
    }

    const fetchIntakeTemplate = async () => {
      try {
        // In preview mode (no subdomain), use authenticated endpoint
        // In public website (with subdomain), use public endpoint
        const url = subdomain
          ? `/api/website/booking/intake?subdomain=${subdomain}`
          : `/api/intake/settings`;

        const response = await fetch(url);
        const data = await response.json();

        if (subdomain) {
          // Public endpoint response
          if (data.success && data.hasIntake && data.template) {
            setIntakeTemplate(data.template);
          }
        } else {
          // Authenticated endpoint response - check if enabled and has template
          if (data.success && data.settings?.is_enabled && data.settings?.template) {
            const t = data.settings.template;
            setIntakeTemplate({
              id: t.id,
              template_key: t.template_key,
              name_en: t.name_en,
              name_es: t.name_es,
              name_he: t.name_he,
              fields: t.fields
            });
          }
        }
      } catch {
        // Silent fail - intake is optional
      }
    };
    fetchIntakeTemplate();
  }, [subdomain, flowIncludesIntake]);

  const fetchServices = async () => {
    setLoadingServices(true);
    try {
      const response = await fetch(`/api/website/blocks/services?active_only=true${subdomain ? `&subdomain=${subdomain}` : ''}`);
      const data = await response.json();
      if (data.success && data.services) {
        setServices(data.services.map((s: { id: string; service_name: string; description: string | null; duration_minutes: number; price: number | null; currency: string }) => ({
          id: s.id,
          name: s.service_name,
          description: s.description,
          duration_minutes: s.duration_minutes,
          price: s.price,
          currency: s.currency || 'USD'
        })));
      }
    } catch {
      // Silent fail - show empty state
    } finally {
      setLoadingServices(false);
    }
  };

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedService || !selectedDate) return;

    const fetchSlots = async () => {
      setLoadingSlots(true);
      setError(null);

      try {
        const url = `/api/website/scheduling/availability?service_id=${selectedService.id}&date=${selectedDate}${subdomain ? `&subdomain=${subdomain}` : ''}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
          // Map API response fields to component's TimeSlot interface
          // API returns: { start_time, end_time, display_time }
          // Component expects: { start, end, available }
          const mappedSlots = (data.slots || []).map((slot: { start_time: string; end_time: string; display_time?: string }) => ({
            start: slot.start_time,
            end: slot.end_time,
            available: true,
            display_time: slot.display_time
          }));
          setSlots(mappedSlots);
          // Show message if no slots (e.g., "No availability configured")
          if (mappedSlots.length === 0 && data.message) {
            setError(data.message);
          }
        } else {
          setError(data.error || 'Failed to load available times');
        }
      } catch {
        setError('Failed to load available times');
      } finally {
        setLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [selectedService, selectedDate, subdomain]);

  // Navigation helpers
  const goToStep = useCallback((step: CurrentStep, direction: 'forward' | 'backward' = 'forward') => {
    setSlideDirection(direction);
    setCurrentStep(step);
    setError(null);
  }, []);

  const markStepComplete = useCallback((step: CurrentStep) => {
    setCompletedSteps((prev) => [...new Set([...prev, step])]);
  }, []);

  // Handlers
  const handleSelectService = (service: Service) => {
    setSelectedService(service);
    markStepComplete('services');
    // Go to datetime if scheduling is needed, otherwise go to details (client info)
    if (hasScheduling) {
      goToStep('datetime', 'forward');
    } else if (hasClientInfo) {
      goToStep('details', 'forward');
    } else {
      // No booking or client info - unlikely but handle gracefully
      goToStep('confirmation', 'forward');
    }
  };

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setSelectedSlot(null);
  };

  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    markStepComplete('datetime');
    goToStep('details', 'forward');
  };

  const handleSubmitDetails = async () => {
    // For scheduled flows, require slot; for non-scheduled flows, slot is optional
    if (!selectedService || !clientName || !clientEmail) {
      setError('Please fill in all required fields');
      return;
    }
    if (hasScheduling && !selectedSlot) {
      setError('Please select a date and time');
      return;
    }

    const requiresPayment = hasPayment && selectedService.price && selectedService.price > 0;

    console.log('[ProcessFlowSection] handleSubmitDetails:', {
      hasPayment,
      hasScheduling,
      price: selectedService.price,
      requiresPayment,
      skip_contact: !!requiresPayment
    });

    // Create booking now (for both paid and free services)
    // For paid services, booking is created with 'pending' status and updated after payment
    setSubmitting(true);
    setError(null);

    try {
      // Convert wall-clock time to ISO datetime (only if slot exists)
      const startTimeISO = selectedSlot
        ? (selectedSlot.start.includes('Z')
          ? selectedSlot.start
          : new Date(selectedSlot.start).toISOString())
        : undefined;

      // In preview mode, don't pass subdomain - use authenticated user instead
      // This avoids 404 errors if subdomain in sessionStorage is stale/deleted
      const response = await fetch('/api/website/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain: isPreview ? '' : (subdomain || ''),
          service_id: selectedService.id,
          start_time: startTimeISO, // Optional - undefined for non-scheduled bookings
          name: clientName,
          email: clientEmail,
          phone: clientPhone || undefined,
          notes: clientNotes || undefined,
          // Skip contact creation for paid services - contact will be created after payment
          skip_contact: requiresPayment
        })
      });

      const data = await response.json();

      if (data.success) {
        setBookingId(data.booking?.id || data.id);
        markStepComplete('details');

        // Determine next step
        if (requiresPayment) {
          goToStep('payment', 'forward');
        } else if (hasIntake) {
          goToStep('intake', 'forward');
        } else {
          goToStep('confirmation', 'forward');
        }
      } else {
        setError(data.error || 'Failed to create booking');
      }
    } catch {
      setError('Failed to create booking. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentComplete = async () => {
    // Payment succeeded - finalize the booking (create contact, update status)
    setSubmitting(true);
    setError(null);

    try {
      // In preview mode, don't pass subdomain - use authenticated user instead
      const response = await fetch('/api/website/booking/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain: isPreview ? '' : (subdomain || ''),
          booking_id: bookingId
        })
      });

      const data = await response.json();

      if (!data.success) {
        // Log warning but continue - payment was successful
        console.warn('Failed to finalize booking:', data.error);
      }
    } catch (err) {
      // Log warning but continue - payment was successful
      console.warn('Error finalizing booking:', err);
    } finally {
      setSubmitting(false);
    }

    markStepComplete('payment');

    if (hasIntake) {
      goToStep('intake', 'forward');
    } else {
      goToStep('confirmation', 'forward');
    }
  };

  // Handle intake form submission using capability-based API
  const handleIntakeFormSubmit = async (responses: Record<string, any>) => {
    if (!intakeTemplate || !bookingId) {
      setError('Missing intake template or booking');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // In preview mode, simulate submission without actually saving
      if (isPreview) {
        await new Promise(resolve => setTimeout(resolve, 500));
        markStepComplete('intake');
        goToStep('confirmation', 'forward');
        return;
      }

      // In preview mode, don't pass subdomain - use authenticated user instead
      const response = await fetch('/api/website/booking/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain: isPreview ? '' : (subdomain || ''),
          bookingId,
          templateId: intakeTemplate.id,
          templateKey: intakeTemplate.template_key,
          responses
        })
      });

      const data = await response.json();

      if (data.success) {
        markStepComplete('intake');
        goToStep('confirmation', 'forward');
      } else {
        setError(data.error || 'Failed to submit intake form');
      }
    } catch {
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Legacy intake submit (for backwards compatibility with intake_fields)
  const handleIntakeSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      // In preview mode, simulate submission without actually saving
      if (isPreview) {
        await new Promise(resolve => setTimeout(resolve, 500));
        markStepComplete('intake');
        goToStep('confirmation', 'forward');
        return;
      }

      // In preview mode, don't pass subdomain - use authenticated user instead
      const response = await fetch('/api/website/forms/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain: isPreview ? '' : (subdomain || ''),
          booking_id: bookingId,
          name: clientName,
          email: clientEmail,
          answers: intakeAnswers
        })
      });

      const data = await response.json();

      if (data.success) {
        markStepComplete('intake');
        goToStep('confirmation', 'forward');
      } else {
        setError(data.error || 'Failed to submit intake form');
      }
    } catch {
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setCurrentStep('services');
    setCompletedSteps([]);
    setSelectedService(null);
    setSelectedDate('');
    setSelectedSlot(null);
    setBookingId(null);
    setSlots([]);
    setClientName('');
    setClientEmail('');
    setClientPhone('');
    setClientNotes('');
    setIntakeAnswers({});
    setError(null);
  };

  // Determine next step label for details form
  const getNextStepLabel = () => {
    if (hasPayment && selectedService?.price) return labels.continueToPayment;
    if (hasIntake) return labels.continueToQuestions;
    return labels.confirmBooking;
  };

  // Animation variants - RTL aware
  const slideVariants = {
    enter: (direction: 'forward' | 'backward') => ({
      x: direction === 'forward' ? (isRTL ? -300 : 300) : (isRTL ? 300 : -300),
      opacity: 0
    }),
    center: {
      x: 0,
      opacity: 1
    },
    exit: (direction: 'forward' | 'backward') => ({
      x: direction === 'forward' ? (isRTL ? 300 : -300) : (isRTL ? -300 : 300),
      opacity: 0
    })
  };

  // When inside modal (onStepChange provided), use wider layout
  const isInModal = !!onStepChange;

  return (
    <section
      id="booking"
      className={`${isInModal ? '' : styles?.padding || 'py-16 sm:py-24'} ${isInModal ? '' : styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
    >
      <div className={`${isInModal ? 'max-w-2xl' : 'max-w-xl'} mx-auto ${isInModal ? '' : 'px-4 sm:px-6'}`}>
        {/* Header - only show on services step */}
        {(title || subtitle) && currentStep === 'services' && (
          <div className="text-center mb-8" dir={isRTL ? 'rtl' : 'ltr'}>
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white"
                style={{ fontFamily: 'var(--website-font-heading)' }}
              >
                {title}
              </motion.h2>
            )}
            {subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="mt-2 text-gray-600 dark:text-gray-300"
                style={{ fontFamily: 'var(--website-font-body)' }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        {/* Step Indicator - hide on services and confirmation, hide when parent handles it (onStepChange) */}
        {!onStepChange && currentStep !== 'services' && currentStep !== 'confirmation' && (
          <div
            className="sticky top-0 z-10 py-3 -mt-2 mb-2"
            style={{
              backgroundColor: styles?.background?.includes('slate')
                ? 'rgb(15 23 42)' // slate-900
                : theme?.colors?.background || '#f9fafb' // gray-50
            }}
          >
            <StepIndicator
              steps={stepSequence}
              currentStep={currentStep}
              completedSteps={completedSteps}
              primaryColor={primaryColor}
              isRTL={isRTL || false}
            />
          </div>
        )}

        {/* Content Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 sm:p-8"
          style={{ borderRadius: theme?.borderRadius || '1rem' }}
        >
          {/* Slider content */}
          <div className="relative overflow-hidden">
            <AnimatePresence mode="wait" custom={slideDirection}>
              <motion.div
                key={currentStep}
                custom={slideDirection}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'tween', duration: 0.3 }}
              >
                {currentStep === 'services' && (
                  <ServicesStep
                    services={services}
                    loading={loadingServices}
                    primaryColor={primaryColor}
                    onSelect={handleSelectService}
                    isRTL={isRTL || false}
                    labels={labels}
                    theme={theme}
                  />
                )}

                {currentStep === 'datetime' && selectedService && (
                  <DateTimeStep
                    service={selectedService}
                    selectedDate={selectedDate}
                    selectedSlot={selectedSlot}
                    slots={slots}
                    loadingSlots={loadingSlots}
                    primaryColor={primaryColor}
                    onDateSelect={handleSelectDate}
                    onSlotSelect={handleSelectSlot}
                    onBack={hasInitialService ? undefined : () => goToStep('services', 'backward')}
                    isRTL={isRTL || false}
                    labels={labels}
                    theme={theme}
                    locale={locale}
                  />
                )}

                {currentStep === 'details' && selectedService && (
                  <DetailsStep
                    service={selectedService}
                    slot={selectedSlot}
                    name={clientName}
                    email={clientEmail}
                    phone={clientPhone}
                    notes={clientNotes}
                    onNameChange={setClientName}
                    onEmailChange={setClientEmail}
                    onPhoneChange={setClientPhone}
                    onNotesChange={setClientNotes}
                    onBack={() => goToStep(hasScheduling ? 'datetime' : 'services', 'backward')}
                    onSubmit={handleSubmitDetails}
                    submitting={submitting}
                    error={error}
                    primaryColor={primaryColor}
                    isRTL={isRTL || false}
                    labels={labels}
                    theme={theme}
                    locale={locale}
                    nextStepLabel={getNextStepLabel()}
                    hasScheduling={hasScheduling}
                  />
                )}

                {currentStep === 'payment' && selectedService && (
                  <PaymentStep
                    service={selectedService}
                    bookingId={bookingId || ''} // May be empty for paid services (created after payment)
                    primaryColor={primaryColor}
                    onBack={() => goToStep('details', 'backward')}
                    onComplete={handlePaymentComplete}
                    submitting={submitting}
                    error={error}
                    isRTL={isRTL || false}
                    labels={labels}
                    theme={theme}
                    locale={locale}
                    subdomain={subdomain}
                    customerName={clientName}
                    customerEmail={clientEmail}
                    isPreview={isPreview}
                  />
                )}

                {currentStep === 'intake' && intakeTemplate && (
                  <IntakeFormStep
                    template={intakeTemplate}
                    locale={locale as 'en' | 'es' | 'he'}
                    isRTL={isRTL || false}
                    primaryColor={primaryColor}
                    onSubmit={handleIntakeFormSubmit}
                    onBack={() => goToStep(hasPayment ? 'payment' : 'details', 'backward')}
                    submitting={submitting}
                    error={error}
                    theme={theme}
                    labels={{
                      aFewQuestions: labels.aFewQuestions,
                      helpUsPrepare: labels.helpUsPrepare,
                      completeBooking: labels.completeBooking,
                      back: labels.back,
                      submitting: labels.submitting,
                      required: 'Required'
                    }}
                  />
                )}

                {/* Legacy intake step - for backwards compatibility with intake_fields */}
                {currentStep === 'intake' && !intakeTemplate && intake_fields.length > 0 && (
                  <IntakeStep
                    fields={intake_fields}
                    answers={intakeAnswers}
                    onAnswerChange={(name, value) => setIntakeAnswers((prev) => ({ ...prev, [name]: value }))}
                    onBack={() => goToStep(hasPayment ? 'payment' : 'details', 'backward')}
                    onSubmit={handleIntakeSubmit}
                    submitting={submitting}
                    error={error}
                    primaryColor={primaryColor}
                    isRTL={isRTL || false}
                    labels={labels}
                    theme={theme}
                  />
                )}

                {currentStep === 'confirmation' && selectedService && (
                  <ConfirmationStep
                    service={selectedService}
                    slot={selectedSlot}
                    clientEmail={clientEmail}
                    primaryColor={primaryColor}
                    onReset={handleReset}
                    isRTL={isRTL || false}
                    labels={labels}
                    theme={theme}
                    locale={locale}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
