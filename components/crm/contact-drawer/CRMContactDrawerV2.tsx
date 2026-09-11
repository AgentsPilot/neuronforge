'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { businessCollectsIntake } from '@/lib/business-os/intakeReach';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  User, FolderOpen, Trash2, UserX, Check, Calendar, X, Upload, File, FileText, MessageSquare, Receipt
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SchedulingBookingModal } from '@/components/scheduling/SchedulingBookingModal';
import { createLogger } from '@/lib/logger';
import { fetchContactMoney } from '@/lib/payments/fetchContactMoney';
import type { SchedulingService, SchedulingBooking } from '@/lib/repositories/SchedulingRepository';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { toast } from 'sonner';

// Import modular sections
import { ClientDetailsSection } from './ClientDetailsSection';
import { NotesSection } from './NotesSection';
import { SessionsSection } from './SessionsSection';
import { TasksSection } from './TasksSection';
import { ActivitySection } from './ActivitySection';
import { FilesTab } from './FilesTab';
import { BookingsTab } from './BookingsTab';
import { FormSubmissionsSection } from './FormSubmissionsSection';
import { PaymentManagementModal } from './PaymentManagementModal';
import { ProposalBuilderModal } from './ProposalBuilderModal';
import { PaymentsSection } from './PaymentsSection';
import { InvoiceModal } from '@/components/payments/InvoiceModal';

import type {
  CRMContact,
  CRMActivity,
  CRMPipelineStage,
  ContactFormData,
  SessionCardData,
  SessionPayment,
  SessionPaymentPlan,
  ContactTask,
  ContactDocument,
  ContactEmail,
  IntakeResponses,
  BookingJourneyStep,
  Appointment
} from './types';
// The same split Stripe's prices are built from, so what the card shows for a
// period is the figure actually charged. Both are pure functions — no server
// imports — so they are safe in a client component.
import { planPhases } from '@/lib/payments/planSchedule';
import { fromMinorUnits } from '@/lib/payments/refundMath';

// Extended booking data that includes confirmation email info
interface ExtendedBookingData {
  booking: Appointment;
  payment: SessionPayment | null;
  confirmationEmail?: {
    status: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed' | 'pending';
    sentAt?: string;
    openedAt?: string;
    subject?: string;  // Email subject line
  };
  /**
   * The quote attached to this booking, when the service is sold by quotation.
   *
   * Present even when there is no proposal yet — that is the important state.
   * A client who asked for a price and has not been sent one is waiting on the
   * OWNER, and a journey that showed nothing there would leave the request
   * invisible in the one place the owner looks at that client.
   */
  proposal?: DrawerProposal | null;
  /** Every version sent to this client for this service, newest first. */
  proposalHistory?: DrawerProposal[];
}

/** The half of a proposal the drawer needs. */
export interface DrawerProposal {
  id: string;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn' | 'superseded';
  title: string;
  /** Kept so a revision can open on the last version rather than on a blank form. */
  description: string | null;
  total: number;
  currency: string;
  /** The stage split, so a revision inherits the schedule that was negotiated. */
  payment_shape: {
    kind: 'single' | 'installments' | 'milestones';
    count?: number;
    frequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
    stages?: Array<{ label: string; percent: number }>;
  };
  service_id: string | null;
  valid_until: string | null;
  decline_reason: string | null;
  decline_note: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
  created_at: string;
  /** The request this quote answers. Null for rows predating the link. */
  booking_id: string | null;
  /** The proposal document sent with THIS version, when there was one. */
  document: { name: string; size: number | null } | null;
  created_invoice_id: string | null;
  /** The invoice acceptance raised, when this quote has been accepted. */
  invoice: {
    status: string;
    amount: number;
    currency: string;
    due_date: string | null;
  } | null;
  /** Every stage of the agreed plan. Empty for a single payment. */
  stages: Array<{
    id: string;
    installment_number: number | null;
    amount: number;
    currency: string;
    status: string;
    label: string | null;
    trigger: 'date' | 'manual' | null;
    due_date: string | null;
    invoice_id: string | null;
    completed_at: string | null;
    paid_at: string | null;
  }>;
}

/**
 * The quote that belongs to a booking.
 *
 * Matched on the service, because that is the only link the two share — a
 * proposal names what is being quoted for, and the booking names what was
 * requested. Superseded versions are skipped: after a revision the journey
 * should show the offer that stands, not the one it replaced.
 *
 * Newest first, so a second quote for the same service wins over the first.
 */
function proposalsFor(bookingId: string, proposals: DrawerProposal[]): DrawerProposal[] {
  /*
   * Matched on the BOOKING, not the service.
   *
   * Matching on `service_id` was wrong in a way that only showed up on the
   * second request: every quote ever sent for a service attached itself to
   * every booking of that service, so a brand-new enquiry opened already
   * showing the previous job accepted — the client's history, replayed against
   * a request that had nothing to do with it.
   *
   * A quote answers ONE request. `booking_id` says which.
   *
   * Quotes with a null `booking_id` attach to nothing. They predate the column
   * (or were raised outside a booking), and the alternative — falling back to
   * the service — is exactly the bug this replaces. They remain readable
   * everywhere the contact's quotes are listed; they simply do not claim a
   * booking they cannot prove they belong to.
   *
   * Superseded versions ARE kept: a quote declined at 12,000 and re-sent at
   * 10,000 is a negotiation, and the first number is the reason the second one
   * exists. Drafts are not — an unsent revision is not part of the client's
   * history.
   */
  return proposals
    .filter(p => p.status !== 'draft' && p.booking_id === bookingId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * A quoted job's money, in the shape every other booking uses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A quoted service is priced 0 — its price IS the quote, which does not exist
 * when the service is created — so the drawer built `{ status: 'free' }` for it
 * and every piece of money machinery downstream believed it. "Manage payment"
 * opened on ₪0.00 / חינם / "no payment required" for a job with a paid ₪1,250
 * deposit against it, and refunds were unreachable.
 *
 * The fix is not another parallel payment step. It is to answer the question
 * the rest of the drawer is already asking — what is owed, what is paid, what
 * plan is it on — with the quote's numbers instead of the service's.
 *
 * ONE builder, called from both load paths. The comment further down this file
 * records what happened last time the two built a payment object separately:
 * the refund fields were added to one and not the other.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function quotedPayment(
  proposal: DrawerProposal | null,
  currency: string
): SessionPayment | null {
  if (!proposal || proposal.status !== 'accepted' || !proposal.invoice) return null;

  const stages = proposal.stages ?? [];
  const paidStages = stages.filter(s => s.status === 'paid');
  const agreed = stages.length
    ? stages.reduce((sum, s) => sum + Number(s.amount), 0)
    : proposal.invoice.amount;

  /*
   * Which payment this object describes.
   *
   * `amount` and `status` mean "this payment", never the agreement — the plan
   * below carries the totals. So once money has landed, this describes the
   * money that LANDED; before that, the money next due.
   *
   * Two bugs turned on getting that wrong:
   *
   *   `status` was 'paid' only when every stage was settled. But "is the plan
   *   finished" is what `planIncomplete` answers, from `periodsPaid` below.
   *   `status` answers "has money been collected", and the refund UI reads it —
   *   so a real, refundable deposit was invisible to Manage Payment, which
   *   offered to mark it paid a second time.
   *
   *   `amount` pointed at the next UNPAID stage even after a payment. On a
   *   uniform instalment plan every stage is the same size, so it never showed.
   *   On milestones of 705 / 940 / 705 it displayed 940 for a 705 payment — and
   *   a refund taken from that figure would return money never collected.
   */
  const lastPaid = paidStages.length ? paidStages[paidStages.length - 1] : null;
  const nextDue = stages.find(s => s.status !== 'paid') ?? null;
  const subject = lastPaid ?? nextDue ?? null;

  const anyMoneyCollected =
    paidStages.length > 0 || (stages.length === 0 && proposal.invoice.status === 'paid');

  return {
    amount: subject ? Number(subject.amount) : proposal.invoice.amount,
    currency,
    status: anyMoneyCollected ? 'paid' : 'pending',
    // The invoice behind the payment being DESCRIBED, so a refund finds that
    // transaction rather than the deposit's by default.
    invoiceId: subject?.invoiceId ?? proposal.created_invoice_id ?? undefined,
    /*
     * What is owed right now: the earliest unpaid stage that has actually been
     * billed. A milestone nobody has marked done has no invoice to resend, and
     * offering to resend one would be offering to send nothing.
     */
    outstandingInvoiceId:
      stages.find(s => s.status !== 'paid' && s.invoiceId)?.invoiceId ??
      (proposal.invoice.status !== 'paid' ? proposal.created_invoice_id ?? undefined : undefined),
    invoiceDueDate: proposal.invoice.due_date ?? undefined,
    plan: stages.length > 1
      ? {
          installmentCount: stages.length,
          // The period the plan is ON — the next one due, or the last if the
          // plan is finished. Not `subject`, which describes the payment just
          // taken; the plan's own "current period" is a different question.
          installmentAmount: Number((nextDue ?? stages[stages.length - 1])?.amount ?? 0),
          totalAmount: agreed,
          // Milestones have no cadence — they fall due when work is done. The
          // field is required by the shared type, so it carries the least wrong
          // answer and `stages` below is what actually describes the schedule.
          frequency: 'monthly',
          periodsPaid: paidStages.length,
          stages: stages.map(s => ({
            id: s.id,
            label: s.label,
            amount: Number(s.amount),
            status: s.status,
            trigger: s.trigger,
            invoiceId: s.invoice_id,
            dueDate: s.due_date,
          })),
        }
      : undefined,
  };
}

/** The offer that stands — the newest that has not been replaced. */
function pickProposal(bookingId: string, proposals: DrawerProposal[]): DrawerProposal | null {
  return proposalsFor(bookingId, proposals).find(p => p.status !== 'superseded') ?? null;
}

// Build journey steps based on booking data
// This determines which steps to show and their status for each booking type
function buildJourneySteps(
  data: ExtendedBookingData,
  language: string = 'en',
  /**
   * The business collects intake at all.
   *
   * Needed because the intake step used to appear only when a RESPONSE already
   * existed — so the "Send intake form" action, which exists precisely for a
   * booking with no response yet, could never be reached. The owner could
   * resend a form the client had already returned, and could not send one that
   * had never gone out.
   */
  collectsIntake: boolean = false
): BookingJourneyStep[] {
  const { booking, payment, confirmationEmail } = data;
  const steps: BookingJourneyStep[] = [];
  const isProduct = !booking.start_time || booking.service?.is_product;
  const hasIntake = booking.intake_responses && Object.keys(booking.intake_responses.responses || {}).length > 0;
  const bookingDate = booking.start_time ? new Date(booking.start_time) : null;
  const isUpcoming = booking.status === 'confirmed' && bookingDate && bookingDate > new Date();
  const isCompleted = booking.status === 'completed';
  const isCancelled = booking.status === 'cancelled' || booking.status === 'no_show';
  /*
   * A booking that began as a quote request.
   *
   * Read from the service rather than the booking, because a consultation
   * booked on the way to a quote is an ordinary confirmed booking in every
   * other respect — what makes it part of a quoted journey is what is being
   * sold, not how the row was created.
   */
  const isQuotedBooking = booking.service?.sale_mode === 'proposal';

  // Helper to format date and time
  const formatDateTime = (date: Date) => date.toLocaleString(language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });


  // Helper to format currency
  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(language, { style: 'currency', currency }).format(amount);
  };

  // Step 1: Service/Product (always completed - they booked it)
  steps.push({
    id: `${booking.id}-service`,
    key: isProduct ? 'product' : 'service',
    status: 'completed',
    details: booking.service?.service_name,
    timestamp: booking.created_at
  });

  // Step 2: Client Info (captured at booking time)
  const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');
  /*
   * Each field isolated, so the separators stay put in Hebrew.
   *
   * An email and a phone number are LTR runs sitting in an RTL line. The bidi
   * algorithm reorders each run on its own and the neutral "•" between them
   * takes its direction from whatever is adjacent — so the two separators drift
   * together and the line reads as "name • • email phone".
   *
   * U+2068 FIRST STRONG ISOLATE ... U+2069 POP DIRECTIONAL ISOLATE wraps each
   * value in its own bidi context: the run is laid out internally by its own
   * direction and treated as a single neutral object by the line around it.
   * The same thing `<bdi>` does, in a plain string — which is what `details`
   * is, so markup is not available here.
   */
  const isolate = (value: string) => `\u2068${value}\u2069`;

  const clientDetails = [
    clientName,
    booking.client_email,
    booking.client_phone
  ]
    .filter(Boolean)
    .map(v => isolate(String(v)))
    .join(' • ');

  steps.push({
    id: `${booking.id}-client`,
    key: 'client',
    status: 'completed',
    details: clientDetails || clientName,
    timestamp: booking.created_at
  });

  /*
   * There is no separate `schedule` step. The appointment is drawn ONCE.
   *
   * There was one, and it drew the same appointment as `session` further down:
   * same `start_time`, same status, and `isScheduleStep` in BookingsTab treats
   * BOTH keys as the schedule step — so each got the identical "09:00 – 10:00 ·
   * יום ראשון · הפגישה התקיימה" line. The wait marker before it was drawn twice
   * too, and the day grouping bounced 10 → 13 → 10 → 13 → 10 for a booking that
   * happened on two days.
   *
   * `session` is the one that survives: it is the terminal node, it already
   * carries the appointment's time, and its key becomes `fulfillment` for a
   * product — so removing it instead would leave products with no final step.
   * Its time range is supplied by `scheduleFact`, which fills exactly this gap
   * for a schedule step that carries no `details` of its own.
   *
   * This affects EVERY scheduled booking, not only quoted ones.
   */

  /*
   * Quote — where a quoted service waits.
   *
   * This is the first step in the drawer whose ACTIVE side is the owner's. Every
   * other step waits on the client: they pay, they fill in the form, they turn
   * up. Here the client has asked and the business owes them an answer, and a
   * journey that did not say so would leave a live request sitting silently
   * behind a contact nobody had a reason to open.
   *
   * It sits before payment because nothing is owed until a price is agreed.
   */
  if (data.proposal !== undefined && (data.proposal || isQuotedBooking)) {
    const proposal = data.proposal;

    /*
     * The consultation has to happen before the quote can.
     *
     * A site visit booked for Thursday is where the work gets scoped, and on
     * Monday there is nothing to price. The step said "waiting on you" anyway —
     * which is simply false: nobody is waiting on the owner, the journey is
     * waiting on the meeting. It read as an overdue task in the one list an
     * owner uses to decide what to do today.
     *
     * The gate opens when the meeting STARTS rather than when it is marked
     * complete. Owners quote from the van on the way back, and few of them mark
     * an appointment done before they do — a gate on the status flag would have
     * held the button shut for the whole population it was meant to serve.
     */
    const awaitingMeeting = Boolean(
      !proposal && !isProduct && bookingDate && !isCompleted && !isCancelled && bookingDate > new Date()
    );

    /*
     * Cancelling ends a quoted job — it is the only mark that does.
     *
     * "Completed" and "no-show" describe the MEETING and leave the journey
     * running: the consultation happened, or they missed it, and either way
     * there is still a price to send. Cancelling means the business is not
     * doing this work, so the quote action disappears and any live quote has
     * already been withdrawn server-side by `cancelBooking`.
     *
     * This reverses the earlier behaviour, where a cancelled booking OPENED the
     * quote button on the reasoning that the meeting was behind us. It is not
     * the same question: "the meeting is over" and "the job is off" only looked
     * alike while nothing could say the second one.
     */
    const jobClosed = isCancelled;

    const status: BookingJourneyStep['status'] = jobClosed
      ? 'failed'
      : !proposal
        ? awaitingMeeting
          ? 'pending'
          : 'active'
        : proposal.status === 'accepted'
          ? 'completed'
          : proposal.status === 'declined' || proposal.status === 'expired'
            ? 'failed'
            : 'active';

    steps.push({
      id: `${booking.id}-proposal`,
      key: 'proposal',
      status,
      details: proposal
        ? `${formatAmount(proposal.total, proposal.currency)}`
        : undefined,
      timestamp: proposal?.decided_at || proposal?.sent_at || proposal?.created_at,
      metadata: {
        proposalId: proposal?.id ?? null,
        proposalStatus: proposal?.status ?? 'none',
        /*
         * Which side the ball is on — the one fact both the label and the
         * button read, so the strip cannot say "waiting on the meeting" beside
         * a button inviting you to skip it.
         */
        waitingOn: jobClosed
          ? 'closed'
          : awaitingMeeting
            ? 'meeting'
            : !proposal || proposal.status === 'declined'
              ? 'owner'
              : 'client',
        meetingAt: awaitingMeeting && bookingDate ? formatDateTime(bookingDate) : null,
        declineReason: proposal?.decline_reason ?? null,
        declineNote: proposal?.decline_note ?? null,
        total: proposal?.total ?? null,
        currency: proposal?.currency ?? null,
        /*
         * Every version, for the row to list beneath itself.
         *
         * Flattened to primitives here rather than passed as rows: the step's
         * metadata crosses into a presentational component, and handing it live
         * records invites that component to start deciding things about them.
         * It renders what it is given.
         */
        versions: (data.proposalHistory ?? []).map(v => ({
          id: v.id,
          total: v.total,
          amount: formatAmount(v.total, v.currency),
          status: v.status,
          // The date that matters is the one the version STOPPED on: decided if
          // it was answered, sent if it is still open. `created_at` would date a
          // revision to when the owner started typing it.
          at: v.decided_at || v.sent_at || v.created_at,
          isCurrent: v.id === proposal?.id,
          documentName: v.document?.name ?? null,
          // Per version, because each revision was declined for its own reason
          // — and "too expensive" against 12,000 then "wrong timing" against
          // 10,000 is a different story from the same objection twice.
          declineReason: v.decline_reason,
          declineNote: v.decline_note,
        })),
      },
    });
  }

  /*
   * There is no separate payment step for a quoted job any more.
   *
   * There was: a parallel block that built its own step from the proposal's
   * deposit invoice. It duplicated the ordinary step's logic badly — it read
   * one invoice instead of the plan, so a two-stage job went green on the first
   * payment — and it had none of the ordinary step's affordances, so refunds
   * and "manage payment" were unreachable.
   *
   * `quotedPayment` now supplies a real `payment` object for these bookings, so
   * the block below renders them exactly as it renders every other booking. The
   * only thing quoted-specific left is the plan's named stages, which ride
   * along inside `payment.plan.stages`.
   */

  // Step 3: Payment (if applicable) - format amount properly with status
  // For free services, skip payment step entirely
  if (payment && payment.status !== 'free') {
    // Translations for payment statuses
    const refundedText: Record<string, string> = {
      en: 'Refunded',
      es: 'Reembolsado',
      he: 'הוחזר'
    };
    const overdueText: Record<string, string> = {
      en: 'Overdue',
      es: 'Vencido',
      he: 'באיחור'
    };

    // Check if payment is overdue (invoice due date passed and not paid)
    const isOverdue = payment.status === 'pending' &&
                      payment.invoiceDueDate &&
                      new Date(payment.invoiceDueDate) < new Date();

    /*
     * Say which arrangement this is, not just a number.
     *
     * For a plan the amount alone is actively misleading: ₪333 next to a
     * ₪1,000 service reads as a partial payment or a discount. The owner needs
     * the shape — how much now, how many periods, how often, and what it comes
     * to — which is the same breakdown the client agreed to at checkout.
     */
    const planPeriodText: Record<string, string> = {
      en: 'of', es: 'de', he: 'מתוך'
    };
    const planEveryText: Record<string, Record<string, string>> = {
      en: { weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly', quarterly: 'quarterly' },
      es: { weekly: 'semanal', biweekly: 'cada 2 semanas', monthly: 'mensual', quarterly: 'trimestral' },
      he: { weekly: 'שבועי', biweekly: 'דו-שבועי', monthly: 'חודשי', quarterly: 'רבעוני' }
    };
    const planTotalText: Record<string, string> = {
      en: 'total', es: 'total', he: 'סה״כ'
    };

    /** True while a payment plan still has periods outstanding. */
    let planIncomplete = false;

    let paymentDetails = formatAmount(payment.amount, payment.currency);

    if (payment.plan) {
      const lang = planEveryText[language] ? language : 'en';
      const periodsPaid = payment.plan.periodsPaid ?? (payment.status === 'paid' ? 1 : 0);
      planIncomplete = periodsPaid < payment.plan.installmentCount;

      /*
       * "₪333.33 · 1 of 3 · monthly · ₪1,000.00 total"
       *
       * The cadence is dropped for a MILESTONE plan. Its stages fall due when
       * the work is done, not on a schedule, so `frequency` there is a
       * placeholder the shared type requires — printing it would tell the owner
       * their milestones are billed monthly, which is precisely what they are
       * not.
       */
      // Isolated for the same reason the client line is: amounts are LTR runs
      // in an RTL sentence, and the neutral separators between them drift.
      paymentDetails = [
        formatAmount(payment.plan.installmentAmount, payment.currency),
        `${periodsPaid} ${planPeriodText[lang]} ${payment.plan.installmentCount}`,
        payment.plan.stages?.length ? null : planEveryText[lang][payment.plan.frequency],
        `${formatAmount(payment.plan.totalAmount, payment.currency)} ${planTotalText[lang]}`
      ]
        .filter(Boolean)
        .map(v => isolate(String(v)))
        .join(' • ');
    }

    if (payment.status === 'refunded') {
      paymentDetails = `${paymentDetails} (${refundedText[language] || refundedText.en})`;
    } else if ((payment.refundedAmount ?? 0) > 0) {
      /*
       * A PARTIAL refund, which `status` cannot express.
       *
       * `status` only becomes 'refunded' when everything has gone back, so this
       * line read a flat "$200.00" for a booking where half the money had been
       * returned — the figure the owner is most likely to read as what they
       * kept. The amount charged and the amount refunded are both named.
       */
      paymentDetails = `${paymentDetails} • ${formatAmount(
        payment.refundedAmount ?? 0,
        payment.currency
      )} ${refundedText[language] || refundedText.en}`;
    } else if (isOverdue) {
      paymentDetails = `${paymentDetails} (${overdueText[language] || overdueText.en})`;
    }

    steps.push({
      id: `${booking.id}-payment`,
      key: 'payment',
      /*
       * A plan with periods still to come is NOT done.
       *
       * `paid` meant green, so the first ₪333 of three turned the payment step
       * the same colour as a sale collected in full — telling the owner nothing
       * remained when two thirds of the money had not arrived. It stays `active`
       * (amber) until the last period is in, which is what `active` is for.
       */
      status: payment.status === 'paid' && planIncomplete ? 'active' :
              payment.status === 'paid' ? 'completed' :
              payment.status === 'refunded' ? 'completed' :  // Refunded is also "completed" (transaction done)
              isOverdue ? 'failed' :  // Overdue payments show as failed (red)
              payment.status === 'pending' ? 'active' :
              payment.status === 'failed' ? 'failed' : 'pending',
      details: paymentDetails,
      timestamp: payment.refundedAt || payment.paidAt,  // Show refund time if available
      // Pass invoice data for resend functionality
      /*
       * `invoiceId` here is the RESEND target, and resending only ever means
       * the invoice still owed. On a plan that is not the same as the invoice
       * the payment describes: after a deposit clears, `payment.invoiceId` is
       * the settled one, and resending it asks a client to pay twice — which
       * `sendInvoice` refuses anyway, so the button did nothing at all.
       */
      metadata: (payment.outstandingInvoiceId ?? payment.invoiceId) ? {
        invoiceId: payment.outstandingInvoiceId ?? payment.invoiceId,
        invoiceDueDate: payment.invoiceDueDate,
        invoiceSentAt: payment.invoiceSentAt,
        isOverdue,
        /*
         * Sendable whenever an invoice EXISTS, not only while it is owed.
         *
         * The gate used to be "is this unpaid", which answers a different
         * question: a client who rings up asking for their paperwork needs it
         * whether or not they have paid, and the owner was left forwarding
         * emails by hand. The send route decides which document that is —
         * invoice while owed, receipt once settled.
         */
        canResend: Boolean(payment.outstandingInvoiceId || payment.invoiceId),
        // Which document the button will send, so it can say so.
        invoiceSettled: !payment.outstandingInvoiceId && payment.status === 'paid'
      } : undefined
    });
  }

  // Step 4: Intake Form (only show if this booking has intake data)
  // The intake step is only relevant if the booking was created with "send intake form" enabled
  // We detect this by checking if intake_responses exists (even if empty object means intake was sent but not filled)
  // or if intake_completed_at is set (meaning it was completed)
  // Note: We check for both null and undefined because the data might come as either
  const hasIntakeData = (booking.intake_responses != null) || (booking.intake_completed_at != null);

  // Shown when there is a response OR when the business collects intake at all
  // — the second is what makes an unsent form reachable.
  if (hasIntakeData || collectsIntake) {
    steps.push({
      id: `${booking.id}-intake`,
      key: 'intake',
      status: hasIntake ? 'completed' :
              isUpcoming ? 'active' :
              isCompleted || isCancelled ? 'skipped' : 'pending',
      timestamp: booking.intake_completed_at
    });
  }

  // Step 5: Email Confirmation (booking confirmation email sent to client)
  // This is sent automatically when booking is created
  const emailStatus = confirmationEmail?.status || 'sent'; // Assume sent if no data (auto-sent on booking)
  const emailDetails = confirmationEmail?.subject || undefined;  // Show email subject

  steps.push({
    id: `${booking.id}-confirmation`,
    key: 'confirmation',
    status: emailStatus === 'opened' || emailStatus === 'clicked' ? 'completed' :
            emailStatus === 'delivered' || emailStatus === 'sent' ? 'completed' :
            emailStatus === 'bounced' || emailStatus === 'failed' ? 'failed' :
            emailStatus === 'pending' ? 'active' : 'completed',
    details: emailDetails,
    timestamp: confirmationEmail?.sentAt || booking.created_at  // Email sent when booking created
  });

  // Step 6: Final status (Session for services, Fulfillment for products)
  steps.push({
    id: `${booking.id}-final`,
    key: isProduct ? 'fulfillment' : 'session',
    status: isCompleted ? 'completed' :
            isCancelled ? 'failed' :
            isUpcoming ? 'pending' : 'active',
    /*
     * WHEN the appointment is, so it sits under its own date.
     *
     * This step carried no timestamp at all, so the journey had nothing to file
     * it under: it fell into the undated group at the end, the day it belongs to
     * was never drawn, and the wait before it could not be measured — the gap
     * between booking and session is exactly the thing worth seeing.
     *
     * A product has no slot, so it stays undated, which is correct: a
     * fulfilment step genuinely has no date until it ships.
     */
    timestamp: booking.start_time || undefined
  });

  /*
   * A quoted job runs PAST the meeting, so its last two steps move to the end.
   *
   * The step order above is built for a booking where the appointment is the
   * job: you pick a date, you pay, you get a confirmation, you attend. The
   * quote was slotted in beside `payment`, which reads correctly against
   * `schedule` — but `schedule` is the date being CHOSEN. The meeting itself is
   * `session`, pushed last. So the quote appeared before the consultation it
   * exists to follow, and the deposit before the quote that sets it.
   *
   * Reordering here rather than branching every push above: the sequence is one
   * fact about quoted work — the price follows the visit, the money follows the
   * price — and it belongs in one place. A booking that is not quoted has no
   * proposal step, so `filter` leaves it exactly as built.
   */
  if (isQuotedBooking || data.proposal) {
    const deferred = steps.filter(s => s.key === 'proposal' || s.key === 'payment');
    const rest = steps.filter(s => !deferred.includes(s));
    const meetingAt = rest.findIndex(s => s.key === 'session' || s.key === 'fulfillment');

    if (deferred.length > 0 && meetingAt !== -1) {
      /*
       * Inserted directly AFTER the meeting, not appended to the end.
       *
       * They coincide today, because `session` happens to be the last step
       * pushed — but the two are different instructions, and the one that
       * survives someone adding a step below is "follows the meeting". The
       * quote follows the visit; appending to whatever happens to be last is
       * only accidentally the same thing.
       */
      return [
        ...rest.slice(0, meetingAt + 1),
        ...deferred,
        ...rest.slice(meetingAt + 1),
      ];
    }

    // No meeting to follow — a quoted product, or a request with no
    // consultation. The quote is then simply the next thing that happens.
    if (deferred.length > 0) return [...rest, ...deferred];
  }

  return steps;
}

interface CRMContactDrawerV2Props {
  contact: CRMContact;
  stages: CRMPipelineStage[];
  enabledCapabilities?: string[];
  isOpen: boolean;
  onClose: () => void;
  onContactUpdated: () => void;
  onTasksUpdated?: () => void;
  initialSection?: 'details' | 'bookings' | 'tasks' | 'forms' | 'files' | 'payments';
}

// Document types for upload
const DOCUMENT_TYPES = [
  { value: 'contract', labelKey: 'crm.document.type.contract' },
  { value: 'intake_form', labelKey: 'crm.document.type.intake_form' },
  { value: 'invoice', labelKey: 'crm.document.type.invoice' },
  { value: 'receipt', labelKey: 'crm.document.type.receipt' },
  { value: 'id_document', labelKey: 'crm.document.type.id_document' },
  { value: 'medical', labelKey: 'crm.document.type.medical' },
  { value: 'insurance', labelKey: 'crm.document.type.insurance' },
  { value: 'other', labelKey: 'crm.document.type.other' }
];

// Document Upload Modal Component
interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File, name: string, type: string, description: string) => Promise<void>;
  uploading: boolean;
  t: (key: string) => string;
}

function DocumentUploadModal({ isOpen, onClose, onUpload, uploading, t }: DocumentUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('other');
  const [description, setDescription] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      setFile(droppedFile);
      if (!docName) {
        setDocName(droppedFile.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!docName) {
        setDocName(selectedFile.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleSubmit = async () => {
    if (file && docName) {
      await onUpload(file, docName, docType, description);
      // Reset form on success
      setFile(null);
      setDocName('');
      setDocType('other');
      setDescription('');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleClose = () => {
    // Reset form state when closing
    setFile(null);
    setDocName('');
    setDocType('other');
    setDescription('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="bg-[var(--v2-bg)] border-[var(--v2-border)] max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-[var(--v2-text-primary)]">
            {t('crm.document.upload_title') || 'Upload Document'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drag & Drop Zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive
                ? 'border-[#8B5CF6] bg-[#8B5CF6]/10'
                : file
                ? 'border-green-500 bg-green-500/10'
                : 'border-[var(--v2-border)] hover:border-[#8B5CF6]/50'
            }`}
          >
            <input
              type="file"
              onChange={handleFileSelect}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
            />
            {file ? (
              <div className="space-y-2">
                <File className="h-10 w-10 mx-auto text-green-500" />
                <p className="font-medium text-[var(--v2-text-primary)]">{file.name}</p>
                <p className="text-sm text-[var(--v2-text-muted)]">{formatFileSize(file.size)}</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="text-sm text-red-500 hover:text-red-600"
                >
                  {t('crm.document.remove') || 'Remove'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-10 w-10 mx-auto text-[var(--v2-text-muted)]" />
                <p className="text-[var(--v2-text-secondary)]">
                  {t('crm.document.drag_drop') || 'Drag and drop a file, or click to browse'}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)]">
                  {t('crm.document.max_size') || 'Max 10MB'} • {t('crm.document.supported_formats') || 'PDF, DOC, XLS, Images'}
                </p>
              </div>
            )}
          </div>

          {/* Document Name */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.name') || 'Document Name'} <span className="text-red-500 dark:text-red-400">*</span>
            </Label>
            <Input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder={t('crm.document.name_placeholder') || 'Enter document name'}
              className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
            />
          </div>

          {/* Document Type */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.type') || 'Document Type'}
            </Label>
            <div className="flex flex-wrap gap-2">
              {DOCUMENT_TYPES.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setDocType(type.value)}
                  className={`px-3 py-1.5 text-xs font-medium border transition-all ${
                    docType === type.value
                      ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                      : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t(type.labelKey) || type.value}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.description') || 'Description'}
            </Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('crm.document.description_placeholder') || 'Optional description...'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20 resize-none"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={uploading}
            className="border-[var(--v2-border)]"
          >
            {t('button.cancel') || 'Cancel'}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!file || !docName || uploading}
            className="text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
          >
            {uploading ? (t('crm.drawer.uploading') || 'Uploading...') : (t('crm.drawer.upload_document') || 'Upload Document')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const logger = createLogger({ module: 'CRMContactDrawer' });

export function CRMContactDrawerV2({
  contact,
  stages,
  enabledCapabilities = [],
  isOpen,
  onClose,
  onContactUpdated,
  onTasksUpdated,
  initialSection = 'details'
}: CRMContactDrawerV2Props) {
  const { t, isRTL, language } = useLanguage();

  // Form state
  const [formData, setFormData] = useState<ContactFormData>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    stage: 'lead',
    source: '',
    tags: [],
    notes: '',
    custom_fields: {}
  });

  // Data states
  const [sessions, setSessions] = useState<SessionCardData[]>([]);
  /** The contact's quotes. Empty for every business that does not quote. */
  const [proposals, setProposals] = useState<DrawerProposal[]>([]);
  /** A milestone awaiting confirmation before it bills the client. */
  const [pendingStage, setPendingStage] = useState<{
    id: string;
    label: string;
    amount: string;
  } | null>(null);
  const [completingStage, setCompletingStage] = useState(false);

  /** The quote builder, and the booking it was opened from. */
  const [proposalBuilder, setProposalBuilder] = useState<{
    bookingId: string;
    supersedesId: string | null;
    declineReason: string | null;
    declineNote: string | null;
  } | null>(null);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [tasks, setTasks] = useState<ContactTask[]>([]);
  const [documents, setDocuments] = useState<ContactDocument[]>([]);
  /*
   * Completed intakes, for the Files tab.
   *
   * No `template` beside them any more, and no cache of templates to fill it:
   * the submission carries the questions it was answered against, so there is
   * nothing left to fetch and nothing that can arrive late.
   */
  const [intakeResponses, setIntakeResponses] = useState<Array<{
    booking_id: string;
    // Null for a product bought without a time. The Files tab formats it, and
    // a date that does not exist is a fact rather than a missing value.
    booking_date: string | null;
    service_name: string;
    intake: IntakeResponses;
  }>>([]);

  /**
   * The business collects intake — whether or not it emails it automatically.
   *
   * Drives whether a booking shows an intake step at all. Without it the step
   * appeared only once a RESPONSE existed, so "Send intake form" — which is for
   * a booking with no response — could never be reached.
   */
  const [collectsIntake, setCollectsIntake] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    fetch('/api/intake/settings')
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!cancelled) setCollectsIntake(businessCollectsIntake(data?.settings));
      })
      .catch(() => {
        // Left false: a booking then shows no intake step, which is the safer
        // of the two mistakes.
      });

    return () => { cancelled = true; };
  }, [isOpen]);

  // Loading states
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal states
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editingBooking, setEditingBooking] = useState<SchedulingBooking | undefined>(undefined);
  /*
   * What actually happened to a payment plan, per booking.
   *
   * The journey builds its plan from the SERVICE — "sold as 3 monthly payments"
   * — which is the agreement, not its fate. A plan that was stopped goes on
   * reading as a live plan on its first period, because nothing in the bookings
   * data says otherwise. The money list has this already; the timeline did not.
   *
   * Fetched ONLY when a plan booking is present, which is the minority of
   * contacts. The drawer's secondary batch is six parallel requests against a
   * six-connection budget, and making every contact pay for a case most of them
   * do not have is how that batch got slow enough to notice.
   */
  const [planStates, setPlanStates] = useState<
    Record<string, { status: string; periodsPaid: number; installmentCount: number }>
  >({});

  /**
   * Ask what became of the plans behind these bookings.
   *
   * The money endpoint already assembles this — subscription status, periods
   * paid — so this reads it rather than re-deriving from installments, which is
   * how the two surfaces would drift.
   *
   * Returns early when nothing is sold on a plan, so the common contact makes
   * no request at all.
   */
  const loadPlanStates = async (cards: SessionCardData[], contactId: string) => {
    if (!cards.some(card => card.payment?.plan)) return;

    try {
      // Shared with PaymentsSection, which needs the same answer at the same
      // moment. One request goes out, not two.
      const data = await fetchContactMoney(contactId);
      if (!data.success) return;

      const byBooking: Record<
        string,
        { status: string; periodsPaid: number; installmentCount: number }
      > = {};

      for (const item of data.data?.items ?? []) {
        if (item.bookingId && item.plan) {
          byBooking[item.bookingId] = {
            status: item.plan.status,
            periodsPaid: item.plan.periodsPaid ?? 0,
            installmentCount: item.plan.installmentCount ?? 0,
          };
        }
      }

      setPlanStates(byBooking);
    } catch (err) {
      // Not fatal: the journey still shows the plan's terms, just without
      // saying whether it is still running.
      logger.warn({ err, contactId }, 'Could not read payment plan states');
    }
  };
  const [services, setServices] = useState<SchedulingService[]>([]);
  /*
   * Services are on their way — as distinct from there being none.
   *
   * The booking dialog opens before the drawer's secondary batch lands, and an
   * empty dropdown with no explanation is the part that reads as broken.
   * Starts TRUE because that batch is fired as the drawer mounts: from the
   * dialog's point of view the request is already in flight.
   */
  const [servicesLoading, setServicesLoading] = useState(true);
  const [availability, setAvailability] = useState<Record<string, { start: string; end: string }[]> | undefined>(undefined);
  const [allBookings, setAllBookings] = useState<SchedulingBooking[]>([]);

  // Payment management modal state

  // Invoice modal state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [paymentsKey, setPaymentsKey] = useState(0);

  // Intake confirmation dialog state
  const [showIntakeConfirm, setShowIntakeConfirm] = useState(false);
  const [pendingIntakeBookingId, setPendingIntakeBookingId] = useState<string | null>(null);
  /* Resending the booking confirmation, the same shape as intake and invoice:
     confirm first, because this puts an email in a client's inbox. */
  const [showConfirmationResend, setShowConfirmationResend] = useState(false);
  const [pendingConfirmationBookingId, setPendingConfirmationBookingId] = useState<string | null>(null);
  const [sendingConfirmation, setSendingConfirmation] = useState(false);
  /* Cancelling emails the client and frees the slot, so it asks first.
     Completing and marking a no-show are internal record-keeping. */
  const [pendingCancelBookingId, setPendingCancelBookingId] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedBookingForPayment, setSelectedBookingForPayment] = useState<SessionCardData | null>(null);
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [sendingIntake, setSendingIntake] = useState(false);
  // Invoice resend confirmation dialog state
  const [showInvoiceConfirm, setShowInvoiceConfirm] = useState(false);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  const [pendingInvoiceBookingId, setPendingInvoiceBookingId] = useState<string | null>(null);

  /*
   * Whether the invoice about to be sent is already settled.
   *
   * The dialog promised "a new email with the payment link" for every send. On
   * a paid invoice that is two lies in one sentence: what goes out is a receipt,
   * and it carries no payment link precisely so nobody is asked to pay twice.
   *
   * Derived from the sessions already in hand rather than threaded through the
   * callback — the stage rows and the summary button both call the same handler,
   * and neither should have to explain the document to it.
   */
  const pendingInvoiceIsPaid = useMemo(() => {
    if (!pendingInvoiceId) return false;

    for (const session of sessions) {
      const stage = session.payment?.plan?.stages?.find(s => s.invoiceId === pendingInvoiceId);
      if (stage) return stage.status === 'paid';
      if (session.payment?.invoiceId === pendingInvoiceId) {
        return session.payment.status === 'paid';
      }
    }
    return false;
  }, [pendingInvoiceId, sessions]);
  const [sendingInvoice, setSendingInvoice] = useState(false);

  // UI states
  const [activeTab, setActiveTab] = useState<'customer' | 'activities'>('customer');
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Accordion state - only one section open at a time
  const [openSection, setOpenSection] = useState<'details' | 'bookings' | 'tasks' | 'forms' | 'files' | 'payments' | null>(initialSection);

  // Toggle section - closes others when opening one
  const handleSectionToggle = (section: 'details' | 'bookings' | 'tasks' | 'forms' | 'files' | 'payments') => (isOpen: boolean) => {
    setOpenSection(isOpen ? section : null);
  };

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email record type for confirmation matching
  interface EmailRecord {
    id: string;
    subject: string;
    status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
    sent_at: string | null;
    opened_at: string | null;
    created_at: string;
  }

  // Process bookings data into session cards (extracted for reuse)
  const processBookingsData = (bookingsData: { bookings: SchedulingBooking[] }, emailsData: { emails?: EmailRecord[] }, proposalsList: DrawerProposal[] = []) => {
    const emails: EmailRecord[] = emailsData.emails || [];

    // Helper to find confirmation email for a booking
    const findConfirmationEmail = (bookingCreatedAt: string, serviceName?: string): EmailRecord | undefined => {
      const bookingTime = new Date(bookingCreatedAt).getTime();
      const fiveMinutes = 5 * 60 * 1000;

      return emails.find(email => {
        const emailTime = new Date(email.created_at).getTime();
        const isNearBookingTime = Math.abs(emailTime - bookingTime) < fiveMinutes;
        const isConfirmation = email.subject.toLowerCase().includes('confirm') ||
          email.subject.toLowerCase().includes('booking') ||
          email.subject.toLowerCase().includes('אישור') ||
          (serviceName && email.subject.toLowerCase().includes(serviceName.toLowerCase()));
        return isNearBookingTime && isConfirmation;
      });
    };

    const sessionCards: SessionCardData[] = bookingsData.bookings.map((booking: SchedulingBooking) => {
      const bookingData: Appointment = {
        id: booking.id,
        service_id: booking.service_id,
        client_first_name: booking.client_first_name,
        client_last_name: booking.client_last_name,
        client_email: booking.client_email || undefined,
        client_phone: booking.client_phone || undefined,
        start_time: booking.start_time,
        end_time: booking.end_time,
        timezone: booking.timezone || undefined,
        status: booking.status,
        notes: booking.notes || undefined,
        intake_responses: booking.intake_responses || undefined,
        intake_completed_at: booking.intake_completed_at || undefined,
        created_at: booking.created_at || undefined,
        service: (booking as SchedulingBooking & { service?: { service_name: string; price?: number; currency?: string; is_product?: boolean } }).service
      };

      // Map actual payment_status from booking to SessionPayment status
      const mapPaymentStatus = (dbStatus?: string): 'paid' | 'pending' | 'failed' | 'free' | 'refunded' => {
        if (dbStatus === 'paid') return 'paid';
        if (dbStatus === 'refunded') return 'refunded';
        if (dbStatus === 'pending') return 'pending';
        return 'pending'; // default
      };

      // Check if this service is free (price 0 or null)
      const bookingWithService = booking as SchedulingBooking & {
        service?: {
          service_name: string;
          price?: number;
          currency?: string;
          payment_type?: string | null;
          installment_count?: number | null;
          installment_frequency?: string | null;
          sale_mode?: 'direct' | 'proposal' | null;
        };
      };
      const servicePrice = bookingWithService.service?.price ?? 0;
      const serviceCurrency = bookingWithService.service?.currency || 'USD';
      const isFreeService = servicePrice === 0;

      /*
       * Sold in installments?
       *
       * The card showed `servicePrice` for every booking, so a service sold as
       * "3 monthly payments of ₪333" appeared as a flat ₪1,000 — the whole
       * agreement, presented as if it had been collected. The owner could not
       * tell a paid-in-full sale from a plan on its first period.
       *
       * `planPhases` is the same split Stripe's prices are built from, so the
       * per-period figure here is the figure actually charged, and the
       * remainder lands on the final period rather than silently going missing.
       */
      const service = bookingWithService.service;
      const isPlan =
        service?.payment_type === 'installments' &&
        (service.installment_count ?? 1) > 1 &&
        servicePrice > 0;

      const sessionPlan: SessionPaymentPlan | undefined = isPlan
        ? {
            installmentCount: service!.installment_count!,
            installmentAmount: fromMinorUnits(
              planPhases(servicePrice, serviceCurrency, service!.installment_count!)[0].amountMinor,
              serviceCurrency
            ),
            totalAmount: servicePrice,
            frequency: (service!.installment_frequency || 'monthly') as SessionPaymentPlan['frequency'],
          }
        : undefined;

      /*
       * ⚠ THIS IS THE PRIMARY LOAD PATH.
       *
       * `fetchSessions` below builds the same object a second time, and the two
       * drifted: the refund fields were added there and not here, so a booking
       * showed its refund only after some action refreshed the drawer and never
       * on open. Anything added to one must be added to the other — or better,
       * both should move to one builder.
       */
      const bookingWithInvoice = booking as SchedulingBooking & {
        refunded_total?: number | string | null;
        invoice?: {
          id: string;
          status: string;
          due_date: string | null;
          sent_at: string | null;
          paid_at: string | null;
          amount?: number | string | null;
          refunded_amount?: number | string | null;
          refunded_at?: string | null;
        };
      };
      const invoiceData = bookingWithInvoice.invoice;

      /*
       * A quoted job's money comes from the QUOTE, not the service.
       *
       * Checked before `isFreeService`, because a quoted service is priced 0 and
       * would otherwise be declared free — which is how "Manage payment" ended
       * up showing ₪0.00 and "no payment required" for a job with a paid deposit.
       */
      const quotedMoney = quotedPayment(
        bookingWithService.service?.sale_mode === 'proposal'
          ? pickProposal(booking.id, proposalsList)
          : null,
        serviceCurrency
      );

      const paymentData: SessionPayment | null = quotedMoney ? quotedMoney : isFreeService ? {
        amount: 0,
        currency: serviceCurrency,
        status: 'free' as const
      } : servicePrice > 0 ? {
        id: booking.payment_id || undefined,
        // One period for a plan, the whole price otherwise — what this payment
        // is, never what the agreement totals.
        amount: sessionPlan ? sessionPlan.installmentAmount : servicePrice,
        currency: serviceCurrency,
        status: mapPaymentStatus(booking.payment_status),
        plan: sessionPlan,
        paidAt: invoiceData?.paid_at || undefined,
        /*
         * The refund, across BOTH ways money attaches to a booking — the same
         * three fields `fetchSessions` sets. Without them the journey's payment
         * receipt has no refund to show and renders the charge alone.
         */
        refundedAmount: Number(bookingWithInvoice.refunded_total ?? 0) || undefined,
        refundedAt: invoiceData?.refunded_at || undefined,
        invoicedAmount: Number(invoiceData?.amount ?? 0) || undefined,
        // Invoice data for resend functionality and due date display
        invoiceId: invoiceData?.id,
        invoiceStatus: invoiceData?.status as SessionPayment['invoiceStatus'],
        invoiceDueDate: invoiceData?.due_date || undefined,
        invoiceSentAt: invoiceData?.sent_at || undefined
      } : null;

      // Find confirmation email for this booking
      const confirmationEmail = findConfirmationEmail(booking.created_at, bookingWithService.service?.service_name);

      return {
        booking: bookingData,
        payment: paymentData,
        journeySteps: buildJourneySteps(
          {
            booking: bookingData,
            payment: paymentData,
            confirmationEmail: confirmationEmail ? {
              status: confirmationEmail.status,
              sentAt: confirmationEmail.sent_at || confirmationEmail.created_at,
              openedAt: confirmationEmail.opened_at || undefined,
              subject: confirmationEmail.subject
            } : undefined,
            proposal: bookingWithService.service?.sale_mode === 'proposal'
              ? pickProposal(booking.id, proposalsList)
              : undefined,
            proposalHistory: bookingWithService.service?.sale_mode === 'proposal'
              ? proposalsFor(booking.id, proposalsList)
              : undefined
          },
          language,
          collectsIntake
        )
      };
    });
    setSessions(sessionCards);
    // Both builders, per the warning above: a plan's state must not depend on
    // which path loaded the drawer.
    void loadPlanStates(sessionCards, contact.id);

    // Extract intake responses for Files tab
    // Only include completed intakes (with actual responses), not pending ones
    const intakes = sessionCards
      .filter(s => {
        const intake = s.booking.intake_responses;
        // Check if intake exists and has actual responses (not just pending marker)
        return intake &&
               intake.responses &&
               Object.keys(intake.responses).length > 0 &&
               intake.template_key !== 'pending';
      })
      .map(s => ({
        booking_id: s.booking.id,
        booking_date: s.booking.start_time || s.booking.created_at || '',
        service_name: s.booking.service?.service_name || '',
        intake: s.booking.intake_responses as IntakeResponses
      }));
    setIntakeResponses(intakes);
  };

  // Load all contact data - prioritize bookings for faster initial render
  const loadAllContactData = async (contactId: string) => {
    // Set all loading states at once
    setLoadingSessions(true);
    setLoadingActivities(true);
    setLoadingEmails(true);
    setLoadingTasks(true);
    setLoadingDocuments(true);

    // Priority 1: Load bookings and emails first (needed for booking cards)
    // These are the most important for the drawer UI
    const priorityFetch = async () => {
      try {
        /*
         * Both go out together, and the emails list paints on its own.
         *
         * The two are NOT independent: `processBookingsData` matches each
         * booking to the confirmation email sent alongside it, so a session card
         * genuinely cannot be drawn until both have arrived. That wait is
         * correct and is left alone.
         *
         * What was not correct is that the EMAILS tab waited for the bookings
         * query too — a heavier request joining invoices, transactions, services
         * and contacts — to render a list it has no need of. Emails now render
         * the moment they land.
         */
        const bookingsPromise = fetch(`/api/scheduling/bookings?contact_id=${contactId}&limit=50`)
          .then(response => (response.ok ? response.json() : { success: false }))
          .catch(error => {
            logger.warn({ err: error, contactId }, 'Could not load bookings');
            return { success: false };
          });

        /*
         * Quotes, in parallel with the bookings rather than after them.
         *
         * A failed proposals request must not cost the drawer its bookings —
         * the journey renders without the quote step, which is the same thing
         * it does for every business that does not quote at all.
         */
        const proposalsPromise = fetch(`/api/business-os/proposals?contact_id=${contactId}`)
          .then(response => (response.ok ? response.json() : { proposals: [] }))
          .catch(error => {
            logger.warn({ err: error, contactId }, 'Could not load proposals');
            return { proposals: [] };
          })
          .then(data => {
            const list: DrawerProposal[] = data.proposals || [];
            setProposals(list);
            return list;
          });

        const emailsPromise = fetch(`/api/crm/contacts/${contactId}/emails?limit=100`)
          .then(response => (response.ok ? response.json() : { emails: [] }))
          .catch(error => {
            logger.warn({ err: error, contactId }, 'Could not load emails');
            return { emails: [] };
          })
          .then(data => {
            if (data.emails) setEmails(data.emails || []);
            setLoadingEmails(false);
            return data;
          });

        const [bookingsData, emailsData, proposalsList] = await Promise.all([
          bookingsPromise,
          emailsPromise,
          proposalsPromise,
        ]);

        // Sessions need both: the cards carry the confirmation email.
        if (bookingsData.success && bookingsData.bookings) {
          processBookingsData(bookingsData, emailsData, proposalsList);
        }
        setLoadingSessions(false);
      } catch (error) {
        console.error('Failed to load priority data:', error);
        setLoadingSessions(false);
        setLoadingEmails(false);
      }
    };

    /*
     * Priority 2: the rest, each landing on its own.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This used to be two `Promise.all` barriers back to back — one over the six
     * fetches, another over the six `.json()` parses — and only then did the six
     * `setState` calls run. So every panel in the drawer waited for the SLOWEST
     * of the six, twice over.
     *
     * The service dropdown is where that showed. `/api/scheduling/services`
     * answers in about half a second, but the dropdown said "loading your
     * services" until activities, tasks, documents, availability AND a hundred
     * bookings had all arrived — and in development, until whichever of those
     * routes had not been compiled yet finished compiling.
     *
     * The six requests still go out together; they simply stop waiting for each
     * other to be READ. Each one parses and paints the moment it lands, which is
     * what "in parallel" was supposed to mean.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const secondaryFetch = async () => {
      /** Fetch, parse, and hand over — failure is contained to this one panel. */
      const load = async (
        url: string,
        apply: (data: Record<string, unknown>) => void,
        done?: () => void
      ) => {
        try {
          const response = await fetch(url);
          const data = response.ok ? await response.json() : { success: false };
          apply(data);
        } catch (error) {
          logger.warn({ err: error, url }, 'Drawer panel failed to load');
        } finally {
          done?.();
        }
      };

      await Promise.all([
        load(
          `/api/crm/activities?contact_id=${contactId}&limit=50`,
          data => {
            if (data.success) setActivities((data.activities as CRMActivity[]) || []);
          },
          () => setLoadingActivities(false)
        ),

        load(
          // `include_completed` matters here: TasksSection renders completed
          // tasks behind its own toggle, so the drawer has to be given them.
          // Without it the repository defaults to pending/in_progress only and
          // a task disappears from the tab the moment it is ticked off.
          `/api/crm/tasks?contact_id=${contactId}&include_completed=true&limit=50`,
          data => {
            if (data.success) setTasks((data.tasks as ContactTask[]) || []);
          },
          () => setLoadingTasks(false)
        ),

        load(
          `/api/crm/documents?contact_id=${contactId}&limit=50`,
          data => {
            if (data.success) setDocuments((data.documents as ContactDocument[]) || []);
          },
          () => setLoadingDocuments(false)
        ),

        load(
          '/api/scheduling/services?activeOnly=true',
          data => {
            if (data.success) setServices((data.services as SchedulingService[]) || []);
          },
          // Answered, whatever the answer. The dropdown can stop saying "loading"
          // and start saying "none configured" if that is the truth.
          () => setServicesLoading(false)
        ),

        /*
         * Availability.
         *
         * This read `availabilityData.settings.weekly_hours`. The endpoint
         * returns `{ success, availability }` — the weekly map directly — so
         * `settings` was always undefined, the guard always failed, and
         * `availability` stayed undefined for the whole life of the drawer.
         *
         * Two things depended on it and quietly stopped: the booking dialog's
         * quick-pick slot cards are gated on `availability` and so never
         * rendered, and its default time fell back to the no-availability path.
         *
         * The block could never have run, either: it also called a `setTimezone`
         * that is not declared in this file. A guard that always fails hides a
         * ReferenceError sitting one line below it.
         */
        load('/api/scheduling/availability', data => {
          if (data.success && data.availability) {
            setAvailability(data.availability as Record<string, { start: string; end: string }[]>);
          }
        }),

        // All bookings, for the calendar and for the booking dialog's conflict check.
        load('/api/scheduling/bookings?limit=100', data => {
          if (data.success) setAllBookings((data.bookings as SchedulingBooking[]) || []);
        }),
      ]);
    };

    // Start both fetches in parallel, but priority fetch will update UI first
    await Promise.all([priorityFetch(), secondaryFetch()]);
  };

  // Initialize form data when contact changes
  useEffect(() => {
    if (contact && isOpen) {
      setFormData({
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        stage: contact.stage,
        source: contact.source || '',
        tags: contact.tags || [],
        notes: contact.custom_fields?.notes || '',
        custom_fields: contact.custom_fields || {}
      });
      setActiveTab('customer');
      setShowDeleteConfirm(false);
      setShowDeactivateConfirm(false);
      setErrorMessage('');
      setSuccessMessage('');

      // Fetch all data in parallel for better performance
      loadAllContactData(contact.id);
    }
  }, [contact, isOpen]);

  // Fetch sessions (bookings with payments and emails) - kept for individual refresh
  /**
   * The contact's bookings, and everything the journey draws from them.
   *
   * `silent` for a refresh after a money action. The journey carries the
   * payment figures — what was charged, what came back — and those are derived
   * from the same bookings, so a refund made in the payments section leaves the
   * journey showing the pre-refund amounts until this runs. Without `silent` it
   * would run with skeletons over the timeline the owner is looking at.
   *
   * `no-store` for the same reason the payments section needed it: this hits
   * URLs that were fetched moments ago, and a cached answer would refresh the
   * journey to exactly what it already showed.
   */
  /**
   * Reload the client's bookings.
   *
   * `silent` is what every in-drawer action should pass. Without it the whole
   * bookings list is replaced by a spinner and rebuilds — so marking a meeting
   * held, sending a quote or recording a payment made the card the owner was
   * looking at disappear and come back, losing their scroll position and any
   * section they had expanded. The data is being refreshed, not fetched for the
   * first time; there is nothing to wait for.
   *
   * The loading flag is only for opening the drawer.
   */
  const fetchSessions = async (contactId: string, { silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoadingSessions(true);

      // Fetch bookings and emails in parallel
      const [bookingsResponse, emailsResponse, proposalsResponse] = await Promise.all([
        fetch(`/api/scheduling/bookings?contact_id=${contactId}&limit=50`, { cache: 'no-store' }),
        fetch(`/api/crm/contacts/${contactId}/emails?limit=100`, { cache: 'no-store' }),
        fetch(`/api/business-os/proposals?contact_id=${contactId}`, { cache: 'no-store' })
      ]);

      // Refreshed here too: this is the path a just-sent quote comes back
      // through, and a stale list would show the owner the button they had
      // already pressed.
      const freshProposals: DrawerProposal[] = proposalsResponse.ok
        ? (await proposalsResponse.json()).proposals || []
        : [];
      setProposals(freshProposals);

      if (!bookingsResponse.ok) {
        return;
      }

      const bookingsData = await bookingsResponse.json();
      const emailsData = emailsResponse.ok ? await emailsResponse.json() : { emails: [] };

      // Create a map of emails by approximate booking time (within 5 minutes of booking creation)
      // Email subjects containing "confirmation" or service name are matched to bookings
      interface EmailRecord {
        id: string;
        subject: string;
        status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
        sent_at: string | null;
        opened_at: string | null;
        created_at: string;
      }
      const emails: EmailRecord[] = emailsData.emails || [];

      // Helper to find confirmation email for a booking
      const findConfirmationEmail = (bookingCreatedAt: string, serviceName?: string): EmailRecord | undefined => {
        const bookingTime = new Date(bookingCreatedAt).getTime();
        const fiveMinutes = 5 * 60 * 1000;

        return emails.find(email => {
          const emailTime = new Date(email.created_at).getTime();
          const isNearBookingTime = Math.abs(emailTime - bookingTime) < fiveMinutes;
          const isConfirmation = email.subject.toLowerCase().includes('confirm') ||
            email.subject.toLowerCase().includes('booking') ||
            email.subject.toLowerCase().includes('אישור') ||
            (serviceName && email.subject.toLowerCase().includes(serviceName.toLowerCase()));
          return isNearBookingTime && isConfirmation;
        });
      };

      if (bookingsData.success && bookingsData.bookings) {
        const sessionCards: SessionCardData[] = bookingsData.bookings.map((booking: SchedulingBooking) => {
          const bookingData: Appointment = {
            id: booking.id,
            service_id: booking.service_id,
            client_first_name: booking.client_first_name,
            client_last_name: booking.client_last_name,
            client_email: booking.client_email,
            client_phone: booking.client_phone,
            start_time: booking.start_time,
            end_time: booking.end_time,
            timezone: booking.timezone,
            status: booking.status,
            notes: booking.notes,
            intake_responses: booking.intake_responses ?? undefined,
            intake_completed_at: booking.intake_completed_at,
            created_at: booking.created_at,
            service: booking.service
          };

          // Map actual payment_status from booking to SessionPayment status
          const mapPaymentStatus = (dbStatus?: string): 'paid' | 'pending' | 'failed' | 'free' | 'refunded' => {
            if (dbStatus === 'paid') return 'paid';
            if (dbStatus === 'refunded') return 'refunded';
            if (dbStatus === 'pending') return 'pending';
            return 'pending'; // default
          };

          // Check if this service is free (price 0 or null)
          const servicePrice = booking.service?.price ?? 0;
          const serviceCurrency = booking.service?.currency || 'USD';
          const isFreeService = servicePrice === 0;

          // Extract invoice data from booking if available
          const invoiceData = (booking as SchedulingBooking & {
            invoice?: {
              id: string;
              status: string;
              due_date: string | null;
              sent_at: string | null;
              paid_at: string | null;
              amount?: number | string | null;
              refunded_amount?: number | string | null;
              refunded_at?: string | null;
            };
          }).invoice;

          // Same rule as the primary path: the quote decides, not the service.
          const quotedMoney = quotedPayment(
            (booking as SchedulingBooking & { service?: { sale_mode?: string | null } })
              .service?.sale_mode === 'proposal'
              ? pickProposal(booking.id, freshProposals)
              : null,
            serviceCurrency
          );

          const paymentData: SessionPayment | null = quotedMoney ? quotedMoney : isFreeService ? {
            amount: 0,
            currency: serviceCurrency,
            status: 'free' as const
          } : servicePrice > 0 ? {
            id: booking.payment_id || undefined,  // Payment ID for refunds
            amount: servicePrice,
            currency: serviceCurrency,
            status: mapPaymentStatus(booking.payment_status),
            paidAt: invoiceData?.paid_at || undefined,
            /*
             * What has gone back, across BOTH ways money attaches to a booking.
             *
             * Not `invoice.refunded_amount`: a payment plan has no invoice — its
             * periods are transactions — so reading the invoice alone left every
             * plan refund invisible here. And not `payment_status`, which only
             * moves on a FULL refund, so a partial one showed nothing at all.
             */
            refundedAmount:
              Number(
                (booking as SchedulingBooking & { refunded_total?: number | string | null })
                  .refunded_total ?? 0
              ) || undefined,
            // When the money went back, so the receipt can date the line the way
            // a statement does.
            refundedAt: invoiceData?.refunded_at || undefined,
            // What was billed, which is what the receipt should foot from.
            invoicedAmount: Number(invoiceData?.amount ?? 0) || undefined,
            // Invoice data for resend functionality and due date display
            invoiceId: invoiceData?.id,
            invoiceStatus: invoiceData?.status as SessionPayment['invoiceStatus'],
            invoiceDueDate: invoiceData?.due_date || undefined,
            invoiceSentAt: invoiceData?.sent_at || undefined
          } : null;

          // Find confirmation email for this booking
          const confirmationEmail = findConfirmationEmail(booking.created_at, booking.service?.service_name);

          return {
            booking: bookingData,
            payment: paymentData,
            journeySteps: buildJourneySteps(
              {
                booking: bookingData,
                payment: paymentData,
                confirmationEmail: confirmationEmail ? {
                  status: confirmationEmail.status,
                  sentAt: confirmationEmail.sent_at || confirmationEmail.created_at,
                  openedAt: confirmationEmail.opened_at || undefined,
                  subject: confirmationEmail.subject
                } : undefined,
                proposal: (booking as SchedulingBooking & { service?: { sale_mode?: string | null } })
                  .service?.sale_mode === 'proposal'
                  ? pickProposal(booking.id, freshProposals)
                  : undefined,
                proposalHistory: (booking as SchedulingBooking & { service?: { sale_mode?: string | null } })
                  .service?.sale_mode === 'proposal'
                  ? proposalsFor(booking.id, freshProposals)
                  : undefined
              },
              language,
              collectsIntake
            )
          };
        });
        setSessions(sessionCards);
        void loadPlanStates(sessionCards, contactId);

        // Extract intake responses for Files tab (exclude pending intakes with no actual data)
        const intakes = sessionCards
          .filter(s => {
            const intake = s.booking.intake_responses;
            return intake &&
                   intake.responses &&
                   Object.keys(intake.responses).length > 0 &&
                   intake.template_key !== 'pending';
          })
          .map(s => ({
            booking_id: s.booking.id,
            booking_date: s.booking.start_time,
            service_name: s.booking.service?.service_name || '',
            intake: s.booking.intake_responses as IntakeResponses
          }));
        setIntakeResponses(intakes);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      if (!silent) setLoadingSessions(false);
    }
  };

  /**
   * Reload the contact's activity timeline.
   *
   * `silent` for the same reason `fetchSessions` has it: an action taken INSIDE
   * the drawer is refreshing data already on screen, not fetching it for the
   * first time. Without it every send, every status change and every saved note
   * blanked the timeline to a spinner and rebuilt it — which reads as the whole
   * drawer reloading, because the timeline is most of what is visible.
   *
   * The flag is for opening the drawer, and nothing else.
   */
  const fetchActivities = async (contactId: string, { silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoadingActivities(true);
      const response = await fetch(`/api/crm/activities?contact_id=${contactId}&limit=50`);
      const data = await response.json();

      if (data.success) {
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      if (!silent) setLoadingActivities(false);
    }
  };

  const fetchEmails = async (contactId: string) => {
    try {
      setLoadingEmails(true);
      const response = await fetch(`/api/crm/emails?contact_id=${contactId}&limit=50`);
      const data = await response.json();

      if (data.success) {
        setEmails(data.emails || []);
      }
    } catch (error) {
      console.error('Failed to fetch emails:', error);
    } finally {
      setLoadingEmails(false);
    }
  };

  const fetchTasks = async (contactId: string) => {
    try {
      setLoadingTasks(true);
      const response = await fetch(`/api/crm/tasks?contact_id=${contactId}&include_completed=true&limit=20`);
      const data = await response.json();

      if (data.success) {
        setTasks(data.tasks || []);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  };

  const fetchDocuments = async (contactId: string) => {
    try {
      setLoadingDocuments(true);
      const response = await fetch(`/api/crm/contacts/${contactId}/documents`);
      const data = await response.json();

      if (data.success) {
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoadingDocuments(false);
    }
  };

  const fetchServices = async () => {
    try {
      const response = await fetch('/api/scheduling/services?activeOnly=true');
      const data = await response.json();
      if (data.success) {
        setServices(data.services || []);
      }
    } catch (error) {
      console.error('Failed to fetch services:', error);
    }
  };

  // Fetch all bookings (for availability slot filtering)
  const fetchAllBookings = async () => {
    try {
      // Get bookings for the next 30 days to filter available slots
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      const response = await fetch(
        `/api/scheduling/bookings?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}&limit=200`
      );
      const data = await response.json();
      if (data.success) {
        setAllBookings(data.bookings || []);
      }
    } catch (error) {
      console.error('Failed to fetch all bookings:', error);
    }
  };

  // Save contact changes
  const handleSave = async () => {
    setSaving(true);
    setErrorMessage('');

    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email,
          phone: formData.phone,
          stage: formData.stage,
          source: formData.source,
          tags: formData.tags,
          custom_fields: {
            ...formData.custom_fields,
            notes: formData.notes
          }
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage(t('crm.drawer.saved') || 'Saved');
        setTimeout(() => setSuccessMessage(''), 2000);
        onContactUpdated();
      } else {
        setErrorMessage(data.error || t('crm.drawer.save_error'));
      }
    } catch (error) {
      console.error('Failed to save contact:', error);
      setErrorMessage(t('crm.drawer.save_error'));
    } finally {
      setSaving(false);
    }
  };

  // Notes auto-save handler
  const handleNotesChange = useCallback(async (notes: string) => {
    setFormData(prev => ({ ...prev, notes }));

    // Auto-save notes
    try {
      await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_fields: {
            ...formData.custom_fields,
            notes
          }
        })
      });
    } catch (error) {
      console.error('Failed to auto-save notes:', error);
    }
  }, [contact.id, formData.custom_fields]);

  // Task handlers
  const handleCreateTask = async (title: string, priority?: string, dueDate?: string) => {
    try {
      const response = await fetch('/api/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          title,
          priority: priority || 'medium',
          due_date: dueDate || undefined
        })
      });

      const data = await response.json();
      if (data.success) {
        fetchTasks(contact.id);
        // Notify parent to refresh task list
        onTasksUpdated?.();
      }
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  const handleToggleTask = async (taskId: string, completed: boolean) => {
    try {
      const response = await fetch(`/api/crm/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: completed ? 'completed' : 'pending' })
      });

      const data = await response.json();
      if (data.success) {
        fetchTasks(contact.id);
        // Notify parent to refresh task list
        onTasksUpdated?.();
      }
    } catch (error) {
      console.error('Failed to toggle task:', error);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/crm/tasks/${taskId}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        fetchTasks(contact.id);
        // Notify parent to refresh task list
        onTasksUpdated?.();
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  // Activity handler
  const handleAddActivity = async (type: string, description: string) => {
    try {
      const response = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          activity_type: type,
          title: t(`crm.activity.type.${type}`),
          description
        })
      });

      const data = await response.json();
      if (data.success) {
        fetchActivities(contact.id, { silent: true });
      }
    } catch (error) {
      console.error('Failed to add activity:', error);
    }
  };

  // Session handlers
  const handleNewSession = () => {
    // Open the modal immediately; the services fill in when they arrive.
    setEditingBooking(undefined);
    setShowBookingModal(true);

    /*
     * Only if nothing is already on its way.
     *
     * The drawer asks for services in its secondary batch — six requests fired
     * together the moment it opens. Clicking "new session" before those land
     * used to fire a SEVENTH for the same data, competing with the one already
     * in flight rather than replacing it. The modal now says it is loading, so
     * the honest thing is to wait for the request that exists.
     */
    if (services.length === 0 && !servicesLoading) {
      setServicesLoading(true);
      fetchServices()
        .catch(err => logger.error({ err }, 'Failed to fetch services'))
        .finally(() => setServicesLoading(false));
    }
  };

  const handleEditSession = (bookingId: string) => {
    const session = sessions.find(s => s.booking.id === bookingId);
    if (session) {
      // Convert to SchedulingBooking format for modal (matching old drawer format)
      setEditingBooking({
        id: session.booking.id,
        user_id: '',
        service_id: session.booking.service_id,
        contact_id: contact.id,
        client_first_name: session.booking.client_first_name,
        client_last_name: session.booking.client_last_name || null,
        client_email: contact.email,
        client_phone: contact.phone || null,
        start_time: session.booking.start_time,
        end_time: session.booking.end_time,
        timezone: session.booking.timezone || 'UTC',
        status: session.booking.status,
        notes: session.booking.notes || null,
        cancellation_reason: null,
        payment_status: 'pending',
        payment_id: null,
        internal_notes: null,
        booking_source: 'manual',
        reminder_24hr_sent: false,
        reminder_2hr_sent: false,
        external_calendar_event_id: null,
        calendar_sync_provider: null,
        calendar_synced_at: null,
        calendar_sync_error: null,
        intake_responses: session.booking.intake_responses || null,
        intake_completed_at: session.booking.intake_completed_at || null,
        created_at: '',
        updated_at: ''
      } as SchedulingBooking);
      setShowBookingModal(true);
    }
  };

  const handleBookingSaved = () => {
    setShowBookingModal(false);
    setEditingBooking(undefined);
    fetchSessions(contact.id, { silent: true });
    fetchActivities(contact.id, { silent: true });
    onContactUpdated();
  };

  // Delete contact
  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        onClose();
        onContactUpdated();
      } else {
        setErrorMessage(data.error || t('crm.drawer.delete_error'));
      }
    } catch (error) {
      console.error('Failed to delete contact:', error);
      setErrorMessage(t('crm.drawer.delete_error'));
    }
  };

  // Deactivate contact
  const handleDeactivate = async () => {
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false })
      });

      const data = await response.json();
      if (data.success) {
        onClose();
        onContactUpdated();
      } else {
        setErrorMessage(data.error || t('crm.drawer.deactivate_error'));
      }
    } catch (error) {
      console.error('Failed to deactivate contact:', error);
      setErrorMessage(t('crm.drawer.deactivate_error'));
    }
  };

  // File upload handler
  const handleFileUpload = async (file: File, docName: string, docType: string, description: string) => {
    try {
      setUploadingDocument(true);
      setErrorMessage('');

      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Remove the data:mime;base64, prefix
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(file);
      const base64Content = await base64Promise;

      const response = await fetch(`/api/crm/contacts/${contact.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: docName,
          document_type: docType,
          description: description || undefined,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          file_content: base64Content
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccessMessage(t('crm.drawer.upload_success') || 'Document uploaded successfully');
        setShowUploadModal(false);
        fetchDocuments(contact.id);
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || t('crm.drawer.upload_error') || 'Failed to upload document');
      }
    } catch (error) {
      console.error('Failed to upload document:', error);
      setErrorMessage(t('crm.drawer.upload_error') || 'Failed to upload document');
    } finally {
      setUploadingDocument(false);
    }
  };

  // Get stage color
  const getStageColor = () => {
    const stage = stages.find(s => s.stage_key === formData.stage);
    return stage?.color || '#64748B';
  };

  // Get stage label - uses stage_label from DB (which is the source of truth)
  const getStageLabel = () => {
    const stage = stages.find(s => s.stage_key === formData.stage);
    return stage?.stage_label || formData.stage;
  };

  // Get initials for avatar
  const getInitials = () => {
    const first = formData.first_name?.[0] || '';
    const last = formData.last_name?.[0] || '';
    return (first + last).toUpperCase() || '?';
  };

  // Count sessions for badge
  const upcomingSessions = sessions.filter(s =>
    s.booking.status === 'confirmed' && new Date(s.booking.start_time) > new Date()
  ).length;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side={isRTL ? 'left' : 'right'}
          className="w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col [&>button]:hidden"
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {/* Header - matching old drawer design */}
          <div className="flex-shrink-0 border-b border-[var(--v2-border)] p-6">
            <div className="flex items-center gap-4" dir={isRTL ? 'rtl' : 'ltr'}>
              {/* Avatar */}
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
              >
                {getInitials()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <SheetTitle className="text-lg font-semibold text-[var(--v2-text-primary)] truncate text-start">
                    {formData.first_name} {formData.last_name}
                  </SheetTitle>
                  <Badge
                    className="text-xs font-bold px-3 py-1 rounded-full text-white"
                    style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
                  >
                    {getStageLabel()}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--v2-text-muted)] flex-wrap">
                  <span>
                    {t('crm.drawer.created_at')}: <bdi>{new Date(contact.created_at).toLocaleDateString(language)}</bdi>
                  </span>
                  <span>•</span>
                  <span>
                    {t('crm.drawer.updated_at')}: <bdi>{new Date(contact.updated_at).toLocaleDateString(language)}</bdi>
                  </span>
                  {sessions.length > 0 && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-[var(--v2-text-muted)]" />
                        <bdi>{sessions.length}</bdi> {t('crm.drawer.bookings')}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Close button */}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Messages */}
          {successMessage && (
            <div className="flex-shrink-0 mx-6 mt-4 p-3 bg-green-500/20 border border-green-500/40 text-green-600 dark:text-green-400 text-sm font-medium rounded-lg">
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="flex-shrink-0 mx-6 mt-4 p-3 bg-red-500/20 border border-red-500/40 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg">
              {errorMessage}
            </div>
          )}

          {/* Tabs - 2 tabs: Customer and Activities */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'customer' | 'activities')} className="flex-1 flex flex-col overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
            <TabsList className="flex-shrink-0 w-full grid grid-cols-2 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] rounded-none h-10">
              <TabsTrigger
                value="customer"
                className="!text-gray-400 data-[state=active]:!bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#8B5CF6] data-[state=active]:!text-[#8B5CF6] rounded-none text-sm"
              >
                <User className="h-4 w-4 me-1.5" />
                {t('crm.drawer.tab_customer') || 'Customer'}
              </TabsTrigger>
              <TabsTrigger
                value="activities"
                className="!text-gray-400 data-[state=active]:!bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#8B5CF6] data-[state=active]:!text-[#8B5CF6] rounded-none text-sm"
              >
                <MessageSquare className="h-4 w-4 me-1.5" />
                {t('crm.drawer.tab_activities') || 'Activities'}
              </TabsTrigger>
            </TabsList>

            {/* Customer Tab - Details, Bookings with flow, Tasks, Files */}
            <TabsContent value="customer" className="flex-1 overflow-y-auto mt-0 p-4 space-y-4">
              {/* Details Section - collapsed by default */}
              <ClientDetailsSection
                formData={formData}
                setFormData={setFormData}
                stages={stages}
                t={t}
                isRTL={isRTL}
                defaultOpen={false}
                isOpen={openSection === 'details'}
                onToggle={handleSectionToggle('details')}
              />

              {/* Bookings Section - Timeline flow with cards */}
              <BookingsTab
                sessions={sessions}
                /* What became of each plan — stopped, completed, still running.
                   The journey derives the plan from the service, which is the
                   agreement rather than its fate. */
                planStates={planStates}
                t={t}
                isRTL={isRTL}
                language={language}
                onNewSession={handleNewSession}
                onEditSession={handleEditSession}
                onManagePayment={(session) => {
                  setSelectedBookingForPayment(session);
                  setShowPaymentModal(true);
                }}
                onIntakeSaved={() => {
                  fetchSessions(contact.id, { silent: true });
                  fetchActivities(contact.id, { silent: true });
                }}
                onSendIntake={async (bookingId) => {
                  // Show confirmation dialog instead of sending directly
                  setPendingIntakeBookingId(bookingId);
                  setShowIntakeConfirm(true);
                }}
                onOpenProposalBuilder={(bookingId, context) =>
                  setProposalBuilder({ bookingId, ...context })
                }
                /* Confirmed, not fired from the row.
                   It bills the client — an accidental tap sends someone a real
                   invoice, and there is no undo that unsends an email. */
                onCompleteStage={(stageId, label, amount) =>
                  setPendingStage({ id: stageId, label, amount })
                }
                /* Record how the appointment went, from the card header.
                   Each outcome has its own endpoint — they are not interchangeable
                   writes to a status column: completing may settle money, a
                   cancellation notifies the client and frees the slot. */
                onSetBookingStatus={async (bookingId, status) => {
                  /*
                   * Cancelling reaches the CLIENT — it emails them and releases
                   * the slot — so it is confirmed rather than fired from a menu.
                   * The other two only record what happened.
                   */
                  if (status === 'cancelled') {
                    setPendingCancelBookingId(bookingId);
                    return;
                  }

                  const path = status === 'completed' ? 'complete' : 'no-show';

                  try {
                    const response = await fetch(`/api/scheduling/bookings/${bookingId}/${path}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({})
                    });
                    const data = await response.json();
                    if (!response.ok || data.success === false) {
                      throw new Error(data.error || 'Failed to update the booking');
                    }
                    toast.success(t('crm.booking.status_updated') || 'Booking updated');
                    fetchSessions(contact.id, { silent: true });
                    fetchActivities(contact.id, { silent: true });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to update the booking');
                  }
                }}
                onResendConfirmation={(bookingId) => {
                  // Confirm first — the same as the other two sends.
                  setPendingConfirmationBookingId(bookingId);
                  setShowConfirmationResend(true);
                }}
                onSendInvoice={async (invoiceId, bookingId) => {
                  // Show confirmation dialog instead of sending directly
                  setPendingInvoiceId(invoiceId);
                  setPendingInvoiceBookingId(bookingId);
                  setShowInvoiceConfirm(true);
                }}
                isLoading={loadingSessions}
                isOpen={openSection === 'bookings'}
                onToggle={handleSectionToggle('bookings')}
              />

              {/* Tasks Section */}
              <TasksSection
                tasks={tasks}
                t={t}
                isRTL={isRTL}
                onCreateTask={handleCreateTask}
                onToggleTask={handleToggleTask}
                onDeleteTask={handleDeleteTask}
                isLoading={loadingTasks}
                isOpen={openSection === 'tasks'}
                onToggle={handleSectionToggle('tasks')}
              />

              {/* Payments & Invoices Section */}
              <PaymentsSection
                key={paymentsKey}
                contactId={contact.id}
                /* Already loaded for the bookings section — the money list heads
                   each row with the session it paid for. */
                sessions={sessions}
                contactName={`${contact.first_name} ${contact.last_name || ''}`.trim()}
                contactEmail={contact.email || undefined}
                t={t}
                isRTL={isRTL}
                language={language}
                isOpen={openSection === 'payments'}
                onToggle={handleSectionToggle('payments')}
                /* A refund made in the money list changes the JOURNEY too —
                   the payment node above shows what was charged and what came
                   back. The section refreshes its own two lists; only the
                   drawer can refresh the timeline, so it is told. */
                onMoneyChanged={() => fetchSessions(contact.id, { silent: true })}
              />

              {/* Website Form Submissions Section */}
              <FormSubmissionsSection
                contact={contact}
                activities={activities}
                t={t}
                isRTL={isRTL}
                language={language}
                isOpen={openSection === 'forms'}
                onToggle={handleSectionToggle('forms')}
              />

              {/* Files Section */}
              <FilesTab
                documents={documents}
                intakeResponses={intakeResponses}
                t={t}
                isRTL={isRTL}
                language={language}
                isLoading={loadingDocuments}
                onUploadDocument={() => setShowUploadModal(true)}
                onDownloadDocument={(docId) => {
                  const doc = documents.find(d => d.id === docId);
                  if (doc?.download_url) {
                    window.open(doc.download_url, '_blank');
                  }
                }}
                onDeleteDocument={async (docId) => {
                  try {
                    const response = await fetch(`/api/crm/contacts/${contact.id}/documents/${docId}`, {
                      method: 'DELETE'
                    });
                    const data = await response.json();
                    if (data.success) {
                      fetchDocuments(contact.id);
                    }
                  } catch (error) {
                    console.error('Failed to delete document:', error);
                  }
                }}
                isOpen={openSection === 'files'}
                onToggle={handleSectionToggle('files')}
              />
            </TabsContent>

            {/* Activities Tab - Notes & Activity Feed */}
            <TabsContent value="activities" className="flex-1 overflow-y-auto mt-0 p-4 space-y-4">
              {/* Notes Section */}
              <NotesSection
                notes={formData.notes}
                onNotesChange={handleNotesChange}
                t={t}
                isRTL={isRTL}
                defaultOpen={true}
              />

              {/* Activity Section */}
              <ActivitySection
                activities={activities}
                emails={emails}
                t={t}
                isRTL={isRTL}
                language={language}
                onAddActivity={handleAddActivity}
                isLoading={loadingActivities}
                isLoadingEmails={loadingEmails}
              />
            </TabsContent>
          </Tabs>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-[var(--v2-border)] p-4 bg-[var(--v2-surface)]">
            <div className="flex items-center justify-between">
              {/* Destructive actions */}
              <div className="flex items-center gap-2">
                {!showDeleteConfirm && !showDeactivateConfirm && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDeactivateConfirm(true)}
                      className="text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                    >
                      <UserX className="h-4 w-4 me-1" />
                      {t('crm.drawer.deactivate') || 'Deactivate'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4 me-1" />
                      {t('crm.drawer.delete') || 'Delete'}
                    </Button>
                  </>
                )}

                {showDeleteConfirm && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-red-500">{t('crm.drawer.confirm_delete') || 'Delete this contact?'}</span>
                    <Button size="sm" variant="destructive" onClick={handleDelete}>
                      {t('crm.drawer.yes_delete') || 'Yes, delete'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                      {t('crm.drawer.cancel') || 'Cancel'}
                    </Button>
                  </div>
                )}

                {showDeactivateConfirm && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-amber-500">{t('crm.drawer.confirm_deactivate') || 'Deactivate this contact?'}</span>
                    <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={handleDeactivate}>
                      {t('crm.drawer.yes_deactivate') || 'Yes, deactivate'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowDeactivateConfirm(false)}>
                      {t('crm.drawer.cancel') || 'Cancel'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Save button */}
              {!showDeleteConfirm && !showDeactivateConfirm && (
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                >
                  {saving ? t('crm.drawer.saving') || 'Saving...' : t('crm.drawer.save') || 'Save Changes'}
                </Button>
              )}
            </div>
          </div>

          {/* Phone input styles for dark mode */}
          <style jsx global>{`
            /* react-phone-number-input custom styling for V2 design system */
            .phone-input-crm {
              display: flex;
            }

            .phone-input-crm .PhoneInputCountry {
              display: none;
            }

            .phone-input-crm .PhoneInputInput {
              flex: 1;
              background: var(--v2-surface);
              border: 1px solid var(--v2-border);
              border-radius: var(--v2-radius-button);
              padding: 0.5rem 0.75rem;
              color: var(--v2-text-primary);
              font-size: 0.875rem;
              outline: none;
              transition: all 0.2s ease;
            }

            .phone-input-crm .PhoneInputInput:focus {
              border-color: #8B5CF6;
              box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2);
            }

            .phone-input-crm .PhoneInputInput::placeholder {
              color: var(--v2-text-muted);
            }
          `}</style>
        </SheetContent>
      </Sheet>

      {/* Booking Modal */}
      <SchedulingBookingModal
        servicesLoading={servicesLoading}
        booking={editingBooking}
        services={services}
        isOpen={showBookingModal}
        onClose={() => {
          setShowBookingModal(false);
          setEditingBooking(undefined);
        }}
        onBookingUpdated={() => {
          fetchSessions(contact.id, { silent: true });
          fetchActivities(contact.id, { silent: true });
          fetchAllBookings(); // Refresh all bookings for availability
          setShowBookingModal(false);
          setEditingBooking(undefined);
          // Note: Don't call onContactUpdated() here - it closes the drawer
          // Booking updates are silently refreshed in the drawer without closing it
        }}
        availability={availability}
        prefilledContact={{
          id: contact.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email,
          phone: contact.phone
        }}
        existingBookings={allBookings}
      />

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUpload={handleFileUpload}
        uploading={uploadingDocument}
        t={t}
      />

      {/* Payment Management Modal */}

      {/* Invoice Creation Modal */}
      <InvoiceModal
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        onSave={() => {
          setPaymentsKey(prev => prev + 1); // Trigger refresh of payments section
          setShowInvoiceModal(false);
        }}
        contactId={contact.id}
        contactName={`${contact.first_name} ${contact.last_name || ''}`.trim()}
        contactEmail={contact.email || undefined}
      />

      {/* Intake Send Confirmation Dialog */}
      {/*
        Billing a milestone, confirmed.
        ─────────────────────────────────────────────────────────────────────
        The one action in this drawer that sends a client a bill. It cannot be
        undone from here — the invoice exists and the email has left — so the
        amount is named in the question rather than left to the row the owner
        happened to tap.
      */}
      <Dialog open={Boolean(pendingStage)} onOpenChange={open => !open && setPendingStage(null)}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t('crm.stage.confirm_title')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {t('crm.stage.confirm_body')
                .replace('{stage}', pendingStage?.label ?? '')
                .replace('{amount}', pendingStage?.amount ?? '')
                .replace('{name}', contact.first_name)}
            </p>
          </div>
          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              variant="outline"
              onClick={() => setPendingStage(null)}
              disabled={completingStage}
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={completingStage}
              onClick={async () => {
                if (!pendingStage) return;
                setCompletingStage(true);
                try {
                  const response = await fetch(
                    `/api/business-os/payment-stages/${pendingStage.id}/complete`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
                  );
                  const data = await response.json();
                  if (!data.success) {
                    // 'already_done' is not a failure the owner caused — another
                    // tab, or a second tap, got there first.
                    throw new Error(
                      data.code === 'already_done'
                        ? t('crm.stage.already_done')
                        : data.error || t('crm.stage.error')
                    );
                  }
                  toast.success(t('crm.stage.invoiced'));
                  setPendingStage(null);
                  fetchSessions(contact.id, { silent: true });
                  fetchActivities(contact.id, { silent: true });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('crm.stage.error'));
                } finally {
                  setCompletingStage(false);
                }
              }}
            >
              {completingStage ? '...' : t('crm.stage.confirm_action')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showIntakeConfirm} onOpenChange={setShowIntakeConfirm}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {t('crm.intake.send_confirmation_title') || 'Send Intake Form'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {(t('crm.intake.send_confirmation_message') || 'Send intake form to {name}? They will receive a link to fill out the form before their appointment.')
                .replace('{name}', contact.first_name)}
            </p>
          </div>
          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              variant="outline"
              onClick={() => {
                setShowIntakeConfirm(false);
                setPendingIntakeBookingId(null);
              }}
              disabled={sendingIntake}
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={async () => {
                if (!pendingIntakeBookingId) return;
                setSendingIntake(true);
                try {
                  const response = await fetch(`/api/scheduling/bookings/${pendingIntakeBookingId}/intake`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  });
                  const data = await response.json();
                  if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to send intake form');
                  }
                  toast.success(t('crm.intake.email_sent') || 'Intake form email sent');
                  fetchActivities(contact.id, { silent: true });
                  setShowIntakeConfirm(false);
                  setPendingIntakeBookingId(null);
                } catch (err) {
                  const errorMsg = err instanceof Error ? err.message : 'Failed to send intake form';
                  toast.error(errorMsg);
                } finally {
                  setSendingIntake(false);
                }
              }}
              disabled={sendingIntake}
            >
              {sendingIntake ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t('common.sending') || 'Sending...'}
                </span>
              ) : (
                t('crm.intake.send') || 'Send'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* The quote builder.
          Mounted beside the payment modal rather than inside the tab, so it
          survives the accordion closing under it — an owner who collapses the
          section mid-quote does not lose what they typed. */}
      {proposalBuilder && (() => {
        const session = sessions.find(s => s.booking.id === proposalBuilder.bookingId);
        return (
          <ProposalBuilderModal
            isOpen
            onClose={() => setProposalBuilder(null)}
            contactId={contact.id}
            contactName={`${contact.first_name} ${contact.last_name || ''}`.trim()}
            serviceId={session?.booking.service_id ?? null}
            bookingId={proposalBuilder.bookingId}
            defaultTitle={session?.booking.service?.service_name || ''}
            /* The SERVICE's currency first. A quote request has no payment
               row to inherit one from, so reading the payment meant every
               quote from a business outside the US defaulted to dollars. */
            currency={session?.booking.service?.currency || session?.payment?.currency || 'USD'}
            supersedesId={proposalBuilder.supersedesId}
            /* The version being revised, so the form opens on it.
               Re-typing a paragraph and a payment schedule to change one number
               is how an owner decides not to bother re-quoting at all. */
            basedOn={proposals.find(p => p.id === proposalBuilder.supersedesId) ?? null}
            declineReason={proposalBuilder.declineReason}
            declineNote={proposalBuilder.declineNote}
            onSent={() => {
              // The journey has to move the moment it is sent: the step flips
              // from waiting-on-you to waiting-on-them, and the activity
              // timeline gains the send.
              fetchSessions(contact.id, { silent: true });
              fetchActivities(contact.id, { silent: true });
            }}
            t={t}
            isRTL={isRTL}
          />
        );
      })()}

      {/* Payment Management Modal */}
      <PaymentManagementModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setSelectedBookingForPayment(null);
        }}
        booking={selectedBookingForPayment}
        contactName={`${contact.first_name} ${contact.last_name || ''}`.trim()}
        onPaymentUpdated={() => {
          fetchSessions(contact.id, { silent: true });
          fetchActivities(contact.id, { silent: true });
        }}
        onBookingDeleted={(bookingId) => {
          fetchSessions(contact.id, { silent: true });
          fetchActivities(contact.id, { silent: true });
          setShowPaymentModal(false);
          setSelectedBookingForPayment(null);
        }}
        t={t}
        isRTL={isRTL}
        startInRefundView={true}
      />

      {/* Booking Cancellation Confirmation */}
      <Dialog
        open={!!pendingCancelBookingId}
        onOpenChange={open => !open && setPendingCancelBookingId(null)}
      >
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t('crm.booking.cancel_title') || 'Cancel this booking?'}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {/* Two messages, because the promise differs.
                  The scheduled one says the slot will be freed — true of an
                  appointment, and nonsense for a course sold without one, where
                  there is no meeting to cancel and no time to give back. Which
                  booking this is decides which sentence is honest. */}
              {(() => {
                const pending = sessions.find(
                  session => session.booking.id === pendingCancelBookingId
                );
                // No start time is the same test the rest of the drawer uses.
                const hasSchedule = Boolean(pending?.booking.start_time);

                return (hasSchedule
                  ? t('crm.booking.cancel_message') ||
                    '{name} will be told the appointment is cancelled and the slot will be freed.'
                  : t('crm.booking.cancel_message_unscheduled')
                ).replace('{name}', contact.first_name || '');
              })()}
            </p>
          </div>
          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              variant="outline"
              onClick={() => setPendingCancelBookingId(null)}
              disabled={cancellingBooking}
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={cancellingBooking}
              onClick={async () => {
                if (!pendingCancelBookingId) return;
                setCancellingBooking(true);
                try {
                  const response = await fetch(
                    `/api/scheduling/bookings/${pendingCancelBookingId}/cancel`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({})
                    }
                  );
                  const data = await response.json();
                  if (!response.ok || data.success === false) {
                    throw new Error(data.error || 'Failed to cancel the booking');
                  }
                  toast.success(t('crm.booking.status_updated') || 'Booking updated');
                  fetchSessions(contact.id, { silent: true });
                  fetchActivities(contact.id, { silent: true });
                  setPendingCancelBookingId(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to cancel the booking');
                } finally {
                  setCancellingBooking(false);
                }
              }}
            >
              {cancellingBooking ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t('common.sending') || 'Working...'}
                </span>
              ) : (
                t('crm.booking.status.cancelled') || 'Cancel booking'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Booking Confirmation Resend Dialog */}
      <Dialog open={showConfirmationResend} onOpenChange={setShowConfirmationResend}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {t('crm.booking.resend_confirmation_title') || 'Send confirmation again'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {(t('crm.booking.resend_confirmation_message') ||
                'Send the appointment confirmation to {name} again? They will receive the details and a calendar invite.')
                .replace('{name}', contact.first_name || '')}
            </p>
          </div>
          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmationResend(false);
                setPendingConfirmationBookingId(null);
              }}
              disabled={sendingConfirmation}
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={async () => {
                if (!pendingConfirmationBookingId) return;
                setSendingConfirmation(true);
                try {
                  const response = await fetch(
                    `/api/scheduling/bookings/${pendingConfirmationBookingId}/confirmation`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
                  );
                  const data = await response.json();
                  if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to send the confirmation');
                  }
                  toast.success(t('crm.booking.confirmation_sent') || 'Confirmation sent');
                  // The send lands on the timeline, so the drawer reflects it.
                  fetchActivities(contact.id, { silent: true });
                  setShowConfirmationResend(false);
                  setPendingConfirmationBookingId(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to send the confirmation');
                } finally {
                  setSendingConfirmation(false);
                }
              }}
              disabled={sendingConfirmation}
            >
              {sendingConfirmation ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t('common.sending') || 'Sending...'}
                </span>
              ) : (
                t('crm.intake.send') || 'Send'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice Resend Confirmation Dialog */}
      <Dialog open={showInvoiceConfirm} onOpenChange={setShowInvoiceConfirm}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {pendingInvoiceIsPaid
                ? t('crm.invoice.send_receipt_confirmation_title')
                : t('crm.invoice.resend_confirmation_title') || 'Resend Invoice'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {(pendingInvoiceIsPaid
                ? t('crm.invoice.send_receipt_confirmation_message')
                : t('crm.invoice.resend_confirmation_message') ||
                  'Resend invoice to {name}? They will receive a new email with the payment link.'
              ).replace('{name}', contact.first_name)}
            </p>
          </div>
          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              variant="outline"
              onClick={() => {
                setShowInvoiceConfirm(false);
                setPendingInvoiceId(null);
                setPendingInvoiceBookingId(null);
              }}
              disabled={sendingInvoice}
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={async () => {
                if (!pendingInvoiceId) return;
                setSendingInvoice(true);
                try {
                  const response = await fetch(`/api/payments/invoices/${pendingInvoiceId}/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  });
                  const data = await response.json();
                  if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to send invoice');
                  }
                  /*
                   * The SERVER says which document went, not this component.
                   * It decides by the invoice's status at send time, and that
                   * can differ from what the dialog assumed — a payment landing
                   * in the seconds between opening and confirming turns an
                   * invoice into a receipt.
                   */
                  toast.success(
                    data.sentAs === 'receipt'
                      ? t('crm.invoice.receipt_sent')
                      : t('crm.invoice.email_sent') || 'Invoice email sent'
                  );
                  fetchActivities(contact.id, { silent: true });
                  fetchSessions(contact.id, { silent: true });
                  setShowInvoiceConfirm(false);
                  setPendingInvoiceId(null);
                  setPendingInvoiceBookingId(null);
                } catch (err) {
                  const errorMsg = err instanceof Error ? err.message : 'Failed to send invoice';
                  toast.error(errorMsg);
                } finally {
                  setSendingInvoice(false);
                }
              }}
              disabled={sendingInvoice}
            >
              {sendingInvoice ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t('common.sending') || 'Sending...'}
                </span>
              ) : (
                /* Follows the same fact as the title and the body above. A
                   receipt dialog with a "resend invoice" button asks the owner
                   to press something other than what they read. */
                pendingInvoiceIsPaid
                  ? t('crm.invoice.send_receipt')
                  : t('crm.invoice.resend') || 'Resend'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
