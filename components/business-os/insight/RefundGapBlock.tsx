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

import { Undo2, Calendar, Quote, Bot, AlertTriangle } from 'lucide-react';

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
  /** Where the request came from, as a key. */
  contextKey?: string | null;
  /** How long they have been waiting, already formatted. */
  when?: string | null;
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
  contextKey,
  when,
  bookingOutcomeKey,
  bookingWhen,
  bookingContradicts,
  recommendation,
  recommendedAmount,
  reasoning,
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
  const asked =
    typeof value === 'number' && currency
      ? new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency,
          maximumFractionDigits: 2,
        }).format(value)
      : null;

  const reason = noteKey ? t(noteKey) : note || null;

  /* The booking's date in the reader's own locale. Day and month only: the
     year is noise on something that happened weeks ago, and the owner is
     placing it in their memory, not filing it. */
  const bookingDate = bookingWhen
    ? new Date(bookingWhen).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
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
  const Step = ({
    label,
    tone,
    children,
  }: {
    label: string;
    tone?: 'opinion';
    children: React.ReactNode;
  }) => (
    <div
      className={`${dense ? 'ps-2.5 py-1.5' : 'ps-3 py-2'} mt-1.5`}
      style={{
        borderInlineStart: `2px solid ${
          tone === 'opinion' ? 'var(--v2-primary)' : 'var(--v2-border)'
        }`,
        ...(tone === 'opinion'
          ? { background: 'color-mix(in srgb, var(--v2-primary) 7%, transparent)', borderRadius: '0 8px 8px 0' }
          : {}),
      }}
    >
      <p
        className="text-[10.5px] font-bold uppercase tracking-wide mb-0.5"
        style={{
          color: tone === 'opinion' ? 'var(--v2-primary)' : 'var(--v2-text-muted)',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </p>
      {children}
    </div>
  );

  return (
    <div
      className={`rounded-xl border ${dense ? 'p-2.5' : 'p-3'} mt-1.5`}
      style={{
        borderColor: 'var(--v2-border)',
        background: 'var(--v2-surface-2, rgba(255,255,255,0.02))',
      }}
    >
      {/* WHERE IT CAME FROM, said plainly. Not an agent badge: nothing
          judged this yet — a person filled in a form. */}
      {contextKey && (
        <p className="flex items-center gap-1.5 flex-wrap text-[11.5px] mb-2 text-[var(--v2-text-secondary)]">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'color-mix(in srgb, var(--v2-primary) 13%, transparent)',
              color: 'var(--v2-primary)',
            }}
          >
            <Undo2 className="w-3 h-3" aria-hidden="true" />
            {t('gaps.refund.badge')}
          </span>
          <span>{t(contextKey)}</span>
          {when && (
            <>
              <span aria-hidden="true" className="text-[var(--v2-text-muted)]">·</span>
              <span className="text-[var(--v2-text-muted)]">{when}</span>
            </>
          )}
        </p>
      )}

      {/* ── 1. WHAT THEY ASKED, AND WHY ──────────────────────────────── */}
      <Step label={t('gaps.refund.flow.asked')}>
        {asked && (
          <p className="flex items-baseline gap-2 flex-wrap">
            <span
              className={`font-bold ${dense ? 'text-lg' : 'text-xl'}`}
              style={{ color: 'var(--v2-text-primary)', fontVariantNumeric: 'tabular-nums' }}
            >
              {asked}
            </span>
            {reason && (
              <span
                className="text-[12px] font-medium text-[var(--v2-text-secondary)]"
                style={{ unicodeBidi: 'plaintext' }}
              >
                · {reason}
              </span>
            )}
          </p>
        )}
        {/* Their own words sit WITH their request, not stranded elsewhere on
            the card: this is the client speaking, and it belongs to step 1. */}
        {quote && (
          <p className="mt-1 flex items-start gap-1.5 text-[12px] italic text-[var(--v2-text-secondary)]">
            <Quote className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-60" aria-hidden="true" />
            <span style={{ unicodeBidi: 'plaintext' }}>{quote}</span>
          </p>
        )}
      </Step>

      {/* ── 2. WHAT THE DIARY SAYS ────────────────────────────────────── */}
      {(subject || bookingOutcomeKey || bookingDate) && (
        <Step label={t('gaps.refund.flow.diary')}>
          {subject && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--v2-text-primary)]">
              <Calendar className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden="true" />
              <span className="truncate" style={{ unicodeBidi: 'plaintext' }}>
                {subject}
              </span>
              {bookingDate && (
                <span className="text-[var(--v2-text-muted)] shrink-0">· {bookingDate}</span>
              )}
            </p>
          )}
          {/* The outcome, said plainly. `unmarked` is its own sentence rather
              than silence: "nobody marked it" is a different fact from "it did
              not happen", and the owner acts differently on each. */}
          <p className="mt-0.5 text-[12px] text-[var(--v2-text-secondary)]">
            {t(bookingOutcomeKey || 'gaps.refund.outcome.unmarked')}
          </p>

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
        </Step>
      )}

      {/* ── 3. WHAT WE RECOMMEND — an opinion, and marked as one ───────── */}
      {recommendation && (
        <Step label={t('gaps.refund.flow.rec')} tone="opinion">
          <p className="flex items-center gap-1.5 flex-wrap">
            <Bot
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: 'var(--v2-primary)' }}
              aria-hidden="true"
            />
            <span className="text-[12px] font-bold" style={{ color: 'var(--v2-primary)' }}>
              {t(`gaps.refund.rec.${recommendation}`)}
            </span>
            {typeof recommendedAmount === 'number' && currency && (
              <span
                className="text-[12.5px] font-bold"
                style={{ color: 'var(--v2-text-primary)', fontVariantNumeric: 'tabular-nums' }}
              >
                {new Intl.NumberFormat(undefined, {
                  style: 'currency',
                  currency,
                  maximumFractionDigits: 2,
                }).format(recommendedAmount)}
              </span>
            )}
          </p>
          {reasoning && (
            <p
              className="mt-1 text-[12px]"
              style={{ color: 'var(--v2-text-secondary)', unicodeBidi: 'plaintext' }}
            >
              {reasoning}
            </p>
          )}
        </Step>
      )}

    </div>
  );
}
