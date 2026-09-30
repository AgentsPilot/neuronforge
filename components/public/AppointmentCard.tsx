// components/public/AppointmentCard.tsx

import { Calendar, Clock } from 'lucide-react';

import { formatPublicDate, formatPublicMoney, formatPublicTime, publicT } from '@/lib/i18n/public-pages';
import type { PublicBrand } from '@/lib/branding/publicBranding';

export interface PublicBookingSummary {
  /**
   * Null for a PRODUCT purchase, which has no slot.
   *
   * `scheduling_bookings.start_time` was made nullable by
   * `20260803_allow_null_booking_times.sql`; this type still said `string`, so
   * `new Date(booking.startTime)` below was handed a null, produced the Unix
   * epoch, and the client was shown "1 January 1970" as their appointment date.
   */
  startTime: string | null;
  endTime: string | null;
  timezone?: string | null;
  service?: {
    service_name?: string | null;
    description?: string | null;
    duration_minutes?: number | null;
    price?: number | null;
    currency?: string | null;
  } | null;
}

interface AppointmentCardProps {
  booking: PublicBookingSummary;
  brand: PublicBrand;
  variant?: 'full' | 'summary';
  /** Dims the card — used to show the appointment being replaced. */
  muted?: boolean;
}

/**
 * When the appointment is, and what it is for.
 *
 * The same block appeared on all four booking-management pages with four
 * different date formats: the hub printed the business's locale, cancel
 * hardcoded `en-US` with a 12-hour clock, and the two disagreed about the same
 * appointment one click apart. Formatting lives in `public-pages` now, so there
 * is one answer.
 */
export function AppointmentCard({
  booking,
  brand,
  variant = 'full',
  muted = false,
}: AppointmentCardProps) {
  const { locale, currency } = brand;
  const t = (key: string) => publicT(locale, key);

  /*
   * A product purchase has no time, and must not be given one.
   *
   * `new Date(null)` is the epoch, so this used to render 1 January 1970 into
   * the date row of a confirmation the client had just received for something
   * with no date at all.
   */
  const start = booking.startTime ? new Date(booking.startTime) : null;
  const end = booking.endTime ? new Date(booking.endTime) : null;
  const timeZone = booking.timezone ?? undefined;

  const price = booking.service?.price;
  const hasPrice = typeof price === 'number' && price > 0;

  return (
    <section
      className={variant === 'full' ? 'p-5' : 'p-4'}
      style={{
        background: muted ? 'var(--ap-surface-2)' : 'var(--ap-surface)',
        border: '1px solid var(--ap-border)',
        borderRadius: 'var(--ap-radius-lg)',
        boxShadow: muted ? 'none' : 'var(--ap-shadow-sm)',
        opacity: muted ? 0.75 : 1,
      }}
    >
      {booking.service?.service_name && (
        <h2
          className={variant === 'full' ? 'text-lg font-bold' : 'text-base font-semibold'}
          style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
        >
          <bdi>{booking.service.service_name}</bdi>
        </h2>
      )}

      {variant === 'full' && booking.service?.description && (
        <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
          <bdi>{booking.service.description}</bdi>
        </p>
      )}

      {/* No panel at all without a time. An order has a service and a price;
          drawing an empty date row for it would invite the reader to look for a
          date that does not exist. */}
      {start && (
        <div
          className="mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6"
          style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
        >
          <div className="flex items-center gap-2.5">
            <Calendar className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
            <span className="text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
              {formatPublicDate(start, locale)}
            </span>
          </div>

          {end && (
            <div className="flex items-center gap-2.5">
              <Clock className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              {/* A time range is left-to-right in every language: mirrored, `09:00
                  - 10:00` becomes a different range. */}
              <span dir="ltr" className="text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
                {formatPublicTime(start, locale, timeZone)}
                {' – '}
                {formatPublicTime(end, locale, timeZone)}
              </span>
            </div>
          )}
        </div>
      )}

      {(booking.service?.duration_minutes || hasPrice) && (
        <div
          className="mt-3 flex items-center gap-4 text-sm"
          style={{ color: 'var(--ap-text-muted)' }}
        >
          {booking.service?.duration_minutes ? (
            <span>
              {booking.service.duration_minutes} {t('min')}
            </span>
          ) : null}
          {hasPrice && (
            <span className="font-semibold" style={{ color: 'var(--ap-text)' }}>
              {formatPublicMoney(price, booking.service?.currency || currency, locale)}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
