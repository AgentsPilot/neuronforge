'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarPlus, ClipboardCheck, ClipboardList, FileText, Hourglass, RefreshCw, X } from 'lucide-react';

import { AppointmentCard, type PublicBookingSummary } from '@/components/public/AppointmentCard';
import { PortalHero } from '@/components/public/PortalHero';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
import { StatusCard } from '@/components/public/StatusCard';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT, formatPublicDate, formatPublicMoney } from '@/lib/i18n/public-pages';

/**
 * One meeting of a package, as this page lists it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The client had a link to the FIRST meeting and to nothing else. Every later
 * one arrived with its own reminder 24 hours ahead — which, for a service whose
 * notice window is 24 hours, is exactly when the policy stops allowing a
 * change. So a client wanting to cancel session five a month in advance could
 * not, and the one time they were handed a link was the time it was refused.
 *
 * Each row carries its own token, so Cancel and Reschedule go to the same
 * routes as a single booking and are judged by the same rule. Nothing about the
 * policy changes here: `canModify` is the server's answer, and `tooSoon` is why
 * it said no.
 * ─────────────────────────────────────────────────────────────────────────────
 */
interface PackageMeeting {
  id: string;
  occurrenceNumber: number | null;
  startTime: string | null;
  endTime: string | null;
  status: string;
  canModify: boolean;
  tooSoon: boolean;
  token: string;
  isCurrent: boolean;
}

/**
 * Where the quote stands, for a booking that exists to produce one.
 *
 * Absent entirely on an ordinary appointment. Present and null when the service
 * is sold by quote and none has been raised yet, which is a state of its own
 * and the one the client most needs told.
 */
interface QuoteState {
  status: string;
  total: number | null;
  currency: string | null;
  token: string | null;
}

/**
 * What is owed or has been paid, however this booking was sold.
 *
 * Derived by the route from the invoices and the plan, because the service's
 * own price is zero or meaningless for most of what a business sells.
 */
interface PaymentState {
  state: 'paid' | 'due' | 'refunded' | 'none';
  amount: number | null;
  currency: string | null;
  dueDate: string | null;
  overdue: boolean;
  plan: { paid: number; total: number } | null;
}

interface BookingData extends PublicBookingSummary {
  id: string;
  clientName: string;
  clientEmail: string;
  status: string;
  paymentStatus: string;
  notes: string | null;
  canReschedule: boolean;
  canCancel: boolean;
  /** Null for a product purchase — there is no appointment to count down to. */
  hoursUntilBooking: number | null;
  /** False for a product purchase: nothing about it is scheduled. */
  isScheduled?: boolean;
}

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

  const [booking, setBooking] = useState<BookingData | null>(null);
  /** The other meetings, when this booking is one of a package. */
  const [meetings, setMeetings] = useState<PackageMeeting[]>([]);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [awaitingQuote, setAwaitingQuote] = useState(false);
  const [intake, setIntake] = useState<{ required: boolean; completed: boolean } | null>(null);
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [loading, setLoading] = useState(true);
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
      <div style={{ background: 'var(--ap-bg)' }}>
        <StatusCard
          standalone
          tone="error"
          title={t('bookingNotFound')}
          description={t('bookingNotFoundDesc')}
        />
      </div>
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
   * THE PORTAL.
   *
   * One bar, one hero, one column with a rail beside it on a wide screen.
   * Before this the page was a centred document: a logo block, a status chip on
   * its own line, the appointment, the client's details, two full-width action
   * blocks and the business panel, each queueing under the last. On a phone the
   * two things a client came to do sat about 700px down.
   *
   * What moved, and why:
   *   · the status chip is ON the card now, attached to what it describes;
   *   · the actions are on the card too, three across instead of two stacked;
   *   · the client's details and the business panel are the RAIL, so on a
   *     desktop they sit beside the booking rather than below it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const firstName = booking.clientName?.trim().split(/\s+/)[0] ?? '';
  const start = booking.startTime ? new Date(booking.startTime) : null;

  return (
    <>
      <PortalHero
        brand={brand}
        title={
          firstName ? t('portal.greeting').replace('{name}', firstName) : t('manageBooking')
        }
        /* The question they opened the link to answer: when is it, and is it
           still on. A cancelled booking says so on the card instead. */
        subtitle={
          !isCancelled && start
            ? `${t('portal.next_is')} · ${formatPublicDate(start, locale)}`
            : null
        }
      />

      <>
        <AppointmentCard
          booking={booking}
          brand={brand}
          variant="full"
          muted={isCancelled}
          badge={{ label: statusLabel, bg: status.bg, fg: status.fg }}
          paymentStatus={booking.paymentStatus}
          payment={payment}
        >
          {/*
            A package's meetings are each cancelled and moved on their own
            token, below — offering one pair of buttons here would act on the
            first meeting and look like it acted on the block.
          */}
          {!isCancelled && meetings.length === 0 && booking.canReschedule && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <a
                href={`/book/manage/${token}/reschedule`}
                className="flex flex-col items-center justify-center gap-1.5 px-1 py-2.5 text-center text-xs font-semibold leading-tight transition-opacity hover:opacity-70"
                style={{
                  border: '1px solid var(--ap-border)',
                  borderRadius: 'var(--ap-radius-md)',
                  color: 'var(--ap-text)',
                }}
              >
                <RefreshCw className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                {t('reschedule')}
              </a>

              {/* The action most clients actually want, and the one the page
                  has never offered. The route signs nothing new: the token in
                  the URL is the one they are already holding. */}
              <a
                href={`/api/book/manage/${token}/calendar`}
                className="flex flex-col items-center justify-center gap-1.5 px-1 py-2.5 text-center text-xs font-semibold leading-tight transition-opacity hover:opacity-70"
                style={{
                  border: '1px solid var(--ap-border)',
                  borderRadius: 'var(--ap-radius-md)',
                  color: 'var(--ap-text)',
                }}
              >
                <CalendarPlus className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                {t('portal.add_to_calendar')}
              </a>

              <a
                href={`/book/manage/${token}/cancel`}
                className="flex flex-col items-center justify-center gap-1.5 px-1 py-2.5 text-center text-xs font-semibold leading-tight transition-opacity hover:opacity-70"
                style={{
                  border: '1px solid var(--ap-border)',
                  borderRadius: 'var(--ap-radius-md)',
                  color: '#B3453C',
                }}
              >
                <X className="h-4 w-4" aria-hidden />
                {t('cancel')}
              </a>
            </div>
          )}
        </AppointmentCard>

      {/*
        ───────────────────────────────────────────────────────────────────────
        THE INTAKE FORM, and whether it is done.

        It had exactly one way in: the link in the email that asked for it. A
        client who archived that mail, or who filled half of it in and came back
        later, could not reach it from here — and one who HAD completed it was
        told so nowhere, so the only way to be sure was to open the old link and
        see what it said.

        Both states are shown, because both are things a client wants to know
        before an appointment: there is something left to do, or there is not.
        ───────────────────────────────────────────────────────────────────────
      */}
      {intake?.required && (
        <section
          className="flex items-start gap-3 p-5"
          style={{
            background: 'var(--ap-surface)',
            border: '1px solid var(--ap-border)',
            borderRadius: 'var(--ap-radius-lg)',
          }}
        >
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center"
            style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
          >
            {intake.completed ? (
              <ClipboardCheck className="h-4 w-4" style={{ color: '#15803D' }} />
            ) : (
              <ClipboardList className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('portal.intake')}
            </h2>
            <p className="mt-0.5 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
              {t(intake.completed ? 'portal.intake_done' : 'portal.intake_todo')}
            </p>
          </div>

          {/*
            Done, the link is quiet and reads as "see what I wrote" — the page
            behind it shows their answers back to them. Not done, it is the
            action, because it is the one thing left before the appointment.
          */}
          <a
            href={`/book/manage/${token}/intake`}
            className={
              intake.completed
                ? 'shrink-0 self-center text-xs font-bold transition-opacity hover:opacity-70'
                : 'flex h-10 shrink-0 items-center justify-center px-4 text-sm font-bold transition-opacity hover:opacity-85'
            }
            style={
              intake.completed
                ? { color: 'var(--ap-brand)' }
                : {
                    background: 'var(--ap-brand)',
                    color: 'var(--ap-on-brand)',
                    border: '1px solid var(--ap-brand)',
                    borderRadius: 'var(--ap-radius-md)',
                  }
            }
          >
            {t(intake.completed ? 'portal.intake_review' : 'portal.intake_open')}
          </a>
        </section>
      )}

      {/*
        ───────────────────────────────────────────────────────────────────────
        THE QUOTE, when this appointment exists to produce one.

        A `sale_mode: 'proposal'` service is a consultation that ends in a
        price. The portal showed the meeting and stopped there, so a client a
        fortnight after it saw "took place" and nothing else: no sign a quote
        was coming, no sign one had been sent, nothing to open. Asking by email
        was the only way to find out.

        Two states, and neither should have to be guessed at. Nothing raised:
        say it is being prepared. Raised: say where it stands, name the figure,
        and link to it.
        ───────────────────────────────────────────────────────────────────────
      */}
      {awaitingQuote && (
        <section
          className="flex items-start gap-3 p-5"
          style={{
            background: 'var(--ap-surface)',
            border: '1px solid var(--ap-border)',
            borderRadius: 'var(--ap-radius-lg)',
          }}
        >
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center"
            style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
          >
            <Hourglass className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('portal.quote_waiting')}
            </h2>
            <p className="mt-0.5 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
              {t('portal.quote_waiting_desc')}
            </p>
          </div>
        </section>
      )}

      {quote && (
        <section
          className="p-5"
          style={{
            background: 'var(--ap-surface)',
            border: '1px solid var(--ap-border)',
            borderRadius: 'var(--ap-radius-lg)',
          }}
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center"
              style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
            >
              <FileText className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
                {t('portal.quote')}
              </h2>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
                {t(QUOTE_STATE[quote.status]?.key ?? 'portal.quote_sent')}
              </p>
            </div>

            {typeof quote.total === 'number' && quote.total > 0 && (
              <span className="shrink-0 text-base font-bold" style={{ color: 'var(--ap-text)' }}>
                <bdi>
                  {formatPublicMoney(quote.total, quote.currency || brand.currency, locale)}
                </bdi>
              </span>
            )}
          </div>

          {/* Only where there is something to open. A declined or withdrawn
              quote is a closed door, and a link to it invites a client to act
              on something nobody is offering any more. */}
          {quote.token && QUOTE_STATE[quote.status]?.open !== false && (
            <a
              href={`/proposal/${quote.token}`}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 text-sm font-bold transition-opacity hover:opacity-85"
              style={{
                background: 'var(--ap-brand)',
                color: 'var(--ap-on-brand)',
                border: '1px solid var(--ap-brand)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              {t('portal.quote_open')}
            </a>
          )}
        </section>
      )}

      {/*
        ── THE WHOLE BLOCK, when this is one meeting of a package ──────────
        One link opens all of them, and each is cancelled or moved on its own
        under the SAME notice window a single booking is judged by. The server
        decides: `canModify` is its answer and `tooSoon` is why it said no, so
        this page never offers an action that is about to be refused.
      */}
      {meetings.length > 0 && (
        <section
          className="rounded-2xl p-5"
          style={{ background: 'var(--ap-surface)', border: '1px solid var(--ap-border)' }}
        >
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--ap-text-muted)' }}
          >
            {t('manage.package_title').replace('{count}', String(meetings.length))}
          </h2>

          <ol className="flex flex-col">
            {meetings.map((meeting, index) => {
              const held = meeting.status === 'completed';
              const off = meeting.status === 'cancelled' || meeting.status === 'no_show';

              return (
                <li
                  key={meeting.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t py-3 first:border-t-0"
                  style={{ borderColor: 'var(--ap-border)' }}
                >
                  <span
                    className="w-5 shrink-0 text-xs font-semibold tabular-nums"
                    style={{ color: 'var(--ap-text-muted)' }}
                  >
                    {meeting.occurrenceNumber ?? index + 1}
                  </span>

                  <span
                    className="text-sm"
                    style={{
                      color: off ? 'var(--ap-text-muted)' : 'var(--ap-text)',
                      textDecoration: off ? 'line-through' : undefined,
                    }}
                  >
                    {meeting.startTime
                      ? new Date(meeting.startTime).toLocaleString(intlLocale, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'long',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: booking.timezone,
                        })
                      : '—'}
                  </span>

                  {held && <span className="text-xs" style={{ color: 'var(--ap-text-muted)' }}>{t('manage.package_held')}</span>}
                  {off && <span className="text-xs" style={{ color: 'var(--ap-text-muted)' }}>{t('manage.package_cancelled')}</span>}

                  {/* Its own two actions, on its own token. */}
                  {meeting.canModify && (
                    <span className="ms-auto flex items-center gap-2">
                      <a
                        href={`/book/manage/${meeting.token}/reschedule`}
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

        {/*
          ─────────────────────────────────────────────────────────────────────
          THE NOTICE WINDOW, SAID ONLY WHEN IT IS THE REASON.

          `canReschedule` is false for four different reasons — the appointment
          is done, it was a no-show, it has already passed, or it is inside the
          notice window — and this printed the window's sentence for all of
          them. A client looking at a session they attended last month was told
          "changes can only be made more than 24 hours before the appointment",
          which is true of nothing they can act on and reads as a refusal of
          something they never asked for.

          Said only where it is the live reason: the appointment is still ahead,
          still standing, and the clock is what is in the way. In that one case
          it genuinely matters, because the business CAN still move it and the
          client needs to know to ask.
          ─────────────────────────────────────────────────────────────────────
        */}
        {meetings.length === 0 &&
          !booking.canReschedule &&
          (booking.status === 'confirmed' || booking.status === 'pending') &&
          /*
           * The START TIME, not `hoursUntilBooking`: the route clamps that to
           * zero (`Math.max(0, …)`), so a booking three weeks past reports the
           * same "0 hours away" as one starting this minute, and the sentence
           * would come back for every appointment a business never got round to
           * marking complete.
           */
          start !== null &&
          start.getTime() > Date.now() && <StatusCard tone="info" title={t('cannotModify')} />}
      </>
    </>
  );
}
