'use client';

/**
 * Public Booking Widget Component
 * Interactive booking interface for selecting services, dates, and times
 * Includes intake form support when enabled for the business
 * Supports payment flow for paid services (contact created AFTER payment)
 */

import { useState, useEffect } from 'react';
import { Calendar, Clock, User, Mail, Phone, ArrowLeft, ArrowRight, Check, Loader2, ClipboardList, CreditCard, ChevronDown } from 'lucide-react';

interface Service {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
}

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

interface IntakeField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'tel' | 'email';
  label_en: string;
  label_es?: string;
  label_he?: string;
  required?: boolean;
  options?: Array<{ value: string; label_en: string; label_es?: string; label_he?: string }>;
  placeholder_en?: string;
  placeholder_es?: string;
  placeholder_he?: string;
}

interface IntakeTemplate {
  id: string;
  template_key: string;
  name_en: string;
  name_es?: string;
  name_he?: string;
  fields: IntakeField[];
}

interface BookingWidgetProps {
  subdomain: string;
  services: Service[];
  timezone: string;
  primaryColor: string;
  locale?: 'en' | 'es' | 'he';
  /** Pre-select a service by ID (e.g., from landing page link) */
  initialServiceId?: string;
}

type Step = 'service' | 'datetime' | 'details' | 'payment' | 'intake' | 'confirmation';

// Simple translations for public booking widget
const translations = {
  en: {
    choose_service: 'Choose a Service',
    select_date: 'Select a Date',
    select_time: 'Select a Time',
    your_name: 'Your Name',
    email: 'Email Address',
    phone: 'Phone Number',
    notes: 'Notes (optional)',
    notes_placeholder: 'Any special requests or notes...',
    back_to_services: 'Back to services',
    back_to_datetime: 'Back to date & time',
    back_to_details: 'Back to details',
    confirm_booking: 'Confirm Booking',
    booking: 'Booking...',
    no_times_available: 'No available times for this date',
    complete_payment: 'Complete Payment',
    pay_to_confirm: 'Pay {amount} to confirm your booking',
    service: 'Service',
    duration: 'Duration',
    total: 'Total',
    pay: 'Pay',
    processing: 'Processing...',
    booking_confirmed: 'Booking Confirmed!',
    confirmation_email: "We've sent a confirmation email to",
    booking_details: 'Booking Details',
    date: 'Date',
    time: 'Time',
    book_another: 'Book Another Service',
    intake_complete_form: 'Please complete this form before your appointment',
    skip_for_now: 'Skip for now',
    submit: 'Submit',
    submitting: 'Submitting...',
    select_option: 'Select...',
    min: 'min',
    free: 'Free'
  },
  es: {
    choose_service: 'Elige un Servicio',
    select_date: 'Selecciona una Fecha',
    select_time: 'Selecciona una Hora',
    your_name: 'Tu Nombre',
    email: 'Correo Electrónico',
    phone: 'Teléfono',
    notes: 'Notas (opcional)',
    notes_placeholder: 'Solicitudes especiales o notas...',
    back_to_services: 'Volver a servicios',
    back_to_datetime: 'Volver a fecha y hora',
    back_to_details: 'Volver a detalles',
    confirm_booking: 'Confirmar Reserva',
    booking: 'Reservando...',
    no_times_available: 'No hay horarios disponibles para esta fecha',
    complete_payment: 'Completar Pago',
    pay_to_confirm: 'Paga {amount} para confirmar tu reserva',
    service: 'Servicio',
    duration: 'Duración',
    total: 'Total',
    pay: 'Pagar',
    processing: 'Procesando...',
    booking_confirmed: '¡Reserva Confirmada!',
    confirmation_email: 'Hemos enviado un correo de confirmación a',
    booking_details: 'Detalles de la Reserva',
    date: 'Fecha',
    time: 'Hora',
    book_another: 'Reservar Otro Servicio',
    intake_complete_form: 'Por favor completa este formulario antes de tu cita',
    skip_for_now: 'Omitir por ahora',
    submit: 'Enviar',
    submitting: 'Enviando...',
    select_option: 'Seleccionar...',
    min: 'min',
    free: 'Gratis'
  },
  he: {
    choose_service: 'בחר שירות',
    select_date: 'בחר תאריך',
    select_time: 'בחר שעה',
    your_name: 'השם שלך',
    email: 'כתובת אימייל',
    phone: 'טלפון',
    notes: 'הערות (אופציונלי)',
    notes_placeholder: 'בקשות מיוחדות או הערות...',
    back_to_services: 'חזרה לשירותים',
    back_to_datetime: 'חזרה לתאריך ושעה',
    back_to_details: 'חזרה לפרטים',
    confirm_booking: 'אשר הזמנה',
    booking: 'מזמין...',
    no_times_available: 'אין שעות פנויות לתאריך זה',
    complete_payment: 'השלם תשלום',
    pay_to_confirm: 'שלם {amount} לאישור ההזמנה',
    service: 'שירות',
    duration: 'משך',
    total: 'סה"כ',
    pay: 'שלם',
    processing: 'מעבד...',
    booking_confirmed: 'ההזמנה אושרה!',
    confirmation_email: 'שלחנו אימייל אישור אל',
    booking_details: 'פרטי ההזמנה',
    date: 'תאריך',
    time: 'שעה',
    book_another: 'הזמן שירות נוסף',
    intake_complete_form: 'אנא מלא טופס זה לפני הפגישה',
    skip_for_now: 'דלג לעת עתה',
    submit: 'שלח',
    submitting: 'שולח...',
    select_option: 'בחר...',
    min: 'דק\'',
    free: 'חינם'
  }
};

export function BookingWidget({ subdomain, services, timezone, primaryColor, locale = 'en', initialServiceId }: BookingWidgetProps) {
  // Get translations for current locale
  const t = translations[locale] || translations.en;
  const isRTL = locale === 'he';

  // Helper to get localized label from intake field/option
  const getLocalizedLabel = (item: { label_en: string; label_es?: string; label_he?: string }) => {
    if (locale === 'es' && item.label_es) return item.label_es;
    if (locale === 'he' && item.label_he) return item.label_he;
    return item.label_en;
  };

  const getLocalizedPlaceholder = (item: { placeholder_en?: string; placeholder_es?: string; placeholder_he?: string }) => {
    if (locale === 'es' && item.placeholder_es) return item.placeholder_es;
    if (locale === 'he' && item.placeholder_he) return item.placeholder_he;
    return item.placeholder_en || '';
  };

  const getLocalizedTemplateName = (template: IntakeTemplate) => {
    if (locale === 'es' && template.name_es) return template.name_es;
    if (locale === 'he' && template.name_he) return template.name_he;
    return template.name_en;
  };
  const [step, setStep] = useState<Step>('service');
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  // Intake form state
  const [intakeTemplate, setIntakeTemplate] = useState<IntakeTemplate | null>(null);
  const [hasIntake, setHasIntake] = useState(false);
  const [intakeResponses, setIntakeResponses] = useState<Record<string, unknown>>({});
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [submittingIntake, setSubmittingIntake] = useState(false);

  // Payment state
  const [processingPayment, setProcessingPayment] = useState(false);

  // Custom select dropdown state
  const [openSelectKey, setOpenSelectKey] = useState<string | null>(null);

  // Generate dates for next 14 days
  const dates = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date.toISOString().split('T')[0];
  });

  // Auto-select service if initialServiceId is provided (e.g., from landing page)
  useEffect(() => {
    if (initialServiceId && services.length > 0) {
      const service = services.find(s => s.id === initialServiceId);
      if (service) {
        setSelectedService(service);
        setStep('datetime');
      }
    }
  }, [initialServiceId, services]);

  // Fetch intake template on mount
  useEffect(() => {
    const fetchIntakeTemplate = async () => {
      try {
        const response = await fetch(`/api/website/booking/intake?subdomain=${subdomain}`);
        const data = await response.json();
        if (data.success && data.hasIntake && data.template) {
          setHasIntake(true);
          setIntakeTemplate(data.template);
        }
      } catch {
        // Intake is optional, silently fail
      }
    };
    fetchIntakeTemplate();
  }, [subdomain]);

  // Handle return from Stripe checkout
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    const bookingIdFromUrl = urlParams.get('booking_id');

    if (paymentStatus === 'success' && bookingIdFromUrl) {
      // Payment succeeded, finalize the booking
      setBookingId(bookingIdFromUrl);
      setProcessingPayment(true);

      const finalizeBooking = async () => {
        try {
          const response = await fetch('/api/website/booking/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subdomain,
              booking_id: bookingIdFromUrl
            })
          });

          const data = await response.json();

          if (data.success) {
            // Clean URL
            window.history.replaceState({}, '', window.location.pathname);

            // Go to intake or confirmation
            if (hasIntake && intakeTemplate) {
              setStep('intake');
            } else {
              setStep('confirmation');
            }
          } else {
            setError(data.error || 'Failed to finalize booking');
          }
        } catch {
          setError('Failed to finalize booking. Please contact support.');
        } finally {
          setProcessingPayment(false);
        }
      };

      finalizeBooking();
    } else if (paymentStatus === 'cancelled' && bookingIdFromUrl) {
      // Payment cancelled, show payment step again
      setBookingId(bookingIdFromUrl);
      setStep('payment');
      setError('Payment was cancelled. Please try again.');

      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [subdomain, hasIntake, intakeTemplate]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!openSelectKey) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-select-container]')) {
        setOpenSelectKey(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openSelectKey]);

  // Fetch slots when service or date changes
  useEffect(() => {
    if (selectedService && selectedDate) {
      fetchSlots();
    }
  }, [selectedService, selectedDate]);

  const fetchSlots = async () => {
    if (!selectedService || !selectedDate) return;

    setLoadingSlots(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/website/booking/availability?subdomain=${subdomain}&service_id=${selectedService.id}&date=${selectedDate}`
      );
      const data = await response.json();

      if (data.success) {
        setSlots(data.slots || []);
      } else {
        setError('Failed to load available times');
      }
    } catch {
      setError('Failed to load available times');
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleSelectService = (service: Service) => {
    setSelectedService(service);
    setStep('datetime');
  };

  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    setStep('details');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedService || !selectedSlot || !name || !email) {
      setError('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    setError(null);

    // Determine if payment is required
    const requiresPayment = selectedService.price !== null && selectedService.price > 0;
    console.log('📋 Booking submission:', {
      service: selectedService.name,
      price: selectedService.price,
      requiresPayment,
      hasIntake,
      intakeTemplate: !!intakeTemplate
    });

    try {
      const response = await fetch('/api/website/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain,
          service_id: selectedService.id,
          start_time: selectedSlot.start,
          name,
          email,
          phone: phone || undefined,
          notes: notes || undefined,
          timezone,
          // Skip contact creation for paid services - contact will be created after payment
          skip_contact: requiresPayment
        })
      });

      const data = await response.json();

      if (data.success) {
        // Store booking ID for payment/intake submission
        setBookingId(data.booking?.id || null);

        // Determine next step based on payment requirement
        console.log('📋 Next step decision:', { requiresPayment, hasIntake, intakeTemplate: !!intakeTemplate });
        if (requiresPayment) {
          // Go to payment step - contact will be created after payment
          console.log('📋 Going to PAYMENT step');
          setStep('payment');
        } else if (hasIntake && intakeTemplate) {
          // Free service with intake - go to intake
          console.log('📋 Going to INTAKE step');
          setStep('intake');
        } else {
          // Free service without intake - go to confirmation
          console.log('📋 Going to CONFIRMATION step');
          setStep('confirmation');
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

  // Handle payment completion - creates contact and finalizes booking
  const handlePaymentComplete = async () => {
    if (!bookingId || !selectedService) {
      setError('Missing booking information');
      return;
    }

    console.log('💳 Starting payment flow...', {
      bookingId,
      service: selectedService.name,
      price: selectedService.price,
      currency: selectedService.currency
    });

    setProcessingPayment(true);
    setError(null);

    try {
      // Build success/cancel URLs
      const baseUrl = window.location.origin;
      const bookUrl = `${baseUrl}/site/${subdomain}/book`;
      const successUrl = `${bookUrl}?booking_id=${bookingId}&payment=success`;
      const cancelUrl = `${bookUrl}?booking_id=${bookingId}&payment=cancelled`;

      console.log('💳 Calling checkout API...');

      // Create Stripe checkout session
      const response = await fetch('/api/website/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain,
          amount: selectedService.price,
          currency: selectedService.currency,
          description: `${selectedService.name} - ${formatDate(selectedDate!)} at ${formatTime(selectedSlot!.start)}`,
          customer_email: email,
          booking_id: bookingId,
          service_id: selectedService.id,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            customer_name: name,
            customer_phone: phone
          }
        })
      });

      const data = await response.json();
      console.log('💳 Checkout API response:', data);

      if (data.success && data.checkoutUrl) {
        console.log('💳 Redirecting to Stripe:', data.checkoutUrl);
        // Redirect to Stripe checkout
        window.location.href = data.checkoutUrl;
      } else {
        console.error('💳 Checkout failed:', data.error);
        setError(data.error || 'Failed to create checkout session');
        setProcessingPayment(false);
      }
    } catch (err) {
      console.error('💳 Payment error:', err);
      setError('Failed to process payment. Please try again.');
      setProcessingPayment(false);
    }
  };

  const handleIntakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bookingId || !intakeTemplate) {
      setError('Missing booking information');
      return;
    }

    // Validate required fields
    const missingRequired = intakeTemplate.fields
      .filter(f => f.required)
      .filter(f => !intakeResponses[f.key] || intakeResponses[f.key] === '');

    if (missingRequired.length > 0) {
      setError('Please fill in all required fields');
      return;
    }

    setSubmittingIntake(true);
    setError(null);

    try {
      const response = await fetch('/api/website/booking/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          subdomain,
          templateId: intakeTemplate.id,
          templateKey: intakeTemplate.template_key,
          responses: intakeResponses
        })
      });

      const data = await response.json();

      if (data.success) {
        setStep('confirmation');
      } else {
        setError(data.error || 'Failed to submit intake form');
      }
    } catch {
      setError('Failed to submit intake form. Please try again.');
    } finally {
      setSubmittingIntake(false);
    }
  };

  const handleIntakeFieldChange = (key: string, value: unknown) => {
    setIntakeResponses(prev => ({ ...prev, [key]: value }));
  };

  const skipIntake = () => {
    setStep('confirmation');
  };

  const formatPrice = (price: number | null, currency: string) => {
    if (price === null || price === 0) return t.free;
    const symbols: Record<string, string> = { USD: '$', EUR: '€', ILS: '₪', GBP: '£' };
    return `${symbols[currency] || '$'}${price}`;
  };

  // Get locale string for date/time formatting
  const dateLocale = locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US';

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString(dateLocale, { hour: 'numeric', minute: '2-digit', hour12: locale !== 'he' });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(dateLocale, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatFullDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(dateLocale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };

  // Step 1: Service Selection
  if (step === 'service') {
    return (
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <h2 className="text-lg font-semibold text-gray-900">{t.choose_service}</h2>
        <div className="space-y-3">
          {services.map((service) => (
            <button
              key={service.id}
              onClick={() => handleSelectService(service)}
              className="w-full p-4 bg-white border border-gray-200 rounded-xl text-left hover:border-gray-300 hover:shadow-sm transition-all group"
              style={{ textAlign: isRTL ? 'right' : 'left' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900 group-hover:text-[var(--booking-primary)]">
                    {service.name}
                  </h3>
                  {service.description && (
                    <p className="text-sm text-gray-600 mt-1">{service.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {service.duration_minutes} {t.min}
                    </span>
                  </div>
                </div>
                <div className={isRTL ? 'text-left' : 'text-right'}>
                  <span className="font-semibold" style={{ color: primaryColor }}>
                    {formatPrice(service.price, service.currency)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: Date & Time Selection
  if (step === 'datetime') {
    return (
      <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <button
          onClick={() => setStep('service')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          {t.back_to_services}
        </button>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
              <Calendar className="w-5 h-5" style={{ color: primaryColor }} />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">{selectedService?.name}</h3>
              <p className="text-sm text-gray-500">{selectedService?.duration_minutes} {t.min}</p>
            </div>
          </div>
        </div>

        {/* Date Selection */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t.select_date}</h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {dates.map((date) => (
              <button
                key={date}
                onClick={() => {
                  setSelectedDate(date);
                  setSelectedSlot(null);
                }}
                className={`flex-shrink-0 px-4 py-3 rounded-lg border text-center transition-all ${
                  selectedDate === date
                    ? 'border-transparent text-white'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
                style={selectedDate === date ? { backgroundColor: primaryColor } : {}}
              >
                <div className="text-xs font-medium">{formatDate(date).split(' ')[0]}</div>
                <div className="text-lg font-semibold">{new Date(date).getDate()}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Time Slots */}
        {selectedDate && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">{t.select_time}</h3>
            {loadingSlots ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : slots.length === 0 ? (
              <p className="text-center py-8 text-gray-500">{t.no_times_available}</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {slots.map((slot, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelectSlot(slot)}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                      selectedSlot?.start === slot.start
                        ? 'border-transparent text-white'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                    style={selectedSlot?.start === slot.start ? { backgroundColor: primaryColor } : {}}
                  >
                    {formatTime(slot.start)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
      </div>
    );
  }

  // Step 3: Contact Details
  if (step === 'details') {
    return (
      <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <button
          onClick={() => setStep('datetime')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          {t.back_to_datetime}
        </button>

        {/* Summary */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
              <Calendar className="w-5 h-5" style={{ color: primaryColor }} />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">{selectedService?.name}</h3>
              <p className="text-sm text-gray-500">
                {selectedSlot && formatFullDate(selectedSlot.start)} · {selectedSlot && formatTime(selectedSlot.start)}
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t.your_name} *
            </label>
            <div className="relative">
              <User className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={`w-full ${isRTL ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--booking-primary)] focus:border-transparent`}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t.email} *
            </label>
            <div className="relative">
              <Mail className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={`w-full ${isRTL ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--booking-primary)] focus:border-transparent`}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t.phone}
            </label>
            <div className="relative">
              <Phone className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400`} />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`w-full ${isRTL ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--booking-primary)] focus:border-transparent`}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t.notes}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--booking-primary)] focus:border-transparent resize-none"
              placeholder={t.notes_placeholder}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: primaryColor }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t.booking}
              </>
            ) : (
              <>
                {t.confirm_booking}
                {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
              </>
            )}
          </button>
        </form>
      </div>
    );
  }

  // Step 4: Intake Form (if enabled)
  if (step === 'intake' && intakeTemplate) {
    return (
      <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <button
          onClick={() => setStep('details')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          {t.back_to_details}
        </button>

        {/* Header */}
        <div className="text-center">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <ClipboardList className="w-6 h-6" style={{ color: primaryColor }} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            {getLocalizedTemplateName(intakeTemplate)}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {t.intake_complete_form}
          </p>
        </div>

        {/* Intake Form */}
        <form onSubmit={handleIntakeSubmit} className="space-y-4">
          {intakeTemplate.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {getLocalizedLabel(field)}
                {field.required && <span className={`text-red-500 ${isRTL ? 'mr-1' : 'ml-1'}`}>*</span>}
              </label>

              {field.type === 'text' && (
                <input
                  type="text"
                  value={(intakeResponses[field.key] as string) || ''}
                  onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                  required={field.required}
                  placeholder={getLocalizedPlaceholder(field)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--booking-primary)] focus:border-transparent"
                />
              )}

              {field.type === 'textarea' && (
                <textarea
                  value={(intakeResponses[field.key] as string) || ''}
                  onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                  required={field.required}
                  placeholder={getLocalizedPlaceholder(field)}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--booking-primary)] focus:border-transparent resize-none"
                />
              )}

              {field.type === 'email' && (
                <input
                  type="email"
                  value={(intakeResponses[field.key] as string) || ''}
                  onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                  required={field.required}
                  placeholder={getLocalizedPlaceholder(field)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--booking-primary)] focus:border-transparent"
                />
              )}

              {field.type === 'tel' && (
                <input
                  type="tel"
                  value={(intakeResponses[field.key] as string) || ''}
                  onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                  required={field.required}
                  placeholder={getLocalizedPlaceholder(field)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--booking-primary)] focus:border-transparent"
                />
              )}

              {field.type === 'select' && field.options && (
                <div className="relative" data-select-container>
                  {/* Hidden input for form validation */}
                  <input
                    type="text"
                    value={(intakeResponses[field.key] as string) || ''}
                    required={field.required}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={() => {}}
                  />
                  {/* Custom styled select trigger */}
                  <button
                    type="button"
                    onClick={() => setOpenSelectKey(openSelectKey === field.key ? null : field.key)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 border rounded-lg bg-white text-sm transition-all ${
                      openSelectKey === field.key
                        ? 'border-[var(--booking-primary)] ring-2 ring-[var(--booking-primary)] ring-opacity-20'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className={intakeResponses[field.key] ? 'text-gray-900' : 'text-gray-400'}>
                      {intakeResponses[field.key]
                        ? getLocalizedLabel(field.options.find(o => o.value === intakeResponses[field.key]) || { label_en: String(intakeResponses[field.key]) })
                        : t.select_option}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${openSelectKey === field.key ? 'rotate-180' : ''}`} />
                  </button>
                  {/* Dropdown menu */}
                  {openSelectKey === field.key && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      {field.options.map((opt) => {
                        const isSelected = intakeResponses[field.key] === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              handleIntakeFieldChange(field.key, opt.value);
                              setOpenSelectKey(null);
                            }}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                              isSelected
                                ? 'bg-gray-50 text-gray-900 font-medium'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                            style={isSelected ? { color: primaryColor } : {}}
                          >
                            <span className="w-4 h-4 flex items-center justify-center">
                              {isSelected && <Check className="w-4 h-4" style={{ color: primaryColor }} />}
                            </span>
                            {getLocalizedLabel(opt)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {field.type === 'radio' && field.options && (
                <div className="space-y-2">
                  {field.options.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name={field.key}
                        value={opt.value}
                        checked={intakeResponses[field.key] === opt.value}
                        onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                        required={field.required}
                        className="w-4 h-4 border-gray-300 focus:ring-[var(--booking-primary)]"
                        style={{ accentColor: primaryColor }}
                      />
                      <span className="text-sm text-gray-700">{getLocalizedLabel(opt)}</span>
                    </label>
                  ))}
                </div>
              )}

              {field.type === 'checkbox' && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!intakeResponses[field.key]}
                    onChange={(e) => handleIntakeFieldChange(field.key, e.target.checked)}
                    className="w-4 h-4 border-gray-300 rounded focus:ring-[var(--booking-primary)]"
                    style={{ accentColor: primaryColor }}
                  />
                  <span className="text-sm text-gray-700">{getLocalizedPlaceholder(field) || 'Yes'}</span>
                </label>
              )}
            </div>
          ))}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={skipIntake}
              className="flex-1 px-4 py-3 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-all"
            >
              {t.skip_for_now}
            </button>
            <button
              type="submit"
              disabled={submittingIntake}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: primaryColor }}
            >
              {submittingIntake ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {t.submitting}
                </>
              ) : (
                <>
                  {t.submit}
                  {isRTL ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Step 5: Payment (for paid services)
  if (step === 'payment') {
    const payToConfirmText = t.pay_to_confirm.replace('{amount}', formatPrice(selectedService?.price || 0, selectedService?.currency || 'USD'));

    return (
      <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <button
          onClick={() => setStep('details')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          {t.back_to_details}
        </button>

        {/* Summary */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
              <Calendar className="w-5 h-5" style={{ color: primaryColor }} />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">{selectedService?.name}</h3>
              <p className="text-sm text-gray-500">
                {selectedSlot && formatFullDate(selectedSlot.start)} · {selectedSlot && formatTime(selectedSlot.start)}
              </p>
            </div>
          </div>
        </div>

        {/* Payment Section */}
        <div className="text-center">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <CreditCard className="w-6 h-6" style={{ color: primaryColor }} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{t.complete_payment}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {payToConfirmText}
          </p>
        </div>

        {/* Payment Amount Card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600">{t.service}</span>
            <span className="font-medium text-gray-900">{selectedService?.name}</span>
          </div>
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600">{t.duration}</span>
            <span className="font-medium text-gray-900">{selectedService?.duration_minutes} {t.min}</span>
          </div>
          <div className="border-t border-gray-100 pt-4 flex justify-between items-center">
            <span className="font-semibold text-gray-900">{t.total}</span>
            <span className="text-xl font-bold" style={{ color: primaryColor }}>
              {formatPrice(selectedService?.price || 0, selectedService?.currency || 'USD')}
            </span>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 text-center">{error}</p>
        )}

        {/* Simulated Payment Button (Stripe integration pending) */}
        <button
          onClick={handlePaymentComplete}
          disabled={processingPayment}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: primaryColor }}
        >
          {processingPayment ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {t.processing}
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              {t.pay} {formatPrice(selectedService?.price || 0, selectedService?.currency || 'USD')}
            </>
          )}
        </button>

        <p className="text-xs text-center text-gray-500">
          Secure payment powered by Stripe
        </p>
      </div>
    );
  }

  // Step 6: Confirmation
  if (step === 'confirmation') {
    return (
      <div className="text-center py-12" dir={isRTL ? 'rtl' : 'ltr'}>
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <Check className="w-8 h-8" style={{ color: primaryColor }} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.booking_confirmed}</h2>
        <p className="text-gray-600 mb-6">
          {t.confirmation_email} <strong>{email}</strong>
        </p>

        <div className={`bg-white border border-gray-200 rounded-xl p-6 max-w-sm mx-auto ${isRTL ? 'text-right' : 'text-left'}`}>
          <h3 className="font-semibold text-gray-900 mb-4">{t.booking_details}</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{t.service}</span>
              <span className="font-medium text-gray-900">{selectedService?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t.date}</span>
              <span className="font-medium text-gray-900">
                {selectedSlot && formatFullDate(selectedSlot.start)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t.time}</span>
              <span className="font-medium text-gray-900">
                {selectedSlot && formatTime(selectedSlot.start)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t.duration}</span>
              <span className="font-medium text-gray-900">{selectedService?.duration_minutes} {t.min}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setStep('service');
            setSelectedService(null);
            setSelectedDate('');
            setSelectedSlot(null);
            setName('');
            setEmail('');
            setPhone('');
            setNotes('');
            setIntakeResponses({});
            setBookingId(null);
          }}
          className="mt-8 px-6 py-2.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-all"
        >
          {t.book_another}
        </button>
      </div>
    );
  }

  return null;
}
