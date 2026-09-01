'use client';

/**
 * Standalone Booking Widget Component
 * Wrapper around the existing booking functionality, adapted for userCode-based routing
 * Used by standalone conversion pages (/c/[userCode]/book)
 */

import { useState, useEffect } from 'react';
import { Calendar, Clock, User, Mail, ArrowLeft, ArrowRight, Check, Loader2, CreditCard } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import type { CountryCode } from 'libphonenumber-js/core';
import { WebsiteCountrySelect } from '@/components/website/blocks/WebsiteCountrySelect';
import 'react-phone-number-input/style.css';
import { journeySteps, shouldTakePayment } from '@/lib/business-os/clientJourney';
import type { CollectionMethod } from '@/lib/business-os/setup/setupGraph';

interface Service {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
  /** Does booking this involve picking a time? */
  is_scheduled?: boolean | null;
  /** How the money arrives, or null where the service is free. */
  collection?: 'online' | 'invoice' | null;
}

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

// Flow step types - matches the wizard
type ClientFlowStep = 'scheduling' | 'client_info' | 'booking' | 'payment' | 'intake' | 'confirmation';

interface StandaloneBookingWidgetProps {
  userCode: string;
  services: Service[];
  timezone: string;
  primaryColor: string;
  locale?: 'en' | 'es' | 'he';
  initialServiceId?: string;
  clientFlow?: ClientFlowStep[] | null; // Custom flow from URL param
  /**
   * How the business collects. A priced service is not the same as a card
   * taken at booking — a clinic that invoices charges for its work and asks
   * for nothing on this screen.
   */
  collectionMethod?: CollectionMethod | null;
  /** Stripe connected with charges enabled. False drops the payment step. */
  processorReady?: boolean;
}

type Step = 'service' | 'datetime' | 'details' | 'payment' | 'confirmation';

/**
 * The steps this link walks a client through, for the service they picked.
 *
 * Was `mapFlowToSteps(clientFlow, hasPayment)` — a flow stored on the link,
 * decided when the link was made, with only the payment step per service. A
 * business whose catalogue holds a booked session and a downloadable product
 * had one flow describing both, and the product asked the client to pick a
 * time for a thing that has no time.
 *
 * The service decides it now, through the same resolver the website's booking
 * page runs, so the two surfaces cannot drift apart again. `intake` is not in
 * the list because this widget has no intake screen to send anyone to.
 */
function stepsForService(
  service: Service | null,
  collectionMethod: CollectionMethod | null | undefined,
  processorReady: boolean
): Step[] {
  return journeySteps(
    {
      is_scheduled: service?.is_scheduled,
      // The service's own answer, falling back to the business-wide one for a
      // service saved before services carried it.
      collection: service?.collection ?? collectionMethod,
      price: service?.price,
    },
    { processorReady, intakeEnabled: false }
  ) as Step[];
}

// Simple translations
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
    back: 'Back',
    continue: 'Continue',
    confirm_booking: 'Confirm Booking',
    booking: 'Booking...',
    no_times_available: 'No available times for this date',
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
    min: 'min',
    free: 'Free',
    secure_payment_stripe: 'Secure payment powered by Stripe',
    complete_payment: 'Complete Payment',
    pay_to_confirm: 'Pay {amount} to confirm your booking'
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
    back: 'Volver',
    continue: 'Continuar',
    confirm_booking: 'Confirmar Reserva',
    booking: 'Reservando...',
    no_times_available: 'No hay horarios disponibles para esta fecha',
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
    min: 'min',
    free: 'Gratis',
    secure_payment_stripe: 'Pago seguro con Stripe',
    complete_payment: 'Completar Pago',
    pay_to_confirm: 'Paga {amount} para confirmar tu reserva'
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
    back: 'חזור',
    continue: 'המשך',
    confirm_booking: 'אשר הזמנה',
    booking: 'מזמין...',
    no_times_available: 'אין שעות פנויות לתאריך זה',
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
    min: 'דק\'',
    free: 'חינם',
    secure_payment_stripe: 'תשלום מאובטח באמצעות Stripe',
    complete_payment: 'השלם תשלום',
    pay_to_confirm: 'שלם {amount} לאישור ההזמנה'
  }
};

export function StandaloneBookingWidget({
  userCode,
  services,
  timezone,
  primaryColor,
  locale = 'en',
  initialServiceId,
  clientFlow,
  collectionMethod = null,
  processorReady = false
}: StandaloneBookingWidgetProps) {
  const t = translations[locale] || translations.en;
  const isRTL = locale === 'he';

  const [step, setStep] = useState<Step>('service');
  const [selectedService, setSelectedService] = useState<Service | null>(null);

  /**
   * Whether this booking asks for payment.
   *
   * Three things have to be true, and the price is only the first. The step
   * used to appear on price alone, which put a card form in front of clients
   * of businesses that invoice — and, worse, in front of clients of businesses
   * that do collect online but have not finished connecting Stripe, where the
   * screen had no processor behind it at all.
   */
  const takesPayment = (service: Service | null) =>
    shouldTakePayment({
      // The SERVICE's own answer, falling back to the business-wide one — the
      // same expression `stepsForService` uses, and it has to be, because these
      // two decisions describe one journey.
      //
      // This read only `collectionMethod`, so the two disagreed the moment a
      // business moved collection onto its services and left the profile null:
      // `journeySteps` saw the service's 'online' and put a payment step in the
      // flow, while this saw null and decided nothing was owed. The client was
      // walked to a payment step the widget believed took no payment. The
      // mirror case is worse — a service set to `invoice` inside a card-taking
      // business had no payment step and a widget that thought it should charge.
      price: service?.price,
      collection: service?.collection ?? collectionMethod,
      processorReady,
    });

  // Determined by the service the client picked, not by the link.
  const hasPayment = takesPayment(selectedService);
  const activeSteps = stepsForService(selectedService, collectionMethod, processorReady);

  // Navigate to next step in the flow (respecting activeSteps)
  const goToNextStep = () => {
    const currentIndex = activeSteps.indexOf(step);
    if (currentIndex < activeSteps.length - 1) {
      setStep(activeSteps[currentIndex + 1]);
    }
  };

  // Navigate to previous step in the flow (respecting activeSteps)
  const goToPrevStep = () => {
    const currentIndex = activeSteps.indexOf(step);
    if (currentIndex > 0) {
      setStep(activeSteps[currentIndex - 1]);
    }
  };

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', notes: '' });
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(locale === 'he' ? 'IL' : locale === 'es' ? 'ES' : 'US');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingResult, setBookingResult] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize with initial service if provided
  useEffect(() => {
    if (initialServiceId && services.length > 0) {
      const service = services.find(s => s.id === initialServiceId);
      if (service) {
        setSelectedService(service);
        // Determine the next step from this service's own journey.
        const steps = stepsForService(service, collectionMethod, processorReady);
        // Skip 'service' step and go to the next step in the flow
        const nextStep = steps.length > 1 ? steps[1] : 'confirmation';
        setStep(nextStep);
      }
    }
  }, [initialServiceId, services, clientFlow]);

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedService || !selectedDate) return;

    const fetchSlots = async () => {
      setLoadingSlots(true);
      try {
        const dateStr = selectedDate.toISOString().split('T')[0];
        const response = await fetch(
          `/api/conversion/${userCode}/availability?service_id=${selectedService.id}&date=${dateStr}&days=1`
        );
        const data = await response.json();
        if (data.success && data.slots) {
          setSlots(data.slots.filter((s: TimeSlot) => s.available));
        } else {
          setSlots([]);
        }
      } catch (err) {
        console.error('Failed to fetch slots:', err);
        setSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [selectedService, selectedDate, userCode]);

  const formatPrice = (price: number | null, currency: string) => {
    if (price === null || price === 0) return t.free;
    const symbols: Record<string, string> = { USD: '$', EUR: '€', ILS: '₪', GBP: '£' };
    return `${symbols[currency] || '$'}${price}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString(locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleSubmit = async () => {
    if (!selectedService || !formData.name || !formData.email) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Create booking via the booking API with userCode
      const response = await fetch('/api/website/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userCode,  // Pass userCode instead of subdomain for standalone booking pages
          service_id: selectedService.id,
          start_time: selectedSlot?.start,
          name: formData.name,
          email: formData.email,
          phone: formData.phone || undefined,
          notes: formData.notes || undefined,
          timezone
        })
      });

      const data = await response.json();

      if (data.success) {
        setBookingResult({ id: data.booking.id, email: formData.email });
        setStep('confirmation');
      } else {
        setError(data.error || 'Failed to create booking');
      }
    } catch (err) {
      console.error('Booking failed:', err);
      setError('Failed to create booking. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setStep('service');
    setSelectedService(null);
    setSelectedDate(null);
    setSelectedSlot(null);
    setFormData({ name: '', email: '', phone: '', notes: '' });
    setBookingResult(null);
    setError(null);
  };

  // Generate date options (next 14 days)
  const dateOptions = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date;
  });

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      {/* Step: Select Service */}
      {step === 'service' && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.choose_service}</h2>
          <div className="space-y-3">
            {services.map(service => (
              <button
                key={service.id}
                onClick={() => {
                  setSelectedService(service);
                  // This service's own journey decides where the client goes
                  // next — a product skips the date step entirely.
                  const steps = stepsForService(service, collectionMethod, processorReady);
                  const nextStep = steps.length > 1 ? steps[1] : 'confirmation';
                  setStep(nextStep);
                }}
                className="w-full p-4 border border-gray-200 rounded-lg hover:border-gray-400 transition-colors text-left"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-gray-900">{service.name}</h3>
                    {service.description && (
                      <p className="text-sm text-gray-500 mt-1">{service.description}</p>
                    )}
                    <p className="text-sm text-gray-500 mt-1">
                      {service.duration_minutes} {t.min}
                    </p>
                  </div>
                  <span className="font-semibold" style={{ color: primaryColor }}>
                    {formatPrice(service.price, service.currency)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step: Select Date & Time */}
      {step === 'datetime' && selectedService && (
        <div>
          <button
            onClick={goToPrevStep}
            className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
          >
            {isRTL ? <ArrowRight className="w-4 h-4 mr-1" /> : <ArrowLeft className="w-4 h-4 mr-1" />}
            {t.back}
          </button>

          <div className="mb-6">
            <h3 className="font-medium text-gray-900 mb-3">{t.select_date}</h3>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {dateOptions.map(date => (
                <button
                  key={date.toISOString()}
                  onClick={() => {
                    setSelectedDate(date);
                    setSelectedSlot(null);
                  }}
                  className={`flex-shrink-0 px-4 py-2 rounded-lg border transition-colors ${
                    selectedDate?.toDateString() === date.toDateString()
                      ? 'border-2 text-white'
                      : 'border-gray-200 text-gray-700 hover:border-gray-400'
                  }`}
                  style={
                    selectedDate?.toDateString() === date.toDateString()
                      ? { backgroundColor: primaryColor, borderColor: primaryColor }
                      : {}
                  }
                >
                  <div className="text-xs">{date.toLocaleDateString(locale, { weekday: 'short' })}</div>
                  <div className="font-medium">{date.getDate()}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedDate && (
            <div>
              <h3 className="font-medium text-gray-900 mb-3">{t.select_time}</h3>
              {loadingSlots ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : slots.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {slots.map(slot => (
                    <button
                      key={slot.start}
                      onClick={() => {
                        setSelectedSlot(slot);
                        goToNextStep();
                      }}
                      className={`px-3 py-2 rounded-lg border transition-colors ${
                        selectedSlot?.start === slot.start
                          ? 'border-2 text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-400'
                      }`}
                      style={
                        selectedSlot?.start === slot.start
                          ? { backgroundColor: primaryColor, borderColor: primaryColor }
                          : {}
                      }
                    >
                      {formatTime(slot.start)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">{t.no_times_available}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step: Enter Details */}
      {step === 'details' && selectedService && (
        <div>
          <button
            onClick={goToPrevStep}
            className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
          >
            {isRTL ? <ArrowRight className="w-4 h-4 mr-1" /> : <ArrowLeft className="w-4 h-4 mr-1" />}
            {t.back}
          </button>

          {/* Only show date/time summary if datetime step was included */}
          {selectedSlot && (
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                <Calendar className="w-4 h-4" />
                {selectedDate && formatDate(selectedDate)}
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                {formatTime(selectedSlot.start)} - {formatTime(selectedSlot.end)}
              </div>
              <div className="mt-2 font-medium">{selectedService.name}</div>
            </div>
          )}

          {/* Show service info without date/time when datetime is skipped */}
          {!selectedSlot && (
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <div className="font-medium">{selectedService.name}</div>
              <div className="text-sm text-gray-600 mt-1">
                {selectedService.duration_minutes} {t.min} • {formatPrice(selectedService.price, selectedService.currency)}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.your_name} *</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.email} *</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.phone}</label>
              <div dir="ltr" className="flex gap-2">
                <WebsiteCountrySelect
                  value={phoneCountry}
                  onChange={setPhoneCountry}
                  isRTL={isRTL}
                />
                <div className="phone-input-booking flex-1">
                  <PhoneInput
                    international
                    countryCallingCodeEditable={false}
                    country={phoneCountry}
                    defaultCountry={phoneCountry}
                    value={formData.phone}
                    onChange={(value) => setFormData({ ...formData, phone: value || '' })}
                    onCountryChange={(country) => country && setPhoneCountry(country)}
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.notes}</label>
              <textarea
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                placeholder={t.notes_placeholder}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!formData.name || !formData.email || isSubmitting}
              className="w-full py-3 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: primaryColor }}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.booking}
                </span>
              ) : selectedService.price && selectedService.price > 0 ? (
                t.complete_payment
              ) : (
                t.confirm_booking
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step: Confirmation */}
      {step === 'confirmation' && bookingResult && (
        <div className="text-center py-8">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: `${primaryColor}20` }}
          >
            <Check className="w-8 h-8" style={{ color: primaryColor }} />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{t.booking_confirmed}</h2>
          <p className="text-gray-600 mb-6">
            {t.confirmation_email} <strong>{bookingResult.email}</strong>
          </p>

          {selectedService && (
            <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
              <h3 className="font-medium text-gray-900 mb-2">{t.booking_details}</h3>
              <div className="space-y-1 text-sm text-gray-600">
                <p><strong>{t.service}:</strong> {selectedService.name}</p>
                {selectedDate && <p><strong>{t.date}:</strong> {formatDate(selectedDate)}</p>}
                {selectedSlot && <p><strong>{t.time}:</strong> {formatTime(selectedSlot.start)}</p>}
                <p><strong>{t.duration}:</strong> {selectedService.duration_minutes} {t.min}</p>
                {selectedService.price != null && selectedService.price > 0 && (
                  <p><strong>{t.total}:</strong> {formatPrice(selectedService.price, selectedService.currency)}</p>
                )}
              </div>
            </div>
          )}

          <button
            onClick={handleReset}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t.book_another}
          </button>
        </div>
      )}
    </div>
  );
}
