// components/public/AppointmentCard.tsx

import { Calendar, Clock, Hourglass, Wallet } from 'lucide-react';
import { BrandButton } from '@/components/public/BrandButton';

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
  /**
   * The appointment's own state, as a chip on the card.
   *
   * It used to float on its own centred line ABOVE the card, which spent a row
   * of the screen to say one word and left the reader to connect it to the
   * thing below. On the card it is attached to what it describes.
   *
   * The colours are semantic and come from the caller, not from the brand: a
   * cancelled appointment has to read as cancelled even when the business's own
   * colour happens to be green.
   */
  badge?: { label: string; bg: string; fg: string } | null;
  /**
   * `scheduling_bookings.payment_status`, when the caller has it.
   *
   * Opt-in, so the pages that show an appointment ABOUT to change (reschedule,
   * cancel) are not altered by passing a booking through. Where it is given,
   * the price stops being a bare number: a client who has already paid should
   * not have to wonder whether ₪300 is a receipt or a bill.
   */
  paymentStatus?: string | null;
  /**
   * What is actually owed or has been paid, however this booking was sold.
   *
   * The price above comes from the SERVICE, which is zero or meaningless for
   * most of what a business sells: a consultation quoted at ₪450, an
   * appointment invoiced to be paid later, a product on a six-period plan. This
   * is derived from the invoices and the plan, so the client is told the figure
   * that applies to them rather than a list price nobody is charging.
   */
  payment?: {
    state: 'paid' | 'due' | 'refunded' | 'none';
    amount: number | null;
    currency: string | null;
    dueDate: string | null;
    overdue: boolean;
    plan: { paid: number; total: number } | null;
    /**
     * Where this client can settle it.
     *
     * Absent when nothing is owed, when the only outstanding thing is a quote
     * stage not yet invoiced, or when the invoice turns out to be settled after
     * all — in every one of those a button would be a dead end or a demand for
     * money already paid.
     */
    payUrl?: string | null;
  } | null;
  /**
   * What a client can DO with this appointment, rendered inside the card.
   *
   * The actions were two full-width blocks stacked under it, 112px of screen
   * for two taps. Belonging to the booking, they belong to its card.
   */
  children?: React.ReactNode;
}

/**
 * What the price says about itself.
 *
 * Only the two states that are FACTS about money that moved. `pending` says
 * nothing: a booking the owner never meant to charge for sits there for ever,
 * and stamping "payment due" on it would invent a demand the business never
 * made.
 */
const PAYMENT_STAMP: Record<string, { key: string; fg: string }> = {
  paid: { key: 'paid', fg: '#15803D' },
  refunded: { key: 'refunded', fg: '#4B5563' },
};

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
  badge = null,
  paymentStatus = null,
  payment = null,
  children,
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
  const minutes = booking.service?.duration_minutes;
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE ANSWER ABOUT THE MONEY, NOT TWO.
   *
   * The stamp used to read `scheduling_bookings.payment_status` while the line
   * below it read the state the route DERIVES from the invoices and the plan.
   * Those are two sources, and they disagree: one booking on the reporting
   * account carries a paid invoice and an overdue one, and its row still says
   * `paid` — so the card stamped a green PAID beside "₪300 to pay, overdue".
   *
   * The derived state wins wherever it is supplied, because it is the one
   * computed from what actually happened. A booking with anything outstanding
   * is not stamped paid, however its own column reads.
   *
   * `payment_status` remains the fallback for callers that have no derived
   * state to give — it is still right for a booking with no invoices at all.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const settledState = payment ? (payment.state === 'paid' || payment.state === 'refunded' ? payment.state : null) : paymentStatus;
  const stamp = settledState ? PAYMENT_STAMP[settledState] : undefined;

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
      {(booking.service?.service_name || badge) && (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {booking.service?.service_name && (
              <h2
                className={variant === 'full' ? 'text-lg font-bold' : 'text-base font-semibold'}
                style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
              >
                <bdi>{booking.service.service_name}</bdi>
              </h2>
            )}

            {/*
              The description, unless it merely repeats the name.

              Both columns are free text and a business filling in a service
              quickly puts the same words in each — "הצעת מחיר לשיפוץ" above
              "הצעת מחיר לשיפוץ", which reads as a rendering fault rather than
              as a description.
            */}
            {variant === 'full' &&
              booking.service?.description &&
              booking.service.description.trim() !== booking.service.service_name?.trim() && (
              <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
                <bdi>{booking.service.description}</bdi>
              </p>
            )}
          </div>

          {badge && (
            <span
              className="shrink-0 whitespace-nowrap px-2.5 py-1 text-xs font-bold"
              style={{ background: badge.bg, color: badge.fg, borderRadius: '9999px' }}
            >
              {badge.label}
            </span>
          )}
        </div>
      )}

      {/*
        ── THE FACTS OF THE APPOINTMENT, in one panel ──────────────────────────
        When, how long, and how much, together: a client reads them as one
        answer, and the duration and the price used to sit loose beneath the
        card where they read as a footnote to it.

        Each fact appears only when it is true. A PRODUCT purchase has no slot
        and must not be given one — `new Date(null)` is the epoch, and this card
        once printed 1 January 1970 as an appointment date — but it does have a
        price, so the panel is drawn for whatever is real rather than only when
        there is a time in it.
      */}
      {(start || minutes || hasPrice) && (
        <div
          className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center"
          style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
        >
          {start && (
            <div className="flex items-center gap-2.5">
              <Calendar className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              <span className="text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
                {formatPublicDate(start, locale)}
              </span>
            </div>
          )}

          {start && end && (
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

          {minutes ? (
            <div className="flex items-center gap-2.5">
              <Hourglass className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              {/* The number and its unit are one quantity: unwrapped, the bidi
                  algorithm is free to put `60` on the far side of `דק׳`. */}
              <bdi className="text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
                {minutes} {t('min')}
              </bdi>
            </div>
          ) : null}

          {hasPrice && (
            /*
             * No `ms-auto` here.
             *
             * Pushing the price to the end of the row looks deliberate until the
             * row wraps: on the narrow cancel page the four facts did not fit,
             * and the price dropped to a second line ALONE at the opposite edge,
             * reading as something left over rather than part of the set. These
             * are four facts of equal standing, so they flow as four facts.
             */
            <div className="flex items-center gap-2.5">
              <Wallet className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              <bdi className="text-sm font-semibold" style={{ color: 'var(--ap-text)' }}>
                {formatPublicMoney(price, booking.service?.currency || currency, locale)}
              </bdi>

              {stamp && (
                /* Outlined, not filled: this sits on the brand tint, and a
                   pastel pill on a pastel ground reads as a smudge. */
                <span
                  className="px-2 py-0.5 text-xs font-semibold"
                  style={{
                    color: stamp.fg,
                    background: 'var(--ap-surface)',
                    border: `1px solid ${stamp.fg}40`,
                    borderRadius: '9999px',
                  }}
                >
                  {t(stamp.key)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/*
        ── WHAT IS OWED, OR WHAT WAS PAID ──────────────────────────────────────
        Shown for every kind of booking, including the ones whose service has no
        price of its own. A sum still owed leads with the amount and its
        deadline, because that is the thing a client has to act on; a plan says
        how far through it they are; money already settled or returned is stated
        once and quietly.
      */}
      {payment && payment.state !== 'none' && (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          style={{ color: 'var(--ap-text-muted)' }}
        >
          {payment.state === 'due' && (
            <>
              <span className="font-semibold" style={{ color: '#B45309' }}>
                {t('portal.to_pay')}{' '}
                <bdi>
                  {formatPublicMoney(payment.amount ?? 0, payment.currency || currency, locale)}
                </bdi>
              </span>

              {payment.dueDate && (
                <span style={{ color: payment.overdue ? '#B91C1C' : 'var(--ap-text-muted)' }}>
                  {payment.overdue
                    ? t('portal.overdue')
                    : t('portal.due_by').replace(
                        '{date}',
                        formatPublicDate(new Date(payment.dueDate), locale, {
                          day: 'numeric',
                          month: 'long',
                        })
                      )}
                </span>
              )}

              {/*
                BESIDE THE AMOUNT, not in a section of its own.
                ──────────────────────────────────────────────────────────────
                This line already told the client what they owe and whether it
                is late; what it never did was let them do anything about it.
                The button belongs on the same line as the figure it settles —
                a separate payment panel would read as a second, different
                demand.

                Rendered only when there is an invoice behind it. An unbilled
                quote stage has nothing to pay against, and says so below
                instead — a figure with no button and no explanation reads as a
                broken page, which is how this was reported.
              */}
              {!payment.payUrl && (
                <span style={{ color: 'var(--ap-text-muted)' }}>{t('portal.not_billed_yet')}</span>
              )}

              {payment.payUrl && (
                <BrandButton href={payment.payUrl} size="sm">
                  {t('portal.pay_now')}
                </BrandButton>
              )}
            </>
          )}

          {payment.state === 'paid' && !hasPrice && (
            <span className="font-semibold" style={{ color: '#15803D' }}>
              {t('paid')}
              {payment.amount ? (
                <>
                  {' · '}
                  <bdi>
                    {formatPublicMoney(payment.amount, payment.currency || currency, locale)}
                  </bdi>
                </>
              ) : null}
            </span>
          )}

          {payment.state === 'refunded' && !hasPrice && (
            <span className="font-semibold">{t('refunded')}</span>
          )}

          {/* "2 of 6 made" — the question anyone on a plan is actually asking. */}
          {payment.plan && payment.plan.total > 1 && (
            <span>
              {t('portal.plan_progress')
                .replace('{paid}', String(payment.plan.paid))
                .replace('{total}', String(payment.plan.total))}
            </span>
          )}
        </div>
      )}

      {children}
    </section>
  );
}
