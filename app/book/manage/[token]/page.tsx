'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarPlus, ClipboardCheck, ClipboardList, FileText, Hourglass, Mail, RefreshCw, User, X } from 'lucide-react';

/*
 * The TYPE only.
 *
 * The index draws its own tiles rather than rendering `AppointmentCard`: the
 * card is one block that states the appointment and its money together, which
 * is right on cancel and intake — a single task, read once — and wrong here,
 * where the money is its own tile beside the appointment. The shape of a
 * booking is still the card's to define, so the three screens cannot drift
 * apart on what a booking is.
 */
import type {
  PortalBooking,
  PortalIntake,
  PortalPackageMeeting,
  PortalPayment,
  PortalQuote,
} from '@/types/portal';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
import { StatusCard } from '@/components/public/StatusCard';
import { BusinessInfoPanel } from '@/components/public/BusinessInfoPanel';
import { IntakePanel } from '@/components/public/IntakePanel';
import { PortalMeetings } from '@/components/public/PortalMeetings';
import { usePortalContext } from '@/components/public/PortalContextProvider';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT, formatPublicDate, formatPublicMoney } from '@/lib/i18n/public-pages';

/*
 * The shapes come from `types/portal.ts`, which the ROUTE also annotates its
 * response with, so the two cannot drift. They were declared by hand here
 * until they had: the route emitted `plan.periods[].label` and this page
 * rendered it, while the copy of the type here never admitted it existed.
 */
/**
 * What a client sees when they open the link in their confirmation email.
 *
 * The branding, language and direction now arrive from the segment layout,
 * resolved on the server from the token — so this page no longer paints a grey
 * skeleton and then repaints itself once it has learned whose booking it is.
 * All it fetches is the booking.
 */
export default function BookingManagePage() {
  const params = useParams();
  const token = params.token as string;
  const brand = useOptionalPublicBrand();
  const portal = usePortalContext();

  const [booking, setBooking] = useState<PortalBooking | null>(null);
  /** The other meetings, when this booking is one of a package. */
  const [meetings, setMeetings] = useState<PortalPackageMeeting[]>([]);
  const [quote, setQuote] = useState<PortalQuote | null>(null);
  const [awaitingQuote, setAwaitingQuote] = useState(false);
  const [intake, setIntake] = useState<PortalIntake | null>(null);
  const [payment, setPayment] = useState<PortalPayment | null>(null);
  const [loading, setLoading] = useState(true);
  /** The questions, unfolded in place rather than on a page of their own. */
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locale = brand?.locale ?? 'en';
  const t = createPublicT(locale);
  /* The business's language for the dates, and the business's zone below them:
     the hour a client turns up at is the business's, not their device's. */
  const intlLocale = brand?.localeCode ?? 'en-US';

  useEffect(() => {
    fetch(`/api/book/manage/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setBooking(data.booking);
          setMeetings(Array.isArray(data.meetings) ? data.meetings : []);
          setQuote(data.quote ?? null);
          setAwaitingQuote(Boolean(data.awaitingQuote));
          setIntake(data.intake ?? null);
          setPayment(data.payment ?? null);
        }
        else setError(data.error || t('bookingNotFound'));
      })
      .catch(() => setError(t('bookingNotFound')))
      .finally(() => setLoading(false));
    // The token is the only input; re-running on locale change would refetch
    // for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loading) return <PublicPageSpinner label={t('loading')} />;

  if (error || !booking || !brand) {
    return (
      <StatusCard
        standalone
        tone="error"
        title={t('bookingNotFound')}
        description={t('bookingNotFoundDesc')}
      />
    );
  }

  const isCancelled = booking.status === 'cancelled';

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THE CHIP SAYS, FOR EVERY STATUS A BOOKING CAN HAVE.
   *
   * It read `cancelled`, `confirmed`, or else `pending` — so a COMPLETED
   * appointment, which is most of what a long-standing client has, was labelled
   * "awaiting". Someone looking at a session they attended and paid for a month
   * ago was told it was still waiting on them.
   *
   * `no_show` is the business's word and a judgement; the client is told the
   * thing that is true for both of them, which is that it did not take place.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const STATUS_CHIP: Record<string, { key: string; tone: 'success' | 'error' | 'warning' | 'muted' }> = {
    cancelled: { key: 'cancelled', tone: 'error' },
    confirmed: { key: 'confirmed', tone: 'success' },
    completed: { key: 'portal.held', tone: 'muted' },
    no_show: { key: 'portal.missed', tone: 'muted' },
    pending: { key: 'pending', tone: 'warning' },
  };

  /**
   * What a quote's status means to the CLIENT, and whether it is still live.
   *
   * `superseded` never reaches here — the route takes the newest — and anything
   * unrecognised falls back to "waiting for your answer", the one state where
   * saying the wrong thing cannot mislead: the quote is open and the client can
   * read it for themselves.
   */
  const QUOTE_STATE: Record<string, { key: string; open?: boolean }> = {
    draft: { key: 'portal.quote_waiting', open: false },
    sent: { key: 'portal.quote_sent' },
    viewed: { key: 'portal.quote_sent' },
    accepted: { key: 'portal.quote_accepted' },
    declined: { key: 'portal.quote_declined', open: false },
    withdrawn: { key: 'portal.quote_closed', open: false },
    stopped: { key: 'portal.quote_closed', open: false },
    expired: { key: 'portal.quote_expired', open: false },
  };

  const chip = STATUS_CHIP[booking.status] ?? STATUS_CHIP.pending;
  const statusTone = chip.tone;
  const statusLabel = t(chip.key);

  // Semantic, not brand: a cancelled appointment has to read as cancelled even
  // when the business's own colour happens to be green.
  const STATUS_COLORS = {
    success: { bg: '#DCFCE7', fg: '#15803D' },
    error: { bg: '#FEE2E2', fg: '#B91C1C' },
    warning: { bg: '#FEF3C7', fg: '#B45309' },
    // Something that already happened is a fact, not a state to act on.
    muted: { bg: '#F1F0F3', fg: '#5B5268' },
  } as const;
  const status = STATUS_COLORS[statusTone];

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE PORTAL: cards, on the grid the shell opens.
   *
   * Two tracks on a desktop, one on a phone, and every card in the same place
   * on every screen in the section. A card that does not apply to this booking
   * is not rendered and the rest close up; none of them ever moves relative to
   * the others. `publicCardsKeepTheirPlace.guard` holds that.
   *
   * Tasks open HERE rather than on pages of their own: the intake form is the
   * component `/intake` also mounts, so a client who opens it from their email
   * and one who opens it from this page see the same thing. That is the same
   * arrangement `/quote` has always had with `ProposalAnswer`.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const firstName = booking.clientName?.trim().split(/\s+/)[0] ?? '';
  const start = booking.startTime ? new Date(booking.startTime) : null;

  const money = (amount: number, currency?: string | null) =>
    formatPublicMoney(amount, currency || brand.currency, locale);

  const clock = (value: Date) =>
    value.toLocaleTimeString(intlLocale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: booking.timezone ?? undefined,
    });

  const end = booking.endTime ? new Date(booking.endTime) : null;
  /* Measured from the END, so a meeting still running is not already past. */
  const hasFinished = (end ?? start) !== null && (end ?? start)!.getTime() < Date.now();
  const periods = payment?.plan?.periods ?? [];

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT A PERIOD'S STATUS SAYS, FOR ALL FIVE OF THEM.
   *
   * `payment_plan_installments.status` is
   * `pending | billed | paid | overdue | cancelled`
   * (lib/repositories/PaymentPlanRepository.ts:55), and this rendered
   * `status === 'paid' ? paid : to_pay` — so a client whose instalment was
   * already INVOICED, was OVERDUE, or had been CANCELLED outright saw the same
   * flat "to pay" chip as one not yet due. Overdue is the one that matters
   * most and was the one hidden hardest.
   *
   * The column is plain TEXT with no CHECK and has carried values the union
   * did not know about, so an unrecognised status falls back to "to pay"
   * rather than rendering a raw database word at a client.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const PERIOD_CHIP: Record<string, { key: string; bg: string; fg: string }> = {
    paid: { key: 'paid', bg: 'var(--ap-brand-tint)', fg: 'var(--ap-brand)' },
    billed: { key: 'portal.billed', bg: 'var(--ap-surface-2)', fg: 'var(--ap-text)' },
    overdue: { key: 'overdue', bg: 'var(--ap-danger-tint)', fg: 'var(--ap-danger)' },
    cancelled: { key: 'cancelled', bg: 'var(--ap-surface-2)', fg: 'var(--ap-text-muted)' },
    pending: { key: 'portal.to_pay', bg: 'var(--ap-surface-2)', fg: 'var(--ap-text-muted)' },
  };
  const periodChip = (status: string) => PERIOD_CHIP[status] ?? PERIOD_CHIP.pending;
  /* A booking with nothing to pay says nothing about money rather than
     printing a zero, which reads as a bill for nothing. */
  const hasMoney = Boolean(payment && payment.state !== 'none');

  /*
   * The index's own grid. The shell stacks whatever a screen hands it, so the
   * four task screens are unaffected; only this one asks for tiles.
   */
  return (
    <>
      {/*
        An h2, not an h1: the business's name in the bar is this page's only
        level-one heading, which `headingRank.guard` enforces across all five
        public pages.
      */}
      <div>
        {/*
          ───────────────────────────────────────────────────────────────────
          BOOKING AGAIN BELONGS TO THE PAGE, NOT TO A BOOKING.

          It sat on the appointment card, which put it on every booking a
          client opened and made it read as "book another of this one" — next
          to a card that already carries Reschedule and Cancel, which DO act on
          that appointment. Three buttons, one of them meaning something else.

          Beside the greeting it is plainly about the client and the business:
          one per page, nowhere near the actions that change a specific
          appointment. It does not hang off `canReschedule` either, because
          booking again is refused by nothing — that was the reason it was
          added, and it still holds; only its place was wrong.
          ───────────────────────────────────────────────────────────────────
        */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            className="text-2xl font-bold"
            style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
          >
            {firstName ? t('portal.greeting').replace('{name}', firstName) : t('manageBooking')}
          </h2>

          {brand.info?.bookingUrl && (
            <a
              href={brand.info.bookingUrl}
              className="flex h-10 items-center gap-2 px-4 text-sm font-bold transition-opacity hover:opacity-85"
              style={{
                background: 'var(--ap-brand)',
                color: 'var(--ap-on-brand)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden />
              {t('portal.book_another')}
            </a>
          )}
        </div>
      </div>


      {/*
        ─────────────────────────────────────────────────────────────────────
        TWO COLUMNS, EACH ONE A STACK OF ITS OWN.

        This was a single four-track grid, and a grid could not give the page
        what it needed. Rows align across the whole width, so either every card
        stretches to the tallest in its row — which turned a three-line payment
        card into a block of empty brand colour — or none does and a card that
        spans two rows leaves a hole under it. Both shipped.

        Two independent columns have neither problem: nothing in the right
        column has any say over the height of anything in the left. The right
        carries the booking and what follows from it; the left carries the
        money, then the quote and the client, then how to reach the business.
        ─────────────────────────────────────────────────────────────────────
      */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
      {/*
        ── THE APPOINTMENT: the lead tile ───────────────────────────────────
        Two tracks wide and two rows tall, tinted, with the day of the month as
        the thing the eye lands on. It carries no money: that is the tile
        beside it, so one number is not stated in two places.
      */}
      <section
        className="min-w-0 p-6"
        style={{
          /*
            The brand's SECONDARY, which is what gives this business's pages
            their blush: `--ap-brand-tint` is derived from the primary, so a
            gradient built on it came out all but white and the lead tile read
            as another plain card.

            Mixed rather than used neat, because a secondary is not always pale
            — a brand whose secondary is a saturated violet would make this
            unreadable at full strength — and `backgroundColor` stays behind it
            so a browser without `color-mix` simply gets the flat tint rather
            than no background at all.
          */
          backgroundColor: 'var(--ap-brand-tint)',
          backgroundImage:
            'linear-gradient(145deg, color-mix(in srgb, var(--ap-brand-secondary) 55%, var(--ap-surface)) 0%, var(--ap-surface) 62%)',
          border: '1px solid var(--ap-border)',
          borderRadius: 'var(--ap-radius-lg)',
          opacity: isCancelled ? 0.75 : 1,
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {/*
            "Your next appointment" only when it IS still ahead.

            This said it whenever a booking had a date at all, so the page a
            client opens the morning after their session greeted them with
            "your next appointment" above a card stamped "took place" — the
            banner and the card contradicting each other about the same
            booking. `end_time` decides, not the start: a meeting is not in the
            past while it is still running.
          */}
          {!isCancelled && start && !hasFinished && (
            <span
              className="px-2.5 py-1 text-xs font-bold"
              style={{
                background: 'var(--ap-surface)',
                color: 'var(--ap-text-muted)',
                borderRadius: '9999px',
              }}
            >
              {t('portal.next_is')}
            </span>
          )}
          <span
            className="px-2.5 py-1 text-xs font-bold"
            style={{ background: status.bg, color: status.fg, borderRadius: '9999px' }}
          >
            {statusLabel}
          </span>
        </div>

        {/* A product purchase has no date and must not be given one. */}
        {start && (
          <>
            <div
              className="mt-3 text-6xl font-bold tabular-nums"
              style={{
                color: 'var(--ap-text)',
                fontFamily: 'var(--ap-font-heading)',
                letterSpacing: '-0.04em',
                lineHeight: 1,
              }}
            >
              {start.toLocaleString(intlLocale, {
                day: 'numeric',
                timeZone: booking.timezone ?? undefined,
              })}
            </div>
            <div
              className="mt-2 text-xl font-bold"
              style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
            >
              {formatPublicDate(start, locale, undefined, booking.timezone)}
            </div>
            {/* The zone said out loud, because the hour a client turns up at is
                the business's and not their device's. */}
            <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
              <bdi>
                {clock(start)}
                {end ? ` – ${clock(end)}` : ''}
                {booking.timezone ? ` (${booking.timezone})` : ''}
              </bdi>
            </p>
          </>
        )}

        <dl
          className="mt-5 space-y-2.5 border-t pt-4 text-sm"
          style={{ borderColor: 'var(--ap-border)' }}
        >
          {booking.service?.service_name && (
            <div className="flex items-baseline justify-between gap-4">
              <dt style={{ color: 'var(--ap-text-muted)' }}>{t('portal.service')}</dt>
              <dd className="font-semibold" style={{ color: 'var(--ap-text)' }}>
                <bdi>{booking.service.service_name}</bdi>
              </dd>
            </div>
          )}
          {typeof booking.service?.duration_minutes === 'number' && (
            <div className="flex items-baseline justify-between gap-4">
              <dt style={{ color: 'var(--ap-text-muted)' }}>{t('portal.duration')}</dt>
              <dd className="font-semibold tabular-nums" style={{ color: 'var(--ap-text)' }}>
                {booking.service.duration_minutes} {t('min')}
              </dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4">
            <dt style={{ color: 'var(--ap-text-muted)' }}>{t('portal.status')}</dt>
            <dd className="font-semibold" style={{ color: 'var(--ap-text)' }}>
              {statusLabel}
            </dd>
          </div>
        </dl>

        {/*
          WHAT THE BUSINESS WROTE ABOUT THIS APPOINTMENT.

          `booking.notes` has been in this page's data since it was written and
          was never rendered anywhere. It is where "bring the measurements" or
          "parking is in the yard" lives, and the client is the one person it
          was written for. `whitespace-pre-line` because it is typed by hand and
          the line breaks are meant.
        */}
        {booking.notes?.trim() && (
          <div
            className="mt-4 p-4"
            style={{
              background: 'var(--ap-surface)',
              border: '1px solid var(--ap-border)',
              borderRadius: 'var(--ap-radius-md)',
            }}
          >
            <h3 className="text-xs font-bold" style={{ color: 'var(--ap-text-muted)' }}>
              {t('notes')}
            </h3>
            <p
              className="mt-1 whitespace-pre-line text-sm"
              style={{ color: 'var(--ap-text)' }}
            >
              <bdi>{booking.notes}</bdi>
            </p>
          </div>
        )}

        {/*
          A package's meetings are each moved and cancelled on their own token
          below, so one pair of buttons here would act on the first meeting
          while looking like it acted on the block.
        */}
        {!isCancelled && meetings.length === 0 && booking.canReschedule && (
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/api/book/manage/${token}/calendar`}
              className="flex h-11 items-center gap-2 px-4 text-sm font-bold transition-opacity hover:opacity-85"
              style={{
                background: 'var(--ap-brand)',
                color: 'var(--ap-on-brand)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden />
              {t('portal.add_to_calendar')}
            </a>
            <a
              href={`/reschedule/${token}`}
              className="flex h-11 items-center gap-2 px-4 text-sm font-bold transition-opacity hover:opacity-70"
              style={{
                border: '1px solid var(--ap-border)',
                background: 'var(--ap-surface)',
                color: 'var(--ap-text)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              <RefreshCw className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              {t('reschedule')}
            </a>
            <a
              href={`/book/manage/${token}/cancel`}
              className="flex h-11 items-center gap-2 px-4 text-sm font-bold transition-opacity hover:opacity-70"
              style={{
                border: '1px solid var(--ap-border)',
                background: 'var(--ap-surface)',
                color: '#B3453C',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              <X className="h-4 w-4" aria-hidden />
              {t('cancel')}
            </a>
          </div>
        )}
      </section>


      {/*
        ── THE WHOLE BLOCK, when this is one meeting of a package ────────────
        Each is cancelled or moved on its own token under the SAME notice
        window a single booking is judged by. The server decides: `canModify`
        is its answer and `tooSoon` is why it said no, so this never offers an
        action that is about to be refused.
      */}
      {meetings.length > 0 && (
        <section className="apc-panel p-5">
          <h3 className="mb-3 text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
            {t('manage.package_title').replace('{count}', String(meetings.length))}
          </h3>

          <ol className="flex flex-col">
            {meetings.map((meeting, index) => {
              const held = meeting.status === 'completed';
              const off = meeting.status === 'cancelled' || meeting.status === 'no_show';
              const when = meeting.startTime ? new Date(meeting.startTime) : null;

              return (
                <li
                  key={meeting.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t py-2.5 first:border-t-0"
                  style={{ borderColor: 'var(--ap-border)' }}
                >
                  {/* The date as a block: every row of a package shares one
                      service name, so the day is the only thing telling them
                      apart and it cannot be the smallest thing on the row. */}
                  <span
                    className="flex h-11 w-11 shrink-0 flex-col items-center justify-center leading-none"
                    style={{
                      background: meeting.isCurrent
                        ? 'var(--ap-brand)'
                        : 'var(--ap-surface-2)',
                      color: meeting.isCurrent ? 'var(--ap-on-brand)' : 'var(--ap-text)',
                      borderRadius: 'var(--ap-radius-md)',
                    }}
                  >
                    {when ? (
                      <>
                        <span className="text-sm font-bold tabular-nums">
                          {when.toLocaleString(intlLocale, {
                            day: 'numeric',
                            timeZone: booking.timezone ?? undefined,
                          })}
                        </span>
                        <span className="mt-0.5 text-[10px] font-semibold opacity-75">
                          {when.toLocaleString(intlLocale, {
                            month: 'short',
                            timeZone: booking.timezone ?? undefined,
                          })}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm">—</span>
                    )}
                  </span>

                  <span className="min-w-0">
                    <span
                      className="block text-sm font-semibold"
                      style={{
                        color: off ? 'var(--ap-text-muted)' : 'var(--ap-text)',
                        textDecoration: off ? 'line-through' : undefined,
                      }}
                    >
                      {meeting.occurrenceNumber ?? index + 1}
                      {booking.service?.service_name ? ' · ' : ''}
                      <bdi>{booking.service?.service_name ?? ''}</bdi>
                    </span>
                    <span className="block text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                      {when ? clock(when) : '—'}
                      {held ? ` · ${t('manage.package_held')}` : ''}
                      {off ? ` · ${t('manage.package_cancelled')}` : ''}
                    </span>
                  </span>

                  {meeting.canModify && (
                    <span className="ms-auto flex items-center gap-2">
                      <a
                        href={`/reschedule/${meeting.token}`}
                        className="rounded-full border px-3 py-1 text-xs font-medium"
                        style={{ borderColor: 'var(--ap-border)', color: 'var(--ap-text)' }}
                      >
                        {t('reschedule')}
                      </a>
                      <a
                        href={`/book/manage/${meeting.token}/cancel`}
                        className="rounded-full border px-3 py-1 text-xs font-medium"
                        style={{ borderColor: 'var(--ap-border)', color: 'var(--ap-text-muted)' }}
                      >
                        {t('cancel')}
                      </a>
                    </span>
                  )}

                  {/* Said, not hidden: a client who cannot act needs to know
                      why, and that the business is the way through. */}
                  {meeting.tooSoon && (
                    <span className="ms-auto text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                      {t('manage.package_too_soon')}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}


          {portal && (
            <PortalMeetings brand={brand} meetings={portal.meetings} timeZone={portal.timeZone} />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Side by side: neither is more than a few lines. */}
          <div className="grid gap-3 sm:grid-cols-2">
      {/*
        ── THE MONEY, ONCE ──────────────────────────────────────────────────
        Read from the state the ROUTE derives from the invoices and the plan,
        never from `booking.paymentStatus`: that column disagrees with reality
        on exactly the bookings this tile matters for, which is why the derived
        state exists at all.

        Solid brand, because it is the one figure most clients open this page
        to check.
      */}
      {hasMoney && payment && (
        <section
          className="flex flex-col p-5"
          style={{
            background: 'var(--ap-brand)',
            color: 'var(--ap-on-brand)',
            borderRadius: 'var(--ap-radius-lg)',
          }}
        >
          <h3 className="text-xs font-bold" style={{ opacity: 0.8 }}>
            {t('portal.payment')}
          </h3>
          <p
            className="mt-1 text-3xl font-bold tabular-nums"
            style={{ fontFamily: 'var(--ap-font-heading)', letterSpacing: '-0.02em' }}
          >
            <bdi>{money(payment.amount ?? 0, payment.currency)}</bdi>
          </p>
          <p className="mt-0.5 text-sm font-bold">
            {payment.state === 'paid'
              ? t('paid')
              : payment.state === 'refunded'
                ? t('refunded')
                : payment.overdue
                  ? t('portal.overdue')
                  : t('portal.to_pay')}
          </p>

          {/*
            The rule and the list appear only when something sits under them.
            Rendered unconditionally this drew a divider across the card and a
            block of empty brand colour beneath it, on every booking with no
            due date and no refund, which is most of them.
          */}
          {(payment.dueDate ||
            (typeof payment.refunded === 'number' && payment.refunded > 0)) && (
          <dl
            className="mt-4 space-y-1.5 border-t pt-3 text-sm"
            style={{ borderColor: 'rgba(255,255,255,0.28)' }}
          >
            {payment.dueDate && (
              <div className="flex items-baseline justify-between gap-3">
                <dt style={{ opacity: 0.85 }}>{t('portal.due_by').replace('{date}', '')}</dt>
                <dd className="font-semibold tabular-nums">
                  {/* 'UTC': a due date is a DAY, and reading it in a zone
                      behind the business moves it to the day before. */}
                  {formatPublicDate(new Date(payment.dueDate), locale, undefined, 'UTC')}
                </dd>
              </div>
            )}
            {typeof payment.refunded === 'number' && payment.refunded > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt style={{ opacity: 0.85 }}>{t('refunded')}</dt>
                <dd className="font-semibold tabular-nums">
                  <bdi>{money(payment.refunded, payment.currency)}</bdi>
                </dd>
              </div>
            )}
          </dl>
          )}

          {/*
            ─────────────────────────────────────────────────────────────────
            A DEMAND CARRIES A WAY TO ACT ON IT, OR SAYS WHY IT CANNOT.

            `payUrl` is null for a stage that is agreed but not yet billed: it
            counts toward the balance and has no invoice behind it. Without
            this the card showed a figure and the word "to pay" with no button
            and no explanation, which reads as a broken page. That is one of
            the two faults `portalMoneyIsOneAnswer` exists for.

            It held in `AppointmentCard`, which this page no longer renders,
            and the guard reads that file alone — so moving the money here
            dropped the behaviour silently. The guard covers this file now too.
            ─────────────────────────────────────────────────────────────────
          */}
          {payment.state === 'due' && !payment.payUrl && (
            <p className="mt-3 text-sm" style={{ opacity: 0.85 }}>
              {t('portal.not_billed_yet')}
            </p>
          )}

          {/* Only where money is genuinely outstanding AND there is an invoice
              behind it. */}
          {payment.payUrl && (
            <a
              href={payment.payUrl}
              className="mt-4 flex h-11 items-center justify-center text-sm font-bold transition-opacity hover:opacity-85"
              style={{
                background: 'var(--ap-surface)',
                color: 'var(--ap-text)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              {t('portal.pay_now')}
            </a>
          )}
        </section>
      )}

      {/*
        ── THE INTAKE FORM, and whether it is done ───────────────────────────
        It had exactly one way in: the link in the email that asked for it. A
        client who archived that mail, or filled half of it in and came back,
        could not reach it from here; one who HAD completed it was told so
        nowhere. Both states are things a client wants to know.
      */}

      {/*
        ── THE FORM: one card, in both states ───────────────────────────────
        Briefly the whole form was rendered inline here whenever it was
        outstanding, which put a page of questions in the middle of a page
        about an appointment. The card says what is left to do and opens the
        questions when the client asks for them; `/intake` mounts the same
        `IntakePanel`, so there is still one implementation of the form.

        Shown in BOTH states deliberately. A client who has filled it in was
        told so nowhere, and the only way to be sure was to open the old email
        link and look.
      */}
      {intake?.required && (
        <section className="apc-panel flex flex-col p-5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center"
              style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
            >
              {intake.completed ? (
                <ClipboardCheck className="h-4 w-4" style={{ color: '#15803D' }} />
              ) : (
                <ClipboardList className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} />
              )}
            </span>
            <h3 className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('portal.intake')}
            </h3>
          </div>
          <p className="mt-3 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
            {t(intake.completed ? 'portal.intake_done' : 'portal.intake_todo')}
          </p>
          {/*
            OPENS HERE, rather than navigating.

            This was a link to `/intake`, so the one thing left before the
            appointment took the client off the portal and onto a page of its
            own. The questions belong where the client already is: the button
            unfolds them into this card, and the card keeps its place in the
            column. `/intake` still exists for the link in their email, and
            mounts the same component.
          */}
          <button
            type="button"
            onClick={() => setIntakeOpen(open => !open)}
            aria-expanded={intakeOpen}
            className="mt-4 flex h-10 items-center justify-center self-start px-4 text-sm font-bold transition-opacity hover:opacity-85"
            style={
              intake.completed || intakeOpen
                ? {
                    border: '1px solid var(--ap-border)',
                    color: 'var(--ap-text)',
                    borderRadius: 'var(--ap-radius-md)',
                  }
                : {
                    background: 'var(--ap-brand)',
                    color: 'var(--ap-on-brand)',
                    borderRadius: 'var(--ap-radius-md)',
                  }
            }
          >
            {intakeOpen
              ? t('portal.close')
              : t(intake.completed ? 'portal.intake_review' : 'portal.intake_open')}
          </button>

          {intakeOpen && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--ap-border)' }}>
              <IntakePanel token={token} embedded />
            </div>
          )}
        </section>
      )}


          </div>
      {/*
        ── THE PLAN, PAYMENT BY PAYMENT ──────────────────────────────────────
        Numbered by the agreement's own `installment_number`, and named by the
        milestone where there is one: "1." and "2." cannot tell a client which
        payment a refund came off, but "on completion" can.
      */}
      {payment?.plan && periods.length > 0 && (
        <section className="apc-panel p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            {/* `portal.plan`, not `portal.payment`: the tile beside this one
                already carries that word, and two headings reading "Payment"
                on one screen is the page telling a client the same thing
                twice about two different things. */}
            <h3 className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('portal.plan')}
            </h3>
            <span className="text-xs tabular-nums" style={{ color: 'var(--ap-text-muted)' }}>
              {t('portal.plan_progress')
                .replace('{paid}', String(payment.plan.paid))
                .replace('{total}', String(payment.plan.total))}
            </span>
          </div>

          <ol className="flex flex-col">
            {periods.map(period => (
              <li
                key={period.number}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-2.5 first:border-t-0"
                style={{ borderColor: 'var(--ap-border)' }}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold tabular-nums"
                  style={{
                    background: 'var(--ap-brand-tint)',
                    color: 'var(--ap-brand)',
                    borderRadius: '9999px',
                  }}
                >
                  {period.number}
                </span>
                {period.label && (
                  <span className="text-sm" style={{ color: 'var(--ap-text)' }}>
                    <bdi>{period.label}</bdi>
                  </span>
                )}
                <span
                  className="ms-auto text-sm font-semibold tabular-nums"
                  style={{ color: 'var(--ap-text)' }}
                >
                  <bdi>{money(period.amount, payment.currency)}</bdi>
                </span>
                {period.dueDate && (
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--ap-text-muted)' }}
                  >
                    {formatPublicDate(new Date(period.dueDate), locale, undefined, 'UTC')}
                  </span>
                )}
                <span
                  className="px-2 py-0.5 text-xs font-bold"
                  style={{
                    background: periodChip(period.status).bg,
                    color: periodChip(period.status).fg,
                    borderRadius: '9999px',
                  }}
                >
                  {t(periodChip(period.status).key)}
                </span>
                {typeof period.refunded === 'number' && period.refunded > 0 && (
                  <span className="text-xs font-semibold" style={{ color: '#B3453C' }}>
                    {t('refunded')} <bdi>{money(period.refunded, payment.currency)}</bdi>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}


          <div className="grid gap-3 sm:grid-cols-2">
      {/*
        ── THE QUOTE ─────────────────────────────────────────────────────────
        A `sale_mode: 'proposal'` service is a consultation that ends in a
        price. Nothing raised: say it is being prepared. Raised: say where it
        stands, name the figure, and link to it — but only while it is still
        open, because a link to a withdrawn quote invites a client to act on
        something nobody is offering.
      */}
      {awaitingQuote && (
        <section className="apc-panel flex flex-col p-5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center"
              style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
            >
              <Hourglass className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} />
            </span>
            <h3 className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('portal.quote_waiting')}
            </h3>
          </div>
          <p className="mt-3 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
            {t('portal.quote_waiting_desc')}
          </p>
        </section>
      )}

      {quote && (
        <section className="apc-panel flex flex-col p-5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center"
              style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
            >
              <FileText className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} />
            </span>
            <h3 className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('portal.quote')}
            </h3>
          </div>

          {typeof quote.total === 'number' && quote.total > 0 && (
            <p
              className="mt-3 text-3xl font-bold tabular-nums"
              style={{
                color: 'var(--ap-text)',
                fontFamily: 'var(--ap-font-heading)',
                letterSpacing: '-0.02em',
              }}
            >
              <bdi>{money(quote.total, quote.currency)}</bdi>
            </p>
          )}
          <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
            {t(QUOTE_STATE[quote.status]?.key ?? 'portal.quote_sent')}
          </p>

          {quote.token && QUOTE_STATE[quote.status]?.open !== false && (
            <a
              /* INSIDE the portal. This pointed at `/proposal/{token}`, which
                 has its own route tree and so inherits none of this frame: the
                 client was sent to answer their quote on what read as a page
                 from somewhere else. The BOOKING token, deliberately — the
                 quote's own is minted server-side by that page. */
              href={`/book/manage/${token}/quote`}
              className="mt-4 flex h-10 items-center justify-center self-start px-4 text-sm font-bold transition-opacity hover:opacity-85"
              style={{
                background: 'var(--ap-brand)',
                color: 'var(--ap-on-brand)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              {t('portal.quote_open')}
            </a>
          )}
        </section>
      )}


          {portal && (portal.clientName || portal.clientEmail) && (
            <section className="apc-panel p-5">
              <h3 className="mb-3 text-xs font-semibold" style={{ color: 'var(--ap-text-muted)' }}>
                {t('yourDetails')}
              </h3>
              <dl className="space-y-2.5">
                {portal.clientName && (
                  <div className="flex items-center gap-2.5">
                    <User className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                    <dd className="text-sm"><bdi>{portal.clientName}</bdi></dd>
                  </div>
                )}
                {portal.clientEmail && (
                  <div className="flex items-center gap-2.5">
                    <Mail className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                    <dd className="break-all text-sm"><bdi>{portal.clientEmail}</bdi></dd>
                  </div>
                )}
              </dl>
            </section>
          )}
          </div>
          <BusinessInfoPanel brand={brand} variant="card" show={['contact', 'address', 'links']} />
          {/* Opening hours last: it is the thing a client checks on the
              morning of the appointment, not while reading the booking. */}
          <BusinessInfoPanel
            brand={brand}
            variant="card"
            show={['hours']}
            hoursStyle="folded"
            timeZone={portal?.timeZone}
          />
        </div>
      </div>

      {/*
        THE NOTICE WINDOW, SAID ONLY WHEN IT IS THE REASON.

        `canReschedule` is false for four different reasons — the appointment is
        done, it was a no-show, it has passed, or it is inside the notice window
        — and this printed the window's sentence for all of them. Said only
        where it is the live reason: still ahead, still standing, and the clock
        is what is in the way.

        The START TIME, not `hoursUntilBooking`: the route clamps that to zero,
        so a booking three weeks past reports the same "0 hours away" as one
        starting this minute.
      */}
      {meetings.length === 0 &&
        !booking.canReschedule &&
        (booking.status === 'confirmed' || booking.status === 'pending') &&
        start !== null &&
        start.getTime() > Date.now() && (
          <div>
            <StatusCard tone="info" title={t('cannotModify')} />
          </div>
        )}
    </>
  );
}
