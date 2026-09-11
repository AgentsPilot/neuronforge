'use client';

import { useState } from 'react';
import {
  Calendar, Clock, CreditCard, ClipboardList, Mail, CheckCircle2,
  XCircle, AlertCircle, ChevronDown, ChevronUp, Plus, Edit2,
  Loader2, ShoppingBag, Package, Truck, Gift, User, MapPin,
  Phone, AtSign, Eye, ExternalLink, Save, X, RotateCcw, Ban, FileText, Paperclip,
  type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CollapsibleSection } from '../CollapsibleSection';
import type { SessionCardData, BookingJourneyData, BookingJourneyStep } from './types';
import type { IntakeQuestion } from '@/lib/business-os/intake/types';
import { groupJourneyByDay } from '@/lib/business-os/journeyDays';

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
  onOpenProposalBuilder?: (
    bookingId: string,
    context: { supersedesId: string | null; declineReason: string | null; declineNote: string | null }
  ) => void;
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
  isLoading?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
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
  viewed: { dot: '#4F6EF7', text: '#3450C7' },
  sent: { dot: '#9AA1B2', text: 'var(--v2-text-muted)' },
};

const STEP_ICONS: Record<string, LucideIcon> = {
  // Service/Product steps
  service: Calendar,
  product: ShoppingBag,
  booked: Calendar,
  ordered: ShoppingBag,
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
  // Fulfillment (products)
  fulfillment: Package,
  fulfilled: Gift,
  shipped: Truck,
  delivered: Package,
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
  onOpenProposalBuilder,
  onSendInvoice,
  onResendConfirmation,
  onSetBookingStatus,
  isLoading = false,
  isOpen,
  onToggle
}: BookingsTabProps) {
  const [expandedBookings, setExpandedBookings] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
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
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatShortDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language, {
      month: 'short',
      day: 'numeric'
    });
  };

  /** Just the clock: the day already has its own marker above the entries. */
  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString(language, {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString(language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  // Check if booking is a product (no time slot)
  const isProductBooking = (booking: SessionCardData['booking']) => {
    return !booking.start_time || booking.service?.is_product;
  };

  /*
   * The badge on a booking header.
   *
   * Turns on whether a time was BOOKED, not on any notion of a product —
   * nothing in the data says "product", and the start time is the only thing
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
     * Whether the consultation is still ahead — taken from the journey step,
     * which already weighed the booking's start time against now. Re-deriving
     * it from `status === 'confirmed'` here would call a meeting that finished
     * this morning "upcoming", because nothing marks a booking past.
     */
    meetingAhead: boolean
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
    if (quoteState === 'sent' || quoteState === 'viewed') {
      return { text: t('crm.booking.quoted.sent'), ...blue };
    }
    // No quote yet. Before the meeting it is simply upcoming; after it, the
    // owner owes the client a price, and that is the whole point of the badge.
    return meetingAhead
      ? { text: t('crm.booking.status.confirmed') || 'Upcoming', ...amber }
      : { text: t('crm.booking.quoted.awaiting_quote'), ...amber };
  };

  const getBookingStatusLabel = (status: string, hasSchedule = true) => {
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
      // `pending` was missing, so it fell through to the fallback below and
      // rendered the raw database value — an English "pending" sitting in the
      // middle of a Hebrew card. It is the status every unpaid booking has.
      pending: { text: t('crm.booking.status.pending') || 'Awaiting payment', color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/10' }
    };
    return labels[status] || { text: status, color: 'text-[var(--v2-text-muted)]', bgColor: 'bg-[var(--v2-surface)]' };
  };

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
            {sortedSessions.map((session) => {
              const { booking, payment, journeyData } = session;
              const isExpanded = expandedBookings.has(booking.id);
              // Declared first: the badge's wording depends on it.
              const isProduct = isProductBooking(booking);

              /*
               * A quoted booking is a CONSULTATION inside a longer job.
               *
               * Everything below that reads `booking.status` as "is this over"
               * has to ask a different question here: the appointment reaching
               * its end is step two of six, not the finish.
               */
              const isQuoted = booking.service?.sale_mode === 'proposal';
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
                  )
                : getBookingStatusLabel(booking.status, !isProduct);
              const bookingDate = booking.start_time ? new Date(booking.start_time) : null;
              const isUpcoming = booking.status === 'confirmed' && bookingDate && bookingDate > new Date();
              const isPendingProduct = isProduct && booking.status !== 'completed' && booking.status !== 'cancelled';

              const hasIntake = booking.intake_responses && Object.keys(booking.intake_responses.responses || {}).length > 0;

              return (
                <div
                  key={booking.id}
                  className={`border rounded-lg overflow-hidden transition-all ${
                    isUpcoming
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : isPendingProduct
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
                      {isProduct ? (
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
                          {isProduct ? (
                            <bdi>
                              {t('crm.booking.purchased_on') || 'Purchased'}{' '}
                              {formatShortDate(booking.created_at || new Date().toISOString())}
                            </bdi>
                          ) : booking.start_time ? (
                            <bdi>{formatDate(booking.start_time)}</bdi>
                          ) : null}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusInfo.color} ${statusInfo.bgColor}`}>
                        {statusInfo.text}
                      </span>

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
                        {!isProduct && (
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
                                  style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: '51px' }}
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
                                      <span className="text-[16px] font-bold leading-none text-[var(--v2-text-primary)]">
                                        {group.date.getDate()}
                                      </span>
                                      <span className="text-[11px] tracking-wide text-[var(--v2-text-muted)]">
                                        {new Intl.DateTimeFormat(language, { month: 'short' }).format(group.date)}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-[11px] text-[var(--v2-text-muted)]">
                                      {t('crm.journey.upcoming') || 'Upcoming'}
                                    </span>
                                  )}
                                  <span className="flex-1 h-px bg-[var(--v2-border)]" aria-hidden="true" />
                                </div>

                                {group.steps.map((step, index) => {
                                  const StepIcon = STEP_ICONS[step.key] || CheckCircle2;

                                  const stepTitle = step.label || t(`crm.booking.step.${step.key}`) || step.key;
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
                                  const scheduleFact =
                                    isScheduleStep && !step.details && booking.start_time
                                      ? booking.end_time
                                        ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
                                        : formatTime(booking.start_time)
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

                                  const scheduleDetail =
                                    isScheduleStep && booking.start_time
                                      ? [
                                          new Intl.DateTimeFormat(language, { weekday: 'long' })
                                            .format(new Date(booking.start_time)),
                                          meetingSettled
                                            ? // The same word the button used.
                                              // Pressing "הפגישה התקיימה" and
                                              // being told "הושלם" reads as a
                                              // different outcome than the one
                                              // just recorded.
                                              isQuoted && booking.status === 'completed'
                                              ? t('crm.booking.quoted.meeting_held')
                                              : getBookingStatusLabel(booking.status, !isProduct).text
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

                                  return (
                                    <div key={sectionKey}>
                                      <div
                                        className="relative grid items-baseline py-3 border-t border-[var(--v2-border)] first:border-t-0"
                                        style={{ gridTemplateColumns: '24px 74px minmax(0, 1fr)', columnGap: '11px', rowGap: '2px' }}
                                      >
                                        {/* The connector, behind the nodes. */}
                                        <span
                                          className="absolute top-0 bottom-0 w-0.5 bg-[var(--v2-border)]"
                                          style={{ [isRTL ? 'right' : 'left']: '11px' }}
                                          aria-hidden="true"
                                        />

                                        {/* The node. Still the control it was. */}
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
                                          className={`relative z-10 justify-self-center w-[22px] h-[22px] rounded-full flex items-center justify-center border-2 ${colors.bg} ${colors.border} ${
                                            onNodeClick && !nodeLoading
                                              ? 'cursor-pointer hover:scale-110 transition-transform'
                                              : 'cursor-default'
                                          }`}
                                          style={{ gridColumn: 1, gridRow: 1 }}
                                        >
                                          {nodeLoading ? (
                                            <Loader2 className={`h-3 w-3 ${colors.icon} animate-spin`} />
                                          ) : (
                                            <StepIcon className={`h-3 w-3 ${colors.icon}`} />
                                          )}
                                        </button>

                                        {/* The spine: every label starts here. */}
                                        <span
                                          className="text-[12px] leading-[1.5] text-[var(--v2-text-muted)] break-words"
                                          style={{ gridColumn: 2, gridRow: 1 }}
                                        >
                                          {stepTitle}
                                        </span>

                                        {/* The clock. The day is already named
                                            above, so the row only needs the time. */}
                                        {(scheduleDuration || step.timestamp) && (
                                          <span
                                            className="absolute top-3 text-[11.5px] tabular-nums text-[var(--v2-text-muted)] whitespace-nowrap"
                                            style={{ [isRTL ? 'left' : 'right']: '0' }}
                                          >
                                            {scheduleDuration ?? formatTime(step.timestamp!)}
                                          </span>
                                        )}

                                        {/* What happened. */}
                                        {showAccount ? (
                                          <div
                                            className="grid items-baseline mt-0.5"
                                            style={{
                                              gridColumn: 3,
                                              gridTemplateColumns: 'minmax(0, 1fr) auto',
                                              gap: '4px 18px',
                                              maxWidth: 'min(290px, 100% - 46px)'
                                            }}
                                          >
                                            {/* An account, not a number: charged,
                                                returned, and a ruled total. A block
                                                that has to add up cannot hide a
                                                partial refund behind the gross. */}
                                            <span className="text-[12.5px] text-[var(--v2-text-muted)] break-words">
                                              {t('crm.journey.charged') || 'Charged'}
                                            </span>
                                            <span className="text-[13px] tabular-nums text-[var(--v2-text-secondary)] text-end whitespace-nowrap">
                                              {formatAmount(charged, payment!.currency)}
                                            </span>

                                            {refunded > 0 && (
                                              <>
                                                <span className="text-[12.5px] text-orange-600 dark:text-orange-400 break-words">
                                                  {t('crm.journey.returned') || 'Refunded'}
                                                  {payment!.refundedAt
                                                    ? ` · ${formatShortDate(payment!.refundedAt)}`
                                                    : ''}
                                                </span>
                                                {/* `bdi` so the minus stays ON the
                                                    number. In an RTL row a bare
                                                    "−$100.00" is reordered by the
                                                    bidi algorithm and renders as
                                                    "$100.00−", which reads like a
                                                    typo rather than a deduction. */}
                                                <bdi className="text-[13px] tabular-nums text-orange-600 dark:text-orange-400 text-end whitespace-nowrap">
                                                  −{formatAmount(refunded, payment!.currency)}
                                                </bdi>

                                                <span
                                                  className="h-px bg-[var(--v2-border)]"
                                                  style={{ gridColumn: '1 / -1', margin: '3px 0 1px' }}
                                                  aria-hidden="true"
                                                />

                                                <span className="text-[12.5px] font-medium text-[var(--v2-text-secondary)]">
                                                  {t('crm.journey.kept') || 'You keep'}
                                                </span>
                                                <span className="text-[17px] font-medium tabular-nums text-green-600 dark:text-green-400 text-end whitespace-nowrap">
                                                  {formatAmount(Math.max(0, charged - refunded), payment!.currency)}
                                                </span>
                                              </>
                                            )}
                                          </div>
                                        ) : (
                                          <span
                                            className="text-[14.5px] font-medium leading-[1.5] text-[var(--v2-text-primary)] break-words"
                                            style={{ gridColumn: 3, gridRow: 1, paddingInlineEnd: '46px' }}
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
                                            {isProposalStep ? (
                                              <span className="tabular-nums">{step.details || ''}</span>
                                            ) : (
                                              step.details ||
                                              scheduleFact ||
                                              (isConfirmationStep && step.status === 'completed'
                                                ? t('crm.booking.email_sent')
                                                : '')
                                            )}
                                          </span>
                                        )}

                                        {/* Supporting detail — a plan's terms,
                                            the answer count — under the fact. */}

                                        {/* What is happening to the quote. Always
                                            rendered: a quote with no state is a
                                            row the owner cannot act on, and before
                                            one exists this line IS the content. */}
                                        {isProposalStep && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)] break-words"
                                            style={{ gridColumn: 3 }}
                                          >
                                            {step.metadata?.waitingOn === 'closed'
                                              ? t('crm.proposal.closed')
                                              : step.metadata?.waitingOn === 'meeting'
                                              ? `${t('crm.proposal.after_meeting')} ${step.metadata?.meetingAt ?? ''}`.trim()
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
                                        {isProposalStep &&
                                          proposalVersions.length > 1 && (
                                            <div
                                              className="mt-2 flex flex-col gap-px overflow-hidden"
                                              style={{
                                                gridColumn: 3,
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
                                                  <div className="flex items-center gap-2">
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
                                                  </div>

                                                  {/* What the client said, under
                                                      the version they said it
                                                      about. Their typed note
                                                      wins over the category:
                                                      "we only have 8k budget"
                                                      is worth more than "too
                                                      expensive". */}
                                                  {version.status === 'declined' &&
                                                    (version.declineReason || version.declineNote) && (
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
                                        {showAccount && payment?.plan && step.details && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)] break-words"
                                            style={{ gridColumn: 3 }}
                                          >
                                            {step.details}
                                          </span>
                                        )}

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
                                          <div
                                            className="mt-2 flex flex-col gap-px overflow-hidden"
                                            style={{
                                              gridColumn: 3,
                                              borderRadius: '10px',
                                              border: '1px solid var(--v2-border)',
                                            }}
                                          >
                                            {payment.plan.stages.map((stage, i) => {
                                              const paid = stage.status === 'paid';
                                              const billed = Boolean(stage.invoiceId) && !paid;
                                              // Only a manual stage that has not
                                              // been billed can be completed. A
                                              // dated one bills itself.
                                              const canComplete =
                                                !paid &&
                                                !billed &&
                                                stage.trigger === 'manual' &&
                                                Boolean(onCompleteStage) &&
                                                !settledStatus;

                                              const amountText = new Intl.NumberFormat(
                                                isRTL ? 'he-IL' : 'en-US',
                                                {
                                                  style: 'currency',
                                                  currency: payment.currency,
                                                  maximumFractionDigits: stage.amount % 1 === 0 ? 0 : 2,
                                                }
                                              ).format(stage.amount);

                                              return (
                                                <div
                                                  key={stage.id}
                                                  className="flex items-center gap-2 px-2.5 py-2"
                                                >
                                                  <span
                                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                    style={{
                                                      background: paid
                                                        ? '#22C58B'
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
                                                    style={{ color: 'var(--v2-text-secondary)' }}
                                                  >
                                                    {amountText}
                                                  </span>

                                                  {/*
                                                    The document for THIS stage.
                                                    ───────────────────────────
                                                    A job billed in three parts
                                                    has three invoices and three
                                                    receipts. The single button
                                                    above can only ever reach one
                                                    of them — the latest — so a
                                                    client asking for the deposit
                                                    invoice could not be served
                                                    at all.

                                                    One action per row, and the
                                                    send route decides which
                                                    document it is: invoice while
                                                    the stage is owed, receipt
                                                    once it is paid.
                                                  */}
                                                  {stage.invoiceId && onSendInvoice && (
                                                    <button
                                                      type="button"
                                                      title={paid ? t('crm.invoice.send_receipt') : t('crm.invoice.resend')}
                                                      disabled={sendingInvoiceBookingId === booking.id}
                                                      onClick={e => {
                                                        e.stopPropagation();
                                                        handleSendInvoice(stage.invoiceId as string, booking.id);
                                                      }}
                                                      className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--v2-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--v2-text-secondary)] transition-colors hover:border-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] disabled:opacity-50"
                                                    >
                                                      <Mail className="h-3 w-3" />
                                                      {/* Named, not just iconised: on a row that
                                                          may sit beside two others, "send" does
                                                          not say WHICH document — and invoice and
                                                          receipt are different pieces of paper to
                                                          the person asking for one. */}
                                                      {paid ? t('crm.stage.receipt') : t('crm.stage.invoice')}
                                                    </button>
                                                  )}

                                                  <span className="ms-auto shrink-0">
                                                    {paid ? (
                                                      <span
                                                        className="text-[11.5px]"
                                                        style={{ color: '#15864F' }}
                                                      >
                                                        {t('crm.stage.paid')}
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
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ) : null}

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
                                          // the product, the client details, the
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
                                              style={{ gridColumn: 3 }}
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

                                        {scheduleDetail && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)]"
                                            style={{ gridColumn: 3 }}
                                          >
                                            {scheduleDetail}
                                          </span>
                                        )}

                                        {isIntakeStep && hasIntake && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)]"
                                            style={{ gridColumn: 3 }}
                                          >
                                            {Object.keys(booking.intake_responses?.responses || {}).length}{' '}
                                            {t('crm.intake.responses')}
                                          </span>
                                        )}

                                        {/* State, then actions. A state is a quiet
                                            tinted word; an action is a control. */}
                                        <div className="flex flex-wrap items-center gap-1.5 mt-2" style={{ gridColumn: 3 }}>
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
                                          {isPaymentStep && onManagePayment &&
                                            (isQuoted ? true : payment && payment.status !== 'free') && (
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
                                                  drawer read as two products.
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
                                          {isProposalStep
                                            && onOpenProposalBuilder
                                            && step.metadata?.waitingOn === 'owner'
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
                                          {isScheduleStep && onEditSession && !isProduct && !meetingSettled && (
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
                                      </div>

                                      {/* The intake answers, unchanged. */}
                                      {intakeExpandable && isSectionExpanded && (
                                        <div
                                          style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: '109px' }}
                                          className="pb-3"
                                        >
                                          <div className="p-4 bg-[var(--v2-bg)] rounded-xl border border-[var(--v2-border)] shadow-sm">
                                            {buildIntakeContent(booking)}
                                          </div>
                                        </div>
                                      )}
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
                        !isProduct &&
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
      </div>
    </CollapsibleSection>
  );
}
