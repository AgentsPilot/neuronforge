'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, ArrowRight, Loader2 } from 'lucide-react';
import type { BlockRendererProps, CapabilityConfig } from './types';
import { businessDateKey, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';
import { createLogger } from '@/lib/logger';
import type { ServicePaymentPlan } from '@/lib/business-os/servicePaymentPlan';

const logger = createLogger({ module: 'BookingWidgetBlock' });

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
  /*
   * The raw facts, kept beside the display string.
   *
   * `price` above is already formatted for the card, and a formatted price
   * cannot be handed to the booking dialog — it needs the number, the currency
   * and the two journey facts that decide whether this service picks a time and
   * whether it takes a card. The availability endpoint publishes all four; this
   * widget was the one caller that dropped them, because it only ever built a
   * query string.
   */
  description?: string | null;
  priceRaw?: number | null;
  currency?: string;
  is_scheduled?: boolean;
  collection?: 'online' | 'invoice' | null;
  /**
   * The two that were dropped a second time.
   *
   * The note above records this widget dropping `is_scheduled` and `collection`
   * and the journey going wrong for it. `paymentPlan` and `sale_mode` then went
   * the same way: the endpoint publishes both, and this widget carried neither —
   * so a client who picked an instalment service here reached the dialog with no
   * plan attached and was quoted, and charged, the whole price.
   */
  sale_mode?: 'direct' | 'proposal';
  paymentPlan?: ServicePaymentPlan;
}

export function BookingWidgetBlock({ content, styles, theme, locale, isRTL, className, subdomain, isPreview, clientFlow, onOpenBooking }: BlockRendererProps) {
  /*
   * Can this block ask the server who the business is?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The two effects below used to return early on `!subdomain`, and a DRAFT page
   * has no subdomain — so in the preview they never fetched at all. No request,
   * no error, an empty calendar and a clean console. Meanwhile the smart link
   * worked, because its identity is a path segment rather than a query
   * parameter.
   *
   * In preview the owner is signed in, and the availability route now resolves
   * by session when no address is given — the same fallback `payment-intent`
   * has always had. So the question is not "do I have a subdomain" but "can the
   * business be identified at all", and in preview it always can.
   *
   * `isPreview` has reached every block since it was added to the renderer
   * (`blocks/index.tsx`); this one simply never read it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const canResolveBusiness = Boolean(subdomain) || Boolean(isPreview);

  /**
   * The owner part of an availability query, and nothing when there is none.
   *
   * Absent in preview, which is precisely how the route knows to fall back to
   * the session. Composed rather than interpolated so the preview does not send
   * `?&service_id=…` — harmless, but the kind of thing that gets "fixed" later
   * by putting the subdomain back.
   */
  const availabilityUrl = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(extra);
    if (subdomain) params.set('subdomain', subdomain);
    return `/api/website/booking/availability?${params.toString()}`;
  };
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
  /*
   * A business date key ("2026-09-21"), not a Date.
   *
   * Held as a Date, every read of it went through the VISITOR's calendar: the
   * day buttons showed the visitor's days, and the slot request sent the UTC
   * day of the visitor's midnight — so a client booking late in the evening
   * from a zone behind UTC asked the business for tomorrow and was shown
   * tomorrow's hours under today's label.
   */
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  /** The business's zone, from the availability response. */
  const [businessTimezone, setBusinessTimezone] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [availabilityConfigured, setAvailabilityConfigured] = useState<boolean | null>(null);

  /* The next 7 days as the BUSINESS counts them. Falls back to the visitor's
     zone only until the first availability response names the real one. */
  const nextDays = useMemo(() => {
    const zone = businessTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const first = businessDateKey(new Date(), zone);
    return Array.from({ length: 7 }, (_, i) => shiftBusinessDateKey(first, i));
  }, [businessTimezone]);

  // Fetch availability data from API
  useEffect(() => {
    if (!canResolveBusiness) {
      setLoading(false);
      return;
    }

    const fetchAvailability = async () => {
      try {
        const response = await fetch(availabilityUrl());
        const data = await response.json();

        if (data.success) {
          setAvailabilityConfigured(data.availabilityConfigured);
          // The zone the returned slots belong to.
          if (typeof data.timezone === 'string' && data.timezone) {
            setBusinessTimezone(data.timezone);
          }

          if (data.services && data.services.length > 0) {
            type ApiService = {
              id: string;
              name: string;
              description?: string | null;
              duration_minutes: number;
              price?: number | null;
              currency?: string;
              is_scheduled?: boolean;
              collection?: 'online' | 'invoice' | null;
              sale_mode?: 'direct' | 'proposal';
              paymentPlan?: ServicePaymentPlan;
            };
            let live = data.services as ApiService[];

            /*
             * Honour the services this block was built for.
             *
             * The endpoint returns everything the business currently sells, and
             * this used to render all of it — so a landing page headlined
             * "Wedding Photography" offered the visitor the whole menu, and the
             * one service the page was written about was just another row. The
             * generator has always written the intended id into `content`
             * (`services` for this block, `service_id` where a single one is
             * pinned); nothing read it back.
             *
             * Filtering against the live list also handles a service that has
             * since been deleted or switched off: it is simply absent, and the
             * empty state below says so rather than the widget offering
             * something that cannot be booked.
             */
            const wanted = services.length > 0 ? services : service_id ? [service_id] : [];
            if (wanted.length > 0) {
              const scoped = live.filter(s => wanted.includes(s.id));
              /*
               * Only narrow when something survives. A page whose pinned
               * service is gone falls back to showing what IS bookable, which
               * is a better outcome for the visitor than an empty widget — the
               * page itself is taken down when a service is removed, so this
               * only covers pages that predate that.
               */
              if (scoped.length > 0) live = scoped;
            }

            setServiceOptions(live.map((s: ApiService) => ({
              id: s.id,
              name: s.name,
              duration: s.duration_minutes,
              price: s.price ? `${s.currency || 'USD'} ${s.price}` : undefined,
              // Carried so this widget can open the dialog for the service the
              // client picked, rather than only pointing a URL at it.
              description: s.description ?? null,
              priceRaw: s.price ?? null,
              currency: s.currency || 'USD',
              is_scheduled: s.is_scheduled,
              collection: s.collection ?? null,
              sale_mode: s.sale_mode,
              paymentPlan: s.paymentPlan
            })));
          }
        }
      } catch (error) {
        logger.error({ err: error, subdomain }, 'Failed to fetch availability');
        setAvailabilityConfigured(false);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailability();
    // `services` is a stable array from block content, joined so a new array
    // identity on each render does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canResolveBusiness, subdomain, services.join(','), service_id]);

  // Fetch slots when service and date are selected
  useEffect(() => {
    if (!selectedDate || !selectedService || !canResolveBusiness || !availabilityConfigured) {
      return;
    }

    const fetchSlots = async () => {
      setLoading(true);
      try {
        const dateStr = selectedDate;
        const response = await fetch(
          availabilityUrl({ service_id: selectedService, date: dateStr })
        );
        const data = await response.json();

        if (data.success && data.slots) {
          // Extract just the time from the ISO date strings
          /* The hour the BUSINESS means, not the hour on the visitor's laptop. */
          const zone = (typeof data.timezone === 'string' && data.timezone) ? data.timezone : undefined;
          const times = data.slots.map((slot: { start: string }) => {
            const date = new Date(slot.start);
            return date.toLocaleTimeString(locale, {
              hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone
            });
          });
          setAvailableSlots(times);
        } else {
          setAvailableSlots([]);
        }
      } catch (error) {
        logger.error({ err: error, subdomain, selectedService }, 'Failed to fetch slots');
        setAvailableSlots([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSlots();
  }, [selectedDate, selectedService, canResolveBusiness, subdomain, availabilityConfigured, locale]);


  const handleBook = () => {
    /*
     * The dialog, where the page has one.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This button only ever did `window.location.href = '/book?…'` — an
     * app-absolute path with no business in it. It resolves correctly ONLY on a
     * real subdomain host, where middleware rewrites `/book` to
     * `/site/{subdomain}/book`. Reached at the path form the platform itself
     * links to (`/site/{subdomain}/…`), the same href leaves the business's site
     * for the platform's own `/book`, and the client's chosen service, day and
     * hour go with it.
     *
     * Every other converting section on the page opens the dialog; this one was
     * never handed the opener. It is now, and the navigation stays as the
     * fallback for a surface with no dialog mounted.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (onOpenBooking) {
      const picked = serviceOptions.find(s => s.id === selectedService);
      onOpenBooking(
        picked
          ? {
              id: picked.id,
              name: picked.name,
              description: picked.description ?? null,
              duration_minutes: picked.duration,
              price: picked.priceRaw ?? null,
              currency: picked.currency || 'USD',
              is_scheduled: picked.is_scheduled,
              collection: picked.collection ?? null,
              sale_mode: picked.sale_mode,
              // Without this the dialog opens on a plan service with no plan,
              // and quotes the total instead of one period.
              paymentPlan: picked.paymentPlan,
            }
          : // Nothing picked: the dialog opens on its catalogue and the client
            // chooses there, which is the same list this widget is showing.
            null
      );
      return;
    }

    // Build booking URL with service and flow parameters
    const params = new URLSearchParams();
    if (selectedService) params.set('service', selectedService);
    if (selectedDate) params.set('date', selectedDate);
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
        className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'ap-card-2'} ${className || ''}`}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto ap-ink-3" />
            <p className="mt-4 ap-ink-3">{labels.loading}</p>
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
        className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'ap-card-2'} ${className || ''}`}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="ap-card rounded-2xl shadow-lg p-8 sm:p-12 text-center"
            style={{ borderRadius: theme?.borderRadius || '1rem' }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ backgroundColor: `${primaryColor}15` }}
            >
              <Clock className="w-8 h-8" style={{ color: primaryColor }} />
            </div>
            <h3
              className="text-2xl sm:text-3xl font-bold ap-ink mb-4"
              style={{ fontFamily: 'var(--ap-font-heading)' }}
            >
              {labels.availabilityNotConfigured}
            </h3>
            <p
              className="ap-ink-2 max-w-md mx-auto"
              style={{ fontFamily: 'var(--ap-font-body)' }}
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
      className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'ap-card-2'} ${className || ''}`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-10">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl sm:text-4xl font-bold ap-ink"
            style={{ fontFamily: 'var(--ap-font-heading)' }}
          >
            {title || labels.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-4 ap-ink-2"
            style={{ fontFamily: 'var(--ap-font-body)' }}
          >
            {subtitle || labels.subtitle}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="ap-card rounded-2xl shadow-lg p-6 sm:p-8"
          style={{ borderRadius: theme?.borderRadius || '1rem' }}
        >
          {/* Service Selection */}
          {serviceOptions.length > 0 && (
            <div className="mb-8">
              <label className="block text-sm font-medium ap-ink-2 mb-3">
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
                        : 'ap-line ap-hover-line'
                    }`}
                    style={{
                      borderColor: selectedService === service.id ? primaryColor : undefined,
                      backgroundColor: selectedService === service.id ? `${primaryColor}10` : undefined
                    }}
                  >
                    <p className="font-medium ap-ink">{service.name}</p>
                    <p className="text-sm ap-ink-3 mt-1">
                      {service.duration} {labels.minutes} {service.price && `• ${service.price}`}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Date Selection */}
          <div className="mb-8">
            <label className="block text-sm font-medium ap-ink-2 mb-3">
              {labels.selectDate}
            </label>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {nextDays.map((dateKey: string, index: number) => (
                <button
                  key={index}
                  onClick={() => setSelectedDate(dateKey)}
                  className={`flex-shrink-0 p-3 rounded-xl border-2 transition-all min-w-[80px] text-center ${
                    selectedDate === dateKey
                      ? 'border-current'
                      : 'ap-line ap-hover-line'
                  }`}
                  style={{
                    borderColor: selectedDate === dateKey ? primaryColor : undefined,
                    backgroundColor: selectedDate === dateKey ? `${primaryColor}10` : undefined
                  }}
                >
                  {/* Both read off the key. Anchored at noon UTC and formatted
                      in UTC, so the weekday and the number always name the same
                      day the button selects, in every visitor's zone. */}
                  <p className="text-xs ap-ink-3">
                    {new Date(`${dateKey}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })}
                  </p>
                  <p className="text-lg font-semibold ap-ink">
                    {Number(dateKey.slice(8, 10))}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Time Selection */}
          {selectedDate && (
            <div className="mb-8">
              <label className="block text-sm font-medium ap-ink-2 mb-3">
                {labels.selectTime}
              </label>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin ap-ink-3" />
                  <span className="ms-2 ap-ink-3">{labels.loading}</span>
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
                          : 'ap-line ap-hover-line'
                      }`}
                      style={{
                        borderColor: selectedTime === time ? primaryColor : undefined,
                        backgroundColor: selectedTime === time ? `${primaryColor}10` : undefined
                      }}
                    >
                      <span className="font-medium ap-ink">{time}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Book Button */}
          <button
            onClick={handleBook}
            /*
             * A day and an hour are required only for the HANDOFF, which carries
             * them in a query string. The dialog asks for them itself, on live
             * availability, so demanding them here would make the client pick a
             * time twice — and the second pick is the one that counts.
             */
            disabled={
              onOpenBooking
                ? serviceOptions.length > 0 && !selectedService
                : !selectedDate || !selectedTime || (serviceOptions.length > 0 && !selectedService)
            }
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
