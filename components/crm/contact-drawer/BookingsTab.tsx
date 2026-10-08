'use client';

import { useState } from 'react';
import {
  Calendar, Clock, CreditCard, ClipboardList, Mail, CheckCircle2,
  XCircle, AlertCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, Plus, Edit2,
  Loader2, ShoppingBag, Package, User, MapPin,
  Phone, AtSign, Eye, ExternalLink, Save, X, RotateCcw, Ban, FileText, Paperclip,
  type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CollapsibleSection } from '../CollapsibleSection';
import type { SessionCardData, BookingJourneyData, BookingJourneyStep } from './types';
import type { IntakeQuestion } from '@/lib/business-os/intake/types';
import { groupJourneyByDay } from '@/lib/business-os/journeyDays';
import { cancelReasonKey } from '@/lib/business-os/cancellationReasons';
import { MeetingRowActions } from './MeetingRowActions';
import { StageRowActions } from './StageRowActions';
/* Pure, no I/O — the clock rule lives beside `quoteGate` rather than in this
   three-thousand-line component, for the reason that module's header gives. */
import { isMeetingPastDue } from '@/lib/business-os/quoteGate';
/*
 * Two constants and a split, no dependencies — safe in a client component. The
 * prefix itself stays stored English because a gap and a detector match on it;
 * only the reading of it is translated.
 */
import { splitClientCancellationReason } from '@/lib/services/bookingCancellationReason';
import { useBusinessTimezone } from '@/lib/business-os/LanguageContext';
import { PaymentPlanTotals } from '@/components/payments/PaymentPlanTotals';

/**
 * Add another date to a package already under way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Its own component because it holds state — one date, one answer about the
 * money — and the journey renders many steps: a single set of fields on the tab
 * would be shared by every package on screen and open on all of them at once.
 *
 * The money question is only asked where it means anything: on a package billed
 * after each meeting, where the client is already paying session by session. On
 * one paid up front the server refuses a charge outright, because billing more
 * than the agreed sum is selling something else.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function AddPackageMeeting({
  containerId,
  billsPerMeeting,
  onAdd,
  t,
}: {
  containerId: string;
  billsPerMeeting: boolean;
  onAdd: (containerId: string, startTime: string, charge: boolean) => Promise<void> | void;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [charge, setCharge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          setOpen(true);
          setWhen('');
          setCharge(false);
          setError(null);
        }}
        className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#8B5CF6] hover:underline"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('crm.booking.package.add_meeting')}
      </button>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--v2-bg)] px-2.5 py-2"
      onClick={event => event.stopPropagation()}
    >
      <input
        type="datetime-local"
        value={when}
        onChange={event => {
          setWhen(event.target.value);
          setError(null);
        }}
        className="h-8 rounded-md border border-[var(--v2-border)] bg-[var(--v2-surface)] px-2 text-[12.5px] text-[var(--v2-text-primary)]"
      />

      {billsPerMeeting && (
        <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--v2-text-secondary)]">
          <input type="checkbox" checked={charge} onChange={event => setCharge(event.target.checked)} />
          {t('crm.booking.package.charge_it')}
        </label>
      )}

      <button
        type="button"
        disabled={!when || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onAdd(containerId, when, charge && billsPerMeeting);
            setOpen(false);
          } catch (err) {
            /*
             * Said here, where the date is: the commonest answers are "that
             * hour is taken" and "you are closed that day", and both are about
             * the field being looked at.
             */
            setError(err instanceof Error ? err.message : t('crm.booking.package.add_failed'));
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-full bg-[#8B5CF6] px-3 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-[#7C3AED] disabled:opacity-50"
      >
        {busy ? t('crm.booking.package.adding') : t('crm.booking.package.add_confirm')}
      </button>

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="text-[11.5px] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
      >
        {t('button.cancel')}
      </button>

      {error && <p className="w-full text-[11.5px] text-red-500">{error}</p>}
    </div>
  );
}

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
    invoiceId: string;
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
   * Send the confirmation email again — the "reminder" action on the journey.
   *
   * Optional and NOT yet wired by the drawer: the button is rendered so the
   * strip matches the agreed design, and it is inert until a handler is passed.
   * Deliberately not pointed at `onSendInvoice`, which sends a different email
   * entirely — a button that does the wrong thing is worse than one that waits.
   */
  onResendConfirmation?: (bookingId: string) => Promise<void> | void;
  /**
   * Record how an appointment actually went, from the card header.
   *
   * The edit dialog has always been able to set this; reaching it meant opening
   * a form about times and prices to answer a question — did they turn up? —
   * that the card itself is showing.
   */
  onSetBookingStatus?: (
    bookingId: string,
    status: 'completed' | 'no_show' | 'cancelled'
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
  onAddPackageMeeting?: (
    containerId: string,
    startTime: string,
    charge: boolean
  ) => Promise<void> | void;
  /** Whether this purchase is billed per meeting, which decides the money question. */
  packageBillsPerMeeting?: (containerId: string) => boolean;
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
type StepStatus = 'completed' | 'active' | 'pending' | 'failed' | 'skipped';

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
  skipped: {
    bg: 'bg-slate-500/50',
    border: 'border-slate-500/50',
    icon: 'text-slate-400',
    line: 'bg-slate-500/50',
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
  intake: ClipboardList,
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
  onResendConfirmation,
  onSetBookingStatus,
  onAddPackageMeeting,
  packageBillsPerMeeting,
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
  const [expandedBookings, setExpandedBookings] = useState<Set<string>>(
    () => (focusBookingId ? new Set([focusBookingId]) : new Set())
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
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
  const [bookingPage, setBookingPage] = useState(0);
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
  const sortedSessions = [...sessions].sort((a, b) => {
    const now = new Date();
    const aDate = a.booking.start_time ? new Date(a.booking.start_time) : (a.booking.created_at ? new Date(a.booking.created_at) : new Date());
    const bDate = b.booking.start_time ? new Date(b.booking.start_time) : (b.booking.created_at ? new Date(b.booking.created_at) : new Date());
    const aUpcoming = a.booking.status === 'confirmed' && a.booking.start_time && aDate > now;
    const bUpcoming = b.booking.status === 'confirmed' && b.booking.start_time && bDate > now;

    if (aUpcoming && !bUpcoming) return -1;
    if (!aUpcoming && bUpcoming) return 1;
    if (aUpcoming && bUpcoming) return aDate.getTime() - bDate.getTime();
    return bDate.getTime() - aDate.getTime();
  });


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
    meetingState: 'ahead' | 'unmarked' | 'settled'
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
  const page = Math.min(bookingPage, pageCount - 1);
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
                    // Back to the first page: the results under the reader have
                    // just changed, and page 3 of the previous set means nothing
                    // about this one.
                    setBookingPage(0);
                  }}
                  placeholder={t('crm.drawer.search_bookings') || 'Search bookings'}
                  className="w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] ps-9 pe-8 py-2 text-[13px] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] focus:border-transparent"
                />
                {bookingSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setBookingSearch('');
                      setBookingPage(0);
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
              const quotePaid = session.journeySteps?.some(
                s => s.key === 'payment' && s.status === 'completed'
              );

              const statusInfo = isQuoted
                ? getQuotedStatusLabel(
                    booking.status,
                    quoteState,
                    Boolean(quotePaid),
                    proposalStep?.metadata?.waitingOn === 'meeting'
                      ? 'ahead'
                      : proposalStep?.metadata?.waitingOn === 'unmarked'
                        ? 'unmarked'
                        : 'settled'
                  )
                : getBookingStatusLabel(booking.status, !isUnscheduled, booking.payment_status !== undefined && booking.payment_status !== 'paid', booking.start_time);
              const bookingDate = booking.start_time ? new Date(booking.start_time) : null;
              const isUpcoming = booking.status === 'confirmed' && bookingDate && bookingDate > new Date();
              const isPendingUnscheduled = isUnscheduled && booking.status !== 'completed' && booking.status !== 'cancelled';

              const hasIntake = booking.intake_responses && Object.keys(booking.intake_responses.responses || {}).length > 0;

              return (
                <div
                  key={booking.id}
                  className={`border rounded-lg overflow-hidden transition-all ${
                    isUpcoming
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : isPendingUnscheduled
                      ? 'border-purple-500/50 bg-purple-500/5'
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
                          booking.status === 'completed' ? 'text-green-500' :
                          booking.status === 'cancelled' ? 'text-red-500' :
                          'text-purple-500'
                        }`} />
                      ) : (
                        <Calendar className={`h-5 w-5 flex-shrink-0 ${
                          booking.status === 'completed' ? 'text-green-500' :
                          booking.status === 'confirmed' ? 'text-amber-500' :
                          booking.status === 'cancelled' ? 'text-red-500' :
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
                      {booking.status === 'cancelled' &&
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
                  {onSetBookingStatus &&
                    booking.status !== 'completed' &&
                    booking.status !== 'cancelled' &&
                    booking.status !== 'no_show' && (
                      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                        <button
                          type="button"
                          onClick={() => onSetBookingStatus(booking.id, 'completed')}
                          className="px-3 py-1 rounded-full text-[12px] font-medium border border-green-600/40 text-green-700 dark:text-green-400 hover:bg-green-500/10 transition-colors"
                        >
                          {/* "Completed" for a session that was held; the same
                              word serves an order that was delivered.

                              On a quoted booking it means neither — the
                              consultation happened and the job has barely
                              started — so the button says what the click
                              actually records. The stored value is still
                              `completed`, which is true of the APPOINTMENT;
                              only the word changes. */}
                          {isQuoted
                            ? t('crm.booking.quoted.meeting_held')
                            : t('crm.booking.status.completed') || 'Completed'}
                        </button>

                        {/* The one that needs a time to mean anything. */}
                        {!isUnscheduled && (
                          <button
                            type="button"
                            onClick={() => onSetBookingStatus(booking.id, 'no_show')}
                            className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
                          >
                            {t('crm.booking.status.no_show') || 'No show'}
                          </button>
                        )}

                        {/* Last, and the only one in red: it reaches the client. */}
                        <button
                          type="button"
                          onClick={() => onSetBookingStatus(booking.id, 'cancelled')}
                          className="px-3 py-1 rounded-full text-[12px] font-medium border border-red-600/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          {t('crm.booking.status.cancelled') || 'Cancel'}
                        </button>
                      </div>
                    )}

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
                          groupJourneyByDay(session.journeySteps).map(group => {
                            if (group.kind === 'wait') {
                              return (
                                <div
                                  key={group.key}
                                  className="relative py-3.5 text-[11.5px] text-[var(--v2-text-muted)]"
                                  /* 52px = the rail gutter (40) plus the card's own
                                     horizontal padding (12), so this line starts exactly
                                     where the text in every card above and below it does.
                                     It was 51px, measured against the row layout the cards
                                     replaced. */
                                  style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: '52px' }}
                                >
                                  {/* The rail carries through the gap: the line is
                                      still the journey, it just has nothing on it. */}
                                  <span
                                    className="absolute top-0 bottom-0 border-s-2 border-dashed border-[var(--v2-border)]"
                                    style={{ [isRTL ? 'right' : 'left']: '11px' }}
                                    aria-hidden="true"
                                  />
                                  {(t('crm.journey.wait_days') || '{count} days of waiting')
                                    .replace('{count}', String(group.days))}
                                </div>
                              );
                            }

                            return (
                              <div key={group.key}>
                                {/* One marker per DAY, not a date repeated on
                                    every row. */}
                                <div className="flex items-baseline gap-2 pt-4 pb-2">
                                  {group.date ? (
                                    <>
                                      {/* The day marker names the business's
                                          day. Read on the owner's laptop, a
                                          step near midnight sat under the
                                          neighbouring date's heading. */}
                                      <span className="text-[16px] font-bold leading-none text-[var(--v2-text-primary)]">
                                        {new Intl.DateTimeFormat(language, timeZoneOptions({ day: 'numeric' })).format(group.date)}
                                      </span>
                                      <span className="text-[11px] tracking-wide text-[var(--v2-text-muted)]">
                                        {new Intl.DateTimeFormat(language, timeZoneOptions({ month: 'short' })).format(group.date)}
                                      </span>
                                    </>
                                  ) : (
                                    /*
                                     * UNDATED IS NOT THE SAME AS UPCOMING.
                                     *
                                     * `groupJourneyByDay` buckets every step with no
                                     * timestamp together, on the reasonable assumption that
                                     * a step with no date has not happened yet — the session
                                     * ahead, an intake not yet returned. This heading then
                                     * stated that assumption as fact.
                                     *
                                     * It is wrong whenever a step HAS happened and its time
                                     * was never recorded. The payment step is the live case:
                                     * its timestamp is `refundedAt || paidAt`, and 11 of the
                                     * 13 paid bookings on this account have no `paid_at` on
                                     * either the transaction or the invoice. A payment that
                                     * has been taken was filed under "Upcoming".
                                     *
                                     * So the heading reads the steps it actually holds. If
                                     * any of them is still to come, the group is upcoming.
                                     * If they have all happened, the only honest thing to
                                     * say is that we do not know when.
                                     */
                                    <span className="text-[11px] text-[var(--v2-text-muted)]">
                                      {group.steps.some(s => s.status === 'pending' || s.status === 'active')
                                        ? t('crm.journey.upcoming') || 'Upcoming'
                                        : isUnscheduled
                                          /*
                                           * NOTHING, on a sale with no appointment.
                                           * ───────────────────────────────────────
                                           * This slot holds a DATE on every other
                                           * group. A service sold without a meeting
                                           * has none, and every wording tried here
                                           * described an absence: "time not
                                           * recorded" claimed a clock had been lost,
                                           * "no appointment" announced the lack of a
                                           * thing this sale never involved. Both
                                           * read as a date that failed to load.
                                           *
                                           * The step below it — service delivery —
                                           * already says what it is and whether it
                                           * has happened. A label that only restates
                                           * what is missing is worse than no label.
                                           */
                                          ? ''
                                          : t('crm.journey.undated') || 'Time not recorded'}
                                    </span>
                                  )}
                                  <span className="flex-1 h-px bg-[var(--v2-border)]" aria-hidden="true" />
                                </div>

                                {group.steps.map((step, index) => {
                                  const StepIcon = STEP_ICONS[step.key] || CheckCircle2;

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
                                  const outcomeTitle =
                                    isFinalStep && booking.status === 'completed'
                                      ? isMeetingStep
                                        ? t('crm.booking.quoted.meeting_held')
                                        : t('crm.booking.step.booking_completed')
                                      : isFinalStep &&
                                          (booking.status === 'cancelled' || booking.status === 'no_show')
                                        ? t('crm.booking.step.booking_cancelled')
                                        : null;

                                  const stepTitle =
                                    step.label || outcomeTitle || t(`crm.booking.step.${step.key}`) || step.key;
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
                                  const isScheduleStep = step.key === 'session' || step.key === 'schedule';
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

                                  const cancelledUnpaid =
                                    isPaymentStep &&
                                    booking.status === 'cancelled' &&
                                    paymentExpected &&
                                    !moneyMoved;

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
                                  const meetingSettled =
                                    booking.status === 'completed' ||
                                    booking.status === 'cancelled' ||
                                    booking.status === 'no_show';

                                  /*
                                   * Is the JOB over?
                                   *
                                   * A different question, and for a quoted
                                   * booking a different answer: the
                                   * consultation being held ends the meeting
                                   * and starts the work. Only the card-level
                                   * state reads this.
                                   */
                                  const settledStatus = isQuoted
                                    ? booking.status === 'cancelled' || Boolean(quotePaid)
                                    : meetingSettled;

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
                                          meetingSettled
                                            ? // The same word the button used.
                                              // Pressing "הפגישה התקיימה" and
                                              // being told "הושלם" reads as a
                                              // different outcome than the one
                                              // just recorded.
                                              isQuoted && booking.status === 'completed'
                                              ? t('crm.booking.quoted.meeting_held')
                                              : getBookingStatusLabel(booking.status, !isUnscheduled, booking.payment_status !== undefined && booking.payment_status !== 'paid', booking.start_time).text
                                            : new Date(booking.start_time) > new Date()
                                              ? t('crm.journey.not_yet_held') || 'Not yet held'
                                              : t('crm.journey.awaiting_outcome') || 'Awaiting an outcome'
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
                                    isIntakeStep && !hasIntake && onSendIntake && booking.status !== 'cancelled'
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
                                    (isScheduleStep && onEditSession && !isUnscheduled && !meetingSettled) ||
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
                                        style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: '40px', paddingBottom: '8px' }}
                                      >
                                        {/* The rail, behind the nodes and continuous through
                                            the gap between cards. `inset-block` rather than
                                            top/bottom-0 so it meets the wait markers, which
                                            draw the same line dashed. */}
                                        <span
                                          className="absolute w-0.5 bg-[var(--v2-border)]"
                                          style={{ [isRTL ? 'right' : 'left']: '11px', top: 0, bottom: 0 }}
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
                                            isIntakeStep && !hasIntake
                                              ? t('crm.intake.send_form') || 'Send intake form'
                                              : isPaymentStep && step.metadata?.canResend
                                                ? t('crm.invoice.resend') || 'Resend invoice'
                                                : undefined
                                          }
                                          className={`absolute z-10 w-[22px] h-[22px] rounded-full flex items-center justify-center border-2 ${colors.bg} ${colors.border} ${
                                            onNodeClick && !nodeLoading
                                              ? 'cursor-pointer hover:scale-110 transition-transform'
                                              : 'cursor-default'
                                          }`}
                                          /* Ringed in the card's own background so the rail
                                             appears to pass behind the node rather than
                                             through it. `top` aligns it with the first line
                                             of the card header, not the card's box. */
                                          style={{
                                            [isRTL ? 'right' : 'left']: '1px',
                                            top: '10px',
                                            boxShadow: '0 0 0 3px var(--v2-surface)',
                                          }}
                                        >
                                          {nodeLoading ? (
                                            <Loader2 className={`h-3 w-3 ${colors.icon} animate-spin`} />
                                          ) : (
                                            <StepIcon className={`h-3 w-3 ${colors.icon}`} />
                                          )}
                                        </button>

                                        {/* The card. Everything that happened at this node.

                                            `items-baseline` is kept from the row it replaces:
                                            the label and the first line of the content have
                                            to sit on one line, or a one-word step and a
                                            three-line one stop agreeing. */}
                                        <div
                                          /* `overflow-hidden` so the header's band stops at
                                             the rounded corners instead of squaring them off.
                                             No longer `relative`: the clock it used to anchor
                                             now sits in the header's own flex row. */
                                          className="overflow-hidden rounded-[10px] border border-[var(--v2-border)] bg-[var(--v2-bg)]"
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
                                            className={`flex items-baseline gap-2 px-3 py-2 bg-[var(--v2-surface)] ${
                                              hasCardBody ? 'border-b border-[var(--v2-border)]' : ''
                                            }`}
                                          >
                                            <span className="text-[12px] font-medium leading-[1.5] text-[var(--v2-text-secondary)] break-words">
                                              {stepTitle}
                                            </span>

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
                                            {step.timestamp && (
                                              <span className="ms-auto text-[11.5px] tabular-nums text-[var(--v2-text-muted)] whitespace-nowrap">
                                                {formatTime(step.timestamp)}
                                              </span>
                                            )}
                                          </div>

                                          {/* ── The body ─────────────────────────────────
                                              One column now. The label's 74px column left
                                              with the header, so everything that used to sit
                                              in column 2 sits in column 1 and starts at the
                                              card's own padding. */}
                                          <div
                                            className="grid items-baseline px-3 py-2.5 empty:hidden empty:py-0"
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
                                            className="text-[14.5px] font-medium leading-[1.5] text-[var(--v2-text-primary)] break-words"
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
                                            <div
                                              className="flex flex-col gap-0.5"
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
                                                  className="text-[12px] leading-[1.5] break-words"
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
                                                      .join(' — ')
                                                  : step.metadata?.proposalStatus === 'expired'
                                                    ? t('crm.proposal.expired')
                                                    : step.metadata?.proposalStatus === 'viewed'
                                                      ? t('crm.proposal.viewed')
                                                      : step.metadata?.waitingOn === 'owner'
                                                        ? t('crm.proposal.waiting_on_you')
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
                                                      className="ms-auto shrink-0 text-[11.5px] tabular-nums"
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
                                                  <span
                                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                    style={{
                                                      background: paid
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
                                                      {paid && stage.paidAt
                                                        ? `${t('crm.stage.paid')} ${stageDate(stage.paidAt)}`
                                                        : stopped
                                                          // Its old due date is no longer a fact
                                                          // about this period — saying "due 7 Oct"
                                                          // of something called off is the whole
                                                          // confusion this fixes.
                                                          ? t('payments.plan.status.cancelled')
                                                        : stage.dueDate
                                                          ? `${t('crm.payment.due')} ${stageDate(stage.dueDate)}`
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
                                                    paid={paid}
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
                                                    onRefund={
                                                      onRefundStage
                                                        ? () =>
                                                            onRefundStage({
                                                              invoiceId: stage.invoiceId as string,
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
                                            <span
                                              className="flex items-center gap-1.5 text-[12.5px] leading-[1.5] text-orange-600"
                                              style={{ gridColumn: 1 }}
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
                                            </span>
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
                                              color: meetingSettled
                                                ? 'var(--v2-text-muted)'
                                                : scheduleAwaiting
                                                  ? '#B54708'
                                                  : 'var(--v2-text-muted)',
                                            }}
                                          >
                                            <span
                                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                                              style={{
                                                background: meetingSettled
                                                  ? '#22C58B'
                                                  : scheduleAwaiting
                                                    ? '#B54708'
                                                    : 'var(--v2-border)',
                                              }}
                                              aria-hidden="true"
                                            />
                                            {scheduleDetail}
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
                                              <span className="px-2.5 py-0.5 rounded-full text-[11.5px] font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400">
                                                {payment?.status === 'refunded'
                                                  ? t('crm.payment.status.refunded') || 'Refunded'
                                                  : t('crm.payment.status.partially_refunded_short') || 'Partially refunded'}
                                              </span>
                                            )}

                                          {cancelledUnpaid && (
                                            <span className="px-2.5 py-0.5 rounded-full text-[11.5px] font-medium bg-gray-500/10 text-gray-600 dark:text-gray-400">
                                              {t('crm.payment.request_cancelled') ||
                                                'Payment request cancelled'}
                                            </span>
                                          )}

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
                                          {isPaymentStep && onManagePayment && paymentExpected && !cancelledUnpaid && (
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
                                          {isProposalStep
                                            && onOpenProposalBuilder
                                            && (step.metadata?.waitingOn === 'owner'
                                              || step.metadata?.waitingOn === 'unmarked'
                                              || step.metadata?.waitingOn === 'noshow')
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

                                          {isIntakeStep && !hasIntake && onSendIntake && booking.status !== 'cancelled' && (
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
                                          {isConfirmationStep && step.status === 'completed' && !meetingSettled && (
                                            <button
                                              type="button"
                                              disabled={!onResendConfirmation}
                                              title={onResendConfirmation ? undefined : t('crm.journey.not_wired') || 'Not connected yet'}
                                              onClick={e => {
                                                e.stopPropagation();
                                                onResendConfirmation?.(booking.id);
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

                                          {isScheduleStep && onEditSession && !isUnscheduled && !meetingSettled && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onEditSession(booking.id);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
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
                                            <div
                                              className="flex flex-col gap-px"
                                              style={{
                                                borderRadius: '10px',
                                                border: '1px solid var(--v2-border)',
                                              }}
                                            >
                                            {session.meetings.map((meeting, meetingIndex) => {
                                              const row = meeting.booking;
                                              const held = row.status === 'completed';
                                              const off =
                                                row.status === 'cancelled' || row.status === 'no_show';
                                              const meetingStatus = getBookingStatusLabel(row.status, true, false, row.start_time);

                                              return (
                                                <div
                                                  key={row.id}
                                                  className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2"
                                                >
                                                  {/* The state, in no space at all — the
                                                      same four colours every other list on
                                                      this card uses. */}
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

                                                  <span className="w-4 shrink-0 text-[11px] font-semibold tabular-nums text-[var(--v2-text-muted)]">
                                                    {row.occurrence_number ?? meetingIndex + 1}
                                                  </span>

                                                  <span
                                                    className={`text-[12.5px] ${
                                                      off
                                                        ? 'text-[var(--v2-text-muted)] line-through'
                                                        : 'text-[var(--v2-text-primary)]'
                                                    }`}
                                                  >
                                                    {row.start_time ? formatDate(row.start_time) : '—'}
                                                  </span>

                                                  {/* The word keeps its colour and loses the
                                                      filled pill. Six solid chips reading
                                                      down a card look like six alerts; the
                                                      colour alone still separates held from
                                                      cancelled from past due. */}
                                                  <span
                                                    className={`text-[11.5px] ${meetingStatus.color}`}
                                                  >
                                                    {meetingStatus.text}
                                                  </span>

                                                  <MeetingRowActions
                                                    status={row.status}
                                                    startTime={row.start_time ?? null}
                                                    onSetStatus={
                                                      onSetBookingStatus
                                                        ? next => onSetBookingStatus(row.id, next)
                                                        : undefined
                                                    }
                                                    onReschedule={
                                                      onEditSession ? () => onEditSession(row.id) : undefined
                                                    }
                                                    t={t}
                                                  />
                                                </div>
                                              );
                                            })}
                                            </div>

                                            {/* Another date on a block already under way:
                                                a make-up for one the client missed, or a
                                                seventh on a block of six.

                                                Outside the bordered list deliberately: it
                                                adds a meeting rather than being one, and
                                                inside the frame it read as a seventh row. */}
                                            {onAddPackageMeeting && (
                                              <AddPackageMeeting
                                                containerId={
                                                  (step.metadata?.containerId as string) ?? booking.id
                                                }
                                                billsPerMeeting={Boolean(
                                                  packageBillsPerMeeting?.(
                                                    (step.metadata?.containerId as string) ?? booking.id
                                                  )
                                                )}
                                                onAdd={onAddPackageMeeting}
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
                                })}
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

                      {/* Edit — only while the booking can still change.
                          A completed appointment, a cancellation or a no-show is a
                          record of what happened; editing its time afterwards
                          rewrites history and, for a completed one, contradicts the
                          outcome the owner just recorded. */}
                      {onEditSession &&
                        !isUnscheduled &&
                        booking.status !== 'completed' &&
                        booking.status !== 'cancelled' &&
                        booking.status !== 'no_show' && (
                        <div className="mt-4 pt-3 border-t border-[var(--v2-border)]">
                          <Button
                            type="button"
                            onClick={() => onEditSession(booking.id)}
                            size="sm"
                            variant="outline"
                            className="w-full border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                          >
                            <Edit2 className="h-4 w-4 me-2" />
                            {t('crm.booking.edit') || 'Edit Booking'}
                          </Button>
                        </div>
                      )}
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
                    onClick={() => setBookingPage(p => Math.max(0, p - 1))}
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
                    onClick={() => setBookingPage(p => Math.min(pageCount - 1, p + 1))}
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
