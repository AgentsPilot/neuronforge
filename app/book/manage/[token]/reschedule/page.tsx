'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

import { BrandButton } from '@/components/public/BrandButton';
import { PortalHero } from '@/components/public/PortalHero';
import { PublicPageSpinner, PublicSpinner } from '@/components/public/PublicSpinner';
import { StatusCard } from '@/components/public/StatusCard';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import {
  createPublicT,
  formatPublicDate,
  formatPublicTime,
  localeCode as intlLocale,
  timeZoneLabel,
} from '@/lib/i18n/public-pages';

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

interface TimeSlot {
  start_time: string;
  end_time: string;
  display_time: string;
}

export default function RescheduleBookingPage() {
  const params = useParams();
  const token = params.token as string;
  const brand = useOptionalPublicBrand();

  const [config, setConfig] = useState<RescheduleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * When the appointment actually is.
   *
   * Refusing a change without saying what is being refused leaves the client
   * to go and find the email again to work out whether the rule even applies
   * to them. It is already fetched — the call above this one returns it — and
   * it was simply not kept.
   */
  const [bookingStartTime, setBookingStartTime] = useState<string | null>(null);

  const locale = brand?.locale ?? 'en';
  const t = createPublicT(locale);

  /**
   * The reason a change was refused, in the reader's language.
   *
   * The route sends a code and the numbers behind it; the sentence belongs
   * here, where the dictionary is. It used to send an English sentence which
   * was printed as-is, so a Hebrew page carried a Hebrew heading, a Hebrew
   * button, and an English reason between them.
   *
   * An unrecognised code falls back to the generic line rather than to the
   * server's English — a new code added later should read as "something went
   * wrong" in the right language, not leak an internal string.
   */
  const rescheduleErrorText = (data: { code?: string; hours?: number; limit?: number }): string => {
    switch (data.code) {
      case 'too_late':
        return t('rescheduleTooLate', { hours: String(data.hours ?? 24) });
      case 'reschedule_limit':
        return t('rescheduleLimit', { limit: String(data.limit ?? 2) });
      case 'not_found':
        return t('bookingNotFoundDesc');
      case 'invalid_link':
        return t('invalidLink');
      case 'not_reschedulable':
        return t('notReschedulable');
      case 'slot_taken':
        return t('slotTaken');
      default:
        return t('rescheduleFailed');
    }
  };

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  /**
   * Whether the whole month picker is open.
   *
   * Closed, the next ten days are offered as a strip — which is every date most
   * clients want and costs 66px instead of the ~290px a month grid spends to
   * surface the same week. The grid is still here, one tap away, because a
   * client moving an appointment four weeks out has to be able to.
   */
  const [showAllDates, setShowAllDates] = useState(false);

  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  /**
   * The booking's own timezone.
   *
   * A booking stores a real instant plus the zone it was made in, so the hour a
   * client sees must be rendered in THAT zone — not the viewer's. Defaults to
   * UTC only until the booking loads.
   */
  const [bookingTimezone, setBookingTimezone] = useState('UTC');

  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduled, setRescheduled] = useState(false);
  const [newBookingTime, setNewBookingTime] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRescheduleConfig() {
      try {
        const bookingResponse = await fetch(`/api/book/manage/${token}`);
        const bookingData = await bookingResponse.json();
        if (bookingData.success && bookingData.booking) {
          if (bookingData.booking.timezone) setBookingTimezone(bookingData.booking.timezone);
          if (bookingData.booking.startTime) setBookingStartTime(bookingData.booking.startTime);
        }

        const response = await fetch(`/api/book/manage/${token}/reschedule`);
        const data = await response.json();

        if (data.success) setConfig(data);
        else setError(rescheduleErrorText(data));
      } catch {
        setError(t('loadFailed'));
      } finally {
        setLoading(false);
      }
    }

    if (token) fetchRescheduleConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    async function fetchSlots() {
      if (!selectedDate || !config) return;

      setLoadingSlots(true);
      setSlots([]);
      setSelectedSlot(null);

      try {
        const response = await fetch(
          `/api/website/scheduling/availability?service_id=${config.serviceId}&date=${selectedDate}`
        );
        const data = await response.json();
        if (data.success && data.slots) setSlots(data.slots);
      } catch {
        // No slots is a legitimate answer; a failed lookup renders the same way.
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
          newEndTime: selectedSlot.end_time,
        }),
      });
      const data = await response.json();

      if (data.success) {
        setRescheduled(true);
        setNewBookingTime(data.booking.startTime);
      } else {
        setError(rescheduleErrorText(data));
      }
    } catch {
      setError(t('rescheduleFailed'));
    } finally {
      setRescheduling(false);
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startingDay = new Date(year, month, 1).getDay();

    const days: (number | null)[] = [];
    for (let i = 0; i < startingDay; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) days.push(day);
    return days;
  };

  const isDateSelectable = (day: number) => {
    if (!config) return false;

    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return false;

    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + config.serviceConfig.advanceBookingDays);
    return date <= maxDate;
  };

  /**
   * The next ten days, as the strip offers them.
   *
   * Built from today rather than from the visible month, so it never stops at
   * the end of one: the last days of October run straight into November, which
   * is what a client picking "a week on Tuesday" actually means. Each one is
   * judged by the SAME `isDateSelectable` the grid uses, so the strip can never
   * offer a date the grid refuses.
   */
  const upcomingDays = (count: number) => {
    const days: Date[] = [];
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);

    for (let index = 0; index < count; index++) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return days;
  };

  /** `2026-10-06`, for any date — the key the slots endpoint is asked with. */
  const dateKeyOf = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  /**
   * Is this date open, by the same rule the grid applies?
   *
   * `isDateSelectable` takes a day NUMBER and reads the month from
   * `currentMonth`, which is right for the grid and wrong for a strip that
   * crosses a month boundary. This asks the same two questions of a whole date.
   */
  const isDateOpen = (date: Date) => {
    if (!config) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    if (day < today) return false;

    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + config.serviceConfig.advanceBookingDays);
    maxDate.setHours(23, 59, 59, 999);

    return day <= maxDate;
  };

  /**
   * Morning, afternoon, evening.
   *
   * A flat list of twelve times is a scroll in itself and says nothing about
   * how much of the day is free. Split on the clock in the BUSINESS's zone,
   * because that is the clock the times are printed on.
   */
  const groupSlots = (list: TimeSlot[]) => {
    const groups: Array<{ key: string; label: string; slots: TimeSlot[] }> = [
      { key: 'morning', label: t('portal.morning'), slots: [] },
      { key: 'afternoon', label: t('portal.afternoon'), slots: [] },
      { key: 'evening', label: t('portal.evening'), slots: [] },
    ];

    for (const slot of list) {
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          hour12: false,
          timeZone: bookingTimezone,
        }).format(new Date(slot.start_time))
      );

      const group = hour < 12 ? groups[0] : hour < 17 ? groups[1] : groups[2];
      group.slots.push(slot);
    }

    return groups.filter(group => group.slots.length > 0);
  };

  const formatDateString = (day: number) => {
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-${String(day).padStart(2, '0')}`;
  };

  const formatDisplayDate = (dateStr: string) =>
    formatPublicDate(new Date(`${dateStr}T12:00:00`), locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

  /** The new time, in the booking's own zone rather than the viewer's. */
  const formatNewBookingTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString(intlLocale(locale), {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: locale === 'en',
      timeZone: bookingTimezone,
    });

  /**
   * The month name, in the reader's language.
   *
   * This was a hardcoded English array, so a Hebrew client got an RTL calendar
   * headed "September 2026" with every other word on the page in Hebrew — which
   * reads worse than a page that was never translated at all.
   */
  const monthLabel = currentMonth.toLocaleDateString(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
  });

  if (loading) return <PublicPageSpinner label={t('loading')} />;

  if (!brand || (error && !config)) {
    return (
      <div style={{ background: 'var(--ap-bg)' }}>
        <StatusCard
          standalone
          tone="error"
          title={t('cannotReschedule')}
          description={error ?? t('loadFailed')}
          actions={
            <>
              {/* The appointment being refused, in the business's timezone.
                  Without it the client has to go back to the email to work out
                  whether the notice rule even applies to them — and the time is
                  already loaded by the call above. */}
              {bookingStartTime && (
                <p
                  style={{
                    margin: '0 0 14px',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    color: 'var(--ap-text-muted)',
                  }}
                >
                  <span style={{ color: 'var(--ap-text)', fontWeight: 600 }}>
                    {t('yourBookingIs')}:
                  </span>{' '}
                  {formatPublicDate(bookingStartTime, locale, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    // The business's zone, not the reader's — the same instant
                    // is a different day either side of midnight.
                    timeZone: bookingTimezone,
                  })}
                  {', '}
                  {formatPublicTime(bookingStartTime, locale, bookingTimezone)}
                  {' · '}
                  {timeZoneLabel(bookingTimezone, locale)}
                </p>
              )}
              <BrandButton href={`/book/manage/${token}`} variant="ghost">
                {t('backToBooking')}
              </BrandButton>
            </>
          }
        />
      </div>
    );
  }

  if (rescheduled) {
    return (
      <>
        <StatusCard
          standalone
          tone="success"
          title={t('rescheduledTitle')}
          description={t('rescheduledDesc')}
          actions={
            <BrandButton href={`/book/manage/${token}`} size="lg" fullWidth>
              {t('viewUpdatedBooking')}
            </BrandButton>
          }
        >
          {newBookingTime && (
            <div
              className="p-4 text-center"
              style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
            >
              <p className="mb-1 text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                {t('newAppointmentTime')}
              </p>
              <p className="font-semibold" style={{ color: 'var(--ap-text)' }}>
                {formatNewBookingTime(newBookingTime)}
              </p>
            </div>
          )}
          <p className="mt-3 text-center text-xs" style={{ color: 'var(--ap-text-muted)' }}>
            {t('confirmationEmail')}
          </p>
        </StatusCard>
      </>
    );
  }

  if (!config) return null;

  return (
    <>
      <PortalHero
        brand={brand}
        title={t('reschedule')}
        subtitle={t('selectNewTime')}
        back={{ href: `/book/manage/${token}`, label: t('backToBooking') }}
      >
        {/* What is being replaced, as one line. It is context here, not the
            subject: the subject is the date they are about to pick. */}
        <div
          className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm"
          style={{
            background: 'var(--ap-surface)',
            border: '1px solid var(--ap-border)',
            borderRadius: 'var(--ap-radius-md)',
            color: 'var(--ap-text-muted)',
          }}
        >
          <Clock className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
          {t('currentAppointment')}
          <span className="font-semibold" style={{ color: 'var(--ap-text)' }}>
            {formatNewBookingTime(config.currentStartTime)}
          </span>
        </div>
      </PortalHero>

      <section
        className="p-5"
        style={{
          background: 'var(--ap-surface)',
          border: '1px solid var(--ap-border)',
          borderRadius: 'var(--ap-radius-lg)',
        }}
      >
        {/*
          ─────────────────────────────────────────────────────────────────────
          THE DAYS, AS A STRIP YOU PUSH SIDEWAYS.

          A month grid spends about 290px to offer the seven or eight days a
          client actually wants, and on a phone that pushed the times — the
          thing they came to choose — below the fold entirely. Ten tiles spend
          66px and show which days are closed without opening them.

          The grid is not gone. `portal.more_dates` opens it, unchanged, for
          anyone moving an appointment weeks out, and both ask the same
          question of a date, so the strip can never offer one the grid refuses.
          ─────────────────────────────────────────────────────────────────────
        */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
          {upcomingDays(10).map(date => {
            const key = dateKeyOf(date);
            const open = isDateOpen(date);
            const chosen = selectedDate === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() => open && setSelectedDate(key)}
                disabled={!open}
                aria-pressed={chosen}
                className="w-[3.25rem] shrink-0 py-2 text-center transition-colors disabled:cursor-not-allowed"
                style={{
                  borderRadius: 'var(--ap-radius-md)',
                  border: `1px solid ${chosen ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                  background: chosen ? 'var(--ap-brand)' : 'var(--ap-surface)',
                  color: chosen ? 'var(--ap-on-brand)' : 'var(--ap-text)',
                  opacity: open ? 1 : 0.36,
                }}
              >
                <span className="block text-[0.65rem]" style={{ opacity: 0.75 }}>
                  {date.toLocaleDateString(intlLocale(locale), { weekday: 'short' })}
                </span>
                <span className="block text-base font-bold leading-tight tabular-nums">
                  {date.getDate()}
                </span>
                <span className="block text-[0.6rem]" style={{ opacity: 0.75 }}>
                  {date.toLocaleDateString(intlLocale(locale), { month: 'short' })}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowAllDates(value => !value)}
            className="w-[3.25rem] shrink-0 text-[0.65rem] font-bold leading-tight transition-opacity hover:opacity-70"
            style={{
              borderRadius: 'var(--ap-radius-md)',
              border: '1px dashed var(--ap-border)',
              color: 'var(--ap-text-muted)',
              background: 'transparent',
            }}
          >
            {t(showAllDates ? 'portal.fewer_dates' : 'portal.more_dates')}
          </button>
        </div>

        {/* The full picker, unchanged, for anyone the strip cannot reach. */}
        {showAllDates && (
          <div
            className="mt-3 overflow-hidden"
            style={{
              border: '1px solid var(--ap-border)',
              borderRadius: 'var(--ap-radius-md)',
            }}
          >
        <div
          className="flex items-center justify-between p-4"
          style={{ borderBottom: '1px solid var(--ap-border)' }}
        >
          <button
            type="button"
            aria-label={t('back')}
            onClick={() =>
              setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))
            }
            className="p-2 transition-opacity hover:opacity-60"
            style={{ borderRadius: 'var(--ap-radius-sm)' }}
          >
            {/* The chevrons follow the reading direction, not the axis. */}
            {brand.dir === 'rtl' ? (
              <ChevronRight className="h-5 w-5" style={{ color: 'var(--ap-text)' }} />
            ) : (
              <ChevronLeft className="h-5 w-5" style={{ color: 'var(--ap-text)' }} />
            )}
          </button>

          <h2 className="text-base font-semibold" style={{ color: 'var(--ap-text)' }}>
            {monthLabel}
          </h2>

          <button
            type="button"
            onClick={() =>
              setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))
            }
            className="p-2 transition-opacity hover:opacity-60"
            style={{ borderRadius: 'var(--ap-radius-sm)' }}
          >
            {brand.dir === 'rtl' ? (
              <ChevronLeft className="h-5 w-5" style={{ color: 'var(--ap-text)' }} />
            ) : (
              <ChevronRight className="h-5 w-5" style={{ color: 'var(--ap-text)' }} />
            )}
          </button>
        </div>

        <div className="p-4">
          <div className="mb-2 grid grid-cols-7 gap-1">
            {t('weekdaysShort')
              .split(',')
              .map(day => (
                <div
                  key={day}
                  className="py-2 text-center text-xs font-medium"
                  style={{ color: 'var(--ap-text-muted)' }}
                >
                  {day}
                </div>
              ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {getDaysInMonth(currentMonth).map((day, index) => {
              if (day === null) return <div key={`empty-${index}`} className="aspect-square" />;

              const dateStr = formatDateString(day);
              const isSelectable = isDateSelectable(day);
              const isSelected = selectedDate === dateStr;

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => isSelectable && setSelectedDate(dateStr)}
                  disabled={!isSelectable}
                  className="aspect-square text-sm font-medium transition-colors disabled:cursor-not-allowed"
                  style={{
                    borderRadius: 'var(--ap-radius-sm)',
                    background: isSelected
                      ? 'var(--ap-brand)'
                      : isSelectable
                        ? 'transparent'
                        : 'transparent',
                    color: isSelected
                      ? 'var(--ap-on-brand)'
                      : isSelectable
                        ? 'var(--ap-text)'
                        : 'var(--ap-text-muted)',
                    opacity: isSelectable ? 1 : 0.35,
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
          </div>
        )}

        {selectedDate && (
          <div className="mt-4">
            <div
              className="mb-3 flex items-center gap-2 px-3 py-2.5"
              style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
            >
              <Calendar className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              <span className="text-sm font-semibold" style={{ color: 'var(--ap-text)' }}>
                {formatDisplayDate(selectedDate)}
              </span>
            </div>

            {loadingSlots ? (
              <div className="py-8">
                <PublicSpinner label={t('loadingTimes')} />
              </div>
            ) : slots.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--ap-text-muted)' }}>
                {t('noTimesAvailable')}
                <br />
                {t('pickAnotherDay')}
              </p>
            ) : (
              /*
                Four across on a phone, six on a wide screen — a whole day of
                availability in two short rows instead of a column of twelve.
              */
              <div className="space-y-3">
                {groupSlots(slots).map(group => (
                  <div key={group.key}>
                    <p
                      className="mb-2 text-xs font-bold"
                      style={{ color: 'var(--ap-text-muted)' }}
                    >
                      {group.label}
                    </p>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {group.slots.map(slot => {
                        const isSelected = selectedSlot?.start_time === slot.start_time;

                        return (
                          <button
                            key={slot.start_time}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            aria-pressed={isSelected}
                            // A clock time reads left-to-right in every language.
                            dir="ltr"
                            className="py-2.5 text-sm font-bold tabular-nums transition-colors"
                            style={{
                              borderRadius: 'var(--ap-radius-md)',
                              border: `1px solid ${isSelected ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                              background: isSelected ? 'var(--ap-brand)' : 'var(--ap-surface)',
                              color: isSelected ? 'var(--ap-on-brand)' : 'var(--ap-text)',
                            }}
                          >
                            {slot.display_time}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            className="mt-4 px-4 py-3"
            style={{ background: '#FEE2E2', borderRadius: 'var(--ap-radius-md)' }}
          >
            <p className="text-sm" style={{ color: '#B91C1C' }}>
              {error}
            </p>
          </div>
        )}

        {/* Which clock these hours are on. Said once, near the times, because
            "09:00" to somebody in another country is an invitation to arrive at
            the wrong hour. */}
        <p className="mt-4 text-center text-xs" style={{ color: 'var(--ap-text-muted)' }}>
          {t('timesShownIn', { zone: timeZoneLabel(bookingTimezone, locale) })}
        </p>
      </section>

      {/*
        ───────────────────────────────────────────────────────────────────────
        THE DECISION, DOCKED.

        It restates what is being changed and to what, right beside the button.
        Confirming a time you can no longer see — because choosing it scrolled
        it off the screen — is how a client books the wrong hour.

        Sticky, so it is reachable from anywhere in the day's times rather than
        only from the bottom of them.
        ───────────────────────────────────────────────────────────────────────
      */}
      <div
        className="sticky bottom-0 z-10 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6"
        style={{
          background: 'var(--ap-bg)',
          borderTop: '1px solid var(--ap-border)',
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 text-xs" style={{ color: 'var(--ap-text-muted)' }}>
            {selectedSlot ? (
              <>
                {t('portal.change_to')}
                <span
                  className="block truncate text-sm font-bold"
                  style={{ color: 'var(--ap-text)' }}
                >
                  {formatNewBookingTime(selectedSlot.start_time)}
                </span>
              </>
            ) : (
              t('selectNewTime')
            )}
          </div>

          <BrandButton
            size="lg"
            loading={rescheduling}
            disabled={!selectedSlot}
            onClick={handleReschedule}
          >
            {!rescheduling && <Clock className="h-4 w-4" aria-hidden />}
            {rescheduling ? t('rescheduling') : t('confirmNewTime')}
          </BrandButton>
        </div>
      </div>
    </>
  );
}
