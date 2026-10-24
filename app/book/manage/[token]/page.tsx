'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarPlus, ClipboardCheck, ClipboardList, CreditCard, FileText, Hourglass, Mail, RefreshCw, User, X } from 'lucide-react';

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
import { CancelPanel } from '@/components/public/CancelPanel';
import { IntakePanel } from '@/components/public/IntakePanel';
import { ReschedulePanel } from '@/components/public/ReschedulePanel';
import { InvoicePaymentPanel } from '@/components/public/InvoicePaymentPanel';
import { PortalMeetings } from '@/components/public/PortalMeetings';
import { ProposalAnswer } from '@/components/public/ProposalAnswer';
import { usePortalContext } from '@/components/public/PortalContextProvider';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import {
  createPublicT,
  formatPublicDate,
  formatPublicDay,
  formatPublicMoney,
} from '@/lib/i18n/public-pages';

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
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE TASK OPEN AT A TIME, AND THE TOKEN IT ACTS ON.
   *
   * Three booleans were enough while only this booking could be changed. A
   * package meeting is a DIFFERENT booking with its own token — the route
   * mints one per sibling for exactly this — so what is open has to say which
   * booking it is open against, or the panel under the package list would
   * reschedule the meeting the client is looking at instead of the one they
   * clicked.
   *
   * Clicking the same action twice closes it; clicking another swaps.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [task, setTask] = useState<{
    kind: 'intake' | 'reschedule' | 'cancel' | 'quote' | 'pay';
    token: string;
    /**
     * The SESSION this task is about, for a package.
     *
     * A package is one booking with N meetings, so a session has no token of
     * its own — the token names the purchase and this says which of its hours.
     * Absent for every ordinary booking.
     */
    meetingId?: string | null;
  } | null>(null);

  const openOnly = (
    kind: 'intake' | 'reschedule' | 'cancel' | 'quote' | 'pay',
    forToken: string = token
  ) =>
    setTask(current =>
      current && current.kind === kind && current.token === forToken ? null : { kind, token: forToken }
    );

  /* The three the booking card's own buttons read, unchanged in meaning. */
  const onThisBooking = task && task.token === token ? task.kind : null;
  const intakeOpen = onThisBooking === 'intake';
  const quoteOpen = onThisBooking === 'quote';
  const payOpen = onThisBooking === 'pay';
  const rescheduleOpen = onThisBooking === 'reschedule';
  const cancelOpen = onThisBooking === 'cancel';
  const [error, setError] = useState<string | null>(null);

  const locale = brand?.locale ?? 'en';
  const t = createPublicT(locale);
  /* The business's language for the dates, and the business's zone below them:
     the hour a client turns up at is the business's, not their device's. */
  const intlLocale = brand?.localeCode ?? 'en-US';

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE READ OF THE BOOKING, USED TWICE.
   *
   * On mount, and again after a task below has changed the appointment. A
   * client who moves their time watches the card above the form go on showing
   * the old one otherwise, so the page tells them two different things about
   * one booking until they reload.
   *
   * `quiet` leaves the spinner alone: the booking is already on screen, and
   * replacing it to refresh a date the client just chose is a worse answer
   * than the stale one.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const loadBooking = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await fetch(`/api/book/manage/${token}`, { cache: 'no-store' });
        const data = await res.json();
        if (data.success) {
          setBooking(data.booking);
          setMeetings(Array.isArray(data.meetings) ? data.meetings : []);
          setQuote(data.quote ?? null);
          setAwaitingQuote(Boolean(data.awaitingQuote));
          setIntake(data.intake ?? null);
          setPayment(data.payment ?? null);
          setError(null);
        } else if (!quiet) {
          setError(data.error || t('bookingNotFound'));
        }
      } catch {
        if (!quiet) setError(t('bookingNotFound'));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    // The token is the only input; re-running on locale change would refetch
    // for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token]
  );

  useEffect(() => {
    loadBooking();
  }, [loadBooking]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE TOKEN LEAVES THE ADDRESS BAR.
   *
   * It arrives in the path because an email can carry nothing else. From the
   * moment the page has rendered, every further second it spends there is pure
   * exposure: browser history, a client pasting their address into a support
   * chat, a screenshot, a shared laptop, and every proxy log between them and
   * us. `Referer` and search indexing are already closed; the address itself is
   * what was left.
   *
   * So: trade it for a short-lived, HttpOnly grant cookie, then `replaceState`
   * to `/book/manage/<booking id>`. `replace`, not `push` — it overwrites the
   * current history entry rather than adding one, so the token is not left
   * behind a Back button.
   *
   * The id that replaces it is an identifier and not a credential: every route
   * under this tree requires the grant cookie to name that exact booking before
   * it will answer for it.
   *
   * This is the shape `/invite` already uses. The difference is that a fragment
   * would keep the token off the server entirely, and this portal cannot use
   * one — the layout resolves the business's colours, language and text
   * direction server-side from this very segment, which is what stops the page
   * flashing unbranded and left-to-right before it corrects itself.
   *
   * Entirely best-effort. If the exchange fails — cookies refused, offline, a
   * private window — the page is already rendered and every route still accepts
   * the token in the path, exactly as before. Nothing is gated on this
   * succeeding, because a client who cannot store a cookie must still be able
   * to reach their booking.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    // Already a booking id: this page has been here before, or was reloaded.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      return;
    }

    let live = true;

    (async () => {
      try {
        const res = await fetch('/api/portal/enter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          /* A body, never a query string: a query would put the token straight
             back into a URL and into the request line of every access log. */
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!live || !data?.success || !data.bookingId) return;

        window.history.replaceState(
          null,
          '',
          `/book/manage/${data.bookingId}${window.location.search}`
        );
      } catch {
        /* The link still works. Nothing to tell the client. */
      }
    })();

    return () => {
      live = false;
    };
  }, [token]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ARRIVING WITH A TASK ALREADY OPEN.
   *
   * Two ways in, one mechanism:
   *
   *   `?pay=1`      every email that offers to take money
   *   `?task=quote` the four task routes, which redirect here rather than
   *                 drawing a screen of their own
   *
   * Without this a client follows a button that says Pay, or a link that says
   * "answer your quote", and lands on a page where they have to find the
   * control again — which reads as the wrong link.
   *
   * Only once, and only when the thing is actually there: the quote card needs
   * `quote.token`, the payment card needs `payment.invoiceId`, and both arrive
   * with the booking rather than with the first render. Re-running on every
   * render would also fight the Close button.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const payInvoiceId = payment?.invoiceId ?? null;
  const quoteToken = quote?.token ?? null;
  const [taskAutoOpened, setTaskAutoOpened] = useState(false);

  useEffect(() => {
    if (taskAutoOpened) return;

    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('pay') === '1' ? 'pay' : params.get('task');

    /* Whether the card this asks for can actually be drawn yet. Anything else
       — a stale link, a task that no longer applies — is simply ignored, which
       leaves the client on their portal rather than on an error. */
    const ready: Record<string, boolean> = {
      pay: Boolean(payInvoiceId),
      quote: Boolean(quoteToken),
      intake: Boolean(intake?.required),
      cancel: true,
      reschedule: true,
    };

    if (!wanted || !(wanted in ready)) return;
    if (!ready[wanted]) return;

    setTaskAutoOpened(true);
    setTask({
      kind: wanted as 'intake' | 'reschedule' | 'cancel' | 'quote' | 'pay',
      token,
      /* `?session=` — which hour of a package the client came to move. */
      meetingId: params.get('session'),
    });
  }, [taskAutoOpened, payInvoiceId, quoteToken, intake?.required, token]);

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

  /*
     The package's own status where there is one. A package can be stopped
     while its remaining sessions still sit at `confirmed`, so reading the
     session would tell a client their cancelled package is confirmed. */
  const subjectStatus = booking.parent?.status ?? booking.status;
  const isCancelled = subjectStatus === 'cancelled';

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

  const chip = STATUS_CHIP[subjectStatus] ?? STATUS_CHIP.pending;
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
  /* The booking card's three actions share one shape. */
  const BOOKING_ACTION =
    'flex h-11 items-center gap-2 px-4 text-sm font-bold transition-opacity hover:opacity-70';

  const firstName = booking.clientName?.trim().split(/\s+/)[0] ?? '';

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE SUBJECT OF THE LEAD CARD.
   *
   * Normally this booking. For a package session it is `booking.parent` — the
   * consultation the package was sold from, resolved by the route through
   * `proposals.package_booking_id`, which is the same host the CRM drawer
   * folds these sessions into.
   *
   * Reading it once, here, is what keeps the card from describing two
   * different bookings: the date from one and the status from another is
   * exactly the shape that produced "23 October" above a list of all six
   * sessions.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const subject = booking.parent ?? null;
  const subjectZone = subject ? subject.timezone : booking.timezone;
  const subjectService = subject ? subject.serviceName : (booking.service?.service_name ?? null);
  const subjectDuration = subject
    ? subject.durationMinutes
    : (booking.service?.duration_minutes ?? null);

  const startIso = subject ? subject.startTime : booking.startTime;
  const endIso = subject ? subject.endTime : booking.endTime;
  const start = startIso ? new Date(startIso) : null;

  const money = (amount: number, currency?: string | null) =>
    formatPublicMoney(amount, currency || brand.currency, locale);

  const clock = (value: Date) =>
    value.toLocaleTimeString(intlLocale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: subjectZone ?? undefined,
    });

  const end = endIso ? new Date(endIso) : null;
  /* Measured from the END, so a meeting still running is not already past. */
  const hasFinished = (end ?? start) !== null && (end ?? start)!.getTime() < Date.now();

  /*
   * A date where the subject has one. A package sold COLD has no booking
   * behind it, so the subject is the dateless container and the card leads
   * with the service name instead of a numeral.
   */
  const showDate = start !== null;
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
          {!isCancelled && showDate && !hasFinished && (
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

        {/*
          ─────────────────────────────────────────────────────────────────────
          A PURCHASE HAS NO DATE, AND STILL HAS A SUBJECT.

          This card is built around the day of the month: a 6xl numeral, the
          date under it, the hours under that. A booking with no `start_time` —
          a product, or a payment plan bought on its own — rendered none of the
          three and fell straight through to the facts list, so the largest
          thing on the card was the status chip and the card read as half
          loaded beside any dated booking. That is the "not like other
          bookings" shape.

          What it is FOR is the service, so that becomes the lead where there
          is no date to be one. Smaller than the numeral, because a name is not
          a number and setting it at 6xl would wrap to three lines.

          It must not then be repeated in the facts list below, which is why
          the `portal.service` row is now conditional on there being a date.
          ─────────────────────────────────────────────────────────────────────
        */}
        {!showDate && subjectService && (
          <div
            className="mt-3 text-3xl font-bold"
            style={{
              color: 'var(--ap-text)',
              fontFamily: 'var(--ap-font-heading)',
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            <bdi>{subjectService}</bdi>
          </div>
        )}

        {showDate && (
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
                timeZone: subjectZone ?? undefined,
              })}
            </div>
            <div
              className="mt-2 text-xl font-bold"
              style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
            >
              {formatPublicDate(start, locale, undefined, subjectZone)}
            </div>
            {/* The zone said out loud, because the hour a client turns up at is
                the business's and not their device's. */}
            <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
              <bdi>
                {clock(start)}
                {end ? ` – ${clock(end)}` : ''}
                {subjectZone ? ` (${subjectZone})` : ''}
              </bdi>
            </p>
          </>
        )}

        <dl
          className="mt-5 space-y-2.5 border-t pt-4 text-sm"
          style={{ borderColor: 'var(--ap-border)' }}
        >
          {/* Only where it is not already the lead above. */}
          {showDate && subjectService && (
            <div className="flex items-baseline justify-between gap-4">
              <dt style={{ color: 'var(--ap-text-muted)' }}>{t('portal.service')}</dt>
              <dd className="font-semibold" style={{ color: 'var(--ap-text)' }}>
                <bdi>{subjectService}</bdi>
              </dd>
            </div>
          )}
          {typeof subjectDuration === 'number' && (
            <div className="flex items-baseline justify-between gap-4">
              <dt style={{ color: 'var(--ap-text-muted)' }}>{t('portal.duration')}</dt>
              <dd className="font-semibold tabular-nums" style={{ color: 'var(--ap-text)' }}>
                {subjectDuration} {t('min')}
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
            {/*
              OPENS BELOW, rather than navigating. These were links to screens
              of their own, so changing a time, giving one up, or answering the
              questions took the client off the booking they were deciding
              about. The routes still exist for the links in their email.
            */}
            <button
              type="button"
              onClick={() => openOnly('reschedule')}
              aria-expanded={rescheduleOpen}
              className={BOOKING_ACTION}
              style={{
                border: '1px solid var(--ap-border)',
                background: rescheduleOpen ? 'var(--ap-brand-tint)' : 'var(--ap-surface)',
                color: 'var(--ap-text)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              <RefreshCw className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              {t('reschedule')}
            </button>

            {/*
              ─────────────────────────────────────────────────────────────────
              THE QUOTE, ANSWERED FROM THE BOOKING IT IS FOR.

              This was a link on the quote card in the left column, pointing at
              `/book/manage/{token}/quote` — inside the portal, but still a
              navigation: the booking the quote is about scrolled off, and
              accepting meant leaving the page that explains what is being
              accepted.

              It joins the other actions here, and the quote opens below the
              booking like the intake form. The card in the left column keeps
              the figure and the status, which is money and belongs in that
              column; what moved is the action.

              `open !== false` is the same test the card's link used: a DRAFT
              has not been sent, and offering a client a button to answer work
              the business has not finished would be the portal showing them
              something that does not exist yet.
              ─────────────────────────────────────────────────────────────────
            */}
            {/*
              ─────────────────────────────────────────────────────────────────
              PAYING, WITHOUT LEAVING THE BOOKING.

              The only action on this page that still navigated. The amount
              tile offered a link to `/invoice/{id}`, so a client settling a
              bill left the appointment it was for — the one thing the invoice
              page cannot show them — to read it somewhere else.

              `InvoicePaymentPanel` is the component that page already mounts,
              so there is one payment implementation and the invoice page keeps
              working for the link in the invoice email.

              `invoiceId` rather than parsing `payUrl`: the route sets and
              clears the two together, and a page that pulled an id out of a
              URL string would keep offering to collect the moment that
              formatting changed.
              ─────────────────────────────────────────────────────────────────
            */}
            {payment?.invoiceId && (
              <button
                type="button"
                /* Opens only. Closing is the card's own × — see the note there. */
                onClick={() => setTask({ kind: 'pay', token })}
                aria-expanded={payOpen}
                className={BOOKING_ACTION}
                style={{
                  border: '1px solid var(--ap-border)',
                  background: payOpen ? 'var(--ap-brand-tint)' : 'var(--ap-surface)',
                  color: 'var(--ap-text)',
                  borderRadius: 'var(--ap-radius-md)',
                }}
              >
                <CreditCard className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                {t('portal.pay_now')}
              </button>
            )}

            {quote?.token && QUOTE_STATE[quote.status]?.open !== false && (
              <button
                type="button"
                onClick={() => openOnly('quote')}
                aria-expanded={quoteOpen}
                className={BOOKING_ACTION}
                style={{
                  border: '1px solid var(--ap-border)',
                  background: quoteOpen ? 'var(--ap-brand-tint)' : 'var(--ap-surface)',
                  color: 'var(--ap-text)',
                  borderRadius: 'var(--ap-radius-md)',
                }}
              >
                <FileText className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                {t('portal.quote_open')}
              </button>
            )}

            {intake?.required && (
              <button
                type="button"
                onClick={() => openOnly('intake')}
                aria-expanded={intakeOpen}
                className={BOOKING_ACTION}
                style={{
                  border: '1px solid var(--ap-border)',
                  background: intakeOpen ? 'var(--ap-brand-tint)' : 'var(--ap-surface)',
                  color: 'var(--ap-text)',
                  borderRadius: 'var(--ap-radius-md)',
                }}
              >
                {intake.completed ? (
                  <ClipboardCheck className="h-4 w-4" style={{ color: '#15803D' }} aria-hidden />
                ) : (
                  <ClipboardList className="h-4 w-4" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                )}
                {t(intake.completed ? 'portal.intake_review' : 'portal.intake_open')}
              </button>
            )}
            <button
              type="button"
              onClick={() => openOnly('cancel')}
              aria-expanded={cancelOpen}
              className={BOOKING_ACTION}
              style={{
                border: '1px solid var(--ap-border)',
                background: cancelOpen ? 'var(--ap-danger-tint)' : 'var(--ap-surface)',
                color: '#B3453C',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              <X className="h-4 w-4" aria-hidden />
              {t('cancel')}
            </button>
          </div>
        )}
      </section>

      {/*
        THE INTAKE FORM, under the booking it is being filled in for.

        Nested inside the booking card it doubled its height and put a form
        inside the box describing the appointment. As a sibling the booking
        keeps its size and stays above, which is the point: what the questions
        are about is still in view.

        Change and cancel do NOT appear here — they open below the package
        list further down, so that one meeting's picker and the list of all of
        them are never on opposite sides of the card they both describe.
      */}
      {intakeOpen && (
        <section className="apc-panel p-5">
          <IntakePanel token={token} embedded />
        </section>
      )}

      {/*
        THE QUOTE ITSELF, under the booking it prices.

        `quote.token` is the PROPOSAL token, not this page's booking token —
        two different signatures over two different things. The route mints it
        server-side, having already proved the caller holds a valid booking
        token and already refused to sign a draft; this renders what it was
        given and reimplements none of that.
      */}
      {quoteOpen && quote?.token && (
        <section className="apc-panel p-5">
          <ProposalAnswer token={quote.token} embedded />
        </section>
      )}

      {/*
        THE CARD FIELDS, under the booking being paid for.

        Stripe still owns the fields themselves — they are its iframe, and
        nothing about the PCI position moves. What changes is the page around
        them, which is now the client's own portal rather than a document they
        were sent to.

        `successUrl` returns here, not to the invoice: the client came from
        this page and the booking is what they will want to see confirmed.
      */}
      {payOpen && payment?.invoiceId && (
        <section className="apc-panel p-5">
          {/*
            The card owns its own close now.

            The amount tile used to toggle, so the primary control beside the
            figure said "close" while the fields were open. Closing lives here
            instead, next to the thing it closes, where the word cannot be
            read as closing the bill.
          */}
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('portal.payment')}
            </h3>
            <button
              type="button"
              onClick={() => setTask(null)}
              /*
                An icon, not the word "close".
                
                On a client's own bill, "close" is read as closing the
                PROPOSAL or the deal, not as collapsing a panel — which is
                exactly how it was read when it shipped. An × carries no
                business meaning in any of the three languages, and the
                accessible name says what it actually dismisses.
              */
              aria-label={t('portal.payment')}
              className="-me-1 shrink-0 rounded-full p-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--ap-text-muted)' }}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <InvoicePaymentPanel
            invoiceId={payment.invoiceId}
            locale={locale}
            isRTL={brand.dir === 'rtl'}
            primaryColor={brand.theme.colors.primary}
            borderRadius={brand.theme.borderRadius}
            successUrl={`/book/manage/${token}?payment=success`}
            accessToken={payment.invoiceToken}
          />
        </section>
      )}


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
                            timeZone: subjectZone ?? undefined,
                          })}
                        </span>
                        <span className="mt-0.5 text-[10px] font-semibold opacity-75">
                          {when.toLocaleString(intlLocale, {
                            month: 'short',
                            timeZone: subjectZone ?? undefined,
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

                  {/*
                    ─────────────────────────────────────────────────────────
                    THE SAME TWO ACTIONS THE BOOKING ABOVE OFFERS, THE SAME WAY.

                    These were links, and one of them was broken: `/reschedule/
                    [token]` was removed when that screen moved into the portal,
                    so every package row has been offering a 404. The other sent
                    the client out of the portal to a page of its own.

                    Buttons now, opening the same `ReschedulePanel` and
                    `CancelPanel` the booking card opens, under this list, and
                    reporting back so the list and the booking both refresh.

                    `isCurrent` uses the page's OWN token rather than the
                    freshly minted sibling one: they address the same booking,
                    and two different strings for it would let this row and the
                    card above be open against "different" bookings at once.
                    ─────────────────────────────────────────────────────────
                  */}
                  {meeting.canModify && (
                    <span className="ms-auto flex items-center gap-2">
                      {(['reschedule', 'cancel'] as const).map(kind => {
                        const rowToken = meeting.isCurrent ? token : meeting.token;
                        const open = task?.kind === kind && task.token === rowToken;

                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => openOnly(kind, rowToken)}
                            aria-expanded={open}
                            className="rounded-full border px-3 py-1 text-xs font-medium"
                            style={{
                              borderColor: 'var(--ap-border)',
                              background: open ? 'var(--ap-brand-tint)' : 'transparent',
                              color:
                                kind === 'cancel' && !open
                                  ? 'var(--ap-text-muted)'
                                  : 'var(--ap-text)',
                            }}
                          >
                            {t(kind)}
                          </button>
                        );
                      })}
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
        ── CHANGING A TIME, OR CALLING ONE OFF ───────────────────────────────
        ONE MOUNT, BELOW THE LIST OF MEETINGS, WHICHEVER ROW ASKED FOR IT.

        These opened directly under the booking tile, which put the picker
        ABOVE the list of meetings it was changing one of — so the row the
        client clicked scrolled away from the panel acting on it, and a
        package's own card sat between the two.

        Below the list, both the booking at the top of this column and every
        row of the package open into the same place. `task.token` is the only
        thing that differs, and it is what decides which booking is changed:
        the page's own token from the booking card's buttons, that meeting's
        token from a package row.

        Named positively, not as "anything but intake": when the quote joined
        the task union that exclusion silently matched it too, and opening a
        quote would have drawn the CANCEL panel under the package list. The
        intake form and the quote both stay under the booking — they belong to
        the booking this portal is for and never to a sibling.

        `key` on the token so switching rows remounts rather than leaving the
        previous meeting's slots under the row just opened. `loadBooking(true)`
        rather than a reload: the booking and the list it refreshes are both on
        screen.
      */}
      {task && (task.kind === 'reschedule' || task.kind === 'cancel') && (
        <section className="apc-panel p-5">
          {task.kind === 'reschedule' ? (
            <ReschedulePanel
              /* The session is part of the identity: opening one session's
                 panel after another's must remount, not reuse the first's
                 chosen slot. */
              key={`${task.token}:${task.meetingId ?? ''}`}
              token={task.token}
              meetingId={task.meetingId ?? null}
              embedded
              onChanged={() => loadBooking(true)}
            />
          ) : (
            <CancelPanel
              key={task.token}
              token={task.token}
              embedded
              onChanged={() => loadBooking(true)}
            />
          )}
        </section>
      )}


        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Side by side: neither is more than a few lines. */}
          {/*
            PAYMENT AND THE CLIENT, SIDE BY SIDE.

            Payment first, on the reading-start side, because it is what a
            client opens this page to check. Both are always present: a payment
            card that disappeared when nothing was owed made the top of this
            column a different shape on every booking, and left a client
            guessing whether "no card" meant nothing to pay or nothing loaded.
          */}
          <div className="grid items-start gap-3 sm:grid-cols-2">
      {/*
        ── THE MONEY, ONCE ──────────────────────────────────────────────────
        Read from the state the ROUTE derives from the invoices and the plan,
        never from `booking.paymentStatus`: that column disagrees with reality
        on exactly the bookings this tile matters for, which is why the derived
        state exists at all.

        Solid brand, because it is the one figure most clients open this page
        to check.
      */}
      {hasMoney && payment ? (
        <section
          className="flex h-full flex-col p-5"
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
                  {/* A DAY, formatted from its own parts: no instant is
                      constructed, so no clock can move it. */}
                  {formatPublicDay(payment.dueDate, locale)}
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

          {/*
            Only where money is genuinely outstanding AND there is an invoice
            behind it.

            A button, not a link. This was an `<a>` to `/invoice/{id}` — the
            one action left on this page that took the client somewhere else —
            and it opens the card fields under the booking instead, beside the
            same control on the booking card. Both drive one task, so opening
            from either closes whatever else was open.
          */}
          {payment.invoiceId && (
            <button
              type="button"
              /*
                Opens, never closes. This toggled, so with the card open the
                primary control on the money tile read "close" — and in Hebrew
                it read `סגירה`, a noun meaning "closure", which beside an
                amount can be taken as closing or settling the bill.
                Reported as "what does this button do?", which is the only
                answer that matters for a control that moves money.

                Closing belongs to the card itself, below. Here the label is
                one thing, always, and a second click simply re-opens what is
                already open.
              */
              onClick={() => setTask({ kind: 'pay', token })}
              aria-expanded={payOpen}
              className="mt-4 flex h-11 items-center justify-center text-sm font-bold transition-opacity hover:opacity-85"
              style={{
                background: 'var(--ap-surface)',
                color: 'var(--ap-text)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              {t('portal.pay_now')}
            </button>
          )}
        </section>
      ) : (
        /*
          NOTHING OWED IS STILL AN ANSWER.

          A free service, and a booking whose price was never set, used to
          render no card here at all — so the top of this column was one tile
          wide on those bookings and two on every other, and a client had no
          way to tell "nothing to pay" apart from "the payment card failed to
          load". Saying it costs one line and removes the ambiguity.

          Quiet, not brand-solid: there is no figure to lead with, and the
          filled tile is reserved for money that actually moves.
        */
        <section className="apc-panel flex h-full flex-col p-5">
          <h3 className="text-xs font-bold" style={{ color: 'var(--ap-text-muted)' }}>
            {t('portal.payment')}
          </h3>
          <p className="mt-1 text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
            {t('portal.nothing_due')}
          </p>
        </section>
      )}

          {/*
            ───────────────────────────────────────────────────────────────────
            THE PAIR IS ONE SHAPE, SO IT TAKES THE TALLER CARD'S HEIGHT.

            `h-full`, not `items-stretch` on the grid. The grid keeps its
            `items-start` — a card grid that stretches by default is the fault
            `publicCardsKeepTheirPlace` exists for, and it has shipped three
            times — and these two cards opt IN individually.

            On a `align-self: start` grid item, `height: 100%` still resolves
            against the grid AREA, which is the row height. So whichever of the
            two is taller sets it and the other follows, and no third card
            added to this column can be dragged along by it.

            Why opt in here: a payment card carrying a due date and a Pay
            button stands about half as tall again as a name and an email, and
            the two sitting side by side at the top of the column made the
            whole page look unfinished at its most-read corner.
            ───────────────────────────────────────────────────────────────────
          */}
          {portal && (portal.clientName || portal.clientEmail) && (
            <section className="apc-panel h-full p-5">
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
                {/*
                  ─────────────────────────────────────────────────────────────
                  A WITHDRAWN DEMAND IS NOT AN AMOUNT THEY OWE.

                  The figure was drawn in full ink whatever the stage's state,
                  so a cancelled period sat beside a live one looking exactly
                  as payable — same weight, same colour — and the only thing
                  separating them was the word in the chip, whose cancelled and
                  pending styles are identical. A client totting up what is
                  left counted money nobody will ever ask them for.

                  Struck through and muted, which is how the same schedule now
                  reads in their email.
                  ───────────────────────────────────────────────────────────── */}
                <span
                  className="ms-auto text-sm font-semibold tabular-nums"
                  style={{
                    color: period.status === 'cancelled' ? 'var(--ap-text-muted)' : 'var(--ap-text)',
                    textDecoration: period.status === 'cancelled' ? 'line-through' : undefined,
                  }}
                >
                  <bdi>{money(period.amount, payment.currency)}</bdi>
                </span>
                {/*
                  ─────────────────────────────────────────────────────────────
                  THE DATE THAT IS TRUE OF THIS STAGE RIGHT NOW.

                  Only `dueDate` was shown, whatever the stage's state, which
                  made a settled payment read "₪1,000 · Monday 23 November ·
                  paid" about money that arrived on 9 October. The client was
                  told the wrong date for their own payment.

                  And a milestone has NO due date — it falls due when the work
                  is done — so the second stage of a two-stage quote showed no
                  date at all, despite having been paid on a known day.

                  Once money has moved, when it moved is the fact worth
                  showing. Before then, when it is owed.
                  ─────────────────────────────────────────────────────────────
                */}
                {/*
                  NO DUE DATE ON A CANCELLED PERIOD. "Due 21 October" of money
                  that will never be requested is a deadline the client has no
                  way to act on, and reads as something they have missed.
                  `paidAt` is still honoured: a period paid and later voided
                  keeps the day its money actually moved.
                */}
                {(period.paidAt ?? (period.status === 'cancelled' ? null : period.dueDate)) && (
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--ap-text-muted)' }}
                  >
                    {/*
                      The two dates need DIFFERENT zones, and getting that wrong
                      moves one of them by a day.

                      `dueDate` is a plain DATE column with no time in it. It
                      is formatted from its own parts, so no clock is involved
                      and nothing can shift it.

                      `paidAt` is an instant, and an instant needs a clock: the
                      BUSINESS's. Money taken at 01:00 in Israel is 22:00 the
                      day before in UTC, so any other clock would tell the
                      client they paid on a day they did not.
                    */}
                    {period.paidAt
                      ? formatPublicDate(new Date(period.paidAt), locale, undefined, subjectZone)
                      : formatPublicDay(period.dueDate, locale)}
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

          {/* No button here any more: answering moved to the booking card at
              the top of the right column, where the appointment the quote is
              for is on screen while the client decides. This card states the
              figure and where it stands, which is money, and money stays in
              this column. */}
        </section>
      )}


          {portal && (
            <PortalMeetings brand={brand} meetings={portal.meetings} timeZone={portal.timeZone} />
          )}
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
