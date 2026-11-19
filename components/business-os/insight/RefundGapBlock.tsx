'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A CLIENT ASKED FOR THEIR MONEY BACK, ON A FORM.
 *
 * This exists because the refund card was borrowing `MailGapBlock`, and that
 * block is about a MESSAGE: an envelope icon, "what they wrote", "subject",
 * "message content". A refund request has none of those. It came from a form
 * in the client portal — there is no subject line, no message body, and
 * nothing to reply into — and rendering it as mail told the owner a story
 * about an email that was never sent.
 *
 * WHAT A PERSON NEEDS TO DECIDE THIS, in the order they need it:
 *
 *   1. HOW MUCH they asked for. It was in the row's top-right meta strip,
 *      beside a clock, in the slot every gap uses for an incidental figure.
 *      On a refund request the figure is not incidental — it is the question.
 *   2. WHY, in the same words the owner's own refund dialog uses, so the card
 *      and the dialog say the same thing about the same request.
 *   3. WHICH booking, because a client with eleven payments has to be told
 *      which one this is.
 *   4. ANYTHING THEY ADDED, in their own words — the only part of the card
 *      that is the client speaking.
 *
 * It shows what was ASKED, never what will be returned. The owner decides
 * that, and the database decides what is possible: a client may ask for less
 * than they paid, and `RefundService` caps what actually moves. Nothing here
 * moves money or can be made to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Calendar, Quote, Bot, AlertTriangle, ChevronDown } from 'lucide-react';

interface Props {
  /** What they asked for, and in what. Never what will be returned. */
  value?: number | null;
  currency?: string | null;
  /** Why, as a translation key — gaps carry keys, not sentences. */
  noteKey?: string | null;
  /** Why, already a sentence, for a row that has no key. */
  note?: string | null;
  /** Which booking, in the words the client would use for it. */
  subject?: string | null;
  /** Anything they added, in their own words. */
  quote?: string | null;
  /**
   * What the refund agent would do, and why.
   *
   * Absent on a request nothing has looked at — no assessment installed, the
   * area switched off, or it could not answer. The block renders the request
   * cold then, which is exactly what this card did before the agent existed
   * and is a complete, useful card on its own.
   */
  /** What the business's own diary says happened, as a key. */
  bookingOutcomeKey?: string | null;
  /** When the booking was, raw ISO. */
  bookingWhen?: string | null;
  /** The client's reason and the diary disagree about the same session. */
  bookingContradicts?: boolean | null;
  recommendation?: 'refund_full' | 'refund_partial' | 'decline' | 'needs_owner' | null;
  recommendedAmount?: number | null;
  reasoning?: string | null;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE BOOKING, IN ENOUGH DETAIL TO ANSWER WITHOUT LEAVING.
   *
   * The card offers to move money, and the step that decided it was a single
   * line naming the service. An owner who wanted to know what was actually
   * paid, when, or whether the session had even happened yet opened the
   * booking — which is the work this card exists to remove.
   *
   * Every one of these is optional and the grid drops the tile it cannot
   * fill: a request with no booking behind it still renders, which is the
   * case the agent is told to report rather than hide.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /** What the client actually paid on this booking. */
  paidAmount?: number | null;
  /** When that money left their account, ISO. */
  paidAt?: string | null;
  /** How it arrived — `card`, `cash`, `bank_transfer`. See `GapItem`. */
  paidMethod?: string | null;
  /** When the booking was MADE, ISO — not when the session is. */
  bookedAt?: string | null;
  /** How long the service runs. */
  serviceMinutes?: number | null;
  /** The service's list price, which may differ from what was paid. */
  servicePrice?: number | null;
  /** Still returnable, from the one function that knows. */
  refundableAmount?: number | null;
  /** When they asked, ISO, for the last step of the timeline. */
  askedAt?: string | null;

  /**
   * The card's own money formatter, so one card states money ONE way.
   *
   * This block built its own `Intl.NumberFormat`, and the headline above it
   * uses `LanguageContext.formatCurrency` — so the same figure read "$50" in
   * the sentence and "US$50.00" three lines below it, on one card. Passed in
   * rather than imported, because the block is presentational and the context
   * belongs to the card.
   *
   * Absent, it falls back to its own formatting, so the block still renders
   * correctly anywhere it is used without one.
   */
  money?: (amount: number, currency?: string | null) => string;

  /**
   * The BUSINESS's clock, from `useLanguage`.
   *
   * Every hour on this card is an hour a client was offered, and those are
   * read in `user_preferences.timezone` — never the browser's. An owner
   * travelling, or a laptop left on another zone, would otherwise be told
   * their 08:15 session is at 06:15. CLAUDE.md § Currency & Timezone.
   *
   * Optional, so the block still renders standalone; without it the dates
   * fall back to the viewer's own zone.
   */
  timeZoneOptions?: (options?: Intl.DateTimeFormatOptions) => Intl.DateTimeFormatOptions;

  dense?: boolean;
  t: (key: string) => string;
}

export function RefundGapBlock({
  value,
  currency,
  noteKey,
  note,
  subject,
  quote,
  bookingOutcomeKey,
  bookingWhen,
  bookingContradicts,
  recommendation,
  recommendedAmount,
  reasoning,
  paidAmount,
  paidAt,
  paidMethod,
  bookedAt,
  serviceMinutes,
  servicePrice,
  refundableAmount,
  askedAt,
  money: moneyProp,
  timeZoneOptions,
  dense,
  t,
}: Props) {
  /*
   * The figure, in the reader's own locale and the CLIENT'S currency.
   *
   * Never the business's default: a business may price one client in another
   * currency, and `scheduling_services.currency` is the authority. The row
   * carries the currency the request was made in, beside the amount, and the
   * two travel together for exactly this reason. CLAUDE.md § Currency.
   */
  /** Whether the booking facts are showing. Closed on every render. */
  const [showFacts, setShowFacts] = useState(false);

  /** Money in the CLIENT'S currency, or null when either half is missing. */
  const money = (amount?: number | null) =>
    typeof amount !== 'number' || !currency
      ? null
      : moneyProp
        ? moneyProp(amount, currency)
        : new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            maximumFractionDigits: 2,
          }).format(amount);

  /*
   * THREE FORMATS, BECAUSE THEY ANSWER THREE QUESTIONS.
   *
   * All three say the TIME as well as the day. Day and month alone was the
   * wrong half of every one of these: a session is at an hour the client was
   * offered, a payment lands at a minute the bank recorded, and the timeline's
   * whole point is the ORDER — paid at 17:29, booked at 17:30, asked at 18:09
   * — which "19 Nov · 19 Nov · 19 Nov" cannot show.
   *
   * Every one of them reads on the business's clock. See `timeZoneOptions`.
   */
  const whenOpts = (options: Intl.DateTimeFormatOptions) =>
    timeZoneOptions ? timeZoneOptions(options) : options;

  /** The session: a date the owner has to recognise in their diary. */
  const longDateTime = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleString(
          undefined,
          whenOpts({
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        )
      : null;

  /** A payment: the day it landed, to the minute, for the year it was in. */
  const paidOn = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleString(
          undefined,
          whenOpts({
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        )
      : null;

  /** A step in the sequence: short, because four of them share one line. */
  const shortDate = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleString(
          undefined,
          whenOpts({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        )
      : null;

  /*
   * HAS IT HAPPENED YET — the fact that decides most of these.
   *
   * Computed here rather than carried as a key, because it changes with the
   * clock: a card rendered on Friday about Saturday's session says something
   * different on Monday, and a key fixed at fetch time would go stale in the
   * tab.
   */
  const sessionAhead = bookingWhen ? new Date(bookingWhen).getTime() > Date.now() : null;

  /* Declared AFTER `money`, because it calls it: a `const` arrow is in its
     temporal dead zone until its own line runs, so reading it earlier throws
     at render rather than failing a type check. */
  const asked = money(value);

  const reason = noteKey ? t(noteKey) : note || null;

  /* The booking's date in the reader's own locale. Day and month only: the
     year is noise on something that happened weeks ago, and the owner is
     placing it in their memory, not filing it. */
  const bookingDate = longDateTime(bookingWhen);

  /*
   * HOW LONG UNTIL IT, in whole days.
   *
   * "It has not happened yet" is true of a session tomorrow and of one in
   * March, and those are not the same decision. Whole days from now, floored,
   * so "in 4 days" never appears over something happening this afternoon.
   */
  const daysAhead =
    bookingWhen && sessionAhead
      ? Math.floor((new Date(bookingWhen).getTime() - Date.now()) / 86_400_000)
      : null;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE CARD IS A FLOW, BECAUSE THE DECISION IS ONE.
   *
   * It used to be a stack of facts in no particular relationship: an amount, a
   * reason, a booking, a quote, a verdict. Everything needed was on it and the
   * owner still could not answer, because the card never said how the parts
   * bear on each other — so they went and opened the booking anyway, which is
   * the work this card exists to remove.
   *
   * Three steps, in the order a person actually thinks:
   *   1. what the CLIENT asked, and why, in their words
   *   2. what the BUSINESS's own diary says happened
   *   3. what we therefore RECOMMEND
   *
   * Steps 1 and 2 are facts from two different sources, and the useful thing
   * is often that they disagree. Step 3 is an opinion and is kept visibly
   * apart, so nobody reads a recommendation as a record.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /*
   * The `Step` wrapper that drew each section with a left bar is gone.
   *
   * Three identically-barred blocks gave an OPINION the same weight as two
   * records, and the opinion is the one thing on this card nobody should
   * mistake for a fact. The facts are a labelled grid now; the opinion is a
   * bordered panel in the accent. Different shapes, because they are
   * different kinds of thing.
   */

  /*
   * THE SAME SHELL AS THE REPLY BOX — see `MailReplyBox`'s draft card.
   *
   * Identical by construction rather than by eye: a rule down the start edge
   * at 55% of the accent, the page ground behind it, no outline. The two sit
   * one above the other on the same card, and a bordered panel over a
   * left-ruled one read as two different kinds of thing when they are both
   * just parts of the one request.
   *
   * `border-s`, so it follows the writing direction and lands on the right in
   * Hebrew. The inner frames stay: they separate the four facts and the
   * sequence from each other, which is work this one was not doing.
   */
  return (
    <>
    {/*
      THE FACTS FOLD AWAY, AND THE TITLE DOES NOT.

      Three cards is a tall row, and most refunds are decided on the headline
      and the assessment alone: an owner who agrees with the agent never needs
      the tiles. So the detail starts closed and says so, and one press brings
      back everything it ever showed.

      Closed is the default rather than remembered. A row is answered once and
      disappears, so there is nothing to remember it for, and a card that opens
      differently depending on what somebody did last week is harder to read
      than one that always opens the same way.
    */}
    <button
      type="button"
      onClick={() => setShowFacts(open => !open)}
      aria-expanded={showFacts}
      className="mt-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)] transition-colors"
      style={{ letterSpacing: '0.06em' }}
    >
      {/* NAMED FOR WHAT IS BEHIND IT, not for what pressing it does. "Show"
          is true of every fold on the page and says nothing about which one
          this is; an owner scanning a row wants to know there is booking
          detail here before they decide to open it. */}
      {t('gaps.refund.booking_info')}
      <ChevronDown
        className={`w-3.5 h-3.5 transition-transform ${showFacts ? 'rotate-180' : ''}`}
        aria-hidden="true"
      />
    </button>

    {showFacts && (
    <div
      className={`mt-1.5 rounded-lg border-s-2 pe-2.5 ${dense ? 'ps-2.5 py-2' : 'ps-3 py-2.5'}`}
      style={{
        background: 'var(--v2-bg)',
        borderInlineStartColor: 'color-mix(in srgb, var(--v2-primary) 55%, transparent)',
      }}
    >
      {/*
        NO ORIGIN ROW, AND NO BADGE.

        This block opened with a "Refund request" badge, the origin and the
        age. On a card already headed "{name} wants {amount} back", under a
        panel titled "Refund requested", inside a group headed the same, that
        was one screen saying the same two words four times — and it stated
        the age a second time.

        The origin and the age moved up beside the client's address, where
        they belong: they are facts about the REQUEST, and the request is the
        headline. This block is about the booking, and starts there.
      */}

      {/*
        ── 1. THE ASK — NO LABEL ────────────────────────────────────────

        "The client asked for" sat above a figure that is already the biggest
        thing on the card, on a card headed "{name} wants {amount} back". The
        figure says what it is; the label was a third telling.

        The reason moves to the END of the line as a chip. Inline after the
        amount it read as part of the figure — "US$50.00 · Service not
        delivered" is one sentence about money and one about why, and they are
        not the same fact.
      */}
      {asked && (
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span
            className={`font-bold ${dense ? 'text-2xl' : 'text-3xl'} tracking-tight`}
            style={{ color: 'var(--v2-text-primary)', fontVariantNumeric: 'tabular-nums' }}
          >
            {asked}
          </span>
          {/* What the figure MEANS, where it is the whole of what they paid:
              a client asking for everything back is a different decision from
              one asking for part, and the amount alone does not say which. */}
          {typeof value === 'number' && typeof paidAmount === 'number' && value >= paidAmount && (
            <span className="text-[12px] text-[var(--v2-text-secondary)]">
              {t('gaps.refund.whole_amount')}
            </span>
          )}
          {reason && (
            <span
              className="ms-auto shrink-0 rounded-md px-2 py-1 text-[11.5px] font-medium"
              style={{
                background: 'var(--v2-border)',
                color: 'var(--v2-text-primary)',
                unicodeBidi: 'plaintext',
              }}
            >
              {reason}
            </span>
          )}
        </div>
      )}

      {/* Their own words, in a box of their own — the only part of this card
          that is the client speaking, and the only quotation on it. */}
      {quote && (
        <blockquote
          className="mt-2 mb-0 rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--v2-border)', background: 'var(--v2-surface)' }}
        >
          <p
            className="m-0 flex items-start gap-1.5 text-[12.5px] italic text-[var(--v2-text-primary)]"
            style={{ unicodeBidi: 'plaintext' }}
          >
            <Quote className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-60" aria-hidden="true" />
            <span>{quote}</span>
          </p>
        </blockquote>
      )}

      {/* ── 2. THE BOOKING THIS IS ABOUT ────────────────────────────────

          No heading of its own: the fold's button above the card carries it,
          and printing it twice was the first thing this card did when the
          title moved out. */}
      {(subject || bookingOutcomeKey || bookingDate || typeof refundableAmount === 'number') && (
        <section className="mt-3">
          {/*
            FOUR FACTS, IN A GRID — what was bought, when it is, what was
            actually paid, and what is still returnable.

            A tile with nothing in it is dropped rather than rendered empty: a
            request with no booking behind it, or a payment taken outside the
            system, is a real case the agent reports rather than hides.
          */}
          {/* ONE COLUMN ON A PHONE, two from `sm`. Two columns in 360px gave
              each tile about 150px, and "Mon, 23 Nov 2026, 10:15" does not fit
              in 150px — it wrapped to three lines and the grid lost the shape
              that made it readable. The hairlines come from the gap over a
              border-coloured ground, so they follow the column count for
              free. */}
          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-px rounded-lg overflow-hidden"
            style={{ background: 'var(--v2-border)' }}
          >
            {subject && (
              <div className="p-2" style={{ background: 'var(--v2-surface)' }}>
                <p className="text-[10.5px] text-[var(--v2-text-muted)]">{t('gaps.refund.fact.service')}</p>
                <p
                  className="text-[12.5px] font-semibold text-[var(--v2-text-primary)] truncate"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {subject}
                </p>
                {(serviceMinutes || money(servicePrice)) && (
                  <p className="text-[11.5px] text-[var(--v2-text-secondary)]">
                    {[
                      serviceMinutes
                        ? t('gaps.refund.fact.minutes').replace('{n}', String(serviceMinutes))
                        : null,
                      money(servicePrice),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
            )}

            {bookingDate && (
              <div className="p-2" style={{ background: 'var(--v2-surface)' }}>
                <p className="text-[10.5px] text-[var(--v2-text-muted)]">{t('gaps.refund.fact.when')}</p>
                <p className="text-[12.5px] font-semibold text-[var(--v2-text-primary)]">{bookingDate}</p>
                {/* The fact that decides most of these, in the accent so it is
                    the thing the eye lands on. */}
                <p
                  className="text-[11.5px] font-medium"
                  style={{
                    color: sessionAhead
                      ? 'var(--v2-warning, #d97706)'
                      : 'var(--v2-text-secondary)',
                  }}
                >
                  {!sessionAhead
                    ? t('gaps.refund.fact.already_happened')
                    : daysAhead && daysAhead >= 1
                      ? t('gaps.refund.fact.not_yet_days').replace('{n}', String(daysAhead))
                      : t('gaps.refund.fact.not_yet')}
                </p>
              </div>
            )}

            {money(paidAmount) && (
              <div className="p-2" style={{ background: 'var(--v2-surface)' }}>
                <p className="text-[10.5px] text-[var(--v2-text-muted)]">{t('gaps.refund.fact.paid')}</p>
                <p
                  className="text-[12.5px] font-semibold text-[var(--v2-text-primary)]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {money(paidAmount)}
                  {/* HOW it arrived, beside the figure. Card money goes back
                      in a click; cash has to be handed over and the platform
                      only records that it was — so this is not decoration, it
                      is what the owner's next action will be. Dropped silently
                      where the route has no copy, rather than printing a raw
                      column value at a business owner. */}
                  {paidMethod &&
                    t(`gaps.refund.paid_by.${paidMethod}`) !==
                      `gaps.refund.paid_by.${paidMethod}` && (
                      <span className="font-normal text-[var(--v2-text-secondary)]">
                        {' '}
                        {t(`gaps.refund.paid_by.${paidMethod}`)}
                      </span>
                    )}
                </p>
                <p className="text-[11.5px] text-[var(--v2-text-secondary)]">
                  {paidOn(paidAt) ?? t('gaps.refund.fact.unknown')}
                </p>
              </div>
            )}

            {typeof refundableAmount === 'number' && (
              <div className="p-2" style={{ background: 'var(--v2-surface)' }}>
                <p className="text-[10.5px] text-[var(--v2-text-muted)]">
                  {t('gaps.refund.fact.refundable')}
                </p>
                <p
                  className="text-[12.5px] font-semibold text-[var(--v2-text-primary)]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {money(refundableAmount)}
                </p>
                {/*
                  WHAT HAS ALREADY GONE BACK, rather than a standing claim that
                  nothing has.

                  This line said "Nothing refunded on this booking yet" whatever
                  the figure above it was — including over a booking the owner
                  had refunded in full minutes earlier, which is the one wrong
                  sentence on this card that could make them refund it twice.
                */}
                <p className="text-[11.5px] text-[var(--v2-text-secondary)]">
                  {(() => {
                    const back =
                      typeof paidAmount === 'number' ? paidAmount - refundableAmount : 0;
                    if (back <= 0) return t('gaps.refund.fact.nothing_back');
                    if (refundableAmount <= 0) return t('gaps.refund.fact.all_back');
                    return t('gaps.refund.fact.part_back').replace(
                      '{amount}',
                      money(back) || ''
                    );
                  })()}
                </p>
              </div>
            )}
          </div>

          {/* The outcome, said plainly. `unmarked` is its own sentence rather
              than silence: "nobody marked it" is a different fact from "it did
              not happen", and the owner acts differently on each. */}
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--v2-text-secondary)]">
            <Calendar className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden="true" />
            {t(bookingOutcomeKey || 'gaps.refund.outcome.unmarked')}
          </p>

          {/*
            THE ORDER THINGS HAPPENED IN.

            Four timestamps the owner otherwise reconstructs across three
            screens, and the order itself is often the answer: money in, then
            booked, then asked, with the session still ahead. Steps with no
            date are dropped, so a sparse row stays truthful rather than
            inventing a sequence.
          */}
          {(() => {
            const steps = [
              { key: 'gaps.refund.when.paid', at: paidAt },
              { key: 'gaps.refund.when.booked', at: bookedAt },
              { key: 'gaps.refund.when.asked', at: askedAt, now: true },
              { key: 'gaps.refund.when.session', at: bookingWhen },
            ].filter(step => Boolean(step.at));

            if (steps.length < 2) return null;

            /*
             * A ROW OF COLUMNS, not a sentence that wraps.
             *
             * Inline, the four steps ran together and broke wherever the width
             * ran out, so the sequence the strip exists to show was the one
             * thing it did not show. Equal columns with the label over its
             * time read as a sequence at a glance, and the box holds them
             * together as one fact rather than four.
             *
             * ON A PHONE IT SCROLLS rather than squeezes. Four equal columns
             * in 360px leave about 70px each, which turns "Asked for a refund"
             * into "Asked for…" and the dates into stubs — a sequence nobody
             * can read is worse than one they have to swipe. Each step keeps a
             * floor width and the row scrolls inside its own box, so the card
             * itself never scrolls sideways; from `sm` up they are equal
             * columns again and the floor never binds.
             */
            return (
              <ol
                className="mt-2 flex items-center list-none p-0 m-0 rounded-lg border px-3 py-2 overflow-x-auto"
                style={{ borderColor: 'var(--v2-border)', background: 'var(--v2-surface)' }}
              >
                {steps.map((step, i) => (
                  <li
                    key={step.key}
                    className="flex items-center gap-1.5 flex-1 min-w-[6.5rem] sm:min-w-0"
                  >
                    {i > 0 && (
                      <span aria-hidden="true" className="text-[var(--v2-text-muted)] text-[11px] shrink-0">
                        →
                      </span>
                    )}
                    <span className="text-[11px] min-w-0 flex flex-col">
                      <span
                        className="font-semibold truncate"
                        style={{
                          /* The step the owner is standing on, in the card's
                             one accent — the same amber the session line and
                             the origin use, so the eye learns one colour. */
                          color: step.now
                            ? 'var(--v2-warning, #d97706)'
                            : 'var(--v2-text-secondary)',
                        }}
                      >
                        {t(step.key)}
                      </span>
                      <span className="text-[var(--v2-text-muted)] truncate">{shortDate(step.at)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            );
          })()}

          {/*
            THE DISAGREEMENT, called out rather than left to be noticed.

            Two facts shown quietly side by side are easy to read past, and
            this one is usually the decision. Warning-toned, and worded so it
            never says who is right: somebody may have marked the diary wrong.
          */}
          {bookingContradicts && (
            <p
              className="mt-1.5 flex items-start gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium"
              style={{
                background: 'color-mix(in srgb, var(--v2-warning, #d97706) 13%, transparent)',
                color: 'var(--v2-warning, #d97706)',
              }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              <span style={{ unicodeBidi: 'plaintext' }}>{t('gaps.refund.contradiction')}</span>
            </p>
          )}
        </section>
      )}

      </div>
      )}

      {/*
        ── 3. WHAT WE THINK — A CARD OF ITS OWN ─────────────────────────

        Outside the facts card, not inside it. Everything above is what
        HAPPENED; this is what an agent makes of it, and nesting an opinion
        among the facts is how it comes to be read as one of them.

        Three cards down the row now, each the same shell: what happened, what
        we think, what you want to say. The opinion keeps the accent on its
        heading, so it is told apart by whose voice it is rather than by
        having a different kind of frame.

        `gaps.refund.said.*` are those sentences. The chip labels stay in
        `gaps.refund.rec.*` for the places that are listing, not reading.
      */}
      {recommendation && (
        <>
          {/* ABOVE the card, not inside it — the slot "The booking this is
              about" and "Your reply to {name}" both use. Three cards down the
              row, each labelled the same way, one of them by a machine. */}
          <h3
            className="text-[10.5px] font-bold uppercase mt-3 mb-1.5 text-[var(--v2-text-muted)]"
            style={{ letterSpacing: '0.06em' }}
          >
            {t('gaps.refund.ai_assessment')}
          </h3>
          <section
            className={`rounded-lg border-s-2 pe-2.5 ${dense ? 'ps-2.5 py-2' : 'ps-3 py-2.5'}`}
            style={{
              background: 'var(--v2-bg)',
              borderInlineStartColor: 'color-mix(in srgb, var(--v2-primary) 55%, transparent)',
            }}
          >
          <p className="flex items-center gap-2 flex-wrap m-0">
            {/* A ROBOT, not a lamp. A lightbulb is an idea somebody had; this
                paragraph was written by an agent, and the owner is entitled to
                know whose opinion it is before they act on it. */}
            <Bot
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: 'var(--v2-primary)' }}
              aria-hidden="true"
            />
            <span className="text-[12.5px] font-bold" style={{ color: 'var(--v2-primary)' }}>
              {t(`gaps.refund.said.${recommendation}`)}
            </span>
            {typeof recommendedAmount === 'number' && currency && (
              <span
                className="text-[12.5px] font-bold"
                style={{ color: 'var(--v2-text-primary)', fontVariantNumeric: 'tabular-nums' }}
              >
                {money(recommendedAmount)}
              </span>
            )}
          </p>
          {reasoning && (
            <p
              className="mt-1.5 mb-0 text-[12.5px] leading-relaxed"
              style={{ color: 'var(--v2-text-primary)', unicodeBidi: 'plaintext' }}
            >
              {reasoning}
            </p>
          )}
          </section>
        </>
      )}
    </>
  );
}
