'use client';

import { useState } from 'react';
import {
  Calendar, Clock, CreditCard, ClipboardCheck, Mail, CheckCircle2,
  XCircle, AlertCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, Plus, Edit2,
  Loader2, ShoppingBag, Package, User, MapPin,
  /*
   * WHO recorded an outcome, as a mark rather than a sentence.
   *
   * `UserCog` is the owner — the person operating the business — and `User` the
   * client, so the pair reads as "someone running this" against "someone it was
   * done for". `Bot` is an automation, which must not look like either: a lead
   * reply that auto-completed a booking was nobody's decision.
   */
  UserCog, Bot,
  Phone, AtSign, Eye, ExternalLink, Save, X, RotateCcw, Ban, FileText, Paperclip,
  // The journey rail's "done" mark. A bare tick inside the filled disc, not
  // `CheckCircle2`, which would draw a ring inside a ring.
  Check,
  type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CollapsibleSection } from '../CollapsibleSection';
import type { SessionCardData, BookingJourneyData, BookingJourneyStep, MeetingAttempt } from './types';
import type { IntakeQuestion } from '@/lib/business-os/intake/types';
/*
 * `groupJourneyByDay` is gone from this card, deliberately.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The journey was bucketed under date headings — "16 אוק׳", "עתידי", "16 אוק׳"
 * again, "18 אוק׳" — with dashed wait markers between them. Reported as
 * confusing, and it is: a client journey is a SEQUENCE OF STAGES, and the day
 * each one happened to land on is incidental to the question an owner is
 * asking, which is "where is this up to and what do I do".
 *
 * Grouping by date also scattered one journey across four headings and made
 * the same date appear twice, so the eye could not follow the rail at all.
 *
 * The steps now render flat, in order, on one continuous rail. Each carries
 * its own timestamp, so nothing is lost but the bucketing. The module stays
 * for any other caller.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { cancelReasonKey } from '@/lib/business-os/cancellationReasons';
import { MeetingRowActions } from './MeetingRowActions';
import { StageRowActions } from './StageRowActions';
/* Pure, no I/O — the clock rule lives beside `quoteGate` rather than in this
   three-thousand-line component, for the reason that module's header gives. */
import { isMeetingPastDue } from '@/lib/business-os/quoteGate';
import { opensItself, type NextStep, type NextStepAction } from '@/lib/business-os/bookingNextStep';
import { sessionNextStep } from './sessionNextStep';
import { createLogger } from '@/lib/logger';

/* CLAUDE.md rule 3: structured logging, never `console.*`. Used only where a
   render-time failure is swallowed so it cannot take the drawer down — see
   `nextStep` below — because a swallowed error with no record is the kind
   nobody ever finds. */
const logger = createLogger({ module: 'BookingsTab' });
/*
 * Two constants and a split, no dependencies — safe in a client component. The
 * prefix itself stays stored English because a gap and a detector match on it;
 * only the reading of it is translated.
 */
import { splitClientCancellationReason } from '@/lib/services/bookingCancellationReason';
import { useBusinessTimezone } from '@/lib/business-os/LanguageContext';
import { PaymentPlanTotals } from '@/components/payments/PaymentPlanTotals';
import { REFUND_CLASS, REFUND_HEX } from '@/components/payments/refundTone';
import { firstTranslated, translated } from '@/lib/business-os/translateOptional';

/**
 * Where closed notices are remembered, for the reasons at `dismissedNotices`.
 *
 * Namespaced and versioned by its own name rather than by a counter: if the
 * shape of what is stored ever changes, this string changes with it and the old
 * value is simply never read again. Nothing here is worth migrating.
 */
const NOTICE_DISMISSED_KEY = 'bos.crm.booking.notices.dismissed.v1';

/**
 * Add another date to a package already under way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT OPENS THE BOOKING DIALOG, AND DOES NOT ASK FOR A DATE ITSELF.
 *
 * This was a bare `datetime-local` beside a checkbox. It accepted any value the
 * browser allowed, and the owner found out the hour was already sold, or the
 * day closed, only after pressing Add — as a red sentence under the field. A
 * make-up session is exactly the case where the diary matters most: the whole
 * reason for adding one is that something has to fit around what is already
 * there.
 *
 * So the link opens the dialog the rest of the platform books in, which knows
 * the service's hours, the owner's closed days and the slots already taken.
 * What it must NOT do is write the booking: a package's meeting is created by
 * the meetings endpoint, which gives it its parent, its occurrence number and
 * its charge. See `onPickSlot` on `SchedulingBookingModal`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * Is the JOB over, as opposed to the APPOINTMENT?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO QUESTIONS THAT ARE THE SAME ONE FOR MOST SERVICES, AND NOT FOR A QUOTE.
 *
 * For a direct service the appointment IS the job: it was held, so the job is
 * done. For a `sale_mode: 'proposal'` booking the appointment is a
 * consultation, and holding it does not end anything — it is where the work
 * STARTS. The quote has not been sent, agreed, or paid.
 *
 * Marking that consultation held used to hide the action strip, Cancel
 * included, because the strip tested the booking's own status. So an owner who
 * recorded "the meeting happened" lost the ability to call off a job that had
 * not been priced, while the client's proposal link stayed live and acceptable.
 *
 * Hoisted out of the step loop because the card-level state asked this question
 * correctly and the action strip asked the other one. Derived in two places
 * they drift, and the drift reads as a button that comes and goes for no reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function jobIsOver(input: {
  /** `scheduling_bookings.status`. */
  status?: string | null;
  /**
   * `scheduling_bookings.meeting_status` — where the appointment's outcome
   * actually lives now.
   *
   * Without it this function could not tell that a simple job had finished.
   * `complete()` writes `meeting_status: 'held'` and leaves `status` at
   * `confirmed`, so the `status === 'completed'` test below stopped matching
   * anything marked from that point on: the job read as still running and its
   * action strip never retired.
   */
  meeting_status?: string | null;
  /** A `sale_mode: 'proposal'` booking that is not a package session. */
  isQuoted: boolean;
  /** The payment step reached `completed` or `refunded`: money did arrive. */
  quotePaid: boolean;
  /**
   * The job was called off, whatever the appointment's status says.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THE STATUS IS NO LONGER ENOUGH TO ANSWER THIS
   *
   * This function used to read "called off" as `status === 'cancelled'`, which
   * worked only because cancelling always wrote that status. It no longer
   * does: `SchedulingBookingRepository.cancel` preserves a recorded attendance,
   * so a consultation that was held and whose job was then cancelled keeps
   * `completed` — there is no `completed_at` column, and overwriting it erased
   * the fact that the meeting happened.
   *
   * The immediate symptom was Cancel coming BACK on an already-stopped job: no
   * `cancelled` status, so `jobIsOver` read false, so the action strip
   * reappeared offering to call off work that had been called off. Asking the
   * status a question it has stopped answering is the whole bug.
   * ───────────────────────────────────────────────────────────────────────────
   */
  calledOff?: boolean;
}): boolean {
  /* `status === 'cancelled'` stays in the union rather than being replaced by
     it: rows cancelled by older code paths carry no `cancel_reason`, and a
     booking cancelled before it was ever held still writes the status. */
  const cancelled = input.status === 'cancelled' || Boolean(input.calledOff);

  /* A quoted job ends when it is called off or when it has been paid for.
     Nothing the appointment does ends it. */
  if (input.isQuoted) return cancelled || input.quotePaid;

  /*
   * For everything else the appointment IS the job, so its outcome ends it —
   * read from `meeting_status` first, with the old `status` values kept for
   * rows written before the column existed and never touched since.
   */
  const settled =
    input.meeting_status === 'held' ||
    input.meeting_status === 'no_show' ||
    input.status === 'completed' ||
    input.status === 'no_show';

  return cancelled || settled;
}

/** Has the appointment itself been dealt with? Attendance only. */
/**
 * Has this appointment been dealt with? Attendance only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READS THE MEETING'S OWN COLUMN NOW.
 *
 * It tested `booking.status`, which worked only while every meeting outcome
 * overwrote it. Held and no-show now write `meeting_status` and leave the job
 * alone — so a consultation marked held stays `confirmed`, and a predicate
 * reading the status would go on offering "mark it held" to an owner who had
 * just marked it, forever.
 *
 * The job's own ending still counts: a cancelled booking has no attendance to
 * record and never will, so its buttons go too.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function attendanceRecorded(booking: { status?: string | null; meeting_status?: string | null }): boolean {
  return (
    booking.meeting_status != null ||
    booking.status === 'cancelled' ||
    // Rows written before `meeting_status` existed, and never touched since.
    booking.status === 'completed' ||
    booking.status === 'no_show'
  );
}

function AddPackageMeeting({
  containerId,
  onOpen,
  t,
}: {
  containerId: string;
  onOpen: (containerId: string) => void;
  t: (key: string) => string;
}) {
  return (
    <button
      type="button"
      onClick={event => {
        event.stopPropagation();
        onOpen(containerId);
      }}
      className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#8B5CF6] hover:underline"
    >
      <Plus className="h-3.5 w-3.5" />
      {t('crm.booking.package.add_meeting')}
    </button>
  );
}

/**
 * The kinds the journey offers to send again.
 *
 * Mirrors the resend route's own list and must stay in step with it: a kind
 * missing here hides a link the API would have honoured, and one added here
 * that the API refuses hands the owner a button that returns an error.
 *
 * Short on purpose. A payment receipt or a refund notice describes a
 * transaction at a moment in time and cannot be truthfully rebuilt from where
 * the booking stands now, so neither is offered.
 */
const RESENDABLE_KINDS = new Set([
  'booking_confirmed',
  'booking_rescheduled',
  'missed_appointment',
  'meeting_cancelled',
  'booking_cancelled',
  'intake_requested',
]);

interface BookingsTabProps {
  sessions: SessionCardData[];
  /**
   * The real state of each booking's payment plan, keyed by booking id.
   *
   * The plan on a session is built from the SERVICE — "sold as three monthly
   * payments" — which says how it was sold, not what happened. A plan that was
   * stopped went on reading as a live plan on its first period, with nothing on
   * the timeline to say the remaining charges will never be taken.
   *
   * Absent for a contact with no plan, and while it is still loading; the plan
   * terms show either way and only the state line waits.
   */
  planStates?: Record<string, { status: string; periodsPaid: number; installmentCount: number }>;
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
  onNewSession?: () => void | Promise<void>;
  onEditSession?: (bookingId: string) => void;
  onManagePayment?: (session: SessionCardData) => void;
  onIntakeSaved?: (bookingId: string) => void;
  onSendIntake?: (bookingId: string) => Promise<void>;
  /**
   * Open the quote builder for this booking.
   *
   * Carries the declined proposal's id and reason, because a revision is a new
   * proposal that SUPERSEDES a named one — and the owner is pricing against
   * an objection they should be able to read while they do it.
   */
  /**
   * Mark a milestone done, which bills it.
   *
   * One action, not two: an owner who could mark stages complete without
   * billing them would leave a client owing money nobody had invoiced.
   */
  onCompleteStage?: (stageId: string, label: string, amount: string) => void;
  /**
   * Return the money collected against ONE stage.
   *
   * Per stage, because a refund follows a transaction and each milestone raises
   * its own invoice. The booking-level dialog refuses a partial outright once a
   * job has several payments — there is no honest way to split one figure
   * across two charges — so without this there is no route to returning a
   * single milestone except four levels down the payments list.
   *
   * Passed up like every other write this component delegates: the drawer owns
   * the dialog, and the row only says which money is meant.
   */
  onRefundStage?: (stage: {
    /**
     * One of these two, never neither.
     *
     * A quoted MILESTONE raises an invoice and is refunded through it. An
     * INSTALMENT period charged by the processor has no invoice at all — the
     * money is a `payment_transactions` row — so `invoiceId` was typed
     * `string` and cast from null at the only call site, which is how a paid
     * instalment came to offer no refund.
     *
     * `/api/payments/refunds` accepts either key, so both are carried and the
     * dialog sends whichever it was given.
     */
    invoiceId: string | null;
    transactionId: string | null;
    amount: number;
    refunded: number;
    currency: string;
    label: string;
  }) => void;
  onOpenProposalBuilder?: (
    bookingId: string,
    context: { supersedesId: string | null; declineReason: string | null; declineNote: string | null }
  ) => void;
  /**
   * Stop an accepted job part-way through.
   *
   * Passed up rather than fetched here: this component delegates every write, and
   * the parent owns the reload that has to follow one. The dialog it opens
   * collects the reason, because the reason is the point.
   */
  onStopQuote?: (proposalId: string, proposalTitle: string | null) => void;
  /**
   * Hand money back on a job that has already been stopped.
   *
   * Its own callback rather than `onManagePayment`: that modal reads the
   * BOOKING's payment, and a quoted job has none — the money sits on the stage
   * invoices — so it opened on "₪0.00, free service" for a job the client had
   * actually paid for. The refund dialog resolves the payment from the booking
   * server-side and gets it right.
   */
  /**
   * Read a quote that has already been sent.
   *
   * Separate from `onOpenProposalBuilder` because it is a different intent on the
   * same dialog: that one writes, this one reads. The owner had no way to see what
   * a sent quote actually said — the strip showed amounts and statuses, and the
   * words lived only on the client's copy.
   */
  onViewProposal?: (bookingId: string, proposalId: string) => void;
  onSendInvoice?: (invoiceId: string, bookingId: string) => Promise<void>;
  /**
   * Send the refund confirmation for one stage again.
   *
   * Passed up like every other write this component delegates: the drawer owns
   * the confirmation dialog and the reload, and the row only says which money
   * is meant.
   */
  onResendRefundEmail?: (invoiceId: string, bookingId: string) => void;
  /**
   * Send the confirmation email again — the "reminder" action on the journey.
   *
   * Optional and NOT yet wired by the drawer: the button is rendered so the
   * strip matches the agreed design, and it is inert until a handler is passed.
   * Deliberately not pointed at `onSendInvoice`, which sends a different email
   * entirely — a button that does the wrong thing is worse than one that waits.
   */
  /**
   * Send one message again, named by what it WAS.
   *
   * Replaces `onResendConfirmation`, which always sent the confirmation
   * whatever row the link sat on — so on a booking whose last mail was a
   * cancellation it offered to send "your appointment is confirmed".
   */
  onResendMail?: (bookingId: string, kind: string) => Promise<void> | void;
  /**
   * Call off the APPOINTMENT and leave the job running.
   *
   * Separate from `onSetBookingStatus(id, 'cancelled')`, which ends the work.
   * This exists for the case the owner and client agree to proceed WITHOUT
   * meeting: the site visit is off, the quote still gets written.
   */
  /**
   * Call off the appointment and leave the job running.
   *
   * `isQuoted` travels with it because the question the owner has to answer
   * next depends on it: a quoted job can continue without the meeting, so the
   * client's email has to say whether the quote is still coming, and only the
   * owner knows. A booking whose meeting IS the thing bought has no such
   * question.
   */
  onCancelMeeting?: (
    bookingId: string,
    context?: { isQuoted: boolean }
  ) => Promise<void> | void;
  /**
   * Record how an appointment actually went, from the card header.
   *
   * The edit dialog has always been able to set this; reaching it meant opening
   * a form about times and prices to answer a question — did they turn up? —
   * that the card itself is showing.
   */
  onSetBookingStatus?: (
    bookingId: string,
    status: 'completed' | 'no_show' | 'cancelled',
    /**
     * The MEETING this is about, for one session of a package.
     *
     * A package is one booking with N meetings, so a session has no booking to
     * complete — the outcome is recorded against the meeting, at a different
     * endpoint. Absent for every ordinary booking, which is the common case.
     */
    meetingId?: string | null,
    /**
     * Whether this session still has money of its own to decide.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * Only `no_show` reads it, and only to decide whether to OFFER the choice.
     *
     * A missed session used to do nothing to the money: only `held` bills a
     * per-session stage and only `cancelled` voids one, so the stage sat at
     * `pending` for ever, and the client was neither charged nor released. The
     * owner now answers that in the dialog, and this says whether there is
     * anything to answer.
     *
     * True only for an unbilled stage: `pending` with no invoice. A stage
     * already invoiced is the client's document to honour or have refunded,
     * not a decision still open, and an ordinary booking was invoiced when it
     * was made.
     * ─────────────────────────────────────────────────────────────────────────
     */
    chargeable?: boolean
  ) => Promise<void> | void;
  /**
   * Add a meeting to a package that is already running.
   *
   * A block of six is agreed and under way, and then a seventh date is needed:
   * the client missed one, or the course ran long. `charge` is the owner's
   * answer about the money and is only offered where it means anything — on a
   * package billed after each meeting, where the client is already paying
   * session by session.
   */
  onAddPackageMeeting?: (containerId: string) => void;
  isLoading?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  /**
   * A booking to open expanded, named by whatever linked here.
   *
   * `NeedsYouCard` raises its gaps FROM a booking — the consultation awaiting a
   * quote, the phase to be billed, the meeting with no outcome recorded — and
   * its buttons used to land the owner on this list with every row collapsed,
   * leaving them to work out which one the card meant.
   */
  focusBookingId?: string;
}

// Step status types
type StepStatus = 'completed' | 'active' | 'pending' | 'failed' | 'skipped' | 'refunded';

// Status colors for step indicators
const STATUS_COLORS: Record<StepStatus, { bg: string; border: string; icon: string; line: string; dot: string }> = {
  completed: {
    bg: 'bg-green-500',
    border: 'border-green-500',
    icon: 'text-white',
    line: 'bg-green-500',
    dot: 'bg-green-500'
  },
  active: {
    bg: 'bg-amber-500',
    border: 'border-amber-500',
    icon: 'text-white',
    line: 'bg-amber-500',
    dot: 'bg-amber-500'
  },
  pending: {
    bg: 'bg-[var(--v2-surface)]',
    border: 'border-[var(--v2-border)]',
    icon: 'text-[var(--v2-text-muted)]',
    line: 'bg-[var(--v2-border)]',
    dot: 'bg-[var(--v2-text-muted)]'
  },
  failed: {
    bg: 'bg-red-500',
    border: 'border-red-500',
    icon: 'text-white',
    line: 'bg-red-500',
    dot: 'bg-red-500'
  },
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * LEGIBLE. IT WAS A GREY GLYPH ON A GREY DISC.
   *
   * `text-slate-400` on `bg-slate-500/50` is slate on slate at half opacity —
   * barely any contrast, so the icon read as a smudge and an owner could not
   * tell which step it was. Every other state here puts white on a solid fill
   * or a muted glyph on the card's own surface; this one did neither.
   *
   * Lighter than `refunded`, which also uses slate, so the two stay apart at a
   * glance: a skipped step is a faint disc with a dark glyph, a refunded one is
   * a solid disc with a white glyph and its own returned-arrow icon.
   * ───────────────────────────────────────────────────────────────────────────
   */
  skipped: {
    bg: 'bg-slate-200 dark:bg-slate-700',
    border: 'border-slate-300 dark:border-slate-600',
    icon: 'text-slate-500 dark:text-slate-300',
    line: 'bg-slate-300 dark:bg-slate-600',
    dot: 'bg-slate-400'
  },
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE MONEY WENT BACK.
   *
   * Previously folded into `completed`, which is green, so a fully refunded job
   * looked settled at a glance and only the small print said otherwise.
   *
   * SLATE, AND NOT THE RED THE FIGURES USE.
   *
   * The rail is a severity channel, not an event log. Red already means five
   * things on it — overdue money, a declined card, a bounced email, a cancelled
   * booking, a dead quote — and every one of them is the owner's to act on. A
   * completed refund is the opposite: closed, nothing owed, nothing to chase.
   * Put it in red and red stops meaning "do something", which costs more than
   * this one node gains.
   *
   * The glyph changes too (`RotateCcw`), so the node is not merely quieter — it
   * says what happened. And the figures on the card ARE red: the returned total
   * and the badge beside it, where there are no failure states to confuse.
   *
   * The rule, written here because it is the one that keeps getting re-decided:
   * THE RAIL SAYS WHAT NEEDS DOING, THE CARD SAYS WHAT HAPPENED.
   *
   * A PARTIAL refund does not come here: it leaves `payment.status` at `paid`,
   * the business is still holding money, and there is still a job in progress.
   * ───────────────────────────────────────────────────────────────────────────
   */
  refunded: {
    bg: 'bg-slate-400',
    border: 'border-slate-400',
    icon: 'text-white',
    line: 'bg-slate-400',
    dot: 'bg-slate-400'
  }
};

// Map step keys to icons
/** One version of a quote, as the journey step hands it over. */
interface ProposalVersion {
  id: string;
  total: number;
  /** Already formatted in the quote's own currency. */
  amount: string;
  status: string;
  /** When this version stopped — decided, or sent and still open. */
  at: string | null;
  isCurrent: boolean;
  /** The document sent with this version, if any. */
  documentName: string | null;
  /** Why the client declined THIS version, in their own words and ours. */
  declineReason: string | null;
  declineNote: string | null;
  /** Why an accepted job was stopped part-way. */
  stopReason: string | null;
  stopNote: string | null;
}

/**
 * How each outcome reads.
 *
 * Semantic, not decorative: green is money agreed, red is a lost quote, amber
 * is still open, and a replaced version is grey because it is history rather
 * than an outcome. Only the word is coloured — colouring the amount too would
 * make the column look like a status bar instead of a list of prices.
 */
const VERSION_TONES: Record<string, { dot: string; text: string }> = {
  accepted: { dot: '#22C58B', text: '#15864F' },
  declined: { dot: '#F04438', text: '#B42318' },
  expired: { dot: '#F79009', text: '#B54708' },
  withdrawn: { dot: '#9AA1B2', text: 'var(--v2-text-muted)' },
  superseded: { dot: '#9AA1B2', text: 'var(--v2-text-muted)' },
  /*
   * Amber-grey, not the red `declined` wears and not the flat grey of
   * `withdrawn`. A stopped job was AGREED and part-delivered: money came in and
   * work happened. Painting it like a lost quote would misread the history, and
   * painting it like a replaced version would hide it.
   */
  stopped: { dot: '#B54708', text: '#B54708' },
  viewed: { dot: '#4F6EF7', text: '#3450C7' },
  sent: { dot: '#9AA1B2', text: 'var(--v2-text-muted)' },
};

const STEP_ICONS: Record<string, LucideIcon> = {
  /*
   * Keyed on what the journey builder actually emits.
   *
   * `ordered` and `booked` were here alongside `service` and nothing produces
   * either — leftovers from a vocabulary this platform does not use. An icon map
   * with keys no step carries reads as a feature that exists somewhere.
   */
  service: Calendar,
  // Schedule
  schedule: Clock,
  // Client
  client: User,
  // Payment
  payment: CreditCard,
  // Quote
  proposal: FileText,
  // Intake
  /*
   * `ClipboardCheck`, not `ClipboardList`.
   *
   * These render at 12px inside a 22px node. `ClipboardList` draws a clipboard
   * plus three ruled lines plus three bullet dots — at that size the strokes
   * land within a pixel of each other, fill in, and the icon reads as a smudge
   * rather than as anything. `ClipboardCheck` carries two shapes instead of
   * six and survives the reduction.
   */
  intake: ClipboardCheck,
  // Confirmation
  confirmation: Mail,
  email: Mail,
  // Session/Completion
  session: Clock,
  completed: CheckCircle2,
  done: CheckCircle2,
  /*
   * The delivery step of a service that is not booked into a time.
   *
   * `fulfilled`, `shipped` and `delivered` sat here too and no step ever
   * carried those keys — this platform sells services and ships nothing. The
   * one `delivered` in the journey builder is an EMAIL status, which never
   * reaches this map.
   */
  fulfillment: Package,
  // Status
  cancelled: XCircle,
  no_show: AlertCircle,
  failed: XCircle,
};

export function BookingsTab({
  sessions,
  planStates,
  t,
  isRTL,
  language,
  onNewSession,
  onEditSession,
  onManagePayment,
  onIntakeSaved,
  onSendIntake,
  onCompleteStage,
  onRefundStage,
  onOpenProposalBuilder,
  onStopQuote,
  onViewProposal,
  onSendInvoice,
  onResendRefundEmail,
  onResendMail,
  onCancelMeeting,
  onSetBookingStatus,
  onAddPackageMeeting,
  isLoading = false,
  isOpen,
  onToggle,
  focusBookingId
}: BookingsTabProps) {
  /*
   * Seeded with the booking a link named, so it is already open on the first
   * render rather than opening a moment later.
   *
   * An initial value, not an effect: expanding after mount would collapse the
   * row again every time this component re-rendered for an unrelated reason,
   * and would fight an owner who closed it. `useState`'s initialiser runs once.
   */
  const [expandedBookings, setExpandedBookings] = useState<Set<string>>(() => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * A CARD OPENS ITSELF WHEN THE BALL IS IN YOUR COURT.
     *
     * The drawer used to be a record you inspect: every card shut, the journey
     * one click further in, and nothing saying which of a booking's layers —
     * the meeting, the quote, the money — was waiting on the owner. An owner
     * had to already know that marking the meeting held is what opens the
     * quote step. That is a product you operate from memory.
     *
     * `opensItself` is true only for `whoseMove === 'owner'`. A quote sitting
     * with the client stays shut, deliberately: it is not a task, and opening
     * it would put the same weight on "they have not answered yet" as on
     * "nobody has asked them".
     *
     * In the INITIALISER, like the focus row above and for the same reason:
     * as an effect this would re-open on every unrelated re-render and fight
     * an owner who had just closed it.
     * ───────────────────────────────────────────────────────────────────────
     */
    const open = new Set<string>();
    if (focusBookingId) open.add(focusBookingId);

    for (const session of sessions) {
      try {
        if (opensItself(sessionNextStep(session))) open.add(session.booking.id);
      } catch {
        /*
         * A card that cannot be read still has to render. Nothing here is
         * worth taking the drawer down for, and shut is the safe default:
         * the owner sees the booking and can open it themselves.
         */
      }
    }
    return open;
  });
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  /**
   * Notices the owner has closed.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A NOTICE IS NOT A TASK, SO IT HAS TO BE POSSIBLE TO IGNORE.
   *
   * The banner above it states what the card is waiting for and carries the
   * button that answers it; it goes away by being acted on. A notice states
   * something true that may or may not need anything — "money was collected
   * for work that stopped" is a refund DECISION, and the owner may have taken
   * it already, outside this system, in cash, or by agreeing the deposit is
   * kept. There is no action that could retire it, so without a close control
   * it would sit on the card for ever and teach them to stop reading that part
   * of it.
   *
   * Keyed by booking AND notice, so closing one says nothing about the same
   * notice on another job or a different notice on this one.
   *
   * In `localStorage` rather than the database: it is one person's reading
   * preference on one screen, it carries nothing another device or another user
   * needs, and a wrong answer costs a reminder reappearing. Every access is
   * wrapped, because a browser with site data blocked throws on the getter
   * itself and a card that cannot render is a far worse failure than a notice
   * that will not stay closed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [dismissedNotices, setDismissedNotices] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = window.localStorage.getItem(NOTICE_DISMISSED_KEY);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
    } catch {
      return new Set();
    }
  });

  const dismissNotice = (noticeId: string) => {
    setDismissedNotices(previous => {
      const next = new Set(previous).add(noticeId);
      try {
        window.localStorage.setItem(NOTICE_DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        /* Storage refused. It stays closed for this session, which is the part
           the owner just asked for; it will be back next visit. */
      }
      return next;
    });
  };

  /**
   * Which meetings have their history open.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * CLOSED BY DEFAULT, AND THAT IS THE POINT.
   *
   * The header answers the question most visits have — when is it, where does
   * it stand — and the chain beneath answers one that is asked occasionally.
   * Drawn always, a booking moved twice put nine lines between the owner and
   * the buttons they opened the card for.
   *
   * Keyed by booking id, so opening one leaves the others shut.
   */
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());

  const toggleHistory = (bookingId: string) => {
    setOpenHistory(prev => {
      const next = new Set(prev);
      if (next.has(bookingId)) next.delete(bookingId);
      else next.add(bookingId);
      return next;
    });
  };
  /**
   * Finding one booking among a client's history, and reading it five at a time.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Both are the same problem seen from two ends. A contact who has been with a
   * business for a year has thirty bookings here, each an expandable journey
   * card several hundred pixels tall, inside a drawer that is a column beside
   * the contact rather than a page of its own. Scrolling thirty of those to
   * reach "the consultation in March" is not reading, it is hunting.
   *
   * The page is a NUMBER rather than a slice of state that mirrors the list:
   * it is clamped against what the search leaves standing at render time, so it
   * can never point past the end and there is no effect to keep in step.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [bookingSearch, setBookingSearch] = useState('');
  /*
   * `null` means "nobody has paged yet", which is not the same as page 0.
   *
   * A link from the Needs-you card names one booking and this tab expands it,
   * but expanding a row five pages down shows the owner nothing: the list is
   * five to a page and the expanded row renders outside the slice. The gap that
   * raises these is usually weeks old, so the booking it names is very rarely
   * among the five most recent — the one case where the old behaviour looked
   * correct is a contact with a single booking, which is exactly the contact
   * the fault is invisible on.
   *
   * Null lets the page FOLLOW the focused booking, including back to it when a
   * search narrows the list. The moment the owner presses a pager themselves
   * their choice is stored and wins from then on.
   */
  const [bookingPage, setBookingPage] = useState<number | null>(null);
  // Inline intake editing state
  const [editingIntakeBookingId, setEditingIntakeBookingId] = useState<string | null>(null);
  const [editingIntakeResponses, setEditingIntakeResponses] = useState<Record<string, unknown>>({});
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeSuccess, setIntakeSuccess] = useState(false);
  // Intake email sending state
  const [sendingIntakeBookingId, setSendingIntakeBookingId] = useState<string | null>(null);
  // Invoice email sending state
  const [sendingInvoiceBookingId, setSendingInvoiceBookingId] = useState<string | null>(null);

  // The business's clock, so this tab, the calendar and the client's email all
  // name the same hour for one booking.
  const { timeZoneOptions } = useBusinessTimezone();

  /** A payment stage's date, short, on the business's clock. */
  /**
   * A stage's date, which is one of two different kinds of value.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * `paidAt` is an INSTANT — the moment money arrived — and must be resolved in
   * the business's zone, because that is what decides which day it landed on.
   *
   * `dueDate` is a DATE. `new Date('2026-09-30')` makes it midnight UTC, and
   * rendering that in a zone behind UTC moves it to the 29th. An invoice raised
   * on the 30th and payable on receipt therefore read "due 29 Sept" — a day
   * before it existed — and the row beside it said OVERDUE.
   *
   * So a date-only value is rendered AS its calendar date — built in UTC and
   * read back in UTC — rather than converted into anyone's zone. Anchoring at
   * noon UTC, the usual workaround, still lands on the next day in Auckland
   * (UTC+13); `dateOnlyIsNotMidnightUTC.guard` pins that.
   * ─────────────────────────────────────────────────────────────────────────────
   */
  /**
   * @param withYear adds the year — for a date that has to stand on its own.
   *
   * Off by default, because a stage list is read as a sequence: the rows sit
   * together, in order, and repeating "2026" down every one of them is noise
   * the reader has already got from its neighbours.
   *
   * A single payment has no neighbours. Its one date is the whole record of
   * when the money moved, and "2 Oct" on a booking from any previous year is a
   * date the owner cannot reconcile against a statement without opening
   * something else.
   */
  const stageDate = (value: string, withYear = false) => {
    const parts: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    };

    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`).toLocaleDateString(isRTL ? 'he-IL' : 'en-US', {
          timeZone: 'UTC',
          ...parts,
        })
      : new Date(value).toLocaleDateString(isRTL ? 'he-IL' : 'en-US', timeZoneOptions(parts));
  };

  const toggleBooking = (id: string) => {
    setExpandedBookings(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Sort sessions: upcoming first, then by date
  /**
   * YOUR QUEUE FIRST, THEN THE DIARY.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This sorted by the clock alone: anything upcoming to the top, soonest
   * first, then everything else newest first. On a client with a year of
   * history that buries the one booking actually waiting on the owner
   * underneath three appointments that need nothing from anybody.
   *
   * The question an owner opens this list with is "what do I have to do", and
   * `nextStep` already answers it for four other surfaces. Three bands:
   *
   *   1. NEEDS YOU      a quote to write, a meeting to mark, money to ask for
   *   2. WITH THE CLIENT a quote sent, an invoice out — live, but not a task
   *   3. SETTLED        done, or called off
   *
   * Inside each band the clock still decides, and it decides differently by
   * band on purpose: in band 1 the OLDEST is the most urgent, because it has
   * been waiting longest. In the others the newest is the most interesting.
   * Sorting band 1 newest-first would put the thing you forgot about last.
   *
   * A booking whose next step cannot be worked out sorts as settled rather
   * than taking the list down — same reasoning as the render guard.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const sortedSessions = (() => {
    const band = (s: SessionCardData): number => {
      try {
        const move = sessionNextStep(s).whoseMove;
        return move === 'owner' ? 0 : move === 'client' ? 1 : 2;
      } catch {
        return 2;
      }
    };

    const when = (s: SessionCardData): number => {
      const raw = s.booking.start_time || s.booking.created_at;
      const at = raw ? new Date(raw).getTime() : 0;
      return Number.isNaN(at) ? 0 : at;
    };

    return [...sessions]
      .map((session, index) => ({ session, index, band: band(session), when: when(session) }))
      .sort((a, b) => {
        if (a.band !== b.band) return a.band - b.band;
        // Oldest first where it is a task; newest first everywhere else.
        if (a.when !== b.when) return a.band === 0 ? a.when - b.when : b.when - a.when;
        // A stable tiebreak, so two bookings on the same day never swap places
        // between renders and make the list look like it is moving on its own.
        return a.index - b.index;
      })
      .map(entry => entry.session);
  })();


  // Format helpers
  /**
   * The year, where a date has to stand on its own.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A contact drawer is not a calendar. It is read months after the fact, and
   * it holds a client's whole history at once: a package running into next
   * year, a booking from last autumn, a quote accepted the January before.
   * "12 באוק׳" answers none of those, and the reader has no surrounding context
   * to recover the year from — unlike a list grouped under a date heading.
   *
   * Opt-in rather than applied to every date in the file, because the compact
   * ones beside a figure (a refund date inside a 290px money column, a version
   * stamp) are read in the context of the row they sit in, and a year there
   * costs width to repeat something the row already implies.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const withYear = (on?: boolean) => (on ? { year: 'numeric' as const } : {});

  const formatDate = (dateString: string, opts?: { withYear?: boolean }) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language, timeZoneOptions({
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...withYear(opts?.withYear),
      hour: '2-digit',
      minute: '2-digit'
    }));
  };

  const formatShortDate = (dateString: string, opts?: { withYear?: boolean }) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language, timeZoneOptions({
      month: 'short',
      day: 'numeric',
      ...withYear(opts?.withYear)
    }));
  };

  /** Just the clock: the day already has its own marker above the entries. */
  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString(language, timeZoneOptions({
      hour: '2-digit',
      minute: '2-digit'
    }));
  };

  const formatDateTime = (dateString: string, opts?: { withYear?: boolean }) => {
    const date = new Date(dateString);
    return date.toLocaleString(language, timeZoneOptions({
      month: 'short',
      day: 'numeric',
      ...withYear(opts?.withYear),
      hour: '2-digit',
      minute: '2-digit'
    }));
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} ${t('common.minutes') || 'min'}`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours} ${t('common.hours') || 'hr'}`;
    return `${hours}h ${mins}m`;
  };

  // Whether this booking has no time slot — the service decides, not the row.
  const isUnscheduledBooking = (booking: SessionCardData['booking']) => {
    /*
     * `is_scheduled`, not a guess from the timestamp.
     *
     * This read `booking.service?.is_product`, a column that does not exist in
     * the database — so the test collapsed to "has no start time" and a
     * SCHEDULED booking missing its time was silently reclassified, hiding the
     * very thing that was wrong. The start-time check survives only as a
     * fallback for a row that did not carry `is_scheduled`.
     */
    return (
      booking.service?.is_scheduled === false ||
      (booking.service?.is_scheduled == null && !booking.start_time)
    );
  };

  /*
   * The badge on a booking header.
   *
   * Turns on whether a time was BOOKED. Nothing in the data says "product",
   * and before `is_scheduled` was read here the start time was the only thing
   * that distinguishes a session from a course sold without one.
   *
   * `confirmed` renders as "קרובה" — *upcoming*, a word about when something
   * will be attended. With no time booked there is nothing to attend, so the
   * card announced a purchase as "coming soon" beside a line saying it had been
   * bought a week ago.
   *
   * Only that one status differs. Completed, cancelled and awaiting-payment
   * mean the same thing either way, and giving them separate wording would be
   * inventing a difference to be consistent about.
   */
  /**
   * What a QUOTED booking's card says.
   *
   * Not `booking.status`, which describes the consultation. A job whose meeting
   * happened this morning is not finished — it has not even been priced — and a
   * green "Completed" badge on it retires a live opportunity from the owner's
   * view. The badge tracks the JOB: who owes whom the next move.
   *
   * Cancelled is the exception and passes straight through: it is the one mark
   * that genuinely ends a quoted job.
   */
  const getQuotedStatusLabel = (
    bookingStatus: string,
    quoteState: string,
    paid: boolean,
    /*
     * Where the consultation stands — taken from the journey step, which already
     * weighed the booking's start time against now. Re-deriving it from
     * `status === 'confirmed'` here would call a meeting that finished this
     * morning "upcoming", because nothing marks a booking past.
     *
     * Three values, not a boolean: `unmarked` is the state the gate added, and
     * collapsing it into "not ahead" is exactly how the badge came to say
     * "needs a quote" about a meeting nobody had confirmed happened.
     */
    meetingState: 'ahead' | 'unmarked' | 'settled',
    /*
     * The job was called off, which `bookingStatus` can no longer be relied on
     * to say: a held consultation keeps `completed` when its job is cancelled.
     * See `jobCalledOff` at the call site for the three signals behind it.
     */
    calledOff = false
  ) => {
    const amber = { color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10' };
    const blue = { color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/10' };
    const green = { color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/10' };
    const red = { color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10' };

    if (bookingStatus === 'cancelled') {
      return { text: t('crm.booking.quoted.lost'), ...red };
    }
    if (quoteState === 'accepted') {
      return paid
        ? { text: t('crm.booking.status.completed') || 'Completed', ...green }
        : { text: t('crm.booking.quoted.won_unpaid'), ...green };
    }
    if (quoteState === 'declined' || quoteState === 'expired') {
      return { text: t('crm.booking.quoted.declined'), ...amber };
    }
    /*
     * Agreed, then stopped part-way.
     *
     * Its own badge, and NOT `lost`: that one is for a cancelled booking where
     * nothing was agreed. Here the client signed, work happened and money very
     * likely moved — calling it lost would misread the history.
     *
     * Amber rather than red for the same reason. It is a terminal state that
     * needs nothing from the owner, not a failure.
     */
    if (quoteState === 'stopped') {
      return { text: t('crm.booking.quoted.stopped'), ...amber };
    }
    /*
     * Called off with a quote still out, and the status no longer says so.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The `bookingStatus === 'cancelled'` test at the top of this function
     * answers for every booking whose status was written. It does not answer
     * for one whose consultation was marked held before the job was cancelled:
     * that keeps `completed`, falls past the branch above, and lands on
     * "quote sent" — a job the owner called off, with the badge telling them a
     * price is still sitting with the client.
     *
     * Below `stopped` on purpose. An agreed job that was stopped part-way is
     * not lost, and that distinction is the reason `stopped` has its own badge
     * at all; reaching this branch means nothing was ever agreed.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (calledOff) {
      return { text: t('crm.booking.quoted.lost'), ...red };
    }
    if (quoteState === 'sent' || quoteState === 'viewed') {
      return { text: t('crm.booking.quoted.sent'), ...blue };
    }
    /*
     * The catch-all is reached on `'none'` ONLY, and that is not an accident of
     * this switch — it is enforced upstream. `proposalsFor` in the drawer drops
     * drafts, and `pickProposal` then drops superseded, so `proposalStatus`
     * arrives here as one of none/sent/viewed/accepted/declined/expired/stopped.
     * There is no `draft` or `superseded` case to write; adding one would be dead
     * code that reads as though it fired.
     *
     * `stopped` was the exception that proved the point. It was added to the
     * status set without a branch here, fell through to this catch-all, and a job
     * the owner had just stopped showed "awaiting a quote" — the badge telling
     * them to do the one thing they had decided not to. A new proposal status
     * needs a branch above, or it lands here and claims no quote exists.
     *
     * `'none'` therefore covers two situations, and they want the same badge: no
     * quote was ever written, or every version has been replaced with nothing
     * standing. Either way the client holds no price and the owner owes them one.
     */
    // A missed meeting keeps the job alive, so the badge names the outcome
    // rather than the money — the step below it asks for the next move.
    if (bookingStatus === 'no_show') {
      return { text: t('crm.booking.quoted.meeting_missed'), ...amber };
    }

    /*
     * Before the meeting it is simply upcoming. Once its time has passed and
     * nobody has marked it, the honest badge is that nobody has marked it —
     * "needs a quote" asserts a consultation took place. Only after the owner
     * says it was held does the badge name the price they owe.
     */
    if (meetingState === 'ahead') {
      return { text: t('crm.booking.status.confirmed') || 'Upcoming', ...amber };
    }
    if (meetingState === 'unmarked') {
      return { text: t('crm.booking.quoted.not_marked'), ...amber };
    }
    return { text: t('crm.booking.quoted.awaiting_quote'), ...amber };
  };

  const getBookingStatusLabel = (
    status: string,
    hasSchedule = true,
    /**
     * Whether money is actually outstanding on this booking.
     *
     * `payment_status` is written 'paid' when the price is zero or there is
     * nothing to collect, so anything other than 'paid' is a genuine debt.
     * Absent means unknown, and unknown must not invent one.
     */
    moneyOwed = false,
    /**
     * The meeting's start, so a past one can say so.
     *
     * Optional, and absent means "do not claim anything about the clock" — a
     * caller with no start time in hand gets exactly the badge it got before.
     * That is why this is added rather than required: three call sites, and a
     * required argument would have made the two that do not care pass a lie.
     */
    startTime?: string | null
  ) => {
    const labels: Record<string, { text: string; color: string; bgColor: string }> = {
      confirmed: {
        text: hasSchedule
          ? t('crm.booking.status.confirmed') || 'Upcoming'
          : t('crm.booking.status.unscheduled_confirmed'),
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-500/10',
      },
      completed: { text: t('crm.booking.status.completed') || 'Completed', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/10' },
      cancelled: { text: t('crm.booking.status.cancelled') || 'Cancelled', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10' },
      no_show: { text: t('crm.booking.status.no_show') || 'No Show', color: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-500/10' },
      /*
       * `pending` means NOT CONFIRMED YET. It does not mean unpaid.
       *
       * ─────────────────────────────────────────────────────────────────────
       * This read "Awaiting payment" unconditionally, on the stated belief that
       * it "is the status every unpaid booking has". It is not. The public
       * booking route writes `pending` for two reasons — a payment is owed, OR
       * the service is quoted and nobody has said what the work costs yet — and
       * an owner can set it by hand.
       *
       * So a FREE intro service sat in the drawer reading "Awaiting payment"
       * with `payment_status: 'paid'`, no `payment_id`, no `payment_amount`, no
       * invoice, and no payment step anywhere in the client's journey —
       * `shouldTakePayment` is false at price 0. The badge invented a debt that
       * exists in no column on the row.
       *
       * The row already knows. `payment_status` is 'paid' whenever there is
       * nothing to collect, so anything else is a real debt.
       * ─────────────────────────────────────────────────────────────────────
       */
      pending: moneyOwed
        ? { text: t('crm.booking.status.pending') || 'Awaiting payment', color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/10' }
        : { text: t('crm.booking.status.unconfirmed'), color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10' }
    };
    const label =
      labels[status] || { text: status, color: 'text-[var(--v2-text-muted)]', bgColor: 'bg-[var(--v2-surface)]' };

    /*
     * The clock, added to the word the status already chose.
     *
     * NOT a replacement. "Awaiting payment" is the more useful half of the
     * sentence for an owner — it names what is missing — and swapping it for
     * "Past Due" would trade a reason for a date. So the reason stays and the
     * date joins it.
     *
     * The colour is left exactly as it was, deliberately. A past meeting is not
     * a worse state than an unpaid one; it is a second fact about the same
     * booking, and recolouring the badge would rank them.
     */
    if (isMeetingPastDue({ status, startTime: startTime ? new Date(startTime) : null })) {
      /*
       * IT REPLACES THE STATUS WORD. It used to wrap it.
       *
       * The badge read "קרובה (ממתין לעדכון)" — upcoming, awaiting an update —
       * and the two halves contradict each other. A meeting whose time has
       * passed is not upcoming; `status` says `confirmed` only because nobody
       * has marked it, which is the very thing the note is reporting. Keeping
       * both printed the stale half beside the true one.
       *
       * The colour is deliberately untouched, as before: a meeting nobody has
       * marked is not a worse state than an unpaid one, and recolouring would
       * rank them.
       */
      return { ...label, text: t('crm.journey.awaiting_outcome') || 'Awaiting an outcome' };
    }

    return label;
  };

  /**
   * Which bookings the search leaves standing.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT IS SEARCHED, AND WHY THOSE FIELDS
   *
   * What an owner types into this box is one of three things: the name of the
   * service, a word from the note they wrote on the booking, or a year. So:
   * the service, the note, and the date AS RENDERED — the date has to be
   * matched on its formatted text, or searching "2026" fails against an ISO
   * string that starts "2026" in UTC while the card shows a different year in
   * the business's zone, and "אוק" matches nothing at all.
   *
   * A PACKAGE's meetings are searched too, because the card the owner is
   * hunting for is the container: hiding a package whose fourth session matches
   * would hide the only row that could have shown it.
   *
   * Case-folded and trimmed. No transliteration: a Hebrew business searching
   * Hebrew words against Hebrew records needs no romanisation, and guessing at
   * one would match things the owner did not ask for.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const needle = bookingSearch.trim().toLowerCase();

  const matchesSearch = (session: SessionCardData): boolean => {
    if (!needle) return true;

    const haystack = (one: SessionCardData): string => {
      /*
       * The arguments are hoisted, and the start time is one of them.
       *
       * The label is clock-aware: a confirmed meeting whose time has passed
       * with nobody marking it reads "awaiting an outcome", not "upcoming", so
       * searching the word an owner can actually SEE means passing what the
       * badge passes. `pastDueNoteIsRendered` caught the omission on its first
       * run, which is exactly what that guard is for — and it reads the call
       * site as text, so the arguments are named here rather than nested
       * inside the call where it cannot follow them.
       */
      const hasSchedule = !isUnscheduledBooking(one.booking);
      const owesMoney =
        one.booking.payment_status !== undefined && one.booking.payment_status !== 'paid';
      const statusLabel = getBookingStatusLabel(
        one.booking.status,
        hasSchedule,
        owesMoney,
        one.booking.start_time
      ).text;

      return [
        one.booking.service?.service_name,
        one.booking.notes,
        one.booking.status,
        statusLabel,
        one.booking.start_time ? formatDate(one.booking.start_time, { withYear: true }) : '',
        one.booking.created_at ? formatShortDate(one.booking.created_at, { withYear: true }) : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    };

    return haystack(session).includes(needle)
      || (session.meetings ?? []).some(meeting => haystack(meeting).includes(needle));
  };

  const filteredSessions = sortedSessions.filter(matchesSearch);

  /*
   * Five a page.
   *
   * A contact who has been with a business for a year has thirty bookings, each
   * one an expandable journey card several hundred pixels tall. The drawer is a
   * column beside the contact, not a page of its own, and thirty of those is a
   * scroll with no landmarks in it.
   */
  const PAGE_SIZE = 5;
  const pageCount = Math.max(1, Math.ceil(filteredSessions.length / PAGE_SIZE));
  /*
   * Clamped rather than reset by an effect.
   *
   * Searching narrows the list under the reader, and page 4 of a set that now
   * has one page renders empty — the same "it's there but you cannot see it"
   * fault the orders page had. Deriving the page from what EXISTS means it can
   * never point past the end, with no effect to fire and no render in between
   * where the list is empty for a frame.
   */
  /*
   * Where the booking a link named actually sits, in the list as it stands.
   *
   * Computed against `filteredSessions` rather than the raw list, so it is the
   * index the slice below will use. -1 when no booking was named, or when a
   * search has hidden it — both mean "no opinion", and the list opens at the
   * top as it always did.
   */
  const focusIndex = focusBookingId
    ? filteredSessions.findIndex(session => session.booking.id === focusBookingId)
    : -1;
  const followFocus = focusIndex >= 0 ? Math.floor(focusIndex / PAGE_SIZE) : 0;
  const page = Math.min(bookingPage ?? followFocus, pageCount - 1);
  const visibleSessions = filteredSessions.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Intake editing helpers
  const startEditingIntake = (booking: SessionCardData['booking']) => {
    if (booking.intake_responses?.responses) {
      setEditingIntakeBookingId(booking.id);
      setEditingIntakeResponses({ ...booking.intake_responses.responses });
      setIntakeError(null);
      setIntakeSuccess(false);
    }
  };

  const cancelEditingIntake = () => {
    setEditingIntakeBookingId(null);
    setEditingIntakeResponses({});
    setIntakeError(null);
    setIntakeSuccess(false);
  };

  const saveIntakeResponses = async (bookingId: string) => {
    setIntakeSaving(true);
    setIntakeError(null);

    try {
      const response = await fetch(`/api/scheduling/bookings/${bookingId}/intake`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: editingIntakeResponses })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update intake responses');
      }

      setIntakeSuccess(true);
      onIntakeSaved?.(bookingId);

      // Reset after short delay to show success
      setTimeout(() => {
        setEditingIntakeBookingId(null);
        setEditingIntakeResponses({});
        setIntakeSuccess(false);
      }, 1500);
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : 'Failed to update responses');
    } finally {
      setIntakeSaving(false);
    }
  };

  const handleIntakeFieldChange = (key: string, value: unknown) => {
    setEditingIntakeResponses(prev => ({ ...prev, [key]: value }));
  };

  // Handle sending/resending intake form email
  /**
   * The banner's one button, routed to the control that already owns the write.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `NextStepAction` names an INTENT, not a button, and this is the only place
   * that knows which handler serves it. That indirection is what lets the
   * banner and the stage row offer the same move without one owning the
   * other's markup — and what keeps `bookingNextStep` free of any knowledge of
   * this drawer.
   *
   * Every branch delegates. This component writes nothing itself: the parent
   * owns the reload that has to follow, which is why each of these is a prop.
   * A missing handler does nothing rather than throwing, because this
   * component renders in surfaces that pass only some of them.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const runNextStepAction = (action: NextStepAction, session: SessionCardData) => {
    const bookingId = session.booking.id;

    switch (action) {
      case 'mark_held':
        onSetBookingStatus?.(bookingId, 'completed');
        return;
      /*
       * HANDED OVER. The same write as marking a meeting held — `completed` is
       * what both end at — under the word that matches what the owner did.
       *
       * Nobody attends a course, so "סמן שהתקיימה" would make them hesitate
       * over the one button that closes the job. The billing takes care of
       * itself either way: completing bills an unbilled manual stage where one
       * exists, which is right for a quoted job, and finds nothing on a course
       * that was paid at checkout.
       */
      case 'mark_delivered':
        onSetBookingStatus?.(bookingId, 'completed');
        return;
      case 'mark_no_show':
        onSetBookingStatus?.(bookingId, 'no_show');
        return;
      case 'reschedule':
        onEditSession?.(bookingId);
        return;
      case 'new_meeting':
        /*
         * The tab's own "book another" control, which is what the meeting step
         * offers in this state. `reschedule` would edit the failed
         * appointment's time and contradict the outcome recorded on it.
         */
        onNewSession?.();
        return;
      case 'cancel_booking':
        /*
         * The same control the footer carries, reached from the banner. Routed
         * rather than reimplemented so the two cannot diverge — one of them
         * cascading through the quote and the money while the other only sets
         * a status is exactly the kind of split this card has been bitten by.
         */
        onSetBookingStatus?.(bookingId, 'cancelled');
        return;
      case 'send_intake':
        void handleSendIntake(bookingId);
        return;
      /*
       * A fresh quote, with no version behind it. The builder takes the
       * supersede context because a revision is the same screen; `null` here
       * says this is the first price, not a replacement for a refused one.
       */
      case 'create_quote':
        onOpenProposalBuilder?.(bookingId, {
          supersedesId: null,
          declineReason: null,
          declineNote: null,
        });
        return;
      /*
       * Chasing a quote or an invoice both land on the payment manager, which
       * is where the document and its reminder live. Not `onSendInvoice`: that
       * sends a NEW invoice, and the move here is to chase one already out.
       */
      case 'remind_quote':
      case 'remind_payment':
      case 'send_invoice':
      case 'bill_next_stage':
        onManagePayment?.(session);
        return;
    }
  };

  const handleSendIntake = async (bookingId: string) => {
    if (!onSendIntake || sendingIntakeBookingId) return;

    setSendingIntakeBookingId(bookingId);
    try {
      await onSendIntake(bookingId);
    } finally {
      setSendingIntakeBookingId(null);
    }
  };

  // Handle sending/resending invoice
  const handleSendInvoice = async (invoiceId: string, bookingId: string) => {
    if (!onSendInvoice || sendingInvoiceBookingId) return;

    setSendingInvoiceBookingId(bookingId);
    try {
      await onSendInvoice(invoiceId, bookingId);
    } finally {
      setSendingInvoiceBookingId(null);
    }
  };

  // Build intake content for expanded view (supports view and edit modes)
  const buildIntakeContent = (booking: SessionCardData['booking']) => {
    if (!booking.intake_responses?.responses) return null;

    const isEditing = editingIntakeBookingId === booking.id;

    /*
     * The questions travel WITH the answers.
     *
     * This used to fetch the template the submission pointed at, cache it, and
     * translate its labels — which meant an answer could not be read until a
     * second request landed, and could not be read at all once the form was
     * edited. The submission now carries the questions as they stood when they
     * were asked, so the labels are already here and already correct for that
     * version.
     */
    const questions = booking.intake_responses.questions ?? [];
    const responses = Object.entries(booking.intake_responses.responses);
    const responseCount = responses.length;

    const getFieldLabel = (key: string): string => {
      const question = questions.find(item => item.id === key);
      // A key with no question is a submission from before the snapshot
      // existed. Its own key, tidied, is the best that can honestly be shown.
      return question?.label ?? key.replace(/_/g, ' ');
    };

    const translateValue = (key: string, value: unknown): string => {
      if (typeof value === 'boolean') {
        return value ? (t('common.yes') || 'Yes') : (t('common.no') || 'No');
      }
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'yes') return t('common.yes') || 'Yes';
        if (value.toLowerCase() === 'no') return t('common.no') || 'No';
        return value;
      }
      if (Array.isArray(value)) {
        /*
         * Uploaded files arrive as `{documentId, name}`, and their name is the
         * only part worth reading here — the file itself is in the Files tab,
         * which is where someone goes to open it.
         */
        return value
          .map(item =>
            item && typeof item === 'object' && 'name' in item
              ? String((item as { name: unknown }).name)
              : String(item)
          )
          .join(', ');
      }
      return String(value);
    };

    /*
     * One editable control per question, from the snapshot.
     *
     * The version this replaces switched on the four types the old shared
     * catalogue could produce and localised every label out of three columns.
     * A per-business form has one language and eight types, so the localisation
     * is gone and the missing four are here.
     */
    const renderEditableField = (question: IntakeQuestion) => {
      const value = editingIntakeResponses[question.id];
      const input =
        'w-full px-2 py-1.5 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:border-[#8B5CF6] outline-none';

      return (
        <div key={question.id} className="space-y-1">
          <label className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
            {question.label}
          </label>

          {question.type === 'long_text' ? (
            <textarea
              rows={3}
              value={(value as string) || ''}
              onChange={e => handleIntakeFieldChange(question.id, e.target.value)}
              className={`${input} resize-none`}
              dir={isRTL ? 'rtl' : 'ltr'}
            />
          ) : question.type === 'yes_no' ? (
            <div className="flex gap-2">
              {[true, false].map(option => (
                <button
                  key={String(option)}
                  type="button"
                  onClick={() => handleIntakeFieldChange(question.id, option)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    value === option
                      ? 'border-[#8B5CF6] text-[#8B5CF6] bg-[#8B5CF6]/10'
                      : 'border-[var(--v2-border)] text-[var(--v2-text-muted)]'
                  }`}
                >
                  {option ? t('common.yes') : t('common.no')}
                </button>
              ))}
            </div>
          ) : question.type === 'single_choice' ? (
            <div className="flex flex-wrap gap-1.5">
              {(question.options ?? []).map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleIntakeFieldChange(question.id, option.label)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    value === option.label
                      ? 'border-[#8B5CF6] text-[#8B5CF6] bg-[#8B5CF6]/10'
                      : 'border-[var(--v2-border)] text-[var(--v2-text-muted)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : question.type === 'multi_choice' ? (
            <div className="flex flex-wrap gap-1.5">
              {(question.options ?? []).map(option => {
                const selected = Array.isArray(value) && (value as string[]).includes(option.label);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      const current = Array.isArray(value) ? (value as string[]) : [];
                      handleIntakeFieldChange(
                        question.id,
                        selected
                          ? current.filter(item => item !== option.label)
                          : [...current, option.label]
                      );
                    }}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      selected
                        ? 'border-[#8B5CF6] text-[#8B5CF6] bg-[#8B5CF6]/10'
                        : 'border-[var(--v2-border)] text-[var(--v2-text-muted)]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : question.type === 'file' ? (
            /*
             * Read-only here. The owner is correcting what a client wrote, not
             * uploading on their behalf — and the files themselves live in the
             * Files tab, which is where they are opened and removed.
             */
            <p className="text-sm text-[var(--v2-text-muted)]">
              {translateValue(question.id, value) || '—'}
            </p>
          ) : (
            <Input
              type={question.type === 'number' ? 'number' : question.type === 'date' ? 'date' : 'text'}
              value={value === undefined || value === null ? '' : String(value)}
              onChange={e =>
                handleIntakeFieldChange(
                  question.id,
                  question.type === 'number' && e.target.value !== ''
                    ? Number(e.target.value)
                    : e.target.value
                )
              }
              className="h-8 text-sm bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6]"
              dir={question.type === 'number' || question.type === 'date' ? 'ltr' : isRTL ? 'rtl' : 'ltr'}
            />
          )}
        </div>
      );
    };

    // EDIT MODE
    if (isEditing) {
      return (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--v2-border)]">
            <span className="text-xs font-medium text-[#8B5CF6]">
              {t('crm.intake.edit_title') || 'Edit Intake Form'}
            </span>
          </div>

          {/* Success Message */}
          {intakeSuccess && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 text-green-600 text-sm">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              {t('crm.intake.update_success') || 'Intake updated successfully'}
            </div>
          )}

          {/* Error Message */}
          {intakeError && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {intakeError}
            </div>
          )}

          {/* Editable fields */}
          <div className="space-y-3">
            {questions.length > 0 ? (
              questions.map(renderEditableField)
            ) : (
              // Fallback: render text inputs for each response key
              responses.map(([key]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    {getFieldLabel(key)}
                  </label>
                  <Input
                    type="text"
                    value={(editingIntakeResponses[key] as string) || ''}
                    onChange={(e) => handleIntakeFieldChange(key, e.target.value)}
                    className="h-8 text-sm bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6]"
                    dir={isRTL ? 'rtl' : 'ltr'}
                  />
                </div>
              ))
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-[var(--v2-border)]">
            <Button
              type="button"
              size="sm"
              onClick={() => saveIntakeResponses(booking.id)}
              disabled={intakeSaving || intakeSuccess}
              className="h-7 text-xs text-white"
              style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
            >
              {intakeSaving ? (
                <>
                  <Loader2 className="h-3 w-3 me-1.5 animate-spin" />
                  {t('common.saving') || 'Saving...'}
                </>
              ) : (
                <>
                  <Save className="h-3 w-3 me-1.5" />
                  {t('button.save') || 'Save'}
                </>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelEditingIntake}
              disabled={intakeSaving}
              className="h-7 text-xs border-[var(--v2-border)]"
            >
              <X className="h-3 w-3 me-1.5" />
              {t('button.cancel') || 'Cancel'}
            </Button>
          </div>
        </div>
      );
    }

    // VIEW MODE
    return (
      <div className="space-y-3">
        {/* Header with count and edit button */}
        <div className="flex items-center justify-between pb-2 border-b border-[var(--v2-border)]">
          <span className="text-xs font-medium text-[var(--v2-text-muted)]">
            {responseCount} {responseCount === 1
              ? (t('crm.intake.response') || 'response')
              : (t('crm.intake.responses') || 'responses')}
          </span>
          <div className="flex items-center gap-2">
            {booking.intake_completed_at && (
              <span className="text-xs text-[var(--v2-text-muted)]">
                {formatShortDate(booking.intake_completed_at)}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startEditingIntake(booking);
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[#8B5CF6] hover:bg-[#8B5CF6]/10 rounded-full transition-colors"
            >
              <Edit2 className="h-3 w-3" />
              {t('button.edit') || 'Edit'}
            </button>
          </div>
        </div>

        {/* Response grid */}
        <div className="grid gap-3">
          {responses.map(([key, value]) => {
            const displayValue = translateValue(key, value);
            const isLongText = displayValue.length > 50;

            return (
              <div
                key={key}
                className={`${isLongText ? 'col-span-full' : ''}`}
              >
                <div className="flex flex-col gap-1 p-2 rounded-md bg-[var(--v2-surface)] border border-[var(--v2-border)]">
                  <span className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    {getFieldLabel(key)}
                  </span>
                  <span className={`text-sm text-[var(--v2-text-primary)] ${isLongText ? 'whitespace-pre-wrap' : ''}`}>
                    {displayValue}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render a journey section row
  // Count upcoming sessions for badge
  const upcomingCount = sessions.filter(s =>
    s.booking.status === 'confirmed' && s.booking.start_time && new Date(s.booking.start_time) > new Date()
  ).length;

  return (
    <CollapsibleSection
      title={t('crm.drawer.section_bookings') || 'Bookings'}
      icon={<Calendar className="h-4 w-4 text-[var(--v2-text-muted)]" />}
      defaultOpen={true}
      isOpen={isOpen}
      onToggle={onToggle}
      isRTL={isRTL}
      badge={
        sessions.length > 0 && (
          <span className="text-xs text-[var(--v2-text-muted)]">
            {upcomingCount > 0 && (
              <span className="text-amber-500">{upcomingCount} {t('crm.drawer.upcoming')}</span>
            )}
            {upcomingCount > 0 && sessions.length > upcomingCount && ' • '}
            {sessions.length > upcomingCount && (
              <span>{sessions.length - upcomingCount} {t('crm.drawer.past') || 'past'}</span>
            )}
          </span>
        )
      }
      actionButton={
        onNewSession && (
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNewSession();
            }}
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[#8B5CF6] hover:bg-[#8B5CF6]/10"
          >
            <Plus className="h-4 w-4 me-1" />
            {t('crm.drawer.new_session') || 'New'}
          </Button>
        )
      }
    >
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#8B5CF6]" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[var(--v2-border)] rounded-lg">
            <Calendar className="h-12 w-12 text-[var(--v2-text-muted)] mx-auto mb-3" />
            <p className="text-sm text-[var(--v2-text-muted)] mb-4">
              {t('crm.drawer.no_sessions') || 'No bookings yet'}
            </p>
            {onNewSession && (
              <Button
                type="button"
                onClick={onNewSession}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
              >
                <Plus className="h-4 w-4 me-1" />
                {t('crm.drawer.schedule_first') || 'Create first booking'}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/*
              THE SEARCH, above the list.

              Offered only once there is enough to hunt through. On a contact
              with two bookings a search box is a control that can only ever
              narrow two things to one, and it costs a row of a drawer that is
              already a narrow column.
            */}
            {sortedSessions.length > PAGE_SIZE && (
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--v2-text-muted)]" />
                <input
                  type="text"
                  value={bookingSearch}
                  onChange={(e) => {
                    setBookingSearch(e.target.value);
                    // Back to no opinion: the results under the reader have just
                    // changed, and page 3 of the previous set means nothing about
                    // this one. `null` rather than 0, so a search that still
                    // contains the booking a link named lands on it again
                    // instead of on the top of the results.
                    setBookingPage(null);
                  }}
                  placeholder={t('crm.drawer.search_bookings') || 'Search bookings'}
                  className="w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] ps-9 pe-8 py-2 text-[13px] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] focus:border-transparent"
                />
                {bookingSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setBookingSearch('');
                      setBookingPage(null);
                    }}
                    aria-label={t('common.clear') || 'Clear'}
                    className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--v2-text-muted)] hover:bg-[var(--v2-surface)] hover:text-[var(--v2-text-primary)]"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/*
              A search that found nothing says so, and says what it searched
              for. An empty list under a filled-in box reads as a broken drawer.
            */}
            {filteredSessions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--v2-border)] py-10 text-center">
                <Calendar className="mx-auto mb-3 h-10 w-10 text-[var(--v2-text-muted)]" />
                <p className="text-sm text-[var(--v2-text-muted)]">
                  {(t('crm.drawer.no_booking_matches') || 'No bookings match “{term}”').replace(
                    '{term}',
                    bookingSearch.trim()
                  )}
                </p>
              </div>
            ) : (
            <div className="space-y-4">
            {visibleSessions.map((session) => {
              const { booking, payment, journeyData } = session;
              const isExpanded = expandedBookings.has(booking.id);
              // Declared first: the badge's wording depends on it.
              const isUnscheduled = isUnscheduledBooking(booking);

              /*
               * WHAT THIS BOOKING NEEDS FROM ITS OWNER, asked once.
               *
               * The same value decided whether this card opened itself, above.
               * Recomputing rather than threading it down is deliberate: it is
               * a pure function of the session, so the two cannot disagree, and
               * a second source of truth is the exact disease this module was
               * written to end.
               */
              /*
               * ───────────────────────────────────────────────────────────────
               * A CARD THAT CANNOT BE READ STILL HAS TO RENDER.
               *
               * This is called during render, so anything it throws unmounts
               * the whole drawer — the owner is thrown out of the contact they
               * were working in, mid-task, with no way back to what they were
               * doing. That is a far worse failure than a card with no banner.
               *
               * It reads five layers' worth of shapes that arrive from an API:
               * a proposal's status, a plan's stages, a package's children. Any
               * one of them being a shape nobody anticipated must cost the
               * banner, not the screen.
               *
               * `nobody` is the safe fallback: no banner, no auto-expand, no
               * claim about what is needed. The card renders, the journey
               * renders, and the stage buttons still work.
               * ───────────────────────────────────────────────────────────────
               */
              let nextStep: NextStep;
              try {
                nextStep = sessionNextStep(session);
              } catch (err) {
                logger.error(
                  { err, bookingId: booking.id },
                  'Could not work out the next step for a booking'
                );
                nextStep = {
                  stage: 'done',
                  whoseMove: 'nobody',
                  labelKey: 'next.unknown',
                  actions: [],
                };
              }

              /*
               * A quoted booking is a CONSULTATION inside a longer job.
               *
               * Everything below that reads `booking.status` as "is this over"
               * has to ask a different question here: the appointment reaching
               * its end is step two of six, not the finish.
               */
              /*
               * A quoted booking is a CONSULTATION inside a longer job — and a
               * package's MEETING is neither: the quote that created it was
               * accepted, so the quoting labels ("the quote will be sent after
               * the meeting") describe something that already happened.
               */
              const isQuoted =
                booking.service?.sale_mode === 'proposal' && !booking.parent_booking_id;
              const proposalStep = isQuoted
                ? session.journeySteps?.find(s => s.key === 'proposal')
                : undefined;
              const quoteState = (proposalStep?.metadata?.proposalStatus as string) ?? 'none';
              /*
               * ───────────────────────────────────────────────────────────────
               * `refunded` COUNTS AS PAID HERE, and leaving it out was a bug
               * introduced by the node colour above.
               *
               * This asks "did the money ever arrive", and the answer for a
               * refunded job is yes — it arrived and then went back. Once the
               * payment step stopped reporting `completed` for a refund, this
               * read false, and `getQuotedStatusLabel` fell to "won, awaiting
               * payment": a job whose money had been returned, inviting the
               * owner to chase the client for it.
               * ───────────────────────────────────────────────────────────────
               */
              const quotePaid = session.journeySteps?.some(
                s => s.key === 'payment' && (s.status === 'completed' || s.status === 'refunded')
              );

              /**
               * Was this job called off? Asked of the job, not the appointment.
               *
               * ───────────────────────────────────────────────────────────────
               * `booking.status === 'cancelled'` used to be the only answer
               * available, and it is no longer reliable: a consultation marked
               * held keeps `completed` when the job is cancelled, because the
               * table has no `completed_at` and overwriting the status erased
               * that the meeting ever happened.
               *
               * Four signals, any one of which means the work is off:
               *
               *   · `status === 'cancelled'` — still the answer for every
               *     booking cancelled before it was held, and the ONLY answer
               *     for rows cancelled by older code paths, which carry no
               *     `cancel_reason` at all. Dropping it in favour of the
               *     columns below would make those jobs look live again: the
               *     same bug in the opposite direction.
               *   · `cancel_reason` / `cancelled_by` — written by every
               *     cancellation path, including the one that now leaves the
               *     status alone. These are what make a held-then-cancelled
               *     job answerable at all.
               *   · a `stopped` quote — the job can also be stopped from
               *     Manage Payment without the booking being cancelled.
               *
               * Complete on purpose, so a call site can ask this one question
               * instead of assembling the union itself and getting a different
               * subset of it each time.
               *
               * Deliberately NOT `cancellation_reason`: that column holds free
               * prose including the `CLIENT_CANCELLED_PREFIX`, and a
               * reschedule note left in it would read as a cancellation.
               * ───────────────────────────────────────────────────────────────
               */
              const jobCalledOff =
                booking.status === 'cancelled' ||
                Boolean(booking.cancel_reason) ||
                Boolean(booking.cancelled_by) ||
                quoteState === 'stopped';

              /**
               * The BOOKING was called off, which is not the same as its quote
               * being stopped.
               *
               * ───────────────────────────────────────────────────────────────
               * `jobCalledOff` above folds a stopped quote in with the real
               * cancellation columns, and for almost everything on this card
               * that is right: a stopped quote and a cancelled job both mean
               * no more price is coming, and the rail and the header should
               * read the same for either.
               *
               * One place it is wrong, and it is the place that ends things.
               * Stopping the quote deliberately touches NO booking — that
               * separation is the whole point of the stop — so the booking
               * stays `confirmed`, holds its slot and sits in the list as live
               * work. The footer strip asked `jobCalledOff`, decided the job
               * was over, and took its Cancel button away: the owner stopped
               * the quote and lost the one control that closes the booking.
               *
               * The banner was already contradicting it, out loud, two
               * sentences up the same card. `bookingNextStep`'s stopped-quote
               * branch returns `actions: ['cancel_booking']` with "the booking
               * is still open", because it reads the proposal and the booking
               * as two facts. Two predicates for one question is what produced
               * a card telling the owner to cancel beside no way to do it.
               *
               * So this signal drops the quote and keeps the three columns
               * every cancel path writes. `jobCalledOff` is untouched, and so
               * is what `jobIsOver` is passed — a cancelled job must still
               * retire the strip, and cancelling one WRITES the quote to
               * `stopped` (`cancelQuoteStages`), so "the quote is stopped"
               * alone can never be allowed to bring Cancel back.
               * ───────────────────────────────────────────────────────────────
               */
              const bookingCalledOff =
                booking.status === 'cancelled' ||
                Boolean(booking.cancel_reason) ||
                Boolean(booking.cancelled_by);

              /**
               * The money came back, and that outranks "completed".
               *
               * ───────────────────────────────────────────────────────────────
               * The header read "Completed" in green on a job whose every
               * shekel had been returned — true of the WORK, and the first
               * thing an owner sees about the sale. The booking's own status
               * cannot say this: the meeting did happen, so `completed` is
               * correct and simply answers a different question.
               *
               * Read from either side, because for a quoted job the money
               * lives on the stage invoices rather than the booking row, and
               * `payment_status` there can lag what the invoices say.
               *
               * NOT on a cancelled booking: "Lost" already names that outcome,
               * and it is the more useful of the two. `jobCalledOff` rather
               * than the status alone, for the same reason as everywhere else
               * on this card — a held consultation keeps `completed` when its
               * job is cancelled, and reading only the status would put
               * "Refunded" on a job this test was written to label "Lost".
               * ───────────────────────────────────────────────────────────────
               */
              const moneyReturned =
                !jobCalledOff &&
                booking.status !== 'cancelled' &&
                (booking.payment_status === 'refunded' ||
                  Boolean(
                    session.journeySteps?.some(
                      s => s.key === 'payment' && s.status === 'refunded'
                    )
                  ));

              /*
               * ─────────────────────────────────────────────────────────────
               * THE BADGE SAYS WHAT THIS BOOKING IS WAITING FOR.
               *
               * It used to name a STATE, and the state it named was often not
               * one: before the meeting a quoted booking read `מאושרת`
               * (approved) — from `crm.booking.status.confirmed`, while this
               * file's own fallback and comment both said "Upcoming". Nothing
               * had been approved. A client had asked for a price.
               *
               * `nextStep` already answers the question an owner is actually
               * asking, and the banner below reads the same value, so the two
               * cannot describe different situations. Amber when the move is
               * theirs, quiet otherwise — that distinction is the whole point:
               * one is a task, the other is permission to stop checking.
               *
               * Money returned still wins: "Refunded" is the more useful fact
               * about a job than where its journey stopped.
               * ─────────────────────────────────────────────────────────────
               */
              /*
               * THE BADGE SAYS THE STATE; THE BANNER ASKS FOR THE ACTION.
               *
               * Both read the same `labelKey` and the sentence appeared twice,
               * stacked — "הלקוח לא הגיע. הצע מועד חדש" as the badge and again
               * as the prompt directly beneath it.
               *
               * A short form per owner-state fixes it, and reads better anyway:
               * a badge is a label, not an instruction. Falls back to the full
               * sentence where no short form exists — every state the banner
               * never shows (waiting on the client, done, called off) has only
               * the one wording, and it is already a statement of fact.
               */
              const nextStepLabel =
                /*
                 * `firstTranslated`, not `||`. `t()` returns the KEY on a miss
                 * and a key is truthy, so the fallback this line was written to
                 * perform never ran: nine of the sixteen states have no short
                 * form and printed `crm.next.badge.<state>` to the owner.
                 * Reported as a missing translation for `meeting_ahead`.
                 */
                firstTranslated(
                  t,
                  `crm.next.badge.${nextStep.labelKey.replace('next.', '')}`,
                  `crm.${nextStep.labelKey}`
                );
              const statusInfo = moneyReturned
                ? {
                    text: t('crm.payment.status.refunded') || 'Refunded',
                    color: REFUND_CLASS.full.text,
                    bgColor: REFUND_CLASS.full.bg,
                  }
                : nextStepLabel
                  ? {
                      text: nextStepLabel,
                      color:
                        nextStep.whoseMove === 'owner'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-[var(--v2-text-secondary)]',
                      bgColor:
                        nextStep.whoseMove === 'owner'
                          ? 'bg-amber-500/10'
                          : 'bg-[var(--v2-text-muted)]/10',
                    }
                : isQuoted
                ? getQuotedStatusLabel(
                    booking.status,
                    quoteState,
                    Boolean(quotePaid),
                    proposalStep?.metadata?.waitingOn === 'meeting'
                      ? 'ahead'
                      : proposalStep?.metadata?.waitingOn === 'unmarked'
                        ? 'unmarked'
                        : 'settled',
                    jobCalledOff
                  )
                : getBookingStatusLabel(booking.status, !isUnscheduled, booking.payment_status !== undefined && booking.payment_status !== 'paid', booking.start_time);
              const bookingDate = booking.start_time ? new Date(booking.start_time) : null;
              /*
               * Both of these only ever tinted the card, and the card now takes
               * its tint from `nextStep.whoseMove` — see the note at the
               * container. Removed rather than left dangling: a derived value
               * nothing reads is a rule the next person will assume is live.
               */

              const hasIntake = booking.intake_responses && Object.keys(booking.intake_responses.responses || {}).length > 0;

              return (
                <div
                  key={booking.id}
                  /*
                   * ─────────────────────────────────────────────────────────
                   * THE CARD'S TINT FOLLOWS WHAT IT NEEDS, NOT WHEN IT IS.
                   *
                   * It was keyed on `isUpcoming` — any booking with a future
                   * date — and washed the WHOLE card in 5% amber. Three things
                   * went wrong with that:
                   *
                   *   · 5% of anything is not a colour. On the light theme it
                   *     reads as a smudge, which is what made every card look,
                   *     in the owner's word, blurry.
                   *   · "Has a future date" is true of almost every live
                   *     booking, so the highlight marked nothing out.
                   *   · It is a fact about the CLOCK. The question a colour
                   *     should answer here is whether this needs you.
                   *
                   * So: a readable tint and a matching border when the move is
                   * the owner's, and the plain surface otherwise. A card that
                   * is merely waiting looks like every other card, which is
                   * the point — only the ones asking for something stand out.
                   * ─────────────────────────────────────────────────────────
                   */
                  className={`border rounded-lg overflow-hidden transition-all ${
                    nextStep.whoseMove === 'owner'
                      ? 'border-amber-500/60 bg-amber-500/[0.08] dark:bg-amber-500/[0.06]'
                      : 'border-[var(--v2-border)] bg-[var(--v2-surface)]'
                  }`}
                >
                  {/* Booking header - clickable */}
                  <button
                    type="button"
                    onClick={() => toggleBooking(booking.id)}
                    className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-surface)]/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Type indicator icon */}
                      {isUnscheduled ? (
                        <ShoppingBag className={`h-5 w-5 flex-shrink-0 ${
                          /* A product sale has no appointment, so `status` is still
                             the right question for this one. */
                          booking.status === 'completed' ? 'text-green-500' :
                          booking.status === 'cancelled' ? 'text-red-500' :
                          'text-purple-500'
                        }`} />
                      ) : (
                        <Calendar className={`h-5 w-5 flex-shrink-0 ${
                          /* Green once the appointment HAPPENED — `meeting_status`.
                             Asking `status` left every held meeting's icon amber,
                             which reads as "still coming up". */
                          booking.meeting_status === 'held' || booking.status === 'completed' ? 'text-green-500' :
                          booking.status === 'cancelled' ? 'text-red-500' :
                          booking.status === 'confirmed' ? 'text-amber-500' :
                          'text-slate-500'
                        }`} />
                      )}

                      <div className="text-start">
                        <p className="font-medium text-[var(--v2-text-primary)]">
                          {booking.service?.service_name || t('crm.session.unknown_service')}
                        </p>
                        <p className="text-xs text-[var(--v2-text-muted)]">
                          {isUnscheduled ? (
                            <bdi>
                              {t('crm.booking.purchased_on') || 'Purchased'}{' '}
                              {/*
                                * The clock, not just the day. An unscheduled
                                * service has no `start_time` to fall back on, so this line is
                                * the only record of WHEN it was bought — and two
                                * purchases on one day were indistinguishable.
                                */}
                              {formatDateTime(booking.created_at || new Date().toISOString(), { withYear: true })}
                            </bdi>
                          ) : booking.start_time ? (
                            /* The card's own headline date, and the only one a
                               collapsed booking shows: it carries the year. */
                            <bdi>{formatDate(booking.start_time, { withYear: true })}</bdi>
                          ) : null}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusInfo.color} ${statusInfo.bgColor}`}>
                        {statusInfo.text}
                      </span>

                      {/* WHY it was cancelled, on every cancelled booking type.
                          The badge said "Cancelled" and stopped there, so the
                          reason the client or the owner had just been made to
                          choose was stored and never shown back — which is how a
                          required field starts feeling like a toll.
                          Code first, old free text as the fallback: rows
                          cancelled before the code existed still say something,
                          and dropping it would erase what they say. The note is
                          left for the expanded view; this is a badge row. */}
                      {/* `jobCalledOff`, not the status: a held consultation keeps
                          `completed` when its job is cancelled, and reading the
                          status here would hide the owner's own reason for
                          calling it off on exactly those bookings. */}
                      {jobCalledOff &&
                        (booking.cancel_reason || booking.cancellation_reason) && (
                          <span
                            className="text-[11px] text-[var(--v2-text-muted)] truncate max-w-[170px]"
                            title={booking.cancel_note || booking.cancellation_reason || ''}
                          >
                            {(() => {
                              // The code, once there is one.
                              if (booking.cancel_reason) return t(cancelReasonKey(booking.cancel_reason));

                              /*
                               * Older rows hold prose, and a client cancellation
                               * holds it behind a stored English prefix. Showing
                               * it raw put "Cancelled by client" in front of a
                               * Hebrew-speaking owner.
                               */
                              const { byClient, note } = splitClientCancellationReason(
                                booking.cancellation_reason
                              );
                              if (!byClient) return note;
                              const label = t('cancel.by_client') || 'Cancelled by the client';
                              return note ? `${label}: ${note}` : label;
                            })()}
                          </span>
                        )}

                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-[var(--v2-text-muted)]" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-[var(--v2-text-muted)]" />
                      )}
                    </div>
                  </button>

                  {/* ── How did it go? ──────────────────────────────────────
                      Outside the header BUTTON, not inside it: the whole header
                      is the expand control, and nesting buttons inside a button
                      is invalid markup that browsers resolve unpredictably.

                      Offered only while the outcome is still open — a booking
                      already completed, cancelled or marked a no-show has its
                      answer, and changing it belongs in the edit form where the
                      consequences are visible.

                      SHOWN WITH OR WITHOUT A SCHEDULE. This whole strip used to
                      be withheld when no time was booked, on the grounds that
                      there is no attendance to record — true of "did not
                      attend", and true of nothing else. An order can be
                      fulfilled and an order can be cancelled; withholding both
                      left a course sale with no way to end it at all, and the
                      only route to cancelling one was to refund it.

                      So only "did not attend" is conditional. The other two mean
                      the same thing either way. */}
                  {/* ── THE NEXT STEP. One sentence, and the thing to press. ──
                      ─────────────────────────────────────────────────────────
                      The question an owner opens this drawer with is "what do I
                      do now", and nothing answered it. The journey knew what
                      each stage was waiting for, but it sat behind a click; the
                      header showed a STATE, not an instruction; and the fact
                      that marking the meeting held is what opens the quote step
                      was something you had to already know.

                      So one line says it, in the owner's words, with the action
                      beside it. The stage it belongs to carries the same action
                      further down — the banner is unmissable, the stage is
                      where the thing lives, and both read the same `nextStep`
                      so they cannot describe different moves.

                      ONLY WHEN IT IS THE OWNER'S MOVE. A quote with the client
                      is not a task: an amber banner over "they have not replied
                      yet" is how a task list teaches an owner to ignore it.
                      ───────────────────────────────────────────────────────── */}
                  {nextStep.whoseMove === 'owner' && nextStep.actions.length > 0 && (
                    /* Both themes, deliberately. The first version used only
                       dark-mode tones — `amber-200` text on a 7%-amber wash —
                       which on the light theme's white ground is a pale band
                       with pale writing on it. Each theme gets a tint it can
                       actually be read against.

                       A PLAIN block comment, not `{/* … *\/}`: this sits in
                       EXPRESSION position, straight after `&& (`, where braces
                       are an object literal rather than a JSX child. Written
                       the JSX way it took the whole build down. */
                    <div style={{ margin: '0 14px 14px' }} className="rounded-[10px] border border-amber-500/40 bg-amber-500/[0.12] dark:border-amber-500/30 dark:bg-amber-500/[0.07] px-3.5 py-2.5 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-500" />
                        <span className="text-[13px] font-semibold text-amber-800 dark:text-amber-200/90">
                          {firstTranslated(t, `crm.${nextStep.labelKey}`, 'crm.next.fallback') ||
                            'Needs you'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {nextStep.actions.map(action => (
                          <button
                            key={action}
                            type="button"
                            onClick={() => runNextStepAction(action, session)}
                            /* ── COMPACT, AND THE SAME COLOURS AS THE STAGE ──
                               These were full-size buttons — `px-4 py-2` at
                               13px — so three of them filled the banner and it
                               read as a dialog rather than a prompt.

                               Sized to match the stage's own pills, and tinted
                               the same way: green for the outcome that happened,
                               amber for the one that did not, blue for moving
                               the date. The banner and the stage are the same
                               control in two places, so they should not look
                               like two different offers. */
                            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                              /* ── MONEY BORROWS THE GREEN, IT DOES NOT SHOUT ──
                                 `send_invoice`, `bill_next_stage` and
                                 `remind_payment` fell through to the neutral
                                 outline — grey writing on an amber wash, which
                                 is the least visible thing in a banner whose
                                 whole job is to be seen.

                                 Given the same green as `create_quote` rather
                                 than a solid fill: every control here is an
                                 outline, and one filled button among them reads
                                 as a different KIND of thing rather than a more
                                 important one. Green is already the card's word
                                 for money, and billing a stage is the same act
                                 as quoting for it. */
                              action === 'mark_held' ||
                              /* The outcome that happened, like `mark_held`:
                                 the service was given. Same green. */
                              action === 'mark_delivered' ||
                              action === 'create_quote' ||
                              action === 'send_invoice' ||
                              action === 'bill_next_stage' ||
                              action === 'remind_payment'
                                ? 'border-green-600/40 text-green-700 hover:bg-green-500/10 dark:text-green-400'
                                : action === 'mark_no_show'
                                  ? 'border-amber-600/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400'
                                  : action === 'reschedule' || action === 'new_meeting'
                                    ? 'border-blue-600/40 text-blue-700 hover:bg-blue-500/10 dark:text-blue-400'
                                    : action === 'cancel_booking'
                                      /* The only action here that ENDS the
                                         work, and the card reserves red for
                                         exactly that — the footer's own cancel
                                         carries it. A neutral pill beside two
                                         ways of continuing would read as a
                                         third way of continuing. */
                                      ? 'border-red-600/40 text-red-600 hover:bg-red-500/10 dark:text-red-400'
                                      : 'border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                            }`}
                          >
                            {t(`crm.next.action.${action}`) || action}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── A NOTICE, BESIDE THE STATE AND NOT INSIDE IT ──────────
                      ─────────────────────────────────────────────────────────
                      This started life folded into `labelKey`, which is also
                      what the header badge reads through
                      `crm.next.badge.<state>`. With no short form to match, the
                      badge fell back to the full sentence, so "money was
                      already collected, refund it if it is owed" was printed
                      as the booking's STATUS and then again in the banner
                      underneath it. Reported with a screenshot of both: "what
                      you added is not a status".

                      So it renders on its own, and it is told apart from the
                      banner above by every means available:

                      · QUIETER. The banner is amber because it is a task. This
                        is the card's own surface and border, because it is
                        information. Two amber boxes stacked read as two jobs
                        to do.
                      · NO ACTION. The banner's whole point is the button in
                        it. Nothing here is pressable except the close.
                      · CLOSEABLE, which the banner is not. A task goes away by
                        being done; this may need nothing at all, so the owner
                        gets to say so.

                      Independent of the banner on purpose, rather than nested
                      inside it: the banner is withheld whenever the move is the
                      client's, and a fact about money already taken does not
                      stop being true while you wait for somebody to reply.
                      ───────────────────────────────────────────────────────── */}
                  {nextStep.notice &&
                    !dismissedNotices.has(`${booking.id}:${nextStep.notice}`) && (
                      <div
                        style={{ margin: '0 14px 14px' }}
                        /* `--v2-surface-hover`, not `--v2-surface-2`: the
                           latter is referenced in a handful of files and
                           DEFINED in none, so it resolves to nothing and the
                           box would have come out transparent. The two tokens
                           that exist are the card's own surface and this one,
                           which is the lighter step above it. */
                        className="rounded-[10px] border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3.5 py-2.5 flex items-start gap-2"
                      >
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-[2px] text-[var(--v2-text-secondary)]" />
                        <span className="flex-1 text-[12.5px] leading-[1.5] text-[var(--v2-text-secondary)]">
                          {translated(t, `crm.${nextStep.notice}`) || ''}
                        </span>
                        {/* `title` and `aria-label` both, so it is nameable to a
                            screen reader and explains itself on hover. The hit
                            area is padded well past the 14px glyph. */}
                        <button
                          type="button"
                          onClick={() => dismissNotice(`${booking.id}:${nextStep.notice}`)}
                          title={t('crm.next.notice.dismiss') || 'Dismiss'}
                          aria-label={t('crm.next.notice.dismiss') || 'Dismiss'}
                          className="-m-1 p-1 flex-shrink-0 rounded text-[var(--v2-text-secondary)] opacity-60 transition-opacity hover:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                  {/*
                    THE STRIP LIVES AS LONG AS THE JOB DOES.

                    It tested the booking's own status, so pressing "the meeting
                    was held" on a quoted job wrote `completed` and took Cancel
                    away with it — leaving an owner who had recorded a
                    consultation with no way to call off work that had not been
                    quoted, agreed or paid, while the client's proposal link
                    stayed live.

                    `jobIsOver` is the same question the card's own state asks.
                    For a direct service it is unchanged: the appointment is the
                    job. Within the strip, the two attendance buttons hide once
                    attendance is recorded, because that part IS settled.
                  */}

                  {/* Expanded content - Full Journey from journeySteps */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[var(--v2-border)]">
                      <div className="pt-4">

                        {/* ── The journey, as a day book ──────────────────────
                            Steps grouped under the day they happened on, with
                            the wait between distant days drawn rather than
                            collapsed into one more evenly spaced row. Every
                            action the old strip offered is still here — the
                            node is still the send/resend control, intake still
                            expands, payment still opens the manager — with
                            reschedule and resend added as visible buttons
                            rather than affordances hidden on an icon. */}
                        {session.journeySteps && session.journeySteps.length > 0 ? (
                          session.journeySteps.map((step, index) => {
                                  /*
                                   * ─────────────────────────────────────────────────────
                                   * THE GLYPH FOLLOWS THE STATUS, NOT ONLY THE STEP.
                                   *
                                   * The icon was keyed on the step alone, so a refunded
                                   * payment wore the same card glyph as one collected and
                                   * kept — and once the node went red it was telling the
                                   * owner "a card problem" in the only language a node has.
                                   *
                                   * A returned arrow says what happened by itself, which is
                                   * what separates this node from the genuinely failed ones
                                   * beside it: red here means money went BACK, red there
                                   * means money is late or a card was declined, and the
                                   * glyph is what tells them apart at a glance.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  /*
                                   * ─────────────────────────────────────────────────────
                                   * THREE STATES, READ WITHOUT READING.
                                   *
                                   * The node used to carry the STEP's icon — a calendar
                                   * for the meeting, a person for the client, an envelope
                                   * for the confirmation — tinted by status. So a glance
                                   * down the rail told you what each stage WAS, and
                                   * nothing about where the journey had got to: the one
                                   * question the rail exists to answer.
                                   *
                                   * Now the glyph is the status, and only the status:
                                   *
                                   *   done        a tick
                                   *   active      no glyph — a solid amber disc, which
                                   *               reads as "here" the way a filled dot
                                   *               does on any progress rail
                                   *   not started no glyph — a dashed, empty ring
                                   *   failed      a cross
                                   *   refunded    the money went back, which is neither
                                   *               a success nor a failure and keeps its
                                   *               own mark
                                   *
                                   * The step still names itself in its own title beside
                                   * the node, so nothing is lost by dropping its icon.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  const StepIcon =
                                    step.status === 'refunded'
                                      ? RotateCcw
                                      : step.status === 'failed'
                                        ? X
                                        : step.status === 'completed'
                                          ? Check
                                          : null;

                                  /*
                                   * WHEN, as one string, for the line UNDER the title.
                                   *
                                   * It used to sit on the title's own row. A stage name and
                                   * a date are not the same kind of fact — the name says
                                   * what this is, the date is detail about it — and pairing
                                   * them put a number in the corner of every row, which the
                                   * eye then tracks as a second column.
                                   *
                                   * Composed here rather than in the markup so both halves
                                   * are formatted once, in the owner's locale and the
                                   * business's timezone. The date came back with the day
                                   * groupings' removal: without it every step read "15:54"
                                   * and a journey spanning weeks looked like one afternoon.
                                   */
                                  const stepWhen = step.timestamp
                                    ? `${new Intl.DateTimeFormat(language, timeZoneOptions({ day: 'numeric', month: 'short' })).format(new Date(step.timestamp))} · ${formatTime(step.timestamp)}`
                                    : null;

                                  /*
                                   * Whether to PRINT it is decided at the render site, not
                                   * here: the test needs `isScheduleStep`, which is
                                   * declared further down this same block. Read up here it
                                   * is a temporal-dead-zone error — "Cannot access
                                   * 'isScheduleStep' before initialization" — which takes
                                   * the whole drawer down at render rather than failing to
                                   * compile.
                                   */

                                  /*
                                    THE LAST STEP NAMES THE OUTCOME, NOT THE STAGE.
                                    ─────────────────────────────────────────────
                                    `session` and `fulfillment` are the journey's
                                    terminal node, and their static names describe
                                    the stage rather than what happened at it —
                                    so a finished sale and a cancelled one both
                                    read as "Service delivery", with only a dot's
                                    colour between them.

                                    The booking already carries the answer. Once
                                    it is completed or cancelled the step says so
                                    in the booking's own words; while it is still
                                    open the stage name is the honest label,
                                    because nothing has happened yet.
                                  */
                                  const isFinalStep = step.key === 'session' || step.key === 'fulfillment';
                                  /*
                                    A MEETING THAT HAPPENED IS NOT AN ORDER THAT SHIPPED.
                                    ─────────────────────────────────────────────────────
                                    `isFinalStep` covers two different things — a session
                                    and a product's fulfilment — and both were titled
                                    "הזמנה הושלמה", order completed. On a meeting that
                                    contradicted the very line underneath it, which reads
                                    "הפגישה התקיימה".

                                    The phrase is not new: it is the one the "mark held"
                                    button uses, and the one `scheduleDetail` reports after
                                    pressing it. Three places now say the same words about
                                    the same event, which is the whole point — being told
                                    "order completed" after pressing "the meeting took
                                    place" reads as a different outcome than the one just
                                    recorded.

                                    `fulfillment` keeps the order wording, because for a
                                    product that is exactly right.
                                  */
                                  const isMeetingStep = step.key === 'session';
                                  /*
                                   * Read off `meeting_status`, with the old statuses kept
                                   * for rows that predate the column.
                                   *
                                   * `complete()` writes `meeting_status: 'held'` and leaves
                                   * `status` at `confirmed`, so both branches below fell
                                   * through to `null` — the closing node lost its wording
                                   * entirely the moment an owner marked the meeting held,
                                   * which is the one press that should have produced it.
                                   */
                                  const outcomeHeld =
                                    booking.meeting_status === 'held' ||
                                    (booking.meeting_status == null && booking.status === 'completed');
                                  const outcomeOff =
                                    booking.meeting_status === 'no_show' ||
                                    booking.meeting_status === 'cancelled' ||
                                    booking.status === 'cancelled' ||
                                    (booking.meeting_status == null && booking.status === 'no_show');
                                  /*
                                   * A MISSED meeting is not a cancelled order.
                                   *
                                   * Both outcomes used to print "הזמנה בוטלה", so a client
                                   * who simply did not turn up produced a journey node
                                   * announcing the booking had been cancelled — on a job
                                   * that was still running and was in fact rescheduled a
                                   * minute later. Each outcome now says itself, in the
                                   * words its own button used.
                                   */
                                  const outcomeMissed =
                                    booking.meeting_status === 'no_show' ||
                                    (booking.meeting_status == null && booking.status === 'no_show');
                                  const outcomeTitle =
                                    !isFinalStep
                                      ? null
                                      : outcomeHeld
                                        ? isMeetingStep
                                          ? t('crm.booking.quoted.meeting_held')
                                          : t('crm.booking.step.booking_completed')
                                        : outcomeMissed
                                          ? t('crm.booking.status.no_show')
                                          : outcomeOff
                                            ? t('crm.booking.step.booking_cancelled')
                                            : null;

                                  /*
                                   * WHY it was called off, under the title that says it was.
                                   *
                                   * ─────────────────────────────────────────────────────────
                                   * The closing node read "הזמנה בוטלה" over an empty body.
                                   * The reason is on the row and is already shown once, in
                                   * the badge row at the top of the card — but that is the
                                   * card's header, not the journey, and the journey is where
                                   * someone reads what happened in order. The step that
                                   * announces the cancellation was the one place not saying
                                   * why.
                                   *
                                   * Computed HERE and not in `buildJourneySteps` because the
                                   * code has to be translated: `cancel_reason` is a key from
                                   * `cancellationReasons`, and the builder is a plain
                                   * function with no `t` — it carries its own per-language
                                   * word maps precisely because of that. Reason codes are
                                   * already translated in this file, two places above.
                                   *
                                   * Same fallback ladder as the badge row, so the two cannot
                                   * disagree: the code first, then the older free text, and
                                   * finally a plain "no reason given" rather than nothing —
                                   * an empty line reads as data still loading.
                                   * ─────────────────────────────────────────────────────────
                                   */
                                  const cancelledOutcomeFact =
                                    isFinalStep &&
                                    (booking.status === 'cancelled' || booking.status === 'no_show')
                                      ? booking.cancel_reason
                                        ? t(cancelReasonKey(booking.cancel_reason))
                                        : /* Older rows hold prose, and a client cancellation
                                             holds it behind a stored English prefix — shown
                                             raw it put "Cancelled by client" in front of a
                                             Hebrew-speaking owner. */
                                          splitClientCancellationReason(booking.cancellation_reason)
                                            .note ||
                                          t('crm.activity.desc.no_reason') ||
                                          'No reason given'
                                      : null;

                                  /*
                                   * ───────────────────────────────────────────────────────
                                   * THE TITLE NAMES THE STAGE. THE STATE IS SHOWN ONCE.
                                   *
                                   * `outcomeTitle` IS the status word, and the stage already
                                   * renders a state pill beside its title — so on a missed
                                   * meeting both printed "לא הגיע" and the node read:
                                   *
                                   *     לא הגיע
                                   *     לא הגיע
                                   *
                                   * A stage that carries its own state keeps its NAME here,
                                   * which gives "הפגישה · לא הגיע" — the stage, then what
                                   * happened to it, each said once.
                                   *
                                   * `outcomeTitle` still names the CLOSING stage of a job
                                   * that has no state pill of its own (a product's
                                   * fulfilment reading "הזמנה הושלמה"), which is what it was
                                   * written for.
                                   *
                                   * Keyed off `step.key` rather than `meetingStateWord`
                                   * deliberately: that is declared several hundred lines
                                   * below, and reading it here is a temporal dead zone — a
                                   * mistake this file has already produced twice.
                                   * ───────────────────────────────────────────────────────
                                   */
                                  const stageShowsItsOwnState =
                                    step.key === 'session' ||
                                    step.key === 'schedule' ||
                                    step.metadata?.state != null;

                                  const stepTitle =
                                    step.label ||
                                    (stageShowsItsOwnState ? null : outcomeTitle) ||
                                    translated(t, `crm.booking.step.${step.key}`) ||
                                    step.key;
                                  const isIntakeStep = step.key === 'intake';
                                  const isProposalStep = step.key === 'proposal';

                                  // Read once and typed here rather than cast at
                                  // the point of use: `metadata` is a bag of
                                  // unknowns, and narrowing it inside JSX reads
                                  // as three casts of the same value.
                                  const proposalVersions: ProposalVersion[] = Array.isArray(
                                    step.metadata?.versions
                                  )
                                    ? (step.metadata?.versions as ProposalVersion[])
                                    : [];
                                  const isPaymentStep = step.key === 'payment';
                                  const isConfirmationStep = step.key === 'confirmation';
                                  /* The job ending, as its own node. Not the meeting
                                     being called off — that has its own line on the
                                     rail and leaves the work running. */
                                  const isCancelledStep = step.key === 'cancelled';
                                  const isScheduleStep = step.key === 'session' || step.key === 'schedule';
                                  /* Is there a meeting rail on this card? One
                                     attempt is enough to draw it, and the rail owns
                                     the actions that belong to an appointment. */
                                  const hasMeetingRail = (booking.attempts?.length ?? 0) > 0;

                                  /* Worth a history at all: more than one attempt, or mail
                                     to show against the single attempt there is. */
                                  const attemptsForHistory = booking.attempts ?? [];
                                  const mailCount = attemptsForHistory.reduce(
                                    (n, a) => n + (a.emails?.length ?? 0),
                                    0
                                  );
                                  const hasHistory =
                                    attemptsForHistory.length > 1 || mailCount > 0;
                                  const historyOpen = openHistory.has(booking.id);

                                  /*
                                   * HOW MUCH, never what. The whole value of the collapsed
                                   * state is that it does not make the owner read the chain
                                   * to find out whether there is one.
                                   *
                                   * Composed rather than interpolated: `t()` takes a key and
                                   * nothing else.
                                   */
                                  const historySummary = [
                                    attemptsForHistory.length > 1
                                      ? `${attemptsForHistory.length - 1} ${
                                          translated(t, 'crm.journey.changes_count') || 'time changes'
                                        }`
                                      : null,
                                    mailCount > 0
                                      ? `${mailCount} ${
                                          translated(t, 'crm.journey.mails_count') || 'emails to the client'
                                        }`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ');

                                  /*
                                   * The arrow between two attempts: who moved it, and when.
                                   *
                                   * The time is the NEXT attempt's creation — the moment the
                                   * move happened — not the appointment's own hour, which is
                                   * what it was moved TO.
                                   */
                                  const movedSentence = (next?: MeetingAttempt) => {
                                    /*
                                     * ── WHO, FROM THE ROW, NOT FROM AN ASSUMPTION ──
                                     * This said "you changed the time" for every
                                     * move, including the ones a client made for
                                     * themselves on the public booking portal. An
                                     * owner opening the card after their client
                                     * rebooked was told they had done it.
                                     *
                                     * `moved_by` (20261082) is on the attempt the
                                     * move created, which is exactly this `next`.
                                     * Null where nobody recorded it — every row
                                     * written before the column — and then the line
                                     * reports the move WITHOUT naming a side, which
                                     * is the honest reading of a blank.
                                     */
                                    const who =
                                      next?.moved_by === 'client'
                                        ? translated(t, 'crm.journey.client_moved') ||
                                          'The client changed the time'
                                        : next?.moved_by === 'owner'
                                          ? translated(t, 'crm.journey.you_moved') ||
                                            'You changed the time'
                                          : next?.moved_by === 'system'
                                            ? translated(t, 'crm.journey.auto_moved') ||
                                              'The time was changed automatically'
                                            : translated(t, 'crm.journey.time_moved') ||
                                              'The time was changed';
                                    const at = next?.created_at;
                                    return at ? `${who} · ${formatTime(at)}` : who;
                                  };

                                  /*
                                   * One mail, as a sentence. The verb says whose doing it
                                   * was — "sent to the client" for the system, "you sent
                                   * again" for a resend — which is what the owner could not
                                   * tell when both rows ended in the same word.
                                   */
                                  const renderMailRow = (
                                    mail: NonNullable<MeetingAttempt['emails']>[number],
                                    isLatest: boolean,
                                    stamp: (at: string | null | undefined) => string | null
                                  ) => {
                                    const failed =
                                      mail.status === 'bounced' ||
                                      mail.status === 'complained' ||
                                      mail.status === 'failed';

                                    const verb = mail.isResend
                                      ? translated(t, 'crm.journey.mail_resent_by_you') || 'You sent again'
                                      : translated(t, 'crm.journey.mail_to_client') || 'Sent to the client';

                                    /*
                                     * WHAT was sent, named rather than quoted.
                                     * ───────────────────────────────────────────
                                     * The row used to print the raw subject, so
                                     * one booking read:
                                     *
                                     *   ✉ נשלח ללקוח הפגישה שלך אושרה - הצעת מחיר לשיפוץ
                                     *   ✉ נשלח ללקוח הפגישה נקבעה מחדש - הצעת מחיר לשיפוץ
                                     *
                                     * with the service name repeated on every
                                     * line, carrying nothing: it is one booking,
                                     * so it is one service throughout.
                                     *
                                     * The kind is recorded on the row (20261081)
                                     * by the sender that knew it. Falling back to
                                     * the subject keeps every pre-column row
                                     * rendering exactly as it does today, and
                                     * covers a kind that has no label yet —
                                     * showing a raw identifier like
                                     * `booking_confirmed` to an owner would be
                                     * worse than the subject it replaced.
                                     */
                                    const what =
                                      (mail.kind
                                        ? translated(t, `crm.journey.mail_kind.${mail.kind}`)
                                        : null) || mail.subject;

                                    return (
                                      <span
                                        key={mail.id}
                                        className="flex items-baseline gap-2 text-[12px] text-[var(--v2-text-secondary)]"
                                      >
                                        {mail.isResend && !failed ? (
                                          <RotateCcw
                                            className="h-3 w-3 shrink-0 text-[#3B5AE5] dark:text-[#93A8FF]"
                                            style={{ transform: 'translateY(2px)' }}
                                            aria-hidden="true"
                                          />
                                        ) : (
                                          <Mail
                                            className="h-3 w-3 shrink-0"
                                            style={{
                                              transform: 'translateY(2px)',
                                              color: failed ? '#F04438' : 'var(--v2-text-muted)',
                                            }}
                                            aria-hidden="true"
                                          />
                                        )}
                                        <span className="flex-1 min-w-0">
                                          {verb} <span className="font-medium">{what}</span>
                                          {failed && (
                                            <>
                                              <span aria-hidden="true"> · </span>
                                              <span style={{ color: '#9A3412' }}>
                                                {t(`crm.email.status.${mail.status}`)}
                                              </span>
                                            </>
                                          )}
                                          {/* ── NOTHING LEFT TO CONFIRM ──────────────────
                                              "Send again" regenerates the CONFIRMATION with
                                              the appointment's current time. Once the
                                              meeting has happened there is nothing to
                                              confirm, and the link sat on the newest mail —
                                              which after a no-show is "we missed you",
                                              directly above the line saying the meeting took
                                              place. Two contradictory messages, one press
                                              apart.

                                              Still offered while the appointment is ahead or
                                              unresolved, which is when a client who cannot
                                              find the details actually needs them. */}
                                          {/* ── ON THE LAST MAIL, WHATEVER IT WAS ──────
                                              This was gated off after an outcome was
                                              recorded, and the reason was never that
                                              resending is wrong: the link always called
                                              the CONFIRMATION route, so on a booking
                                              whose last message was a cancellation it
                                              would have sent "your appointment is
                                              confirmed" one line under "you cancelled
                                              the meeting".

                                              It now resends the KIND it sits on, which
                                              `email_kind` made knowable (20261081), so
                                              the gate can go. A client who lost any of
                                              these messages can be sent it again.

                                              Still closed on a job that was called off:
                                              there is nothing to re-send a client about
                                              work that has stopped. */}
                                          {/* ── NOT ONCE THE JOB IS OFF, BECAUSE THESE ARE
                                              NO LONGER TRUE ──────────────────────────────
                                              The resend must survive a cancellation — a
                                              client who cannot find the message is exactly
                                              who needs it again. But the message they need
                                              is the CANCELLATION, and that is not what sits
                                              here: this rail holds mail about the
                                              appointment, and once the work has stopped
                                              every one of them is superseded.

                                              Observed: with this open, "send again" on the
                                              last rail row re-sent "the meeting is off,
                                              your quote is still coming" twenty minutes
                                              after the whole booking was cancelled.

                                              So the cancellation node owns the resend from
                                              then on, and it offers `booking_cancelled` —
                                              the one message that is still true. */}
                                          {isLatest &&
                                            onResendMail &&
                                            !jobCalledOff &&
                                            RESENDABLE_KINDS.has(mail.kind ?? '') && (
                                            <>
                                              <span aria-hidden="true"> · </span>
                                              <button
                                                type="button"
                                                onClick={e => {
                                                  e.stopPropagation();
                                                  onResendMail(booking.id, mail.kind as string);
                                                }}
                                                className="underline underline-offset-2 hover:text-[var(--v2-text-primary)]"
                                              >
                                                {translated(t, 'crm.journey.resend') || 'Send again'}
                                              </button>
                                            </>
                                          )}
                                        </span>
                                        {mail.at && (
                                          <span className="text-[var(--v2-text-muted)] tabular-nums shrink-0">
                                            {stamp(mail.at)}
                                          </span>
                                        )}
                                      </span>
                                    );
                                  };

                                  /*
                                   * ───────────────────────────────────────────────────────
                                   * AN ANSWER CAN BE CHANGED.
                                   *
                                   * All four meeting actions were gated on
                                   * `!meetingSettled`, so recording any outcome removed
                                   * every one of them: an owner who marked a no-show by
                                   * mistake, or whose client turned up after all, had no
                                   * way back from the card. The journey was treating a
                                   * record as final when the thing it records is a human
                                   * judgement made in a hurry.
                                   *
                                   * So the stage keeps offering the OTHER answers, and
                                   * drops only the one already given — there is nothing to
                                   * do with "mark as no-show" on a meeting already marked
                                   * no-show.
                                   *
                                   * The JOB being called off is different and still hides
                                   * them all: there is no appointment left to judge.
                                   */
                                  /*
                                   * ───────────────────────────────────────────────────────
                                   * CORRECTABLE WHILE THE JOB IS RUNNING. NOT AFTER IT ENDS.
                                   *
                                   * This was `!jobCalledOff` alone, which was too wide: it
                                   * offered "mark as no-show" on booking 64834a57 — held,
                                   * completed, and REFUNDED. Editing the attendance of work
                                   * that is finished and whose money has gone back is not a
                                   * correction, it is rewriting a closed record.
                                   *
                                   * `status === 'completed'` can be used here BECAUSE of the
                                   * split. `complete()` no longer writes it, so a meeting
                                   * marked held today keeps `status: 'confirmed'` and stays
                                   * correctable — while a legacy row that carries
                                   * `completed` is a job its owner closed, and closes here
                                   * too. The two are finally distinguishable.
                                   * ───────────────────────────────────────────────────────
                                   */
                                  const jobFinished =
                                    booking.status === 'completed' ||
                                    moneyReturned ||
                                    (isQuoted && Boolean(quotePaid));

                                  const meetingAnswerable =
                                    isScheduleStep && !jobCalledOff && !jobFinished;
                                  /*
                                   * ───────────────────────────────────────────────────────
                                   * AN APPOINTMENT THAT HAPPENED CANNOT BE MOVED OR CALLED
                                   * OFF.
                                   *
                                   * The outcomes are not interchangeable. A no-show leaves
                                   * the appointment unresolved — rescheduling it or calling
                                   * it off are both real next moves. `held` means it took
                                   * place, and "change the time" on a meeting that already
                                   * happened is a contradiction, not flexibility.
                                   *
                                   * NOR MARKED AS A NO-SHOW. The correction was kept here
                                   * at first, on the reasoning that an owner who ticked
                                   * held by mistake needs a way back. But a lone amber
                                   * "mark as no-show" under a line reading "you marked the
                                   * meeting as held" reads as an open question, not as an
                                   * undo — which is how it was reported.
                                   *
                                   * So held closes the row completely: a meeting that took
                                   * place is answered, and the card stops asking. The rail
                                   * above still says what happened and when.
                                   *
                                   * A NO-SHOW is the opposite and keeps its controls: the
                                   * appointment is unresolved, and moving it, calling it
                                   * off or recording that they turned up after all are all
                                   * real next moves.
                                   * ───────────────────────────────────────────────────────
                                   */
                                  const meetingHappened = booking.meeting_status === 'held';
                                  /*
                                   * ── AND ONE THAT WAS CALLED OFF DID NOT HAPPEN ──
                                   * A cancelled appointment cannot also have been
                                   * attended, and nobody can have failed to turn up
                                   * to it: those are rival accounts of the same
                                   * hour, not corrections of each other.
                                   *
                                   * Moving it is not a move either. A called-off
                                   * appointment is a record of an hour that was
                                   * dropped, and dragging that row to a new date
                                   * rewrites what happened instead of arranging
                                   * anything. The same rule the card already
                                   * applies after a no-show: what comes next is a
                                   * NEW appointment, not an edit of the dead one.
                                   */
                                  /* `meetingCancelled`, not `meetingCalledOff`: this
                                     file already has the latter, and it means
                                     something wider — no-show OR cancelled OR the
                                     legacy spellings — which is right for colouring
                                     a row and wrong for every rule below. */
                                  const meetingCancelled = booking.meeting_status === 'cancelled';

                                  const canMarkHeld =
                                    meetingAnswerable &&
                                    !meetingCancelled &&
                                    booking.meeting_status !== 'held';
                                  const canMarkNoShow =
                                    meetingAnswerable &&
                                    !meetingHappened &&
                                    !meetingCancelled &&
                                    booking.meeting_status !== 'no_show';
                                  const canCancelMeeting =
                                    meetingAnswerable &&
                                    !meetingHappened &&
                                    booking.meeting_status !== 'cancelled';
                                  const intakeExpandable = isIntakeStep && hasIntake;
                                  const sectionKey = `${booking.id}-${step.key}-${index}`;
                                  const isSectionExpanded = expandedSections.has(sectionKey);

                                  const payment = session.payment;
                                  /*
                                   * Does each stage carry its own send button?
                                   *
                                   * When it does, the summary-level one is not
                                   * just redundant but WRONG: a job billed in
                                   * three parts has three documents, and a
                                   * single button can only ever reach the
                                   * latest. Two controls that look alike and
                                   * send different things is worse than one
                                   * that is honest about its scope.
                                   *
                                   * A single-payment booking has no stage rows,
                                   * so the summary button stays its only route.
                                   */
                                  const hasStageDocuments = Boolean(
                                    payment?.plan?.stages?.some(s => s.invoiceId)
                                  );
                                  const refunded = payment?.refundedAmount ?? 0;

                                  /*
                                   * What was CHARGED — from the invoice first.
                                   *
                                   * `payment.amount` is the service's CURRENT price:
                                   * a live figure that can be edited, zeroed, or lost
                                   * when a service is replaced. Reading it meant the
                                   * receipt could vanish from a booking whose money
                                   * had not changed at all. What was invoiced is a
                                   * fact about the past and cannot move.
                                   */
                                  /*
                                   * A PLAN has collected only what its paid periods
                                   * add up to — not the agreement's total, and not
                                   * the service's price. The plan booking on this
                                   * account read "charged $1,000.00" with $333.33
                                   * actually taken, which overstates by two thirds
                                   * on a block whose whole job is to add up.
                                   */
                                  const collectedOnPlan =
                                    payment?.plan && (payment.plan.periodsPaid ?? 0) > 0
                                      ? Math.round(
                                          payment.plan.installmentAmount *
                                            (payment.plan.periodsPaid ?? 0) * 100
                                        ) / 100
                                      : null;
                                  /*
                                   * `periodsPaid` comes from the plan's local mirror
                                   * and is undefined until it exists. Multiplying by
                                   * zero produced a charged figure of 0 — and `??`
                                   * does not fall through a zero — so the receipt
                                   * vanished from every plan whose mirror had not
                                   * landed yet. Unknown falls back to the payment.
                                   */

                                  const charged =
                                    collectedOnPlan ??
                                    payment?.invoicedAmount ??
                                    payment?.amount ??
                                    0;

                                  /*
                                   * The ledger appears when there is something to
                                   * reconcile — which means a refund.
                                   *
                                   * It used to appear for any payment at all, so an
                                   * ordinary sale rendered as a one-row table: the word
                                   * "Charged" on one side, "$200.00" pushed to the
                                   * other, inside a 290px block. Beside every other
                                   * step in the journey — each stating its fact in one
                                   * plain line — that read as a stray label next to a
                                   * floating number, and it is the row the eye lands on
                                   * first because it is the only one shaped differently.
                                   *
                                   * Charged, returned and a ruled total earn that shape:
                                   * three figures that have to be seen to add up. One
                                   * figure does not. Without a refund the amount is
                                   * stated the way the schedule and the intake state
                                   * theirs, from `step.details`, which already carries
                                   * the formatted amount.
                                   *
                                   * A refund with no price behind it still shows — that
                                   * is why this asks about `refunded`, not `charged`.
                                   */
                                  const showAccount =
                                    isPaymentStep &&
                                    !!payment &&
                                    payment.status !== 'free' &&
                                    refunded > 0;

                                  /*
                                   * Did any money actually reach the business?
                                   *
                                   * Not "is there a price on this" — an invoice
                                   * carries its amount whether or not anybody
                                   * paid it. A plan counts too: periods already
                                   * taken are money in, even where the rest is
                                   * still to come.
                                   */
                                  const moneyMoved = Boolean(
                                    payment &&
                                      (payment.status === 'paid' ||
                                        payment.status === 'refunded' ||
                                        refunded > 0 ||
                                        (collectedOnPlan ?? 0) > 0)
                                  );

                                  /*
                                   * A cancelled booking nobody paid for.
                                   *
                                   * ─────────────────────────────────────────
                                   * The payment step still showed its amount
                                   * and a "Manage payment" button, so a
                                   * cancelled booking read as one with ₪300
                                   * outstanding. There is nothing to manage:
                                   * cancelling the booking cancelled the
                                   * invoice with it, and voided it at Stripe,
                                   * so nothing is owed and nothing can be
                                   * refunded.
                                   *
                                   * The amount stays visible — it is what the
                                   * job was going to cost — but the button goes
                                   * and a chip says why nothing was ever paid.
                                   * Without it, an owner looking at an
                                   * unfinished checkout cannot tell "they never
                                   * completed it" from "we are still waiting".
                                   * ─────────────────────────────────────────
                                   */
                                  /*
                                   * Was money ever ASKED for on this booking?
                                   *
                                   * The quoted case is the exception the button
                                   * below already documents: a quoted job's
                                   * booking carries the `free` placeholder
                                   * because its price lived on the quote, so
                                   * `free` there does not mean free.
                                   */
                                  const paymentExpected = isQuoted
                                    ? true
                                    : Boolean(payment) && payment?.status !== 'free';

                                  /*
                                   * Money that is not coming, by either route.
                                   *
                                   * ─────────────────────────────────────────────────────
                                   * This asked only whether the BOOKING was cancelled, and
                                   * that is one of two ways money stops being owed. The
                                   * other is the invoice itself being called off — a quote
                                   * stopped part way, or the owner pressing "Cancel this
                                   * payment" — which leaves the booking exactly as it was.
                                   *
                                   * So a cancelled ₪5,000 invoice on a completed booking
                                   * went on reading "outstanding ₪5,000", still offered
                                   * "Manage payment", and still offered to resend the very
                                   * invoice that had just been voided.
                                   *
                                   * `!moneyMoved` still guards both routes: an invoice
                                   * cancelled after part of it was collected is not money
                                   * given up on, and belongs in the refunded/kept pair
                                   * rather than in the Stopped cell.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  const cancelledUnpaid =
                                    isPaymentStep &&
                                    paymentExpected &&
                                    !moneyMoved &&
                                    /* `jobCalledOff` rather than the status: a
                                       held consultation keeps `completed` when
                                       its job is cancelled, and the stages that
                                       never had an invoice raised have no
                                       `invoiceStatus` to fall back on — so
                                       reading the status alone put those stages
                                       back to looking collectable. */
                                    (jobCalledOff ||
                                      payment?.invoiceStatus === 'cancelled');

                                  /**
                                   * Nothing left for the payment dialog to do.
                                   *
                                   * ─────────────────────────────────────────────────────
                                   * "Manage payment" opens on a job whose money has all
                                   * gone back: nothing to collect, nothing left to return.
                                   * The dialog has no action to offer there, so the button
                                   * is an invitation to a dead end — and until the fixes
                                   * beside this one it offered "Mark as paid" on refunded
                                   * money.
                                   *
                                   * BOTH halves are required, and the second is the one
                                   * that matters. `status: 'refunded'` means everything
                                   * COLLECTED came back, which on a plan can be true while
                                   * a later stage has never been billed at all — a deposit
                                   * taken and returned, the final milestone still owed.
                                   * Hiding the button there would remove the only way to
                                   * record that milestone when it is eventually paid in
                                   * cash, which is the whole purpose of the dialog.
                                   *
                                   * So: every stage must be finished too. The same three
                                   * finished states `hasStoppableWork` uses, for the same
                                   * reason — duplicated rather than imported because that
                                   * helper lives in the drawer, which imports THIS file.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  const everyStageFinished = payment?.plan?.stages?.length
                                    ? payment.plan.stages.every(stage =>
                                        ['paid', 'cancelled', 'refunded'].includes(String(stage.status))
                                      )
                                    : true;

                                  const nothingLeftToManage =
                                    payment?.status === 'refunded' && everyStageFinished;

                                  /**
                                   * Does this step draw its own money account below?
                                   *
                                   * ─────────────────────────────────────────────────────
                                   * Hoisted because TWO places need the same answer and
                                   * they must not drift: the block itself, and the step's
                                   * primary fact line, which prints "₪300.00" and has to
                                   * stay quiet when the account underneath already says
                                   * the figure three times over.
                                   *
                                   * The file makes this point about `hasCardBody` a few
                                   * lines up — conditions listed one per line, read off
                                   * the blocks they guard, so a gate cannot be changed in
                                   * one place only. Same reasoning, one step further: the
                                   * gate is now a single value rather than a condition
                                   * copied into both.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  const showsPaymentAccount = Boolean(
                                    isPaymentStep &&
                                      payment &&
                                      // A written schedule is the staged branch's business.
                                      !payment.plan?.stages?.length &&
                                      payment.status !== 'free'
                                  );

                                  /**
                                   * Does the confirmation step draw its own outcome line?
                                   *
                                   * ─────────────────────────────────────────────────────
                                   * The card's primary line was the email's SUBJECT, so it
                                   * read as a sentence in the CLIENT's voice — "your
                                   * meeting has been confirmed" — on the OWNER's screen,
                                   * and asserted a fact about the booking when it was
                                   * really describing an email. Whether that email arrived
                                   * was never shown at all: a bounced confirmation and a
                                   * delivered one drew the same row.
                                   *
                                   * The outcome becomes the line, and the subject moves
                                   * below it as a quotation of what was sent. Hoisted for
                                   * the same reason as `showsPaymentAccount`: the block and
                                   * the fact line it replaces must not disagree about when
                                   * it renders.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  const showsEmailOutcome = Boolean(
                                    isConfirmationStep && step.metadata
                                  );

                                  /**
                                   * The staged branch — a plan or quote with a schedule.
                                   *
                                   * ─────────────────────────────────────────────────────
                                   * Its fact line is a summary of the money: "₪400 · 1 of 2
                                   * · ₪800 total". That sentence was the only account the
                                   * card had, and it earned its place. It no longer does.
                                   *
                                   * The strip beneath it names ₪800 as the total, ₪400 as
                                   * collected and ₪400 as outstanding; the rows under THAT
                                   * name every period, its amount, its date and its state.
                                   * "1 of 2" is two rows with one of them green. So the
                                   * line repeats the total exactly and implies the rest,
                                   * which is the same four-copies-of-one-figure problem
                                   * the single-payment card had.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  const showsPaymentStages = Boolean(
                                    isPaymentStep && payment?.plan?.stages?.length
                                  );


                                  /**
                                   * The quote has been answered, so its own rows say so.
                                   *
                                   * ─────────────────────────────────────────────────────
                                   * An accepted or stopped quote lists its versions below,
                                   * and the standing one carries BOTH facts the header was
                                   * printing — "אושרה ₪9,000.00, 7 באוק׳". So the amount
                                   * and the state line go quiet and the row owns them.
                                   *
                                   * This gated a totals strip here too, briefly. It said
                                   * the same three figures as the payment step's, on the
                                   * same booking, a card apart — so the money has one home
                                   * again and this says only that the rows have the rest.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  const quoteAnswered = Boolean(
                                    isProposalStep &&
                                      payment &&
                                      (step.metadata?.proposalStatus === 'accepted' ||
                                        step.metadata?.proposalStatus === 'stopped')
                                  );

                                  const colors = STATUS_COLORS[step.status];

                                  /*
                                   * The appointment reads as three things, not one:
                                   * the time it runs, the day and whether it has
                                   * happened, and how long it lasts. The step only
                                   * carries the time range, so the rest is composed
                                   * here from the booking itself.
                                   */
                                  /*
                                   * The time the appointment runs.
                                   *
                                   * The `session` step carries no details of its own
                                   * — it is only a status marker — so the row showed
                                   * a weekday and a duration and never said WHEN.
                                   * Composed from the slot, like the schedule step
                                   * above it does.
                                   */
                                  const scheduleDuration = (() => {
                                    if (!isScheduleStep) return null;
                                    // Derived from the slot rather than a stored
                                    // figure: `duration` lives on the service, and a
                                    // booking that was moved or extended is the
                                    // authority on how long it actually runs.
                                    const minutes =
                                      (booking.start_time && booking.end_time
                                        ? Math.round(
                                            (new Date(booking.end_time).getTime() -
                                              new Date(booking.start_time).getTime()) / 60000
                                          )
                                        : null);
                                    return minutes && minutes > 0 ? formatDuration(minutes) : null;
                                  })();


                                  const scheduleFact =
                                    isScheduleStep && !step.details && booking.start_time
                                      ? [
                                          /*
                                           * WHICH DAY, not just which hour.
                                           *
                                           * This line said "14:00 – 15:00" and nothing
                                           * else. The weekday sits further down the card,
                                           * beside the status — so an owner reading the
                                           * meeting step learned it was a Monday at two,
                                           * and had to work out WHICH Monday from the
                                           * booking's position in the list.
                                           *
                                           * The date leads because that is the question
                                           * being asked of this step: the hour is the
                                           * detail of the day, not the other way round.
                                           * `formatShortDate` is the file's own date, so
                                           * this reads like the refund dates beside it and
                                           * resolves in the BUSINESS's zone like
                                           * everything else on the card.
                                           */
                                          /*
                                            THE WEEKDAY BELONGS TO ITS DATE.
                                            ────────────────────────────────
                                            It used to sit two lines down, beside the
                                            status, because this line had no room for it
                                            — so "4 באוק׳ 2026" and "יום ראשון" were the
                                            same fact printed in two places, and the
                                            status was left reading as a property of the
                                            weekday it was glued to.

                                            A comma, not a middot: "Sunday, 4 October" is
                                            one phrase in every language here. The middot
                                            is this card's separator for things that are
                                            genuinely separate.

                                            The BUSINESS's weekday, matching the date
                                            beside it — an evening appointment was named
                                            the next day for an owner logged in abroad.
                                          */
                                          `${new Intl.DateTimeFormat(
                                            language,
                                            timeZoneOptions({ weekday: 'long' })
                                          ).format(new Date(booking.start_time))}, ${formatShortDate(
                                            booking.start_time,
                                            { withYear: true }
                                          )}`,
                                        ].join(' · ')
                                      : null;

                                  /**
                                   * The hours, and how long they run.
                                   *
                                   * ───────────────────────────────────────────────────
                                   * Its own line, under the date. The range answers "when
                                   * within that day" and the duration answers "for how
                                   * long" — two halves of one question, and neither is the
                                   * headline now that the card is called תאריך הפגישה.
                                   *
                                   * The duration moved here from the header gutter, where
                                   * it displaced the step's own time and left "1 ש׳"
                                   * floating alone above the date with nothing to attach
                                   * it to.
                                   * ───────────────────────────────────────────────────
                                   */
                                  const scheduleTime =
                                    isScheduleStep && !step.details && booking.start_time
                                      ? [
                                          booking.end_time
                                            ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
                                            : formatTime(booking.start_time),
                                          scheduleDuration,
                                        ]
                                          .filter(Boolean)
                                          .join(' · ')
                                      : null;

                                  /*
                                   * The booking's OWN status wins over the clock.
                                   *
                                   * This read the start time first, so an
                                   * appointment marked completed — or a no-show —
                                   * still said "טרם התקיימה" until its slot came
                                   * round, and offered to reschedule it. What the
                                   * owner recorded outranks what the calendar
                                   * implies; the clock is only the fallback for a
                                   * booking still sitting at `confirmed`.
                                   */
                                  /*
                                   * The booking has an outcome on record.
                                   *
                                   * Describes the BOOKING, not any one step: it
                                   * gates rescheduling, resending the confirmation
                                   * and the status buttons alike. An appointment
                                   * that did not happen must not be re-confirmed —
                                   * that email carries a calendar invite and would
                                   * put a dead appointment back in the client's
                                   * diary.
                                   */
                                  /*
                                   * "Is this over?" — which is NOT the same as
                                   * "did the appointment reach its end".
                                   *
                                   * For a regular booking the two coincide and
                                   * this is unchanged. For a quoted one they do
                                   * not: marking the consultation completed
                                   * retired a card whose job had not been
                                   * priced, let alone paid. Only cancelling
                                   * ends a quoted job — and payment in full
                                   * finishes it.
                                   */
                                  /*
                                   * Is the MEETING over?
                                   *
                                   * The appointment's own question, and the
                                   * original meaning of this flag. Everything
                                   * about the appointment reads it: whether it
                                   * was held, whether it can still be moved,
                                   * whether a confirmation is worth resending.
                                   */
                                  const meetingSettled = attendanceRecorded(booking);

                                  /*
                                   * ─────────────────────────────────────────────────────
                                   * THE MEETING'S STATE, FOR ITS TITLE.
                                   *
                                   * "טרם התקיימה" was the tail of the fact line, after the
                                   * date and the length, so the one thing on this stage an
                                   * owner acts on sat third in a grey sentence. It belongs
                                   * beside the stage's name, where every other stage now
                                   * carries its state.
                                   *
                                   * Lifted out of the join rather than copied, so the line
                                   * below and the title can never disagree about it.
                                   * ─────────────────────────────────────────────────────
                                   */
                                  const meetingStateWord = !isScheduleStep || !booking.start_time
                                    ? null
                                    : meetingSettled
                                      ? /*
                                         * ── THE MEETING READS ITS OWN COLUMN ─────────
                                         * This took its word from `booking.status`, which
                                         * described the meeting only while every outcome
                                         * overwrote it. Held and no-show now leave the job
                                         * alone, so a missed consultation stays
                                         * `confirmed` — and this printed מאושרת, APPROVED,
                                         * over a meeting the client never turned up to.
                                         *
                                         * Each outcome says itself, in the words its own
                                         * button used: pressing סמן שהתקיימה and being told
                                         * הושלם reads as a different outcome than the one
                                         * just recorded.
                                         */
                                        booking.meeting_status === 'held'
                                        ? t('crm.booking.quoted.meeting_held')
                                        : booking.meeting_status === 'no_show'
                                          ? t('crm.booking.status.no_show')
                                          : booking.meeting_status === 'cancelled'
                                            ? t('crm.booking.status.cancelled')
                                            /* Rows written before the column existed. */
                                            : getBookingStatusLabel(booking.status, !isUnscheduled, booking.payment_status !== undefined && booking.payment_status !== 'paid', booking.start_time).text
                                      : new Date(booking.start_time) > new Date()
                                        /*
                                         * ── AHEAD IS NOT A SHORTFALL ──────────────
                                         * This said "טרם התקיימה" / "Not yet held"
                                         * about an appointment three days away. Both
                                         * read as a judgement on something that
                                         * should already have happened, and the same
                                         * card says "the meeting is still ahead" a
                                         * few lines above — two phrasings of one fact,
                                         * one of them wrong.
                                         *
                                         * "Not yet held" belongs to the branch below:
                                         * the hour has PASSED and nobody has said what
                                         * happened. That one is a real question.
                                         */
                                        ? t('crm.journey.scheduled_ahead') || 'Scheduled'
                                        : t('crm.journey.awaiting_outcome') || 'Awaiting an outcome';

                                  /*
                                   * Is the JOB over?
                                   *
                                   * A different question, and for a quoted
                                   * booking a different answer: the
                                   * consultation being held ends the meeting
                                   * and starts the work. Only the card-level
                                   * state reads this.
                                   */
                                  const settledStatus = jobIsOver({
                                    status: booking.status,
                                    meeting_status: booking.meeting_status,
                                    isQuoted,
                                    quotePaid: Boolean(quotePaid),
                                  });

                                  /**
                                   * Its time has passed and nobody has said what happened.
                                   *
                                   * The same condition `scheduleDetail` uses to choose
                                   * "ממתין לעדכון" over "not yet held" — named here so the
                                   * dot beside that sentence is coloured by the same test
                                   * that produced it. Derived twice, they would eventually
                                   * disagree and the card would show a brown dot against
                                   * "not yet held".
                                   */
                                  const scheduleAwaiting = Boolean(
                                    isScheduleStep &&
                                      booking.start_time &&
                                      !meetingSettled &&
                                      new Date(booking.start_time) <= new Date()
                                  );

                                  /*
                                   * HELD IS NOT THE SAME AS "HAS AN ANSWER".
                                   *
                                   * ─────────────────────────────────────────────────────────
                                   * The dot beside this line was green whenever
                                   * `meetingSettled` was true, and `attendanceRecorded`
                                   * counts cancelled and no-show as settled — an answer
                                   * exists, which is the question the ACTION STRIP asks,
                                   * because a settled meeting has no attendance left to
                                   * record either way.
                                   *
                                   * It is the wrong question for a colour. The result was a
                                   * green dot, the platform's "this went well" mark, sitting
                                   * directly beside the word בוטלה. The comment above the
                                   * dot already said "green once it is marked held"; the
                                   * condition under it said something else.
                                   *
                                   * Red rather than muted: the step's own node on the rail
                                   * is already `failed`, and a muted dot next to a red node
                                   * would read as two different opinions about one meeting.
                                   * ─────────────────────────────────────────────────────────
                                   */
                                  /*
                                   * `meeting_status`, not `status`. This dot is the
                                   * answer to "did the meeting happen", and that fact
                                   * moved columns: `complete()` writes
                                   * `meeting_status: 'held'` and leaves `status` at
                                   * `confirmed`, so the dot stayed grey for every
                                   * meeting marked held after the split. The old values
                                   * are still honoured for rows that predate it.
                                   */
                                  const meetingHeld =
                                    booking.meeting_status === 'held' ||
                                    (booking.meeting_status == null && booking.status === 'completed');
                                  const meetingCalledOff =
                                    booking.meeting_status === 'no_show' ||
                                    booking.meeting_status === 'cancelled' ||
                                    (booking.meeting_status == null &&
                                      (booking.status === 'cancelled' || booking.status === 'no_show'));

                                  /*
                                   * IS THERE STILL A MEETING TO PREPARE FOR?
                                   *
                                   * ─────────────────────────────────────────────────────────
                                   * All three send-intake affordances — the node, its tooltip
                                   * and the button — asked `status !== 'cancelled'`, which is
                                   * the narrowest possible reading of "is this still live".
                                   *
                                   * Two states slip straight through it. A job STOPPED after
                                   * its consultation was held keeps `completed`, because
                                   * `cancel` no longer overwrites a recorded attendance; and
                                   * a meeting that simply happened is `completed` too. Both
                                   * were offered "שלח טופס לקוח" — an invitation to send the
                                   * client a form preparing them for a meeting that is over,
                                   * on a job the owner had already called off.
                                   *
                                   * Both halves are needed and neither implies the other:
                                   *
                                   *   · `meetingSettled` — the appointment has an outcome, so
                                   *     there is nothing left to prepare for. Covers
                                   *     cancelled and no-show as well, which is why the old
                                   *     status test is not kept beside it.
                                   *   · `jobCalledOff` — the WORK is off while the meeting is
                                   *     still ahead. A quote stopped from Manage Payment
                                   *     leaves `confirmed` untouched, so nothing above would
                                   *     catch it.
                                   *
                                   * `outcomeRecorded` in `bookingStatus.ts` now refuses the
                                   * same submissions server-side. This is the surface that
                                   * stops OFFERING them.
                                   * ─────────────────────────────────────────────────────────
                                   */
                                  const canSendIntake = Boolean(
                                    isIntakeStep && !hasIntake && onSendIntake && !meetingSettled && !jobCalledOff
                                  );

                                  const scheduleDetail =
                                    isScheduleStep && booking.start_time
                                      ? [
                                          /*
                                            THE STATUS, ALONE.
                                            ──────────────────
                                            The weekday used to lead this line and the
                                            status followed it after a middot, so
                                            "ממתין לעדכון" read as something about
                                            Sunday. The weekday has gone up to join its
                                            own date; what is left is the one thing on
                                            this card an owner acts on, and it now gets
                                            a line and a dot of its own.
                                          */
                                          /* The state has moved to the stage's title — see
                                             `meetingStateWord`. What is left on this line
                                             is the appointment itself: which day, which
                                             hours, how long. */
                                        ]
                                          .filter(Boolean)
                                          .join(' · ')
                                      : null;

                                  /*
                                   * How long it runs, in the clock column — the fact
                                   * beside it is already the time range, so repeating
                                   * the start time there would say nothing new.
                                   */

                                  // The node keeps its send/resend behaviour.
                                  const onNodeClick =
                                    canSendIntake
                                      ? () => handleSendIntake(booking.id)
                                      : isPaymentStep && !hasStageDocuments && step.metadata?.canResend && onSendInvoice && booking.status !== 'cancelled'
                                        ? () => handleSendInvoice(step.metadata?.invoiceId as string, booking.id)
                                        : undefined;

                                  const nodeLoading =
                                    (isIntakeStep && sendingIntakeBookingId === booking.id) ||
                                    (isPaymentStep && sendingInvoiceBookingId === booking.id);

                                  /*
                                   * Does this card have anything BELOW its first line?
                                   *
                                   * The header only earns its band when something follows
                                   * it: a tinted strip on a card with nothing under it is
                                   * a lid on an empty box, and most steps — booked, paid,
                                   * confirmed — are genuinely one line. Banding all of
                                   * them would tint the whole journey and say nothing.
                                   *
                                   * Every condition below is the one guarding the block it
                                   * names, read off the blocks themselves rather than
                                   * inferred. If a block gains or loses a gate, this has
                                   * to move with it — which is why they are listed one per
                                   * line instead of collapsed.
                                   */
                                  /*
                                   * The step's primary fact — "Custom Training", the client
                                   * line, the confirmation subject, the appointment's hours.
                                   *
                                   * Hoisted because it decides the card's SHAPE, not just
                                   * its text: it is the body's first line, and a step with
                                   * neither a fact nor a block has no body at all.
                                   */
                                  const cardFact = isProposalStep
                                    ? step.details || ''
                                    : step.details ||
                                      /* Above `scheduleFact`: on a cancelled meeting the
                                         hours are still true and no longer the point, and
                                         on a product there is no schedule line at all —
                                         which is how the closing node came to be empty. */
                                      cancelledOutcomeFact ||
                                      scheduleFact ||
                                      (isConfirmationStep && step.status === 'completed'
                                        ? t('crm.booking.email_sent')
                                        : '');

                                  const hasCardBody = Boolean(
                                    cardFact ||
                                    showAccount ||
                                    isProposalStep ||
                                    (isPaymentStep && payment?.plan?.stages?.length) ||
                                    /* The single-payment account. Listed here for the
                                       reason the block above gives: `cardFact` is now
                                       suppressed on exactly these steps, so without this
                                       a payment card could lose its only line and render
                                       as a lid on an empty box. */
                                    showsPaymentAccount ||
                                    showsEmailOutcome ||
                                    quoteAnswered ||
                                    (isIntakeStep && hasIntake) ||
                                    intakeExpandable ||
                                    (isPaymentStep && onManagePayment) ||
                                    (isPaymentStep &&
                                      !hasStageDocuments &&
                                      !!step.metadata?.canResend &&
                                      onSendInvoice &&
                                      booking.status !== 'cancelled') ||
                                    /* The meeting's own actions now live on this step
                                       (held / no-show / reschedule), so the step has a
                                       body whenever any of them is offered. Held needs
                                       no `onEditSession` and no `isUnscheduled`, so the
                                       old condition alone would have drawn a card with
                                       its only content hidden. */
                                    /* The same rule the buttons use: a settled meeting
                                       still offers the other answers, so the step still
                                       has a body. Gated on the JOB instead. */
                                    (isScheduleStep && !jobCalledOff) ||
                                    (isScheduleStep && onEditSession && !isUnscheduled && !jobCalledOff) ||
                                    // The cancelled-plan notice. Rendered by an IIFE rather
                                    // than a `&&`, which is why it is easy to miss when
                                    // reading the blocks off the markup — it is a body like
                                    // any other and earns the header its rule.
                                    (isPaymentStep &&
                                      !!payment?.plan &&
                                      planStates?.[booking.id]?.status === 'cancelled')
                                  );

                                  return (
                                    <div key={sectionKey}>
                                      {/* ── One step: a node on the rail, a card beside it ──
                                          The step used to be a flat row separated from its
                                          neighbours by a top border, with the node sitting in
                                          the first grid column INSIDE it. Rows of equal weight
                                          read as a table, and a booking is not a table: it is
                                          one thing that happened over time.

                                          So the rail and its nodes come out of the row and run
                                          behind it continuously, and what happened at each node
                                          becomes a card. The eye follows one line instead of
                                          re-finding the left edge on every row, and a step
                                          carrying real content (intake answers, a refund
                                          ledger) can open without the rest of the list
                                          inheriting its padding.

                                          The inner grid is KEPT — the label column and the
                                          content column are how every block below places
                                          itself — but it loses the node's column, so what was
                                          column 3 is now column 2. */}
                                      <div
                                        className="relative"
                                        /* 32px, not 40: the gutter was sized for a 22px
                                           node and left the rail a thumb's width from the
                                           text it labels, so the line and the stage read
                                           as two columns rather than one list. 18px node
                                           plus 14px of air. */
                                        style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: '32px', paddingBottom: '10px' }}
                                      >
                                        {/* The rail, behind the nodes and continuous through
                                            the gap between cards. `inset-block` rather than
                                            top/bottom-0 so it meets the wait markers, which
                                            draw the same line dashed. */}
                                        <span
                                          className="absolute w-0.5 bg-[var(--v2-border)]"
                                          /* Dead centre of an 18px node: 9px. It was 11px,
                                             centred under the old 22px one, so the line
                                             entered and left each node off-axis. */
                                          style={{ [isRTL ? 'right' : 'left']: '9px', top: 0, bottom: 0 }}
                                          aria-hidden="true"
                                        />

                                        {/* The node. Still the control it was — send the
                                            intake, resend the invoice — and still carrying the
                                            step's STATUS colour, which is the scheme the rest
                                            of this drawer uses. It sits on the rail rather
                                            than in the card so the line reads unbroken. */}
                                        <button
                                          type="button"
                                          onClick={e => {
                                            if (!onNodeClick) return;
                                            e.stopPropagation();
                                            onNodeClick();
                                          }}
                                          disabled={!onNodeClick || nodeLoading}
                                          title={
                                            canSendIntake
                                              ? t('crm.intake.send_form') || 'Send intake form'
                                              : isPaymentStep && step.metadata?.canResend
                                                ? t('crm.invoice.resend') || 'Resend invoice'
                                                : undefined
                                          }
                                          /* `border-dashed` on a step that has not started:
                                             an empty dashed ring says "not yet" without a
                                             word, the way a solid disc says "here". It is
                                             the only one of the five that is drawn as an
                                             outline rather than a fill. */
                                          className={`absolute z-10 w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 ${colors.bg} ${colors.border} ${
                                            step.status === 'pending' || step.status === 'skipped'
                                              ? 'border-dashed'
                                              : ''
                                          } ${
                                            onNodeClick && !nodeLoading
                                              ? 'cursor-pointer hover:scale-110 transition-transform'
                                              : 'cursor-default'
                                          }`}
                                          /* Ringed in the card's own background so the rail
                                             appears to pass behind the node rather than
                                             through it. `top` aligns it with the first line
                                             of the card header, not the card's box. */
                                          style={{
                                            [isRTL ? 'right' : 'left']: '0px',
                                            /* Aligned to the stage name's cap height, which
                                               moved when the title went to 13.5px. */
                                            top: '4px',
                                            /*
                                               NO HALO. It was a 3px ring painted in
                                               `--v2-surface` so the rail appeared to pass
                                               behind the node — which worked only while
                                               every card wore that exact colour. The card
                                               is now tinted when it needs the owner, so the
                                               ring became a grey disc floating on amber.
                                               The node is opaque and covers the line on its
                                               own, so the ring was only ever cosmetic.
                                            */
                                          }}
                                        >
                                          {nodeLoading ? (
                                            <Loader2 className={`h-3 w-3 ${colors.icon} animate-spin`} />
                                          ) : StepIcon ? (
                                            /*
                                              A heavier stroke, because these are
                                              drawn at half the size they are designed
                                              for. Lucide's default 2px is measured on
                                              a 24px canvas; scaled to 12 it lands near
                                              1px and the glyphs go faint and ragged.
                                            */
                                            <StepIcon className={`h-2.5 w-2.5 ${colors.icon}`} strokeWidth={3} />
                                          ) : null}
                                        </button>

                                        {/* The card. Everything that happened at this node.

                                            `items-baseline` is kept from the row it replaces:
                                            the label and the first line of the content have
                                            to sit on one line, or a one-word step and a
                                            three-line one stop agreeing. */}
                                        <div
                                          /*
                                           * ───────────────────────────────────────────
                                           * NO BOX. A STAGE IS A POINT ON A LINE.
                                           *
                                           * Each step used to be a bordered, filled card
                                           * — a rounded rectangle with a banded header
                                           * and a rule under it. Six of those stacked
                                           * down a rail read as six separate things that
                                           * happened to be near each other, and the rail
                                           * itself disappeared between them.
                                           *
                                           * A journey is one line with marks on it. The
                                           * node carries the state, the title names the
                                           * stage, and the body sits under it as plain
                                           * text. Nothing else is needed to tell two
                                           * stages apart, and without the boxes the eye
                                           * follows the rail instead of re-finding the
                                           * edge of a card on every row.
                                           *
                                           * A step that is genuinely still ahead is
                                           * dimmed rather than drawn — see the opacity
                                           * below — because its content is a promise
                                           * about the future, not a record.
                                           * ───────────────────────────────────────────
                                           */
                                          className={
                                            step.status === 'pending' || step.status === 'skipped'
                                              ? 'opacity-55'
                                              : ''
                                          }
                                        >
                                          {/* ── The header ───────────────────────────────
                                              What this step IS, and when. Banded, with a
                                              rule under it, exactly as the reference does:
                                              the title with a quiet qualifier beside it, and
                                              the content below rather than alongside.

                                              The label used to share a line with the fact in
                                              a 74px column, which meant a step was read left
                                              to right as "Service | Custom Training". Read
                                              as a header and a body it is "Service" and then
                                              what the service was — which is the order the
                                              owner asks the question in.

                                              The rule only appears when something follows
                                              it. A step with neither a fact nor a block is
                                              a header alone, and a line under nothing reads
                                              as a card that failed to load. */}
                                          <div
                                            /* Unbanded and unruled, with the box gone: a
                                               tinted strip and a divider were how one card
                                               separated its own header from its own body,
                                               and there is no longer a card for them to
                                               belong to. The title's weight does that work
                                               now, which is all a stage name needs. */
                                            className={`flex items-baseline gap-2 ps-0 pe-3 pt-1 pb-0.5 ${
                                              hasCardBody ? '' : ''
                                            }`}
                                          >
                                            {/* The stage's name, and with the box gone it is
                                                what separates one stage from the next — so it
                                                carries the weight the border used to. Amber on
                                                the active one, matching its node, so the eye
                                                lands on the stage holding the ball. */}
                                            <span
                                              /* ── THE MOCKUP IS DARK; THE APP IS BOTH ────
                                                 Copying its tones literally is what made
                                                 the active stage invisible on the light
                                                 theme: `amber-300` is a dark-mode value and
                                                 on white it is barely a colour.

                                                 Tailwind's amber-700/300 pair is kept for
                                                 the one stage that must stand out, because
                                                 the V2 tokens carry no accent of their own
                                                 — but every other stage reads from the
                                                 theme's own text tokens, so the rail
                                                 follows the app rather than the mockup. */
                                              className={`text-[13.5px] leading-[1.5] break-words ${
                                                step.status === 'active'
                                                  ? 'font-bold text-amber-700 dark:text-amber-300'
                                                  : 'font-semibold text-[var(--v2-text-primary)]'
                                              }`}
                                            >
                                              {stepTitle}
                                            </span>

                                            {/* ── THE STATE, ON THE TITLE ────────────────
                                                "Not sent yet", "answered", "awaiting a
                                                reply" — the one word an owner scanning the
                                                rail needs. It used to sit on the line
                                                below, among the timestamps, so every stage
                                                read as a name with no state attached.

                                                Carried in metadata by whichever step has
                                                one, so this is a slot rather than a rule
                                                about any particular stage. */}
                                            {step.metadata?.state || meetingStateWord ? (
                                              <span className="text-[11.5px] font-medium text-[var(--v2-text-muted)] whitespace-nowrap">
                                                {String(step.metadata?.state ?? meetingStateWord)}
                                              </span>
                                            ) : null}

                                            {/* The clock. In the flow now rather than
                                                absolutely placed: it sits in a flex row that
                                                owns its own edge, so it no longer needs a
                                                positioned ancestor or the 46px of clearance
                                                the content column had to reserve for it. */}
                                            {/* The step's own time, always — never the
                                                duration. On a meeting step the duration
                                                used to win here, so the gutter read
                                                "1 ש׳" and the hour the step happened at
                                                was nowhere on the card. The length now
                                                sits under the date, beside the range it
                                                describes. */}
                                            {/* ── BESIDE THE TITLE, NOT IN A GUTTER ──────
                                                `ms-auto` threw this to the far edge of the
                                                row, so every step had a lone "15:54"
                                                floating a hand's width from the stage it
                                                belonged to, with white space between. On a
                                                rail that reads top to bottom, a column of
                                                stranded numbers is a second thing to track.

                                                It sits right after the stage's name now, in
                                                the same quiet grey as the body — part of
                                                the sentence rather than a column of its
                                                own. */}
                                            {/* The date has moved to the line BELOW this
                                                one, where it reads as detail about the
                                                stage rather than a number in the corner of
                                                every row. See `stepWhen`. */}
                                          </div>

                                          {/* ── The body ─────────────────────────────────
                                              One column now. The label's 74px column left
                                              with the header, so everything that used to sit
                                              in column 2 sits in column 1 and starts at the
                                              card's own padding. */}
                                          <div
                                            /* The box is gone, so its inset goes with it.
                                               `px-3` indented the body away from a border
                                               that no longer exists, leaving the detail
                                               line hanging off its own title. It now sits
                                               flush under the stage name, with only the
                                               breathing room between stages kept. */
                                            className="grid items-baseline ps-0 pe-3 pt-0.5 pb-2 empty:hidden empty:py-0"
                                            style={{ gridTemplateColumns: 'minmax(0, 1fr)', rowGap: '2px' }}
                                          >
                                        {/* What happened. */}
                                        {/* The old two-column ledger, now only where the
                                            strip cannot go: a PLAN with a refund. A single
                                            payment's refund is drawn below by the shared
                                            strip, in the same cells every other payment
                                            step uses — this one was the last surface still
                                            showing money in a layout of its own. */}
                                        {/*
                                          NO LEDGER HERE ANY MORE.
                                          ────────────────────────
                                          It printed charged / returned / kept ABOVE the
                                          strip — which now carries exactly those three
                                          figures, in those words, a few pixels below. On a
                                          part-refunded job the card stated ₪9,000, ₪2,250
                                          and ₪6,750 twice over, and a reader cannot tell two
                                          copies of one account from two accounts that happen
                                          to agree.

                                          The strip earned it: it reports a refund itself now,
                                          swapping collected/outstanding for returned/kept, so
                                          a second block has nothing left to add.
                                        */}
                                        {(
                                          <span
                                            /* ── QUIETER THAN ITS OWN TITLE ──────────────
                                               This was 14.5px, medium, in the PRIMARY text
                                               colour — larger and louder than the stage
                                               name above it, so every row shouted its
                                               detail and whispered what the detail was
                                               about. Five of those down a rail is a wall.

                                               A stage is its name; the line under it is
                                               supporting text and is sized and coloured to
                                               say so. */
                                            className="text-[12px] leading-[1.55] text-[var(--v2-text-secondary)] break-words"
                                            style={{ gridColumn: 1, gridRow: 1 }}
                                          >
                                            {/* A quote shows BOTH: the amount is
                                                what was offered, and the state is
                                                what is happening to it. Falling
                                                back one to the other meant a sent
                                                quote displayed "₪10,000" and
                                                nothing else — the owner could not
                                                tell an unanswered offer from an
                                                accepted one. */}
                                            {/* The amount is the FACT — what was
                                                offered. Its state is supporting
                                                detail and reads on the line below,
                                                where the payment step already puts
                                                a plan's terms. */}
                                            {/* `cardFact` rather than the expression repeated:
                                                the same value decides whether this card HAS a
                                                body, and two copies of it drift the moment one
                                                gains a fallback. */}
                                            {/* Silent when the account below carries the
                                                figure. On a payment step `cardFact` IS the
                                                amount — "₪300.00" — and the totals strip
                                                under it already names that number as the
                                                total, and again as collected or
                                                outstanding. Printed as well, it read as a
                                                fourth figure the reader had to reconcile
                                                against the other three. */}
                                            {/* ── WHEN, THEN WHAT ──────────────────────
                                                The date leads the line and the detail
                                                follows it, which is the order the mockup
                                                reads in and the order the fact arrived in.
                                                Muted and tabular so a column of them lines
                                                up without competing with the words. */}
                                            {/* NOT ON THE MEETING STEP: it already prints
                                                the appointment in full — "יום ראשון, 18
                                                באוג׳ 2026", then the range and the length —
                                                because that is the one stage whose time IS
                                                the content. A short stamp above it repeated
                                                the same day in a worse format. */}
                                            {stepWhen && !isScheduleStep && (
                                              <span className="tabular-nums text-[var(--v2-text-muted)]">
                                                {stepWhen}
                                                {/* A separator only when something follows
                                                    ON THIS LINE. The email outcome, the
                                                    payment account and the stage list all
                                                    render as their own blocks underneath,
                                                    so counting them left "17 אוק׳ · 21:49 ·"
                                                    with the middot pointing at nothing. */}
                                                {cardFact ? ' · ' : ''}
                                              </span>
                                            )}
                                            {/* ── WHO STARTED IT, MARKED ────────────────
                                                "The client asked for a quote" and "created
                                                by you" are different events: one is demand
                                                arriving on its own, the other is the owner
                                                recording something already agreed. In one
                                                grey sentence they read the same.

                                                The client's half is tinted, the owner's
                                                stays quiet — so a list of jobs shows at a
                                                glance which ones came IN. */}
                                            {step.metadata?.origin ? (
                                              <span
                                                className={
                                                  step.metadata?.originBy === 'client'
                                                    ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                                    : 'text-[var(--v2-text-muted)]'
                                                }
                                              >
                                                {String(step.metadata.origin)}
                                                {cardFact ? ' · ' : ''}
                                              </span>
                                            ) : null}
                                            {isProposalStep ? (
                                              quoteAnswered ? null : (
                                                <span className="tabular-nums">{cardFact}</span>
                                              )
                                            ) : showsPaymentAccount || showsEmailOutcome || showsPaymentStages ? null : (
                                              cardFact
                                            )}
                                          </span>
                                        )}

                                        {/*
                                          WHAT HAPPENED TO THE CONFIRMATION, then what it
                                          said.
                                          ──────────────────────────────────────────────────
                                          Two lines where there was one sentence. The first
                                          is the owner's: the mail was sent to the client,
                                          and this is how far it got. The second is the
                                          client's, quoted — so "your meeting has been
                                          confirmed" stops being a claim this card is making
                                          and becomes a record of what was in their inbox.
                                        */}
                                        {(() => {
                                          if (!showsEmailOutcome) return null;

                                          const meta = step.metadata ?? {};
                                          const emailStatus = meta.emailStatus as string | undefined;
                                          const hasRecord = Boolean(meta.hasRecord);

                                          /*
                                            FURTHEST POINT REACHED, not the stored status.
                                            `delivered` and `opened` arrive as timestamps
                                            from the provider webhook while the row's status
                                            stays `'sent'` — so reading `status` alone would
                                            report "sent" for mail the client has opened, and
                                            the one signal an owner actually wants would
                                            never appear.
                                          */
                                          const reached = !hasRecord
                                            ? null
                                            : meta.openedAt
                                              ? 'opened'
                                              : meta.deliveredAt
                                                ? 'delivered'
                                                : emailStatus;

                                          /* Terminal failures. A bounce and a spam report
                                             are the whole reason this step is worth a row. */
                                          const failed =
                                            reached === 'bounced' ||
                                            reached === 'complained' ||
                                            reached === 'failed';

                                          const tone = !hasRecord
                                            ? 'var(--v2-text-muted)'
                                            : failed
                                              ? '#B54708'
                                              : reached === 'opened'
                                                ? '#22C58B'
                                                : reached === 'pending'
                                                  ? 'var(--v2-border)'
                                                  : '#22C58B';

                                          /*
                                            ONLY SAY SOMETHING THE PREFIX HAS NOT.
                                            ──────────────────────────────────────
                                            "מייל נשלח" already means sent, so appending
                                            the stored status produced "sent · sent" on
                                            every message the provider had not yet
                                            confirmed — which was most of them, and read
                                            as a stutter rather than a state.

                                            Two bookings minutes apart showed "sent · sent"
                                            and "sent · delivered", and the difference
                                            looked like a bug in the data when it was only
                                            this line repeating itself.

                                            So `sent` adds nothing and is dropped. What
                                            survives is the half the prefix cannot say:
                                            it arrived, it was opened, it came back.
                                          */
                                          const adds = reached && reached !== 'sent' ? reached : null;

                                          /*
                                            Two states are not "sent, and then something".
                                            `pending` has not left the platform yet and
                                            `failed` never did, so leading either with
                                            "Email sent" would assert the one thing that
                                            did not happen.
                                          */
                                          const standsAlone = adds === 'pending' || adds === 'failed';

                                          const outcome = !hasRecord
                                            ? t('crm.email.no_record') || 'No send recorded'
                                            : standsAlone
                                              ? t(`crm.email.status.${adds}`) || String(adds)
                                              : `${t('crm.booking.email_sent') || 'Email sent'}${
                                                  adds
                                                    ? ` · ${t(`crm.email.status.${adds}`) || adds}`
                                                    : ''
                                                }`;

                                          return (
                                            /* ── ONE ROW: THE OUTCOME AND WHAT WAS SENT ──
                                               The subject sat on its own line beneath
                                               "מייל נשלח", so a step that reports one event
                                               — an email went out — spent three lines
                                               saying it: the stage name, the outcome, then
                                               the subject.

                                               They are one fact. `flex-wrap` keeps the
                                               subject beside the outcome and lets it drop
                                               only when the drawer is too narrow to hold
                                               both, rather than always. */
                                            <div
                                              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                                              style={{ gridColumn: 1 }}
                                            >
                                              <span className="flex items-center gap-2">
                                                <span
                                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                  style={{ background: tone }}
                                                  aria-hidden="true"
                                                />
                                                <span
                                                  className="text-[12.5px] leading-[1.5]"
                                                  style={{
                                                    color: failed
                                                      ? '#B54708'
                                                      : 'var(--v2-text-primary)',
                                                  }}
                                                >
                                                  {outcome}
                                                </span>
                                              </span>

                                              {/* The subject, quoted and demoted. `bdi` so a
                                                  Hebrew subject beside Latin punctuation is
                                                  not reordered into nonsense. */}
                                              {step.details && (
                                                <span
                                                  className="text-[12px] leading-[1.5] break-words min-w-0"
                                                  style={{ color: 'var(--v2-text-muted)' }}
                                                >
                                                  <bdi>{`„${step.details}”`}</bdi>
                                                </span>
                                              )}
                                            </div>
                                          );
                                        })()}

                                        {/* Supporting detail — a plan's terms,
                                            the answer count — under the fact. */}

                                        {/* What is happening to the quote.
                                            ───────────────────────────────────
                                            Rendered unless the account below says it
                                            already. Once a quote is agreed, its own row
                                            carries the state and the amount together —
                                            "אושרה ₪450.00, 1 באוק׳" — so this line
                                            repeated the word a few pixels above the row
                                            that owns it, under a figure the strip had
                                            already named as the total.

                                            Still the content for every OTHER state: a
                                            quote sent, viewed, declined or expired has no
                                            account block and no accepted row, and before
                                            one exists this line IS the card. */}
                                        {isProposalStep && !quoteAnswered && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)] break-words"
                                            style={{ gridColumn: 1 }}
                                          >
                                            {step.metadata?.waitingOn === 'closed'
                                              ? t('crm.proposal.closed')
                                              : step.metadata?.waitingOn === 'meeting'
                                              ? `${t('crm.proposal.after_meeting')} ${step.metadata?.meetingAt ?? ''}`.trim()
                                              /* Its time has passed and nobody has
                                                 said what happened. The line asks
                                                 instead of naming a price the owner
                                                 may not owe. */
                                              : step.metadata?.waitingOn === 'unmarked'
                                              ? t('crm.proposal.ask_happened')
                                              /* Missed, and still alive: a client who
                                                 did not turn up often still wants a
                                                 price. */
                                              : step.metadata?.waitingOn === 'noshow'
                                              ? t('crm.proposal.after_missed')
                                              : step.metadata?.proposalStatus === 'accepted'
                                                ? t('crm.proposal.accepted')
                                                : step.metadata?.proposalStatus === 'declined'
                                                  ? /* Why, not just that.
                                                       "The quote was declined"
                                                       is a dead end; "they said
                                                       the price was too high" is
                                                       the sentence the next
                                                       quote is written against,
                                                       and it is the only thing
                                                       the client actually told
                                                       you. */
                                                    [
                                                      t('crm.proposal.declined'),
                                                      step.metadata?.declineReason
                                                        ? t(`proposal.decline.reason.${step.metadata.declineReason}`)
                                                        : null,
                                                    ]
                                                      .filter(Boolean)
                                                      /* A colon, not a dash: the
                                                         reason explains the
                                                         refusal rather than
                                                         standing beside it, and
                                                         the dash is not ours to
                                                         put in front of an
                                                         owner. */
                                                      .join(': ')
                                                  : step.metadata?.proposalStatus === 'expired'
                                                    ? t('crm.proposal.expired')
                                                    : step.metadata?.proposalStatus === 'viewed'
                                                      ? t('crm.proposal.viewed')
                                                      : step.metadata?.waitingOn === 'owner'
                                                        ? booking.proposal_continues === false
                                                          /* They said it is not coming. The
                                                             line must not go on calling it
                                                             their move. */
                                                          ? t('crm.proposal.not_continuing')
                                                          : t('crm.proposal.waiting_on_you')
                                                        : t('crm.proposal.waiting_on_client')}
                                          </span>
                                        )}

                                        {/*
                                          The negotiation, when there was one.
                                          ─────────────────────────────────────
                                          Only from the second version onwards.
                                          A single quote is already fully
                                          described by the two lines above it,
                                          and listing it again under itself is
                                          noise; two or more versions is a
                                          NEGOTIATION, and then the first number
                                          is the reason the second one exists.

                                          Read newest-first, matching the strip
                                          above, and each row is one sentence:
                                          how much, what happened, when.
                                        */}
                                        {/*
                                          Shown from the FIRST version, not the second.
                                          ─────────────────────────────────────────────
                                          It began as a history, which only earns its
                                          place once there are two. It is now also the
                                          way to open a quote — so hiding it for a
                                          single one left that quote unreadable, which
                                          is what the separate "View quote" button used
                                          to cover before it was removed as a second
                                          door to the same place.
                                        */}
                                        {isProposalStep &&
                                          proposalVersions.length > 0 && (
                                            <div
                                              className="mt-2 flex flex-col gap-px overflow-hidden"
                                              style={{
                                                gridColumn: 1,
                                                borderRadius: '10px',
                                                border: '1px solid var(--v2-border)',
                                              }}
                                            >
                                              {proposalVersions.map(version => {
                                                const tone = VERSION_TONES[version.status] ?? VERSION_TONES.sent;

                                                return (
                                                  <div
                                                    key={version.id}
                                                    className="px-2.5 py-2"
                                                    style={{
                                                      background: version.isCurrent
                                                        ? 'var(--v2-surface-hover, rgba(127,127,127,0.06))'
                                                        : 'transparent',
                                                    }}
                                                  >
                                                  {/*
                                                    Every version opens, whatever became of it.
                                                    ─────────────────────────────────────────
                                                    The strip could already SHOW the history and
                                                    not open it: only the current version had a
                                                    button, so the number a client refused was
                                                    listed and unreadable. A declined quote is
                                                    the one worth reading — it records what was
                                                    offered and at what price it was refused,
                                                    which is the only place that is written down.

                                                    A button rather than a clickable div so it is
                                                    reachable by keyboard, and the INNER line only:
                                                    the decline note below is a paragraph, which
                                                    cannot legally sit inside a button.
                                                  */}
                                                  <button
                                                    type="button"
                                                    onClick={e => {
                                                      e.stopPropagation();
                                                      onViewProposal?.(booking.id, version.id);
                                                    }}
                                                    className="flex w-full items-center gap-2 text-start hover:opacity-80 transition-opacity"
                                                    title={t('crm.proposal.view') || 'View quote'}
                                                  >
                                                    {/* A dot, not a coloured pill per row —
                                                        five stacked pills read as an alert
                                                        panel rather than a history. */}
                                                    <span
                                                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                      style={{ background: tone.dot }}
                                                      aria-hidden="true"
                                                    />

                                                    <span
                                                      className="text-[12.5px] font-medium tabular-nums"
                                                      style={{
                                                        color: 'var(--v2-text-primary)',
                                                        // A replaced price is struck through: it
                                                        // is the clearest way to say "this number
                                                        // is no longer on the table".
                                                        textDecoration:
                                                          version.status === 'superseded'
                                                            ? 'line-through'
                                                            : undefined,
                                                        opacity: version.status === 'superseded' ? 0.65 : 1,
                                                      }}
                                                    >
                                                      {version.amount}
                                                    </span>

                                                    <span
                                                      className="text-[12px]"
                                                      style={{ color: tone.text }}
                                                    >
                                                      {t(`crm.proposal.hist.${version.status}`)}
                                                    </span>

                                                    {/* The document this version
                                                        was sent with. Named, not
                                                        just flagged — a revision
                                                        usually carries a different
                                                        file, and "which one did
                                                        they agree to" is the whole
                                                        question later. */}
                                                    {version.documentName && (
                                                      <span
                                                        className="flex min-w-0 items-center gap-1 text-[11.5px]"
                                                        style={{ color: 'var(--v2-text-muted)' }}
                                                        title={version.documentName}
                                                      >
                                                        <Paperclip className="h-3 w-3 shrink-0" />
                                                        <span className="truncate max-w-[110px]">
                                                          {version.documentName}
                                                        </span>
                                                      </span>
                                                    )}

                                                    <span
                                                      className="justify-self-end whitespace-nowrap text-[11.5px] tabular-nums"
                                                      style={{ color: 'var(--v2-text-muted)' }}
                                                    >
                                                      {version.at ? formatShortDate(version.at) : ''}
                                                    </span>
                                                  </button>

                                                  {/* What the client said, under
                                                      the version they said it
                                                      about. Their typed note
                                                      wins over the category:
                                                      "we only have 8k budget"
                                                      is worth more than "too
                                                      expensive". */}
                                                  {/* Why it was stopped, read the same way
                                                      a decline is. A row that says only
                                                      "stopped part-way" leaves the owner to
                                                      remember which of six reasons it was —
                                                      and the reason is the whole point of
                                                      having collected it.

                                                      SHOWN ON THE DATA, NOT THE STATUS.
                                                      ──────────────────────────────────
                                                      Both of these were gated on
                                                      `version.status`, and a status does not
                                                      survive a revision: `markSuperseded`
                                                      rewrites every row in
                                                      ('sent','viewed','declined') to
                                                      'superseded'.

                                                      So a client declined at ₪10,000 saying
                                                      why, the owner sent a revised quote, and
                                                      that row went from carrying the reason
                                                      to reading "הוחלפה" and a date. The
                                                      answer was never deleted — only the
                                                      condition that printed it — and it is
                                                      the single most useful thing on a
                                                      superseded row, because it is why the
                                                      revision exists.

                                                      A reason is a fact about what happened
                                                      to that version. Whatever happens to it
                                                      afterwards does not unmake it. */}
                                                  {(version.stopReason || version.stopNote) && (
                                                      <p
                                                        className="mt-1 ps-3.5 text-[11.5px] leading-[1.45]"
                                                        style={{ color: 'var(--v2-text-muted)' }}
                                                      >
                                                        {version.stopReason
                                                          ? t(cancelReasonKey(version.stopReason))
                                                          : null}
                                                        {version.stopNote ? (
                                                          <span
                                                            className="block italic"
                                                            style={{ color: 'var(--v2-text-secondary)' }}
                                                          >
                                                            “{version.stopNote}”
                                                          </span>
                                                        ) : null}
                                                      </p>
                                                    )}

                                                  {(version.declineReason || version.declineNote) && (
                                                      <p
                                                        className="mt-1 ps-3.5 text-[11.5px] leading-[1.45]"
                                                        style={{ color: 'var(--v2-text-muted)' }}
                                                      >
                                                        {version.declineReason
                                                          ? t(`proposal.decline.reason.${version.declineReason}`)
                                                          : null}
                                                        {version.declineNote ? (
                                                          <span
                                                            className="block italic"
                                                            style={{ color: 'var(--v2-text-secondary)' }}
                                                          >
                                                            “{version.declineNote}”
                                                          </span>
                                                        ) : null}
                                                      </p>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}

                                        {/* Only a PLAN's terms — "₪333.33 · 1 of 3 ·
                                            monthly" — which the receipt above cannot
                                            express. For an ordinary payment
                                            `step.details` is the amount itself, so
                                            this printed the figure a second time
                                            under the block that just totalled it. */}

                                        {/*
                                          The milestones, and the one action
                                          that moves them.
                                          ─────────────────────────────────────
                                          A uniform instalment plan needs no
                                          list — "1 of 3 · monthly" says
                                          everything. Milestones are the
                                          opposite: each has its own name, its
                                          own amount, and most wait on the owner
                                          to say the work happened. That last
                                          part is the whole reason this renders.
                                        */}
                                        {isPaymentStep && payment?.plan?.stages?.length ? (
                                          <div className="mt-2 flex flex-col gap-2" style={{ gridColumn: 1 }}>
                                            {/*
                                              What the whole job is worth, before the
                                              stages that make it up.

                                              The list alone says a deposit was paid
                                              and something else is invoiced; it does
                                              not say whether the business is half
                                              collected or finished. Shared with the
                                              payment dialog so both name the same
                                              three figures.
                                            */}
                                            <PaymentPlanTotals
                                              stages={payment.plan.stages}
                                              currency={payment.currency}
                                              totalAmount={payment.plan.totalAmount}
                                              locale={isRTL ? 'he-IL' : 'en-US'}
                                              size="compact"
                                              /* Summed across the stages, because each
                                                 milestone raises its own invoice and a
                                                 refund attaches to whichever one was paid.
                                                 With money returned the middle pair becomes
                                                 returned/kept — collected and outstanding
                                                 describe a settled payment and say nothing
                                                 about what went back. */
                                              refunded={refunded}
                                              labels={{
                                                total: t('crm.payment.total') || 'Total',
                                                collected: t('crm.payment.collected') || 'Collected',
                                                outstanding: t('crm.payment.outstanding') || 'Outstanding',
                                                // Only rendered when a period has actually been called off.
                                                cancelled: t('payments.plan.status.cancelled') || 'Stopped',
                                                refunded: t('crm.journey.returned') || 'Refunded',
                                                kept: t('crm.journey.kept') || 'You keep',
                                              }}
                                            />

                                          <div
                                            /* NO `overflow-hidden`: each row carries a ⋯ menu
                                               positioned absolutely, and a clipping ancestor
                                               clips the menu too — it rendered cut off, with
                                               options the owner could not reach. The rows have
                                               no background of their own, so the radius had
                                               nothing to clip anyway. Same fix, same reason, as
                                               the meetings list above. */
                                            className="flex flex-col gap-px"
                                            style={{
                                              borderRadius: '10px',
                                              border: '1px solid var(--v2-border)',
                                            }}
                                          >
                                            {payment.plan.stages.map((stage, i) => {
                                              const paid = stage.status === 'paid';
                                              /*
                                                A STOPPED PERIOD IS NOT AN UPCOMING ONE.
                                                ─────────────────────────────────────
                                                Everything below keyed off paid / billed /
                                                neither, so a period that had been deliberately
                                                called off fell into "neither" and drew exactly
                                                like one still to come — grey dot, live amount,
                                                its old due date. Stopping a plan changed nothing
                                                the owner could see.
                                              */
                                              const stopped = stage.status === 'cancelled';
                                              const billed = Boolean(stage.invoiceId) && !paid && !stopped;
                                              // Only a manual stage that has not
                                              // been billed can be completed. A
                                              // dated one bills itself.
                                              const canComplete =
                                                !paid &&
                                                !stopped &&
                                                !billed &&
                                                stage.trigger === 'manual' &&
                                                Boolean(onCompleteStage) &&
                                                !settledStatus;

                                              const money = (value: number) =>
                                                new Intl.NumberFormat(isRTL ? 'he-IL' : 'en-US', {
                                                  style: 'currency',
                                                  currency: payment.currency,
                                                  maximumFractionDigits: value % 1 === 0 ? 0 : 2,
                                                }).format(value);

                                              const stageRefunded = Number(stage.refundedAmount || 0);

                                              /**
                                                Every shekel of this stage went back.
                                                ─────────────────────────────────────
                                                Separate from "was refunded at all": a
                                                partial refund leaves the business holding
                                                money, so the stage is still a collection
                                                that stood. Only a full return changes what
                                                the row MEANS.
                                              */
                                              const fullyReturned =
                                                stageRefunded > 0 && stageRefunded >= stage.amount;

                                              /*
                                                THE FIGURE IS WHAT THE CLIENT PAID.
                                                ───────────────────────────────────
                                                Briefly it was the net, and that misstated the
                                                event: the row reads "₪X שולם 7 באוק׳", so a
                                                net figure there says the client paid ₪2,250 on
                                                the 7th when they paid ₪4,500. What happened
                                                afterwards does not change what was paid, and
                                                this line is about the payment.

                                                The refund is its own event and gets its own
                                                line below — how much went back, and how much
                                                stayed. Three facts, each where it belongs,
                                                instead of five on one line.
                                              */
                                              const amountText = money(stage.amount);

                                              return (
                                                <div
                                                  key={stage.id}
                                                  className="flex flex-col gap-0.5 px-2.5 py-2"
                                                >
                                                  <div className="flex items-center gap-2">
                                                  {/*
                                                    GREEN MEANS THE BUSINESS KEPT IT.
                                                    ───────────────────────────────────
                                                    A refunded stage still carries
                                                    `status: 'paid'` — correctly, because it
                                                    WAS paid, and the refund is recorded
                                                    against the invoice rather than the
                                                    schedule. So the dot read green on a job
                                                    whose every shekel had gone back, directly
                                                    above a line saying so.

                                                    Orange, matching the "Refunded" badge on
                                                    the card and the returned cell in the
                                                    totals strip, so one event has one colour
                                                    wherever it appears. Deliberately not red:
                                                    `PaymentInvoiceList` settled that — "a
                                                    refund is a completed, deliberate act, not
                                                    a failure like an overdue invoice".

                                                    Only when ALL of it went back. A partial
                                                    refund leaves money with the business, and
                                                    the breakdown line underneath is what says
                                                    how much.
                                                  */}
                                                  <span
                                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                    style={{
                                                      background: fullyReturned
                                                        ? REFUND_HEX.full
                                                        : paid
                                                          ? '#22C58B'
                                                          : stopped
                                                            ? '#B54708'
                                                            : billed
                                                              ? '#F79009'
                                                              : 'var(--v2-border)',
                                                    }}
                                                    aria-hidden="true"
                                                  />

                                                  <span
                                                    className="text-[12.5px] truncate"
                                                    style={{ color: 'var(--v2-text-primary)' }}
                                                  >
                                                    {stage.label || `${i + 1}`}
                                                  </span>

                                                  <span
                                                    className="text-[12.5px] font-medium tabular-nums"
                                                    style={{
                                                      color: 'var(--v2-text-secondary)',
                                                      // Struck through, because this amount is
                                                      // never going to be collected.
                                                      textDecoration: stopped ? 'line-through' : undefined,
                                                    }}
                                                  >
                                                    {amountText}
                                                  </span>

                                                  {/*
                                                    WHEN, not just how much.
                                                    ───────────────────────────
                                                    A row saying a stage is paid
                                                    and never when is the wrong
                                                    half of the answer for anyone
                                                    reconciling a statement; an
                                                    invoiced one with no date does
                                                    not say whether it is late.
                                                    Both dates are already on the
                                                    stage. On the business's clock,
                                                    like every other time here.
                                                  */}
                                                  {(stage.paidAt || stage.dueDate) && (
                                                    <span
                                                      className="text-[11.5px] tabular-nums whitespace-nowrap"
                                                      style={{ color: 'var(--v2-text-muted)' }}
                                                    >
                                                      {/* "שולם 7 באוק׳" — one fact where there
                                                          were two. The word used to sit alone at
                                                          the end of the row, repeating a claim the
                                                          green dot had already made at its start. */}
                                                      {/* Every date in this block carries the
                                                          year. They are read against each other
                                                          — paid, due, refunded — and a stage
                                                          settled in one year and returned in the
                                                          next is exactly when the reader needs
                                                          it most. */}
                                                      {paid && stage.paidAt
                                                        ? `${t('crm.stage.paid')} ${stageDate(stage.paidAt, true)}`
                                                        : stopped
                                                          // Its old due date is no longer a fact
                                                          // about this period — saying "due 7 Oct"
                                                          // of something called off is the whole
                                                          // confusion this fixes.
                                                          ? t('payments.plan.status.cancelled')
                                                        : stage.dueDate
                                                          ? `${t('crm.payment.due')} ${stageDate(stage.dueDate, true)}`
                                                          : ''}
                                                    </span>
                                                  )}

                                                  <span className="ms-auto shrink-0">
                                                    {paid ? (
                                                      /* Nothing: the date beside the amount reads
                                                         "שולם 7 באוק׳" and the dot is green. A
                                                         third statement of the same fact is what
                                                         made the row crowded. */
                                                      null
                                                    ) : stopped ? (
                                                      /*
                                                        Before every other test, because a stopped
                                                        period is stopped whether or not it was
                                                        billed first.
                                                        ─────────────────────────────────────────
                                                        This chain ended in a bare else that said
                                                        "Scheduled", so anything not paid, not
                                                        billed and not completable claimed to be
                                                        upcoming — a cancelled period included.
                                                        The owner stopped the plan and the row
                                                        still said it was on its way.
                                                      */
                                                      <span
                                                        className="text-[11.5px]"
                                                        style={{ color: '#B54708' }}
                                                      >
                                                        {t('payments.plan.status.cancelled')}
                                                      </span>
                                                    ) : billed ? (
                                                      <span
                                                        className="text-[11.5px]"
                                                        style={{ color: '#B54708' }}
                                                      >
                                                        {t('crm.stage.awaiting_payment')}
                                                      </span>
                                                    ) : canComplete ? (
                                                      <button
                                                        type="button"
                                                        onClick={e => {
                                                          e.stopPropagation();
                                                          onCompleteStage?.(
                                                            stage.id,
                                                            stage.label || `${i + 1}`,
                                                            amountText
                                                          );
                                                        }}
                                                        className="rounded-full border border-[var(--v2-border)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--v2-text-secondary)] transition-colors hover:border-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                                                      >
                                                        {t('crm.stage.mark_done')}
                                                      </button>
                                                    ) : (
                                                      <span
                                                        className="text-[11.5px]"
                                                        style={{ color: 'var(--v2-text-muted)' }}
                                                      >
                                                        {t('crm.stage.scheduled')}
                                                      </span>
                                                    )}
                                                  </span>

                                                  {/*
                                                    Receipt and refund, behind one control.
                                                    ───────────────────────────────────────
                                                    They were two buttons in the middle of the
                                                    row, and on a line whose job is to report
                                                    money they were the loudest marks on it.
                                                    The figures are what a payment row is for.

                                                    Nothing is removed — both live in the menu,
                                                    which is where the meetings list already
                                                    puts its secondary actions, so one gesture
                                                    means the same thing in both places.
                                                  */}
                                                  <StageRowActions
                                                    invoiceId={stage.invoiceId}
                                                    /* An instalment period has no invoice; its
                                                       money is a processor charge. Refund needs
                                                       one key or the other. */
                                                    transactionId={stage.transactionId}
                                                    paid={paid}
                                                    stopped={stopped}
                                                    refunded={stageRefunded}
                                                    remaining={
                                                      stage.amount - Number(stage.refundedAmount || 0)
                                                    }
                                                    sending={sendingInvoiceBookingId === booking.id}
                                                    onSendDocument={
                                                      onSendInvoice
                                                        ? () =>
                                                            handleSendInvoice(
                                                              stage.invoiceId as string,
                                                              booking.id
                                                            )
                                                        : undefined
                                                    }
                                                    onResendRefundEmail={
                                                      onResendRefundEmail && stage.invoiceId
                                                        ? () =>
                                                            onResendRefundEmail(
                                                              stage.invoiceId as string,
                                                              booking.id
                                                            )
                                                        : undefined
                                                    }
                                                    onRefund={
                                                      onRefundStage
                                                        ? () =>
                                                            onRefundStage({
                                                              invoiceId: stage.invoiceId,
                                                              transactionId: stage.transactionId ?? null,
                                                              amount: stage.amount,
                                                              refunded: Number(stage.refundedAmount || 0),
                                                              currency: payment!.currency,
                                                              label: stage.label || `${i + 1}`,
                                                            })
                                                        : undefined
                                                    }
                                                    t={t}
                                                  />
                                                  </div>

                                                  {/*
                                                    WHAT BECAME OF IT, under what was paid.
                                                    ───────────────────────────────────────
                                                    "הוחזר ₪2,250 · נותר אצלכם ₪2,250 · 7 באוק׳".
                                                    The row above states the payment; this states
                                                    the refund and what survived it — the two
                                                    figures an owner actually weighs, in the same
                                                    words the strip uses for them.

                                                    Only on a stage that was actually refunded.
                                                    `padding-inline-start` clears the dot, so the
                                                    line hangs under the label rather than under
                                                    the bullet.
                                                  */}
                                                  {stageRefunded > 0 && (
                                                    <span
                                                      /* Muted, deliberately: the figure that
                                                         carries the colour is the TOTAL above,
                                                         and a red line under every stage as
                                                         well would leave the card shouting the
                                                         same fact three times. */
                                                      className="text-[11.5px] tabular-nums"
                                                      style={{
                                                        color: 'var(--v2-text-muted)',
                                                        paddingInlineStart: '14px',
                                                      }}
                                                    >
                                                      {/* `bdi` around the whole line: it mixes two
                                                          left-to-right currency runs into a
                                                          right-to-left sentence, and left loose in
                                                          the row the bidi algorithm reorders the
                                                          neutrals between them. Isolated, the
                                                          sentence resolves on its own terms. */}
                                                      <bdi>
                                                        {(t('crm.stage.refund_breakdown') ||
                                                          '{refunded} refunded · {kept} kept')
                                                          .replace('{refunded}', money(stageRefunded))
                                                          .replace(
                                                            '{kept}',
                                                            money(Math.max(stage.amount - stageRefunded, 0))
                                                          )}
                                                        {/*
                                                          Same format as the paid date directly
                                                          above it. This asked for the year and
                                                          that one does not, so a stage paid and
                                                          refunded on one day read "9 באוק׳" on
                                                          one line and "9 באוק׳ 2026" on the
                                                          next — two spellings of the same date,
                                                          8px apart.
                                                        */}
                                                        {stage.refundedAt
                                                          ? ` · ${stageDate(stage.refundedAt, true)}`
                                                          : ''}
                                                      </bdi>
                                                    </span>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                          </div>
                                        ) : null}

                                        {/*
                                          THE SAME ROW, for a booking sold as one payment.
                                          ─────────────────────────────────────────────────
                                          A quote or a plan lists its stages above, each with
                                          a dot, an amount and a date, so an owner can see at
                                          a glance which parts are settled. An ordinary
                                          service got none of that: its payment step printed
                                          a bare "₪300.00" and two buttons, and said nothing
                                          about whether the ₪300 had ever arrived. The one
                                          question the step exists to answer was the one it
                                          did not answer.

                                          One payment is one row. Deliberately NOT
                                          `PaymentPlanTotals` as well — Total, Collected and
                                          Outstanding are three lines restating a single
                                          figure when there is only one payment, and the row
                                          already carries all three facts.

                                          Not shown when a refund has happened: `showAccount`
                                          then draws the full charged / returned / kept
                                          ledger just above, which answers more than this
                                          row would and would otherwise say "Paid" directly
                                          beneath a line explaining the money went back.
                                        */}
                                        {(() => {
                                          // Every gate lives in `showsPaymentAccount`, because
                                          // the fact line above is suppressed on exactly the
                                          // steps this renders on. Two copies of the
                                          // condition would eventually disagree and leave a
                                          // card with neither.
                                          if (!showsPaymentAccount || !payment) return null;

                                          /*
                                            `refunded` status counts as paid HERE: the money
                                            did arrive, and the refund that followed is the
                                            chip's business, not this row's. Saying "not paid"
                                            of a payment that was taken and returned would be
                                            a third story about the same money.
                                          */
                                          const isPaid =
                                            payment.status === 'paid' || payment.status === 'refunded';

                                          /*
                                            THE REQUEST WAS CALLED OFF.
                                            ───────────────────────────
                                            A cancelled booking nobody paid for: the invoice
                                            was voided with it, so this money is never
                                            arriving and was never chased.

                                            It has to be tested BEFORE overdue, because the
                                            step's own detail line called it overdue —
                                            "₪300.00 (באיחור)" sitting directly above a chip
                                            reading "payment request cancelled". `isOverdue`
                                            upstream is only `status === 'pending'` and a due
                                            date in the past, and voiding an invoice leaves
                                            both of those true. The card contradicted itself.

                                            Stopped money is not late money. It is money
                                            given up on, which the strip already has a cell
                                            and a colour for.
                                          */
                                          const isStopped = cancelledUnpaid;
                                          const isOverdue =
                                            !isPaid && !isStopped && payment.invoiceStatus === 'overdue';
                                          const isBilled =
                                            !isPaid && !isStopped && !isOverdue && Boolean(payment.invoiceId);

                                          /*
                                            A PLAN WHOSE SCHEDULE IS NOT WRITTEN YET.
                                            ─────────────────────────────────────────
                                            `stages` is omitted until the processor confirms,
                                            so this booking fell between both branches and
                                            showed no account at all — in the one window where
                                            an owner is most likely checking whether the sale
                                            went through.

                                            It gets the totals and NOT a list. The periods do
                                            not exist yet, and drawing projected rows with
                                            invented dates would have the drawer assert a
                                            schedule nobody has agreed to. The three figures
                                            are real: the agreement's total, what the mirror
                                            says is collected, and the difference.
                                          */
                                          const plan = payment.plan;

                                          /*
                                            The totals strip is `PaymentPlanTotals`, the same
                                            component the staged branch uses — fed stages it
                                            synthesises rather than a second set of sums.
                                            Two renderers for one strip is how the card and
                                            the dialog came to print different totals for one
                                            job, which is the bug that component exists to
                                            end.
                                          */
                                          const totalsStages = plan
                                            ? Array.from({ length: Math.max(plan.installmentCount, 1) }, (_, i) => ({
                                                amount: plan.installmentAmount,
                                                // Only what the mirror has confirmed. Unknown
                                                // (`undefined`) must not round up to "paid".
                                                status: i < (plan.periodsPaid ?? 0) ? 'paid' : 'pending',
                                              }))
                                            : [
                                                {
                                                  amount: charged,
                                                  /*
                                                    `cancelled` puts the figure in the
                                                    strip's Stopped cell, where it reads as
                                                    money given up on rather than money
                                                    still owed. Left `pending` it would be
                                                    counted as outstanding and the card
                                                    would ask the owner to collect it.
                                                  */
                                                  status: isStopped
                                                    ? 'cancelled'
                                                    : isPaid
                                                      ? 'paid'
                                                      : 'pending',
                                                },
                                              ];

                                          /*
                                            The same four colours the stage rows use, in the
                                            same order of seriousness. Read down a drawer of
                                            mixed bookings, a green dot has to mean the same
                                            thing on a quoted job and on a single service.
                                          */
                                          const dot = isPaid
                                            ? '#22C58B'
                                            : isStopped || isOverdue
                                              ? '#B54708'
                                              : isBilled
                                                ? '#F79009'
                                                : 'var(--v2-border)';

                                          /*
                                            When, not just whether — the same halves the stage
                                            rows carry. `stageDate` is reused rather than
                                            re-formatted here because it already knows that
                                            `paidAt` is an instant and `invoiceDueDate` is a
                                            bare DATE, and that reading the second one in a
                                            zone behind UTC moves an invoice to the day before
                                            it existed.
                                          */
                                          const when = isPaid
                                            ? payment.paidAt
                                              ? `${t('crm.journey.paid_on')} ${stageDate(payment.paidAt, true)}`
                                              : /*
                                                  THE WORD ALONE, when no date was recorded.
                                                  ──────────────────────────────────────────
                                                  `paidAt` comes from the invoice's `paid_at`
                                                  or a settled transaction's, and neither is
                                                  guaranteed: an invoice can carry
                                                  `status: 'paid'` with `paid_at` still null,
                                                  which is the same status-versus-ledger split
                                                  that has bitten the chasers.

                                                  Returning '' here meant the row did not
                                                  render at all, so a PAID booking showed a
                                                  totals strip and nothing else — no date, and
                                                  no statement that it had been paid either.
                                                  The missing date became a missing fact.

                                                  A date is not invented to fill the gap. The
                                                  row says what is known and stops.
                                                */
                                                t('crm.journey.paid_on')
                                            : isStopped
                                              ? /*
                                                  NO DUE DATE on a request that was called
                                                  off. "Due 7 Oct" of something nobody will
                                                  ever be asked for is the same confusion a
                                                  stopped plan period had, and the chip
                                                  beside this already says the request was
                                                  cancelled. The Stopped cell carries the
                                                  figure; there is nothing left to date.
                                                */
                                                ''
                                              : payment.invoiceDueDate
                                                ? `${t('crm.payment.due')} ${stageDate(payment.invoiceDueDate, true)}`
                                                : '';

                                          /*
                                            BOTH DATES, because a refund is two events.
                                            ───────────────────────────────────────────
                                            The old ledger carried the refund's date and
                                            not the payment's, so a card could say money
                                            came back on the 29th without ever saying when
                                            it arrived. They are separate facts and an
                                            owner reconciling a statement needs both.

                                            A line each rather than one line carrying two
                                            dates: the dots then read down the card in the
                                            order the money actually moved.
                                          */
                                          const lines = [
                                            { key: 'state', dot, text: when },
                                            ...(refunded > 0 && payment.refundedAt
                                              ? [
                                                  {
                                                    key: 'refund',
                                                    dot: '#F79009',
                                                    text: `${t('crm.journey.returned')} ${stageDate(payment.refundedAt, true)}`,
                                                  },
                                                ]
                                              : []),
                                          ].filter(line => line.text);

                                          /*
                                            A plan shows the refund and nothing else.
                                            ────────────────────────────────────────
                                            Its periods do not exist yet, so a state line
                                            would be a projection — the reason rows are
                                            withheld from a plan at all. A refund is not a
                                            projection: it is a thing that happened, on a
                                            date the row can name. Dropping it with the
                                            rest would lose a fact the old ledger showed.
                                          */
                                          const visibleLines = plan
                                            ? lines.filter(line => line.key === 'refund')
                                            : lines;

                                          return (
                                            <div
                                              className="mt-2 flex flex-col gap-2"
                                              style={{ gridColumn: 1 }}
                                            >
                                              {/* What the whole thing is worth, before the
                                                  payment that makes it up — the same three
                                                  figures, in the same strip, that a quoted
                                                  job shows above its stages. */}
                                              <PaymentPlanTotals
                                                stages={totalsStages}
                                                currency={payment.currency}
                                                totalAmount={plan ? plan.totalAmount : charged}
                                                locale={isRTL ? 'he-IL' : 'en-US'}
                                                size="compact"
                                                /* Late is a different fact from merely owed,
                                                   and the strip says so in red rather than
                                                   amber when the invoice has gone overdue. */
                                                overdue={isOverdue}
                                                overdueLabel={t('crm.payment.overdue') || 'Overdue'}
                                                /* Money handed back turns the middle pair
                                                   into returned/kept — see the component.
                                                   The same two words the old ledger used,
                                                   so nothing is renamed on the way. */
                                                refunded={refunded}
                                                labels={{
                                                  total: t('crm.payment.total') || 'Total',
                                                  collected: t('crm.payment.collected') || 'Collected',
                                                  outstanding: t('crm.payment.outstanding') || 'Outstanding',
                                                  cancelled: t('payments.plan.status.cancelled') || 'Stopped',
                                                  refunded: t('crm.journey.returned') || 'Refunded',
                                                  kept: t('crm.journey.kept') || 'You keep',
                                                }}
                                              />

                                              {/* The single payment's DATE, and nothing the
                                                  strip has already said.

                                                  It carried the state word and the amount
                                                  too, which put "Outstanding ₪300" directly
                                                  under a strip cell reading "Outstanding
                                                  ₪300". The date is the one fact the three
                                                  figures above cannot express, so it is the
                                                  only one left here — with the dot, which
                                                  states the same thing in no space at all.

                                                  No date, no row: a lone dot is not a line
                                                  worth drawing, and the strip is then the
                                                  whole truth. A plan with no written
                                                  schedule has no row for the same reason —
                                                  its periods do not exist yet. */}
                                              {visibleLines.length > 0 && (
                                              <div
                                                className="flex flex-col gap-px overflow-hidden"
                                                style={{
                                                  borderRadius: '10px',
                                                  border: '1px solid var(--v2-border)',
                                                }}
                                              >
                                                {visibleLines.map(line => (
                                                  <div
                                                    key={line.key}
                                                    className="flex items-center gap-2 px-2.5 py-2"
                                                  >
                                                    <span
                                                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                      style={{ background: line.dot }}
                                                      aria-hidden="true"
                                                    />

                                                    <span
                                                      className="text-[12.5px] tabular-nums"
                                                      style={{ color: 'var(--v2-text-secondary)' }}
                                                    >
                                                      {line.text}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                              )}
                                            </div>
                                          );
                                        })()}


                                        {/* A plan that is no longer running.

                                            A CARD under the table, not a bare line.
                                            As loose text directly above the buttons
                                            it read as a caption for them — a stop
                                            sign sitting over "refund" and "manage
                                            payment". Boxed, it reads as what it is:
                                            a closing statement about the plan the
                                            table above describes.
                                            Only when it has actually ended: an
                                            active plan needs no announcement,
                                            and a line saying so on every plan
                                            would bury the one case that
                                            matters — remaining charges that
                                            will never be taken, on a booking
                                            that otherwise reads as mid-plan. */}
                                        {(() => {
                                          // The PAYMENT step only. Without this it
                                          // rendered under every step in the journey —
                                          // the service, the client details, the
                                          // confirmation — because a plan belongs to
                                          // the booking and every step could see it.
                                          // A plan being stopped is a fact about the
                                          // money, and it belongs beside the money.
                                          const planState = planStates?.[booking.id];
                                          if (!isPaymentStep || !payment?.plan || !planState) return null;
                                          if (planState.status !== 'cancelled') return null;

                                          return (
                                            <div
                                              className="mt-2 flex items-center gap-2 px-3 py-2 text-[12.5px] leading-[1.5] text-orange-600"
                                              style={{
                                                gridColumn: 1,
                                                borderRadius: '10px',
                                                /* The same border and surface as the
                                                   stage table above it, so the two
                                                   read as one block of money rather
                                                   than a table with a stray note. */
                                                border: '1px solid var(--v2-border)',
                                                background: 'var(--v2-surface)',
                                              }}
                                            >
                                              <Ban className="h-3.5 w-3.5 shrink-0" />
                                              <bdi>
                                                {t('payments.plan.status.cancelled')}
                                                {planState.installmentCount > 0 && (
                                                  <span className="text-[var(--v2-text-muted)]">
                                                    {' · '}
                                                    {t('payments.plan.periods_collected')
                                                      .replace('{paid}', String(planState.periodsPaid))
                                                      .replace('{count}', String(planState.installmentCount))}
                                                  </span>
                                                )}
                                              </bdi>
                                            </div>
                                          );
                                        })()}

                                        {/* The hours, under the date they belong to. */}
                                        {scheduleTime && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] tabular-nums text-[var(--v2-text-secondary)]"
                                            style={{ gridColumn: 1 }}
                                          >
                                            {scheduleTime}
                                          </span>
                                        )}

                                        {/* The status, on its own line with the dot every
                                            other list on this card now uses — brown while
                                            nobody has said what happened, green once it is
                                            marked held, muted while it is still ahead. */}
                                        {scheduleDetail && (
                                          <span
                                            className="flex items-center gap-2 text-[12.5px] leading-[1.5]"
                                            style={{
                                              gridColumn: 1,
                                              color: scheduleAwaiting
                                                ? '#B54708'
                                                : 'var(--v2-text-muted)',
                                            }}
                                          >
                                            <span
                                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                                              style={{
                                                background: meetingHeld
                                                  ? '#22C58B'
                                                  : meetingCalledOff
                                                    ? '#F04438'
                                                    : scheduleAwaiting
                                                      ? '#B54708'
                                                      : 'var(--v2-border)',
                                              }}
                                              aria-hidden="true"
                                            />
                                            {scheduleDetail}
                                          </span>
                                        )}

                                        {/*
                                          ── THE MEETING'S HISTORY, AS SENTENCES ─────────
                                          Closed by default: the header answers the question
                                          most visits have, and a chain of nine lines between
                                          the owner and the buttons is the reason this was
                                          reported as overwhelming.

                                          Open, it reads as what happened. Each attempt is a
                                          named milestone on a connector line, and BETWEEN
                                          them an arrow states the move itself — the step the
                                          flat list never showed, and the reason two emails
                                          under one attempt stopped looking like a duplicate:
                                          one announced that time, one followed its outcome.

                                          Every line has a verb and a subject, so "who" and
                                          "when" need no icon to decode.
                                        */}
                                        {isScheduleStep && hasHistory && (
                                          <div className="mt-2 flex flex-col gap-1.5" style={{ gridColumn: 1 }}>

                                            {/* The summary, and the way in. Says HOW MUCH
                                                there is, never what — that is the point of
                                                keeping it shut. */}
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-[12px] text-[var(--v2-text-muted)]">
                                                {historySummary}
                                              </span>
                                              <button
                                                type="button"
                                                onClick={e => {
                                                  e.stopPropagation();
                                                  toggleHistory(booking.id);
                                                }}
                                                /* The brand blue is mixed for a light card and
                                                   near-invisible on a dark one, so it carries a
                                                   lightened form of the SAME hue rather than a
                                                   different colour — the link stays recognisable
                                                   and stays readable. Every other adaptive colour
                                                   in this file pairs light and dark the same way. */
                                                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#3B5AE5] dark:text-[#93A8FF] hover:underline"
                                              >
                                                {historyOpen
                                                  ? translated(t, 'crm.journey.hide_history') || 'Hide'
                                                  : translated(t, 'crm.journey.show_history') || 'Show what happened'}
                                                {historyOpen ? (
                                                  <ChevronUp className="h-3 w-3" aria-hidden="true" />
                                                ) : (
                                                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                                                )}
                                              </button>
                                            </div>

                                            {historyOpen && (
                                              <div className="mt-0.5 flex flex-col">
                                                {(booking.attempts ?? []).map((attempt, attemptIndex) => {
                                                  const isCurrentAttempt =
                                                    attemptIndex === (booking.attempts?.length ?? 1) - 1;
                                                  const isLastOfChain = isCurrentAttempt;

                                                  /* The state, in the words its own button
                                                     used. Only reached where nobody recorded
                                                     WHO — with an actor the sentence below
                                                     says it better. */
                                                  const word =
                                                    attempt.meeting_status === 'held'
                                                      ? t('crm.booking.quoted.meeting_held')
                                                      : attempt.meeting_status === 'no_show'
                                                        ? t('crm.booking.status.no_show')
                                                        : attempt.meeting_status === 'cancelled'
                                                          ? t('crm.booking.status.cancelled')
                                                          : !isCurrentAttempt
                                                            ? translated(t, 'crm.journey.superseded') ||
                                                              'Moved to another time'
                                                            : translated(t, 'crm.journey.awaiting_outcome') ||
                                                              'Awaiting an outcome';

                                                  /* The milestone's name. Ordinals up to six,
                                                     then a plain number — a booking moved
                                                     seven times is past the point where a
                                                     word helps. */
                                                  const attemptLabel = isCurrentAttempt
                                                    ? translated(t, 'crm.journey.attempt_current') || 'Current time'
                                                    : translated(t, `crm.journey.attempt_ordinal.${attemptIndex + 1}`) ||
                                                      `${translated(t, 'crm.journey.attempt') || 'Time'} ${attemptIndex + 1}`;

                                                  /* The outcome, as a sentence. The actor
                                                     chooses the verb, which is what removes
                                                     the icon the owner had to decode. */
                                                  const outcomeSentence = (() => {
                                                    if (!attempt.meeting_status) return null;
                                                    const by = attempt.outcome_by;
                                                    if (by === 'client' && attempt.meeting_status === 'cancelled') {
                                                      return translated(t, 'crm.journey.client_cancelled_meeting');
                                                    }
                                                    if (by === 'system') {
                                                      const auto = translated(t, 'crm.journey.auto_marked');
                                                      return auto ? `${auto}: ${word}` : word;
                                                    }
                                                    if (by === 'owner') {
                                                      if (attempt.meeting_status === 'held') {
                                                        return translated(t, 'crm.journey.you_marked_held');
                                                      }
                                                      if (attempt.meeting_status === 'no_show') {
                                                        return translated(t, 'crm.journey.you_marked_no_show');
                                                      }
                                                      if (attempt.meeting_status === 'cancelled') {
                                                        /*
                                                         * ── WHY, NOT ONLY THAT ──────────
                                                         * Two cancellations look identical
                                                         * on this row and mean opposite
                                                         * things: one drops the appointment
                                                         * and keeps the job, the other ends
                                                         * the quote with it. The client was
                                                         * emailed one of two opposite
                                                         * messages, and the rail is where
                                                         * the owner goes to see which.
                                                         *
                                                         * Only on the CURRENT attempt:
                                                         * `proposal_continues` lives on the
                                                         * booking and describes where the
                                                         * job stands now, so stamping it on
                                                         * a superseded row would put
                                                         * today's answer on last week's
                                                         * appointment.
                                                         */
                                                        if (
                                                          isCurrentAttempt &&
                                                          booking.proposal_continues === false
                                                        ) {
                                                          return (
                                                            translated(
                                                              t,
                                                              'crm.journey.you_cancelled_meeting_and_quote'
                                                            ) ||
                                                            translated(t, 'crm.journey.you_cancelled_meeting')
                                                          );
                                                        }
                                                        return translated(t, 'crm.journey.you_cancelled_meeting');
                                                      }
                                                    }
                                                    /* Nobody recorded who. The plain state is
                                                       the honest answer, not an invented one. */
                                                    return word;
                                                  })();

                                                  const outcomeFailed =
                                                    attempt.meeting_status === 'no_show' ||
                                                    attempt.meeting_status === 'cancelled';

                                                  /* The clock alone on a row that falls on the
                                                     attempt's own day; the date only when it
                                                     differs. Four repetitions of one date is
                                                     the noise this replaces. */
                                                  const stamp = (at: string | null | undefined) => {
                                                    if (!at) return null;
                                                    const sameDay =
                                                      new Date(at).toDateString() ===
                                                      new Date(attempt.start_time).toDateString();
                                                    return sameDay
                                                      ? formatTime(at)
                                                      : `${formatShortDate(at)} · ${formatTime(at)}`;
                                                  };

                                                  const mails = [...(attempt.emails ?? [])].sort(
                                                    (a, b) =>
                                                      new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime()
                                                  );
                                                  const lastMailAt = mails[mails.length - 1]?.at;

                                                  return (
                                                    <div key={attempt.id}>
                                                      <div className="flex gap-2.5">
                                                        {/* The connector. Filled for the
                                                            current attempt, hollow for the
                                                            ones it replaced. */}
                                                        <div className="flex flex-col items-center shrink-0" style={{ width: '14px' }}>
                                                          <span
                                                            className="shrink-0 rounded-full"
                                                            style={{
                                                              width: '11px',
                                                              height: '11px',
                                                              marginTop: '4px',
                                                              background: isCurrentAttempt
                                                                ? outcomeFailed
                                                                  ? '#F04438'
                                                                  : 'var(--v2-primary)'
                                                                : 'var(--v2-surface)',
                                                              border: isCurrentAttempt
                                                                ? 'none'
                                                                : '2px solid var(--v2-border)',
                                                            }}
                                                            aria-hidden="true"
                                                          />
                                                          {!isLastOfChain && (
                                                            <span
                                                              className="flex-1"
                                                              style={{ width: '2px', background: 'var(--v2-border)', margin: '4px 0' }}
                                                              aria-hidden="true"
                                                            />
                                                          )}
                                                        </div>

                                                        <div className="flex-1 min-w-0 pb-3">
                                                          <div className="flex items-baseline justify-between gap-2">
                                                            <span
                                                              className={`text-[13px] font-semibold ${
                                                                isCurrentAttempt
                                                                  ? 'text-[var(--v2-text-primary)]'
                                                                  : 'text-[var(--v2-text-secondary)]'
                                                              }`}
                                                            >
                                                              {attemptLabel} · {formatTime(attempt.start_time)}
                                                            </span>
                                                            <span className="text-[11.5px] text-[var(--v2-text-muted)] tabular-nums shrink-0">
                                                              {formatShortDate(attempt.start_time)}
                                                            </span>
                                                          </div>

                                                          <div className="mt-1.5 flex flex-col gap-1.5">
                                                            {/* Mail sent BEFORE the outcome. */}
                                                            {mails
                                                              .filter(
                                                                m =>
                                                                  !attempt.outcome_at ||
                                                                  new Date(m.at ?? 0).getTime() <=
                                                                    new Date(attempt.outcome_at).getTime()
                                                              )
                                                              .map(mail =>
                                                                renderMailRow(mail, mail.at === lastMailAt && isCurrentAttempt, stamp)
                                                              )}

                                                            {/* The outcome, in its place. */}
                                                            {outcomeSentence && (
                                                              <span className="flex items-baseline gap-2 text-[12px] font-medium">
                                                                <svg
                                                                  width="12"
                                                                  height="12"
                                                                  viewBox="0 0 24 24"
                                                                  fill="none"
                                                                  stroke={outcomeFailed ? '#C2410C' : '#15803D'}
                                                                  strokeWidth="2.4"
                                                                  strokeLinecap="round"
                                                                  className="shrink-0"
                                                                  style={{ transform: 'translateY(2px)' }}
                                                                  aria-hidden="true"
                                                                >
                                                                  {outcomeFailed ? (
                                                                    <path d="M18 6 6 18M6 6l12 12" />
                                                                  ) : (
                                                                    <path d="M20 6 9 17l-5-5" />
                                                                  )}
                                                                </svg>
                                                                <span
                                                                  className="flex-1 min-w-0"
                                                                  style={{ color: outcomeFailed ? '#9A3412' : '#15803D' }}
                                                                >
                                                                  {outcomeSentence}
                                                                </span>
                                                                {attempt.outcome_at && (
                                                                  <span className="text-[var(--v2-text-muted)] tabular-nums shrink-0">
                                                                    {stamp(attempt.outcome_at)}
                                                                  </span>
                                                                )}
                                                              </span>
                                                            )}

                                                            {/* And mail that FOLLOWED it. */}
                                                            {attempt.outcome_at &&
                                                              mails
                                                                .filter(
                                                                  m =>
                                                                    new Date(m.at ?? 0).getTime() >
                                                                    new Date(attempt.outcome_at as string).getTime()
                                                                )
                                                                .map(mail =>
                                                                  renderMailRow(mail, mail.at === lastMailAt && isCurrentAttempt, stamp)
                                                                )}
                                                          </div>
                                                        </div>
                                                      </div>

                                                      {/* ── THE MOVE ITSELF ──────────────
                                                          Between one attempt and the next.
                                                          Without it the chain showed times
                                                          but never the act of changing them,
                                                          which is what made the sequence
                                                          unreadable. */}
                                                      {!isCurrentAttempt && (
                                                        <div className="flex items-center gap-2.5 -mt-1 mb-1.5">
                                                          <span className="flex justify-center shrink-0" style={{ width: '14px' }}>
                                                            <ChevronDown
                                                              className="h-3.5 w-3.5 text-[var(--v2-text-muted)]"
                                                              aria-hidden="true"
                                                            />
                                                          </span>
                                                          <span className="text-[11.5px] text-[var(--v2-text-muted)]">
                                                            {movedSentence(booking.attempts?.[attemptIndex + 1])}
                                                          </span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {/* ── WHAT THE CLIENT WAS TOLD, AND A WAY TO SAY IT AGAIN ──
                                            The cancellation message had nowhere to live.
                                            Filed under an attempt it read as a detail of
                                            one appointment; filed nowhere it vanished. It
                                            belongs under the event it announces.

                                            The resend is offered on a cancelled booking
                                            deliberately — a client who cannot find the
                                            message is exactly who needs it sent again, and
                                            withholding it here was the owner's own
                                            correction. */}
                                        {isCancelledStep && (
                                          <span
                                            className="flex items-baseline gap-2 text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)]"
                                            style={{ gridColumn: 1 }}
                                          >
                                            <Mail
                                              className="h-3 w-3 shrink-0"
                                              style={{ transform: 'translateY(2px)', color: 'var(--v2-text-muted)' }}
                                              aria-hidden="true"
                                            />
                                            <span className="flex-1 min-w-0">
                                              {step.metadata?.emailId
                                                ? translated(t, 'crm.journey.cancellation_mail') ||
                                                  'The client was told'
                                                : translated(t, 'crm.journey.cancellation_mail_none') ||
                                                  'The client was not told'}
                                              {/* `Boolean(...)`: `metadata` is
                                                  an index signature of
                                                  `unknown`, and `unknown && x`
                                                  is not a ReactNode, so this
                                                  was a type error wherever it
                                                  was not being ignored. The
                                                  ternary above is fine because
                                                  both of its arms are strings. */}
                                              {Boolean(step.metadata?.emailId) && onResendMail && (
                                                <>
                                                  <span aria-hidden="true"> · </span>
                                                  <button
                                                    type="button"
                                                    onClick={e => {
                                                      e.stopPropagation();
                                                      onResendMail(booking.id, 'booking_cancelled');
                                                    }}
                                                    className="underline underline-offset-2 hover:text-[var(--v2-text-primary)]"
                                                  >
                                                    {translated(t, 'crm.journey.resend') || 'Send again'}
                                                  </button>
                                                </>
                                              )}
                                            </span>
                                            {step.metadata?.emailSentAt ? (
                                              <span className="text-[var(--v2-text-muted)] tabular-nums shrink-0">
                                                {formatTime(step.metadata.emailSentAt as string)}
                                              </span>
                                            ) : null}
                                          </span>
                                        )}

                                        {isIntakeStep && hasIntake && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)]"
                                            style={{ gridColumn: 1 }}
                                          >
                                            {Object.keys(booking.intake_responses?.responses || {}).length}{' '}
                                            {t('crm.intake.responses')}
                                          </span>
                                        )}

                                        {/* State, then actions. A state is a quiet
                                            tinted word; an action is a control. */}
                                        {/* `empty:hidden` because every child here is
                                            conditional while the row itself was not: a step
                                            with no state and no action still rendered this
                                            div, and its `mt-2` put 8px of dead space under
                                            most cards in the journey. */}
                                        <div className="flex flex-wrap items-center gap-1.5 mt-2 empty:hidden empty:mt-0" style={{ gridColumn: 1 }}>
                                          {isIntakeStep && hasIntake && (
                                            <span className="px-2.5 py-0.5 rounded-full text-[11.5px] font-medium bg-green-500/10 text-green-600 dark:text-green-400">
                                              {t('crm.booking.intake_completed') || 'Completed'}
                                            </span>
                                          )}

                                          {isPaymentStep &&
                                            (payment?.status === 'refunded' || refunded > 0) && (
                                              <span
                                                className={`px-2.5 py-0.5 rounded-full text-[11.5px] font-medium ${
                                                  payment?.status === 'refunded'
                                                    ? `${REFUND_CLASS.full.bg} ${REFUND_CLASS.full.text}`
                                                    : `${REFUND_CLASS.partial.bg} ${REFUND_CLASS.partial.text}`
                                                }`}
                                              >
                                                {payment?.status === 'refunded'
                                                  ? t('crm.payment.status.refunded') || 'Refunded'
                                                  : t('crm.payment.status.partially_refunded_short') || 'Partially refunded'}
                                              </span>
                                            )}

                                          {cancelledUnpaid && (() => {
                                            /*
                                              ── WHICH PAYMENT, ON A PLAN ──────────────────
                                              "Payment request cancelled" is the whole truth
                                              on a single payment and badly misleading on a
                                              plan: one of two periods withdrawn reads as the
                                              entire payment being off, while ₪500 is still
                                              due next week.

                                              Named exactly as the row above names itself —
                                              `stage.label || index + 1` — so the chip and the
                                              list cannot call the same period two things.

                                              Three sentences rather than one with a count,
                                              because "1 תשלומים" is wrong in a way a reader
                                              notices, and "all of them" is a different fact
                                              from "these ones".
                                            */
                                            const stages = payment?.plan?.stages ?? [];
                                            const cancelledNames = stages
                                              .map((stage, i) => ({ stage, name: stage.label || `${i + 1}` }))
                                              .filter(({ stage }) => stage.status === 'cancelled')
                                              .map(({ name }) => name);

                                            const label =
                                              cancelledNames.length === 0
                                                ? /* No plan, or no period says so: the booking's
                                                     own invoice was withdrawn. */
                                                  t('crm.payment.request_cancelled') ||
                                                  'Payment request cancelled'
                                                : cancelledNames.length === stages.length
                                                  ? t('crm.payment.request_cancelled_all') ||
                                                    'All payment requests cancelled'
                                                  : (cancelledNames.length === 1
                                                      ? t('crm.payment.request_cancelled_one') ||
                                                        'Payment {payments} cancelled'
                                                      : t('crm.payment.request_cancelled_many') ||
                                                        'Payments {payments} cancelled'
                                                    ).replace('{payments}', cancelledNames.join(', '));

                                            return (
                                              <span className="px-2.5 py-0.5 rounded-full text-[11.5px] font-medium bg-gray-500/10 text-gray-600 dark:text-gray-400">
                                                {label}
                                              </span>
                                            );
                                          })()}

                                          {intakeExpandable && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                toggleSection(sectionKey);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
                                            >
                                              {isSectionExpanded
                                                ? t('common.hide') || 'Hide'
                                                : t('crm.intake.view_responses') || 'View responses'}
                                            </button>
                                          )}

                                          {/* Manage / refund.
                                              Gated on the PAYMENT for a normal
                                              booking, which is right — but a
                                              quoted job's booking carries the
                                              `free` placeholder (its price was
                                              always the quote), so the money is
                                              real and the button was hidden.
                                              A payment step that exists at all
                                              on a quoted booking means an
                                              invoice was raised. */}
                                          {/* Nothing to manage on a cancelled
                                              booking nobody paid for: the
                                              invoice went with it. */}
                                          {isPaymentStep && onManagePayment && paymentExpected && !cancelledUnpaid && !nothingLeftToManage && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onManagePayment(session);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[#8B5CF6] text-[#8B5CF6] hover:bg-[#8B5CF6] hover:text-white transition-colors"
                                            >
                                              {/* One word, every booking type.
                                                  A quoted job's money is still
                                                  a payment, and a second name
                                                  for the same button on some
                                                  cards and not others makes the
                                                  drawer read as two sales.
                                                  What differs is what the dialog
                                                  does, not what the button is
                                                  called. */}
                                              {t('crm.payment.manage') || 'Manage payment'}
                                            </button>
                                          )}

                                          {isPaymentStep && !hasStageDocuments && !!step.metadata?.canResend && onSendInvoice && booking.status !== 'cancelled' && (
                                            <button
                                              type="button"
                                              disabled={sendingInvoiceBookingId === booking.id}
                                              onClick={e => {
                                                e.stopPropagation();
                                                handleSendInvoice(step.metadata?.invoiceId as string, booking.id);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors disabled:opacity-50"
                                            >
                                              {/* Names the document, not the
                                                  action. "Resend invoice" on a
                                                  settled one promises the wrong
                                                  paperwork. */}
                                              {step.metadata?.invoiceSettled
                                                ? t('crm.invoice.send_receipt')
                                                : t('crm.invoice.resend') || 'Resend invoice'}
                                            </button>
                                          )}

                                          {/* The quote.
                                              The only journey action whose
                                              subject is the OWNER: everywhere
                                              else the business is nudging the
                                              client, and here the client has
                                              asked and is waiting.
                                              After a decline the same button
                                              returns as "Send a new quote" —
                                              a rejected price is the start of
                                              a negotiation, not the end of
                                              the job. */}
                                          {/* Reachable in three states, not one.
                                              `owner` is the ordinary case; `unmarked`
                                              and `noshow` are the two the gate added,
                                              and in both the owner may still quote —
                                              which is the whole reason the gate asks
                                              rather than closing the step. */}
                                          {/* ── AND NOT WHEN THE OWNER HAS SAID NO QUOTE ──
                                              `proposal_continues === false` is them
                                              answering, in the cancel dialog, that the
                                              quote is not going ahead — and the client
                                              has been emailed exactly that. Still
                                              offering "send a quote" here invites the
                                              one action that contradicts the message
                                              already sent.

                                              `false` only. NULL is nobody having been
                                              asked, which is every booking that never
                                              had a meeting cancelled, and must change
                                              nothing. */}
                                          {isProposalStep
                                            && onOpenProposalBuilder
                                            && (step.metadata?.waitingOn === 'owner'
                                              || step.metadata?.waitingOn === 'unmarked'
                                              || step.metadata?.waitingOn === 'noshow')
                                            && booking.proposal_continues !== false
                                            && booking.status !== 'cancelled' && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onOpenProposalBuilder(booking.id, {
                                                  supersedesId: (step.metadata?.proposalId as string) ?? null,
                                                  declineReason: (step.metadata?.declineReason as string) ?? null,
                                                  declineNote: (step.metadata?.declineNote as string) ?? null,
                                                });
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
                                            >
                                              {step.metadata?.proposalStatus === 'declined'
                                                ? t('crm.proposal.send_revised') || 'Send a new quote'
                                                : t('crm.proposal.send') || 'Send a quote'}
                                            </button>
                                          )}

                                          {/* Stop an accepted job part-way through.
                                              Only on an ACCEPTED quote: before
                                              acceptance the offer is withdrawn,
                                              not stopped, and those are different
                                              facts that must stay countable
                                              apart. One press stops the unbilled
                                              phases AND marks the job ended, with
                                              the reason recorded — they were
                                              separable before and that left
                                              cancelled stages under a quote still
                                              reading "accepted". */}
                                          {isProposalStep
                                            && onStopQuote
                                            && step.metadata?.proposalStatus === 'accepted'
                                            /* AND there is something left to stop.
                                               An accepted quote stays accepted for ever, so this
                                               alone kept the button on a job whose every stage was
                                               paid and every invoice settled — inviting an owner to
                                               press it and discover it does nothing nameable.
                                               See `hasStoppableWork` where the step is built. */
                                            && step.metadata?.hasStoppableWork === true
                                            /* `!!`, like `canResend` above: metadata values are
                                               `unknown`, and `unknown && <jsx>` is not a ReactNode. */
                                            && !!step.metadata?.proposalId && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onStopQuote(
                                                  step.metadata?.proposalId as string,
                                                  (step.metadata?.title as string) ?? null
                                                );
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[#F79009]/40 text-[#B54708] hover:border-[#B54708] transition-colors"
                                            >
                                              {t('crm.quote.stop.action') || 'Stop this job'}
                                            </button>
                                          )}
                                          {/*
                                            NO REFUND HERE. It used to offer one once a job
                                            was stopped and paid.

                                            A stopped job’s money is on the PAYMENT card, where
                                            every paid milestone now carries its own refund — and
                                            that is the only place the choice can be made, because
                                            a refund follows a charge and this card knows only the
                                            job. Offered from here it could mean nothing narrower
                                            than "all of it".

                                            Two doors to one decision, one of which could not
                                            express the common case, is worse than one door.
                                          */}

                                          {/*
                                            No "View quote" button here any more.

                                            It opened only the CURRENT version, while the
                                            version strip above listed every one and opened
                                            none — so the quote a client refused was visible
                                            and unreadable. Each row in that strip is now the
                                            way in, which makes this a second door to one of
                                            the places it already goes.
                                          */}

                                          {canSendIntake && (
                                            <button
                                              type="button"
                                              disabled={sendingIntakeBookingId === booking.id}
                                              onClick={e => {
                                                e.stopPropagation();
                                                handleSendIntake(booking.id);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors disabled:opacity-50"
                                            >
                                              {t('crm.intake.send_form') || 'Send intake form'}
                                            </button>
                                          )}

                                          {/* Resend the confirmation — the details
                                              and the calendar invite, to a client
                                              who lost the email or whose address
                                              was wrong at the time. Still guarded
                                              on the handler: this component is used
                                              without one elsewhere, and a button
                                              that silently does nothing is worse
                                              than one that shows it cannot. */}
                                          {/* ── NOT HERE ONCE THERE IS A MEETING RAIL ──
                                              "Send again" regenerates from the
                                              booking, so it carries the time the
                                              meeting has NOW. Its home is the
                                              meeting's own rail, beside the mail it
                                              would repeat, not on the confirmation
                                              stage which records what was sent once
                                              at the beginning.

                                              This was keyed on having SEVERAL
                                              attempts, which is the wrong question:
                                              the rail renders from the first one, so
                                              a plain booking showed the button in
                                              both places at once. What matters is
                                              whether there is a rail to host it.

                                              With no rail at all — a service that is
                                              bought rather than booked — this stays,
                                              because it is then the only way. */}
                                          {isConfirmationStep && step.status === 'completed' && !meetingSettled && !hasMeetingRail && (
                                            <button
                                              type="button"
                                              disabled={!onResendMail}
                                              title={onResendMail ? undefined : t('crm.journey.not_wired') || 'Not connected yet'}
                                              onClick={e => {
                                                e.stopPropagation();
                                                /* The step records the booking's
                                                   CONFIRMATION, which is the only
                                                   message this control ever stood
                                                   for. */
                                                onResendMail?.(booking.id, 'booking_confirmed');
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                              {t('crm.journey.resend') || 'Send again'}
                                            </button>
                                          )}

                                          {/* Reschedule, on the step it belongs to.
                                              The same action as the footer's Edit —
                                              it is just reachable from the row that
                                              names the time. */}
                                          {/* Only what can still be moved. A booking
                                              already completed, cancelled or marked
                                              a no-show is a record of what happened
                                              — offering to reschedule it invites an
                                              edit that contradicts the outcome. */}
                                          {/* After a no-show, a NEW time — not a
                                              reschedule.
                                              Rescheduling is deliberately refused on
                                              a settled booking just above: the row is
                                              a record of what happened and moving it
                                              would contradict the outcome. So the way
                                              forward is another meeting, which is the
                                              tab's own action. */}
                                          {isProposalStep
                                            && onNewSession
                                            && step.metadata?.waitingOn === 'noshow' && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onNewSession();
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
                                            >
                                              {t('crm.proposal.book_new_meeting')}
                                            </button>
                                          )}

                                          {/* ── WHAT HAPPENED AT THE MEETING, ON THE MEETING'S OWN STEP ──
                                              Asked for directly: "move the meeting
                                              buttons/actions to the journey step where
                                              we have the meeting".

                                              They lived in the card's action strip,
                                              beside Cancel, which is a JOB action that
                                              cascades through every layer under it. Two
                                              facts about an appointment and one decision
                                              about the work, in one row, with nothing to
                                              say which was which — reported as "is the
                                              button related to the booking or to the
                                              meeting?".

                                              Here the step itself answers that. The row
                                              names the time, and these say what happened
                                              at it. Reschedule already sat here for
                                              exactly this reason.

                                              `meetingSettled` hides them once recorded,
                                              the same guard Reschedule uses below, so the
                                              step never offers to re-answer a question it
                                              has already answered.

                                              Workplan P3-1: docs/workplans/BOOKING_MEETING_SEPARATION_WORKPLAN.md */}
                                          {/* Guarded on the handler, like every other write
                                              this component delegates: it renders in
                                              surfaces that pass only some of them, and a
                                              button that silently does nothing is worse
                                              than one that is not there. */}
                                          {/* ── THE APPOINTMENT IS OFF, THE WORK IS NOT ──
                                              The third thing that can happen to a
                                              meeting, and it had no control at all: the
                                              owner and the client agree to proceed
                                              without meeting. Previously the only
                                              cancel on the card ended the whole job, so
                                              an owner in that position either killed
                                              work that was still live or left an
                                              appointment nobody would attend sitting
                                              there as an unanswered question.

                                              Deliberately NOT red, and deliberately not
                                              beside the footer's "בטל הזמנה": this
                                              cancels one appointment, and the label
                                              names its own subject so the two cannot be
                                              confused. */}
                                          {canCancelMeeting && onCancelMeeting && (
                                            <button
                                              type="button"
                                              title={translated(t, 'crm.booking.action.cancel_meeting_hint') || undefined}
                                              onClick={e => {
                                                e.stopPropagation();
                                                onCancelMeeting(booking.id, { isQuoted });
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
                                            >
                                              {translated(t, 'crm.booking.action.cancel_meeting') || 'Cancel meeting'}
                                            </button>
                                          )}

                                          {canMarkHeld && onSetBookingStatus && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onSetBookingStatus(booking.id, 'completed');
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-green-600/40 text-green-700 dark:text-green-400 hover:bg-green-500/10 transition-colors"
                                            >
                                              {t('crm.booking.action.mark_held') || 'Mark as held'}
                                            </button>
                                          )}

                                          {/* Needs a time to mean anything: a service
                                              that is bought rather than booked has
                                              nobody who could fail to turn up. */}
                                          {canMarkNoShow && !isUnscheduled && onSetBookingStatus && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onSetBookingStatus(booking.id, 'no_show');
                                              }}
                                              /* ── AMBER, NOT GREY ────────────────────────
                                                 It sat in the same neutral as Reschedule,
                                                 so the two controls beside "held" were
                                                 indistinguishable — and one of them records
                                                 that the client did not turn up.

                                                 Not red: a no-show is not a failure and not
                                                 destructive. The job stays alive and the
                                                 next move is another time. Amber is the
                                                 card's word for "something needs your
                                                 attention", which is exactly right. */
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-amber-600/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                                            >
                                              {t('crm.booking.action.mark_no_show') || 'Mark as no-show'}
                                            </button>
                                          )}

                                          {/* Not on a meeting that took place — see
                                              `meetingHappened`. */}
                                          {meetingAnswerable && !meetingHappened && !meetingCancelled && onEditSession && !isUnscheduled && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onEditSession(booking.id);
                                              }}
                                              /* Blue: moving an appointment is neither an
                                                 outcome nor a warning. It is the neutral,
                                                 reversible action of the three, and giving
                                                 it its own hue stops a row of identical grey
                                                 pills where one records a no-show. */
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-blue-600/40 text-blue-700 dark:text-blue-400 hover:bg-blue-500/10 transition-colors"
                                            >
                                              {t('crm.booking.reschedule') || 'Reschedule'}
                                            </button>
                                          )}
                                        </div>

                                        {/* ── THE MEETINGS, AS A STAGE OF THE JOURNEY ──
                                            Every booking with a parent belongs to the
                                            quote that sold it, so its meetings are a
                                            step on that client's journey rather than a
                                            card of their own — which is what made a
                                            package look like two jobs, the second
                                            asking for a quote the first had already
                                            agreed.

                                            Each row keeps its own date, status and
                                            actions, because each is a real appointment
                                            that can be held, missed, moved or called
                                            off alone, and on a package billed per
                                            session marking one held is what invoices
                                            it. */}
                                        {/*
                                          ONE LIST, NOT A STACK OF CARDS.
                                          ───────────────────────────────
                                          Every row was its own tinted box holding a
                                          number, a date, a filled status pill and FOUR
                                          outlined buttons. Six meetings meant six floating
                                          boxes and twenty-four controls, and at drawer
                                          width each row wrapped onto two lines — so the
                                          actions for meeting 2 sat directly under the date
                                          for meeting 2 and directly above meeting 3, with
                                          nothing to say which belonged to which.

                                          Now the same hairline-separated list the stages
                                          and the payment account use: one border around
                                          the set, rows divided by a rule, state carried by
                                          a dot and a coloured word rather than a filled
                                          pill. Nothing is removed — every action is still
                                          on every row — it is the chrome around them that
                                          is gone.
                                        */}
                                        {step.key === 'package' && session.meetings && (
                                          <div className="mt-2 flex flex-col gap-2" style={{ gridColumn: 1 }}>
                                            {/* NO `overflow-hidden` here, deliberately.
                                                Each row carries a ⋯ menu positioned
                                                absolutely, and an ancestor that clips its
                                                overflow clips that menu too — it rendered
                                                as a 40px strip of icons with every label
                                                cut off. The rows have no background of
                                                their own, so there is nothing for the
                                                radius to clip anyway: the border and the
                                                corner are the container's. */}
                                            {/*
                                              ─────────────────────────────────────────────
                                              A REAL TABLE, because six separate grids can
                                              never line up.

                                              Each row was its own CSS grid, so an `auto`
                                              column sized itself from THAT row alone: the
                                              dates differ in width, the header's empty
                                              leading cells collapsed to nothing, and every
                                              row put its state and its figure at a
                                              different x. Columns only share a width when
                                              they share a grid — or a table.

                                              `border-collapse` so the row rules meet the
                                              frame cleanly, and NO `overflow-hidden`
                                              anywhere: the ⋯ menu is positioned absolutely
                                              and a clipping ancestor cuts it to a strip.
                                              ───────────────────────────────────────────── */}
                                            {/*
                                              ─────────────────────────────────────────────
                                              `fixed`, BECAUSE `w-full` AND `auto` CANNOT
                                              BOTH BE HONOURED.

                                              Reported as two faults and they are one:
                                              the table ran off the end of the drawer, and
                                              the headings no longer sat above their
                                              columns in Hebrew.

                                              `w-full` is `width: 100%`, so the table may
                                              NOT grow to fit its content. Under automatic
                                              layout the browser then squeezes the columns
                                              to that width — and a cell carrying
                                              `whitespace-nowrap` cannot be squeezed, so
                                              its text simply draws outside its own box.
                                              Three of the five columns here were nowrap.
                                              The dates, the figures and the row menu spilled
                                              past their cells and past the panel; the
                                              headings, being short, stayed correctly inside
                                              theirs. Hence a header that looks "off" while
                                              nothing about the header changed.

                                              Under `fixed` the widths are declared, not
                                              negotiated: every column is exactly as wide as
                                              the head says, the total is always the
                                              container, and a body cell cannot be wider
                                              than the heading above it. The two faults go
                                              together because they were the same one.
                                              ───────────────────────────────────────────── */}
                                            <table
                                              className="w-full text-start"
                                              style={{
                                                borderCollapse: 'collapse',
                                                borderRadius: '10px',
                                                border: '1px solid var(--v2-border)',
                                                tableLayout: 'fixed',
                                              }}
                                            >
                                              <thead>
                                                <tr
                                                  className="text-[10.5px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]"
                                                  style={{ background: 'var(--v2-surface)' }}
                                                >
                                                  {/* The state dot and the number, which
                                                      need no label of their own. */}
                                                  {/* 60, not `w-9`. These widths are now
                                                      BINDING, and `box-sizing: border-box`
                                                      means the `px-3` comes out of them: at
                                                      36px this column had 12px of content box
                                                      for a dot, a gap and a number, and would
                                                      have spilled the moment it stopped being
                                                      a mere hint to the auto layout. */}
                                                  <th
                                                    className="w-[60px] px-3 py-1.5 text-start font-medium"
                                                    style={{ borderBottom: '1px solid var(--v2-border)' }}
                                                  />
                                                  {/* ── THE WIDTHS LIVE HERE NOW ───────────
                                                      Under `fixed` these are the column
                                                      definitions, so they are stated in the
                                                      order a reader needs them: the date is
                                                      the widest single string and gets what
                                                      it measures; the state is one glyph; the
                                                      money takes the slack, because it is the
                                                      only cell whose length is unbounded (a
                                                      partial refund names two figures). */}
                                                  <th
                                                    className="w-[142px] whitespace-nowrap px-1 py-1.5 text-start font-medium"
                                                    style={{ borderBottom: '1px solid var(--v2-border)' }}
                                                  >
                                                    {t('crm.booking.package.col_when') || 'When'}
                                                  </th>
                                                  <th
                                                    className="w-[52px] whitespace-nowrap px-1 py-1.5 text-start font-medium"
                                                    style={{ borderBottom: '1px solid var(--v2-border)' }}
                                                  >
                                                    {t('crm.booking.package.col_state') || 'State'}
                                                  </th>
                                                  {/* NO width, deliberately. Under `fixed` a
                                                      percentage resolves against the whole
                                                      table, so `w-full` beside four fixed
                                                      columns asks for 100% PLUS 318px and the
                                                      row overflows again. The column left
                                                      `auto` is the one that takes whatever is
                                                      left, which is exactly the behaviour the
                                                      money column wants. */}
                                                  <th
                                                    className="px-1 py-1.5 text-end font-medium"
                                                    style={{ borderBottom: '1px solid var(--v2-border)' }}
                                                  >
                                                    {t('crm.booking.package.col_payment') || 'Payment'}
                                                  </th>
                                                  {/* Room for the row menu's button plus its
                                                      padding, for the same border-box reason. */}
                                                  <th
                                                    className="w-[64px] px-3 py-1.5 font-medium"
                                                    style={{ borderBottom: '1px solid var(--v2-border)' }}
                                                  />
                                                </tr>
                                              </thead>
                                              <tbody>
                                            {session.meetings.map((meeting, meetingIndex) => {
                                              const row = meeting.booking;
                                              /* Same column move as the step dot above. */
                                              const held =
                                                row.meeting_status === 'held' ||
                                                (row.meeting_status == null && row.status === 'completed');
                                              const off =
                                                row.meeting_status === 'no_show' ||
                                                row.meeting_status === 'cancelled' ||
                                                (row.meeting_status == null &&
                                                  (row.status === 'cancelled' || row.status === 'no_show'));
                                              const meetingStatus = getBookingStatusLabel(row.status, true, false, row.start_time);

                                              /*
                                                WHETHER THE MONEY FOR THIS MEETING ARRIVED.
                                                ──────────────────────────────────────────
                                                On a package billed per meeting, marking one
                                                held RAISES AN INVOICE and emails it. The row
                                                then said "held" and nothing else, so the one
                                                question the owner has next — did they pay? —
                                                had no answer anywhere on this card. They
                                                could watch an invoice go out and never see
                                                it come back in.

                                                The data was here all along: a meeting is a
                                                `SessionCardData` like any other and carries
                                                its own `payment`, built by the same pipeline
                                                as the card above it. Only the row never read
                                                it.

                                                Absent for a package paid UP FRONT, where the
                                                meetings have no money of their own and the
                                                container card holds it. Absent too when the
                                                service is free. In both cases there is no
                                                payment fact to state, and inventing a "—"
                                                for it would imply one is missing.
                                              */
                                              const pay = meeting.payment;
                                              /*
                                               * ─────────────────────────────────────
                                               * PARTLY RETURNED IS ITS OWN ANSWER.
                                               *
                                               * Any refund read as "refunded", so a
                                               * session paid 133.33 with 66.67 returned
                                               * claimed the whole amount had gone back
                                               * — and the owner had no sign that half
                                               * of it is still theirs.
                                               * ─────────────────────────────────────
                                               */
                                              const refundedBack = Number(pay?.refundedAmount || 0);
                                              const partlyRefunded =
                                                refundedBack > 0 && pay ? refundedBack < pay.amount : false;
                                              const refunded =
                                                !partlyRefunded &&
                                                (pay?.status === 'refunded' || Boolean(pay?.refundedAt));
                                              const payState =
                                                !pay || pay.status === 'free' || !(pay.amount > 0)
                                                  ? null
                                                  : refunded
                                                    ? /* Orange, not red: the file settles this
                                                         above — a refund is a completed,
                                                         deliberate act, not a failure. */
                                                      { text: t('crm.payment.status.refunded'), tone: '#B54708' }
                                                    : partlyRefunded
                                                      ? /* What came back, named beside what
                                                           was charged — the figure already
                                                           says the rest is still held. */
                                                        {
                                                          text: `${t('payments.money_status.partially_refunded') || 'Partly refunded'} ${new Intl.NumberFormat(isRTL ? 'he-IL' : 'en-US', { style: 'currency', currency: pay.currency, maximumFractionDigits: 2 }).format(refundedBack)}`,
                                                          tone: '#B54708',
                                                        }
                                                      : pay.status === 'paid'
                                                        ? { text: t('crm.payment.status.paid'), tone: '#22C58B' }
                                                        : pay.invoiceStatus === 'overdue'
                                                          ? { text: t('payments.invoice.overdue'), tone: '#D97706' }
                                                          : { text: t('crm.payment.status.pending'), tone: 'var(--v2-text-muted)' };

                                              return (
                                                /*
                                                 * ─────────────────────────────────────
                                                 * A GRID, NOT A WRAPPING ROW.
                                                 *
                                                 * `flex-wrap` let a row drop its money to
                                                 * a second line as soon as the pieces
                                                 * stopped fitting, and every row chose a
                                                 * different moment to do it — six
                                                 * meetings read as six sentences of
                                                 * different shapes.
                                                 *
                                                 * It gets worse as the package runs:
                                                 * "הושלמה" is longer than "מאושרת", and
                                                 * none of these six has reached it yet.
                                                 * The first one to be marked held would
                                                 * have been the first to wrap.
                                                 *
                                                 * Fixed columns put every date, every
                                                 * state and every figure on the same
                                                 * edge, and the state column takes the
                                                 * slack — so a longer word shortens the
                                                 * gap rather than breaking the line.
                                                 * ─────────────────────────────────────
                                                 */
                                                <tr
                                                  key={row.id}
                                                  className="transition-colors hover:bg-[var(--v2-surface)]"
                                                  style={{
                                                    /* A hairline between rows; the head
                                                       already draws the one above the first. */
                                                    borderTop:
                                                      meetingIndex === 0
                                                        ? undefined
                                                        : '1px solid var(--v2-border)',
                                                  }}
                                                >
                                                  <td className="w-[60px] whitespace-nowrap px-3 py-2.5 align-middle">
                                                    <span className="flex items-center gap-1.5">
                                                      {/* The state, in no space at all — the
                                                          same four colours every other list
                                                          on this card uses. */}
                                                      <span
                                                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                        style={{
                                                          background: held
                                                            ? '#22C58B'
                                                            : off
                                                              ? '#B54708'
                                                              : 'var(--v2-border)',
                                                        }}
                                                        aria-hidden="true"
                                                      />
                                                      <span className="text-[11px] font-semibold tabular-nums text-[var(--v2-text-muted)]">
                                                        {row.occurrence_number ?? meetingIndex + 1}
                                                      </span>
                                                    </span>
                                                  </td>

                                                  <td
                                                    /* `truncate` is the pair `fixed` needs:
                                                       the column can no longer widen for a
                                                       long date, so the date has to agree to
                                                       end. `title` keeps the full value one
                                                       hover away on the rare row that clips. */
                                                    title={row.start_time ? formatDate(row.start_time) : undefined}
                                                    className={`truncate px-1 py-2.5 align-middle text-[12.5px] ${
                                                      off
                                                        ? 'text-[var(--v2-text-muted)] line-through'
                                                        : 'text-[var(--v2-text-primary)]'
                                                    }`}
                                                  >
                                                    {row.start_time ? formatDate(row.start_time) : '—'}
                                                  </td>

                                                  {/* ── A MARK, NOT A WORD ─────────────────
                                                      ───────────────────────────────────────
                                                      The word kept its colour and lost its
                                                      pill for the reason below, and that was
                                                      right as far as it went. It was still
                                                      the widest flexible thing in the row and
                                                      the one that grows as a package runs:
                                                      "התקיימה" is longer than "מאושרת", so
                                                      the table got wider the more of it was
                                                      done.

                                                      A glyph is the same four states in a
                                                      fixed 14px, in the same four colours the
                                                      rest of the card uses — and the colour
                                                      was already doing most of the work, which
                                                      is why the dot in the first column has
                                                      never needed a label.

                                                      The word is not lost: `title` on hover,
                                                      `sr-only` for anything reading the page
                                                      aloud. A glyph with no accessible name
                                                      would be a state only a sighted user can
                                                      know.

                                                      (The earlier note, still true: six solid
                                                      chips reading down a card look like six
                                                      alerts.) */}
                                                  <td className="w-[52px] px-1 py-2.5 align-middle">
                                                    <span
                                                      className={`inline-flex ${meetingStatus.color}`}
                                                      title={meetingStatus.text}
                                                    >
                                                      {held ? (
                                                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                                      ) : row.meeting_status === 'no_show' ? (
                                                        /* Missed and called off are not the
                                                           same fact, and `off` groups them.
                                                           Asked separately so the glyph can
                                                           tell them apart: nobody came, versus
                                                           it was called off. */
                                                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                                      ) : off ? (
                                                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                                                      ) : (
                                                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                                      )}
                                                      <span className="sr-only">{meetingStatus.text}</span>
                                                    </span>
                                                  </td>

                                                  {/*
                                                    The amount AND the word, because either
                                                    alone leaves the question open: a figure
                                                    on its own does not say whether it
                                                    arrived, and "Paid" on its own does not
                                                    say what was.
                                                  */}
                                                  {/* The one cell allowed to WRAP. Its length
                                                      has no ceiling — a partial refund names
                                                      what was charged and what came back — and
                                                      under `fixed` the alternative to a second
                                                      line is text drawn outside the cell,
                                                      which is the fault being fixed. Wrapping
                                                      changes a row's height; it cannot move a
                                                      column, which is what made the old
                                                      flex-wrap version unreadable. */}
                                                  <td className="px-1 py-2.5 text-end align-middle text-[11.5px] tabular-nums">
                                                    {payState && (
                                                      <span style={{ color: payState.tone }}>
                                                        {new Intl.NumberFormat(isRTL ? 'he-IL' : 'en-US', {
                                                          style: 'currency',
                                                          currency: pay!.currency,
                                                          maximumFractionDigits: pay!.amount % 1 === 0 ? 0 : 2,
                                                        }).format(pay!.amount)}
                                                        {' · '}
                                                        {payState.text}
                                                      </span>
                                                    )}
                                                  </td>

                                                  <td className="w-[64px] px-3 py-2.5 align-middle">
                                                  <MeetingRowActions
                                                    status={row.status}
                                                    meetingStatus={row.meeting_status}
                                                    startTime={row.start_time ?? null}
                                                    /*
                                                     * The PURCHASE's state, not this hour's.
                                                     * A missed session stays movable on its
                                                     * own — another time is the obvious next
                                                     * move — but not once the package it
                                                     * belongs to has been called off.
                                                     */
                                                    bookingCancelled={
                                                      session.booking.status === 'cancelled' ||
                                                      session.booking.meeting_status === 'cancelled'
                                                    }
                                                    onSetStatus={
                                                      onSetBookingStatus
                                                        ? next =>
                                                            onSetBookingStatus(
                                                              row.id,
                                                              next,
                                                              /* A session's outcome lives on the meeting. */
                                                              row.meeting_id ?? null,
                                                              /*
                                                               * Is there money still to decide on this hour?
                                                               *
                                                               * `pay` is already null for a voided stage, so
                                                               * reaching here means a live one. `pending` with
                                                               * no invoice is the only state where the answer
                                                               * is still open: billed is the client's document,
                                                               * and paid is settled.
                                                               */
                                                              Boolean(
                                                                pay &&
                                                                  pay.status === 'pending' &&
                                                                  !pay.invoiceId
                                                              )
                                                            )
                                                        : undefined
                                                    }
                                                    onReschedule={
                                                      /*
                                                       * Offered for a session too. The dialog is a time
                                                       * picker either way; the drawer notices the row is a
                                                       * MEETING and saves it at the session's own
                                                       * endpoint, which writes a second attempt and
                                                       * releases the hour the old one held.
                                                       */
                                                      onEditSession ? () => onEditSession(row.id) : undefined
                                                    }
                                                    /*
                                                      THE SAME DIALOG THE PAYMENT STAGES USE.
                                                      ───────────────────────────────────────
                                                      `onRefundStage` is named for where it
                                                      was first needed, but its contract is an
                                                      INVOICE — an id, what it was for, what
                                                      has already gone back — and a meeting
                                                      billed on its own has exactly that. So
                                                      this reuses the dialog rather than
                                                      adding a second way to return money,
                                                      which would be a second place for the
                                                      rules about partial refunds to drift.

                                                      Labelled with the meeting's date, since
                                                      that is what distinguishes it: six rows
                                                      of one package are otherwise identical
                                                      in a dialog that only names the thing.
                                                    */
                                                    refundable={Boolean(
                                                      pay?.invoiceId
                                                        && pay.status === 'paid'
                                                        && pay.amount - Number(pay.refundedAmount || 0) > 0
                                                    )}
                                                    onRefund={
                                                      onRefundStage && pay?.invoiceId
                                                        ? () =>
                                                            onRefundStage({
                                                              invoiceId: pay.invoiceId ?? null,
                                                              /* A package MEETING's money is
                                                                 always invoiced — the branch
                                                                 is gated on `pay.invoiceId`
                                                                 above — so there is no
                                                                 transaction key to offer
                                                                 here. Instalment periods are
                                                                 the ones with no invoice. */
                                                              transactionId: null,
                                                              amount: pay.amount,
                                                              refunded: Number(pay.refundedAmount || 0),
                                                              currency: pay.currency,
                                                              label: row.start_time
                                                                ? formatDate(row.start_time)
                                                                : String(row.occurrence_number ?? meetingIndex + 1),
                                                            })
                                                        : undefined
                                                    }
                                                    t={t}
                                                  />
                                                  </td>
                                                </tr>
                                              );
                                            })}

                                            {/*
                                              ─────────────────────────────────────────────
                                              WHAT IS ACTUALLY LEFT TO COLLECT.

                                              The last ROW of the same table, not a line
                                              under it: it belongs to the figures above and
                                              shares their columns, so the number lands
                                              directly beneath the per-session amounts.

                                              It exists because a package stops adding up
                                              the moment a session is called off. Six at
                                              133.33 was 800; with three off it is 533.34,
                                              and nothing on this card said so — the owner
                                              had to read six rows, notice which were
                                              struck through, and do the arithmetic.

                                              Only sessions that can still bill are counted.
                                              A called-off one has no stage left to show,
                                              which is why it contributes nothing here
                                              rather than being subtracted.
                                              ─────────────────────────────────────────────
                                            */}
                                            {(() => {
                                              const money = session.meetings
                                                .map(m => m.payment)
                                                .filter((p): p is NonNullable<typeof p> => Boolean(p));

                                              /* A package not billed per session has no
                                                 figures to total. */
                                              if (money.length === 0) return null;

                                              /*
                                               * ───────────────────────────────────────────
                                               * WHAT WENT BACK, WHICH FELL THROUGH BOTH SUMS.
                                               *
                                               * A refunded stage is neither owing nor kept,
                                               * so counting only `paid` and `pending` made
                                               * it vanish: the owner refunded a session and
                                               * the table carried no sign of it. The row
                                               * says "זוכה", and the figures beneath said
                                               * nothing at all.
                                               *
                                               * And a PARTIAL refund was worse than silent.
                                               * A stage paid 133.33 with 50 returned reads
                                               * as `refunded`, so the whole 133.33 dropped
                                               * out of what was collected — understating by
                                               * the 83.33 the business actually kept.
                                               *
                                               * So refunds are subtracted rather than used
                                               * to disqualify a stage: collected is what is
                                               * STILL HELD, which is the only figure that
                                               * can be reconciled against a bank account.
                                               * ───────────────────────────────────────────
                                               */
                                              const refunded = money.reduce(
                                                (sum, p) =>
                                                  sum +
                                                  Number(
                                                    p.refundedAmount ??
                                                      /* Returned, amount unrecorded: the whole
                                                         stage went back. */
                                                      (p.refundedAt || p.status === 'refunded'
                                                        ? p.amount || 0
                                                        : 0)
                                                  ),
                                                0
                                              );

                                              const received = money
                                                .filter(p => p.status === 'paid' || p.refundedAt || p.status === 'refunded')
                                                .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                                              const collected = Math.max(0, received - refunded);

                                              const outstanding = money
                                                .filter(p => p.status !== 'paid' && p.status !== 'refunded' && !p.refundedAt)
                                                .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                                              /*
                                               * ─────────────────────────────────────────────
                                               * HOW MANY WERE CALLED OFF, counted as that.
                                               *
                                               * This was `meetings.length - money.length`:
                                               * every session with no live stage behind it.
                                               * That set is mostly cancellations, which is why
                                               * it passed for one — but it also swept in any
                                               * session added WITHOUT a charge, a make-up for
                                               * one the client missed. The foot then said "5
                                               * cancelled" with one of the five standing in the
                                               * list above it, upcoming, going ahead free.
                                               *
                                               * The column that answers this already exists, so
                                               * ask it. A free session is now simply not
                                               * mentioned, which is the honest thing to say
                                               * about a session nobody cancelled and nobody is
                                               * paying for.
                                               * ─────────────────────────────────────────────
                                               */
                                              const dropped = session.meetings.filter(
                                                m => m.booking.meeting_status === 'cancelled'
                                              ).length;

                                              const money0 = money[0];
                                              const asMoney = (value: number) =>
                                                new Intl.NumberFormat(isRTL ? 'he-IL' : 'en-US', {
                                                  style: 'currency',
                                                  currency: money0.currency,
                                                  maximumFractionDigits: value % 1 === 0 ? 0 : 2,
                                                }).format(value);

                                              return (
                                                <tr
                                                  style={{
                                                    /* Heavier than a row seam: this is the
                                                       table's foot, not another meeting. */
                                                    borderTop: '1px solid var(--v2-border)',
                                                    background: 'var(--v2-surface)',
                                                  }}
                                                >
                                                  <td className="w-9 px-3 py-2.5" />

                                                  {/* The label starts where the dates do and
                                                      runs to the figure, so nothing in the
                                                      foot pretends to be a column it is not. */}
                                                  <td
                                                    colSpan={2}
                                                    className="truncate px-1 py-2.5 text-[11.5px] text-[var(--v2-text-muted)]"
                                                  >
                                                    {t('crm.booking.package.left_to_collect') || 'Left to collect'}
                                                    {dropped > 0 && (
                                                      <>
                                                        {' · '}
                                                        {(t('crm.booking.package.sessions_off') || '{count} cancelled')
                                                          .replace('{count}', String(dropped))}
                                                      </>
                                                    )}
                                                  </td>

                                                  {/* ── THE FOOT STAYS INSIDE THE FRAME ──────
                                                      This cell was `whitespace-nowrap` with up
                                                      to three figures on one line, and the
                                                      table is `tableLayout: fixed`: a column
                                                      cannot grow to fit its content there, so
                                                      the text simply ran out of the cell and
                                                      past the table's own border. A package
                                                      with a refund showed its totals floating
                                                      outside the bordered list.

                                                      The headline figure keeps its own line,
                                                      because a sum broken across two lines is
                                                      unreadable. The notes beside it move
                                                      underneath, where there is as much room
                                                      as they need. */}
                                                  <td className="px-1 py-2.5 text-end text-[12.5px] font-semibold tabular-nums text-[var(--v2-text-primary)]">
                                                    <span className="block whitespace-nowrap">
                                                      {asMoney(outstanding)}
                                                    </span>

                                                    {(collected > 0 || refunded > 0) && (
                                                      <span className="mt-0.5 block text-[11px] font-normal leading-snug">
                                                        {collected > 0 && (
                                                          <span className="whitespace-nowrap text-[var(--v2-text-muted)]">
                                                            {(t('crm.booking.package.already_collected') || '{amount} collected')
                                                              .replace('{amount}', asMoney(collected))}
                                                          </span>
                                                        )}
                                                        {collected > 0 && refunded > 0 && (
                                                          <span className="text-[var(--v2-text-muted)]">{' · '}</span>
                                                        )}
                                                        {refunded > 0 && (
                                                          /* Named, in the refund's own colour —
                                                             the same orange the row uses, because
                                                             a refund is a deliberate act and not
                                                             a failure. */
                                                          <span
                                                            className="whitespace-nowrap"
                                                            style={{ color: '#B54708' }}
                                                          >
                                                            {(t('crm.booking.package.already_refunded') || '{amount} refunded')
                                                              .replace('{amount}', asMoney(refunded))}
                                                          </span>
                                                        )}
                                                      </span>
                                                    )}
                                                  </td>

                                                  <td className="w-14 px-3 py-2.5" />
                                                </tr>
                                              );
                                            })()}
                                              </tbody>
                                            </table>

                                            {/* Another date on a block already under way:
                                                a make-up for one the client missed, or a
                                                seventh on a block of six.

                                                Outside the bordered list deliberately: it
                                                adds a meeting rather than being one, and
                                                inside the frame it read as a seventh row. */}
                                            {/*
                                              NOT ON A PACKAGE THAT IS OFF.
                                              ─────────────────────────────────
                                              Adding a fourteenth session to a
                                              block the owner has just called
                                              off would schedule an hour inside
                                              work that has stopped, and bill
                                              for it on a per-session package.
                                              The control stays for every live
                                              package, which is all of them
                                              until somebody stops one.
                                            */}
                                            {onAddPackageMeeting &&
                                              session.booking.status !== 'cancelled' &&
                                              session.booking.meeting_status !== 'cancelled' && (
                                              <AddPackageMeeting
                                                containerId={
                                                  (step.metadata?.containerId as string) ?? booking.id
                                                }
                                                onOpen={onAddPackageMeeting}
                                                t={t}
                                              />
                                            )}
                                          </div>
                                        )}

                                        {/* The intake answers, now the CARD'S BODY.
                                            They used to sit outside the row, indented by a
                                            hand-measured 109px to line up under the content
                                            column — a number that silently meant
                                            24 + 11 + 74, and that broke the moment any of
                                            the three changed. Inside the card it spans both
                                            columns and needs no measurement at all.

                                            This is also the one step the design opens, and
                                            an opened card that grows its own body is what
                                            makes that legible: the answers are part of this
                                            step rather than a block that happens to follow
                                            it. */}
                                        {intakeExpandable && isSectionExpanded && (
                                          <div
                                            className="mt-2.5 pt-2.5 border-t border-[var(--v2-border)]"
                                            style={{ gridColumn: '1 / -1' }}
                                          >
                                            {buildIntakeContent(booking)}
                                          </div>
                                        )}
                                          </div>{/* body */}
                                        </div>{/* card */}
                                      </div>{/* rail + node wrapper */}
                                    </div>
                                  );
                          })
                        ) : (
                          // Fallback: No journey steps provided - show message
                          <div className="text-center py-4">
                            <p className="text-sm text-[var(--v2-text-muted)]">
                              {t('crm.booking.no_journey_steps') || 'No journey steps available'}
                            </p>
                          </div>
                        )}

                        {/* Notes */}
                        {booking.notes && booking.status !== 'cancelled' && (
                          <div className="mt-2 p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
                            <p className="text-xs font-medium text-[var(--v2-text-muted)] mb-1">
                              {t('crm.journey.notes') || 'Notes'}
                            </p>
                            <p className="text-sm text-[var(--v2-text-primary)] italic">
                              {booking.notes}
                            </p>
                          </div>
                        )}

                      </div>

                  {onSetBookingStatus &&
                    /* The booking's own cancellation is the only thing that
                       retires this strip. Checked first and separately, because
                       a stopped quote must not retire it and a CANCELLED job
                       writes its quote to `stopped` — so the clause below could
                       not be trusted to tell those two apart on its own. */
                    !bookingCalledOff &&
                    /* A stopped quote keeps the footer: the booking is still
                       confirmed, still holding its hour, and closing it is
                       exactly what the banner above is asking for. */
                    (quoteState === 'stopped' ||
                      !jobIsOver({
                        status: booking.status,
                        meeting_status: booking.meeting_status,
                        isQuoted,
                        quotePaid: Boolean(quotePaid),
                        calledOff: jobCalledOff,
                      })) && (
                      /* ── THESE ARE CONTROLS, AND THEY HAVE TO LOOK LIKE IT ──
                         Reported as "they are not buttons but like a title",
                         with a screenshot that makes it obvious: they were
                         `rounded-full` outlined pills sitting beside the
                         "מאושרת" STATUS BADGE, which is also a rounded-full
                         outlined pill. Same shape reads as the same kind of
                         thing, so a row of actions looked like a row of states.

                         Two fixes, and neither is the grouping I tried first.

                         1. SHAPE. The drawer already has a button idiom — the
                            `Button` primitive, `size="sm"`, with a leading icon,
                            which is what "Edit Booking" below uses. A badge is
                            a capsule with no icon; a control is a rounded rect
                            with one. Reusing the house component is also how
                            this stops drifting the next time badges restyle.

                         2. WORDS. Every label was a STATUS key. `בוטלה` is "it
                            was cancelled" — a statement about state, not an
                            instruction, which is half of why the row read as
                            badges. The owner's own correction was "בוטלה need
                            to be בטל הזמנה". So the copy is imperative now, and
                            each label names its own subject, which is what
                            removes the "is this the booking or the meeting?"
                            ambiguity without needing group headings above them.

                         `crm.stage.mark_done` ("סימון כהושלם") is the same
                         gesture already phrased this way on the payment stages.

                         Workplan P3-1: docs/workplans/BOOKING_MEETING_SEPARATION_WORKPLAN.md */
                      /* ── THE JOB'S OWN ACTIONS, BELOW THE JOURNEY ──────────
                         They sat in the header, above everything, which made
                         the most destructive control on the card the first
                         thing under its title — and put a decision about the
                         WHOLE JOB above the stages it would cascade through.

                         A footer is where an action that ends something
                         belongs: you read what happened, then you decide. The
                         rule above it is the card's own, so the strip reads as
                         the end of the card rather than another stage on the
                         rail.

                         Ruled and padded here rather than in the header's
                         spacing, because it is no longer in the header. */
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--v2-border)] pt-3">
                        {/* ── ONE ACTION HERE, BECAUSE ONLY ONE OF THEM IS THE JOB'S ──
                            Held and no-show have moved to the meeting's own step
                            in the journey, where the row that names the time can
                            say what happened at it.

                            What is left is the only decision that belongs to the
                            BOOKING rather than to one layer inside it: calling
                            off the work, which cascades through the meeting, the
                            quote and the money. It carries the only red, and it
                            is now the only thing in this strip, so there is
                            nothing here to mistake it for. */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSetBookingStatus(booking.id, 'cancelled')}
                          className="border-red-600/40 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
                        >
                          <XCircle className="h-3.5 w-3.5 me-1.5" />
                          {t('crm.booking.action.cancel_booking') || 'Cancel booking'}
                        </Button>
                      </div>
                    )}

                      {/* ── "EDIT BOOKING" WAS THIS CARD'S SECOND RESCHEDULE ──
                          Removed, not moved. It called `onEditSession(booking.id)`
                          — the identical handler the meeting step's Reschedule
                          calls — and carried the identical gate: a scheduled
                          service whose attendance is not yet recorded. Both sat
                          inside this same expanded view, so the card offered one
                          action twice, under two names, a few rows apart.

                          Its name was also the wider of the two and wrong for
                          what it opens: `handleEditSession` loads the booking
                          modal with the service picker DISABLED and the contact
                          search hidden, which leaves the time and the notes. It
                          never edited "the booking" in any sense the word
                          implies, and sitting under a full-width rule at the
                          foot of the card it read as the card's primary action.

                          The surviving control sits on the row that names the
                          time, which is the row an owner is looking at when they
                          want to move it. Same modal, same fields, same gate.

                          Workplan P3-1: docs/workplans/BOOKING_MEETING_SEPARATION_WORKPLAN.md */}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
            )}

            {/*
              THE PAGER.

              Shown only when there is more than one page, so a contact with
              three bookings is not given controls that cannot move. The count
              describes the FILTERED set, because that is the list the reader is
              looking at — a pager that counted everything while the search had
              narrowed it would be describing a different screen.

              The copy is `payments.pagination.*`, already written in all three
              languages for the orders page. Two pagers saying the same thing in
              different words would be two answers to one question.
            */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-[var(--v2-border)] pt-3">
                <span className="text-[12px] tabular-nums text-[var(--v2-text-muted)]">
                  {(t('payments.pagination.showing') || '{from}-{to} of {total}')
                    .replace('{from}', String(page * PAGE_SIZE + 1))
                    .replace('{to}', String(Math.min((page + 1) * PAGE_SIZE, filteredSessions.length)))
                    .replace('{total}', String(filteredSessions.length))}
                </span>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    /* From the page being LOOKED AT, which is `page` — the
                       stored value may still be null, meaning the view is
                       following the focused booking. Pressing a pager is the
                       owner taking that over. */
                    onClick={() => setBookingPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="h-7 px-2 text-[12px]"
                  >
                    {/* A chevron is a picture of an arrow and does not flip with
                        direction the way `ms`/`me` do, so it is turned by hand
                        in RTL — the same treatment the orders pager uses. */}
                    <ChevronLeft className={`h-3.5 w-3.5 ${isRTL ? 'rotate-180' : ''}`} />
                    <span className="ms-1">{t('payments.pagination.prev') || 'Previous'}</span>
                  </Button>

                  <span className="px-1 text-[12px] tabular-nums text-[var(--v2-text-muted)]">
                    {page + 1}/{pageCount}
                  </span>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setBookingPage(Math.min(pageCount - 1, page + 1))}
                    disabled={page >= pageCount - 1}
                    className="h-7 px-2 text-[12px]"
                  >
                    <span className="me-1">{t('payments.pagination.next') || 'Next'}</span>
                    <ChevronRight className={`h-3.5 w-3.5 ${isRTL ? 'rotate-180' : ''}`} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
