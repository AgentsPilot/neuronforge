'use client';

/**
 * One quote version, as the sequence of things that happened to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SPINE AND NOT A STATUS
 *
 * The journey's quote step reports where the quote GOT TO, and the version
 * strip reports one date per version: `decided_at || sent_at || created_at`,
 * whichever is latest. Both are right and both are lossy, because a quote that
 * was sent, lapsed, extended, reminded and then read has five moments and
 * neither surface could name more than one of them.
 *
 * The cost of that showed up on a live account on 2026-11-16. An owner cleared
 * a "quote expired" card by extending the offer from the 13th to the 17th. The
 * write was correct; every surface still described the quote by `sent_at`,
 * three days earlier, so they read it as the same untouched alert and concluded
 * the extension had not worked.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * Invent a step. Each sub-node is drawn from a column that is actually set, so
 * a quote with no `viewed_at` shows "not opened" rather than a cheerful
 * "opened" with a guessed date, and a quote whose `extended_at` is null simply
 * has no extension line. That null is not only the pre-migration state: every
 * extension recorded before the route began writing these columns is null too,
 * and the audit trail can recover `extended_at` for those but never the old
 * deadline.
 *
 * It also never reads the audit trail. `PROPOSAL_REMINDER_SENT` is in there and
 * would make a sixth sub-node, but a journey that reads an append-only log to
 * decide what to draw has the dependency backwards: that step waits for a
 * column of its own.
 *
 * @module components/crm/contact-drawer/QuoteSubNodes
 */

import { useMemo, useState } from 'react';

import { cancelReasonKey } from '@/lib/business-os/cancellationReasons';

/** The per-version facts the strip already holds, plus the moments. */
export interface QuoteVersionMoments {
  id: string;
  status: string;
  createdAt?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  decidedAt?: string | null;
  stoppedAt?: string | null;
  validUntil?: string | null;
  extendedAt?: string | null;
  extendedFrom?: string | null;
  supersedesId?: string | null;
  declineReason?: string | null;
  declineNote?: string | null;
  stopReason?: string | null;
  stopNote?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
  /** What acceptance raised. Either is enough to say the money exists. */
  createdInvoiceId?: string | null;
  createdPlanId?: string | null;
}

/**
 * Above this many steps the spine folds; folded, this many are kept.
 *
 * Five is a quote that was sent, lapsed, extended, read and is waiting — the
 * full story of the case this was built for, which should not need unfolding.
 */
const FOLD_ABOVE = 5;
const FOLD_KEEP = 3;

/** How a sub-node's dot reads. Semantic, matching the version strip's tones. */
type Tone = 'done' | 'warn' | 'bad' | 'info' | 'act' | 'idle';

const TONE_COLOR: Record<Tone, string> = {
  done: '#22C58B',
  warn: '#F79009',
  bad: '#F04438',
  info: '#60A5FA',
  /* The owner's own action, in the platform accent, so what THEY did is
     distinguishable at a glance from what the client or the clock did. */
  act: 'var(--v2-primary)',
  idle: 'var(--v2-border)',
};

interface SubNode {
  key: string;
  tone: Tone;
  title: string;
  note?: string | null;
  /** Rendered as a mono "a → b" line: the one thing that changed. */
  change?: { label: string; from: string; to: string };
  /** ISO, or null for a step that has not happened. */
  at: string | null;
  /** A step that has not happened yet, drawn hollow and muted. */
  pending?: boolean;
}

export interface QuoteSubNodesProps {
  version: QuoteVersionMoments;
  /** Already-localised date formatters, owned by the drawer. */
  formatDateTime: (iso: string) => string;
  formatShortDate: (iso: string) => string;
  t: (key: string) => string;
  isRTL: boolean;
  /** Offered only where the server would accept it: a lapsed quote. */
  onExtend?: (proposalId: string, validUntil: string | null) => void;
  /** A refused or lapsed price can always be replaced by a new version. */
  onPriceAgain?: (proposalId: string) => void;
  /**
   * Whether this version's story starts open.
   *
   * True for the version being read. False for the ones it replaced: a
   * negotiation of four versions would otherwise unroll four spines at once,
   * and the superseded ones are history rather than the question. They are
   * still THERE, one click away, which is the part that was missing — gating
   * the spine on "is current" meant a revision chain showed its newest version
   * in full and the one it replaced as a bare line.
   */
  defaultOpen?: boolean;
}

/** `t` with a fallback, so a missing key never renders as a key. */
function label(t: (key: string) => string, key: string, fallback: string): string {
  const value = t(key);
  return value && value !== key ? value : fallback;
}

/**
 * A stored reason CODE, as a sentence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `stop_reason` and `decline_reason` hold machine values — `client_stopped`,
 * `client_unresponsive`, `too_expensive` — and this rendered them raw, so the
 * spine showed an owner the database's word for what happened instead of
 * theirs. The strip above has always translated them; these are the same two
 * key shapes it uses, so one vocabulary serves both.
 *
 * Falls back to the code rather than to the key: `client_stopped` is poor copy
 * but it is still readable, where `cancel.reason.client_stopped` is not.
 */
function reasonText(t: (key: string) => string, key: string, code: string): string {
  const value = t(key);
  return value && value !== key ? value : code;
}

export function QuoteSubNodes({
  version,
  formatDateTime,
  formatShortDate,
  t,
  isRTL,
  onExtend,
  onPriceAgain,
  defaultOpen = true,
}: QuoteSubNodesProps) {
  const nodes = useMemo<SubNode[]>(() => {
    const out: SubNode[] = [];
    const say = (key: string, fallback: string) => label(t, key, fallback);

    /* Written. Always true — a row cannot exist without being created. */
    if (version.createdAt) {
      out.push({
        key: 'written',
        tone: 'done',
        title: say('crm.quote.node.written', 'Written'),
        at: version.createdAt,
      });
    }

    /*
     * ── THE DEADLINE THIS QUOTE CARRIED *WHEN IT WAS SENT* ──────────────────
     *
     * Not `valid_until`, which after an extension holds the NEW date. Reported
     * from the live drawer on 2026-11-16: a quote sent good until the 13th and
     * extended to the 17th read "Sent · Good until Nov 17", which is a sentence
     * about a deadline that did not exist on the day it describes — and it hid
     * the very change the spine was built to show.
     *
     * `extended_from` is exactly that original date, which is why it is stored.
     */
    const deadlineWhenSent =
      version.extendedFrom ??
      /*
       * Extended, but we do not know what the deadline WAS: say nothing rather
       * than fall back to `valid_until`, which is the date the extension moved
       * it TO. That fallback would print "sent, good until the 17th" on a quote
       * sent on the 13th, and date its lapse to a day in the future.
       *
       * Reachable for any extension recorded before `extended_from` existed —
       * the audit trail can supply `extended_at` for those, never the old date.
       */
      (version.extendedAt ? null : (version.validUntil ?? null));

    if (version.sentAt) {
      out.push({
        key: 'sent',
        tone: 'done',
        title: say('crm.quote.node.sent', 'Sent'),
        note: deadlineWhenSent
          ? say('crm.quote.node.good_until', 'Good until {date}').replace(
              '{date}',
              formatShortDate(deadlineWhenSent)
            )
          : null,
        at: version.sentAt,
      });
    }

    /*
     * Lapsed, placed BEFORE the extension because that is the order it happened
     * in. It ran past the deadline it had at the time, which is the same date
     * the Sent line names above.
     */
    const everLapsed = version.status === 'expired' || Boolean(version.extendedAt);
    if (everLapsed) {
      out.push({
        key: 'lapsed',
        tone: 'bad',
        title: say('crm.quote.node.lapsed', 'Lapsed'),
        note: say('crm.quote.node.lapsed_note', 'The price came off the table on its own'),
        /* Undated when the old deadline is unknown. The step still happened —
           an extension proves it — and dropping the line entirely would leave
           the extension below it with nothing to explain why it was needed. */
        at: deadlineWhenSent,
      });
    }

    /* The owner's own action, and the one the whole module exists for. */
    if (version.extendedAt) {
      out.push({
        key: 'extended',
        tone: 'act',
        title: say('crm.quote.node.extended', 'Put back on the table'),
        change:
          version.extendedFrom && version.validUntil
            ? {
                label: say('crm.quote.node.open_until', 'Open until'),
                from: formatShortDate(version.extendedFrom),
                to: formatShortDate(version.validUntil),
              }
            : undefined,
        at: version.extendedAt,
      });
    }

    if (version.viewedAt) {
      out.push({
        key: 'viewed',
        tone: 'done',
        title: say('crm.quote.node.opened', 'Opened by the client'),
        at: version.viewedAt,
      });
    } else if (version.sentAt) {
      /* Said plainly rather than left out: "never opened" is the most useful
         thing on the spine when a quote has gone quiet. */
      out.push({
        key: 'unopened',
        tone: 'idle',
        title: say('crm.quote.node.not_opened', 'Not opened yet'),
        at: null,
        pending: true,
      });
    }

    /* The outcome, whichever it was. */
    if (version.status === 'accepted' && version.decidedAt) {
      out.push({
        key: 'accepted',
        tone: 'done',
        title: say('crm.quote.node.accepted', 'Accepted'),
        note: version.signedBy
          ? say('crm.quote.node.signed_by', 'Signed by {name}').replace('{name}', version.signedBy)
          : null,
        at: version.decidedAt,
      });
    }

    /*
     * ── REFUSED, AND THEN REPLACED, IS STILL REFUSED ────────────────────────
     *
     * Not `status === 'declined'`. A quote the client turned down and the owner
     * then re-priced ends at `superseded`, because the newer version is what
     * the status now describes — but `decline_reason` and `decided_at` stay on
     * the row, and they are the whole reason the second version exists.
     *
     * Gating on the status alone meant the refusal disappeared the moment it
     * was answered: the live Marketing Plan chain showed a superseded ₪500 with
     * the client's own words underneath it and no step saying it had been
     * turned down at all.
     *
     * `accepted` is excluded outright. A decline reason on an agreed quote
     * would be a contradiction, and drawing it would be reporting one.
     */
    const wasDeclined =
      version.status === 'declined' ||
      (version.status !== 'accepted' && Boolean(version.declineReason || version.declineNote));

    if (wasDeclined && version.decidedAt) {
      out.push({
        key: 'declined',
        tone: 'bad',
        title: say('crm.quote.node.declined', 'Declined'),
        /* The reason is the useful half: it is what the next version is priced
           against. The owner's own typed note wins over the picked category —
           "we only have 8k budget" is worth more than "too expensive". */
        note:
          version.declineNote ||
          (version.declineReason
            ? reasonText(
                t,
                `proposal.decline.reason.${version.declineReason}`,
                version.declineReason
              )
            : null),
        at: version.decidedAt,
      });
    }

    if (version.status === 'withdrawn' && version.decidedAt) {
      out.push({
        key: 'withdrawn',
        tone: 'bad',
        title: say('crm.quote.node.withdrawn', 'Taken off the table'),
        at: version.decidedAt,
      });
    }

    if (version.status === 'superseded') {
      out.push({
        key: 'superseded',
        tone: 'info',
        title: say('crm.quote.node.superseded', 'Replaced by a newer version'),
        note: say('crm.quote.node.superseded_note', 'Kept on the record rather than overwritten'),
        at: version.decidedAt ?? null,
      });
    }

    /* What acceptance actually produced. The row has carried these ids since
       the quote system shipped and no surface ever said so. */
    if ((version.createdInvoiceId || version.createdPlanId) && version.decidedAt) {
      out.push({
        key: 'money',
        tone: 'info',
        title: say('crm.quote.node.became_money', 'Turned into money'),
        note: version.createdPlanId
          ? say('crm.quote.node.became_plan_note', 'Raised the invoice and the payment plan')
          : say('crm.quote.node.became_invoice_note', 'Raised the invoice'),
        at: version.decidedAt,
      });
    }

    if (version.stoppedAt) {
      out.push({
        key: 'stopped',
        tone: 'warn',
        title: say('crm.quote.node.stopped', 'Stopped part-way'),
        note:
          version.stopNote ||
          (version.stopReason
            ? reasonText(t, cancelReasonKey(version.stopReason), version.stopReason)
            : null),
        at: version.stoppedAt,
      });
    }

    /* Still the client's move, and when it runs out. */
    const open = version.status === 'sent' || version.status === 'viewed';
    if (open) {
      out.push({
        key: 'waiting',
        tone: 'idle',
        title: say('crm.quote.node.waiting', 'Waiting on the client'),
        note: version.validUntil
          ? say('crm.quote.node.lapses_on', 'Lapses on {date} unless answered').replace(
              '{date}',
              formatShortDate(version.validUntil)
            )
          : null,
        at: null,
        pending: true,
      });
    }

    return out;
  }, [version, formatShortDate, t]);

  /*
   * ── THE ACTIONS, ONLY WHERE THE SERVER WOULD ACCEPT THEM ──────────────────
   *
   * Extending requires `status = 'expired'` — the route makes that part of its
   * UPDATE filter, so offering the button on a live quote would be a promise
   * the product refuses with a 409. Pricing again has no such gate: a lapsed or
   * refused quote can always be replaced by a new version.
   */
  const canExtend = version.status === 'expired' && Boolean(onExtend);
  const canPriceAgain =
    Boolean(onPriceAgain) &&
    ['expired', 'declined', 'withdrawn'].includes(version.status);

  /*
   * Open by default. The spine exists because an owner could not see what had
   * happened; opening it closed would reinstate exactly that, and the fold is
   * only here so a long history does not dominate the card.
   */
  const [open, setOpen] = useState(defaultOpen);

  /*
   * Closed shows the LAST few: the end of the story is what an owner is
   * checking. A version that starts closed shows none at all until asked —
   * it is history, and its header line already says how it ended.
   */
  const visible = open ? nodes : defaultOpen ? nodes.slice(-FOLD_KEEP) : [];

  if (nodes.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col" dir={isRTL ? 'rtl' : 'ltr'}>
      {/*
        ── FOLDED ONCE THE STORY GETS LONG ──────────────────────────────────
        A quote that was sent and is waiting has three or four lines and reads
        better open. One that lapsed, was extended, reminded and read has seven,
        and seven lines of history under every quote turns the card into a log.

        The threshold is on the COUNT rather than on the status: what makes this
        worth folding is its length, and the same quote crosses the line by
        being acted on rather than by changing kind.
      */}
      {(nodes.length > FOLD_ABOVE || !defaultOpen) && (
        <button
          type="button"
          onClick={() => setOpen(current => !current)}
          aria-expanded={open}
          className="mb-1.5 self-start text-[11px] font-medium uppercase tracking-wider transition-colors"
          style={{ color: 'var(--v2-primary)', letterSpacing: '0.06em' }}
        >
          {open
            ? label(t, 'crm.quote.node.fold_hide', 'Hide the steps')
            : label(t, 'crm.quote.node.fold_show', 'Show all {count} steps').replace(
                '{count}',
                String(nodes.length)
              )}
        </button>
      )}

      {visible.map((node, index) => {
        const last = index === nodes.length - 1;

        return (
          <div key={node.key} className="relative flex gap-2.5">
            {/* the spine and its dot */}
            <div className="relative w-3 flex-shrink-0">
              {!last && (
                <span
                  aria-hidden="true"
                  className="absolute top-[13px] bottom-0 w-px"
                  style={{ insetInlineStart: '5px', background: 'var(--v2-border)' }}
                />
              )}
              <span
                aria-hidden="true"
                className="absolute block rounded-full"
                style={{
                  insetInlineStart: node.pending ? '1px' : '2px',
                  top: node.pending ? '8px' : '9px',
                  width: node.pending ? '9px' : '7px',
                  height: node.pending ? '9px' : '7px',
                  background: node.pending ? 'var(--v2-surface)' : TONE_COLOR[node.tone],
                  border: node.pending ? '1.5px solid var(--v2-border)' : undefined,
                  boxShadow:
                    node.tone === 'act'
                      ? '0 0 0 3px color-mix(in srgb, var(--v2-primary) 22%, transparent)'
                      : undefined,
                }}
              />
            </div>

            {/* the line itself */}
            <div className="min-w-0 flex-1 pb-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className="text-[12.5px] font-medium"
                  style={{
                    color: node.pending ? 'var(--v2-text-muted)' : 'var(--v2-text-primary)',
                  }}
                >
                  {node.title}
                </span>
                {node.at && (
                  <span
                    className="flex-shrink-0 text-[10.5px] tabular-nums"
                    style={{ color: 'var(--v2-text-muted)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatDateTime(node.at)}
                  </span>
                )}
              </div>

              {node.note && (
                <div className="text-[11.5px]" style={{ color: 'var(--v2-text-muted)' }}>
                  {node.note}
                </div>
              )}

              {/* the one line that says what changed */}
              {node.change && (
                <span
                  className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 text-[10.5px] tabular-nums"
                  style={{
                    borderRadius: '6px',
                    background: 'color-mix(in srgb, var(--v2-primary) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--v2-primary) 34%, transparent)',
                    color: 'var(--v2-text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span style={{ color: 'var(--v2-text-muted)' }}>{node.change.label}</span>
                  <span>{node.change.from}</span>
                  <span aria-hidden="true" style={{ color: 'var(--v2-primary)' }}>
                    {isRTL ? '←' : '→'}
                  </span>
                  <span className="font-medium">{node.change.to}</span>
                </span>
              )}

              {/* the action, beside the event that created the need for it */}
              {node.key === 'lapsed' && (canExtend || canPriceAgain) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {canExtend && (
                    <button
                      type="button"
                      onClick={() => onExtend?.(version.id, version.validUntil ?? null)}
                      className="px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                      style={{
                        borderRadius: '7px',
                        border: '1px solid color-mix(in srgb, var(--v2-primary) 55%, transparent)',
                        color: 'var(--v2-primary)',
                        background: 'transparent',
                      }}
                    >
                      {label(t, 'crm.quote.node.extend_action', 'Extend to a new date')}
                    </button>
                  )}
                  {canPriceAgain && (
                    <button
                      type="button"
                      onClick={() => onPriceAgain?.(version.id)}
                      className="text-[11.5px] underline transition-colors"
                      style={{ color: 'var(--v2-text-muted)', textUnderlineOffset: '2px' }}
                    >
                      {label(t, 'crm.quote.node.price_again_action', 'Price it again')}
                    </button>
                  )}
                </div>
              )}

              {/* a refused price is answered with a new version, never a later date */}
              {node.key === 'declined' && canPriceAgain && (
                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => onPriceAgain?.(version.id)}
                    className="px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                    style={{
                      borderRadius: '7px',
                      border: '1px solid color-mix(in srgb, var(--v2-primary) 55%, transparent)',
                      color: 'var(--v2-primary)',
                      background: 'transparent',
                    }}
                  >
                    {label(t, 'crm.quote.node.revise_action', 'Write a new version')}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default QuoteSubNodes;
