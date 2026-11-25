'use client';

/**
 * Everything waiting on the owner, and the one click that clears each of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * The work a small business loses is almost never work it decided against. It
 * is a form nobody answered, a quote nobody wrote, a quote written and never
 * sent, an intake form nobody chased, an invoice nobody followed up. Each one
 * was a single step away from done and each was invisible until somebody went
 * looking.
 *
 * ONE LIST, BECAUSE THEY ARE ONE PROBLEM
 *
 * They arrive from `findGaps`, which is also what the briefing reads — so the
 * card and the morning summary cannot disagree about what is outstanding. Every
 * row carries the action for its own kind, and the services behind all five
 * already existed: this card is wiring, not a new capability.
 *
 * NOTHING APPEARS HERE THAT THE OWNER CANNOT DO
 *
 * A quote sitting with a client who has not replied is genuinely outstanding
 * and genuinely not their move; it is reported in the briefing instead. A list
 * headed "needs you" that contains things you cannot act on is how somebody
 * learns to stop reading the list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Send, Check, Clock, AlertCircle, FileText, Bell, Receipt, Undo2, CalendarX, CalendarSearch, UserRound, Bot, Mail, Loader2 } from 'lucide-react';
import { ClientStandingPill } from '@/components/business-os/clients/ClientStandingPill';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CurrencyCode } from '@/lib/business-os/LanguageContext';
// One definition, in the registry that owns the vocabulary. Declared here too,
// the two would drift the first time an action was added.
import type { GapAction, GapItem } from '@/lib/business-os/gaps/types';
import { RefundModal } from '@/components/payments/RefundModal';
import { ExtendQuoteDialog } from './ExtendQuoteDialog';
import { RefundGapBlock } from '@/components/business-os/insight/RefundGapBlock';
import { MailGapBlock } from './MailGapBlock';
import { MailReplyBox } from './MailReplyBox';
import { mostUrgent, tasksOf } from '@/lib/business-os/gaps/mostUrgent';
/* Client-safe by construction — that module exists so a `'use client'` file
   can read the channel's provider facts without pulling the server bundle. */
import { mailThreadUrl } from '@/lib/business-os/leads/inboxProviders';
/* One resolver for 'he' → 'he-IL', shared with the billing and invite copy.
   A second mapping here would drift the first time a language is added. */
import { localeFor } from '@/components/business-os/settings/planUpgradeCopy';

export interface GapItemView {
  contactId: string;
  name: string;
  /* OPTIONAL, like `GapItem.note`. Required here, no `GapItem` could satisfy
     the view at all: every call passing one was a type error, which is how
     three of them accumulated behind the ignored build. */
  note?: string | null;
  /**
   * What is wrong with this client — `client_needs_a_word` only.
   *
   * Keys and counts rather than a sentence, rendered through the same copy the
   * drawer badge uses, so a client reads the same way wherever they appear. A
   * row may carry any combination of them, which is why no single dictionary
   * sentence could have stated it.
   */
  /*
   * TAKEN FROM `GapItem`, never re-typed.
   *
   * This listed three keys by hand while the source had four: `drift` was
   * added there and nothing here knew, so every call passing a `GapItem` to
   * this view became a type error — the same way `note` did. Deriving it means
   * the next key added to the source cannot silently break the card.
   */
  concerns?: GapItem['concerns'] | null;
  /** How far past the line this client is, 0–100, the line at 60. */
  score?: number | null;
  /** The word for it, shared with the drawer badge. */
  band?: 'reliable' | 'watch' | 'at_risk' | null;
  /**
   * The subject of the message this row is about. See `GapItem.subject`.
   *
   * Present only on the mail-driven gaps, and rendered as a quoted line rather
   * than as prose: it is the client's own words, and it is what an owner
   * recognises the thread by.
   */
  subject?: string | null;
  /**
   * The client's own words. See `GapItem.quote`.
   *
   * Set in quotation marks and in the text colour of body copy, because it is
   * the only line on the row that somebody else wrote.
   */
  quote?: string | null;
  /**
   * The mail thread this row is about. See `GapItem.threadId`.
   *
   * Null on rows filed before the column existed, and the card then offers no
   * mail link rather than one that lands on an empty search.
   */
  threadId?: string | null;
  /**
   * The reply the agent already wrote, and the draft object it became.
   * See `GapItem.draftBody`. Present on `reply_drafted` rows only.
   */
  draftBody?: string | null;
  draftId?: string | null;
  /** Which mailbox this came from; only Gmail can send from the card today. */
  viaProviderForReply?: string | null;
  /**
   * When this person was last answered from the card. See `GapItem.answeredAt`.
   *
   * The row STAYS when a reply is sent — the owner decides when a thread is
   * done — so this is what stops it going on claiming they are waiting.
   */
  answeredAt?: string | null;
  since: string;
  /* OPTIONAL, like `GapItem.entityId`. The last of the required-and-nullable
     fields that made a plain `GapItem` unassignable to this view — the same
     shape `note` had, found one layer down once that was fixed. */
  entityId?: string | null;
  /**
   * The booking to open, where `entityId` is not itself one.
   *
   * See `GapItem.bookingId`: `entityId` is whatever the action POSTS to, which
   * for `bill_stage` is a payment stage. Only the navigating actions read this.
   */
  bookingId?: string | null;
  /** Which session of a package. See `GapItem.sessionNumber`. */
  sessionNumber?: number | null;
  /**
   * A clock closed this hour, not a person. See `GapItem.autoHeld`.
   *
   * Changes two things on the row: it earns a sentence saying why it is here,
   * and its button becomes a confirmation rather than a charge.
   */
  autoHeld?: boolean | null;
  /**
   * WHY this row exists, as a translation key. See `GapItem.contextKey`.
   *
   * The row states a fact; this is the clause that made the owner open the
   * booking to understand it. A key rather than a sentence, because the gaps
   * are built server-side and this card renders in three languages.
   */
  contextKey?: string | null;
  /** Which channel brought the lead. See `GapItem.via`. */
  via?: string | null;
  /** And which mailbox, where one was recorded. */
  viaProvider?: string | null;
  /**
   * What is held on it, where money is involved.
   *
   * Decides the row's action for `booking_cancelled`, where one gap has two
   * moves: money on it is owed back, nothing on it is an hour to refill.
   */
  value?: number | null;
  currency?: string | null;
  /**
   * A payment plan still charging this client for a cancelled booking.
   *
   * The row's real urgency, and why it is never allowed to expire: until the
   * owner decides otherwise the card is debited again next period. Cancelling
   * an appointment deliberately does not end a payment arrangement.
   */
  planLive?: boolean | null;
  /** Only an enquiry can have an automatic reply queued. */
  queued?: {
    label: string | null;
    chosenBy: string | null;
    dueAt: string | null;
  } | null;
  /**
   * When `auto_complete_meetings` will answer this row itself.
   *
   * Present only on an unmarked meeting, and only while the automation is on
   * and the work is still queued. A TIME and nothing else — there is no button,
   * because the seven-day triage row already lets the owner correct an
   * auto-completed meeting and a Cancel here would buy ten hours of prevention
   * on top of a week of cure.
   *
   * What it fixes is silence: the card claimed the meeting two hours after it
   * ended and the automation answered at twelve, so for ten hours the row asked
   * the owner to do something the platform was about to do, said nothing about
   * it, and then disappeared.
   */
  closingAt?: string | null;
  /**
   * When this one's own moment is: a quote's deadline, an appointment's start.
   *
   * What `mostUrgent` promotes on — a decision about to be taken away outranks
   * one that is merely old. Absent on most gaps, where `since` is the whole
   * story.
   */
  eventAt?: string | null;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT A REFUND REQUEST CARRIES.
   *
   * This view type is written by hand, and every one of these was already
   * being read by the card while missing from here: `requestId`,
   * `refundReasoning`, `refundRecommendedAmount`, `refundViaProcessor` and
   * `noteKey` all resolved to a type error that `next.config.js` ignores, so
   * the code worked and the compiler could not help anybody who touched it.
   *
   * Declared now, together, because adding one more undeclared field to the
   * pile was the alternative.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /** The refund request this row is about, so declining can settle it. */
  requestId?: string | null;
  /** What the refund agent concluded, and why. */
  /* The same closed set `RefundGapBlock` accepts. Widened to `string` here,
     every pass into that block was a type error — and a typo in a fifth value
     would have rendered a blank recommendation rather than failing. */
  refundRecommendation?: 'refund_full' | 'refund_partial' | 'decline' | 'needs_owner' | null;
  refundRecommendedAmount?: number | null;
  refundReasoning?: string | null;
  /**
   * The reply the refund agent drafted for the client.
   *
   * Seeds the reply box, as a SUGGESTION rather than a draft: no Gmail draft
   * stands behind it. The agent wrote one from the day it shipped and nothing
   * read it, so the box opened empty under a finished recommendation.
   */
  refundClientDraft?: string | null;
  /** What is left to return, which is the ceiling on any amount offered. */
  refundableAmount?: number | null;
  refundPaymentsCount?: number | null;
  /* The booking a refund is about, and who is asking. Named here or the
     card never sees them — the same silent drop as every field above. */
  paidAmount?: number | null;
  paidAt?: string | null;
  paidMethod?: string | null;
  /** The mail a refund request came in, where it came in one. See `GapItem`. */
  sourceThreadId?: string | null;
  /** And which mailbox it is in: `google-mail` or `outlook`. */
  sourceThreadProvider?: string | null;
  bookedAt?: string | null;
  serviceMinutes?: number | null;
  servicePrice?: number | null;
  contactEmail?: string | null;
  clientSince?: string | null;
  refundsBefore?: number | null;
  bookingsWithYou?: number | null;
  /**
   * False when the money did not arrive through a processor, so the platform
   * can only RECORD that the owner returned it. Changes the button's word.
   */
  refundViaProcessor?: boolean | null;
  /** The note as a KEY, resolved in the reader's language by the card. */
  noteKey?: string | null;
  /** What the diary says happened, for answering without leaving the card. */
  bookingOutcomeKey?: string | null;
  bookingWhen?: string | null;
  bookingContradicts?: boolean | null;
  /*
   * `concerns`, `score` and `band` are declared ONCE, above.
   *
   * They were added to this interface a second time here, loosely typed
   * (`unknown`, `string`), which TypeScript reads as redeclaring the same
   * properties: three `Duplicate identifier` errors plus two `Subsequent
   * property declarations must have the same type`. The earlier declarations
   * are the real ones — they carry the literal unions the drawer badge shares
   * — so the weaker copy is gone rather than the typed one.
   */
}

export interface GapView {
  id: string;
  action: GapAction;
  count: number;
  items: GapItemView[];
}

interface NeedsYouCardProps {
  gaps: GapView[];
  /**
   * Fill the height it is given rather than stopping at its content.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * For the dashboard's top row, where this card shares a stretched grid track
   * with the usage dial. Both tracks are as tall as the taller card, and a
   * card that sizes to its own content leaves a gap under itself inside its
   * own track — which reads as one of the pair having failed to load rather
   * than as two cards of different lengths.
   *
   * The row's other two cards already do this; the comment on
   * `usage-readiness-row` records why. Off by default, because in its original
   * full-width position there is no track to fill and nothing to match.
   * ───────────────────────────────────────────────────────────────────────────
   */
  fill?: boolean;
  /** Refetch, so a cleared row leaves the list. */
  onChanged?: () => void;
}

type RowState =
  | { kind: 'idle' }
  /**
   * Asked, not yet done — the second tap is the real one.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Six of this card's actions used to fire on a single tap with nothing in
   * between: four of them put an email in a client's inbox, and one cancelled
   * a booking and told them about it. None could be taken back, and none of
   * the labels hinted at it — "Send it" and "Follow up" look exactly like
   * "Say what happened", which merely opens a screen.
   *
   * The inconsistency was the clearest sign something was wrong: refunding
   * money opened a confirmation, while mailing a client did not. The less
   * exposed action was the guarded one.
   *
   * Confirmed INLINE rather than in a dialog. The card holds several rows and
   * a modal per row would bury the list the owner came to read; the row simply
   * says what is about to leave and offers to go ahead.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /**
   * Confirming, and — on a refund decline — holding the message that will go
   * with it.
   *
   * The draft is fetched on the first tap and lives here rather than in a
   * state of its own, because it belongs to this row's confirmation and must
   * disappear with it: backing out has to leave nothing behind that a later
   * press could send.
   *
   * `drafting` is the wait. An empty box that fills a second later reads as a
   * bug, and an owner who presses through before it arrives would send
   * silence.
   */
  | { kind: 'confirming'; draft?: string; drafting?: boolean }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'refused'; message: string };

/**
 * Actions that change something outside this screen the moment they run.
 *
 * Four put an email in a client's inbox; `cancel_booking` calls off a booking
 * and tells them. Everything NOT listed here either opens a screen
 * (`write_quote`, `bill_stage`, `mark_meeting`) or raises its own dialog
 * (`refund`), and asking twice for those would be a click with nothing behind
 * it.
 */
/**
 * Actions that take the owner somewhere rather than doing anything.
 *
 * They open the contact drawer at the booking in question, and the work
 * happens there. Visually identical to the sending actions until now — the
 * same filled button in the same place — so nothing distinguished "this writes
 * an email to your client" from "this scrolls you to a form". Marked with a
 * chevron, which is the one convention a reader does not have to be taught.
 */
/**
 * Gaps whose `entityId` IS a booking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Only three definitions set `bookingId` — `stage_awaiting_completion`,
 * `booking_unbilled` and `delivery_unconfirmed` — and none of them are the gaps
 * most obviously about an appointment. The booking-centric ones put the booking
 * in `entityId`, because that is what their action posts to.
 *
 * So "is there a booking to open" cannot be read off one field. Gating on
 * `bookingId` alone hid the icon on exactly the rows an owner would want it on;
 * trusting `entityId` everywhere would pass an ACTIVITY id for
 * `meeting_auto_completed`, which reads from `crm_activities`, and a proposal id
 * for the quote gaps — landing on a list that highlights nothing.
 *
 * Listed rather than inferred, for the reason `OPENS_A_SCREEN` below is: the set
 * is small, it is a fact about each definition, and a wrong guess sends the owner
 * somewhere that looks broken.
 */
const ENTITY_IS_A_BOOKING = new Set<string>([
  'meeting_unmarked',
  'booking_refunded',
  'meeting_upcoming',
]);

const OPENS_A_SCREEN = new Set<string>([
  'write_quote',
  'bill_stage',
  'mark_meeting',
  /* Raising an invoice decides an amount, a due date and tax; confirming a
     handover decides that work left the owner's hands. Neither is a thing a
     dashboard button should settle on their behalf. */
  'send_invoice',
  'mark_delivered',
]);

/**
 * Actions the REPLY BOX now performs, whose button must not also be drawn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `answer_client` never worked. It was declared on the gap and added to the
 * `GapAction` union, and that is the entire extent of it: no case in
 * `endpointFor`, no entry in `OPENS_A_SCREEN`, none in `LEAVES_THE_BUILDING`,
 * not even an icon. Pressing it fell through to `default: return null` and set
 * the row to `refused` with the generic message.
 *
 * It was not an oversight so much as a placeholder — when the gap was written
 * there was no way to answer a client from this card, so the button named the
 * work without being able to do it. An owner pressing it got "something went
 * wrong" for a task nothing had gone wrong with.
 *
 * `MailReplyBox` is now the real control, and it is a box with its own send,
 * confirm and discard. Leaving the old button beside it would put two answers
 * to one question on the row, one of which still cannot work.
 *
 * A SET rather than a check on the gap id, because the question is "does
 * something else on this row already do this", which is a fact about the
 * ACTION. The row keeps its "open the client" door either way.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const THE_REPLY_BOX_DOES_THIS = new Set<string>(['answer_client']);

const LEAVES_THE_BUILDING = new Set<string>([
  'send_booking_link',
  'send_quote',
  'chase_quote',
  'chase_intake',
  'chase_payment',
  'cancel_booking',
]);

/** What `formatCurrency` can render. Anything else is shown as a bare figure. */
const SUPPORTED_CURRENCIES: CurrencyCode[] = ['USD', 'EUR', 'ILS', 'GBP'];

/** The icon says what KIND of work this is before the label is read. */
/**
 * The refund row brings its own buttons, so the generic one must stand down.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It had FOUR. The generic action button renders for any row with an `action`,
 * and `refund_requested` has one (`refund`, which opens the dialog). Giving the
 * row a one-click approve and a "different amount" beside it did not replace
 * that button — it sat there as a fourth, saying "refund" next to one saying
 * "refund ₪74.99", with no way to tell which was which.
 *
 * Same reasoning as `THE_REPLY_BOX_DOES_THIS`: when a row has grown a better
 * answer of its own, the generic one is noise, not a fallback.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const THE_REFUND_ROW_ANSWERS_ITSELF = (gap: GapView): boolean =>
  gap.id === 'refund_requested';

const ACTION_ICON: Record<string, typeof Send> = {
  send_booking_link: Send,
  write_quote: FileText,
  send_quote: Send,
  chase_intake: Bell,
  chase_payment: Receipt,
  refund: Undo2,
  bill_stage: Receipt,
  cancel_booking: CalendarX,
};

/**
 * The move for ONE row, which is not always the move for its gap.
 *
 * Every other gap has a single answer, so the action lives on the gap. A
 * cancelled booking does not: if the client paid, the business is holding money
 * for an appointment that is not happening and owes it back; if they did not,
 * nothing is owed and what is left is an hour somebody else could have. Showing
 * "Refund" on a booking nobody paid for would be a button that cannot work, and
 * showing "Send booking link" on one where money is held hides the debt.
 */
function actionFor(gap: GapView, item: GapItemView): GapAction {
  if (gap.id !== 'booking_cancelled') return gap.action;
  /*
   * A live plan takes precedence over an empty balance. Offering "send booking
   * link" on a booking whose client is still being charged answers the wrong
   * question entirely — the money is what needs a decision.
   */
  return moneyHeld(item) || item.planLive ? 'refund' : 'send_booking_link';
}

function moneyHeld(item: GapItemView): boolean {
  return typeof item.value === 'number' && item.value > 0;
}

/**
 * What the figure on a row MEANS, which is not the same on every gap.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `value` is one field carrying five different facts, and every row was
 * labelled "holding" — the one reading that is true of exactly ONE of them.
 *
 *   booking_cancelled          money actually taken and not refunded   HELD
 *   stage_awaiting_completion  work done that nobody has billed        NOT held
 *   invoice_unpaid             what the client owes                    NOT held
 *   quote_unsent               what the quote comes to                 NOT held
 *   quote_awaiting_client      what the quote comes to                 NOT held
 *
 * So a phase waiting to be billed read "holding ₪705" — the exact opposite of
 * what it is. The owner is holding nothing; the client has not been charged,
 * and the button beside it says "mark done and bill".
 *
 * Defaults to `held`, because the default row IS the cancelled booking: a gap
 * added later with a value that is genuinely held needs no entry here, and one
 * that is not needs a deliberate line.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ROWS THAT ARE AN EMAIL CONVERSATION, and therefore get a reply box.
 *
 * This was inferred from `item.subject` being set, which was true for exactly
 * as long as one gap set it. `refund_requested` then set it too — a booking's
 * name, not a mail subject — and inherited the whole conversation apparatus: a
 * rich-text reply editor, an "add link" button, and a "mark as handled" that
 * finishes a correspondence nobody started. A client who filled in a form had
 * their request rendered as an email they never sent.
 *
 * Naming the gaps makes the claim checkable. A gap that genuinely arrives as
 * mail adds itself here deliberately; everything else renders its facts and
 * its own action, which is what a form submission actually needs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const CONVERSATION_GAPS = new Set<string>(['client_reply_waiting']);

/**
 * The name the owner would use writing to them: the first one.
 *
 * "Your reply to Tal Omer" is how a form addresses somebody; "Your reply to
 * Tal" is how a person does, and this box is a person writing. Falls back to
 * the whole string, which is what a one-word name already is.
 */
/**
 * How long ago, as the origin sentence needs it.
 *
 * `waitedFor` gives the span — "3h", "2d" — or "just now" under an hour.
 * "just now ago" is not English, so only the span takes the suffix.
 */
function agoOf(since: string, t: (key: string) => string): string {
  const span = waitedFor(since, t);
  return span === t('gaps.just_now') ? span : t('gaps.ago').replace('{t}', span);
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The client, in one line under the headline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A LINE AND NOT A PANEL
 *
 * A refund asks the owner to judge a person as well as a booking, and the
 * question is small: is this a pattern, how long have they been here, and how
 * do I reach them. A panel of tiles answered that and pushed the decision
 * another screen down; a list of past refunds is a page of its own.
 *
 * Every part is optional and the line renders only what it has. `refundsBefore`
 * ABSENT means the count could not be read, and says nothing at all — a
 * confident "no refunds" on an unreadable count is a claim about somebody's
 * history that nobody checked.
 */
function ClientLine({
  item,
  contextKey,
  age,
  t,
  language,
}: {
  /** Where the request came from, as a key — see the note below. */
  contextKey?: string | null;
  /** How long ago they asked, relative — "3h ago", "just now". */
  age?: string | null;
  /*
   * The four fields this reads, not the whole view type.
   *
   * `GapItem` and `GapItemView` have drifted — the view's optional strings are
   * `| null` where the item's are `| undefined` — so demanding the view here
   * made every list row that passes a plain `GapItem` a type error, for a
   * component that touches four fields. Asking for the shape it uses makes it
   * work from both, and stops this line inheriting a disagreement it has no
   * part in.
   */
  item: {
    contactEmail?: string | null;
    clientSince?: string | null;
    refundsBefore?: number | null;
    bookingsWithYou?: number | null;
  };
  t: (key: string) => string;
  language?: string;
}) {
  const parts: string[] = [];

  if (typeof item.refundsBefore === 'number') {
    parts.push(
      item.refundsBefore === 0
        ? t('gaps.client.no_refunds')
        : item.refundsBefore === 1
          ? t('gaps.client.one_refund')
          : t('gaps.client.refunds').replace('{n}', String(item.refundsBefore))
    );
  }

  if (typeof item.bookingsWithYou === 'number' && item.bookingsWithYou > 0) {
    parts.push(
      item.bookingsWithYou === 1
        ? t('gaps.client.first_booking')
        : t('gaps.client.bookings').replace('{n}', String(item.bookingsWithYou))
    );
  }

  if (item.clientSince) {
    parts.push(
      t('gaps.client.since').replace(
        '{date}',
        new Date(item.clientSince).toLocaleDateString(language || undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      )
    );
  }

  /* Nothing known about them is not a line worth a row of its own. */
  /*
   * ONE PHRASE: "Asked 3h ago in your client portal".
   *
   * This was `t(contextKey)` and the age joined by a dot, which read as two
   * fragments about one event — and the age was the long date, answering a
   * question nobody asked. `where` is the last segment of the context key, so
   * a new source adds one short noun and nothing else.
   *
   * Falls back to the context sentence whole when the composed form has no
   * copy for that source, so an unmapped origin still says something true.
   */
  const source = contextKey ? contextKey.split('.').pop() ?? '' : '';
  const where = source ? t(`gaps.refund.where.${source}`) : '';
  const hasWhere = Boolean(where) && !where.startsWith('gaps.');
  /*
   * The phrase is SPLIT at the `{where}` slot rather than substituted into it,
   * because the source is the one part of this line worth a colour: it is how
   * the owner knows whether this came through a form they control or an email
   * they have to go and read. Splitting keeps the slot wherever the language
   * puts it — Hebrew ends the sentence with it — instead of assuming it comes
   * last.
   */
  /*
   * The age is carried only where the row does not already show a clock. A
   * list row has "waiting 4h" of its own under it, and saying 4h twice on one
   * row is how this card got busy in the first place.
   */
  const asked = hasWhere
    ? age
      ? t('gaps.refund.asked_via').replace('{age}', age)
      : t('gaps.refund.asked_in')
    : '';
  const [beforeWhere, afterWhere] = hasWhere ? asked.split('{where}') : ['', ''];
  const origin = hasWhere ? null : contextKey ? t(contextKey) : null;

  if (!parts.length && !item.contactEmail && !contextKey) return null;


  return (
    <>
      {/*
        HOW TO REACH THEM, AND WHERE IT CAME FROM — on one line, in the header.

        The origin used to live inside the block and the age beside the title,
        so a card said when it arrived twice and said where it came from below
        the thing it came about. Both belong to the request, and the request is
        the headline — so they sit under it, and the block starts at the
        booking.
      */}
      <p className="text-[11.5px] text-[var(--v2-text-muted)] mb-0.5 flex flex-wrap items-center gap-x-1.5">
        {item.contactEmail && (
          <a
            href={`mailto:${item.contactEmail}`}
            className="underline decoration-[var(--v2-border)] underline-offset-2 hover:text-[var(--v2-text-secondary)]"
            style={{ unicodeBidi: 'plaintext' }}
          >
            {item.contactEmail}
          </a>
        )}
        {(hasWhere || origin) && (
          <>
            {item.contactEmail && <span aria-hidden="true">·</span>}
            {hasWhere ? (
              <span>
                {beforeWhere}
                <span className="font-medium" style={{ color: 'var(--v2-warning, #d97706)' }}>
                  {where}
                </span>
                {afterWhere}
              </span>
            ) : (
              <span>{origin}</span>
            )}
          </>
        )}
      </p>

      {parts.length > 0 && (
        <p className="text-[11.5px] text-[var(--v2-text-muted)] mb-1.5 flex flex-wrap items-center gap-x-1.5">
          {parts.map((part, i) => (
            <span key={part} className={i === 0 ? 'font-medium text-[var(--v2-text-secondary)]' : ''}>
              {i > 0 && <span aria-hidden="true" className="me-1.5">·</span>}
              {part}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/**
 * May this row be answered from the card?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CONVERSATION IS NOT THE ONLY THING WORTH ANSWERING.
 *
 * The list gated its reply box on `CONVERSATION_GAPS` alone, which holds one
 * entry: `client_reply_waiting`. The PROMOTED row has never had that condition
 * — it shows the box on anything with a subject — so a refund request showed
 * its drafted reply while it was the next thing up, and lost it the moment the
 * list was expanded and the same request became a row. Same request, same
 * draft, two different cards.
 *
 * Reported from exactly that: "it was there before and it is gone now", on a
 * refund whose `client_message_draft` was sitting in the database the whole
 * time.
 *
 * So the question is not "is this a mail thread" but "is there something here
 * to send". A refund request has no thread to reply into — `MailReplyBox`
 * already handles that by offering no Send and pointing at the mailbox — but it
 * does have a reply the agent wrote, and an owner who wants to edit it.
 */
function canAnswerHere(gapId: string, item: { refundClientDraft?: string | null }): boolean {
  return CONVERSATION_GAPS.has(gapId) || Boolean(item.refundClientDraft);
}

const VALUE_LABEL: Record<string, string> = {
  /* What the work came to, and nobody has asked for it. Not held: the client
     has not been charged at all. */
  booking_unbilled: 'gaps.value.to_bill',
  stage_awaiting_completion: 'gaps.value.to_bill',
  invoice_unpaid: 'gaps.value.owed',
  /* What the CLIENT asked for, which is neither what is held nor what will be
     returned. The business may hold more (they under-asked) or the same. Saying
     "held by you" of this figure states a balance that is not this number. */
  refund_requested: 'gaps.value.requested',
  quote_unsent: 'gaps.value.quoted',
  quote_awaiting_client: 'gaps.value.quoted',
  quote_deadline_unanswered: 'gaps.value.quoted',
};

/**
 * The lead task, said as a sentence rather than labelled as a category.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The grouped list had to be terse: a heading, a name, a clock. Showing ONE
 * task buys room for the half that was always missing — not "Phase ready to
 * bill" but "Ofir's phase B is done and nobody has billed it".
 *
 * Built from the copy keys rather than composed here, so the three languages
 * stay in the dictionaries with every other string. `{name}` and `{what}` are
 * substituted; a gap with no sentence of its own falls back to its existing
 * `gaps.kind.*` label, which is what the card said before and is never wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function leadSentence(
  gapId: string,
  item: GapItemView,
  t: (key: string) => string,
  money: (amount: number, currency?: string | null) => string
): string {
  const key = `gaps.lead.say.${gapId}`;
  const say = t(key);
  /* `t` returns the key itself when there is none. */
  const template = say === key ? t(`gaps.kind.${gapId}`) : say;

  /*
   * `{what}` IS NOT SUBSTITUTED, AND THAT IS THE POINT.
   *
   * `note` is a service name or a proposal title — arbitrary text the owner
   * typed. The first version of these sentences slotted it in as a grammatical
   * object ("{name} cancelled {what}"), which produced
   *
   *     "דויד המלך ביטל את הצעת מחיר לשיפוץ"
   *
   * on an account whose SERVICE is called "הצעת מחיר לשיפוץ" — read as a
   * cancelled proposal rather than a cancelled appointment for a service with
   * that name. Hebrew made it worse: the templates carried prefixes like
   * `ל{what}`, which assume whatever follows takes that preposition.
   *
   * So the sentence says what the gap IS, in words this module controls, and
   * the owner's own text is rendered beside it as a detail. A name the platform
   * did not write never has to be grammatical.
   */
  return template
    .replace('{name}', item.name)
    .replace('{amount}', moneyHeld(item) ? money(item.value as number, item.currency) : '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The second line: the consequence of leaving it, where there is one.
 *
 * Deliberately separate from the sentence above. "Her card is still being
 * charged" is not a description of the task, it is the reason it leads the
 * card — and an owner who has read it once does not need it restated inside
 * the sentence every time.
 *
 * Absent for most gaps, and then nothing is rendered rather than a blank line.
 */
/**
 * Does this gap's sentence already name the money?
 *
 * Only `booking_cancelled` does — "…and you are holding {amount}" — and where
 * it does, the row must not ALSO print the figure in its own column: one row
 * stating one sum twice reads as two sums. The column keeps every other row,
 * which is what makes the money a column at all.
 *
 * Asked of the template rather than hardcoded to a gap id, so a sentence that
 * grows an amount later takes care of itself.
 */
/**
 * A gap whose own text already shows the figure, so the meta strip must not
 * show it a second time.
 *
 * Two ways that happens. A lead sentence can interpolate `{amount}` — the
 * original case, read off the dictionary. Or a gap can have a BLOCK that
 * leads with the figure, which no dictionary lookup can see: `RefundGapBlock`
 * puts the amount asked for at the top, in the size the figure deserves,
 * because on a refund request the amount is the question rather than a
 * detail. Showing it again in the top-right strip beside the clock said the
 * same number twice and put the quieter copy where the eye goes first.
 */
const BLOCKS_THAT_LEAD_WITH_THE_AMOUNT = new Set<string>(['refund_requested']);

function sentenceCarriesAmount(gapId: string, t: (key: string) => string): boolean {
  if (BLOCKS_THAT_LEAD_WITH_THE_AMOUNT.has(gapId)) return true;
  const key = `gaps.lead.say.${gapId}`;
  const say = t(key);
  return say !== key && say.includes('{amount}');
}

function leadQualifier(
  gapId: string,
  item: GapItemView,
  t: (key: string) => string,
  /* Same reason as `onDay` below: `undefined` is the BROWSER's locale, not the
     one the owner chose, so a Hebrew card printed an English clock. */
  language: string
): string | null {
  if (item.planLive) return t('gaps.lead.why.plan_live');

  if (gapId === 'meeting_unmarked' && item.closingAt) {
    return t('gaps.lead.why.closing').replace(
      '{time}',
      new Date(item.closingAt).toLocaleTimeString(localeFor(language), { hour: '2-digit', minute: '2-digit' })
    );
  }

  const key = `gaps.lead.why.${gapId}`;
  const why = t(key);
  return why === key ? null : why;
}

/**
 * Identifies ONE row, for React and for the working/done/refused state.
 *
 * The contact alone is not enough. A person can have two unpaid invoices or
 * cancel two appointments, and those rows then shared a key: React warned about
 * the duplicate, and pressing the button on one of them showed "Done" on both
 * while only one had actually been sent. The entity is what makes them two.
 */
function rowKey(gap: GapView, item: GapItemView): string {
  return `${gap.id}:${item.contactId}:${item.entityId ?? ''}`;
}

export function NeedsYouCard({ gaps, onChanged, fill = false }: NeedsYouCardProps) {
  const { t, isRTL, formatCurrency, language, timeZoneOptions } = useLanguage();

  /**
   * The amount in the currency THE CLIENT WAS CHARGED.
   *
   * `formatCurrency` otherwise falls back to the device's remembered display
   * currency, which is a per-browser preference and not what the invoice says.
   * A business in Israel can bill a US client in dollars, and telling the owner
   * they owe ₪400 when they are holding $400 is a wrong number on a refund
   * button.
   */
  const money = (amount: number, currency?: string | null) => {
    const code = (currency || '').toUpperCase();
    // Only the four it knows. An unrecognised code would render as a symbol
    // for a currency nobody was charged, so fall back to the plain figure.
    /*
     * `showFree: false`, because zero here is not a price.
     *
     * `formatCurrency` says "Free" for 0, which is right on a service nobody
     * is charged for and wrong on every figure this card shows: a booking with
     * nothing left to refund would have read "Refundable right now · Free"
     * over money the owner had just sent back.
     */
    return SUPPORTED_CURRENCIES.includes(code as CurrencyCode)
      ? formatCurrency(amount, { currencyOverride: code as CurrencyCode, showFree: false })
      : `${amount.toLocaleString()}${code ? ` ${code}` : ''}`;
  };
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ROWS THE OWNER HAS CLEARED, REMEMBERED HERE RATHER THAN REFETCHED.
   *
   * `onChanged` is `fetchDashboardData`, which re-reads the WHOLE dashboard:
   * my-day, stats, pipeline stages and two channel-insight calls, plus the
   * gaps. That is the right response to an action whose effects are spread
   * across the page — a refund, a cancelled booking — and completely the wrong
   * one for taking a single row off a single list. On screen it reads as the
   * page reloading, which is what the owner reported.
   *
   * So a settled row is dropped locally and nothing is refetched. The server
   * has already recorded it; this is only the list catching up. The next
   * natural refresh agrees, because the gap now excludes that contact.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [clearedRows, setClearedRows] = useState<Set<string>>(() => new Set());
  /*
   * The card leads with ONE task and keeps the rest behind a line.
   *
   * Eight tasks used to cost a heading, three lines and a button each, so a
   * quiet day read as a wall and the owner picked by position rather than by
   * importance. Showing one makes the ORDER the product — see `mostUrgent`,
   * which is why that lives in its own tested module rather than in a sort
   * here.
   *
   * The full list is not replaced, it is folded: opening this renders exactly
   * what the card rendered before, so nothing an owner could do yesterday is
   * gone.
   */
  const [expanded, setExpanded] = useState(false);
  /** The booking whose refund dialog is open, if any. */
  const [refunding, setRefunding] = useState<{
    bookingId: string;
    /** The CEILING — what is still refundable, never what the client asked. */
    amount: number;
    currency: string;
    name: string;
    /** Open on the partial tab, for "a different amount". */
    startPartial?: boolean;
    /** The agent's figure, so the owner adjusts rather than types. */
    prefillAmount?: number;
    /** The client's own reason and words — the same keys the dialog uses. */
    reasonKey?: string;
    reasonNote?: string;
  } | null>(null);
  /**
   * The lapsed quote whose extend dialog is open, if any.
   *
   * Held like `refunding` and for the same reason: the action needs an answer
   * — here a new date — that a fire-and-forget POST cannot invent.
   */
  const [extending, setExtending] = useState<{
    proposalId: string;
    name: string;
    lapsedOn: string | null;
  } | null>(null);

  const setRow = (key: string, state: RowState) => setRows(prev => ({ ...prev, [key]: state }));

  /**
   * Take a mail row off the card, because the owner says it is done.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * On the ROW rather than inside the reply box, and that is the point of it.
   * The box collapses once a reply has gone, so a clear button living there
   * moved depending on what you last did — present after sending, somewhere
   * else before it. This sits beside the "open the client" icon, which is
   * where every other row on this card keeps its action.
   *
   * It is the only thing that writes `reply_handled`. Sending does not: a
   * reply frequently opens the next question, and the owner decides when a
   * thread is finished. See the route.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /**
   * The owner says no.
   *
   * The other half of a decision whose yes is the refund dialog. A refund
   * request had only "mark as handled" beside it, which closed the row without
   * recording what was decided — so a week later nothing could say whether the
   * money went back or the client was turned down.
   *
   * TWO ANSWERS, NEITHER OF WHICH IS A REFUND.
   *
   *   declined  the owner said no
   *   handled   they dealt with it themselves — a transfer, a phone call
   *
   * Both settle the request AND the conversation it came from, so the client
   * is not left on a card asking the owner to reply to something they have
   * just answered. Neither can mark money as returned: that comes from a
   * refund actually happening. See the route's header.
   */
  /**
   * Take the agent's recommendation, in one press.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE SAME ROUTE THE DIALOG POSTS TO. No second refund path: `/api/payments/
   * refunds` owns the cap, the row lock, the idempotency, the ledger row and
   * the client's email, and it keeps owning them here.
   *
   * The comment on `act` lists three reasons a direct POST used to be wrong,
   * and all three now have answers rather than being argued away:
   *
   *   a payment plan        `canApproveInOneClick` refuses the one-click
   *                         button outright when one is live. Stopping future
   *                         charges is a decision, and the dialog asks it.
   *   telling the client    `notify_contact: true`, where the route defaults
   *                         to silence. A refund the client is never told
   *                         about is how the next email starts.
   *   money outside Stripe  `manual: !viaProcessor`. The route has always
   *                         taken this; nothing was passing it. The button
   *                         says "mark as returned" in that case, because
   *                         that is what happens.
   *
   * It is offered ONLY where the agent named a figure, so the owner is
   * pressing a number they can read on the card — never a blank "refund".
   * ───────────────────────────────────────────────────────────────────────────
   */
  const approveRefund = async (gap: GapView, item: GapItemView) => {
    const key = rowKey(gap, item);
    const amount = item.refundRecommendedAmount;

    if (!item.entityId || typeof amount !== 'number' || amount <= 0) {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
      return;
    }

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch('/api/payments/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: item.entityId,
          amount,
          /*
           * THE CLIENT'S OWN REASON, which is already in this dialog's
           * vocabulary: the portal form and `REFUND_REASON_KEYS` use the same
           * keys, so `no_show` needs no translation on the way in.
           */
          reason: item.noteKey?.replace('payments.refund.reason.', '') || 'goodwill',
          /*
           * The route requires a note and the form does not, so a client who
           * picked a reason and typed nothing would 400. Their words when they
           * wrote any, the agent's reasoning when they did not — never an
           * empty string, and never something invented about why.
           */
          reason_note:
            item.quote?.trim() || item.refundReasoning?.trim() || t('gaps.refund.note_fallback'),
          notify_contact: true,
          manual: item.refundViaProcessor === false,
          /*
           * Stable for this request, so a double press — or React's double
           * invoke — is one refund and not two. The request id is the natural
           * key: it is exactly "this client's one open ask about this booking".
           */
          client_request_id: `gap-refund-${item.requestId ?? item.entityId}`,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        /* The route's own message, which names the real cause — over-refund,
           no Stripe reference, already refunded. Far better than a generic
           line on the one action that moves money. */
        setRow(key, {
          kind: 'refused',
          message: String(payload?.error || t('gaps.refused.generic')),
        });
        return;
      }
      setRow(key, { kind: 'done' });
      onChanged?.();
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  /**
   * Whether this row may offer the one-click button at all.
   *
   * Every clause is a case where one press would hide a decision from the
   * owner, so the dialog becomes the only path rather than the alternative.
   */
  const canApproveInOneClick = (item: GapItemView): boolean =>
    /* The agent named a figure. `needs_owner` and `decline` name none, and a
       confident button under "I cannot decide this" would contradict it. */
    typeof item.refundRecommendedAmount === 'number' &&
    item.refundRecommendedAmount > 0 &&
    /* And it is within what is actually left — never what was asked for. */
    typeof item.refundableAmount === 'number' &&
    item.refundRecommendedAmount <= item.refundableAmount &&
    /* One payment behind the booking. Two means choosing which, and that is
       the dialog's job — it already knows how to ask. */
    item.refundPaymentsCount === 1 &&
    /* No live payment plan: stopping future charges is its own decision. */
    !item.planLive;

  const answerRefund = async (
    gap: GapView,
    item: GapItemView,
    decision: 'declined' | 'handled'
  ) => {
    const key = rowKey(gap, item);
    if (!item.requestId) {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
      return;
    }

    /*
     * ── ASK ONCE BEFORE SAYING NO TO SOMEBODY'S MONEY ──────────────────────
     *
     * `act()` has had this since the sends did: one tap sets the row to
     * `confirming`, the second goes through. Declining never used `act()`, so
     * it never inherited the question — a single stray tap closed a client's
     * refund request for good, with no way back and nothing on screen asking
     * whether that was meant.
     *
     * Only the decline. `handled` records something the owner has already
     * done outside the platform, so it describes the past rather than deciding
     * anything, and a confirmation there would be ceremony.
     *
     * The check reads the ROW, for the reason the note in `act()` gives: a
     * second entry point that forgot a flag would skip the question silently.
     */
    if (decision === 'declined' && rows[key]?.kind !== 'confirming') {
      setRow(key, { kind: 'confirming', drafting: true });

      /*
       * And while they decide, draft what the client will be told.
       *
       * Asked for here rather than after the decision because a declined
       * request leaves the card the instant it is recorded — a draft produced
       * then would have nowhere to be read. This way the confirmation is not
       * a yes/no prompt but the message itself, which is the thing actually
       * worth confirming.
       *
       * It writes nothing and decides nothing, so backing out costs only the
       * draft. A failure leaves an empty box: the owner can still write it, or
       * send nothing, exactly as before.
       */
      void (async () => {
        try {
          const response = await fetch('/api/business-os/refund-requests/decline-draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: item.requestId }),
          });
          const payload = await response.json();
          setRows(prev =>
            /* Only if they are still on this confirmation. A draft that
               arrives after they backed out must not reopen it. */
            prev[key]?.kind === 'confirming'
              ? { ...prev, [key]: { kind: 'confirming', draft: payload?.data?.draft ?? '', drafting: false } }
              : prev
          );
        } catch {
          setRows(prev =>
            prev[key]?.kind === 'confirming'
              ? { ...prev, [key]: { kind: 'confirming', draft: '', drafting: false } }
              : prev
          );
        }
      })();

      return;
    }

    /* What they approved, if anything. An empty box sends nothing, which is
       what declining did before this existed. */
    const approved =
      rows[key]?.kind === 'confirming' ? (rows[key] as { draft?: string }).draft?.trim() : undefined;

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch('/api/business-os/refund-requests/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: item.requestId,
          decision,
          ...(decision === 'declined' && approved ? { message: approved } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
        return;
      }
      setRow(key, { kind: 'done' });
      onChanged?.();
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  const settleMailRow = async (gap: GapView, item: GapItemView) => {
    const key = rowKey(gap, item);
    setRow(key, { kind: 'working' });
    try {
      const response = await fetch('/api/business-os/gaps/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'handled',
          contactId: item.contactId,
          threadId: item.threadId ?? undefined,
          subject: item.subject ?? undefined,
        }),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'done' });
        /* Let them see it tick, then drop it. No dashboard refetch: see
           `clearedRows`. */
        setTimeout(() => setClearedRows(prev => new Set(prev).add(key)), 700);
        return;
      }
      setRow(key, { kind: 'refused', message: data?.error || t('gaps.refused.generic') });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  /**
   * Where each action goes.
   *
   * Every one of these endpoints already existed and is already used elsewhere
   * — the contact drawer sends intake forms and resends invoices through the
   * same two. Nothing new is being asked of the server.
   */
  const endpointFor = (action: GapAction, item: GapItemView): string | null => {
    switch (action) {
      case 'send_booking_link':
        return `/api/crm/contacts/${item.contactId}/send-booking-link`;
      case 'send_quote':
        return item.entityId ? `/api/business-os/proposals/${item.entityId}/send` : null;
      case 'chase_intake':
        return item.entityId ? `/api/scheduling/bookings/${item.entityId}/intake` : null;
      case 'chase_payment':
        /*
         * `/chase`, NOT `/send`.
         *
         * `/send` is invoice DELIVERY — it raises the bill and stamps
         * `sent_at`. Pointed here, "chase payment" re-sent the original
         * invoice byte for byte: no mention of the due date it had passed, no
         * days-overdue, nothing saying we had asked before. The client read a
         * duplicate, not a reminder.
         *
         * `/chase` is what the `chase_overdue_invoices` agent sends, so a late
         * invoice now reads the same whether a person or the agent chased it.
         */
        return item.entityId ? `/api/payments/invoices/${item.entityId}/chase` : null;
      /*
       * The same reminder the automation sends, sent now because the owner
       * pressed it rather than because three days passed. One endpoint for
       * both, so a quote cannot be followed up in two different voices.
       */
      case 'chase_quote':
        return item.entityId ? `/api/business-os/proposals/${item.entityId}/remind` : null;
      case 'cancel_booking':
        return item.entityId ? `/api/scheduling/bookings/${item.entityId}/cancel` : null;
      /*
       * No `refund` case on purpose: `act` opens `RefundModal` before reaching
       * here, because refunding needs answers a fire-and-forget POST cannot
       * give — stop the plan, tell the client, was this even a Stripe payment.
       */
      default:
        return null;
    }
  };

  /**
   * Stop or hurry a reply that is queued but has not gone yet.
   *
   * The fifteen-minute window only means something if there is something to
   * press inside it — a card that announces "sending in 12 minutes" and offers
   * no way to intervene is worse than one that says nothing, because it shows
   * the owner a decision being taken without them.
   */
  const control = async (item: GapItemView, action: 'cancel' | 'send_now') => {
    const key = `queued:${item.contactId}`;
    setRow(key, { kind: 'working' });

    try {
      const response = await fetch(`/api/business-os/leads/${item.contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, kind: 'invite' }),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'idle' });
        onChanged?.();
        return;
      }

      // Losing the race with the runner is the honest answer, not an error.
      setRow(key, { kind: 'refused', message: translateReason(t, data?.reason) });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  /**
   * The other answer to a refunded booking: leave it in the diary.
   *
   * A refund is not a cancellation — money goes back as goodwill while the
   * session still happens — so this row has two answers and neither is a
   * default. Saying "keep it" also lets the client's reminder resume, which is
   * held while the question is open.
   */
  /**
   * "I am keeping this." The answer the refund row never had.
   *
   * A deposit forfeited inside its own cancellation window is ordinary and
   * agreed in advance, but the gap's rule is "money owed stays until it is
   * given back" — so an owner who decided to keep it was asked again the next
   * day, and the day after. The one row on this card that could not be
   * dismissed was the one about money.
   *
   * Records the decision and touches nothing else: the payment stays where it
   * already was. Same shape as `keepAfterRefund`, which answers the opposite
   * question, and the two sit together on the client's timeline.
   */
  const keepThePayment = async (gap: GapView, item: GapItemView) => {
    const key = rowKey(gap, item);
    if (!item.entityId) return;

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch(`/api/scheduling/bookings/${item.entityId}/keep-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'done' });
        setTimeout(() => onChanged?.(), 1200);
        return;
      }
      setRow(key, { kind: 'refused', message: translateReason(t, data?.reason || data?.code) });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  const keepAfterRefund = async (gap: GapView, item: GapItemView) => {
    const key = rowKey(gap, item);
    if (!item.entityId) return;

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch(
        `/api/scheduling/bookings/${item.entityId}/keep-after-refund`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
      );
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'done' });
        setTimeout(() => onChanged?.(), 1200);
        return;
      }
      setRow(key, { kind: 'refused', message: translateReason(t, data?.reason || data?.code) });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  /**
   * Open the booking this row is about, expanded.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `entityId` is the booking the gap was raised from — the consultation
   * awaiting a quote, the phase to be billed, the meeting with no outcome
   * recorded. The card has always known it and has never passed it on, so every
   * one of these buttons landed the owner on a LIST of that contact's bookings
   * and left them to work out which one the card meant. On a contact with one
   * booking that is invisible; on a regular client it is the whole problem.
   *
   * This is the third attempt at the same target. It first sent `&action=quote`,
   * which nothing on the CRM page read, so the drawer opened on `details`. Then
   * `bill_stage` sent `section=payments`, which is the wrong tab — the "mark
   * done and bill" control is a prop of `BookingsTab`, not the payments
   * section. Each round got nearer the row without reaching it.
   *
   * `&booking=` is read by the CRM page and threaded to `BookingsTab`, which
   * opens that row expanded. Omitted when the gap carries no entity, so the
   * link degrades to what it did before rather than naming a booking that does
   * not exist.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /**
   * Open the record this row is about: the exact booking, or the client.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * EVERY ROW LEADS SOMEWHERE. The first version only offered the door where a
   * BOOKING could be resolved, and on a real card that was none of them: two
   * unanswered enquiries, a cancelled appointment whose gap carries no
   * `entityId`, and four unpaid invoices whose `entityId` is an invoice. Seven
   * rows, no icon — an affordance that exists in the code and never on screen.
   *
   * So the booking is the PREFERRED destination, not the condition. Where one
   * can be named the drawer opens on it; otherwise it opens the client, which
   * is always knowable because `contactId` is required on every gap item. An
   * owner asking "what is going on here" is served by either.
   *
   * What it will not do is pass an id that names nothing. `entityId` is
   * whatever the action posts to — an invoice, a proposal, a payment stage —
   * and sending one as `&booking=` matched no row and expanded nothing, which
   * looks exactly like passing no id at all.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const bookingFor = (gapId: string, item: { bookingId?: string | null; entityId?: string | null }) =>
    item.bookingId ?? (ENTITY_IS_A_BOOKING.has(gapId) ? item.entityId ?? null : null);

  const openRecord = (
    gapId: string,
    item: { contactId: string; bookingId?: string | null; entityId?: string | null }
  ) => {
    const booking = bookingFor(gapId, item);
    router.push(
      booking
        ? `/business-os/crm?contact=${item.contactId}&section=bookings` +
            `&booking=${encodeURIComponent(booking)}`
        : `/business-os/crm?contact=${item.contactId}`
    );
  };

  const openBooking = (item: GapItemView) => {
    /*
     * `bookingId` first, because `entityId` is not always a booking.
     *
     * It is whatever the gap's action POSTS to — a proposal, an invoice, a
     * payment stage — and only some of those are the thing to open. Passing a
     * stage id as `&booking=` matched no row and expanded nothing, which looks
     * exactly like passing no id at all: the owner lands on the list either
     * way, so the fault never announced itself.
     */
    const bookingId = item.bookingId ?? item.entityId;
    const target = bookingId ? `&booking=${encodeURIComponent(bookingId)}` : '';
    router.push(`/business-os/crm?contact=${item.contactId}&section=bookings${target}`);
  };

  const act = async (gap: GapView, item: GapItemView) => {
    const key = rowKey(gap, item);
    const action = actionFor(gap, item);

    /*
     * Writing a quote is the one that is not a send.
     *
     * It needs the owner to decide what the work costs, so it opens the builder
     * they already use rather than pretending a button can answer it.
     */
    if (action === 'write_quote') {
      openBooking(item);
      return;
    }

    /*
     * Billing a phase is the other one that is not a send.
     *
     * The owner has to decide the work actually happened before the client is
     * asked for money, so this opens the phase rather than billing it. A
     * one-click button here would be making that judgement on their behalf.
     *
     * `&section=bookings`, the same target as the quote above. This used to say
     * `payments`, which is the wrong tab: `onCompleteStage` — the prop that
     * raises the "mark done and bill" confirmation — is a prop of `BookingsTab`,
     * and the payments section has never had that control. The button landed the
     * owner on a tab where the thing they came to do does not exist.
     */
    if (action === 'bill_stage') {
      openBooking(item);
      return;
    }

    /*
     * Saying what happened to a meeting is the third that is not a send — and
     * the clearest case for it: the answer is one of THREE (it was held, they
     * did not turn up, it was called off), and a single button cannot offer
     * three answers.
     *
     * Same target as the two above, because the three marks already live on the
     * booking row in the drawer's bookings section. Nothing new to build there;
     * this is the route to it for an owner who has not opened the contact.
     */
    if (action === 'mark_meeting') {
      openBooking(item);
      return;
    }
    /* Both navigate — see `OPENS_A_SCREEN`. The booking is where the amount
       and the handover both live. */
    if (action === 'send_invoice' || action === 'mark_delivered') {
      openBooking(item);
      return;
    }

    /*
     * Refunding opens the dialog rather than posting.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * A direct POST was wrong in three separate ways, all of which `RefundModal`
     * already answers: it never asked to stop a payment plan, so a client kept
     * being charged; it never asked to tell the client, because that route
     * defaults to silence; and it cannot refund a payment taken outside Stripe
     * at all — a business that settles invoices by bank transfer got a button
     * that always failed.
     *
     * Rather than teach a second refund path those three lessons, the row opens
     * the one every other surface uses. It also lets the owner choose a partial
     * amount, and stop the plan, neither of which a one-tap full refund can.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (action === 'refund') {
      if (!item.entityId) {
        setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
        return;
      }
      setRefunding({
        bookingId: item.entityId,
        /* WHAT IS LEFT, not what was asked. `item.value` is the client's ask,
           and opening on it forbade both a goodwill refund above it and any
           honest view of the real ceiling. */
        amount:
          typeof item.refundableAmount === 'number'
            ? item.refundableAmount
            : typeof item.value === 'number'
              ? item.value
              : 0,
        currency: item.currency || '',
        name: item.name,
      });
      return;
    }

    /*
     * Extending asks for a date, so it opens rather than posts — the same
     * reasoning as the refund above. The owner is deciding how long to hold a
     * price, and a button that chose for them would be answering the
     * commercial question itself.
     */
    if (action === 'extend_quote') {
      if (!item.entityId) {
        setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
        return;
      }
      setExtending({
        proposalId: item.entityId,
        name: item.name,
        /* The day it lapsed, which the gap carries as `eventAt`. */
        lapsedOn: item.eventAt ?? null,
      });
      return;
    }

    const endpoint = endpointFor(action, item);
    if (!endpoint) {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
      return;
    }

    /*
     * ASK ONCE, FOR THE THINGS THAT CANNOT BE TAKEN BACK.
     *
     * Reached on the FIRST tap only: the row goes to `confirming`, and the
     * control the owner then presses calls straight back in with the row
     * already in that state, which falls through to the send below.
     *
     * The check reads the ROW rather than taking a flag from the caller. A
     * second entry point that forgot to pass the flag would silently skip the
     * question, and the question is the whole point.
     */
    if (Boolean(action) && LEAVES_THE_BUILDING.has(action as string) && rows[key]?.kind !== 'confirming') {
      setRow(key, { kind: 'confirming' });
      return;
    }

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /*
         * Every remaining action is identified by its path and takes no body —
         * except cancelling, which now requires a reason like every other
         * cancellation surface.
         *
         * `refunded` is honest here and is the reason this card can stay ONE
         * CLICK: the `booking_refunded` gap finds a booking that was fully
         * refunded and is still on the books, so the owner pressing "cancel it"
         * is confirming exactly that. Any other one-click cancel would have to
         * invent a reason, which is why the calendar and the booking modal ask
         * instead.
         */
        body: JSON.stringify(action === 'cancel_booking' ? { reason_code: 'refunded' } : {}),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'done' });
        setTimeout(() => onChanged?.(), 1200);
        return;
      }

      // A refusal is a next step, not an error — show what the server said.
      setRow(key, {
        kind: 'refused',
        message: data?.detail || translateReason(t, data?.reason || data?.code),
      });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  /*
   * What is left after the owner has cleared rows this session.
   *
   * Applied once, here, so the lead, the fold, the count and the list all
   * agree — the alternative is four places that each have to remember to
   * filter, and the one that forgets shows a row the owner has already dealt
   * with. `count` is reduced alongside `items`, never below zero, so the pill
   * cannot claim more work than the list can show.
   */
  const visibleGaps: GapView[] = gaps
    .map(gap => {
      const items = gap.items.filter(item => !clearedRows.has(rowKey(gap, item)));
      const removed = gap.items.length - items.length;
      return { ...gap, items, count: Math.max(0, gap.count - removed) };
    })
    .filter(gap => gap.items.length > 0 || gap.count > 0);

  if (visibleGaps.length === 0) return null;

  const total = visibleGaps.reduce((sum, gap) => sum + gap.count, 0);

  /*
   * The one task the card leads with.
   *
   * Ranked in `mostUrgent`, not here: the ordering is the whole product once
   * only one task is visible, and it needs to be pure and tested rather than a
   * comparator inside a component that also does fetches and modals.
   */
  /*
   * A task the platform is already answering does not lead.
   *
   * `queued` means an automatic reply is pending on this row, with its own
   * "send now / cancel" strip inside the list. Leading with one would put the
   * owner's attention on the one thing nobody needs to do — and the lead block
   * has no room for that strip, so the Cancel control would vanish for as long
   * as the task happened to rank first.
   *
   * They stay in the list, with the strip, exactly as before. They simply do
   * not get the headline.
   */
  const leadCandidates = visibleGaps.map(g => ({
    id: g.id as never,
    items: g.items.filter(item => !item.queued) as never,
  }));
  const lead = mostUrgent(tasksOf(leadCandidates));
  const leadGap = lead ? visibleGaps.find(g => g.id === lead.gapId) ?? null : null;

  /*
   * The promoted row's decline, resolved once.
   *
   * The reply box, the controls under it and the row above it all have to
   * agree on whether a decline is being written. Deriving that three times
   * from `rows` is how the two halves of a confirmation came to disagree
   * before — one showing a second tap, the other showing the first.
   */
  const leadDeclineKey =
    leadGap && lead ? rowKey(leadGap, lead.item as GapItemView) : '';
  const leadDeclineState = leadDeclineKey ? rows[leadDeclineKey] : undefined;
  const leadDeclining =
    leadGap?.id === 'refund_requested' && leadDeclineState?.kind === 'confirming';
  /* Amber for the one thing that is worse tomorrow than today. */
  const leadUrgent = Boolean(lead?.item.planLive);

  const openContact = (contactId: string) =>
    router.push(`/business-os/crm?contact=${contactId}`);


  /**
   * ───────────────────────────────────────────────────────────────────────────
   * THE THREE ANSWERS TO A REFUND REQUEST, IN ONE PLACE.
   *
   * These lived only in the per-item list. The LEAD row — the promoted one,
   * drawn with the reply box, and the only row most owners ever see because
   * the rest stay folded — rendered the generic action instead. So a refund
   * request arriving as the most urgent thing offered one button, "Refund it",
   * and no way to return a different amount or to decline. Reported from a
   * live account with exactly that card on screen.
   *
   * A function rather than a copy: two definitions of "what may be done about
   * money going back" would drift, and the direction they drift in is an owner
   * on one surface being offered something the other refuses.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /**
   * The message that goes to the client, as its own full-width block.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Lifted out of `refundDecisions` when the promoted row's controls moved up
   * beside the headline. Up there the row holds BUTTONS and nothing else: a
   * four-row textarea in a flex row next to a sentence takes its width from
   * its own content, so the headline would have been squeezed into a narrow
   * column by the very box the owner is meant to read and edit.
   *
   * So the buttons sit with the headline and this renders underneath them, at
   * the full width of the card. The list rows, whose controls were already on
   * the row itself, keep it exactly where it was — hence a flag rather than a
   * second copy of the markup, which is how the buttons themselves came to be
   * missing from the promoted row in the first place.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const declineMessageBox = (gap: GapView, item: GapItemView, state: RowState) => (
    <>
        {gap.id === 'refund_requested' && item.requestId && state.kind === 'confirming' && (
          <div className="w-full mt-2">
            <p className="text-[10.5px] font-bold uppercase mb-1 text-[var(--v2-text-muted)]" style={{ letterSpacing: '0.06em' }}>
              {t('gaps.refund.decline_message')}
            </p>
            {state.drafting ? (
              <p className="inline-flex items-center gap-1.5 text-[12px] text-[var(--v2-text-muted)] italic px-1 py-2">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                {t('gaps.refund.decline_drafting')}
              </p>
            ) : (
              <textarea
                value={state.draft ?? ''}
                onChange={event =>
                  setRow(rowKey(gap, item), {
                    kind: 'confirming',
                    draft: event.target.value,
                    drafting: false,
                  })
                }
                rows={4}
                placeholder={t('gaps.refund.decline_message_empty')}
                className="w-full rounded-lg border px-2.5 py-2 text-[12.5px] leading-relaxed bg-[var(--v2-bg)] text-[var(--v2-text-primary)]"
                style={{ borderColor: 'var(--v2-border)', unicodeBidi: 'plaintext' }}
              />
            )}
          </div>
        )}
    </>
  );

  const refundDecisions = (
    gap: GapView,
    item: GapItemView,
    state: RowState,
    /*
     * The promoted row borrows the reply box for both: the message renders
     * inside it, and the pair that confirms the decline renders under it. So
     * the row beside the headline keeps the three ANSWERS and nothing that
     * belongs to a message being written.
     */
    {
      withMessageBox = true,
      withDecline = true,
      withApprove = true,
    }: { withMessageBox?: boolean; withDecline?: boolean; withApprove?: boolean } = {}
  ) => (
    <>
        {withApprove &&
          gap.id === 'refund_requested' &&
          item.requestId &&
          canApproveInOneClick(item) && (
            <button
              type="button"
              onClick={() => void approveRefund(gap, item)}
              disabled={state.kind === 'working' || state.kind === 'done'}
              className="shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
              style={{
                background: 'var(--v2-primary)',
                color: '#fff',
                border: '1px solid var(--v2-primary)',
              }}
            >
              {state.kind === 'done' ? (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {t(
                item.refundViaProcessor === false
                  ? 'gaps.refund.mark_returned'
                  : 'gaps.refund.approve'
              ).replace(
                '{amount}',
                typeof item.refundRecommendedAmount === 'number' && item.currency
                  ? new Intl.NumberFormat(undefined, {
                      style: 'currency',
                      currency: item.currency,
                      maximumFractionDigits: 2,
                    }).format(item.refundRecommendedAmount)
                  : ''
              )}
            </button>
          )}

        {/*
          ANY OTHER AMOUNT — the existing dialog, opened on its
          partial tab with everything already filled in. Not a
          second way to move money: the same dialog every other
          surface uses, reached one step further along.
        */}
        {withApprove && gap.id === 'refund_requested' && item.requestId && item.entityId && (
          <button
            type="button"
            onClick={() =>
              setRefunding({
                bookingId: item.entityId as string,
                /* THE CEILING IS WHAT IS LEFT, not what was
                   asked: a client may ask for less than they
                   paid, and the owner may return more as
                   goodwill. Opening on the ask forbade both. */
                amount:
                  typeof item.refundableAmount === 'number'
                    ? item.refundableAmount
                    : typeof item.value === 'number'
                      ? item.value
                      : 0,
                currency: item.currency || '',
                name: item.name,
                startPartial: true,
                /* `?? undefined`, because the state field is `number |
                   undefined` and the item's is `number | null | undefined`.
                   A null reaching it is the dialog opening prefilled with
                   nothing, which is what it already does — the cast simply
                   says so instead of failing a check the build ignores. */
                prefillAmount: item.refundRecommendedAmount ?? undefined,
                reasonKey: item.noteKey?.replace('payments.refund.reason.', ''),
                /*
                 * ───────────────────────────────────────────────────────────
                 * NOT THE CLIENT'S OWN WORDS. This box is now what they READ.
                 *
                 * It used to arrive holding their message — "I can not attend
                 * the meeting, please refund" — which was sensible while
                 * `reason_note` stayed in the ledger: the owner kept a record
                 * without retyping it.
                 *
                 * On a partial refund that same box is sent to them, so the
                 * prefill became a quotation of the client's request offered
                 * back as the business's account of why it kept part of the
                 * money. Their words are on the card above, where the owner
                 * is reading them anyway.
                 *
                 * The agent's `refundReasoning` is no better here: it is
                 * advice written TO THE OWNER — "we do not have a diary mark"
                 * — and reads as an internal note if it reaches a client.
                 *
                 * So the sentence is the owner's to write. The chip still
                 * arrives chosen, which is the part that saves real typing.
                 * ───────────────────────────────────────────────────────────
                 */
              })
            }
            disabled={state.kind === 'working' || state.kind === 'done'}
            className="shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
            style={{
              borderColor: 'var(--v2-border)',
              color: 'var(--v2-text-secondary)',
              background: 'transparent',
            }}
          >
            {t('gaps.refund.partial')}
          </button>
        )}

        {/*
          ── WHAT THEY WILL BE TOLD, BEFORE IT IS SENT ──────────────────────
          Editable, because the draft is a starting point and the owner knows
          things the model does not. Emptying it is a real choice: an empty box
          sends nothing, which is what declining did before this existed.
        */}
        {withMessageBox && declineMessageBox(gap, item, state)}

        {withDecline && gap.id === 'refund_requested' && item.requestId && (
          <button
            type="button"
            onClick={() => void answerRefund(gap, item, 'declined')}
            /*
             * NOT WHILE THE DRAFT IS STILL COMING.
             *
             * The second tap sends whatever is in `state.draft`, and during
             * those few seconds there is nothing there — so an owner who
             * tapped twice quickly recorded the decline and told the client
             * NOTHING, silently, which is the exact outcome this whole flow
             * exists to prevent.
             */
            disabled={
              state.kind === 'working' ||
              state.kind === 'done' ||
              (state.kind === 'confirming' && Boolean(state.drafting))
            }
            className="shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
            style={{
              borderColor: 'var(--v2-border)',
              color: 'var(--v2-text-secondary)',
              background: 'transparent',
            }}
          >
            {state.kind === 'done' ? (
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            ) : null}
            {/* The second tap says what it does. "Decline" twice would look
                like the first one had not registered. */}
            {state.kind === 'confirming' && state.drafting && (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            )}
            {state.kind === 'done'
              ? t('gaps.refund.declined')
              : state.kind === 'confirming'
                ? state.drafting
                  ? t('gaps.refund.decline_drafting')
                  : t('gaps.refund.decline_confirm')
                : t('gaps.refund.decline')}
          </button>
        )}

        {/* The way out, beside the second tap. Quiet, because backing out of
            something irreversible should not mean choosing between two loud
            buttons — the same shape `act()`'s confirmation uses. */}
        {withDecline && gap.id === 'refund_requested' && item.requestId && state.kind === 'confirming' && (
          <button
            type="button"
            onClick={() => setRow(rowKey(gap, item), { kind: 'idle' })}
            aria-label={t('common.cancel') || 'Cancel'}
            title={t('common.cancel') || 'Cancel'}
            className="shrink-0 self-start px-2 py-1.5 text-xs rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
          >
            ✕
          </button>
        )}
    </>
  );

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '18px',
        padding: '17px 18px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        /* See `fill`: matches the dial beside it in the dashboard's top row. */
        height: fill ? '100%' : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {t('gaps.card_title')}
        </h3>
        {/*
          NEUTRAL, not primary. Filling this pill with `--v2-primary` put the
          card's heaviest colour on a number nobody can act on, in the same
          colour as the action buttons that ARE meant to be pressed.

          A primary TINT with primary text fixes the competition and breaks
          something worse: `--v2-primary` is #6366F1 in both theme blocks — it
          is not redefined for dark — so indigo text on the dark card lands near
          3:1, below the solid pill it replaced. The count is metadata, so the
          neutral pair is both quieter and legible on either ground.
        */}
        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums"
          style={{
            background: 'var(--v2-bg)',
            color: 'var(--v2-text-secondary)',
          }}
        >
          {total}
        </span>
      </div>

      {/*
        ─────────────────────────────────────────────────────────────────────
        THE ONE THING, AND THE LINE THAT HOLDS THE REST.

        `lead` is whatever `mostUrgent` ranks first across every gap: money
        still leaving an account, then a decision about to expire, then
        somebody waiting, then work that can sit. The sentence beside it says
        what it IS rather than labelling a category, which is what the card
        has room for now that it shows one.

        Opening the fold renders the original grouped list underneath,
        untouched. Nothing an owner could do yesterday is gone; it is one tap
        further away, and the tap is the point.
        ─────────────────────────────────────────────────────────────────────
      */}
      {lead && !expanded && (
        <div className="mb-1">
          <p className="text-[11px] font-semibold mb-2" style={{ color: leadUrgent ? 'var(--v2-warning)' : 'var(--v2-primary)' }}>
            {leadUrgent ? t('gaps.lead.urgent') : t('gaps.lead.next')}
          </p>

          {/*
            ─────────────────────────────────────────────────────────────────
            THE CONTROLS SIT BESIDE THE HEADLINE, NOT UNDER THE CARD.

            They were at the foot of the block, below the reply box, because
            the promoted row grew downwards: headline, facts, assessment,
            reply, and whatever was left went last. That put the calendar and
            mail icons — the two things an owner reaches for BEFORE deciding
            anything — under everything they would have to scroll past, while
            the list rows underneath kept theirs on the row itself.

            Moved on the owner's instruction, the whole row together, for
            every gap rather than for refunds alone: one place where this
            card's controls live, in the same relative spot the folded rows
            keep theirs.

            The decisions move with them, and that is the deliberate cost: a
            refund can now be answered above the reasoning that justifies it.
            The facts sit directly underneath, and declining still asks a
            second time before anything is sent.

            `flex-wrap` with `justify-between` rather than a fixed split: on a
            phone the controls take their own line under the sentence instead
            of squeezing it into a column two words wide. `min-w-0` lets the
            headline shrink rather than push them off the card.
            ─────────────────────────────────────────────────────────────────
          */}
          <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
            <p className="text-[15px] leading-relaxed font-medium text-[var(--v2-text-primary)] flex-1 min-w-0">
              {leadSentence(lead.gapId, lead.item, t, money)}
            </p>
            <div className="flex gap-2 flex-wrap shrink-0">
              {/*
                THE PROMOTED ROW CONFIRMS TOO, AND HAD TO BE SAID SEPARATELY.

                This button has its own render and reads none of the row state
                the list below tracks — no working, no done. So the moment the
                irreversible actions started asking first, its first tap set the
                row to `confirming` and NOTHING on screen changed: the label
                stayed put, and a reader who assumed nothing had happened tapped
                again and sent it. A confirmation that is invisible is worse than
                none, because it trains the second tap.
              */}
              {(() => {
                const leadKey = rowKey(leadGap!, lead.item as GapItemView);
                const leadAction = actionFor(leadGap!, lead.item as GapItemView);
                const asking = rows[leadKey]?.kind === 'confirming';
                /* The same door the list rows get. The promoted row is the one most
                   owners ever see — the rest stay folded — so an affordance only on
                   the list is an affordance most people never find. See
                   `ENTITY_IS_A_BOOKING`. */
                const leadBooking =
                  lead.item.bookingId ??
                  (ENTITY_IS_A_BOOKING.has(lead.gapId) ? lead.item.entityId : null);
                return (
                  <>
                    {/*
                      ─────────────────────────────────────────────────────────
                      AND THE THREE ANSWERS TO A REFUND, ON THE ROW THAT ASKS.

                      `refundDecisions` was extracted precisely so this row could
                      call it — its own comment says the lead row "rendered the
                      generic action instead" — but the second call site was
                      never added, so the extraction fixed nothing where it was
                      aimed. The promoted row is the one most owners ever see,
                      the rest stay folded, and on it a refund request offered no
                      way to refund, return a different amount, or decline. The
                      only way to reach the buttons was to expand "and 2 more
                      waiting" and answer it from the list. Reported from a live
                      account with exactly that card on screen, twice.

                      Beside the record and mail buttons, in the same row, for
                      the reason the list's copy gives: the facts, the timeline
                      and the recommendation are all above this point, so what
                      moves is where the buttons sit, not what has been read by
                      the time they are reached.
                      ─────────────────────────────────────────────────────────
                    */}
                    {leadGap &&
                      refundDecisions(
                        leadGap,
                        lead.item as GapItemView,
                        rows[leadKey] ?? { kind: 'idle' },
                        /*
                         * Buttons only up here. Once the owner has asked to
                         * decline, the message and the pair that confirms it
                         * both belong to the reply box below — otherwise the
                         * card asks the question in one place and takes the
                         * answer in another.
                         */
                        { withMessageBox: false, withDecline: !asking }
                      )}
                    {/* Not where the reply box already offers it. See
                        `THE_REPLY_BOX_DOES_THIS`. */}
                    {!Boolean(leadAction) && THE_REPLY_BOX_DOES_THIS.has(leadAction as string) && (
                    <button
                      type="button"
                      onClick={() => act(leadGap!, lead.item as GapItemView)}
                      /*
                       * ─────────────────────────────────────────────────────────
                       * THE SAME BUTTON AS EVERY ROW IN THE LIST BELOW.
                       *
                       * The lead row was built first and kept its own metrics —
                       * 13px text in `px-4 py-2`, no lift, no hover, no press —
                       * while the rows underneath are `text-xs` in `px-3 py-1.5`
                       * with `ap-primary-lift`, a brightness hover and a scale on
                       * press. One card, two buttons, and the bigger flatter one
                       * sat directly above the smaller lively ones.
                       *
                       * `ap-primary-lift` is a class rather than an inline
                       * shadow for the reason `globals.css` records: the shadow
                       * is a colour-mix of the primary and cannot be expressed
                       * inline without losing its dark-mode form.
                       * ─────────────────────────────────────────────────────────
                       */
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97]"
                      style={{ background: 'var(--v2-primary)', color: '#fff' }}
                    >
                      {asking
                        ? (leadAction === 'cancel_booking'
                            ? t('gaps.confirm.cancel_booking') || 'Cancel and tell {name}'
                            : t('gaps.confirm.email') || 'Email {name} now'
                          ).replace('{name}', lead.item.name)
                        : t(`gaps.action.${leadAction}`)}
                    </button>
                    )}
                    {/*
                      Not while the decline owns the row. Its own way out sits
                      under the box with the button it belongs to, and this one
                      stayed up here beside a headline doing the same thing —
                      two cancels for one question, in two places.
                    */}
                    {asking && !leadDeclining && (
                      <button
                        type="button"
                        onClick={() => setRow(leadKey, { kind: 'idle' })}
                        /* Sized to the button it sits beside, like the list's.
                           It said exactly that and used px-2.5 against a px-3 neighbour, so the
                           pair sat a hair out of line on every promoted row. */
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                      >
                        {t('common.cancel') || 'Cancel'}
                      </button>
                    )}
                    {/*
                      THE TWO DOORS, LAST IN THE ROW, BESIDE "OPEN THE CLIENT".

                      They opened the row: an icon for the mail it arrived in
                      and one for the booking or the contact. That put two
                      small grey glyphs between the headline and the answers,
                      so the eye crossed navigation to reach the decision.

                      They are navigation, and "open the client" beside them
                      is the third of the same kind, so the three sit together
                      at the end of the row on the owner's instruction.
                    */}
                    {/* The mail it came in, in the same slot the list rows keep
                        it. See the note at the list row's copy. */}
                    {lead.item.sourceThreadId && (
                      <a
                        href={mailThreadUrl(lead.item.sourceThreadId, lead.item.sourceThreadProvider)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t('gaps.refund.open_email')}
                        title={t('gaps.refund.open_email')}
                        className="inline-flex items-center justify-center p-1.5 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors"
                      >
                        <Mail className="w-4 h-4" aria-hidden="true" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => openRecord(lead.gapId, lead.item)}
                      aria-label={t(leadBooking ? 'gaps.open_booking' : 'gaps.open_contact')}
                      title={t(leadBooking ? 'gaps.open_booking' : 'gaps.open_contact')}
                      className="inline-flex items-center justify-center p-1.5 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors"
                    >
                      {leadBooking ? (
                        <CalendarSearch className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <UserRound className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </>
                );
              })()}
              <button
                type="button"
                onClick={() => openContact(lead.item.contactId)}
                /* Sized to the row button it stands beside. It kept the lead
                   row's original `text-[13px] px-4 py-2`, so once the primary
                   next to it became the list's button this one was visibly
                   taller than the thing it is paired with. */
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors hover:border-[var(--v2-text-muted)]"
                style={{
                  background: 'transparent',
                  color: 'var(--v2-text-secondary)',
                  border: '1px solid var(--v2-border)',
                }}
              >
                {t('gaps.lead.open_contact')}
              </button>
            </div>
          </div>

          {/* Who you are answering, in one line. See `ClientLine`. */}
          <ClientLine
            item={lead.item}
            contextKey={lead.item.contextKey}
            age={agoOf(lead.item.since, t)}
            t={t}
            language={language}
          />


          {/*
            ONE BLOCK, BOTH POSITIONS. See `MailGapBlock` — this markup existed
            twice and drifted twice, so the same client waiting in the same way
            showed their words here and a subject line beside a clock in the
            fold.
          */}
          {/* The same choice the dense row makes: a form is not a message. */}
          {lead.gapId === 'refund_requested' ? (
            <RefundGapBlock
              value={lead.item.value}
              currency={lead.item.currency}
              noteKey={lead.item.noteKey}
              note={lead.item.note}
              subject={lead.item.subject}
              quote={lead.item.quote}
              recommendation={lead.item.refundRecommendation}
              recommendedAmount={lead.item.refundRecommendedAmount}
              reasoning={lead.item.refundReasoning}
              /* The booking in full, so the owner answers without opening it. */
              paidAmount={lead.item.paidAmount}
              paidAt={lead.item.paidAt}
              paidMethod={lead.item.paidMethod}
              bookedAt={lead.item.bookedAt}
              serviceMinutes={lead.item.serviceMinutes}
              servicePrice={lead.item.servicePrice}
              refundableAmount={lead.item.refundableAmount}
              askedAt={lead.item.since}
              money={money}
              /* Every hour on the card read on the business's clock. */
              timeZoneOptions={timeZoneOptions}
              t={t}
            />
          ) : (
            <MailGapBlock
              subject={lead.item.subject}
              quote={lead.item.quote}
              note={lead.item.noteKey ? t(lead.item.noteKey) : lead.item.note}
              threadId={lead.item.threadId}
              /* Which mailbox to open it in. See `MailGapBlockProps.provider`. */
              provider={lead.item.viaProvider}
              t={t}
            />
          )}

          {/*
            ANSWERING, ON THE CARD. See `MailReplyBox` — this is the move the
            row has never had, and the reason every fact above it was being
            assembled only to be abandoned at the door to Gmail.
          */}
          {lead.gapId === 'refund_requested' && lead.item.subject && (
            <h3
              className="text-[10.5px] font-bold uppercase mt-3 mb-1.5 text-[var(--v2-text-muted)]"
              style={{ letterSpacing: '0.06em' }}
            >
              {t('gaps.refund.your_reply').replace('{name}', firstNameOf(lead.item.name))}
            </h3>
          )}

          {lead.item.subject && (
            <MailReplyBox
              contactId={lead.item.contactId}
              threadId={lead.item.threadId}
              draftId={lead.item.draftId}
              /*
                 THE AGENT'S REPLY, WHEREVER IT CAME FROM.

                 The mail agent files its answer as `draftBody`; the refund
                 agent writes one into the request as `client_message_draft`
                 and nothing read it, so an owner met an empty box under a
                 recommendation that had already worked out what to say.

                 Passed as the same prop deliberately: with no `draftId` the
                 box calls it a SUGGESTION rather than a draft, which is the
                 honest label for both — nothing was filed at a mailbox, and
                 the owner is expected to finish it.
              */
              draftBody={
                leadDeclining ? (leadDeclineState?.draft ?? '') : (lead.item.draftBody ?? lead.item.refundClientDraft)
              }
              subject={lead.item.subject}
              provider={lead.item.viaProvider}
              answeredAt={lead.item.answeredAt}
              language={language}
              onDone={onChanged}
              /*
                ─────────────────────────────────────────────────────────────
                DECLINING WRITES IN THIS BOX, NOT IN A SECOND ONE.

                It used to open its own editor above this one, so a card
                answering one client carried two boxes addressed to them —
                and only one could send. Reported as "I do not like that it
                opens another reply".

                While declining, the box is the decline: it is seeded with
                the drafted refusal, reports every edit back so what is sent
                is what the owner actually wrote, and its own send is
                replaced by the pair that records the decision. Nothing else
                about it changes, and the moment the owner backs out it is an
                ordinary reply box again.
                ─────────────────────────────────────────────────────────────
              */
              /*
                The model takes a few seconds, and an unchanged label over an
                emptied box reads as a card that has stopped working. The
                spinner says the sentence is being written, which is also why
                the confirm button below refuses to be pressed yet.
              */
              label={
                leadDeclining ? (
                  leadDeclineState?.drafting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                      {t('gaps.refund.decline_drafting')}
                    </span>
                  ) : (
                    t('gaps.refund.decline_message')
                  )
                ) : undefined
              }
              /* The agent drafted this to REFUSE, so the suggestion note —
                 which describes a reply it wrote for the thread — would be
                 describing something else entirely. */
              note={leadDeclining ? null : undefined}
              /*
                The two handovers: into the decline once its draft has
                arrived, and back out again. Keyed on whether the draft is
                here rather than on its text, so a keystroke never re-seeds.
              */
              seedKey={
                leadDeclining
                  ? leadDeclineState?.draft
                    ? 'decline-drafted'
                    : 'decline-drafting'
                  : 'reply'
              }
              onTextChange={
                leadDeclining
                  ? text => setRow(leadDeclineKey, { kind: 'confirming', draft: text, drafting: false })
                  : undefined
              }
              answering={
                leadDeclining && leadGap
                  ? refundDecisions(
                      leadGap,
                      lead.item as GapItemView,
                      leadDeclineState ?? { kind: 'idle' },
                      { withMessageBox: false, withApprove: false }
                    )
                  : undefined
              }
              t={t}
            />
          )}

          {/*
            ─────────────────────────────────────────────────────────────────
            AND WHERE THERE IS NO REPLY BOX TO BORROW.

            The box above renders only for a row with a `subject` — a request
            that arrived as mail. A refund asked for through the portal form
            has none, so on those rows the decline would have nowhere to be
            written at all, which is worse than the second box it replaced.

            So those keep their own editor, exactly as before, with the
            controls under it in the same place the borrowed ones sit. One of
            the two always renders and never both: the same `leadDeclining`
            flag decides, and these are the two halves of one condition.
            ─────────────────────────────────────────────────────────────────
          */}
          {leadDeclining && leadGap && !lead.item.subject && (
            <div className="mt-2">
              {declineMessageBox(
                leadGap,
                lead.item as GapItemView,
                leadDeclineState ?? { kind: 'idle' }
              )}
              <div className="flex gap-2 flex-wrap mt-2">
                {refundDecisions(
                  leadGap,
                  lead.item as GapItemView,
                  leadDeclineState ?? { kind: 'idle' },
                  { withMessageBox: false, withApprove: false }
                )}
              </div>
            </div>
          )}

          {/* Every other gap keeps the bare line it had: a service name, a
              quote title. `MailGapBlock` renders nothing without a message. */}
          {!lead.item.subject && (lead.item.noteKey || lead.item.note) && (
            <p
              style={{ unicodeBidi: 'plaintext' }}
              className="text-[12.5px] text-[var(--v2-text-secondary)] mb-1 line-clamp-2"
            >
              {lead.item.noteKey ? t(lead.item.noteKey) : lead.item.note}
            </p>
          )}

          {leadQualifier(lead.gapId, lead.item, t, language) && (
            <p className="text-[12.5px] text-[var(--v2-text-muted)] mb-3">
              {leadQualifier(lead.gapId, lead.item, t, language)}
            </p>
          )}

        </div>
      )}

      {/*
        The fold. Hidden entirely when this is the only task, because "and 0
        more" is a control that does nothing.
      */}
      {/*
        Only where there is a headline to fold BACK to. With no lead — every
        task already being answered automatically — the list is the card, and a
        control offering to hide it would leave the card blank.
      */}
      {lead && total > 1 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between text-[13px] mt-3 pt-3"
          style={{
            borderTop: '1px solid color-mix(in srgb, var(--v2-border) 50%, transparent)',
            color: 'var(--v2-text-secondary)',
            background: 'transparent',
          }}
        >
          <span>
            {expanded
              ? t('gaps.lead.collapse')
              : t('gaps.lead.more').replace('{n}', String(total - 1))}
          </span>
          <span aria-hidden="true" className="text-[var(--v2-text-muted)]">
            {expanded ? '×' : (isRTL ? '←' : '→')}
          </span>
        </button>
      )}

      {/*
        Shown when the owner opens it, and ALWAYS when there is no lead: a card
        that has tasks must never render nothing.
      */}
      <div className="flex flex-col gap-3" hidden={Boolean(lead) && !expanded}>
        {visibleGaps.map(gap => (
          <div key={gap.id}>
            {/*
              The kind, said once, rather than repeated on every row.

              Set in sentence case rather than `uppercase tracking-wide` at
              11px. This card carries one of these above every group, so that
              treatment put the heaviest emphasis in each block on the one line
              the owner cannot act on. The names under it are the content; this
              only has to label them.
            */}
            {/*
              A LABEL NOW, NOT A HEADLINE.

              It was the heaviest line in each block, which was right while the
              rows beneath it were bare names: the heading was the only thing
              saying what kind of trouble they were in. Every row now carries
              its own sentence, so the heading repeats what is directly under
              it — "the client cancelled" above "{name} cancelled the
              appointment, and you are holding ₪250".

              Kept, because it still groups rows of one kind and carries the
              overflow count. Demoted, because emphasis belongs on the line the
              owner can act on.
            */}
            <p className="text-[11px] font-medium text-[var(--v2-text-muted)] mb-1.5">
              {t(`gaps.kind.${gap.id}`)}
              {gap.count > gap.items.length && (
                <span className="font-normal text-[var(--v2-text-muted)]"> · {gap.count}</span>
              )}
            </p>

            <div className="flex flex-col gap-2">
              {gap.items.map(item => {
                const key = rowKey(gap, item);
                const state = rows[key] ?? { kind: 'idle' };
                // The queued strip's own request (Send now / Cancel) lives on its own key.
                const isQueuedWorking = rows[`queued:${item.contactId}`]?.kind === 'working';
                const action = actionFor(gap, item);
                /* The booking this row is about, or null when there is nothing to open.
                   See `ENTITY_IS_A_BOOKING`. */
                const bookingToOpen = bookingFor(gap.id, item);
                const Icon = ACTION_ICON[action || ''] || Send;
                /*
                 * The same action, asked as a different question.
                 *
                 * `bill_stage` ordinarily reads "mark done and bill", which is
                 * the right words over work a person has already said was
                 * done. Over an hour only a clock vouched for it is the wrong
                 * request: it tells the owner to charge when what they have to
                 * do first is decide whether there is anything to charge for.
                 *
                 * Same button, same endpoint — the stage is billed either way.
                 * Only the sentence changes, so the one row that needs a
                 * judgement asks for one.
                 */
                const actionKey =
                  item.autoHeld && action === 'bill_stage' ? 'bill_stage_auto_held' : action;

                return (
                  <div
                    key={key}
                    /*
                      A rail instead of a box, and a fill only on hover.
                      ─────────────────────────────────────────────────────────
                      Each row used to be an outlined, filled card inside an
                      outlined, filled card, so the list read as a grid of equal
                      cells with no front to it. Removing the row's border and
                      its resting fill leaves a 2px rail on the start edge to
                      give the list a spine, and frees the fill to mean
                      something: it now appears under the pointer.

                      `border-s-2` / `ps-3` are LOGICAL, so the spine sits on
                      the right in Hebrew without a second rule. The hover fill
                      is `--v2-bg`, the token one step from the card's own
                      `--v2-surface`, which lifts in light mode and deepens in
                      dark from the same single declaration.

                      The rail carries the one signal this card already treats
                      as loudest: amber when a payment plan is still charging
                      for an appointment that is not happening, because that row
                      is money leaving an account while it waits.
                    */
                    className="p-2.5 ps-3 rounded-xl border-s-2 transition-colors hover:bg-[var(--v2-bg)]"
                    style={{
                      /*
                        `--v2-warning` is #F59E0B in BOTH theme blocks, which is
                        the same amber the plan-still-charging sentence beside it
                        reaches for through Tailwind, so the rail and the text it
                        marks cannot drift apart.

                        `color-mix` degrades safely HERE but would not as a
                        Tailwind class: compiling `hover:bg-[color-mix(...)]`
                        emits bare `background-color: var(--v2-primary)` as its
                        pre-`@supports` fallback, which paints the whole row
                        solid indigo on anything lacking color-mix. An
                        unsupported INLINE declaration is simply dropped, and
                        the border falls back to currentColor.
                      */
                      borderInlineStartColor: item.planLive
                        ? 'var(--v2-warning)'
                        : 'color-mix(in srgb, var(--v2-primary) 50%, transparent)',
                    }}
                  >
                    {/*
                      ON A PHONE THE BUTTON TAKES ITS OWN LINE.

                      Side by side, the action is `shrink-0` and the subject is
                      `truncate`, so every pixel the button needs comes out of
                      the text — and the button's label is a whole phrase
                      ("כתיבת הצעה", "Write a quote"). At phone width that left
                      the row reading "אופיר עומר · הצעת מחיר לש…", which cuts
                      off exactly the half that says WHICH job is waiting. The
                      name survives and the subject does not, which is the wrong
                      way round: the owner knows their clients and is looking
                      for the thing.

                      A column below `sm`, the same row above it. Stacking is
                      done on the CONTAINER rather than by giving the subject a
                      full basis: `flex-1` already sets `flex-basis: 0%`, and
                      which of the two wins is decided by their order in the
                      stylesheet rather than in the class list, so it is not a
                      thing to rely on. A column stretches its children by
                      default, so the subject gets the full width with no
                      second rule at all.
                    */}
                    {/*
                      ON A PHONE THE BUTTON TAKES ITS OWN LINE.

                      Side by side, the action is `shrink-0` and the subject is
                      `truncate`, so every pixel the button needs comes out of
                      the text — and the button's label is a whole phrase
                      ("כתיבת הצעה", "Write a quote"). At phone width that left
                      the row reading "אופיר עומר · הצעת מחיר לש…", which cuts
                      off exactly the half that says WHICH job is waiting.

                      A column below `sm`, the same row above it. Stacking is
                      done on the CONTAINER rather than by giving the subject a
                      full basis: `flex-1` already sets `flex-basis: 0%`, and
                      which of the two wins is decided by their order in the
                      stylesheet rather than in the class list.

                      MAIL ROWS KEEP THIS LAYOUT TOO, and briefly did not. They
                      were forced to a column at every width because the action
                      button used to float against the vertical middle of a
                      four-line block. That button is gone from these rows — the
                      reply box replaced it, see `THE_REPLY_BOX_DOES_THIS` — so
                      the only thing left beside the text is the small "open the
                      client" icon, which then had nothing to stack under and
                      came to rest alone beneath the clock. One orphaned icon in
                      a position no other row puts it in is a worse fault than
                      the crowding the column was avoiding, and the crowding no
                      longer happens.
                    */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0 flex-1">
                        {/*
                          * WHO, and WHICH THING OF THEIRS, on one line.
                          *
                          * The note was its own row — so a phase waiting to be
                          * billed cost three stacked lines (name, "באמצע",
                          * then the clock) for two facts. They belong together:
                          * "אופיר עומר · באמצע" is one thought, and reads as
                          * one.
                          */}
                        <p className="text-sm text-[var(--v2-text-primary)] flex items-baseline gap-2">
                          {/*
                            CLAMPED TO TWO LINES, NOT TRUNCATED TO ONE.

                            `truncate` was right for "{name} · {service}":
                            a name that does not fit is still recognisable from
                            its first half. A sentence cut mid-clause is not —
                            "this phase of Dana's job is finished as far as…"
                            states a client and then stops before the point,
                            which is worse than the bare name it replaced.

                            Two lines holds every sentence in the set at this
                            column width, and `min-w-0` is what lets it shrink
                            inside the flex row instead of pushing the money
                            and the button off the end.
                          */}
                          <span className="line-clamp-2 min-w-0">
                            {/*
                              * THE SENTENCE, ON EVERY ROW — NOT ONLY THE LEAD.
                              *
                              * These rows used to read "{name} · {service}"
                              * under a heading that stated a STATUS: "the
                              * client cancelled", "waiting for an answer". A
                              * status plus a name is a record, not a task, and
                              * the owner had to infer the job from the button.
                              *
                              * The sentence that does say it already existed
                              * and was already translated — `leadSentence` —
                              * but only the single promoted row was given it.
                              * So the card explained itself least at the exact
                              * moment it had most to explain: opening it to
                              * see all the work replaced the one sentence with
                              * a list of names.
                              *
                              * Same function the lead uses, so the two can
                              * never describe one row differently.
                              */}
                            <span className="font-medium">
                              {/*
                                No full stop, because something always follows
                                it here: the channel chip, the session number,
                                the amount. "…and nobody has replied. · from
                                the form" collides two fragments; without the
                                stop the chips read as the continuation they
                                are. The lead keeps its stop — nothing follows
                                it there, and it is a sentence on its own.
                              */}
                              {leadSentence(gap.id, item, t, money).replace(/[.。]\s*$/, '')}
                            </span>
                            {/*
                              * WHICH session, where the row is one of several.
                              *
                              * A package bills per meeting, so its stages share
                              * a client, a job and an amount — five rows
                              * identical to the character, with nothing saying
                              * which one had just been billed.
                              *
                              * Said HERE rather than folded into `note` because
                              * the gaps run server-side with no language
                              * resolved: the number travels, the sentence is
                              * built in the reader's own words.
                              */}
                            {/*
                              * WHERE IT CAME FROM, where that is not obvious.
                              *
                              * A lead an agent read out of the mailbox is
                              * stored with the same `source` as one typed into
                              * the website form — deliberately, so the
                              * unanswered-enquiry chase sees both. The result
                              * was a row reading "Website contact · just now"
                              * for an email the owner had never seen, with
                              * nothing saying an agent had found and filed it.
                              *
                              * Only the inbox is named: a form submission IS
                              * the ordinary case, and labelling every row with
                              * its channel would be noise on all but a few.
                              */}
                            {item.via === 'inbox_channel' && (
                              <span className="text-[var(--v2-text-muted)]">
                                {' · '}
                                {(() => {
                                  /*
                                   * NAME THE AGENT AND THE MAILBOX.
                                   *
                                   * "Found in your inbox" said where it was
                                   * without saying what did the finding, and
                                   * the distinction is the whole point of the
                                   * row: this enquiry reached the CRM because
                                   * an agent read the owner's mail, not
                                   * because anybody opened it. An owner who
                                   * does not know that cannot tell a working
                                   * agent from a lucky coincidence.
                                   *
                                   * The provider is absent on leads filed
                                   * before it was recorded, so the generic
                                   * sentence stays as the fallback rather
                                   * than leaving a blank where a mailbox
                                   * should be.
                                   */
                                  const key =
                                    item.viaProvider === 'google-mail'
                                      ? 'gaps.via.agent_gmail'
                                      : item.viaProvider === 'outlook'
                                        ? 'gaps.via.agent_outlook'
                                        : 'gaps.via.agent';
                                  return t(key) === key ? t('gaps.via.agent') : t(key);
                                })()}
                              </span>
                            )}
                            {typeof item.sessionNumber === 'number' && (
                              <span className="text-[var(--v2-text-muted)]">
                                {' · '}
                                {(t('gaps.session_number') || 'Session {n}').replace(
                                  '{n}',
                                  String(item.sessionNumber)
                                )}
                              </span>
                            )}
                          </span>
                          {/*
                            * The amount, said as what it IS on this gap, on the
                            * subject's line rather than after the clock.
                            *
                            * It used to sit mid-sentence beside the days, so the
                            * figures wandered left and right down the list and
                            * could not be compared without reading every row.
                            * `ms-auto` lands every one of them on the same edge,
                            * which turns a list of rows into a column of money —
                            * and the money is what decides which row is dealt
                            * with first. See `VALUE_LABEL` for why the WORD in
                            * front of it changes per gap.
                            */}
                          {moneyHeld(item) && !sentenceCarriesAmount(gap.id, t) && (
                            <span className="ms-auto shrink-0 text-[11px]">
                              <span className="text-[var(--v2-text-muted)]">
                                {t(VALUE_LABEL[gap.id] ?? 'gaps.held')}{' '}
                              </span>
                              <span className="font-semibold tabular-nums">
                                {money(item.value as number, item.currency)}
                              </span>
                            </span>
                          )}
                        </p>

                        {/* The same one-line client history the promoted row
                            carries. See `ClientLine`.

                            `contextKey` is passed here too: without it the
                            expanded row showed the email and nothing else, so
                            where the request came from was visible only while
                            the card was collapsed — the one state in which the
                            owner is not yet deciding anything.

                            The `age` goes here for a refund and nowhere else:
                            its clock strip is gone, so this line is the only
                            place the wait is stated. Every other gap keeps the
                            strip, and passing the age here would print it
                            twice. */}
                        <ClientLine
                          item={item}
                          contextKey={item.contextKey}
                          age={gap.id === 'refund_requested' ? agoOf(item.since, t) : null}
                          t={t}
                          language={language}
                        />

                        {/*
                          ─────────────────────────────────────────────────────
                          THE REPLY, ON THE LIST ROW TOO.

                          The promoted row got the client's words first, and
                          that was half a fix: the lead is ONE task, and every
                          other row on the card — the ones an owner opens the
                          fold to work through — still showed a subject line
                          beside a clock and nothing of what was said.

                          Which half you see is decided by `mostUrgent`, so an
                          owner with a quote waiting and an invoice overdue
                          read the full version of one and the bare version of
                          the other, for no reason they could perceive.

                          Two lines rather than the lead's four. It is a row in
                          a list, and the whole message is one tap away on the
                          contact.
                          ─────────────────────────────────────────────────────
                        */}
                        {/* The same block the promoted row gets, denser.
                            See `MailGapBlock`. */}
                        {/*
                          A FORM IS NOT A MESSAGE. `MailGapBlock` frames a row
                          as an email — envelope, subject, message content —
                          which is right for a client who wrote to you and
                          wrong for one who filled in a form. See
                          `RefundGapBlock`.
                        */}
                        {gap.id !== 'refund_requested' && (
                          <MailGapBlock
                            subject={item.subject}
                            quote={item.quote}
                            note={item.noteKey ? t(item.noteKey) : item.note}
                            threadId={item.threadId}
                            provider={item.viaProvider}
                            contextKey={item.contextKey}
                            dense
                            t={t}
                          />
                        )}

                        {/* The same box the promoted row gets, wherever there
                            is something to send: a conversation to reply into,
                            or a reply the agent already drafted. See
                            `canAnswerHere` — gating on `CONVERSATION_GAPS`
                            alone is what made a refund's draft appear on the
                            promoted card and vanish from the list. */}
                        {/*
                          A REFUND'S BOX IS NOT HERE. See the one under
                          `RefundGapBlock` below.

                          The reply only makes sense AFTER the thing it is
                          replying about. A mail row reads block-then-box
                          because `MailGapBlock` sits directly above; a refund
                          row's block is rendered under the whole row, for the
                          width it needs, so a box here would open with a
                          suggested answer above the request it answers.
                        */}
                        {gap.id !== 'refund_requested' &&
                          item.subject &&
                          canAnswerHere(gap.id, item) && (
                            <MailReplyBox
                              contactId={item.contactId}
                              threadId={item.threadId}
                              draftId={item.draftId}
                              /* The same pairing as the lead row above. */
                              draftBody={item.draftBody ?? item.refundClientDraft}
                              subject={item.subject}
                              provider={item.viaProvider}
                              answeredAt={item.answeredAt}
                              language={language}
                              onDone={onChanged}
                              t={t}
                            />
                          )}

                        <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 flex items-center gap-1">
                          {/*
                            THE JOB, DOWN HERE WITH THE REST OF THE CONTEXT.

                            It used to sit on the line above as "{name} ·
                            {service}", which worked while that line was a
                            name. It is a sentence now, and a sentence ends in
                            a full stop — "…and you are holding ₪250. · Payment
                            review" reads as two fragments collided.

                            It belongs here anyway: which service they bought
                            is the same KIND of fact as when it happened and
                            which session it was, and those were already here.
                          */}
                          {/*
                            THE SUBJECT, where there is one, in preference to
                            the note.

                            This is a metadata strip — one line, beside a
                            clock — and the mail gaps put a two-sentence
                            explanation in `note`, which cannot survive here.
                            Their `subject` can: it is short, it is the
                            client's own words, and it is what the owner
                            recognises the thread by. The full explanation is
                            on the promoted row, which has the room for it.

                            Bidi handled as the lead block does it: this text
                            is in whatever language the client wrote in, and an
                            English string truncating inside an RTL strip loses
                            its START. unicode-bidi: plaintext rather than a
                            dir attribute, so the line stays aligned with the
                            card instead of jumping to the opposite edge.
                          */}
                          {/* NOT repeated when `MailGapBlock` is showing it
                              above: subject, quote, reasoning and origin all
                              live there now, and printing the subject again
                              one line down read as two different facts. */}
                          {!item.subject && (item.noteKey || item.note) && (
                            <>
                              <span style={{ unicodeBidi: 'plaintext' }} className="truncate">{item.noteKey ? t(item.noteKey) : item.note}</span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          {/*
                            NO CLOCK STRIP ON A REFUND, because its header
                            already carries the wait.

                            "waiting 4h · Nov 19" under a line reading "Asked
                            4h ago in your client portal" states one fact
                            twice and dates it two ways. Every other gap keeps
                            the strip: the header phrase belongs to the refund
                            request, and nothing else has one.
                          */}
                          {gap.id !== 'refund_requested' && (
                            <>
                          <Clock className="w-3 h-3 shrink-0" />
                          {/*
                            * "17 days" alone is a measurement, not a fact.
                            *
                            * Seventeen days of WHAT — the owner asked exactly
                            * that. Every gap starts its clock on a different
                            * event: a phase counts from the day the client
                            * accepted the quote, an invoice from the day it
                            * fell due, an enquiry from the day they wrote in.
                            * The row now names that event, and the exact date
                            * stays in the tooltip rather than spending width on
                            * a line that has to stay short.
                            *
                            * `gaps.waiting` is the fallback, for a gap added
                            * later with no phrase of its own yet.
                            */}
                          <span title={startedOn(item.since, language)} className="truncate">
                            {(() => {
                              /*
                               * ANSWERED ROWS DO NOT SAY "WAITING".
                               *
                               * The row stays after a reply is sent, because
                               * the owner decides when a thread is finished —
                               * but the clock went on reading "ממתין ממש
                               * עכשיו" over a client who had been answered
                               * minutes earlier. That is the single most
                               * misleading line the card can carry: it is the
                               * phrase an owner scans to decide what still
                               * needs them.
                               *
                               * The clock still counts from `since`, which is
                               * when THEY wrote. Only the verb changes.
                               */
                              if (item.answeredAt) return t('gaps.since.answered');

                              /*
                               * WHAT THE CLOCK IS COUNTING FROM, which is not
                               * the same for every row of one gap.
                               *
                               * `stage_awaiting_completion` says "since they
                               * approved the quote", and that was true while a
                               * stage had no date of its own. A package stage
                               * now dates itself by the SESSION it bills, so
                               * the same sentence would read "4 days since they
                               * approved" over a figure counted from a meeting
                               * held yesterday — the phrase contradicting the
                               * number beside it.
                               *
                               * The session number is what distinguishes them:
                               * present only where `since` is a session.
                               */
                              const key =
                                typeof item.sessionNumber === 'number'
                                  ? `gaps.since.${gap.id}_session`
                                  : `gaps.since.${gap.id}`;
                              const phrase = t(key) === key ? null : t(key);
                              const fallback =
                                t(`gaps.since.${gap.id}`) === `gaps.since.${gap.id}`
                                  ? t('gaps.waiting')
                                  : t(`gaps.since.${gap.id}`);

                              return (phrase ?? fallback).replace('{t}', waitedFor(item.since, t));
                            })()}
                          </span>
                            </>
                          )}

                          {/*
                            WHAT IS ACTUALLY WRONG, in the badge's own words.
                            ───────────────────────────────────────────────────
                            `client_needs_a_word` is the one row that can carry
                            any combination of concerns — missing sessions,
                            paying late, and the whole thing having stayed true
                            for weeks — so no single dictionary sentence could
                            have stated it. The keys are the ones the drawer
                            badge uses, so a client reads the same way wherever
                            they are shown.
                          */}
                          {/*
                            THE SCORE, AS A FIGURE TO RANK BY.
                            ───────────────────────────────────────────────────
                            Owner's request, 2026-11-16. 0–100 with the card's
                            own firing line at 60, so every row here reads 60 or
                            more and two of them can be put in order at a
                            glance. The raw score is a sum of weighted standard
                            deviations — unbounded, and an answer to no question
                            anybody asks.

                            It leads the strip rather than trailing it: a figure
                            at the end of a line of facts reads as one more
                            fact, and this one is the summary of them.
                          */}
                          {/*
                            THE SAME PILL THE DRAWER DRAWS.
                            ───────────────────────────────────────────────────
                            One component, so a client cannot read "needs
                            attention" beside their own name and something else
                            on the dashboard. The word is the judgement; the
                            figure only ranks two flagged clients against each
                            other, which words cannot do.

                            `sm`, because this one sits inside a row of small
                            facts rather than beside a heading.
                          */}
                          {item.band && (
                            <>
                              <ClientStandingPill
                                band={item.band}
                                score={item.score}
                                size="sm"
                              />
                              <span aria-hidden="true">·</span>
                            </>
                          )}

                          {(() => {
                            /*
                             * `persistence` is left out HERE and nowhere else.
                             * The clock to the left already says "true for 5
                             * weeks now", and printing "like this for 5 weeks"
                             * beside it states one fact twice in one strip.
                             * It still earns its points in the score and still
                             * shows on surfaces that have no clock.
                             */
                            const shown = (item.concerns ?? []).filter(
                              concern => concern.key !== 'persistence'
                            );
                            if (shown.length === 0) return null;

                            return (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">
                                  {shown
                                    .map(concern =>
                                      t(`client.concern.${concern.key}`)
                                        .replace('{count}', String(concern.count))
                                        .replace('{of}', String(concern.of ?? ''))
                                    )
                                    .join(' · ')}
                                </span>
                              </>
                            );
                          })()}

                          {/* The date itself, because the figure beside it is
                              relative and nothing else on this row can be
                              matched against the diary or the drawer. */}
                          {gap.id !== 'refund_requested' && onDay(item.since, language) && (
                            <span className="shrink-0 text-[var(--v2-text-muted)]">
                              {' · '}
                              <bdi>{onDay(item.since, language)}</bdi>
                            </span>
                          )}
                          {/*
                            * When the platform will answer this itself.
                            *
                            * Only an unmarked meeting carries it, and only
                            * while `auto_complete_meetings` is on. Without it
                            * the row asked the owner to decide, said nothing
                            * about the automation due in ten hours, and then
                            * vanished when it ran — a task disappearing with
                            * no explanation is how somebody stops trusting
                            * the list.
                            *
                            * A sentence, not a control: the seven-day triage
                            * row already lets them correct it afterwards.
                            */}
                          {item.closingAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--v2-text-muted)] truncate">
                                {t('gaps.closing_at').replace(
                                  '{time}',
                                  new Date(item.closingAt).toLocaleTimeString(localeFor(language), {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                )}
                              </span>
                            </>
                          )}
                          {/*
                            * Said even when nothing is held, because this is
                            * not a detail about the row — it is money STILL
                            * LEAVING the client's account for an appointment
                            * that is not happening, and it continues until
                            * somebody decides otherwise.
                            */}
                          {item.planLive && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-medium text-amber-600 dark:text-amber-400 truncate">
                                {t('gaps.plan_still_charging')}
                              </span>
                            </>
                          )}
                          {/*
                            * WHY THIS ROW DESERVES A SECOND LOOK BEFORE IT IS
                            * BILLED.
                            *
                            * Every other row here says a person decided
                            * something and the money follows. This one says a
                            * clock did: `auto_complete_meetings` marked the
                            * meeting held because its date went by, which is
                            * the only answer it has — and a date passing is
                            * not evidence anyone attended.
                            *
                            * Without the sentence the row is indistinguishable
                            * from one the owner closed themselves, and the
                            * button beside it charges a client for an hour
                            * nobody has vouched for. Amber for the same reason
                            * the plan warning is: not an error, a thing to
                            * check before acting.
                            *
                            * `truncate` is deliberately NOT used — this one has
                            * to be readable, and it is the last thing on the
                            * line.
                            */}
                          {/*
                            THE STORY, where the fact does not tell it.

                            An unpaid invoice row said who, how much and how late, and the owner
                            still had to open the booking to learn that the appointment had been
                            MISSED and charged for. That is the sentence this adds, beside the
                            other qualifiers rather than above them: it explains the row, it is not
                            a second row.

                            Plain muted text, not the amber `autoHeld` uses. That one is a warning —
                            check this before you bill it — and this is context. Two colours for two
                            jobs, or the warning stops meaning anything.
                          */}
                          {/* The origin moved into `MailGapBlock`'s badge for
                              mail rows; anything else keeps it here. */}
                          {/* A refund says it in its header line, in one
                              phrase with the age inside it. See `ClientLine`. */}
                          {item.contextKey && !item.subject && gap.id !== 'refund_requested' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--v2-text-secondary)]">{t(item.contextKey)}</span>
                            </>
                          )}
                          {item.autoHeld && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-medium text-amber-600 dark:text-amber-400">
                                {t('gaps.auto_held_check') ||
                                  'Marked automatically because the date passed, worth checking it happened'}
                              </span>
                            </>
                          )}
                          {/*
                            * WHY A SECOND LINK IS WORTH SENDING.
                            *
                            * The cancellation email already carried a booking
                            * button: the path a client cancels through does
                            * not suppress it. So on its face this row asks the
                            * owner to send something the client has had since
                            * the moment they cancelled, and read that way it
                            * is noise.
                            *
                            * What makes it a task is the part the row never
                            * said: they have not come back. That is now a
                            * CHECKED fact rather than an assumption — a
                            * contact with any future hour is filtered out of
                            * this gap entirely — so the sentence states
                            * exactly what the data behind it means, and the
                            * owner can tell a personal nudge from a duplicate.
                            *
                            * Only on the empty-slot case. Where money is held
                            * the row is about the refund, and the client's
                            * diary is beside the point.
                            */}
                          {gap.id === 'booking_cancelled' && action === 'send_booking_link' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--v2-text-muted)]">
                                {t('gaps.cancelled_not_rebooked') ||
                                  'has not booked again since'}
                              </span>
                            </>
                          )}
                        </p>
                      </div>

                      {/*
                        THE SECOND TAP, FOR WHAT CANNOT BE UNDONE.

                        Replaces the button in place rather than opening a
                        dialog: the owner is looking at a list, and a modal per
                        row would cover the thing they came to read. The row
                        itself asks, and the answer is one control away in
                        either direction.

                        The confirm NAMES THE CONSEQUENCE — "Email Dana now",
                        "Cancel and tell Dana" — because the original label was
                        the problem. "Send it" and "Follow up" gave no sign
                        that a real message reaches a real client the instant
                        they are pressed.
                      */}
                      {action &&
                        !THE_REPLY_BOX_DOES_THIS.has(action) &&
                        !THE_REFUND_ROW_ANSWERS_ITSELF(gap) &&
                        state.kind === 'confirming' && (
                        <span className="shrink-0 self-start inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => act(gap, item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97]"
                            style={{ background: 'var(--v2-primary)', color: '#fff' }}
                          >
                            {(action === 'cancel_booking'
                              ? t('gaps.confirm.cancel_booking') ||
                                'Cancel and tell {name}'
                              : t('gaps.confirm.email') || 'Email {name} now'
                            ).replace('{name}', item.name)}
                          </button>
                          {/* The way out. Quiet, because backing out of
                              something irreversible should not need deciding
                              between two loud buttons. */}
                          <button
                            type="button"
                            onClick={() => setRow(key, { kind: 'idle' })}
                            aria-label={t('common.cancel') || 'Cancel'}
                            title={t('common.cancel') || 'Cancel'}
                            className="px-2 py-1.5 text-xs rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                          >
                            ✕
                          </button>
                        </span>
                      )}

                      {/*
                        ── LOOK BEFORE ACTING ──────────────────────────────────────────

                        Every button on this row DOES something to a client: sends a mail,
                        bills a stage, cancels an appointment. The row says who and roughly
                        what, and the owner's next question is often "what is actually going
                        on here" — which until now meant leaving the dashboard, finding the
                        contact and the booking by hand, and losing the list.

                        Three actions already navigate there instead of acting (see
                        `OPENS_A_SCREEN`), so the destination and the helper both exist. This
                        offers the same door from EVERY row, without committing to the action
                        beside it.

                        Only on rows that HAVE a booking. A gap about a quote nobody has written
                        has nothing to open, and an icon landing on a list that highlights nothing
                        reads as a product failure: the owner cannot tell whether they misread the
                        row or we did.

                        `bookingToOpen` is the honest test, and it is not one field: only three
                        definitions set `bookingId`, while the booking-centric gaps put the booking in
                        `entityId`. See `ENTITY_IS_A_BOOKING` for why that set is listed rather than
                        inferred.
                      */}
                      {/*
                        THE MAIL IT CAME IN, beside the door to the booking.

                        A refund that arrived by email has a thread behind it,
                        and the card carries only a quote from it. The owner's
                        question — what else did they say, is this the third
                        time they have written — is answered in the mail and
                        nowhere else.

                        Only when there IS a thread: a request filled in on the
                        portal has no mail to open, and an icon that lands on an
                        empty mailbox reads as a broken product.
                      */}
                      {/*
                        THE CONTROLS AS ONE WRAPPING ROW ON A PHONE.

                        These are direct children of the row, which is a column
                        under `sm` — so four of them stacked, one per line, and
                        the text they belong to scrolled off the top. Wrapped,
                        they sit on one line that wraps as needed; `sm:contents`
                        dissolves this wrapper from `sm` up, so the desktop
                        layout is byte-for-byte what it was.
                      */}
                      <div className="flex flex-wrap items-center gap-2 sm:contents">
                      {item.sourceThreadId && (
                        <a
                          href={mailThreadUrl(item.sourceThreadId, item.sourceThreadProvider)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t('gaps.refund.open_email')}
                          title={t('gaps.refund.open_email')}
                          className="shrink-0 self-start inline-flex items-center justify-center p-1.5 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition-colors"
                        >
                          <Mail className="w-4 h-4" aria-hidden="true" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openRecord(gap.id, item)}
                        aria-label={t(bookingToOpen ? 'gaps.open_booking' : 'gaps.open_contact')}
                        title={t(bookingToOpen ? 'gaps.open_booking' : 'gaps.open_contact')}
                        className="shrink-0 self-start inline-flex items-center justify-center p-1.5 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition-colors"
                      >
                        {bookingToOpen ? (
                          <CalendarSearch className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <UserRound className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>

                      {/*
                        THE ROW'S OWN FINISH BUTTON, beside the door to the
                        client — the slot every other row keeps its action in.
                        Primary-filled, because on a mail row it is the one
                        thing meant to be pressed once the reply has gone, and
                        the quiet outline it used to wear made it read as a
                        secondary option beside a box that had none.
                      */}
                      {/*
                        A REFUND REQUEST IS ANSWERED YES OR NO, not "handled".
                        The yes is the refund button beside this one, which
                        opens the owner's own dialog. This is the no, and it
                        records WHICH was decided — the thing "mark as handled"
                        could never say.
                      */}
                      {/*
                        ─────────────────────────────────────────────────────
                        THERE IS NO "MARK AS HANDLED" HERE ANY MORE.
                        It called the same endpoint as `דחייה`, closed the same
                        request and settled the same thread, and sent the client
                        nothing either way. One word apart in the database and
                        identical to press — two buttons for one act.

                        Worse, it was the wrong home for the case it was meant
                        to serve. "I already sent the money by bank transfer"
                        marked the request closed while the ledger went on
                        saying the client was never refunded. That belongs in
                        the refund dialog, which records a hand-returned refund
                        properly (`settledByHand`), and now has a button of its
                        own above.
                        ─────────────────────────────────────────────────────
                      */}
                      {/*
                        ─────────────────────────────────────────────────────
                        THE AGENT'S ANSWER, AS A BUTTON WITH ITS FIGURE ON IT.

                        The owner is not pressing "refund" — they are pressing
                        a number they can read three lines above, next to the
                        reasoning that produced it. That is what makes one
                        press defensible on money that cannot come back.

                        The LABEL changes with how the money was taken. A card
                        payment goes back through the processor; one taken by
                        bank transfer does not, and the platform only RECORDS
                        that the owner returned it. Calling both "refund" would
                        promise something the second cannot do — the same
                        relabel `MoneyEntryActions` already makes.
                        ─────────────────────────────────────────────────────
                      */}
                      {/*
                        A REFUND DECIDES HERE TOO, in the row every other gap
                        keeps its action in.

                        It used to render at the foot of the block instead, so
                        that one gap put its buttons in a place no other row
                        did: an owner working down the list found the controls
                        in the top row four times and at the bottom of the
                        fifth. The facts, the timeline and the recommendation
                        are all still above the fold of the block — this moves
                        where the buttons SIT, not what the owner has read by
                        the time they reach them.
                      */}
                      {refundDecisions(gap, item, state)}

                      {item.subject && CONVERSATION_GAPS.has(gap.id) && (
                        <button
                          type="button"
                          onClick={() => void settleMailRow(gap, item)}
                          disabled={state.kind === 'working' || state.kind === 'done'}
                          className="shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
                          style={{ background: 'var(--v2-primary)', color: '#fff' }}
                        >
                          {state.kind === 'done' ? (
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : null}
                          {state.kind === 'done'
                            ? t('gaps.reply.cleared')
                            : t('gaps.reply.mark_handled')}
                        </button>
                      )}

                      {action &&
                        !THE_REPLY_BOX_DOES_THIS.has(action) &&
                        !THE_REFUND_ROW_ANSWERS_ITSELF(gap) &&
                        state.kind !== 'confirming' && (
                        <button
                          type="button"
                          onClick={() => act(gap, item)}
                          disabled={state.kind === 'working' || state.kind === 'done'}
                          /*
                            The one thing on the row meant to be pressed, so it
                            is allowed to look like it: a little more padding, a
                            lift in its own colour, and a press state. It was a
                            flat rectangle that read as a label.

                            Once DONE it stops asking. Keeping the solid fill on
                            a finished action left the loudest element on the row
                            pointing at the one thing already handled, and it is
                            `disabled` by then — so it goes to a quiet success
                            tint and drops the lift, while `opacity` stays for
                            `working`, which is still in flight.
                          */
                          /* `self-start`: the row above is a COLUMN on a phone,
                             which stretches its children, and a button stretched
                             to the full width of the card reads as the card's
                             action rather than this row's. */
                          /* `ap-primary-lift` only while it is the primary
                             button: the done state is a tinted chip and wants
                             no shadow at all. See the rule in `globals.css`
                             for why the lift cannot stay inline. */
                          className={`shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all hover:brightness-110 active:scale-[0.97] disabled:active:scale-100 disabled:hover:brightness-100${
                            state.kind === 'done' ? '' : ' ap-primary-lift'
                          }`}
                          style={
                            state.kind === 'done'
                              ? {
                                  background:
                                    'color-mix(in srgb, var(--v2-success) 14%, transparent)',
                                  color: 'var(--v2-success)',
                                }
                              : {
                                  background: 'var(--v2-primary)',
                                  color: '#fff',
                                  opacity: state.kind === 'working' ? 0.6 : undefined,
                                }
                          }
                        >
                          {state.kind === 'done' ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              {t('gaps.done')}
                            </>
                          ) : (
                            <>
                              <Icon className="w-3.5 h-3.5" />
                              {state.kind === 'working'
                                ? t('gaps.working')
                                : t(`gaps.action.${actionKey}`)}
                              {/* See `OPENS_A_SCREEN`: this one goes somewhere
                                  rather than doing something. Mirrored, because
                                  it points the way the reader is going. */}
                              {state.kind === 'idle' && OPENS_A_SCREEN.has(action) && (
                                <span aria-hidden="true" className="opacity-70">
                                  {isRTL ? '‹' : '›'}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      )}
                      </div>
                    </div>

                    {/*
                      ─────────────────────────────────────────────────────────
                      FULL WIDTH, BELOW THE ROW — NOT BESIDE THE BUTTONS.

                      Every other block lives in the `flex-1` column that
                      shares the row with the action buttons. That column is
                      whatever is left after the buttons, and the mail blocks
                      are short enough not to care.

                      This one is not. It carries three steps — what the client
                      asked, what the diary says, what we recommend — and
                      squeezed into half a row it wrapped into a narrow column
                      with the other half sitting empty beneath the buttons.
                      The information was all there and unreadable.

                      So it sits under the whole row and uses its full width,
                      the way the promoted position already does. Nothing about
                      the block changed; only where it is allowed to breathe.
                      ─────────────────────────────────────────────────────────
                    */}
                    {gap.id === 'refund_requested' && (
                      <>
                        <RefundGapBlock
                          value={item.value}
                          currency={item.currency}
                          noteKey={item.noteKey}
                          note={item.note}
                          subject={item.subject}
                          quote={item.quote}
                          /* What the diary says happened, so the owner can answer
                             without going to find the booking. */
                          bookingOutcomeKey={item.bookingOutcomeKey}
                          bookingWhen={item.bookingWhen}
                          bookingContradicts={item.bookingContradicts}
                          recommendation={item.refundRecommendation}
                          recommendedAmount={item.refundRecommendedAmount}
                          reasoning={item.refundReasoning}
                          /* The booking in full, so the owner answers without opening it. */
                          paidAmount={item.paidAmount}
                          paidAt={item.paidAt}
                          paidMethod={item.paidMethod}
                          bookedAt={item.bookedAt}
                          serviceMinutes={item.serviceMinutes}
                          servicePrice={item.servicePrice}
                          refundableAmount={item.refundableAmount}
                          askedAt={item.since}
                          money={money}
                          timeZoneOptions={timeZoneOptions}
                          dense
                          t={t}
                        />

                        {/*
                          AND THE ANSWER, UNDER WHAT IT IS ANSWERING.

                          The box used to render further up, beside where a mail
                          row puts it — which left a refund opening with a
                          suggested reply ABOVE the request, the amount, the
                          diary and the recommendation it was a reply to. The
                          owner read the answer before the question.

                          It follows the block for the same reason the block
                          sits down here at all: this is the full-width part of
                          the row, and the reply is the last step of the three
                          the block lays out.
                        */}
                        {gap.id === 'refund_requested' && item.subject && (
                          <h3
                            className="text-[10.5px] font-bold uppercase mt-3 mb-1.5 text-[var(--v2-text-muted)]"
                            style={{ letterSpacing: '0.06em' }}
                          >
                            {t('gaps.refund.your_reply').replace('{name}', firstNameOf(item.name))}
                          </h3>
                        )}

                        {item.subject && canAnswerHere(gap.id, item) && (
                          <MailReplyBox
                            contactId={item.contactId}
                            threadId={item.threadId}
                            draftId={item.draftId}
                            draftBody={item.draftBody ?? item.refundClientDraft}
                            subject={item.subject}
                            provider={item.viaProvider}
                            answeredAt={item.answeredAt}
                            language={language}
                            onDone={onChanged}
                            t={t}
                          />
                        )}

                      </>
                    )}

                    {item.queued && state.kind === 'idle' && (
                      <div
                        className="mt-2 pt-2 border-t flex items-center justify-between gap-2"
                        style={{ borderColor: 'var(--v2-border)' }}
                      >
                        <p className="text-[11px] text-[var(--v2-text-muted)] min-w-0">
                          {t('gaps.will_send')} {item.queued.label}
                          {item.queued.dueAt && <> · {dueIn(item.queued.dueAt, t)}</>}
                        </p>
                        {/*
                          "Send now" waits for the send (BL-7a part 2), so say so
                          and take both buttons away: no second click while it runs.
                        */}
                        {isQueuedWorking ? (
                          <span className="text-[11px] text-[var(--v2-text-muted)]" aria-live="polite">{t('gaps.working')}</span>
                        ) : (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => control(item, 'send_now')}
                              className="text-[11px] font-medium text-[var(--v2-primary)] hover:opacity-70"
                            >
                              {t('gaps.send_now')}
                            </button>
                            <span className="text-[var(--v2-border)]">·</span>
                            <button
                              type="button"
                              onClick={() => control(item, 'cancel')}
                              className="text-[11px] font-medium text-[var(--v2-text-muted)] hover:opacity-70"
                            >
                              {t('gaps.cancel')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/*
                      The second answer, in the shape the queued reply above
                      already uses: a quiet text control rather than a second
                      loud button. "Cancel it" is the likelier move and keeps
                      the primary button; this is the one that says the session
                      is still happening — and lets the client's reminder,
                      held while the question is open, resume.
                    */}
                    {gap.id === 'booking_refunded' && state.kind === 'idle' && (
                      <div
                        className="mt-2 pt-2 border-t flex items-center justify-between gap-2"
                        style={{ borderColor: 'var(--v2-border)' }}
                      >
                        <p className="text-[11px] text-[var(--v2-text-muted)] min-w-0">
                          {t('gaps.refunded_hint')}
                        </p>
                        <button
                          type="button"
                          onClick={() => keepAfterRefund(gap, item)}
                          className="text-[11px] font-medium text-[var(--v2-primary)] hover:opacity-70 shrink-0"
                        >
                          {t('gaps.action.keep_booking')}
                        </button>
                      </div>
                    )}

                    {/*
                      THE OTHER ANSWER TO A CANCELLED BOOKING.

                      Refunding is the likelier move and keeps the primary
                      button. This is the one that says the money stays — a
                      deposit forfeited inside its cancellation window, which
                      is ordinary, agreed in advance, and was impossible to
                      record. The gap holds a row for as long as money is
                      unreturned, so without this the owner was asked the same
                      question every day and had no way to answer it.

                      Only where money is actually held: with nothing to keep
                      the offer is meaningless, and the row is then about
                      refilling the hour rather than about the money.

                      Quiet text, not a second loud button — the same treatment
                      its mirror above uses, and for the same reason: backing a
                      decision out of a list should not look like the headline
                      act.
                    */}
                    {gap.id === 'booking_cancelled' &&
                      moneyHeld(item) &&
                      state.kind === 'idle' && (
                        <div
                          className="mt-2 pt-2 border-t flex items-center justify-between gap-2"
                          style={{ borderColor: 'var(--v2-border)' }}
                        >
                          <p className="text-[11px] text-[var(--v2-text-muted)] min-w-0">
                            {t('gaps.kept_payment_hint') ||
                              'Keeping it? We will stop asking about this one.'}
                          </p>
                          <button
                            type="button"
                            onClick={() => keepThePayment(gap, item)}
                            className="text-[11px] font-medium text-[var(--v2-primary)] hover:opacity-70 shrink-0"
                          >
                            {t('gaps.action.keep_payment') || 'Keep it'}
                          </button>
                        </div>
                      )}

                    {rows[`queued:${item.contactId}`]?.kind === 'refused' && (
                      <p className="mt-2 text-[11px] flex items-start gap-1.5 text-[var(--v2-text-muted)]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>{(rows[`queued:${item.contactId}`] as { message: string }).message}</span>
                      </p>
                    )}

                    {state.kind === 'refused' && (
                      <p className="mt-2 text-[11px] flex items-start gap-1.5 text-[var(--v2-text-muted)]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>{state.message}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/*
        The one refund dialog, opened from the dashboard.

        It knows things a POST from here cannot: what is actually left to refund
        (it re-reads the server figure rather than trusting the amount passed
        in), whether a payment plan is still running, and whether the money came
        through Stripe at all. Rendered inside the card because it portals out
        of it anyway.
      */}
      {extending && (
        <ExtendQuoteDialog
          proposalId={extending.proposalId}
          contactName={extending.name}
          /* Formatted here, not in the dialog. It was passed raw, so the sentence
             read "It ran out on 2026-10-15" — a database value in front of an
             owner, in the wrong language. `startedOn` is this card's date voice and
             already renders a date-only value without walking it back a day. */
          lapsedOn={extending.lapsedOn ? startedOn(extending.lapsedOn, language) : null}
          isRTL={isRTL}
          t={t}
          onClose={() => setExtending(null)}
          onSuccess={() => {
            setExtending(null);
            /* The quote is live again, so the row has left this card. */
            onChanged?.();
          }}
          onError={message => toast.error(message)}
        />
      )}

      {refunding && (
        <RefundModal
          isOpen
          onClose={() => setRefunding(null)}
          bookingId={refunding.bookingId}
          originalAmount={refunding.amount}
          currency={refunding.currency}
          contactName={refunding.name}
          /*
           * OPENED ALREADY ANSWERED. Everything below came from the card: the
           * agent's figure, and the reason the CLIENT gave on their own form.
           * The dialog is unchanged in what it can do — this only saves the
           * owner re-entering facts the system already has.
           */
          startPartial={refunding.startPartial}
          prefillAmount={refunding.prefillAmount}
          prefillReasonKey={refunding.reasonKey}
          prefillReasonNote={refunding.reasonNote}
          isRTL={isRTL}
          onSuccess={() => {
            setRefunding(null);
            // The row has changed — refetch so a settled one leaves the card.
            onChanged?.();
          }}
          /*
           * REQUIRED, not optional. The dialog renders no error of its own —
           * every failure is handed to this callback — so leaving it off would
           * make a refused refund look like nothing happened at all, on the one
           * action here that moves real money.
           */
          onError={message => toast.error(message)}
        />
      )}
    </div>
  );
}

/**
 * How long it has been stuck, in the units a person would say out loud.
 *
 * Deliberately coarse: nobody acts differently on four hours versus five, and
 * "3 days" is the number that decides whether this is now urgent.
 */
function waitedFor(since: string, t: (key: string) => string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (minutes < 60) return t('gaps.just_now');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t('gaps.hours_short')}`;
  return `${Math.floor(hours / 24)}${t('gaps.days_short')}`;
}

/**
 * The date the clock started, for the tooltip beside it.
 *
 * "17 days" answers how long; this answers since when, which is the question
 * an owner asks next and the one the row has no width to answer inline.
 */
/**
 * The same instant, short enough to sit on the row itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `startedOn` is the long form and lives in the row's `title`, which is a
 * tooltip: it needs a mouse, and the owner reading this card is as likely to
 * be on a phone. So the only date they could actually see was a relative one —
 * "4 days since" — and a relative figure cannot be matched against anything.
 * The drawer lists sessions by DATE, the diary is by date, and the owner was
 * being asked to find "the one from four days ago" by counting backwards.
 *
 * No year: every row on this card is recent by construction, and a year on
 * each one costs width that the note needs more.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LANGUAGE IS PASSED IN. `undefined` IS NOT THE APP'S LOCALE.
 *
 * Both of these called `toLocaleDateString(undefined, …)`, and `undefined`
 * means the RUNTIME's default — the browser's language, not the one the owner
 * chose in this product. So a dashboard set to Hebrew rendered "· 30 Oct" in
 * the middle of a Hebrew sentence, on any machine whose browser is English.
 * Which is most of them, including every one these pages get tested on.
 *
 * Nothing failed and nothing logged: `toLocaleDateString` always returns a
 * date, just the wrong one's words.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * A DATE-ONLY VALUE HAS NO TIMEZONE, AND MUST NOT BE GIVEN ONE.
 *
 * `since` is a `due_date` on some gaps ("2026-10-04") and a timestamp on
 * others. `new Date('2026-10-04')` is parsed as UTC MIDNIGHT, and rendering
 * that in a zone behind UTC walks it back a day: an invoice due on 4 October
 * read "3 באוק׳" for an owner whose timezone is America/New_York. The figure
 * beside it — "29 days since it was due" — was right, so the row disagreed
 * with itself by one day and only the date was wrong.
 *
 * A due date is a calendar fact, not an instant. Rendered in UTC it comes back
 * as the day that was written down, whatever clock the reader is on. Real
 * timestamps keep the owner's zone, which is correct for them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function onDay(since: string, language: string): string {
  const date = new Date(since);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(localeFor(language), {
        day: 'numeric',
        month: 'short',
        ...(DATE_ONLY.test(since) ? { timeZone: 'UTC' } : null),
      });
}

function startedOn(since: string, language: string): string {
  const date = new Date(since);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(localeFor(language), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        /* See `onDay`: a date-only value is a calendar fact. */
        ...(DATE_ONLY.test(since) ? { timeZone: 'UTC' } : null),
      });
}

/** Floored at a minute: "in 0 minutes" reads as already gone. */
function dueIn(dueAt: string, t: (key: string) => string): string {
  const minutes = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 60000);
  if (minutes <= 1) return t('gaps.due_now');
  return t('gaps.due_in').replace('{n}', String(minutes));
}

/**
 * A refusal reason, in words.
 *
 * `t()` answers with the KEY when it does not know one, which is truthy — so a
 * `t(key) || t(fallback)` chain never reaches its fallback and an unmapped
 * reason renders as the literal string `gaps.refused.invoice_gone` on a
 * customer's dashboard. Deciding on the key list here is what stops that.
 */
const KNOWN_REASONS = new Set([
  'no_contact_email',
  'no_booking_url',
  'journey_not_ready',
  'not_found',
  'send_failed',
  'already_sending',
  'already_settled',
  'already_returned',
  'appointment_passed',
  'not_approved',
  /*
   * The refund route's own refusals, which arrive as `code` rather than
   * `reason` and in upper case. Both are normalised below: a refusal the owner
   * cannot read is a dead end on the one action that moves real money.
   */
  'ambiguous_target',
  'not_positive',
]);

function translateReason(t: (key: string) => string, reason?: string): string {
  const key = reason?.toLowerCase();
  return key && KNOWN_REASONS.has(key)
    ? t(`gaps.refused.${key}`)
    : t('gaps.refused.generic');
}
