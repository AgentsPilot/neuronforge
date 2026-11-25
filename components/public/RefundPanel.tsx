'use client';

/**
 * A client asking for their money back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ASKS IN BOOKINGS, NOT IN PAYMENTS.
 *
 * Somebody wanting a refund is thinking "the session I cancelled", never
 * "transaction a876d569". The list is what they paid for, in their own words,
 * and the money behind each line is the server's problem — see
 * `lib/payments/refundableBookings.ts`.
 *
 * A LIST, NOT A `<select>`. Twelve long names in a dropdown on a phone is a
 * guess, and a wrong guess here asks for the wrong money back. The rows carry
 * what the client actually remembers — what it was for, how much, when they
 * paid, and the invoice number they have already read in an email from this
 * business — because on a real account several bookings share a name and an
 * amount, and the only thing that reliably separates them is the clock.
 *
 * NOTHING IS DECIDED HERE. This records a request. No money moves, nothing is
 * promised, and the copy says so: the owner answers.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';

/**
 * The mark beside every label on this form, because every field is required.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEEN AS AN ASTERISK, HEARD AS A WORD.
 *
 * The red `*` is what the owner asked for and what a form reader expects, but
 * an asterisk alone is a shape with no name: a screen reader announces "star",
 * or nothing at all, and the field sounds optional.
 *
 * So the mark is `aria-hidden` and the word rides behind it in `sr-only`. One
 * fact, told the way each reader can take it. The inputs carry `required` and
 * `aria-required` besides, and the reason group carries `aria-required` because
 * a row of buttons has no required state of its own.
 */
function Required({ t }: { t: (key: string) => string }) {
  return (
    <>
      <span
        className="ms-1 text-sm font-bold"
        style={{ color: 'var(--ap-danger)' }}
        aria-hidden="true"
      >
        *
      </span>
      <span className="sr-only">{t('refund.required')}</span>
    </>
  );
}

/** One line the client can choose. Shaped by `/api/book/manage/[token]`. */
export interface RefundableBooking {
  bookingId: string;
  title: string;
  startTime: string | null;
  refundable: number;
  currency: string;
  paid: number;
  paidAt: string | null;
  /** When they already asked about this one. Set means it cannot be chosen. */
  requestedAt: string | null;
  invoiceNumber: string | null;
}

interface Props {
  token: string;
  bookings: RefundableBooking[];
  /** The reader's language and direction, as the page already resolved them. */
  locale: string;
  t: (key: string) => string;
  onSent?: () => void;
  /**
   * The row the client is currently asking about, or null.
   *
   * The page uses it to stop contradicting itself: its money cards describe the
   * booking whose LINK was opened, which is very often not the one the refund
   * is about. A client choosing "₪74.99, the renovation quote" should not be
   * reading "₪800 overdue" beside it.
   */
  onChoose?: (booking: RefundableBooking | null) => void;
}

/** The five the owner already uses in their own refund dialog. */
const REASONS = [
  'cancelled_by_client',
  'service_not_delivered',
  'duplicate_payment',
  'no_show',
  'goodwill',
] as const;

export function RefundPanel({ token, bookings, locale, t, onSent, onChoose }: Props) {
  /*
   * Auto-selected only when there is exactly one choice AND it is still open to
   * being chosen. Pre-selecting a booking the client has already asked about
   * would arm a button that cannot work.
   */
  const [chosen, setChosen] = useState<string | null>(() => {
    const free = bookings.filter(b => !b.requestedAt);
    return free.length === 1 ? free[0].bookingId : null;
  });
  /*
   * NOTHING IS PRE-ANSWERED. Every field on this form is the client's to fill.
   *
   * `reason` defaulted to `cancelled_by_client`, which is a claim about why
   * somebody wants their money back, made on their behalf before they had said
   * anything. The owner then read it as the client's own words and answered on
   * that basis. A refund is a dispute about money, and a guessed reason is the
   * worst kind of default: it looks like an answer.
   */
  const [reason, setReason] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  /* Open while there is a choice to make, closed once it is made. A client
     with exactly one refundable payment never opens it at all. */
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const booking = bookings.find(b => b.bookingId === chosen) ?? null;

  /* Announced as an effect rather than from the click, so the auto-selected
     single booking reaches the page too — that choice is never clicked. */
  useEffect(() => {
    onChoose?.(booking);
    /* Cleared when the panel goes, so the page stops showing a selection that
       is no longer on screen. */
    return () => onChoose?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.bookingId]);

  /*
   * THE FORMATTERS COME FIRST, because the memos below call them.
   *
   * A `const` arrow function is not hoisted, so `groups` reading `monthOf`
   * from further down the file threw at render: "Cannot access 'monthOf'
   * before initialization". Declaration order IS the dependency order here,
   * and nothing between these and the memos may be moved above them.
   */
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 })
      .format(value);

  /*
   * HOW A PERSON REMEMBERS A PAYMENT.
   *
   * "לפני 3 ימים" is how somebody recalls paying; "12 בנוב׳, 23:48" is how a
   * database records it. `Intl.RelativeTimeFormat` says it in the reader's own
   * language without a table of strings to translate.
   *
   * The exact clock is kept for one case and one only — two rows that would
   * otherwise read identically — because that is the case it was added for.
   * On this account six bookings share a name, an amount AND a day, and the
   * minute is the only thing that separates them.
   */
  const relative = (iso: string) => {
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (days < 1) return rtf.format(0, 'day');
    if (days < 30) return rtf.format(-days, 'day');
    if (days < 365) return rtf.format(-Math.round(days / 30), 'month');
    return rtf.format(-Math.round(days / 365), 'year');
  };

  const exactly = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  /* The month a payment belongs to, as a heading. */
  const monthOf = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(iso))
      : t('refund.no_date');


  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A LONG-STANDING CLIENT HAS A LONG LIST.
   *
   * Most people have one or two payments behind them and the list is three
   * lines. A package client, or anyone a few years in, can have fifty — and a
   * fifty-row list pushes the amount, the reason and the button so far down
   * the page that the form reads as a wall rather than a question.
   *
   * So the list is capped in HEIGHT rather than in CONTENT: everything stays
   * reachable, and the form below it stays on screen. Nothing is hidden from
   * somebody scrolling, which a "show more" would do to the one row they
   * happen to want.
   *
   * The filter appears only once there is enough to be worth filtering.
   * Offering a search box above three rows is chrome that says "this will be
   * hard", about something that is not.
   */
  const FILTER_FROM = 6;
  const showFilter = bookings.length >= FILTER_FROM;

  /*
   * Rows that would read the same without the clock.
   *
   * Computed over ALL of them rather than per row, because ambiguity is a
   * property of the set: one payment of ₪400 on Tuesday needs no minute, and
   * six do. Showing the time on every row would make the common case harder
   * to read in order to rescue the rare one.
   */
  const ambiguous = useMemo(() => {
    const seen = new Map<string, number>();
    for (const b of bookings) {
      const key = `${b.title}|${b.refundable}|${(b.paidAt ?? '').slice(0, 10)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return seen;
  }, [bookings]);

  const isAmbiguous = (b: RefundableBooking) =>
    (ambiguous.get(`${b.title}|${b.refundable}|${(b.paidAt ?? '').slice(0, 10)}`) ?? 0) > 1;

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return bookings;
    /* Name, invoice number and amount — the three things somebody would type.
       The amount as plain digits, so "400" finds ₪400 whatever the locale
       renders around it. */
    return bookings.filter(b =>
      [b.title, b.invoiceNumber ?? '', String(b.refundable)]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [bookings, filter]);

  /*
   * Grouped by the month they paid, in the order they already arrived.
   *
   * Eleven equal rows is a wall; three headed groups is a list somebody can
   * start reading. The groups are built from the sorted array rather than
   * sorted again, so the newest month leads and nothing is re-ordered inside
   * it.
   */
  const groups = useMemo(() => {
    const out: Array<{ heading: string; rows: RefundableBooking[] }> = [];
    for (const b of shown) {
      const heading = monthOf(b.paidAt);
      const last = out[out.length - 1];
      if (last && last.heading === heading) last.rows.push(b);
      else out.push({ heading, rows: [b] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, locale]);

  /* Headings earn their place only once there is more than one. */
  const showHeadings = groups.length > 1;

  /*
   * EVERY FIELD IS ASKED FOR, NONE IS ASSUMED.
   *
   * The amount used to fall back to the whole refundable sum when the box was
   * left empty, so a client who never typed a figure still asked for all of it
   * — and the owner received a request that looked deliberate. The cap is still
   * the cap: it can be reduced, never raised, because the database would refuse
   * anyway. What changed is that the figure has to be typed.
   */
  const max = booking?.refundable ?? 0;
  const asked = Number(amount);
  const amountMissing = amount.trim() === '' || !Number.isFinite(asked);
  const overMax = !amountMissing && asked > max + 1e-9;
  const tooSmall = !amountMissing && asked <= 0;
  const noteMissing = note.trim() === '';
  /* The booking is required too, but it gates this whole block: the fields do
     not render until one is chosen. */
  const incomplete = amountMissing || overMax || tooSmall || !reason || noteMissing;

  async function submit() {
    if (!booking || busy || incomplete || !reason) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/book/manage/${token}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /* The booking, never a transaction. The server resolves the money from
           its own list, so nothing the browser sends can name a payment. */
        body: JSON.stringify({
          booking_id: booking.bookingId,
          amount: asked,
          reason,
          /* Always present now, so the owner never reads a request with the
             explanation missing. */
          note: note.trim(),
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok || !body?.success) {
        setError(body?.error || t('refund.failed'));
        return;
      }

      setSent(true);
      onSent?.();
    } catch {
      setError(t('refund.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex items-start gap-3">
        <Check className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
        <div>
          <p className="font-bold" style={{ color: 'var(--ap-text)' }}>
            {t('refund.sent_title')}
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
            {t('refund.sent_body')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-lg font-bold" style={{ color: 'var(--ap-text)' }}>
          {t('refund.title')}
        </h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
          {t('refund.lead')}
        </p>
      </div>

      {/* WHICH PAYMENT */}
      {/*
        ─────────────────────────────────────────────────────────────────────
        CHOSEN, IT COLLAPSES.

        A list that stays eleven rows tall after the choice is made pushes the
        amount, the reason and the button off a phone screen, and goes on
        asking a question that has been answered. Closed, it is one row that
        says what was picked, with a way back.

        It is NOT a dropdown, which would be the obvious way to get that: a
        native `select` renders one line per option, and six of these rows
        share a name — the amount and the minute that separate them would be
        truncated away, on the end, which is where they live. A custom
        combobox renders what it likes and owes listbox semantics, focus
        trapping and keyboard navigation for the privilege. Open-then-collapse
        buys the same compactness with none of that.
        ───────────────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
          {t('refund.which')}
        </legend>

        {booking && !picking ? (
          <div
            className="flex items-start gap-3 p-3"
            style={{
              borderRadius: 'var(--ap-radius-md)',
              border: '1.5px solid var(--ap-brand)',
              background: 'var(--ap-brand-tint)',
            }}
          >
            <span className="min-w-0 flex-1">
              <span
                className="block text-lg font-bold"
                style={{ color: 'var(--ap-text)', fontVariantNumeric: 'tabular-nums' }}
              >
                {money(booking.refundable, booking.currency)}
              </span>
              <span className="block text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
                {booking.title || t('refund.untitled')}
              </span>
              <span className="mt-0.5 block text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                {booking.paidAt
                  ? isAmbiguous(booking)
                    ? exactly(booking.paidAt)
                    : relative(booking.paidAt)
                  : ''}
                {booking.invoiceNumber ? ` · ${booking.invoiceNumber}` : ''}
              </span>
            </span>

            {bookings.length > 1 && (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="shrink-0 px-2 py-1 text-sm font-bold underline"
                style={{ color: 'var(--ap-brand)', background: 'none', border: 'none' }}
              >
                {t('refund.choose_other')}
              </button>
            )}
          </div>
        ) : (
          <>
            {showFilter && (
              <div className="relative mb-1">
                <Search
                  className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ insetInlineStart: '0.75rem', color: 'var(--ap-text-muted)' }}
                  aria-hidden
                />
                <input
                  type="search"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder={t('refund.search')}
                  aria-label={t('refund.search')}
                  className="h-10 w-full text-sm"
                  style={{
                    paddingInlineStart: '2.25rem',
                    paddingInlineEnd: '0.75rem',
                    borderRadius: 'var(--ap-radius-md)',
                    border: '1.5px solid var(--ap-border)',
                    background: 'var(--ap-surface)',
                    color: 'var(--ap-text)',
                  }}
                />
              </div>
            )}

            <div
              className="flex flex-col gap-2 overflow-y-auto"
              style={{ maxHeight: bookings.length > FILTER_FROM ? '21rem' : undefined }}
            >
              {shown.length > 0 && shown.every(b => b.requestedAt) && (
                <p className="px-1 pb-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
                  {t('refund.all_asked')}
                </p>
              )}

              {shown.length === 0 && (
                <p className="px-1 py-2 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
                  {t('refund.no_match')}
                </p>
              )}

              {groups.map(group => (
                <div key={group.heading} className="flex flex-col gap-2">
                  {showHeadings && (
                    <span
                      className="px-1 pt-1 text-xs font-bold"
                      style={{ color: 'var(--ap-text-muted)' }}
                    >
                      {group.heading}
                    </span>
                  )}

                  {group.rows.map(b => {
                    const chosenRow = b.bookingId === chosen;
                    /* The exact clock ONLY where the row would otherwise be a
                       twin. Everywhere else, how a person would say it. */
                    const stamp = b.paidAt
                      ? isAmbiguous(b)
                        ? exactly(b.paidAt)
                        : relative(b.paidAt)
                      : null;

                    return (
                      <button
                        key={b.bookingId}
                        type="button"
                        disabled={Boolean(b.requestedAt)}
                        onClick={() => {
                          setChosen(b.bookingId);
                          /* The amount belongs to the row, so choosing another
                             clears a figure typed against the previous one. */
                          setAmount('');
                          setPicking(false);
                        }}
                        className="flex w-full items-start gap-3 p-3 text-start transition-colors disabled:cursor-default"
                        style={{
                          borderRadius: 'var(--ap-radius-md)',
                          border: `1.5px solid ${chosenRow ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                          background: chosenRow ? 'var(--ap-brand-tint)' : 'var(--ap-surface)',
                          /* Dimmed rather than removed: it is still their
                             payment and they are still owed an answer. */
                          opacity: b.requestedAt ? 0.55 : 1,
                        }}
                        aria-pressed={chosenRow}
                      >
                        <span className="min-w-0 flex-1">
                          {/*
                            THE AMOUNT LEADS.

                            Six bookings on this account share the name
                            "בדיקת תוכנית תשלומים", so the name cannot be the
                            thing the eye lands on. People remember what they
                            paid far better than a service name they did not
                            write.
                          */}
                          <span
                            className="block text-lg font-bold"
                            style={{ color: 'var(--ap-text)', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {money(b.refundable, b.currency)}
                          </span>
                          <span
                            className="block text-sm font-medium"
                            style={{ color: 'var(--ap-text)' }}
                          >
                            {b.title || t('refund.untitled')}
                          </span>
                          <span
                            className="mt-0.5 block text-xs"
                            style={{ color: 'var(--ap-text-muted)' }}
                          >
                            {stamp}
                            {b.invoiceNumber ? ` · ${b.invoiceNumber}` : ''}
                          </span>

                          {b.requestedAt && (
                            <span
                              className="mt-1.5 inline-block px-2 py-0.5 text-xs font-bold"
                              style={{
                                borderRadius: '999px',
                                background: 'var(--ap-surface-2)',
                                color: 'var(--ap-text)',
                              }}
                            >
                              {t('refund.already_asked').replace(
                                '{when}',
                                relative(b.requestedAt)
                              )}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </fieldset>

      {booking && (
        <>
          {/* HOW MUCH */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('refund.how_much')}
              <Required t={t} />
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={max}
              /*
               * `any`, not `0.01`.
               *
               * The step is what the browser's up/down arrows move by, and at
               * `0.01` a client nudging the figure changed it by a CENT at a
               * time. Nobody asks for a refund in cents; they move whole
               * units, and thirty presses to go from 50 to 20 is not a
               * control.
               *
               * `any` leaves the arrows on their default step of one AND lifts
               * the step constraint, so a figure like 49.50 can still be
               * typed. Setting `1` instead would move the arrows correctly and
               * then call a half-unit amount invalid, which is a real amount
               * for a real refund.
               */
              step="any"
              value={amount}
              required
              aria-required="true"
              /*
               * NO PLACEHOLDER OF THE MAXIMUM.
               *
               * A greyed `400` in an empty box reads as a value already there,
               * which is the whole reason the old silent fallback to the full
               * amount went unnoticed. The cap is stated underneath in words
               * instead, where it cannot be mistaken for an answer.
               */
              onChange={e => setAmount(e.target.value)}
              className="h-11 px-3 text-base"
              style={{
                borderRadius: 'var(--ap-radius-md)',
                border: `1.5px solid ${overMax ? 'var(--ap-danger)' : 'var(--ap-border)'}`,
                background: 'var(--ap-surface)',
                color: 'var(--ap-text)',
              }}
            />
            <span className="text-xs" style={{ color: overMax ? 'var(--ap-danger)' : 'var(--ap-text-muted)' }}>
              {t('refund.up_to').replace('{amount}', money(max, booking.currency))}
            </span>
          </label>

          {/* WHY */}
          {/* `aria-required` on the group: a row of buttons has no required
              state of its own, so without it only sighted readers are told. */}
          <fieldset className="flex flex-col gap-1.5" aria-required="true">
            <legend className="mb-1.5 text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('refund.why')}
              <Required t={t} />
            </legend>
            <div className="flex flex-wrap gap-2">
              {REASONS.map(key => {
                const picked = reason === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setReason(key)}
                    className="px-3 py-1.5 text-sm font-medium transition-colors"
                    style={{
                      borderRadius: 'var(--ap-radius-md)',
                      border: `1.5px solid ${picked ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                      background: picked ? 'var(--ap-brand-tint)' : 'var(--ap-surface)',
                      color: picked ? 'var(--ap-brand)' : 'var(--ap-text)',
                    }}
                    aria-pressed={picked}
                  >
                    {t(`refund.reason.${key}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* ANYTHING ELSE */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold" style={{ color: 'var(--ap-text)' }}>
              {t('refund.note')}
              <Required t={t} />
            </span>
            <textarea
              rows={3}
              value={note}
              maxLength={2000}
              required
              aria-required="true"
              onChange={e => setNote(e.target.value)}
              className="p-3 text-base"
              style={{
                borderRadius: 'var(--ap-radius-md)',
                border: '1.5px solid var(--ap-border)',
                background: 'var(--ap-surface)',
                color: 'var(--ap-text)',
                resize: 'vertical',
              }}
            />
          </label>

          {error && (
            <p className="text-sm font-medium" style={{ color: 'var(--ap-danger)' }} role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={busy || incomplete}
            className="flex h-11 items-center justify-center gap-2 px-5 font-bold transition-opacity disabled:opacity-50"
            style={{
              borderRadius: 'var(--ap-radius-md)',
              background: 'var(--ap-brand)',
              color: 'var(--ap-on-brand)',
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t('refund.submit')}
          </button>

          {/* No money moves here, and the client is told so before they press. */}
          <p className="text-xs" style={{ color: 'var(--ap-text-muted)' }}>
            {t('refund.disclaimer')}
          </p>
        </>
      )}
    </div>
  );
}
